const mongoose = require('mongoose');

// =====================================================================
// Sale Return — do tareeqon se ho sakti hai:
//   1. "linked"  → kisi maujooda Sale/invoice se juri hui
//   2. "open"    → walk-in customer, invoice nahi hai (fraud-control ke
//      liye returnType='open' rakha hai taake reports mein alag dikhe)
// =====================================================================

const returnItemSchema = new mongoose.Schema({
  medicine:    { type: mongoose.Schema.Types.ObjectId, ref: 'Medicine', required: true },
  medicineName: { type: String, required: true },
  quantity:    { type: Number, required: true, min: 1 },
  // NOTE: box ka concept hata diya gaya — ab har cheez tablet/unit mein
  // seedha wapis hoti hai. Yeh field purani entries ke liye reh gayi hai.
  uom:         { type: String, enum: ['box', 'unit'], default: 'unit' },
  unitPrice:   { type: Number, required: true },
  refundAmount: { type: Number, required: true },
  reason:      { type: String, trim: true }
}, { _id: false });

const saleReturnSchema = new mongoose.Schema({

  returnNumber: { type: String, unique: true },

  returnType: {
    type: String,
    enum: ['linked', 'open'],
    required: true
  },

  // Sirf "linked" return ke liye
  originalSale: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Sale',
    default: null
  },
  originalInvoiceNumber: { type: String, default: null },

  customer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Customer',
    default: null
  },
  customerName: { type: String, default: 'Walk-in Customer' },

  items: { type: [returnItemSchema], required: true },

  totalRefundAmount: { type: Number, required: true },

  // ✅ Linked returns mein 'refundMode' hamesha 'adjust' hota hai (invoice
  // adjust hoti hai), lekin agar sale cash/bank mein already paid thi to
  // usi amount ka kuch hissa physically customer ko wapis diya jata hai.
  // Cashflow report ke liye yehi actual "cash out" amount hai — totalRefundAmount
  // se alag ho sakta hai (jaise agar customer ne partial ya credit pe li thi)
  cashRefunded: { type: Number, default: 0 },

  refundMode: {
    type: String,
    enum: ['cash', 'wallet', 'adjust'],
    default: 'cash'
  },

  // "open" return sirf inhi roles ko allow karni hai (misuse control) —
  // is field mein woh user save hota hai jisne process kiya
  processedBy: { type: String },

  notes: { type: String }

}, { timestamps: true, versionKey: false });

// Auto Return Number
saleReturnSchema.pre('save', async function () {
  if (!this.returnNumber) {
    const count = await mongoose.model('SaleReturn').countDocuments();
    const date = new Date();
    const year = date.getFullYear().toString().slice(-2);
    const month = String(date.getMonth() + 1).padStart(2, '0');
    this.returnNumber = `RET-${year}${month}-${String(count + 1).padStart(4, '0')}`;
  }
});

module.exports = mongoose.model('SaleReturn', saleReturnSchema);