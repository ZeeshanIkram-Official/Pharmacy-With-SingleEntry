const express  = require('express');
const router   = express.Router();
const Salesman = require('../models/Salesman');
const Sale     = require('../models/Sale');
const moment   = require('moment');

// =======================
// Salesmen List + Stats
// =======================
router.get('/', async (req, res) => {
  try {
    const salesmen = await Salesman.find().sort({ name: 1 });

    // Har salesman ki sales stats
    const statsRaw = await Sale.aggregate([
      {
        $group: {
          _id:          '$salesman',
          totalSales:   { $sum: 1 },
          totalAmount:  { $sum: '$totalAmount' },
          totalPaid:    { $sum: '$amountPaid' }
        }
      }
    ]);

    // Map: salesmanId => stats
    const statsMap = {};
    statsRaw.forEach(s => {
      if (s._id) statsMap[s._id.toString()] = s;
    });

    const salesmenWithStats = salesmen.map(sm => {
      const stats = statsMap[sm._id.toString()] || { totalSales: 0, totalAmount: 0, totalPaid: 0 };
      return { ...sm.toObject(), stats };
    });

    res.render('salesmen/index', {
      salesmen: salesmenWithStats,
      currentPage: 'salesmen',
      success: req.flash('success'),
      error:   req.flash('error')
    });
  } catch (err) {
    res.status(500).send('Error: ' + err.message);
  }
});


// =======================
// Add Salesman (POST)
// =======================
router.post('/', async (req, res) => {
  try {
    const { name, phone } = req.body;

    if (!name || !name.trim()) {
      req.flash('error', 'Salesman ka naam zaruri hai.');
      return res.redirect('/salesmen');
    }

    await Salesman.create({ name: name.trim(), phone: phone?.trim() || '' });
    req.flash('success', `Salesman "${name.trim()}" add ho gaya.`);
    res.redirect('/salesmen');
  } catch (err) {
    req.flash('error', 'Error: ' + err.message);
    res.redirect('/salesmen');
  }
});


// =======================
// Edit Salesman (naam/phone) — PUT
// =======================
router.put('/:id', async (req, res) => {
  try {
    const { name, phone } = req.body;
    if (!name || !name.trim()) {
      req.flash('error', 'Salesman ka naam zaruri hai.');
      return res.redirect('/salesmen');
    }
    const sm = await Salesman.findById(req.params.id);
    if (!sm) { req.flash('error', 'Salesman nahi mila.'); return res.redirect('/salesmen'); }

    sm.name = name.trim();
    sm.phone = (phone || '').trim();
    await sm.save();

    req.flash('success', `Salesman "${sm.name}" update ho gaya.`);
    res.redirect('/salesmen');
  } catch (err) {
    req.flash('error', 'Error: ' + err.message);
    res.redirect('/salesmen');
  }
});


// =======================
// Toggle Active/Inactive
// =======================
router.post('/:id/toggle', async (req, res) => {
  try {
    const sm = await Salesman.findById(req.params.id);
    if (!sm) { req.flash('error', 'Salesman nahi mila.'); return res.redirect('/salesmen'); }
    sm.isActive = !sm.isActive;
    await sm.save();
    req.flash('success', `${sm.name} ko ${sm.isActive ? 'active' : 'inactive'} kar diya.`);
    res.redirect('/salesmen');
  } catch (err) {
    req.flash('error', err.message);
    res.redirect('/salesmen');
  }
});


// =======================
// Salesman ki Sales Detail
// =======================
router.get('/:id/sales', async (req, res) => {
  try {
    const salesman = await Salesman.findById(req.params.id);
    if (!salesman) { req.flash('error', 'Salesman nahi mila.'); return res.redirect('/salesmen'); }

    const { dateFrom, dateTo } = req.query;

    let query = { salesman: req.params.id };

    // ── Date range filter ──
    if (dateFrom || dateTo) {
      query.createdAt = {};
      if (dateFrom) {
        query.createdAt.$gte = moment(dateFrom).startOf('day').toDate();
      }
      if (dateTo) {
        query.createdAt.$lte = moment(dateTo).endOf('day').toDate();
      }
    }

    let salesQuery = Sale.find(query).sort({ createdAt: -1 });
    if (!dateFrom && !dateTo) {
      salesQuery = salesQuery.limit(100);
    }

    const sales = await salesQuery;

    const totalAmount = sales.reduce((s, x) => s + x.totalAmount, 0);
    const totalPaid   = sales.reduce((s, x) => s + x.amountPaid, 0);

    res.render('salesmen/detail', {
      salesman,
      sales,
      totalAmount,
      totalPaid,
      dateFrom: dateFrom || '',
      dateTo: dateTo || '',
      currentPage: 'salesmen'
    });
  } catch (err) {
    res.status(500).send('Error: ' + err.message);
  }
});


module.exports = router;