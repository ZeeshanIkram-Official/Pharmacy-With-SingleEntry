const express = require('express');
const router = express.Router();
const Sale = require('../models/Sale');
const Expense = require('../models/Expense');
const Transfer = require('../models/Transfer');
const CreditPayment = require('../models/CreditPayment');
const SupplierPayment = require('../models/SupplierPayment');
const SaleReturn = require('../models/SaleReturn');
const moment = require('moment');
const { Account, JournalEntry, postJournal } = require('../utils/ledger');

async function getCashFlowData(start, end) {
  const dateRange = { $gte: start.toDate(), $lte: end.toDate() };

  const [
    sales,
    creditPayments,
    supplierPayments,
    transfers,
    expenses,
    cashRefunds
  ] = await Promise.all([
    Sale.find({ createdAt: dateRange, status: 'completed' })
      .sort({ createdAt: -1 })
      .populate('bankAccount', 'bankName accountTitle'),
    CreditPayment.find({ createdAt: dateRange })
      .sort({ createdAt: -1 })
      .populate('bankAccount', 'bankName accountTitle'),
    SupplierPayment.find({ createdAt: dateRange })
      .sort({ createdAt: -1 })
      .populate('bankAccount', 'bankName accountTitle'),
    Transfer.find({ createdAt: dateRange }).sort({ createdAt: -1 }),
    Expense.find({ date: dateRange }).sort({ date: -1 }),
    // ✅ Woh sab returns jinme actual physical cash wapis gaya ho — linked
    // (invoice-adjust) aur open (walk-in) dono types isi field se cover ho
    // jate hain, refundMode alag hone ke bawajood
    SaleReturn.find({ createdAt: dateRange, cashRefunded: { $gt: 0 } }).sort({ createdAt: -1 })
  ]);

  const rows = [];

  sales.forEach(s => {
    if ((s.amountPaid || 0) <= 0) return; // pure credit, abhi tak kuch nahi mila
    const accountLabel = s.paymentMethod === 'bank' && s.bankAccount
      ? `${s.bankAccount.bankName} — ${s.bankAccount.accountTitle}`
      : (s.paymentMethod || 'cash').charAt(0).toUpperCase() + (s.paymentMethod || 'cash').slice(1);

    rows.push({
      kind: 'in',
      type: 'Sale',
      icon: '🛒',
      label: `${s.invoiceNumber} — ${s.customerName || 'Walk-in'}`,
      account: accountLabel,
      amount: s.amountPaid || 0,
      createdAt: s.createdAt,
      link: `/sales/${s._id}/invoice`
    });
  });

  creditPayments.forEach(cp => {
    const accountLabel = cp.method === 'bank' && cp.bankAccount
      ? `${cp.bankAccount.bankName} — ${cp.bankAccount.accountTitle}`
      : 'Cash';

    rows.push({
      kind: 'in',
      type: 'Credit Payment',
      icon: '💳',
      label: `${cp.invoiceNumber || ''} — ${cp.customerName || 'Walk-in'}`,
      account: accountLabel,
      amount: cp.amount || 0,
      createdAt: cp.createdAt,
      link: cp.sale ? `/sales/${cp.sale}/invoice` : null
    });
  });

  supplierPayments.forEach(sp => {
    const accountLabel = sp.method === 'bank' && sp.bankAccount
      ? `${sp.bankAccount.bankName} — ${sp.bankAccount.accountTitle}`
      : 'Cash';

    rows.push({
      kind: 'out',
      type: 'Supplier Payment',
      icon: '🏭',
      label: `${sp.supplierName || 'Supplier'}${sp.note ? ' — ' + sp.note : ''}`,
      account: accountLabel,
      amount: sp.amount || 0,
      createdAt: sp.createdAt,
      link: sp.supplier ? `/suppliers/${sp.supplier}` : null
    });
  });

  expenses.forEach(e => {
    rows.push({
      kind: 'out',
      type: 'Expense',
      icon: '💸',
      label: `${e.category}${e.description ? ' — ' + e.description : ''}`,
      account: (e.paymentMethod || 'cash').charAt(0).toUpperCase() + (e.paymentMethod || 'cash').slice(1),
      amount: e.amount || 0,
      createdAt: e.date,
      link: null
    });
  });

  // ✅ Cash refunds (returns) — physically dukaan se cash bahar gaya, isliye
  // cashflow mein 'out' dikhna zaroori hai warna cash-drawer ka hisaab match
  // nahi hoga
  cashRefunds.forEach(r => {
    rows.push({
      kind: 'out',
      type: 'Refund',
      icon: '↩️',
      label: `${r.returnNumber} — ${r.customerName || 'Walk-in Customer'}`,
      account: 'Cash',
      amount: r.cashRefunded || 0,
      createdAt: r.createdAt,
      link: `/sale-returns/${r._id}`
    });
  });

  transfers.forEach(t => {
    rows.push({
      kind: 'transfer',
      type: 'Transfer',
      icon: '↔️',
      label: `${t.fromLabel} → ${t.toLabel}${t.note ? ' — ' + t.note : ''}`,
      account: `${t.fromLabel} → ${t.toLabel}`,
      amount: t.amount || 0,
      createdAt: t.createdAt,
      link: null
    });
  });

  rows.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const totalIn  = rows.filter(r => r.kind === 'in').reduce((sum, r) => sum + r.amount, 0);
  const totalOut = rows.filter(r => r.kind === 'out').reduce((sum, r) => sum + r.amount, 0);
  const totalTransferred = rows.filter(r => r.kind === 'transfer').reduce((sum, r) => sum + r.amount, 0);
  const netCashFlow = totalIn - totalOut;

  const byType = {};
  rows.forEach(r => {
    if (r.kind === 'transfer') return;
    if (!byType[r.type]) byType[r.type] = { type: r.type, kind: r.kind, total: 0, count: 0 };
    byType[r.type].total += r.amount;
    byType[r.type].count += 1;
  });

  return {
    rows,
    totalIn,
    totalOut,
    netCashFlow,
    totalTransferred,
    transferCount: transfers.length,
    byType: Object.values(byType)
  };
}

router.get('/profit', async (req, res) => {
  try {
    let { from, to } = req.query;

    const start = from ? moment(from).startOf('day') : moment().startOf('day');
    const end   = to   ? moment(to).endOf('day')     : moment().endOf('day');

    const sales = await Sale.find({
      createdAt: { $gte: start.toDate(), $lte: end.toDate() },
      status: 'completed'
    });

    const totalRevenue = sales.reduce((sum, s) => sum + s.totalAmount, 0);
    const totalCost    = sales.reduce((sum, s) => sum + (s.totalCost || 0), 0);
    const grossProfit  = totalRevenue - totalCost;

    const expenses = await Expense.find({
      date: { $gte: start.toDate(), $lte: end.toDate() }
    });

    const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);

    const netProfit = grossProfit - totalExpenses;

    const expenseCategoryTotals = await Expense.aggregate([
      { $match: { date: { $gte: start.toDate(), $lte: end.toDate() } } },
      { $group: { _id: '$category', total: { $sum: '$amount' } } },
      { $sort: { total: -1 } }
    ]);

    const daily = {};

    sales.forEach(s => {
      const day = moment(s.createdAt).format('YYYY-MM-DD');
      if (!daily[day]) daily[day] = { revenue: 0, cost: 0, expenses: 0 };
      daily[day].revenue += s.totalAmount;
      daily[day].cost    += (s.totalCost || 0);
    });

    expenses.forEach(e => {
      const day = moment(e.date).format('YYYY-MM-DD');
      if (!daily[day]) daily[day] = { revenue: 0, cost: 0, expenses: 0 };
      daily[day].expenses += e.amount;
    });

    const dailyData = Object.keys(daily)
      .sort()
      .map(date => ({
        date,
        revenue:  daily[date].revenue,
        cost:     daily[date].cost,
        expenses: daily[date].expenses,
        gross:    daily[date].revenue - daily[date].cost,
        net:      daily[date].revenue - daily[date].cost - daily[date].expenses
      }));

    const cashFlow = await getCashFlowData(start, end);

    res.render('reports/profit', {
      from, to,
      totalRevenue,
      totalCost,
      grossProfit,
      totalExpenses,
      netProfit,
      dailyData,
      expenseCategoryTotals,
      cashFlow,
      moment,
      currentPage: 'reports'
    });

  } catch (err) {
    console.error(err);
    res.send('Error loading report');
  }
});

// =======================
// Trial Balance
// =======================
router.get('/trial-balance', async (req, res) => {
  try {
    const asOf = req.query.asOf ? moment(req.query.asOf).endOf('day') : moment().endOf('day');

    const agg = await JournalEntry.aggregate([
      { $match: { date: { $lte: asOf.toDate() } } },
      { $unwind: '$lines' },
      {
        $group: {
          _id: '$lines.account',
          totalDebit: { $sum: '$lines.debit' },
          totalCredit: { $sum: '$lines.credit' }
        }
      }
    ]);

    const balMap = {};
    agg.forEach(a => { balMap[a._id.toString()] = a; });

    const accountsList = await Account.find({ isActive: true }).sort({ code: 1 });

    const sections = { asset: [], liability: [], equity: [], income: [], expense: [] };
    const sectionLabels = {
      asset: 'Assets', liability: 'Liabilities', equity: 'Equity',
      income: 'Income', expense: 'Expenses'
    };
    let totalDr = 0, totalCr = 0;

    accountsList.forEach(acc => {
      const b = balMap[acc._id.toString()];
      if (!b) return;
      const net = (b.totalDebit || 0) - (b.totalCredit || 0);
      if (Math.abs(net) < 0.5) return; // zero-balance accounts hide karo
      const dr = net > 0 ? net : 0;
      const cr = net < 0 ? -net : 0;
      totalDr += dr;
      totalCr += cr;
      sections[acc.type].push({ code: acc.code, name: acc.name, dr, cr });
    });

    res.render('reports/trial-balance', {
      sections,
      sectionLabels,
      totalDr,
      totalCr,
      asOf: asOf.format('YYYY-MM-DD'),
      moment,
      currentPage: 'reports'
    });
  } catch (err) {
    console.error(err);
    res.send('Trial Balance load karne mein masla: ' + err.message);
  }
});

// =======================
// Journal Voucher — manual balanced entry (opening cash set karna,
// corrections, waghera ke liye). Chart of Accounts se koi bhi account
// select karke multi-line Dr/Cr entry post ki ja sakti hai.
// =======================
router.get('/journal-voucher', async (req, res) => {
  try {
    const accountsList = await Account.find({ isActive: true }).sort({ code: 1 });
    res.render('reports/journal-voucher', { accountsList, currentPage: 'reports', error: null });
  } catch (err) {
    res.send('Error: ' + err.message);
  }
});

router.post('/journal-voucher', async (req, res) => {
  try {
    const { date, narration, accountId, debit, credit } = req.body;
    const ids  = Array.isArray(accountId) ? accountId : [accountId];
    const drs  = Array.isArray(debit) ? debit : [debit];
    const crs  = Array.isArray(credit) ? credit : [credit];

    const lines = [];
    for (let i = 0; i < ids.length; i++) {
      if (!ids[i]) continue;
      const acc = await Account.findById(ids[i]);
      if (!acc) continue;
      const d = parseFloat(drs[i]) || 0;
      const c = parseFloat(crs[i]) || 0;
      if (d <= 0 && c <= 0) continue;
      lines.push({ account: acc, debit: d, credit: c });
    }

    const totalD = lines.reduce((s, l) => s + l.debit, 0);
    const totalC = lines.reduce((s, l) => s + l.credit, 0);

    if (lines.length < 2 || Math.abs(totalD - totalC) > 0.5) {
      const accountsList = await Account.find({ isActive: true }).sort({ code: 1 });
      return res.render('reports/journal-voucher', {
        accountsList,
        currentPage: 'reports',
        error: `Entry balance nahi ho rahi \u2014 Dr Rs.${totalD.toFixed(2)} vs Cr Rs.${totalC.toFixed(2)}. Dono barabar hone chahiye.`
      });
    }

    await postJournal({
      date: date ? new Date(date) : new Date(),
      narration: narration || 'Manual Journal Voucher',
      refType: 'Manual',
      refId: null,
      lines,
      createdBy: req.session.userName || 'unknown'
    });

    req.flash('success', 'Journal Voucher post ho gaya');
    res.redirect('/reports/trial-balance');
  } catch (err) {
    console.error(err);
    const accountsList = await Account.find({ isActive: true }).sort({ code: 1 });
    res.render('reports/journal-voucher', { accountsList, currentPage: 'reports', error: err.message });
  }
});

module.exports = router;
