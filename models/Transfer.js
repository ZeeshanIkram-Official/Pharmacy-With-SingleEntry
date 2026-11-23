const mongoose = require('mongoose');

// ─── Transfer: internal money movement between Cash and/or Bank accounts ──────
// fromType/toType: 'cash' ya 'bank'
// fromAccount/toAccount: BankAccount _id (sirf jab type === 'bank'), warna null
const transferSchema = new mongoose.Schema({
  fromType: {
    type: String,
    enum: ['cash', 'bank'],
    required: true
  },
  fromAccount: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'BankAccount',
    default: null
  },
  fromLabel: { type: String, required: true }, // snapshot — "Cash" ya "HBL — Main Account"

  toType: {
    type: String,
    enum: ['cash', 'bank'],
    required: true
  },
  toAccount: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'BankAccount',
    default: null
  },
  toLabel: { type: String, required: true },

  amount: {
    type: Number,
    required: true,
    min: 1
  },

  note: { type: String, trim: true, default: '' }

}, { timestamps: true, versionKey: false });

module.exports = mongoose.model('Transfer', transferSchema);