const jwt = require('jsonwebtoken');
const RolePermission = require('../models/RolePermission');

const JWT_SECRET = process.env.JWT_SECRET || 'pharmacy_jwt_secret_change_in_prod_2026';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '8h';

// ─── Token Generate Karo ─────────────────────────────────────────────────────
function generateToken(user) {
  return jwt.sign(
    {
      userId:   user._id,
      username: user.username,
      name:     user.name,
      role:     user.role
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

// ─── Bearer Token Verify Karo ────────────────────────────────────────────────
// Authorization: Bearer <token>
function verifyJWT(req, res, next) {
  const authHeader = req.headers['authorization'];

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      error:   'Authorization header missing. Format: Bearer <token>'
    });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.jwtUser = decoded; // { userId, username, name, role, iat, exp }
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, error: 'Token expire ho gaya. Dobara login karein.' });
    }
    return res.status(401).json({ success: false, error: 'Invalid token.' });
  }
}

// ─── Admin Only (JWT) ────────────────────────────────────────────────────────
function jwtAdmin(req, res, next) {
  if (req.jwtUser && req.jwtUser.role === 'admin') return next();
  return res.status(403).json({ success: false, error: 'Sirf admin yeh action kar sakta hai.' });
}

// ─── Screen Permission Check (JWT) ──────────────────────────────────────────
function jwtHasScreen(screenKey) {
  return async (req, res, next) => {
    if (req.jwtUser.role === 'admin') return next();
    try {
      const permDoc = await RolePermission.findOne({ role: req.jwtUser.role });
      if (permDoc && permDoc.allowedScreens.includes(screenKey)) return next();
      return res.status(403).json({
        success: false,
        error:   `Aapko "${screenKey}" ka access nahi hai.`
      });
    } catch (err) {
      return res.status(500).json({ success: false, error: 'Permission check failed.' });
    }
  };
}

module.exports = { generateToken, verifyJWT, jwtAdmin, jwtHasScreen, JWT_SECRET };
