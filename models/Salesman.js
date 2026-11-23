const mongoose = require('mongoose');

const salesmanSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  phone: {
    type: String,
    trim: true
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, { timestamps: true, versionKey: false });

module.exports = mongoose.model('Salesman', salesmanSchema);
