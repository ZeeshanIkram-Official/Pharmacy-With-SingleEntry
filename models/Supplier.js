const mongoose = require('mongoose');

const supplierSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },

  phone: {
    type: String,
    trim: true
  },

  whatsapp: {
    type: String,
    trim: true
  },

  email: {
    type: String,
    trim: true,
    lowercase: true
  },

  address: {
    type: String,
    trim: true
  },

  company: {
    type: String,
    trim: true
  },

  // Business tracking
  totalPurchases: {
    type: Number,
    default: 0
  },

  totalPaid: {
    type: Number,
    default: 0
  },

  balance: {
    type: Number,
    default: 0
  },

  creditLimit: {
    type: Number,
    default: 0
  },

  paymentTerms: {
    type: String,
    enum: ['cash', 'credit', 'net7', 'net15', 'net30'],
    default: 'cash'
  },

  status: {
    type: String,
    enum: ['active', 'inactive', 'blocked'],
    default: 'active'
  },

  notes: {
    type: String
  },

  // Soft delete
  isActive: {
    type: Boolean,
    default: true
  }

}, {
  timestamps: true,
  versionKey: false
});

// Index for faster search
supplierSchema.index({ name: 1, phone: 1 });

module.exports = mongoose.model('Supplier', supplierSchema);