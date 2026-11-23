const mongoose = require('mongoose');

const expenseSchema = new mongoose.Schema({

  category: {
    type: String,
    required: true,
    enum: ['petrol', 'food', 'services', 'rent', 'electricity', 'salary', 'maintenance', 'stationery', 'transport', 'other'],
    lowercase: true,
    trim: true
  },

  amount: {
    type: Number,
    required: true,
    min: 0
  },

  description: {
    type: String,
    trim: true
  },

  paymentMethod: {
    type: String,
    enum: ['cash', 'bank'],
    default: 'cash',
    lowercase: true
  },

  // Sirf jab paymentMethod 'bank' ho — konsa bank account use hua
  bankAccount: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'BankAccount',
    default: null
  },

  date: {
    type: Date,
    required: true,
    default: Date.now
  },

  receiptImage: {
    type: String,  // file path store hoga
    default: null
  },

  addedBy: {
    type: String,  // session se username
    required: true
  }

}, {
  timestamps: true,
  versionKey: false
});

module.exports = mongoose.model('Expense', expenseSchema);
