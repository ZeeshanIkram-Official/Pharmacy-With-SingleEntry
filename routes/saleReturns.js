const express = require('express');
const router = express.Router();
const SaleReturn = require('../models/SaleReturn');
const Sale = require('../models/Sale');
const Medicine = require('../models/Medicine');
const Customer = require('../models/Customer');
const moment = require('moment');
const { restoreStock } = require('../utils/stock');

// =======================
// List All Returns (linked + open)
// =======================
router.get('/', async (req, res) => {
  try {
    const { returnType, dateFrom, dateTo, search } = req.query;
    let query = {};

    if (returnType) query.returnType = returnType;
    if (search) query.$or = [
      { returnNumber: { $regex: search, $options: 'i' } },
      { originalInvoiceNumber: { $regex: search, $options: 'i' } },
      { customerName: { $regex: search, $options: 'i' } }
    ];
    if (dateFrom || dateTo) {
      query.createdAt = {};
      if (dateFrom) query.createdAt.$gte = moment(dateFrom).startOf('day').toDate();
      if (dateTo)   query.createdAt.$lte = moment(dateTo).endOf('day').toDate();
    }

    const returns = await SaleReturn.find(query).sort({ createdAt: -1 }).limit(200);
    const totalRefunded = returns.reduce((sum, r) => sum + (r.totalRefundAmount || 0), 0);
    const openCount = returns.filter(r => r.returnType === 'open').length;

    res.render('saleReturns/index', {
      returns,
      moment,
      returnType: returnType || '',
      dateFrom: dateFrom || '',
      dateTo: dateTo || '',
      search: search || '',
      totalRefunded,
      openCount,
      currentPage: 'sale-returns'
    });
  } catch (err) {
    res.status(500).send('Error: ' + err.message);
  }
});

// =======================
// New Open Return (invoice ke bina — walk-in)
// =======================
router.get('/open/new', async (req, res) => {
  try {
    const customers = await Customer.find({ isActive: true }).sort({ name: 1 });
    res.render('saleReturns/open-new', { customers, error: null, currentPage: 'sale-returns' });
  } catch (err) {
    res.status(500).send('Error: ' + err.message);
  }
});

router.post('/open', async (req, res) => {
  try {
    const { customerId, customerName, items, refundMode, notes } = req.body;
    const parsedItems = JSON.parse(items);

    if (!parsedItems || parsedItems.length === 0) {
      return res.status(400).json({ error: 'Kam az kam ek medicine add karein' });
    }

    let totalRefund = 0;
    const returnItems = [];

    for (const item of parsedItems) {
      const medicine = await Medicine.findById(item.medicineId);
      if (!medicine) {
        return res.status(400).json({ error: `Medicine nahi mili: ${item.name || item.medicineId}` });
      }

      const quantity     = parseInt(item.quantity) || 0;
      const unitPrice    = parseFloat(item.unitPrice) || medicine.sellingPrice || 0;
      if (quantity <= 0) {
        return res.status(400).json({ error: `"${medicine.name}" ki quantity valid nahi` });
      }

      const refundAmount = unitPrice * quantity;
      totalRefund += refundAmount;

      returnItems.push({
        medicine: medicine._id,
        medicineName: medicine.name,
        quantity,
        unitPrice,
        refundAmount,
        reason: item.reason || 'No invoice provided'
      });

      // ✅ Stock wapis add karo (seedha tablets/units mein)
      await restoreStock(medicine._id, quantity);
    }

    const saleReturn = new SaleReturn({
      returnType: 'open',
      customer: customerId || null,
      customerName: customerName || 'Walk-in Customer',
      items: returnItems,
      totalRefundAmount: totalRefund,
      // Sirf 'cash' mode mein physically paisa dukaan se bahar jata hai —
      // 'wallet' mein store credit hi milta hai, actual cash nahi nikalta
      cashRefunded: (refundMode === 'cash') ? totalRefund : 0,
      refundMode: refundMode || 'wallet',
      processedBy: req.session.userName || 'Unknown',
      notes: notes || 'Open return — invoice provide nahi hui'
    });

    await saleReturn.save();

    // Agar wallet mein refund jana hai aur customer registered hai
    if (refundMode === 'wallet' && customerId) {
      await Customer.findByIdAndUpdate(customerId, { $inc: { walletBalance: totalRefund } });
    }

    res.json({ success: true, returnNumber: saleReturn.returnNumber, totalRefund });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const saleReturn = await SaleReturn.findById(req.params.id).populate('customer').populate('originalSale');
    if (!saleReturn) return res.status(404).send('Return record nahi mila');
    res.render('saleReturns/detail', { saleReturn, moment, currentPage: 'sale-returns' });
  } catch (err) {
    res.status(500).send('Error: ' + err.message);
  }
});

module.exports = router;