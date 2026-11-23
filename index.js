// ─── pkg .exe build ke liye zaroori fix ───────────────────────────────────
// 'pkg' se bani .exe ke andar Node.js ka built-in 'crypto' module global
// scope mein automatically available nahi hota (jabke normal 'node index.js'
// mein hota hai). MongoDB driver (mongoose) internally crypto.randomUUID()
// jaisi cheezein use karta hai sessions ke liye — agar yeh missing ho to
// koi bhi database query (jaise login) crash kar jaati hai. Yeh fix isay
// dono mode (dev aur .exe) mein sahi kaam karne deta hai.
const crypto = require('crypto');
if (!global.crypto) {
  global.crypto = crypto;
}

const express = require('express');
const mongoose = require('mongoose');
const methodOverride = require('method-override');
const path = require('path');
const session = require('express-session');
const flash = require('connect-flash');

const app = express();
const PORT = process.env.PORT || 8000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/pharmacypos';

// ================= DATABASE =================
mongoose.connect(MONGODB_URI)
  .then(async () => {
    console.log('MongoDB Connected Successfully');

    const User = require('./models/User');
    const adminExists = await User.findOne({ username: 'admin' });
    if (!adminExists) {
      await User.create({
        name: 'Admin',
        username: 'admin',
        password: 'admin123',
        role: 'admin'
      });
      console.log('✅ Default admin user ban gaya. Username: admin | Password: admin123');
    }

    // ── Accounting Ledger: Chart of Accounts seed + opening balance (sirf ek baar) ──
    try {
      const { seedChartOfAccounts } = require('./utils/ledger');
      const { runOpeningBalanceMigration } = require('./utils/openingBalanceMigration');
      await seedChartOfAccounts();
      await runOpeningBalanceMigration();
    } catch (ledgerErr) {
      console.error('Ledger seed/opening-balance error:', ledgerErr);
    }
  })
  .catch(err => console.log('MongoDB Connection Error:', err));

// ================= MIDDLEWARE =================
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.static(path.join(__dirname, 'public')));

const { getWritableBase } = require('./utils/dataPath');
app.use('/uploads', express.static(path.join(getWritableBase(), 'uploads')));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(methodOverride('_method'));

// ================= SESSION & FLASH =================
app.use(session({
  secret: 'pharmacy_pos_secret_key_2026',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 8 * 60 * 60 * 1000 }
}));

app.use(flash());

const { isTrialExpired } = require('./utils/dataPath');

app.use((req, res, next) => {
  const allowedPaths = ['/login', '/logout'];
  if (allowedPaths.includes(req.path)) return next();

  if (isTrialExpired()) {
    req.flash('error', 'Trial period khatam ho gaya, contact karein.');
   
    if (req.session && req.session.userId) {
      req.session.userId = null;
      req.session.userRole = null;
      req.session.userName = null;
    }
    return res.redirect('/login');
  }
  next();
});

// ================= GLOBAL LOCALS =================
app.use((req, res, next) => {
  res.locals.success      = req.flash('success');
  res.locals.error        = req.flash('error');
  res.locals.currentUser  = req.session.userName  || null;
  res.locals.currentRole  = req.session.userRole  || null;
  res.locals.currentUserId = req.session.userId   || null; // ← naya
  next();
});

// ================= AUTH MIDDLEWARE =================
const { isLoggedIn, isAdmin, hasScreenAccess, loadUserPermissions } = require('./middleware/auth');

app.use(loadUserPermissions);

// ================= ROUTES =================
app.use('/',            require('./routes/auth'));
app.use('/dashboard',   isLoggedIn, hasScreenAccess('dashboard'),   require('./routes/dashboard'));
app.use('/products',    isLoggedIn, hasScreenAccess('products'),    require('./routes/medicines'));
app.use('/sales',       isLoggedIn,                                 require('./routes/sales'));
app.use('/customers',   isLoggedIn, hasScreenAccess('customers'),   require('./routes/customers'));

app.use('/reports',     isLoggedIn, hasScreenAccess('reports'),     require('./routes/report'));
app.use('/suppliers',   isLoggedIn, hasScreenAccess('suppliers'),   require('./routes/suppliers'));
app.use('/permissions', isLoggedIn,                                 require('./routes/permissions'));
app.use('/expenses',    isLoggedIn,                                 require('./routes/expenses'));
app.use('/bank-accounts', isLoggedIn,                                require('./routes/bankAccounts'));
app.use('/salesmen',    isLoggedIn,                                  require('./routes/salesmen'));
app.use('/sale-returns', isLoggedIn, hasScreenAccess('sale-returns'), require('./routes/saleReturns'));
app.use('/backup',      isLoggedIn, isAdmin,                          require('./routes/backup'));

// ================= HOME REDIRECT =================
app.get('/', (req, res) => {
  if (req.session.userId) return res.redirect('/dashboard');
  res.redirect('/login');
});

// ================= 404 =================
app.use((req, res) => {
  res.status(404).render('404');
});

// ================= SERVER =================
const server = app.listen(PORT, () => {
  console.log(`Pharmacy POS running at http://localhost:${PORT}`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    // Yeh normal hai agar app pehle se Startup se chal rahi thi — server
    // already chal raha hai, koi crash nahi, sirf gracefully band ho jao.
    console.log(`Port ${PORT} pehle se use ho raha hai — shayad app pehle se chal rahi hai. Browser mein http://localhost:${PORT} kholein.`);
    process.exit(0);
  } else {
    console.error('Server error:', err);
    process.exit(1);
  }
});