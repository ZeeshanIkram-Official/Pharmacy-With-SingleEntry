const express = require('express');
const router = express.Router();
const Product = require('../models/Medicine'); // naam Product hi rakha, model Medicine hai
const Sale = require('../models/Sale');
const Customer = require('../models/Customer');
const SaleReturn = require('../models/SaleReturn');
const moment = require('moment');

router.get('/', async (req, res) => {
  try {
    const today = moment().startOf('day');
    const thisMonth = moment().startOf('month');

    const todaySales = await Sale.find({
      createdAt: { $gte: today.toDate() },
      status: { $in: ['completed', 'pending'] }
    });

    const todayRevenue = todaySales.reduce((sum, s) => {
      const paid = parseFloat(s.amountPaid) || 0;
      const finalTotalAfterReturns = parseFloat(s.totalAmount) || 0;

      return sum + Math.min(paid, finalTotalAfterReturns);
    }, 0);

    const todayCost = todaySales.reduce((sum, s) => {
      return sum + (parseFloat(s.totalCost) || 0);
    }, 0);

    // ✅ "Open" returns (bina invoice) ka cash refund kisi Sale document se
    // link nahi hota, is liye upar wala revenue calc isay kabhi minus nahi
    // karta — yahan alag se nikal ke revenue se ghata rahe hain
    const todayOpenRefunds = await SaleReturn.find({
      returnType: 'open',
      cashRefunded: { $gt: 0 },
      createdAt: { $gte: today.toDate() }
    });
    const todayCashRefunded = todayOpenRefunds.reduce((sum, r) => sum + (r.cashRefunded || 0), 0);

    const todayRevenueAfterRefunds = todayRevenue - todayCashRefunded;
    const todayProfit = todayRevenueAfterRefunds - todayCost;

    const monthSales = await Sale.find({
      createdAt: { $gte: thisMonth.toDate() },
      status: { $in: ['completed', 'pending'] }
    });

    const monthRevenue = monthSales.reduce((sum, s) => {
      const paid = parseFloat(s.amountPaid) || 0;
      const finalTotalAfterReturns = parseFloat(s.totalAmount) || 0;

      return sum + Math.min(paid, finalTotalAfterReturns);
    }, 0);

    const monthCost = monthSales.reduce((sum, s) => {
      return sum + (parseFloat(s.totalCost) || 0);
    }, 0);

    const monthOpenRefunds = await SaleReturn.find({
      returnType: 'open',
      cashRefunded: { $gt: 0 },
      createdAt: { $gte: thisMonth.toDate() }
    });
    const monthCashRefunded = monthOpenRefunds.reduce((sum, r) => sum + (r.cashRefunded || 0), 0);

    const monthRevenueAfterRefunds = monthRevenue - monthCashRefunded;
    const monthProfit = monthRevenueAfterRefunds - monthCost;

    const totalProducts = await Product.countDocuments({ isActive: true });
    const totalCustomers = await Customer.countDocuments({ isActive: true });

    const lowStockProducts = await Product.find({
      $expr: { $lte: ['$stockBoxes', '$minStockBoxes'] },
      isActive: true
    });

    const recentSales = await Sale.find()
      .sort({ createdAt: -1 })
      .limit(8);

    const topProducts = await Sale.aggregate([
      {
        $match: {
          createdAt: { $gte: thisMonth.toDate() },
          status: { $in: ['completed', 'pending'] }
        }
      },
      { $unwind: '$items' },
      {
        $group: {
          _id: '$items.productName',
          totalQty: { $sum: '$items.quantity' },
          totalRevenue: { $sum: '$items.total' }
        }
      },
      { $sort: { totalQty: -1 } },
      { $limit: 5 }
    ]);

    res.render('dashboard', {
      todayRevenue: todayRevenueAfterRefunds,
      todayCost,
      todayProfit,
      todaySalesCount: todaySales.length,
      monthRevenue: monthRevenueAfterRefunds,
      monthCost,
      monthProfit,
      monthSalesCount: monthSales.length,
      totalProducts,
      totalCustomers,
      lowStockProducts,
      recentSales,
      topProducts,
      moment,
      currentPage: 'dashboard'
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  }
});

module.exports = router;