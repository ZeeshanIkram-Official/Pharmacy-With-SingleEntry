const express = require('express');
const router = express.Router();
const Supplier = require('../models/Supplier');
const SupplierPayment = require('../models/SupplierPayment');
const SupplierPurchase = require('../models/SupplierPurchase');
const BankAccount = require('../models/BankAccount');
const Medicine = require('../models/Medicine');
const { postJournal, resolveMoneyAccount, accounts } = require('../utils/ledger');


// ================= GET ALL =================
router.get('/', async (req, res) => {
  try {
    const { search } = req.query;

    let query = { isActive: true };

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
        { company: { $regex: search, $options: 'i' } },
        { whatsapp: { $regex: search, $options: 'i' } }
      ];
    }

    const suppliers = await Supplier.find(query).sort({ name: 1 });

    res.render('suppliers/index', {
      suppliers,
      search: search || '',
      currentPage: 'suppliers',
      success: req.flash('success'),
      error: req.flash('error')
    });

  } catch (err) {
    console.error(err);
    req.flash('error', 'Error loading suppliers');
    res.redirect('/');
  }
});


// ================= NEW PURCHASE (multi-medicine cart form) =================
// NOTE: yeh bhi /:id se pehle honi chahiye.
router.get('/:id/purchase/new', async (req, res) => {
  try {
    const supplier = await Supplier.findById(req.params.id);
    if (!supplier) {
      req.flash('error', 'Supplier not found');
      return res.redirect('/suppliers');
    }

    // Medicine.category ke enum values he use karte hain — taake yahan
    // list hardcode/duplicate na karni pade aur medicines module se sync rahe.
    const categories = Medicine.schema.path('category').enumValues;

    res.render('suppliers/purchase-new', {
      supplier,
      categories,
      currentPage: 'suppliers'
    });

  } catch (err) {
    console.error(err);
    req.flash('error', 'Error loading purchase form');
    res.redirect('/suppliers');
  }
});


// ================= ADD FORM =================
// NOTE: yeh /:id se pehle honi chahiye, warna Express '/add' ko id samajh lega
router.get('/add', (req, res) => {
  res.render('suppliers/add', {
    error: null,
    currentPage: 'suppliers'
  });
});


// ================= ADD SUPPLIER =================
router.post('/add', async (req, res) => {
  try {
    const {
      name,
      phone,
      whatsapp,
      email,
      address,
      company,
      totalPurchases,
      totalPaid,
      creditLimit,
      paymentTerms,
      notes
    } = req.body;

    if (!name) {
      return res.render('suppliers/add', {
        error: 'Name is required',
        currentPage: 'suppliers'
      });
    }

    // ✅ EMAIL DUPLICATE CHECK
    if (email) {
      const existingSupplier = await Supplier.findOne({ email });

      if (existingSupplier) {
        return res.render('suppliers/add', {
          error: 'Supplier with this email already exists',
          currentPage: 'suppliers'
        });
      }
    }

    const purchases = Number(totalPurchases) || 0;
    const paid = Number(totalPaid) || 0;
    const balance = purchases - paid;

    const newSupplier = await Supplier.create({
      name,
      phone,
      whatsapp,
      email,
      address,
      company,
      totalPurchases: purchases,
      totalPaid: paid,
      balance,
      creditLimit: Number(creditLimit) || 0,
      paymentTerms,
      notes,
      status: 'active',
      isActive: true
    });

    // ── Agar shuru mein hi koi opening purchase amount diya gaya hai,
    // to usay bhi ek purchase-ledger entry bana do (Opening Balance) ──
    if (purchases > 0) {
      await SupplierPurchase.create({
        supplier: newSupplier._id,
        supplierName: newSupplier.name,
        amount: purchases,
        amountPaid: Math.min(paid, purchases),
        note: 'Opening Balance',
        status: paid >= purchases ? 'completed' : 'pending'
      });
    }

    req.flash('success', 'Supplier added successfully');
    res.redirect('/suppliers');

  } catch (err) {
    console.error(err);
    res.render('suppliers/add', {
      error: err.message,
      currentPage: 'suppliers'
    });
  }
});


// ================= EDIT FORM =================
router.get('/edit/:id', async (req, res) => {
  try {
    const supplier = await Supplier.findById(req.params.id);

    if (!supplier) {
      req.flash('error', 'Supplier not found');
      return res.redirect('/suppliers');
    }

    res.render('suppliers/edit', {
      supplier,
      error: null,
      currentPage: 'suppliers'
    });

  } catch (err) {
    console.error(err);
    req.flash('error', 'Error loading supplier');
    res.redirect('/suppliers');
  }
});


// ================= UPDATE SUPPLIER =================
router.post('/edit/:id', async (req, res) => {
  try {
    const {
      name,
      phone,
      whatsapp,
      email,
      address,
      company,
      creditLimit,
      paymentTerms,
      notes,
      status
    } = req.body;

    // NOTE: totalPurchases / totalPaid / balance ab yahan se manually edit
    // nahi hote — yeh ab Purchase Ledger (SupplierPurchase entries) aur
    // payments se automatically calculate hote hain. Supplier ki detail/ledger
    // page se "Add Purchase" aur "Pay Supplier" use karo.
    const updatedSupplier = await Supplier.findByIdAndUpdate(
      req.params.id,
      {
        name,
        phone,
        whatsapp,
        email,
        address,
        company,
        creditLimit: Number(creditLimit) || 0,
        paymentTerms,
        notes,
        status: status || 'active'
      },
      { new: true }
    );

    if (!updatedSupplier) {
      req.flash('error', 'Supplier not found');
      return res.redirect('/suppliers');
    }

    req.flash('success', 'Supplier updated successfully');
    res.redirect('/suppliers');

  } catch (err) {
    console.error(err);
    req.flash('error', 'Update failed');
    res.redirect('/suppliers');
  }
});


// ================= DELETE (SOFT DELETE) =================
router.get('/delete/:id', async (req, res) => {
  try {
    const supplier = await Supplier.findByIdAndUpdate(req.params.id, {
      isActive: false,
      status: 'inactive'
    });

    if (!supplier) {
      req.flash('error', 'Supplier not found');
      return res.redirect('/suppliers');
    }

    req.flash('success', 'Supplier deleted');
    res.redirect('/suppliers');

  } catch (err) {
    console.error(err);
    req.flash('error', 'Delete failed');
    res.redirect('/suppliers');
  }
});


// ================= ADD PURCHASE (naya saman liya) =================
// Har baar jab supplier se saman liya jaye, yeh ek NAYI alag entry banata
// hai — chahe pichli purchase ka payment abhi tak clear na hua ho.
router.post('/:id/purchase', async (req, res) => {
  try {
    const { items, note } = req.body;
    const supplier = await Supplier.findById(req.params.id);
    if (!supplier) return res.status(404).json({ error: 'Supplier nahi mila' });

    let parsedItems = [];
    try {
      parsedItems = typeof items === 'string' ? JSON.parse(items) : (items || []);
    } catch (e) {
      parsedItems = [];
    }

    if (!Array.isArray(parsedItems) || parsedItems.length === 0) {
      return res.status(400).json({ error: 'Kam az kam 1 medicine add karo' });
    }

    const purchaseItems = [];
    let purchaseAmount = 0;

    for (const raw of parsedItems) {
      const qty       = parseFloat(raw.quantity) || 0;
      const unitPrice = parseFloat(raw.unitPrice) || 0;
      if (qty <= 0 || !raw.medicineId) continue;

      const medicine = await Medicine.findById(raw.medicineId);
      if (!medicine) continue;

      const lineTotal = qty * unitPrice;
      purchaseAmount += lineTotal;

      purchaseItems.push({
        medicine:     medicine._id,
        medicineName: medicine.name,
        quantity:     qty,
        unitPrice,
        total:        lineTotal
      });

      // ── Stock seedha add karo aur reference price update kar do ──
      const sp = parseFloat(raw.sellingPrice);
      medicine.stockBoxes = (medicine.stockBoxes || 0) + qty;
      if (unitPrice > 0) medicine.purchasePrice = unitPrice;
      if (!isNaN(sp) && sp > 0) medicine.sellingPrice = sp;

      await medicine.save();
    }

    if (purchaseItems.length === 0) {
      return res.status(400).json({ error: 'Koi valid item nahi mila' });
    }

    const purchase = await SupplierPurchase.create({
      supplier:     supplier._id,
      supplierName: supplier.name,
      items:        purchaseItems,
      amount:       purchaseAmount,
      amountPaid:   0,
      note:         note || '',
      status:       'pending'
    });

    // ── Supplier ke overall totals/balance update karo ──
    const updatedSupplier = await Supplier.findByIdAndUpdate(
      supplier._id,
      { $inc: { totalPurchases: purchaseAmount, balance: purchaseAmount } },
      { new: true }
    );

    try {
      if (purchaseAmount > 0) {
        await postJournal({
          narration: `Purchase ${purchase.invoiceNumber} — ${supplier.name}`,
          refType: 'SupplierPurchase',
          refId: purchase._id,
          lines: [
            { account: await accounts.inventory(), debit: purchaseAmount, credit: 0 },
            { account: await accounts.payable(), debit: 0, credit: purchaseAmount }
          ]
        });
      }
    } catch (ledgerErr) {
      console.error('Ledger supplier-purchase error:', ledgerErr);
    }

    res.json({
      success:    true,
      message:    'Purchase add ho gayi, inventory restock ho gayi',
      purchaseId: purchase._id,
      redirect:   `/suppliers/purchase/${purchase._id}/invoice`,
      newBalance: updatedSupplier.balance
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});


// ================= PAY SUPPLIER =================
router.post('/:id/pay', async (req, res) => {
  try {
    const { amount, method, bankAccountId, note } = req.body;
    const supplier = await Supplier.findById(req.params.id);

    if (!supplier) return res.status(404).json({ error: 'Supplier nahi mila' });

    const payAmount = parseFloat(amount) || 0;
    if (payAmount <= 0) return res.status(400).json({ error: 'Amount valid nahi' });

    if (method !== 'cash' && method !== 'bank') {
      return res.status(400).json({ error: 'Payment method select karo' });
    }
    if (method === 'bank' && !bankAccountId) {
      return res.status(400).json({ error: 'Bank account select karo' });
    }

    let bankAccDoc = null;
    if (method === 'bank') {
      bankAccDoc = await BankAccount.findById(bankAccountId);
      if (!bankAccDoc) return res.status(404).json({ error: 'Bank account nahi mila' });
    }

    // ── Payment record banao (history ke liye) ──
    const paymentDoc = await SupplierPayment.create({
      supplier:     supplier._id,
      supplierName: supplier.name,
      method,
      bankAccount:  method === 'bank' ? bankAccDoc._id : null,
      amount:       payAmount,
      note:         note || ''
    });

    try {
      const moneyAcc = await resolveMoneyAccount(method, bankAccDoc);
      await postJournal({
        narration: `Payment to ${supplier.name}`,
        refType: 'SupplierPayment',
        refId: paymentDoc._id,
        lines: [
          { account: await accounts.payable(), debit: payAmount, credit: 0 },
          { account: moneyAcc, debit: 0, credit: payAmount }
        ]
      });
    } catch (ledgerErr) {
      console.error('Ledger supplier-payment error:', ledgerErr);
    }

    // ── FIFO: sabse purani unpaid purchase se pehle settle karo ──
    // (jaisa customer credit mein Sale/CreditPayment ke liye hota hai)
    const unpaidPurchases = (await SupplierPurchase.find({
      supplier: supplier._id,
      status: { $ne: 'completed' }
    }).sort({ createdAt: 1 })).filter(p => ((p.amount || 0) - (p.amountPaid || 0)) > 0);

    let leftToApply = payAmount;
    for (const p of unpaidPurchases) {
      if (leftToApply <= 0) break;

      const purchaseRemaining = Math.max(0, (p.amount || 0) - (p.amountPaid || 0));
      const applyToThis       = Math.min(leftToApply, purchaseRemaining);

      p.amountPaid += applyToThis;
      leftToApply  -= applyToThis;
      p.status = (p.amount - p.amountPaid) <= 0 ? 'completed' : 'pending';

      await p.save();
    }
    // Agar leftToApply > 0 bach jaye (koi purchase-record wali purani purchase
    // nahi mili — jaise migration se pehle wale suppliers), koi masla nahi:
    // supplier ka overall totalPaid/balance neeche phir bhi sahi update hoga.

    // ── Supplier ka balance/totalPaid update karo ──
    const updatedSupplier = await Supplier.findByIdAndUpdate(
      supplier._id,
      { $inc: { totalPaid: payAmount, balance: -payAmount } },
      { new: true }
    );

    // ── Cash/Bank account se paise minus karo ──
    if (method === 'bank') {
      await BankAccount.findByIdAndUpdate(bankAccDoc._id, {
        $inc: { balance: -payAmount }
      });
    }
    // Cash ke liye koi dedicated counter nahi hai — Cash ka net balance
    // Bank Accounts page par Sales + CreditPayments + Transfers + SupplierPayments
    // (yeh wala minus) se mil ke calculate hota hai. Yahan kuch extra nahi karna —
    // SupplierPayment record upar create ho chuka hai, woh kafi hai.

    res.json({
      success: true,
      message: 'Payment ho gayi',
      newBalance: updatedSupplier.balance
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});


// ================= PURCHASE INVOICE =================
// NOTE: yeh bhi '/:id' catch-all se PEHLE honi chahiye.
router.get('/purchase/:purchaseId/invoice', async (req, res) => {
  try {
    const purchase = await SupplierPurchase.findById(req.params.purchaseId).populate('supplier');
    if (!purchase) {
      req.flash('error', 'Purchase invoice not found');
      return res.redirect('/suppliers');
    }

    res.render('suppliers/purchase-invoice', {
      purchase,
      supplier: purchase.supplier,
      currentPage: 'suppliers'
    });

  } catch (err) {
    console.error(err);
    req.flash('error', 'Error loading purchase invoice');
    res.redirect('/suppliers');
  }
});


// ================= DETAIL / LEDGER =================
// NOTE: catch-all '/:id' hamesha sab specific routes ke BAAD honi chahiye
router.get('/:id', async (req, res) => {
  try {
    const supplier = await Supplier.findById(req.params.id);
    if (!supplier) {
      req.flash('error', 'Supplier not found');
      return res.redirect('/suppliers');
    }

    const payments = await SupplierPayment.find({ supplier: supplier._id })
      .sort({ createdAt: -1 })
      .populate('bankAccount', 'bankName accountTitle');

    const purchases = await SupplierPurchase.find({ supplier: supplier._id })
      .sort({ createdAt: -1 });

    const bankAccounts = await BankAccount.find({ isActive: true }).sort({ bankName: 1 });

    res.render('suppliers/detail', {
      supplier,
      payments,
      purchases,
      bankAccounts,
      currentPage: 'suppliers',
      success: req.flash('success'),
      error: req.flash('error')
    });

  } catch (err) {
    console.error(err);
    req.flash('error', 'Error loading supplier');
    res.redirect('/suppliers');
  }
});


module.exports = router;