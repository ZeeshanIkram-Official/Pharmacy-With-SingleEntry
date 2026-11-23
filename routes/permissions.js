const express = require('express');
const router = express.Router();
const RolePermission = require('../models/RolePermission');
const User = require('../models/User');
const { isLoggedIn, isAdmin } = require('../middleware/auth');

// Sari available screens — yahan future mein add kar sakte hain
const ALL_SCREENS = [
  { key: 'dashboard',     label: 'Dashboard',      icon: '📊' },
  { key: 'new-sale',      label: 'New Sale',        icon: '🛒' },
  { key: 'sales',         label: 'Sales History',   icon: '🧾' },
  { key: 'products',      label: 'Medicines',       icon: '📦' },
  { key: 'inventory',     label: 'Inventory',       icon: '📋' },
  { key: 'customers',     label: 'Customers',       icon: '👥' },
  { key: 'suppliers',     label: 'Suppliers',       icon: '🏭' },
  { key: 'reports',       label: 'Profit Report',   icon: '📈' },
  { key: 'credit-sales',  label: 'Credit Sales',    icon: '💳' },
  { key: 'sale-returns',  label: 'Sale Returns',    icon: '↩️' },
  { key: 'expenses',      label: 'Expenses',        icon: '💸' },
  { key: 'users',         label: 'Users (Admin)',   icon: '🔑' },
];

// ─── GET: Permissions Page ───────────────────────────────────────────────────
router.get('/', isLoggedIn, isAdmin, async (req, res) => {
  try {
    // DB se sare unique roles nikalo (users table se)
    const usersRoles = await User.distinct('role');

    // RolePermission records lao
    const permDocs = await RolePermission.find();

    // Map banao: role => allowedScreens[]
    const permMap = {};
    permDocs.forEach(doc => {
      permMap[doc.role] = doc.allowedScreens;
    });

    // Admin role ko hamesha selected role banao by default
    const selectedRole = req.query.role || usersRoles[0] || 'cashier';

    // Is role ki permissions
    const currentPerms = permMap[selectedRole] || [];

    res.render('auth/permissions', {
      allScreens: ALL_SCREENS,
      roles: usersRoles,
      selectedRole,
      currentPerms,
      success: req.flash('success'),
      error: req.flash('error'),
      currentPage: 'permissions',
      currentRole: req.session.userRole
    });

  } catch (err) {
    req.flash('error', err.message);
    res.redirect('/dashboard');
  }
});


// ─── POST: Save Permissions ──────────────────────────────────────────────────
router.post('/save', isLoggedIn, isAdmin, async (req, res) => {
  try {
    const { role, screens } = req.body;

    // screens checkbox array ya single value ya undefined ho sakti hai
    let allowedScreens = [];
    if (screens) {
      allowedScreens = Array.isArray(screens) ? screens : [screens];
    }

    // Upsert — agar record nahi hai toh create karo, hai toh update karo
    await RolePermission.findOneAndUpdate(
      { role: role.toLowerCase().trim() },
      { allowedScreens },
      { upsert: true, new: true }
    );

    // Session mein bhi update karo agar current user ka role yahi hai
    if (req.session.userRole === role) {
      req.session.allowedScreens = allowedScreens;
    }

    req.flash('success', `"${role}" role ki permissions save ho gayi!`);
    res.redirect(`/permissions?role=${encodeURIComponent(role)}`);

  } catch (err) {
    req.flash('error', err.message);
    res.redirect('/permissions');
  }
});


module.exports = router;
module.exports.ALL_SCREENS = ALL_SCREENS;
