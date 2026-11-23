const express = require('express');
const router = express.Router();
const BankAccount = require('../models/BankAccount');
const Sale = require('../models/Sale');
const Transfer = require('../models/Transfer');
const CreditPayment = require('../models/CreditPayment');
const SupplierPayment = require('../models/SupplierPayment');
const Expense = require('../models/Expense');
const SaleReturn = require('../models/SaleReturn');
const { isLoggedIn, isAdmin } = require('../middleware/auth');
const { postJournal, resolveMoneyAccount } = require('../utils/ledger');

// ✅ Cash/Bank refunds (returns) — "open" returns hamesha physical cash drawer
// se nikalte hain, "linked" returns original sale ke paymentMethod ke hisaab
// se cash ya bank se nikalte hain (dekho: routes/sales.js return route)
async function getRefundRows(type, accountId, dateFilter) {
  const refunds = await SaleReturn.find({ cashRefunded: { $gt: 0 }, ...dateFilter })
    .populate('originalSale', 'paymentMethod bankAccount')
    .sort({ createdAt: -1 })
    .limit(500);

  const filtered = refunds.filter(r => {
    if (r.returnType === 'open') {
      return type === 'cash'; // open route sirf cash/wallet support karta hai
    }
    const origPM = r.originalSale ? r.originalSale.paymentMethod : null;
    if (type === 'cash') return origPM === 'cash';
    return origPM === 'bank' && r.originalSale && r.originalSale.bankAccount
      && r.originalSale.bankAccount.toString() === String(accountId);
  });

  return filtered.map(r => ({
    kind: 'refund',
    _id: r._id,
    note: r.notes || '',
    counterparty: r.customerName || 'Walk-in',
    amount: r.cashRefunded || 0,
    createdAt: r.createdAt
  }));
}

async function getTransferTotals(type, accountId, dateFilter) {
  const outQuery = type === 'cash'
    ? { fromType: 'cash', ...dateFilter }
    : { fromType: 'bank', fromAccount: accountId, ...dateFilter };
  const inQuery = type === 'cash'
    ? { toType: 'cash', ...dateFilter }
    : { toType: 'bank', toAccount: accountId, ...dateFilter };

  const [outDocs, inDocs] = await Promise.all([
    Transfer.find(outQuery),
    Transfer.find(inQuery)
  ]);

  const transfersOut = outDocs.reduce((sum, t) => sum + (t.amount || 0), 0);
  const transfersIn = inDocs.reduce((sum, t) => sum + (t.amount || 0), 0);
  return { transfersIn, transfersOut };
}

async function getAccountHistory(type, accountId, dateFilter) {
  const saleQuery = type === 'cash'
    ? { paymentMethod: 'cash', ...dateFilter }
    : { paymentMethod: 'bank', bankAccount: accountId, ...dateFilter };

  const creditPaymentQuery = type === 'cash'
    ? { method: 'cash', ...dateFilter }
    : { method: 'bank', bankAccount: accountId, ...dateFilter };

  const outQuery = type === 'cash'
    ? { fromType: 'cash', ...dateFilter }
    : { fromType: 'bank', fromAccount: accountId, ...dateFilter };
  const inQuery = type === 'cash'
    ? { toType: 'cash', ...dateFilter }
    : { toType: 'bank', toAccount: accountId, ...dateFilter };

  const expenseQuery = type === 'cash'
    ? { paymentMethod: 'cash', date: dateFilter.createdAt }
    : { paymentMethod: 'bank', bankAccount: accountId, date: dateFilter.createdAt };

  const [sales, creditPayments, transfersOut, transfersIn, expenses, refunds] = await Promise.all([
    Sale.find(saleQuery).sort({ createdAt: -1 }).limit(500).populate('customer', 'name'),
    CreditPayment.find(creditPaymentQuery).sort({ createdAt: -1 }).limit(500),
    Transfer.find(outQuery).sort({ createdAt: -1 }).limit(500),
    Transfer.find(inQuery).sort({ createdAt: -1 }).limit(500),
    Expense.find(expenseQuery).sort({ date: -1 }).limit(500),
    getRefundRows(type, accountId, dateFilter)
  ]);

  let supplierPaymentsTotal = 0;
  if (type === 'cash') {
    const cashSupplierPayments = await SupplierPayment.find({ method: 'cash', ...dateFilter });
    supplierPaymentsTotal = cashSupplierPayments.reduce((sum, p) => sum + (p.amount || 0), 0);
  }

  const saleRows = sales.map(s => ({
    kind: 'sale',
    _id: s._id,
    invoiceNumber: s.invoiceNumber,
    customerName: s.customerName || 'Walk-in',
    amount: s.amountPaid || 0,
    createdAt: s.createdAt
  }));

  const creditPaymentRows = creditPayments.map(cp => ({
    kind: 'credit-payment',
    _id: cp.sale,
    invoiceNumber: cp.invoiceNumber,
    customerName: cp.customerName || 'Walk-in',
    amount: cp.amount || 0,
    createdAt: cp.createdAt
  }));

  const outRows = transfersOut.map(t => ({
    kind: 'transfer-out',
    _id: t._id,
    note: t.note,
    counterparty: t.toLabel,
    amount: t.amount,
    createdAt: t.createdAt
  }));

  const inRows = transfersIn.map(t => ({
    kind: 'transfer-in',
    _id: t._id,
    note: t.note,
    counterparty: t.fromLabel,
    amount: t.amount,
    createdAt: t.createdAt
  }));

  const expenseRows = expenses.map(e => ({
    kind: 'expense',
    _id: e._id,
    note: e.description,
    counterparty: e.category,
    amount: e.amount,
    createdAt: e.date
  }));

  const totalReceived = saleRows.reduce((sum, r) => sum + r.amount, 0)
    + creditPaymentRows.reduce((sum, r) => sum + r.amount, 0);
  const totalTransfersIn = inRows.reduce((sum, r) => sum + r.amount, 0);
  const totalTransfersOut = outRows.reduce((sum, r) => sum + r.amount, 0);
  const totalExpenses = expenseRows.reduce((sum, r) => sum + r.amount, 0);
  const totalRefunds = refunds.reduce((sum, r) => sum + r.amount, 0);
  const netBalance = totalReceived + totalTransfersIn - totalTransfersOut - supplierPaymentsTotal - totalExpenses - totalRefunds;

  const history = [...saleRows, ...creditPaymentRows, ...outRows, ...inRows, ...expenseRows, ...refunds]
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  return { history, totalReceived, totalTransfersIn, totalTransfersOut, netBalance };
}

router.get('/', isLoggedIn, isAdmin, async (req, res) => {
  try {
    const accounts = await BankAccount.find({ isActive: true }).sort({ bankName: 1 });

    const { account: selectedId = null } = req.query;

    const PKT_OFFSET = 5 * 60;  // minutes
    const nowPKT = new Date(Date.now() + PKT_OFFSET * 60000);
    const today = nowPKT.toISOString().split('T')[0];  // 'YYYY-MM-DD' in PKT

    const dateFrom = req.query.dateFrom !== undefined ? req.query.dateFrom : today;
    const dateTo = req.query.dateTo !== undefined ? req.query.dateTo : today;

    let dateFilter = {};
    if (dateFrom || dateTo) {
      dateFilter.createdAt = {};
      if (dateFrom) dateFilter.createdAt.$gte = new Date(dateFrom + 'T00:00:00.000+05:00');
      if (dateTo) dateFilter.createdAt.$lte = new Date(dateTo + 'T23:59:59.999+05:00');
    }

    const cashHistoryData = await getAccountHistory('cash', null, dateFilter);
    const cashSales = cashHistoryData.history; // ab Sales + Transfers dono
    const totalCash = cashHistoryData.netBalance;

    const accountsWithFilteredBalance = await Promise.all(
      accounts.map(async (acc) => {
        return {
          ...acc.toObject(),
          filteredBalance: acc.balance || 0
        };
      })
    );

    let transactions = [];
    let selectedAccount = null;
    let selectedFilteredBalance = 0;


    if (selectedId && selectedId !== 'cash') {
      selectedAccount = await BankAccount.findById(selectedId);

      const bankHistoryData = await getAccountHistory(
        'bank',
        selectedId,
        dateFilter
      );

      transactions = bankHistoryData.history;

      selectedFilteredBalance =
        selectedAccount?.balance || 0;
    }

    const transferAccountOptions = accounts.map(a => ({ _id: a._id, label: `${a.bankName} — ${a.accountTitle}` }));

    res.render('bankAccounts/index', {
      accounts: accountsWithFilteredBalance,
      selectedAccount,
      selectedFilteredBalance,
      transactions,
      selectedId,
      cashSales,
      totalCash,
      transferAccountOptions,
      dateFrom: dateFrom || '',
      dateTo: dateTo || '',
      currentPage: 'bank-accounts',
      success: req.flash('success'),
      error: req.flash('error')
    });
  } catch (err) {
    req.flash('error', err.message);
    res.redirect('/dashboard');
  }
});


router.post('/add', isLoggedIn, isAdmin, async (req, res) => {
  try {
    const { bankName, accountTitle, accountNumber, notes } = req.body;
    await BankAccount.create({ bankName, accountTitle, accountNumber, notes });
    req.flash('success', `${bankName} account add ho gaya!`);
    res.redirect('/bank-accounts');
  } catch (err) {
    req.flash('error', err.message);
    res.redirect('/bank-accounts');
  }
});


router.post('/:id/delete', isLoggedIn, isAdmin, async (req, res) => {
  try {
    const account = await BankAccount.findById(req.params.id);
    if (!account) {
      req.flash('error', 'Account nahi mila.');
      return res.redirect('/bank-accounts');
    }

    await BankAccount.findByIdAndDelete(req.params.id);

    req.flash('success', `${account.bankName} — ${account.accountTitle} permanently delete ho gaya.`);
    res.redirect('/bank-accounts');
  } catch (err) {
    req.flash('error', err.message);
    res.redirect('/bank-accounts');
  }
});


router.post('/transfer', isLoggedIn, isAdmin, async (req, res) => {
  try {
    const { fromType, fromAccountId, toType, toAccountId, amount, note } = req.body;

    const amt = parseFloat(amount) || 0;
    if (amt <= 0) {
      req.flash('error', 'Amount valid honi chahiye.');
      return res.redirect('/bank-accounts');
    }

    if (fromType === toType && (fromType === 'cash' || fromAccountId === toAccountId)) {
      req.flash('error', 'From aur To account same nahi ho sakte.');
      return res.redirect('/bank-accounts');
    }

    let fromLabel = 'Cash';
    let fromAccount = null;
    if (fromType === 'bank') {
      const acc = await BankAccount.findById(fromAccountId);
      if (!acc) { req.flash('error', 'From account nahi mila.'); return res.redirect('/bank-accounts'); }
      fromAccount = acc._id;
      fromLabel = `${acc.bankName} — ${acc.accountTitle}`;
    }

    let toLabel = 'Cash';
    let toAccount = null;
    if (toType === 'bank') {
      const acc = await BankAccount.findById(toAccountId);
      if (!acc) { req.flash('error', 'To account nahi mila.'); return res.redirect('/bank-accounts'); }
      toAccount = acc._id;
      toLabel = `${acc.bankName} — ${acc.accountTitle}`;
    }

    await Transfer.create({
      fromType,
      fromAccount,
      fromLabel,
      toType,
      toAccount,
      toLabel,
      amount: amt,
      note: note || ''
    });

    if (fromType === 'bank' && fromAccount) {
      await BankAccount.findByIdAndUpdate(
        fromAccount,
        { $inc: { balance: -amt } }
      );
    }

    if (toType === 'bank' && toAccount) {
      await BankAccount.findByIdAndUpdate(
        toAccount,
        { $inc: { balance: amt } }
      );
    }

    try {
      const fromBankDoc = fromType === 'bank' ? await BankAccount.findById(fromAccount) : null;
      const toBankDoc   = toType === 'bank'   ? await BankAccount.findById(toAccount)   : null;
      const fromLedgerAcc = await resolveMoneyAccount(fromType, fromBankDoc);
      const toLedgerAcc   = await resolveMoneyAccount(toType, toBankDoc);
      await postJournal({
        narration: `Transfer — ${fromLabel} → ${toLabel}${note ? ' — ' + note : ''}`,
        refType: 'Transfer',
        refId: null,
        lines: [
          { account: toLedgerAcc, debit: amt, credit: 0 },
          { account: fromLedgerAcc, debit: 0, credit: amt }
        ]
      });
    } catch (ledgerErr) {
      console.error('Ledger transfer error:', ledgerErr);
    }


    req.flash('success', `Rs. ${amt.toLocaleString()} transfer ho gaya — ${fromLabel} → ${toLabel}`);
    res.redirect('/bank-accounts');
  } catch (err) {
    req.flash('error', err.message);
    res.redirect('/bank-accounts');
  }
});


module.exports = router;