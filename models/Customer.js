const mongoose = require('mongoose');

const customerSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  phone: { type: String, trim: true },
  whatsapp: { type: String, trim: true },
  address: { type: String, trim: true },
  totalPurchases: { type: Number, default: 0 },
  totalSpent: { type: Number, default: 0 },
  balance: { type: Number, default: 0 }, // negative = owes money (credit)
  walletBalance: { type: Number, default: 0 }, // positive = advance/extra payment jo customer ne diya

  // Voucher se receive hui payments ka running total, jo invoices ko touch
  // kiye baghair live (Sale-based) credit outstanding ke against offset hoti
  // hai. Har jagah jahan customer ka "credit owed" dikhaya jata hai, wahan
  // effectiveCredit = max(0, liveSaleBasedCredit - creditAdjustment) use karo.
  creditAdjustment: { type: Number, default: 0 },
  notes: { type: String },
  isActive: { type: Boolean, default: true }
}, { timestamps: true, versionKey: false });

module.exports = mongoose.model('Customer', customerSchema);
