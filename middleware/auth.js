// =====================
// Auth Middleware
// =====================

// Login check
function isLoggedIn(req, res, next) {
  if (req.session && req.session.userId) {
    return next();
  }
  req.flash('error', 'Pehle login karein.');
  return res.redirect('/login');
}

// Admin only access
function isAdmin(req, res, next) {
  if (req.session && req.session.userRole === 'admin') {
    return next();
  }
  req.flash('error', 'Yeh page sirf admin ke liye hai.');
  return res.redirect('/dashboard');
}

// ─── Screen Permission Check ─────────────────────────────────────────────────
// screenKey = sidebar key (e.g. 'dashboard', 'sales', 'products')
// Admin ko hamesha allow karo. Baqi roles ki permissions DB se check hoti hain.
function hasScreenAccess(screenKey) {
  return async (req, res, next) => {
    if (req.session && req.session.userRole === 'admin') {
      return next();
    }
    try {
      const RolePermission = require('../models/RolePermission');
      const role = req.session.userRole;
      const permDoc = await RolePermission.findOne({ role });
      if (permDoc && permDoc.allowedScreens.includes(screenKey)) {
        return next();
      }
      req.flash('error', 'Aapko is screen ka access nahi hai.');
      return res.redirect('/sales/new');
    } catch (err) {
      req.flash('error', 'Permission check mein error.');
      return res.redirect('/sales/new');
    }
  };
}

// ─── Load Allowed Screens into locals (sidebar ke liye) ──────────────────────
async function loadUserPermissions(req, res, next) {
  if (!req.session || !req.session.userId) return next();
  try {
    if (req.session.userRole === 'admin') {
      res.locals.allowedScreens = '__all__';
      return next();
    }
    const RolePermission = require('../models/RolePermission');
    const permDoc = await RolePermission.findOne({ role: req.session.userRole });
    const allowed = permDoc ? permDoc.allowedScreens : [];
    res.locals.allowedScreens = allowed;
    req.session.allowedScreens = allowed;
  } catch (err) {
    res.locals.allowedScreens = [];
  }
  next();
}

module.exports = { isLoggedIn, isAdmin, hasScreenAccess, loadUserPermissions };
