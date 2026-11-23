const mongoose = require('mongoose');

// ─── Purchase Item: har medicine jo is purchase mein li gayi ──────────────────
const purchaseItemSchema = new mongoose.Schema({
  medicine: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Medicine'
  },
  medicineName: { type: String, trim: true, required: true },
  quantity:  { type: Number, required: true, min: 0 },   // boxes
  unitPrice: { type: Number, required: true, min: 0 },   // purchase price per tablet/unit
  total:     { type: Number, required: true, min: 0 }
}, { _id: false });

// ─── SupplierPurchase: jab supplier se saman/stock liya jata hai ──────────────
// Har purchase (order) ki alag entry — chahe pichli purchase ka payment
// clear hua ho ya na ho, nayi purchase apni alag entry banti hai.
// Payment jab bhi supplier ko di jati hai, FIFO tarteeb mein (sabse purani
// purchase pehle) yahan amountPaid update hota hai — jaisa customer credit
// (Sale + CreditPayment) mein hota hai.
const supplierPurchaseSchema = new mongoose.Schema({
  invoiceNumber: { type: String, unique: true, sparse: true },

  supplier: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Supplier',
    required: true
  },
  supplierName: { type: String, trim: true, default: '' },

  // Naye multi-medicine purchase ke items (agar purani/opening-balance entry
  // ho to yeh khali reh sakta hai — sirf amount hoga)
  items: { type: [purchaseItemSchema], default: [] },

  amount: {
    type: Number,
    required: true,
    min: 0
  },

  amountPaid: {
    type: Number,
    default: 0
  },

  note: { type: String, trim: true, default: '' },

  status: {
    type: String,
    enum: ['pending', 'completed'],
    default: 'pending'
  }

}, { timestamps: true, versionKey: false });

supplierPurchaseSchema.index({ supplier: 1, createdAt: 1 });

// ─── Auto Purchase/Invoice Number (PUR-YYMM-0001) ──────────────────────────
supplierPurchaseSchema.pre('save', async function () {
  if (!this.invoiceNumber) {
    const count = await mongoose.model('SupplierPurchase').countDocuments();
    const date = new Date();
    const year = date.getFullYear().toString().slice(-2);
    const month = String(date.getMonth() + 1).padStart(2, '0');
    this.invoiceNumber = `PUR-${year}${month}-${String(count + 1).padStart(4, '0')}`;
  }
});

module.exports = mongoose.model('SupplierPurchase', supplierPurchaseSchema);
