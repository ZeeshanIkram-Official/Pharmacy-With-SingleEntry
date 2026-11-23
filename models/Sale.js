const mongoose = require('mongoose');

// =====================
// Sale Item Schema
// =====================
// const saleItemSchema = new mongoose.Schema({
//   product: { 
//     type: mongoose.Schema.Types.ObjectId, 
//     ref: 'Product', 
//     required: true 
//   },
//   productName: { type: String, required: true },
//   quantity: { type: Number, required: true, min: 1 },
//   unitPrice: { type: Number, required: true },
//   cost: { type: Number, required: true },
//   discountPercent: { type: Number, default: 0 },
//   discountAmount: { type: Number, default: 0 },
//   total: { type: Number, required: true }
// }, { _id: false });

// Ab (updated):
const saleItemSchema = new mongoose.Schema({
  product: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Medicine', 
    required: true 
  },
  productName: { type: String, required: true },
  quantity: { type: Number, required: true, min: 1 },
  // NOTE: box ka concept hata diya gaya — ab har cheez tablet/unit mein
  // seedha store/sell hoti hai. Yeh field purani sales ke liye reh gayi hai.
  uom: { type: String, enum: ['box', 'unit'], default: 'unit' },

  unitPrice: { type: Number, required: true },
  cost: { type: Number, required: true },
  discountPercent: { type: Number, default: 0 },
  discountAmount: { type: Number, default: 0 },
  total: { type: Number, required: true }
}, { _id: false });


// =====================
// Return Item Schema
// =====================
const returnItemSchema = new mongoose.Schema({
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Medicine', required: true },
  productName: { type: String, required: true },
  quantity: { type: Number, required: true, min: 1 },
  unitPrice: { type: Number, required: true },
  refundAmount: { type: Number, required: true },
  returnedAt: { type: Date, default: Date.now }
}, { _id: false });


// =====================
// Main Sale Schema
// =====================
const saleSchema = new mongoose.Schema({

  invoiceNumber: { type: String, unique: true },

  customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer' },

  customerName: { type: String, default: 'Walk-in Customer' },

  items: [saleItemSchema],

  returnedItems: { type: [returnItemSchema], default: [] },

  totalRefunded: { type: Number, default: 0 },

  subtotal: { type: Number, required: true },

  discountPercent: { type: Number, default: 0 },
  discountAmount: { type: Number, default: 0 },

  tax: { type: Number, default: 0 },

  totalAmount: { type: Number, required: true },

  totalCost: { type: Number, default: 0 },

  amountPaid: { type: Number, required: true },

  change: { type: Number, default: 0 },

  // Customer ka wallet/advance balance jo is sale ke waqt use hua tha
  // (edit karte waqt exact reverse karne ke liye zaroori hai)
  walletUsed: { type: Number, default: 0 },

  paymentMethod: { 
    type: String, 
    enum: ['cash', 'credit', 'bank'], 
    default: 'cash',
    lowercase: true,
    trim: true
  },

  bankAccount: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'BankAccount',
    default: null
  },
  bankAccountName: { type: String, default: null },

  status: { 
    type: String, 
    enum: ['completed', 'pending', 'refunded'], 
    default: 'completed' 
  },

  notes: { type: String },

  // Salesman reference
  salesman: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Salesman',
    required: true
  },
  salesmanName: {
    type: String,
    required: true
  }

}, { 
  timestamps: true, 
  versionKey: false 
});


// =====================
// Pre-save Hooks (Fixed)
// =====================

// 1. Auto Invoice Number (Async)
saleSchema.pre('save', async function () {
  if (!this.invoiceNumber) {
    const count = await mongoose.model('Sale').countDocuments();
    const date = new Date();
    const year = date.getFullYear().toString().slice(-2);
    const month = String(date.getMonth() + 1).padStart(2, '0');
    this.invoiceNumber = `INV-${year}${month}-${String(count + 1).padStart(4, '0')}`;
  }
});

// 2. Payment & Status Logic (Sync - No next needed)
saleSchema.pre('save', function () {
  // Ensure paymentMethod is lowercase
  if (this.paymentMethod) {
    this.paymentMethod = this.paymentMethod.toLowerCase().trim();
  }

  // Auto status logic
  if (this.paymentMethod === 'credit') {
    const remaining = (this.totalAmount || 0) - (this.amountPaid || 0);
    if (remaining <= 0) {
      this.status = 'completed';
    } else if (this.amountPaid > 0) {
      this.status = 'pending';
    } else {
      this.status = 'pending';
    }
  } else {
    // Cash, Card, Online
    this.status = 'completed';
  }
});


// =====================
// Virtuals
// =====================
saleSchema.virtual('profit').get(function () {
  return this.totalAmount - this.totalCost;
});

saleSchema.virtual('netRevenue').get(function () {
  return this.totalAmount;
});

saleSchema.set('toJSON', { virtuals: true });
saleSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Sale', saleSchema);