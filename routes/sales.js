const express = require('express');
const router = express.Router();
const Sale = require('../models/Sale');
const Product = require('../models/Medicine'); // ← naam Product hi rakha hai taake neeche ka code minimal change ho, model actually Medicine hai
const Customer = require('../models/Customer');
const Salesman = require('../models/Salesman');
const moment = require('moment');
const { hasScreenAccess } = require('../middleware/auth');
const BankAccount = require('../models/BankAccount');
const CreditPayment = require('../models/CreditPayment');
const { deductStock, restoreStock } = require('../utils/stock');
const SaleReturn = require('../models/SaleReturn');
const { postJournal, reverseJournalFor, resolveMoneyAccount, accounts } = require('../utils/ledger');
const { getEffectiveCredit, getLiveCreditMap } = require('../utils/customerCredit');
const CreditVoucher = require('../models/CreditVoucher');

// ─── Sale (create/edit) ki double-entry journal post karo ──────────────
// rawPaid   = amountPaid field se seedha (jo bank/cash mein jata hai)
// walletUsed = customer ka jo advance/wallet is sale mein use hua
// paid       = actual applied amount (min of totalPaid, totalAmount)
// changeAmount = agar totalPaid > totalAmount to overpay (wallet mein add hota hai)
async function postSaleJournal(sale, { rawPaid, walletUsed, paid, changeAmount, totalCost, bankAccountDoc }) {
  try {
    const lines = [];
    const moneyAcc = await resolveMoneyAccount(sale.paymentMethod, bankAccountDoc);

    if (rawPaid > 0) lines.push({ account: moneyAcc, debit: rawPaid, credit: 0 });
    if (walletUsed > 0) lines.push({ account: await accounts.advances(), debit: walletUsed, credit: 0 });
    const receivable = Math.max(0, (sale.totalAmount || 0) - paid);
    if (receivable > 0) lines.push({ account: await accounts.receivable(), debit: receivable, credit: 0 });

    lines.push({ account: await accounts.salesRevenue(), debit: 0, credit: sale.totalAmount || 0 });
    if (changeAmount > 0) lines.push({ account: await accounts.advances(), debit: 0, credit: changeAmount });

    await postJournal({
      date: sale.createdAt || new Date(),
      narration: `Sale ${sale.invoiceNumber} — ${sale.customerName || 'Walk-in'}`,
      refType: 'Sale',
      refId: sale._id,
      lines
    });

    if (totalCost) {
      const cogsLines = [
        { account: await accounts.cogs(), debit: totalCost, credit: 0 },
        { account: await accounts.inventory(), debit: 0, credit: totalCost }
      ];
      await postJournal({
        date: sale.createdAt || new Date(),
        narration: `COGS for Sale ${sale.invoiceNumber}`,
        refType: 'Sale',
        refId: sale._id,
        lines: cogsLines
      });
    }
  } catch (ledgerErr) {
    console.error('Ledger post error (Sale):', ledgerErr);
  }
}


router.get('/', hasScreenAccess('sales'), async (req, res) => {
  try {
    const { dateFrom, dateTo, search, salesman } = req.query;
    let query = {};

    if (dateFrom || dateTo) {
      query.createdAt = {};
      if (dateFrom) {
        query.createdAt.$gte = moment(dateFrom).startOf('day').toDate();
      }
      if (dateTo) {
        query.createdAt.$lte = moment(dateTo).endOf('day').toDate();
      }
    }

    if (search) query.invoiceNumber = { $regex: search, $options: 'i' };
    if (salesman) query.salesman = salesman;

    let salesQuery = Sale.find(query).sort({ createdAt: -1 });
    if (!dateFrom && !dateTo) {
      salesQuery = salesQuery.limit(50);
    }

    const sales    = await salesQuery;
    const salesmen = await Salesman.find({ isActive: true }).sort({ name: 1 });

    res.render('sales/index', {
      sales,
      salesmen,
      moment,
      dateFrom: dateFrom || '',
      dateTo: dateTo || '',
      search,
      selectedSalesman: salesman || '',
      currentPage: 'sales'
    });

  } catch (err) {
    res.status(500).send('Error: ' + err.message);
  }
});

router.get('/new', async (req, res) => {
  try {
    const customers    = await Customer.find({ isActive: true }).sort({ name: 1 });
    const bankAccounts = await BankAccount.find({ isActive: true }).sort({ bankName: 1 });
    const salesmen     = await Salesman.find({ isActive: true }).sort({ name: 1 });

    const liveCreditMap = await getLiveCreditMap();
    const custAdjDocs = await Customer.find(
      { _id: { $in: customers.map(c => c._id) } },
      'creditAdjustment'
    );
    const adjMap = {};
    custAdjDocs.forEach(c => { adjMap[c._id.toString()] = c.creditAdjustment || 0; });

    const customersWithCredit = customers.map(c => {
      const obj = c.toObject();
      const live = liveCreditMap[c._id.toString()] || 0;
      const adj  = adjMap[c._id.toString()] || 0;
      obj.creditOwed = Math.max(0, live - adj);
      return obj;
    });

    res.render('sales/new', {
      customers: customersWithCredit,
      bankAccounts,
      salesmen,
      error: null,
      currentPage: 'new-sale'
    });

  } catch (err) {
    res.status(500).send('Error');
  }
});

router.get('/credit', async (req, res) => {
  try {
    const { date, search, view = 'credit' } = req.query;

    let creditSales = [];
    let totalCredit = 0;

    if (view === 'credit') {
      // Pehle sirf 'credit' method wali sales dikhti thi. Ab har wo sale
      // dikhegi jiska baaki (outstanding) amount ho — chahe payment method
      // Cash/Bank/Credit kuch bhi ho — jaisa customer ledger mein hota hai.
      let query = { status: { $ne: 'refunded' } };
      if (date) {
        const start = moment(date).startOf('day');
        const end   = moment(date).endOf('day');
        query.createdAt = { $gte: start.toDate(), $lte: end.toDate() };
      }
      if (search) query.customerName = { $regex: search, $options: 'i' };

      const allSales = await Sale.find(query).sort({ createdAt: -1 });

      const unpaidSales = allSales.filter(s => ((s.totalAmount || 0) - (s.amountPaid || 0)) > 0);

      const customerMap = {};

      for (const sale of unpaidSales) {
        const key = sale.customer ? sale.customer.toString() : `walkin_${sale.customerName}`;

        if (!customerMap[key]) {
          customerMap[key] = {
            customerName:   sale.customerName,
            customerId:     sale.customer || null,
            latestSale:     sale,           
            totalAmount:    0,
            totalPaid:      0,
            totalBaaki:     0,
            invoiceCount:   0
          };
        }

        customerMap[key].totalAmount  += (sale.totalAmount || 0);
        customerMap[key].totalPaid    += (sale.amountPaid  || 0);
        customerMap[key].totalBaaki   += (sale.totalAmount || 0) - (sale.amountPaid || 0);
        customerMap[key].invoiceCount += 1;
      }

      creditSales = Object.values(customerMap);

      // ── Voucher se receive hui payments (creditAdjustment) ko invoices ke
      // baaki amount se offset karo — bina Sale documents chheday ──
      const custIds = creditSales.map(c => c.customerId).filter(Boolean);
      if (custIds.length) {
        const custDocs = await Customer.find({ _id: { $in: custIds } }, 'creditAdjustment');
        const adjMap = {};
        custDocs.forEach(c => { adjMap[c._id.toString()] = c.creditAdjustment || 0; });

        creditSales.forEach(c => {
          if (c.customerId) {
            const adj = adjMap[c.customerId.toString()] || 0;
            c.totalBaaki = Math.max(0, c.totalBaaki - adj);
          }
        });
      }

      creditSales = creditSales.filter(c => c.totalBaaki > 0);
      totalCredit = creditSales.reduce((sum, c) => sum + c.totalBaaki, 0);
    }

    let advanceCustomers = [];
    let totalAdvance = 0;

    if (view === 'advance') {
      let customerQuery = { walletBalance: { $gt: 0 }, isActive: true };
      if (search) customerQuery.name = { $regex: search, $options: 'i' };
      advanceCustomers = await Customer.find(customerQuery).sort({ name: 1 });
      totalAdvance = advanceCustomers.reduce((sum, c) => sum + (c.walletBalance || 0), 0);
    }

    res.render('sales/credit', {
      sales: creditSales,
      advanceCustomers,
      creditCustomers: [],
      moment,
      date,
      search,
      totalCredit,
      totalAdvance,
      totalCreditOwed: 0,
      activeView: view,
      currentPage: 'credit-sales'
    });

  } catch (err) {
    res.status(500).send('Error: ' + err.message);
  }
});


// =======================
// Credit Voucher — customer ki purani baaki (credit) ke against general
// payment receive karna, bina kisi specific invoice ke. Sale documents
// touch nahi hote — sirf Customer.creditAdjustment / walletBalance update
// hota hai (jaisa CreditVoucher model mein already design kiya hua hai).
// =======================
router.get('/credit/voucher', async (req, res) => {
  try {
    const bankAccounts = await BankAccount.find({ isActive: true }).sort({ bankName: 1 });
    const customersRaw = await Customer.find(
      { isActive: true },
      'name phone whatsapp walletBalance creditAdjustment'
    ).sort({ name: 1 });

    const liveCreditMap = await getLiveCreditMap();

    const customers = customersRaw.map(c => {
      const liveCredit = liveCreditMap[c._id.toString()] || 0;
      const effectiveCredit = Math.max(0, liveCredit - (c.creditAdjustment || 0));
      return {
        _id: c._id.toString(),
        name: c.name,
        phone: c.phone || c.whatsapp || '',
        creditOwed: effectiveCredit,
        walletBalance: c.walletBalance || 0
      };
    });

    res.render('sales/voucher', {
      bankAccounts,
      customers,
      currentPage: 'credit-sales',
      error: null
    });
  } catch (err) {
    res.status(500).send('Error: ' + err.message);
  }
});

router.post('/credit/voucher', async (req, res) => {
  try {
    const { customerId, amount, method, bankAccountId, notes } = req.body;

    if (!customerId) return res.status(400).json({ error: 'Customer select karo' });

    const payAmount = parseFloat(amount) || 0;
    if (payAmount <= 0) return res.status(400).json({ error: 'Amount valid nahi hai' });

    if (!['cash', 'bank'].includes(method)) {
      return res.status(400).json({ error: 'Payment method select karo' });
    }
    if (method === 'bank' && !bankAccountId) {
      return res.status(400).json({ error: 'Bank account select karo' });
    }

    const { effectiveCredit: creditBefore, customer } = await getEffectiveCredit(customerId);
    if (!customer) return res.status(404).json({ error: 'Customer nahi mila' });

    const appliedToCredit = Math.min(payAmount, creditBefore);
    const walletAdded     = payAmount - appliedToCredit;
    const creditAfter     = creditBefore - appliedToCredit;

    await Customer.findByIdAndUpdate(customerId, {
      $inc: {
        creditAdjustment: appliedToCredit,
        walletBalance:    walletAdded
      }
    });

    if (method === 'bank' && bankAccountId) {
      await BankAccount.findByIdAndUpdate(bankAccountId, { $inc: { balance: payAmount } });
    }

    const voucher = await CreditVoucher.create({
      customer:        customerId,
      customerName:    customer.name,
      method,
      bankAccount:     method === 'bank' ? bankAccountId : null,
      amount:          payAmount,
      creditBefore,
      creditAfter,
      appliedToCredit,
      walletAdded,
      notes:           notes || ''
    });

    try {
      const bankDoc = method === 'bank' ? await BankAccount.findById(bankAccountId) : null;
      const moneyAcc = await resolveMoneyAccount(method, bankDoc);
      const lines = [{ account: moneyAcc, debit: payAmount, credit: 0 }];
      if (appliedToCredit > 0) lines.push({ account: await accounts.receivable(), debit: 0, credit: appliedToCredit });
      if (walletAdded > 0) lines.push({ account: await accounts.advances(), debit: 0, credit: walletAdded });
      await postJournal({
        narration: `Credit Voucher — ${customer.name}`,
        refType: 'CreditVoucher',
        refId: voucher._id,
        lines
      });
    } catch (ledgerErr) {
      console.error('Ledger credit-voucher error:', ledgerErr);
    }

    res.json({
      success:         true,
      message:         'Voucher save ho gaya',
      creditBefore,
      creditAfter,
      appliedToCredit,
      walletAdded
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});


router.post('/', async (req, res) => {
  try {
    const {
      customerId,
      customerName,
      items,
      discount,
      discountType,
      tax,
      amountPaid,
      paymentMethod,
      notes,
      bankAccountId,
      salesmanId
    } = req.body;

    if (!salesmanId) {
      return res.status(400).json({ error: 'Salesman select karna zaruri hai.' });
    }
    const salesmanDoc = await Salesman.findById(salesmanId);
    if (!salesmanDoc) {
      return res.status(400).json({ error: 'Selected salesman nahi mila.' });
    }

    const parsedItems = JSON.parse(items);

    let subtotal = 0;
    let totalCost = 0;
    const saleItems = [];

    for (const item of parsedItems) {
      const product = await Product.findById(item.productId);

      if (!product) {
        return res.status(400).json({ error: `Product nahi mila: ${item.name || item.productId}` });
      }

      const quantity = parseFloat(item.quantity) || 0;

      let unitPrice = product.sellingPrice || 0;
      if (item.price && parseFloat(item.price) > 0) {
        unitPrice = parseFloat(item.price);
      }

      const grossAmount = unitPrice * quantity;
      const avgCost = product.purchasePrice || 0;

      let itemDiscountAmt = 0;
      let itemDiscountPct = 0;

      if (item.itemDiscountType === 'amount') {
        itemDiscountAmt = Math.min(parseFloat(item.itemDiscount) || 0, grossAmount);
        itemDiscountPct = grossAmount > 0 ? (itemDiscountAmt / grossAmount) * 100 : 0;
      } else {
        itemDiscountPct = Math.min(parseFloat(item.itemDiscount) || 0, 100);
        itemDiscountAmt = (grossAmount * itemDiscountPct) / 100;
      }

      const itemTotal = grossAmount - itemDiscountAmt;

      subtotal  += itemTotal;
      totalCost += avgCost * quantity;

      // ✅ Stock deduct karo (seedha tablets/units mein)
      await deductStock(product._id, quantity);

      saleItems.push({
        product:         product._id,
        productName:     product.name,
        quantity,
        unitPrice,
        cost:            avgCost,
        discountPercent: itemDiscountPct,
        discountAmount:  itemDiscountAmt,
        total:           itemTotal
      });
    }

    const discountVal  = parseFloat(discount) || 0;
    const dType        = discountType || 'percent';
    let overallDiscount = 0;
    let discountPercent = 0;

    if (dType === 'amount') {
      overallDiscount = Math.min(discountVal, subtotal);
      discountPercent = subtotal > 0 ? (overallDiscount / subtotal) * 100 : 0;
    } else {
      discountPercent = Math.min(discountVal, 100);
      overallDiscount = (subtotal * discountPercent) / 100;
    }

    const taxAmt      = parseFloat(tax) || 0;
    const totalAmount = Math.floor(subtotal - overallDiscount + taxAmt);
    let paid          = parseFloat(amountPaid) || 0;

    if (!customerId && paymentMethod !== 'credit') {
      const rawPaidCheck = parseFloat(amountPaid) || 0;
      if (rawPaidCheck !== totalAmount) {
        return res.status(400).json({
          error: `Walk-in customer ka paid amount bill se match hona chahiye! Bill: Rs. ${totalAmount}, Diya: Rs. ${rawPaidCheck}`
        });
      }
    }

    let walletUsed  = 0;
    let customerDoc = null;
    if (customerId) {
      customerDoc = await Customer.findById(customerId);
      if (customerDoc && customerDoc.walletBalance > 0) {
        walletUsed = Math.min(customerDoc.walletBalance, totalAmount);
        paid = walletUsed + parseFloat(amountPaid || 0);
      }
    }

    const rawPaid      = parseFloat(amountPaid) || 0;
    const totalPaid    = walletUsed + rawPaid;
    const changeAmount = totalPaid - totalAmount;

    const sale = new Sale({
      customer:       customerId || null,
      customerName:   customerName || 'Walk-in Customer',
      items:          saleItems,
      subtotal,
      discountPercent,
      discountAmount: overallDiscount,
      tax:            taxAmt,
      totalAmount,
      totalCost,
      amountPaid:     Math.min(totalPaid, totalAmount),
      change:         Math.max(changeAmount, 0),
      walletUsed,
      paymentMethod:  paymentMethod || 'cash',
      bankAccount:    (paymentMethod === 'bank' && bankAccountId) ? bankAccountId : null,
      status:         'completed',
      notes,
      salesman:       salesmanDoc._id,
      salesmanName:   salesmanDoc.name
    });

    await sale.save();

    let bankAccDocForLedger = null;
    if (paymentMethod === 'bank' && bankAccountId) {
      await BankAccount.findByIdAndUpdate(bankAccountId, {
        $inc: { balance: rawPaid }
      });
      bankAccDocForLedger = await BankAccount.findById(bankAccountId);
    }

    await postSaleJournal(sale, {
      rawPaid,
      walletUsed,
      paid: Math.min(totalPaid, totalAmount),
      changeAmount,
      totalCost,
      bankAccountDoc: bankAccDocForLedger
    });

    if (customerId) {
      let walletDelta = -walletUsed;
      let advanceAdded = 0;
      if (changeAmount > 0) {
        advanceAdded = changeAmount;
        walletDelta += advanceAdded;
      }

      await Customer.findByIdAndUpdate(customerId, {
        $inc: {
          totalPurchases: 1,
          totalSpent:     totalAmount,
          walletBalance:  walletDelta
        }
      });
    }

    res.json({
      success:       true,
      invoiceNumber: sale.invoiceNumber,
      saleId:        sale._id,
      walletUsed,
      advanceAdded:  changeAmount > 0 ? changeAmount : 0,
      change:        Math.max(changeAmount, 0)
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id/invoice', async (req, res) => {
  try {
    const sale = await Sale.findById(req.params.id).populate('customer');
    if (!sale) return res.status(404).send('Sale nahi mili');
const bankAccounts = await BankAccount.find({ isActive: true }).sort({ bankName: 1 });

    let previousBalance = 0;    // doosri invoices ka FULL totalAmount
    let previousPaid    = 0;    // doosri invoices pe kul paid
    let totalPaidAll    = 0;    // saari invoices (current + previous) pe kul paid

    if (sale.customer) {
      const otherSales = await Sale.find({
  customer:      sale.customer._id,
  paymentMethod: 'credit',
  status:        'pending',   // ← sirf pending wali (completed aur refunded exclude)
  _id:           { $ne: sale._id }
});

      previousBalance = otherSales.reduce((sum, s) => sum + (s.totalAmount || 0), 0);

      // Previous invoices pe kitna pay hua
      previousPaid = otherSales.reduce((sum, s) => sum + (s.amountPaid || 0), 0);
    }

    // Grand Total = Previous invoices ka total + Current invoice ka total (FIXED)
    const grandTotalOwed = previousBalance + (sale.totalAmount || 0);

    // Total paid = previous invoices ka paid + current invoice ka paid
    totalPaidAll = previousPaid + (sale.amountPaid || 0);

    // Total remaining = grandTotal - totalPaid
    const totalRemaining = Math.max(0, grandTotalOwed - totalPaidAll);

    res.render('sales/invoice', {
  sale,
  moment,
  previousBalance,
  grandTotalOwed,
  totalPaidAll,
  totalRemaining,
  bankAccounts,        // ← yeh add karo
  currentPage: 'sales'
});

  } catch (err) {
    res.status(500).send('Error');
  }
});

// =======================
// Edit Sale — GET (open new.ejs pre-filled)
// =======================
router.get('/:id/edit', async (req, res) => {
  try {
    const sale         = await Sale.findById(req.params.id).populate('customer');
    if (!sale) return res.status(404).send('Sale nahi mili');

    const customers    = await Customer.find({ isActive: true }).sort({ name: 1 });
    const bankAccounts = await BankAccount.find({ isActive: true }).sort({ bankName: 1 });
    const salesmen     = await Salesman.find({ isActive: true }).sort({ name: 1 });

    // ── Har customer ka outstanding (credit/baaki) amount calculate karo ──
    const liveCreditMap = await getLiveCreditMap();
    const custAdjDocs = await Customer.find(
      { _id: { $in: customers.map(c => c._id) } },
      'creditAdjustment'
    );
    const adjMap = {};
    custAdjDocs.forEach(c => { adjMap[c._id.toString()] = c.creditAdjustment || 0; });

    const customersWithCredit = customers.map(c => {
      const obj = c.toObject();
      const live = liveCreditMap[c._id.toString()] || 0;
      const adj  = adjMap[c._id.toString()] || 0;
      obj.creditOwed = Math.max(0, live - adj);
      return obj;
    });

    res.render('sales/new', {
      customers: customersWithCredit,
      bankAccounts,
      salesmen,
      editSale: sale,
      error: null,
      currentPage: 'new-sale'
    });
  } catch (err) {
    res.status(500).send('Error: ' + err.message);
  }
});

// =======================
// Edit Sale — POST (update existing)
// =======================
router.post('/:id/edit', async (req, res) => {
  try {
    const sale = await Sale.findById(req.params.id);
    if (!sale) return res.status(404).json({ error: 'Sale nahi mili' });

    const { customerId, items, discount, discountType, tax,
            amountPaid, paymentMethod, salesmanId, bankAccountId } = req.body;

    if (!salesmanId) return res.status(400).json({ error: 'Salesman select karna zaruri hai.' });

    const salesmanDoc = await Salesman.findById(salesmanId);
    if (!salesmanDoc) return res.status(400).json({ error: 'Salesman nahi mila.' });

    const parsedItems = JSON.parse(items);

    // ── Step 1: Purani sale ka stock WAPAS karo ──
    for (const oldItem of sale.items) {
      await restoreStock(oldItem.product, oldItem.quantity);
    }

    // ── Step 2: Customer credit reverse ──────────────────────────────
    if (sale.paymentMethod === 'credit' && sale.customer) {
      const oldRemaining = (sale.totalAmount || 0) - (sale.amountPaid || 0);
      if (oldRemaining > 0) {
        await Customer.findByIdAndUpdate(sale.customer, { $inc: { creditBalance: -oldRemaining } });
      }
    }

    if (sale.customer) {
      const oldWalletUsed   = sale.walletUsed || 0;
      const oldAdvanceAdded = sale.change || 0;
      const reverseDelta = oldWalletUsed - oldAdvanceAdded;
      if (reverseDelta !== 0) {
        await Customer.findByIdAndUpdate(sale.customer, { $inc: { walletBalance: reverseDelta } });
      }
    }

    // ── Step 3: Naye items process karo ──────────────────────────────
    let subtotal  = 0;
    let totalCost = 0;
    const saleItems = [];

    for (const item of parsedItems) {
      const product = await Product.findById(item.productId);
      if (!product) return res.status(400).json({ error: `Product nahi mila: ${item.name}` });

      const quantityRaw = parseFloat(item.quantity) || 0;

      // ── Stock check hata diya — out-of-stock sale allow hai ──────────

      let unitPrice = product.sellingPrice || 0;
      if (item.price && parseFloat(item.price) > 0) unitPrice = parseFloat(item.price);

      const grossAmount = unitPrice * quantityRaw;

      // Cost (direct from product purchase price)
      const avgCost = product.purchasePrice || 0;

      // Item discount
      let itemDiscountAmt = 0, itemDiscountPct = 0;
      if (item.itemDiscountType === 'amount') {
        itemDiscountAmt = Math.min(parseFloat(item.itemDiscount) || 0, grossAmount);
        itemDiscountPct = grossAmount > 0 ? (itemDiscountAmt / grossAmount) * 100 : 0;
      } else {
        itemDiscountPct = Math.min(parseFloat(item.itemDiscount) || 0, 100);
        itemDiscountAmt = (grossAmount * itemDiscountPct) / 100;
      }

      const itemTotal = grossAmount - itemDiscountAmt;
      subtotal  += itemTotal;
      totalCost += avgCost * quantityRaw;

      // ✅ Stock deduct karo (seedha tablets/units mein)
      await deductStock(product._id, quantityRaw);

      saleItems.push({
        product: product._id, productName: product.name,
        quantity: quantityRaw,
        unitPrice, cost: avgCost,
        discountPercent: itemDiscountPct, discountAmount: itemDiscountAmt,
        total: itemTotal
      });
    }

    // ── Step 4: Overall discount & totals ─────────────────────────────
    const discountVal = parseFloat(discount) || 0;
    const dType       = discountType || 'percent';
    let overallDiscount = 0, discountPercent = 0;
    if (dType === 'amount') {
      overallDiscount = Math.min(discountVal, subtotal);
      discountPercent = subtotal > 0 ? (overallDiscount / subtotal) * 100 : 0;
    } else {
      discountPercent = Math.min(discountVal, 100);
      overallDiscount = (subtotal * discountPercent) / 100;
    }

    const taxAmt      = parseFloat(tax) || 0;
    const totalAmount = Math.floor(subtotal - overallDiscount + taxAmt);

    // ── Wallet Balance Auto-Deduct (jaisa naya sale banate waqt hota hai) ──
    let walletUsed  = 0;
    const rawPaid   = parseFloat(amountPaid) || 0;
    if (customerId) {
      const customerDoc = await Customer.findById(customerId);
      if (customerDoc && customerDoc.walletBalance > 0) {
        walletUsed = Math.min(customerDoc.walletBalance, totalAmount);
      }
    }

    const totalPaid    = walletUsed + rawPaid;
    const changeAmount = totalPaid - totalAmount; // positive ho to advance/wallet mein jayega
    const paid          = Math.min(totalPaid, totalAmount);

    const newStatus = 'completed';

    // ── Step 5: Sale update karo ──────────────────────────────────────
    await Sale.findByIdAndUpdate(sale._id, {
      customer:       customerId || null,
      salesman:       salesmanId,
      bankAccount:    bankAccountId || null,
      paymentMethod,
      items:          saleItems,
      subtotal,
      discountPercent,
      discountAmount: overallDiscount,
      tax:            taxAmt,
      totalAmount,
      amountPaid:     paid,
      change:         Math.max(changeAmount, 0),
      walletUsed,
      cost:           totalCost,
      status:         newStatus,
      updatedAt:      new Date()
    });

    // Credit balance update
    if (paymentMethod === 'credit' && customerId) {
      const newRemaining = totalAmount - paid;
      if (newRemaining > 0) {
        await Customer.findByIdAndUpdate(customerId, { $inc: { creditBalance: newRemaining } });
      }
    }

    // ── Naya wallet effect apply karo: walletUsed minus, overpayment (advance) add ──
    if (customerId) {
      let walletDelta = -walletUsed;
      if (changeAmount > 0) {
        walletDelta += changeAmount;
      }
      if (walletDelta !== 0) {
        await Customer.findByIdAndUpdate(customerId, { $inc: { walletBalance: walletDelta } });
      }
    }

    // ── Bank account balance bhi dobara sahi karo (purana reverse, naya apply) ──
    if (sale.paymentMethod === 'bank' && sale.bankAccount) {
      await BankAccount.findByIdAndUpdate(sale.bankAccount, {
        $inc: { balance: -(sale.amountPaid || 0) }
      });
    }
    if (paymentMethod === 'bank' && bankAccountId) {
      await BankAccount.findByIdAndUpdate(bankAccountId, {
        $inc: { balance: rawPaid }
      });
    }

    // ── Ledger: purani entry reverse karo, nayi post karo ──
    try {
      await reverseJournalFor('Sale', sale._id, '(edit se pehle reverse)');
      const updatedSaleDoc = await Sale.findById(sale._id);
      let bankAccDocForLedger = null;
      if (paymentMethod === 'bank' && bankAccountId) {
        bankAccDocForLedger = await BankAccount.findById(bankAccountId);
      }
      await postSaleJournal(updatedSaleDoc, {
        rawPaid,
        walletUsed,
        paid,
        changeAmount,
        totalCost,
        bankAccountDoc: bankAccDocForLedger
      });
    } catch (ledgerErr) {
      console.error('Ledger edit-sale error:', ledgerErr);
    }

    return res.json({ success: true, saleId: sale._id });

  } catch (err) {
    console.error('Edit Sale Error:', err);
    return res.status(500).json({ error: 'Server error: ' + err.message });
  }
});

// =======================
// Return Items
// =======================
router.post('/:id/return', async (req, res) => {
  try {
    const sale = await Sale.findById(req.params.id);
    if (!sale) {
      return res.status(404).json({ error: 'Sale nahi mili' });
    }

    if (sale.status === 'refunded') {
      return res.status(400).json({ error: 'Yeh sale pehle se fully refunded hai' });
    }

    const { returnItems } = req.body;

    if (!returnItems || returnItems.length === 0) {
      return res.status(400).json({ error: 'Return karne wali items batao' });
    }

    let totalRefundNow = 0;
    let costReversal = 0;
    const newReturnedItems = [];

    const itemsTotal      = sale.items.reduce((sum, i) => sum + i.total, 0);
    const overallDiscount = sale.discountAmount || 0;
    const discountRatio   = itemsTotal > 0 ? overallDiscount / itemsTotal : 0;

    for (const ri of returnItems) {
      const saleItem = sale.items.find(
        i => i.product.toString() === ri.productId
      );

      if (!saleItem) {
        return res.status(400).json({ error: `Yeh product is sale mein nahi tha` });
      }

      const alreadyReturned = (sale.returnedItems || [])
        .filter(r => r.product.toString() === ri.productId)
        .reduce((sum, r) => sum + r.quantity, 0);

      const maxReturnable = saleItem.quantity - alreadyReturned;

      if (ri.quantity > maxReturnable) {
        return res.status(400).json({
          error: `"${saleItem.productName}" ki sirf ${maxReturnable} quantity return ho sakti hai`
        });
      }

      const itemDiscountShare  = saleItem.total * discountRatio;
      const finalItemTotal     = saleItem.total - itemDiscountShare;
      const effectiveUnitPrice = finalItemTotal / saleItem.quantity;
      const refundAmount       = effectiveUnitPrice * ri.quantity;

      totalRefundNow += refundAmount;
      costReversal += (saleItem.cost || 0) * ri.quantity;

      newReturnedItems.push({
        product:     saleItem.product,
        productName: saleItem.productName,
        quantity:    ri.quantity,
        unitPrice:   effectiveUnitPrice,
        refundAmount,
        returnedAt:  new Date()
      });

      await restoreStock(saleItem.product, ri.quantity);
    }

    sale.returnedItems = sale.returnedItems || [];
    sale.returnedItems.push(...newReturnedItems);
    sale.totalRefunded = (sale.totalRefunded || 0) + totalRefundNow;

    const newTotal = sale.totalAmount - totalRefundNow;

    const paid           = sale.amountPaid || 0;
    const refundableCash = Math.min(paid, totalRefundNow);

    if (newTotal <= 0) {
      sale.totalAmount = 0;
      sale.amountPaid  = 0;
      sale.status      = 'refunded';
    } else {
      sale.amountPaid  = paid - refundableCash;
      sale.totalAmount = newTotal;

      const remaining = sale.totalAmount - sale.amountPaid;

      if (remaining <= 0)           sale.status = 'completed';
      else if (sale.amountPaid > 0) sale.status = 'pending';
      else                          sale.status = 'pending';
    }

    await sale.save();

    // ⭐ NAYA BLOCK — bank account balance bhi refund jitna kam karo
    if (refundableCash > 0 && sale.paymentMethod === 'bank' && sale.bankAccount) {
      await BankAccount.findByIdAndUpdate(sale.bankAccount, {
        $inc: { balance: -refundableCash }
      });
    }

    // ── Ledger: revenue reverse + cash/bank refund + inventory restore ──
    try {
      const lines = [];
      lines.push({ account: await accounts.salesReturns(), debit: totalRefundNow, credit: 0 });
      const receivablePortion = totalRefundNow - refundableCash;
      if (refundableCash > 0) {
        let bankDoc = null;
        if (sale.paymentMethod === 'bank' && sale.bankAccount) {
          bankDoc = await BankAccount.findById(sale.bankAccount);
        }
        const moneyAcc = await resolveMoneyAccount(sale.paymentMethod, bankDoc);
        lines.push({ account: moneyAcc, debit: 0, credit: refundableCash });
      }
      if (receivablePortion > 0) lines.push({ account: await accounts.receivable(), debit: 0, credit: receivablePortion });

      await postJournal({
        narration: `Return against Sale ${sale.invoiceNumber}`,
        refType: 'SaleReturn',
        refId: sale._id,
        lines
      });

      if (costReversal > 0) {
        await postJournal({
          narration: `Inventory restore for return — ${sale.invoiceNumber}`,
          refType: 'SaleReturn',
          refId: sale._id,
          lines: [
            { account: await accounts.inventory(), debit: costReversal, credit: 0 },
            { account: await accounts.cogs(), debit: 0, credit: costReversal }
          ]
        });
      }
    } catch (ledgerErr) {
      console.error('Ledger sale-return error:', ledgerErr);
    }

    if (sale.customer) {
      await Customer.findByIdAndUpdate(sale.customer, {
        $inc: { totalSpent: -totalRefundNow }
      });
    }

    // ✅ Unified reporting ke liye linked return bhi SaleReturn mein record karo
    try {
      await SaleReturn.create({
        returnType: 'linked',
        originalSale: sale._id,
        originalInvoiceNumber: sale.invoiceNumber,
        customer: sale.customer || null,
        customerName: sale.customerName,
        items: newReturnedItems.map(ri => ({
          medicine: ri.product,
          medicineName: ri.productName,
          quantity: ri.quantity,
          unitPrice: ri.unitPrice,
          refundAmount: ri.refundAmount
        })),
        totalRefundAmount: totalRefundNow,
        cashRefunded: refundableCash,
        refundMode: 'adjust',
        processedBy: req.session.userName || 'Unknown'
      });
    } catch (logErr) {
      console.error('SaleReturn log error:', logErr);
    }

    res.json({
      success:        true,
      message:        `Return successful — Rs. ${totalRefundNow.toFixed(2)} refund`,
      refundAmount:   totalRefundNow,
      newTotalAmount: sale.totalAmount,
      newPaidAmount:  sale.amountPaid,
      saleStatus:     sale.status
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// =======================
// Return History
// =======================
router.get('/:id/returns', async (req, res) => {
  try {
    const sale = await Sale.findById(req.params.id);
    if (!sale) return res.status(404).json({ error: 'Sale nahi mili' });

    res.json({
      invoiceNumber: sale.invoiceNumber,
      totalRefunded: sale.totalRefunded,
      returnedItems: sale.returnedItems,
      currentStatus: sale.status
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =======================
// Receive Payment (Credit → Paid)
// =======================
router.post('/:id/payment', async (req, res) => {
  try {
    const { amount, paymentMethod: receivedMethod, bankAccountId } = req.body;
    const sale = await Sale.findById(req.params.id).populate('customer');

    if (!sale) return res.status(404).json({ error: 'Sale nahi mili' });
    if ((sale.totalAmount - sale.amountPaid) <= 0) {
      return res.status(400).json({ error: 'Is sale par koi baaki amount nahi hai' });
    }

    const payAmount = parseFloat(amount) || 0;
    if (payAmount <= 0) return res.status(400).json({ error: 'Amount valid nahi' });

    if (receivedMethod === 'bank' && !bankAccountId) {
      return res.status(400).json({ error: 'Bank account select karo' });
    }

    // ── Saari unpaid sales fetch karo (oldest first) — ab paymentMethod
    // 'cash'/'bank'/'credit' teeno shamil hain, na ke sirf 'credit' ──
    let allUnpaidSales = [];
    if (sale.customer) {
      allUnpaidSales = await Sale.find({
        customer:      sale.customer._id,
        status:        { $ne: 'refunded' }
      }).sort({ createdAt: 1 });

      allUnpaidSales = allUnpaidSales.filter(s =>
        (s.totalAmount - s.amountPaid) > 0
      );
    } else {
      allUnpaidSales = [(sale.totalAmount - sale.amountPaid) > 0 ? sale : null].filter(Boolean);
    }

    // ── Total remaining ──
    const totalRemaining = allUnpaidSales.reduce((sum, s) =>
      sum + Math.max(0, (s.totalAmount || 0) - (s.amountPaid || 0)), 0
    );

    let leftToPay = payAmount;

    for (const s of allUnpaidSales) {
      if (leftToPay <= 0) break;

      const invoiceRemaining = Math.max(0, (s.totalAmount || 0) - (s.amountPaid || 0));
      const applyToThis      = Math.min(leftToPay, invoiceRemaining);

      s.amountPaid += applyToThis;
      leftToPay    -= applyToThis;

      const newRemaining = s.totalAmount - s.amountPaid;
      s.status = newRemaining <= 0 ? 'completed' : 'pending';

      await s.save();
    }

    // ── Agar extra bacha (overpaid) toh wallet mein dalo ──
    let advanceAdded = 0;
    if (leftToPay > 0 && sale.customer) {
      advanceAdded = leftToPay;
      await Customer.findByIdAndUpdate(sale.customer._id, {
        $inc: { walletBalance: advanceAdded }
      });
    }

    const trackedAmount = Math.min(payAmount, totalRemaining); // overpay/wallet portion exclude
    if (trackedAmount > 0 && (receivedMethod === 'cash' || receivedMethod === 'bank')) {
      const creditPaymentDoc = await CreditPayment.create({
        sale:          sale._id,
        customer:      sale.customer ? sale.customer._id : null,
        customerName:  sale.customerName || (sale.customer && sale.customer.name) || 'Walk-in',
        invoiceNumber: sale.invoiceNumber,
        method:        receivedMethod,
        bankAccount:   receivedMethod === 'bank' ? bankAccountId : null,
        amount:        trackedAmount
      });

      // Bank account ka dedicated running balance bhi update karo (jaisa pehle hota tha)
      let bankDocForLedger = null;
      if (receivedMethod === 'bank' && bankAccountId) {
        await BankAccount.findByIdAndUpdate(bankAccountId, {
          $inc: { balance: trackedAmount }
        });
        bankDocForLedger = await BankAccount.findById(bankAccountId);
      }

      try {
        const moneyAcc = await resolveMoneyAccount(receivedMethod, bankDocForLedger);
        await postJournal({
          narration: `Credit Payment — ${sale.invoiceNumber}`,
          refType: 'CreditPayment',
          refId: creditPaymentDoc._id,
          lines: [
            { account: moneyAcc, debit: trackedAmount, credit: 0 },
            { account: await accounts.receivable(), debit: 0, credit: trackedAmount }
          ]
        });
      } catch (ledgerErr) {
        console.error('Ledger credit-payment error:', ledgerErr);
      }
    }

    // ── Customer totalSpent update ──
    if (sale.customer) {
      await Customer.findByIdAndUpdate(sale.customer._id, {
        $inc: { totalSpent: Math.min(payAmount, totalRemaining) }
      });
    }

    // ── Updated current sale ──
    const updatedSale = await Sale.findById(sale._id);

    res.json({
      success:      true,
      message:      'Payment receive ho gayi',
      amountPaid:   updatedSale.amountPaid,
      remaining:    Math.max(0, updatedSale.totalAmount - updatedSale.amountPaid),
      status:       updatedSale.status,
      advanceAdded: advanceAdded
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});


module.exports = router;