const mongoose = require('mongoose');

// ─── CreditVoucher: jab customer apni purani credit (baaki) ke against ───────
// bina kisi specific invoice ke general payment deta hai. Yeh sirf Customer
// ka creditAdjustment / walletBalance update karta hai — Sale documents ko
// bilkul touch nahi karta.
const creditVoucherSchema = new mongoose.Schema({
  customer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Customer',
    required: true
  },
  customerName: { type: String, trim: true, default: '' },

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

  amount: { type: Number, required: true, min: 1 },

  // Snapshot — reporting/audit ke liye
  creditBefore:  { type: Number, default: 0 },
  creditAfter:   { type: Number, default: 0 },
  appliedToCredit: { type: Number, default: 0 }, // jitna credit kam hua
  walletAdded:   { type: Number, default: 0 },   // overpayment jo advance mein gaya

  notes: { type: String, trim: true, default: '' },

  createdBy: { type: String, trim: true, default: '' }

}, { timestamps: true, versionKey: false });

module.exports = mongoose.model('CreditVoucher', creditVoucherSchema);
