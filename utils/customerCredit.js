// ─── Customer Effective Credit — SHARED LOGIC ───────────────────────────
// "Effective credit" wahi number hai jo customer abhi shop ko dena hai:
//   effectiveCredit = max(0, liveCredit - creditAdjustment)
// jahan liveCredit = un sales ka jama total jo abhi tak fully paid nahi
// huin (totalAmount − amountPaid), aur creditAdjustment ek manual offset
// hai (Customer edit page se set hota hai — bina asal Sale records ko
// chhere credit ko sahi karne ke liye).
//
// YEH EK HI JAGAH SE poori app mein customer ka credit calculate hota
// hai — naya sale dropdown, credit-sales page, customer list, customer
// detail — sab yahi function use karte hain, taake number hamesha match
// kare.

const Sale = require('../models/Sale');
const Customer = require('../models/Customer');

// Ek customer ka effective credit
async function getEffectiveCredit(customerId) {
  const sales = await Sale.find(
    { customer: customerId, status: { $ne: 'refunded' } },
    'totalAmount amountPaid'
  );
  const liveCredit = sales.reduce(
    (sum, s) => sum + Math.max(0, (s.totalAmount || 0) - (s.amountPaid || 0)),
    0
  );
  const customer = await Customer.findById(customerId, 'name creditAdjustment walletBalance');
  const adjustment = customer ? (customer.creditAdjustment || 0) : 0;
  return {
    effectiveCredit: Math.max(0, liveCredit - adjustment),
    liveCredit,
    adjustment,
    customer
  };
}

// Sab customers ka liveCredit ek hi query mein (list pages ke liye —
// N+1 query se bachne ke liye). Return: { customerId: liveCredit }
async function getLiveCreditMap() {
  const agg = await Sale.aggregate([
    { $match: { customer: { $ne: null }, status: { $ne: 'refunded' } } },
    { $project: { customer: 1, outstanding: { $subtract: ['$totalAmount', '$amountPaid'] } } },
    { $match: { outstanding: { $gt: 0 } } },
    { $group: { _id: '$customer', totalOwed: { $sum: '$outstanding' } } }
  ]);
  const map = {};
  agg.forEach(c => { map[c._id.toString()] = c.totalOwed; });
  return map;
}

module.exports = { getEffectiveCredit, getLiveCreditMap };
