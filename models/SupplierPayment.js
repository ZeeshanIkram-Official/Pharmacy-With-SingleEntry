const mongoose = require('mongoose');

// ─── SupplierPayment: jab supplier ko payment di jati hai ─────────────────────
// Har payment ka record — date-wise history dekhne ke liye.
// Saath hi Cash/Bank account se balance minus karne ke liye method/bankAccount
// track hota hai.
const supplierPaymentSchema = new mongoose.Schema({
  supplier: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Supplier',
    required: true
  },
  supplierName: { type: String, trim: true, default: '' },

  // 'cash' ya 'bank'
  method: {
    type: String,
    enum: ['cash', 'bank'],
    required: true
  },
  bankAccount: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'BankAccount',
    default: null
  },

  amount: {
    type: Number,
    required: true,
    min: 1
  },

  note: { type: String, trim: true, default: '' }

}, { timestamps: true, versionKey: false });

module.exports = mongoose.model('SupplierPayment', supplierPaymentSchema);
