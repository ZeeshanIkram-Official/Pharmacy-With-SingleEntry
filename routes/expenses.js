const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const Expense = require('../models/Expense');
const BankAccount = require('../models/BankAccount');
const { getReceiptsUploadDir, getWritableBase } = require('../utils/dataPath');
const { postJournal, reverseJournalFor, resolveMoneyAccount, getExpenseAccount } = require('../utils/ledger');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, getReceiptsUploadDir());
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `receipt-${Date.now()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp/;
    if (allowed.test(path.extname(file.originalname).toLowerCase())) {
      cb(null, true);
    } else {
      cb(new Error('Sirf image files allowed hain (jpg, png, gif, webp)'));
    }
  }
});


const CATEGORIES = [
  { value: 'petrol',      label: '⛽ Petrol',      color: 'orange' },
  { value: 'food',        label: '🍽️ Food',         color: 'warning' },
  { value: 'services',    label: '🔧 Services',     color: 'info' },
  { value: 'rent',        label: '🏠 Rent',          color: 'pink' },
  { value: 'electricity', label: '💡 Electricity',  color: 'warning' },
  { value: 'salary',      label: '👤 Salary',        color: 'success' },
  { value: 'maintenance', label: '🛠️ Maintenance',  color: 'danger' },
  { value: 'stationery',  label: '📝 Stationery',   color: 'accent' },
  { value: 'transport',   label: '🚗 Transport',    color: 'blue' },
  { value: 'other',       label: '📌 Other',         color: 'muted' },
];


router.get('/', async (req, res) => {
  try {
    const { category, paymentMethod, from, to, search } = req.query;

    let query = {};

    if (category)       query.category = category;
    if (paymentMethod)  query.paymentMethod = paymentMethod;

    if (from || to) {
      query.date = {};
      if (from) query.date.$gte = new Date(from);
      if (to) {
        const toDate = new Date(to);
        toDate.setHours(23, 59, 59, 999);
        query.date.$lte = toDate;
      }
    }

    if (search) {
      query.description = { $regex: search, $options: 'i' };
    }

    const expenses = await Expense.find(query).sort({ date: -1 }).populate('bankAccount', 'bankName accountTitle');

    const totalResult = await Expense.aggregate([
      { $match: query },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
    const totalAmount = totalResult[0]?.total || 0;

    const categoryTotals = await Expense.aggregate([
      { $group: { _id: '$category', total: { $sum: '$amount' }, count: { $sum: 1 } } },
      { $sort: { total: -1 } }
    ]);

    res.render('expenses/index', {
      expenses,
      CATEGORIES,
      totalAmount,
      categoryTotals,
      filters: { category, paymentMethod, from, to, search },
      currentPage: 'expenses',
      success: req.flash('success'),
      error: req.flash('error')
    });

  } catch (err) {
    console.error(err);
    req.flash('error', 'Expenses load karne mein error aaya');
    res.redirect('/dashboard');
  }
});


router.get('/add', async (req, res) => {
  const bankAccounts = await BankAccount.find({ isActive: true }).sort({ bankName: 1 });
  res.render('expenses/add', {
    CATEGORIES,
    bankAccounts,
    error: null,
    currentPage: 'expenses'
  });
});


router.post('/add', upload.single('receiptImage'), async (req, res) => {
  try {
    const { category, amount, description, paymentMethod, bankAccountId, date } = req.body;

    const renderError = async (msg) => {
      const bankAccounts = await BankAccount.find({ isActive: true }).sort({ bankName: 1 });
      return res.render('expenses/add', {
        CATEGORIES,
        bankAccounts,
        error: msg,
        currentPage: 'expenses'
      });
    };

    if (!category || !amount || !date) {
      return renderError('Category, amount aur date zaruri hain');
    }

    const method = paymentMethod || 'cash';
    let bankAccDoc = null;

    if (method === 'bank') {
      if (!bankAccountId) {
        return renderError('Bank account select karo');
      }
      bankAccDoc = await BankAccount.findById(bankAccountId);
      if (!bankAccDoc) {
        return renderError('Bank account nahi mila');
      }
    }

    const expenseAmount = parseFloat(amount);

    const receiptImage = req.file
      ? `/uploads/receipts/${req.file.filename}`
      : null;

    const expenseDoc = await Expense.create({
      category,
      amount: expenseAmount,
      description: description || '',
      paymentMethod: method,
      bankAccount: method === 'bank' ? bankAccDoc._id : null,
      date: new Date(date),
      receiptImage,
      addedBy: req.session.userName || 'unknown'
    });

    if (method === 'bank') {
      await BankAccount.findByIdAndUpdate(bankAccDoc._id, {
        $inc: { balance: -expenseAmount }
      });
    }

    try {
      const expenseAcc = await getExpenseAccount(category);
      const moneyAcc = await resolveMoneyAccount(method, bankAccDoc);
      await postJournal({
        date: expenseDoc.date,
        narration: `Expense — ${category}${description ? ' — ' + description : ''}`,
        refType: 'Expense',
        refId: expenseDoc._id,
        lines: [
          { account: expenseAcc, debit: expenseAmount, credit: 0 },
          { account: moneyAcc, debit: 0, credit: expenseAmount }
        ]
      });
    } catch (ledgerErr) {
      console.error('Ledger expense error:', ledgerErr);
    }

    req.flash('success', '✅ Expense successfully add ho gaya!');
    res.redirect('/expenses');

  } catch (err) {
    console.error(err);
    const bankAccounts = await BankAccount.find({ isActive: true }).sort({ bankName: 1 });
    res.render('expenses/add', {
      CATEGORIES,
      bankAccounts,
      error: err.message,
      currentPage: 'expenses'
    });
  }
});


router.post('/delete/:id', async (req, res) => {
  try {
    const expense = await Expense.findById(req.params.id);
    if (!expense) {
      req.flash('error', 'Expense nahi mila');
      return res.redirect('/expenses');
    }

    if (expense.receiptImage) {
      const imgPath = path.join(getWritableBase(), expense.receiptImage);
      if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
    }

    if (expense.paymentMethod === 'bank' && expense.bankAccount) {
      await BankAccount.findByIdAndUpdate(expense.bankAccount, {
        $inc: { balance: expense.amount }
      });
    }

    await Expense.findByIdAndDelete(req.params.id);

    try {
      await reverseJournalFor('Expense', expense._id, '(delete se pehle reverse)');
    } catch (ledgerErr) {
      console.error('Ledger expense-delete error:', ledgerErr);
    }

    req.flash('success', '🗑️ Expense delete ho gaya');
    res.redirect('/expenses');

  } catch (err) {
    console.error(err);
    req.flash('error', 'Delete karne mein masla aaya');
    res.redirect('/expenses');
  }
});


module.exports = router;
