const mongoose = require('mongoose');

// Har role ke liye allowed screens ki list
const rolePermissionSchema = new mongoose.Schema({
  role: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true
  },
  allowedScreens: {
    type: [String],
    default: []
  }
}, { timestamps: true, versionKey: false });

module.exports = mongoose.model('RolePermission', rolePermissionSchema);
