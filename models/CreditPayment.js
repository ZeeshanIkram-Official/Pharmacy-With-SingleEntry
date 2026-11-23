const mongoose = require('mongoose');

// ─── CreditPayment: jab kisi credit invoice par payment receive hoti hai ──────
// Yeh record sirf tracking ke liye hai — Cash/Bank Accounts page ki history
// aur balance mein is amount ko shamil karne ke liye. Sale.amountPaid alag se
// already update hota hai, is collection ka kaam sirf account-wise breakup hai.
const creditPaymentSchema = new mongoose.Schema({
  sale: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Sale',
    required: true
  },
  customer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Customer',
    default: null
  },
  customerName: { type: String, trim: true, default: '' },

  invoiceNumber: { type: String, trim: true, default: '' },

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
  }

}, { timestamps: true, versionKey: false });

module.exports = mongoose.model('CreditPayment', creditPaymentSchema);
