const mongoose = require('mongoose');

const medicineSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },

  genericName: {
    type: String,
    trim: true
  },

  manufacturer: {
    type: String,
    required: true,
    trim: true
  },

  category: {
    type: String,
    required: true,
    enum: [
      'Tablet', 'Capsule', 'Syrup', 'Injection',
      'Drops', 'Cream/Ointment', 'Powder', 'Inhaler', 'Other'
    ]
  },

  // ✅ Prescription ke bina bechni allow hai ya nahi
  requiresPrescription: {
    type: Boolean,
    default: false
  },

  barcode: {
    type: String,
    unique: true,
    sparse: true
  },

  // ✅ Purchase/Selling price — PER TABLET/UNIT (box ka koi concept nahi)
  purchasePrice: {
    type: Number,
    required: true,
    min: 0
  },

  sellingPrice: {
    type: Number,
    required: true,
    min: 0
  },

  // ✅ Total stock — TABLETS/PIECES mein direct (client ke paas jitni loose
  // tablets/units hain seedha wahi save hoti hain, box mein convert nahi hota)
  stockBoxes: {
    type: Number,
    required: true,
    default: 0,
    min: 0
  },

  minStockBoxes: {
    type: Number,
    default: 5
  },

  description: {
    type: String,
    trim: true
  },

  isActive: {
    type: Boolean,
    default: true
  }

}, { timestamps: true, versionKey: false });

medicineSchema.index({ name: 1, manufacturer: 1 }, { unique: true });

medicineSchema.virtual('profit').get(function () {
  return this.sellingPrice - this.purchasePrice;
});

medicineSchema.virtual('profitPercent').get(function () {
  if (this.purchasePrice === 0) return 0;
  return (((this.sellingPrice - this.purchasePrice) / this.purchasePrice) * 100).toFixed(1);
});

medicineSchema.virtual('isLowStock').get(function () {
  return this.stockBoxes <= this.minStockBoxes;
});

medicineSchema.set('toJSON', { virtuals: true });
medicineSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Medicine', medicineSchema);
