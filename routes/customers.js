const express = require('express');
const router = express.Router();
const Customer = require('../models/Customer');
const Sale = require('../models/Sale');
const { getEffectiveCredit, getLiveCreditMap } = require('../utils/customerCredit');
const { postJournal, accounts, getSystemAccount } = require('../utils/ledger');

router.get('/api/search', async (req, res) => {
  try {
    const q = req.query.q || '';
    const customers = await Customer.find({
      isActive: true,
      $or: [
        { name: { $regex: q, $options: 'i' } },
        { phone: { $regex: q, $options: 'i' } }
      ]
    }).sort({ name: 1 }).limit(20);

    const liveCreditMap = await getLiveCreditMap();
    const withCredit = customers.map(c => {
      const obj = c.toObject();
      const live = liveCreditMap[c._id.toString()] || 0;
      obj.creditOwed = Math.max(0, live - (c.creditAdjustment || 0));
      return obj;
    });

    res.json(withCredit);
  } catch (err) {
    res.json([]);
  }
});

router.get('/', async (req, res) => {
  try {
    const { search } = req.query;
    let query = { isActive: true };
    if (search) query.$or = [
      { name: { $regex: search, $options: 'i' } },
      { phone: { $regex: search, $options: 'i' } }
    ];
    const customers = await Customer.find(query).sort({ name: 1 });

    // ── Har customer ka effective credit (jo abhi dena hai) ek hi query se ──
    const liveCreditMap = await getLiveCreditMap();
    const customersWithCredit = customers.map(c => {
      const obj = c.toObject();
      const live = liveCreditMap[c._id.toString()] || 0;
      obj.creditOwed = Math.max(0, live - (c.creditAdjustment || 0));
      return obj;
    });

    res.render('customers/index', {
      customers: customersWithCredit,
      search,
      currentPage: 'customers'
    });
  } catch (err) {
    res.status(500).send('Error');
  }
});

router.get('/add', (req, res) => {
  res.render('customers/add', {
    error: null,
    currentPage: 'customers'
  });
});

router.post('/', async (req, res) => {
  try {
    const customer = new Customer(req.body);
    await customer.save();
    res.redirect('/customers');
  } catch (err) {
    res.render('customers/add', {
      error: err.message,
      currentPage: 'customers'
    });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const customer = await Customer.findById(req.params.id);
    const sales = await Sale.find({ customer: req.params.id }).sort({ createdAt: -1 }).limit(20);

    const { effectiveCredit } = await getEffectiveCredit(req.params.id);

    res.render('customers/detail', {
      customer,
      sales,
      creditOwed: effectiveCredit,
      currentPage: 'customers'
    });
  } catch (err) {
    res.status(500).send('Error');
  }
});

router.get('/:id/edit', async (req, res) => {
  try {
    const customer = await Customer.findById(req.params.id);
    const { effectiveCredit } = await getEffectiveCredit(req.params.id);
    res.render('customers/edit', {
      customer,
      currentCredit: effectiveCredit,
      error: null,
      currentPage: 'customers'
    });
  } catch (err) {
    res.status(500).send('Error');
  }
});

// ── Update ──
// Naam/phone/etc normal fields ki tarah save hote hain. "credit" field
// khaas hai — woh direct database column nahi (Sale records se derive
// hota hai), is liye customer.creditAdjustment ko is tarah adjust karte
// hain ke effectiveCredit exactly wahi ban jaye jo form mein likha gaya —
// asal Sale invoices ko haath nahi lagate. "advance" seedha walletBalance
// hai, wo direct update hoti hai.
router.put('/:id', async (req, res) => {
  try {
    const customer = await Customer.findById(req.params.id);
    if (!customer) return res.status(404).send('Customer nahi mila');

    // Whitelisted normal fields
    const allowedFields = ['name', 'phone', 'whatsapp', 'address', 'email', 'notes'];
    allowedFields.forEach(f => {
      if (req.body[f] !== undefined) customer[f] = req.body[f];
    });

    // ── Credit edit: form ka "credit" value = naya effectiveCredit ──
    if (req.body.credit !== undefined && req.body.credit !== '') {
      const desiredCredit = Math.max(0, parseFloat(req.body.credit) || 0);
      const { liveCredit } = await getEffectiveCredit(customer._id);
      const oldAdjustment = customer.creditAdjustment || 0;
      const newAdjustment = liveCredit - desiredCredit; // baaki jitna Sales se bnta hai, usme se yeh minus hoga
      const delta = newAdjustment - oldAdjustment;

      customer.creditAdjustment = newAdjustment;

      // ── Ledger: is manual correction ko bhi Trial Balance mein reflect karo ──
      // delta > 0 → customer ka credit kam dikhaya gaya (write-off / maaf) → AR ghatao
      // delta < 0 → customer ka credit zyada dikhaya gaya (galti theek ki) → AR barhao
      if (Math.abs(delta) > 0.5) {
        try {
          const writeOffAcc = await getSystemAccount('5100');
          const receivableAcc = await accounts.receivable();
          const lines = delta > 0
            ? [ { account: writeOffAcc, debit: delta, credit: 0 }, { account: receivableAcc, debit: 0, credit: delta } ]
            : [ { account: receivableAcc, debit: -delta, credit: 0 }, { account: writeOffAcc, debit: 0, credit: -delta } ];
          await postJournal({
            narration: `Manual credit adjustment — ${customer.name}`,
            refType: 'CreditAdjustment',
            refId: customer._id,
            lines
          });
        } catch (ledgerErr) {
          console.error('Ledger credit-adjustment error:', ledgerErr);
        }
      }
    }

    // ── Advance edit: seedha walletBalance ──
    if (req.body.advance !== undefined && req.body.advance !== '') {
      customer.walletBalance = Math.max(0, parseFloat(req.body.advance) || 0);
    }

    await customer.save();
    res.redirect('/customers');
  } catch (err) {
    res.status(500).send('Error: ' + err.message);
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await Customer.findByIdAndUpdate(req.params.id, { isActive: false });
    res.redirect('/customers');
  } catch (err) {
    res.status(500).send('Error');
  }
});

module.exports = router;
