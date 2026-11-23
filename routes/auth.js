const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { isLoggedIn, isAdmin } = require('../middleware/auth');


router.use((req, res, next) => {
  res.locals.currentPage = "";
  res.locals.currentRole = req.session.userRole;
  next();
});

router.get('/login', (req, res) => {
  if (req.session.userId) return res.redirect('/dashboard');

  const { isTrialExpired } = require('../utils/dataPath');
  const expired = isTrialExpired();

  res.render('auth/login', {
    error: req.flash('error'),
    success: req.flash('success'),
    expired
  });
});


router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    const { isTrialExpired } = require('../utils/dataPath');
    if (isTrialExpired()) {
      req.flash('error', 'Trial period khatam ho gaya, contact karein.');
      return res.redirect('/login');
    }

    if (!username || !password) {
      req.flash('error', 'Username aur password zaruri hain');
      return res.redirect('/login');
    }

    const user = await User.findOne({
      username: username.toLowerCase().trim(),
      isActive: true
    });

    if (!user) {
      req.flash('error', 'Invalid credentials');
      return res.redirect('/login');
    }

    if (user.password !== password) {
      req.flash('error', 'Invalid credentials');
      return res.redirect('/login');
    }

    req.session.userId   = user._id;
    req.session.userName = user.name;
    req.session.userRole = user.role;

    return res.redirect('/dashboard');

  } catch (err) {
    req.flash('error', 'Server error');
    res.redirect('/login');
  }
});


router.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});


router.get('/users', isLoggedIn, isAdmin, async (req, res) => {
  const users = await User.find({ isActive: true }).sort({ createdAt: -1 });

  res.render('auth/users', {
    users,
    success: req.flash('success'),
    error: req.flash('error'),
    currentPage: 'users',
    currentRole: req.session.userRole
  });
});


router.post('/users', isLoggedIn, isAdmin, async (req, res) => {
  try {
    const { name, username, password, role } = req.body;

    const existing = await User.findOne({
      username: username.toLowerCase().trim()
    });

    if (existing) {
      req.flash('error', 'Username already exists');
      return res.redirect('/users');
    }

    await User.create({
      name,
      username: username.toLowerCase().trim(),
      password,
      role
    });

    req.flash('success', 'User created');
    res.redirect('/users');

  } catch (err) {
    req.flash('error', err.message);
    res.redirect('/users');
  }
});


router.post('/users/:id/delete', isLoggedIn, isAdmin, async (req, res) => {
  try {
    if (!req.session.userId) {
      req.flash('error', 'Unauthorized');
      return res.redirect('/login');
    }

    if (req.params.id === req.session.userId.toString()) {
      req.flash('error', 'You cannot delete your own account');
      return res.redirect('/users');
    }

    await User.findByIdAndDelete(req.params.id);

    req.flash('success', 'User deleted successfully');
    res.redirect('/users');

  } catch (err) {
    req.flash('error', err.message);
    res.redirect('/users');
  }
});


router.get('/users/:id/edit', isLoggedIn, async (req, res) => {
  if (
    req.session.userRole !== 'admin' &&
    req.params.id !== req.session.userId.toString()
  ) {
    req.flash('error', 'Unauthorized');
    return res.redirect('/dashboard');
  }

  const user = await User.findById(req.params.id);

  if (!user) {
    req.flash('error', 'User not found');
    return res.redirect('/dashboard');
  }

  res.render('auth/edit-user', {
    user,
    currentPage: req.session.userRole === 'admin' ? 'users' : 'profile',
    currentRole: req.session.userRole
  });
});


router.post('/users/:id/edit', isLoggedIn, async (req, res) => {
  try {
    if (
      req.session.userRole !== 'admin' &&
      req.params.id !== req.session.userId.toString()
    ) {
      req.flash('error', 'Unauthorized');
      return res.redirect('/dashboard');
    }

    const { name, username, role, password } = req.body; // ← password add kiya

    const user = await User.findById(req.params.id);

    if (!user) {
      req.flash('error', 'User not found');
      return res.redirect('/dashboard');
    }

    const existing = await User.findOne({
      username: username.toLowerCase().trim(),
      _id: { $ne: req.params.id }
    });

    if (existing) {
      req.flash('error', 'Username already taken');
      return res.redirect(`/users/${req.params.id}/edit`);
    }

    user.name     = name;
    user.username = username.toLowerCase().trim();

    if (password && password.trim() !== '') {
      user.password = password.trim();
    }

    if (req.session.userRole === 'admin') {
      user.role = role;
    }

    await user.save();

    req.flash('success', 'User updated successfully');

    if (req.session.userRole === 'admin') {
      return res.redirect('/users');
    } else {
      return res.redirect('/dashboard');
    }

  } catch (err) {
    req.flash('error', err.message);
    res.redirect(`/users/${req.params.id}/edit`);
  }
});


router.post('/change-password', isLoggedIn, async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;

    if (!newPassword || newPassword.length < 6) {
      req.flash('error', 'Password minimum 6 characters');
      return res.redirect('/users');
    }

    const user = await User.findById(req.session.userId);

    if (!user) {
      req.flash('error', 'User not found');
      return res.redirect('/login');
    }

    if (user.password !== oldPassword) {
      req.flash('error', 'Old password wrong');
      return res.redirect('/users');
    }

    user.password = newPassword;
    await user.save();

    req.flash('success', 'Password updated');
    res.redirect('/users');

  } catch (err) {
    req.flash('error', err.message);
    res.redirect('/users');
  }
});


router.get('/check-username', async (req, res) => {
  try {
    const username = (req.query.username || '').toLowerCase().trim();

    if (!username) {
      return res.json({ available: false });
    }

    const user = await User.findOne({ username }).select('_id');

    return res.json({ available: !user });

  } catch (err) {
    console.error('Username check error:', err);
    return res.json({ available: false });
  }
});


module.exports = router;