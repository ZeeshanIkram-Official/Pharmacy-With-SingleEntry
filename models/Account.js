const mongoose = require('mongoose');

// ─── Account: Chart of Accounts ka har ledger head ─────────────────────────
// type decide karta hai account "normal side" kya hai (asset/expense = debit,
// liability/equity/income = credit) — Trial Balance isi se Dr/Cr column
// mein sahi jagah dikhata hai.
const accountSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true, trim: true },
  name: { type: String, required: true, trim: true },

  type: {
    type: String,
    required: true,
    enum: ['asset', 'liability', 'equity', 'income', 'expense']
  },

  // Kuch accounts fixed/system-level hote hain (Cash, Sales Revenue, etc) —
  // yeh delete/rename se protect karne ke kaam aayega future mein.
  isSystem: { type: Boolean, default: false },

  // Dynamic sub-ledgers (jaise ek Account per BankAccount ya per Expense
  // category) ko unke source document se link karne ke liye.
  refType: { type: String, default: null },   // e.g. 'BankAccount', 'ExpenseCategory'
  refId: { type: mongoose.Schema.Types.ObjectId, default: null },

  isActive: { type: Boolean, default: true }

}, { timestamps: true, versionKey: false });

accountSchema.index({ refType: 1, refId: 1 });

// Debit-normal (asset, expense) vs Credit-normal (liability, equity, income)
accountSchema.virtual('normalSide').get(function () {
  return (this.type === 'asset' || this.type === 'expense') ? 'debit' : 'credit';
});

accountSchema.set('toJSON', { virtuals: true });
accountSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Account', accountSchema);
