const express = require('express');
const router = express.Router();
const Medicine = require('../models/Medicine');

const CATEGORIES = [
  'Tablet', 'Capsule', 'Syrup', 'Injection',
  'Drops', 'Cream/Ointment', 'Powder', 'Inhaler', 'Other'
];

router.get('/api/search', async (req, res) => {
  try {
    const { q = '' } = req.query;

    const medicines = await Medicine.find({
      isActive: true,
      $or: [
        { name:    { $regex: q, $options: 'i' } },
        { barcode: q }
      ]
    }).limit(10);

    res.json(medicines);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ✅ Single medicine fetch — purchase-new screen naya medicine bana ke wapis
// aane par isay use karke seedha cart mein add kar deta hai.
router.get('/api/:id', async (req, res) => {
  try {
    const medicine = await Medicine.findById(req.params.id);
    if (!medicine) return res.status(404).json({ error: 'Medicine nahi mili' });
    res.json(medicine);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/', async (req, res) => {
  try {
    const { search, category, filter } = req.query;
    let query = { isActive: true };
    if (search) query.name = { $regex: search, $options: 'i' };
    if (category) query.category = category;

    let medicines = await Medicine.find(query).sort({ name: 1 });

    const lowStock    = medicines.filter(m => m.stockBoxes <= m.minStockBoxes && m.stockBoxes > 0);
    const outOfStock  = medicines.filter(m => m.stockBoxes === 0);

    if (filter === 'lowstock')   medicines = lowStock;
    if (filter === 'outofstock') medicines = outOfStock;

    const totalValue = medicines.reduce(
      (sum, m) => sum + (m.stockBoxes * m.purchasePrice), 0
    );

    res.render('medicines/index', {
      medicines,
      categories: CATEGORIES,
      search, category, filter,
      lowStock, outOfStock,
      totalValue,
      currentPage: 'products'
    });
  } catch (err) { res.status(500).send('Error: ' + err.message); }
});

router.get('/add', (req, res) => {
  const { returnTo, prefillName } = req.query;
  res.render('medicines/add', {
    categories: CATEGORIES,
    error: null,
    currentPage: 'products',
    returnTo: returnTo || '',
    prefillName: prefillName || ''
  });
});

router.get('/inventory-report', async (req, res) => {
  try {
    const medicines = await Medicine.find({ isActive: true }).sort({ name: 1 });

    const rows = medicines.map(m => {
      const stock       = m.stockBoxes || 0;
      const costValue   = stock * (m.purchasePrice || 0);
      const sellValue   = stock * (m.sellingPrice  || 0);
      const profitValue = sellValue - costValue;
      return {
        _id:          m._id,
        name:         m.name,
        manufacturer: m.manufacturer,
        category:     m.category,
        barcode:      m.barcode,
        stock:        Number(stock.toFixed(2)),
        purchasePrice: m.purchasePrice || 0,
        sellingPrice:  m.sellingPrice  || 0,
        costValue,
        sellValue,
        profitValue
      };
    });

    const totalCostValue   = rows.reduce((sum, r) => sum + r.costValue,   0);
    const totalSellValue   = rows.reduce((sum, r) => sum + r.sellValue,   0);
    const totalProfitValue = totalSellValue - totalCostValue;
    const totalStockAll    = rows.reduce((sum, r) => sum + r.stock,       0);

    res.render('medicines/inventory-report', {
      rows,
      totalCostValue,
      totalSellValue,
      totalProfitValue,
      totalStockAll,
      currentPage: 'products'
    });
  } catch (err) { res.status(500).send('Error: ' + err.message); }
});

router.post('/', async (req, res) => {
  try {
    const {
      name, genericName, manufacturer, category, barcode, requiresPrescription,
      purchasePrice, sellingPrice,
      stockQty,
      minStockBoxes, description, returnTo
    } = req.body;

    const qty = parseFloat(stockQty) || 0;

    const medicine = await Medicine.create({
      name, genericName, manufacturer, category,
      requiresPrescription: requiresPrescription === 'on' || requiresPrescription === 'true',
      barcode:       barcode || undefined,
      purchasePrice: parseFloat(purchasePrice) || 0,
      sellingPrice:  parseFloat(sellingPrice)  || 0,
      stockBoxes:    qty,
      minStockBoxes: parseInt(minStockBoxes) || 5,
      description
    });

    // ── Agar purchase screen (ya kahin aur) se "Naya Medicine Banao" ke
    // through aaye the, to wapis usi screen par naye medicine ki id ke
    // sath bhej do — taake wahan seedha cart mein add ho sake.
    if (returnTo && returnTo.trim()) {
      const sep = returnTo.includes('?') ? '&' : '?';
      return res.redirect(`${returnTo}${sep}newProduct=${medicine._id}`);
    }

    res.redirect('/products');
  } catch (err) {
    res.render('medicines/add', {
      categories: CATEGORIES,
      error: err.message,
      currentPage: 'products',
      returnTo: req.body.returnTo || '',
      prefillName: req.body.name || ''
    });
  }
});

router.get('/:id/edit', async (req, res) => {
  try {
    const medicine = await Medicine.findById(req.params.id);

    res.render('medicines/edit', {
      product: medicine,
      categories: CATEGORIES,
      error: null,
      currentPage: 'products'
    });
  } catch (err) { res.status(500).send('Error'); }
});

router.put('/:id', async (req, res) => {
  try {
    const { name, genericName, manufacturer, category, barcode, requiresPrescription, purchasePrice, sellingPrice, minStockBoxes, description } = req.body;

    await Medicine.findByIdAndUpdate(req.params.id, {
      name, genericName, manufacturer, category,
      requiresPrescription: requiresPrescription === 'on' || requiresPrescription === 'true',
      barcode:       barcode || undefined,
      purchasePrice: parseFloat(purchasePrice) || 0,
      sellingPrice:  parseFloat(sellingPrice) || 0,
      minStockBoxes: parseInt(minStockBoxes) || 5,
      description
    });

    res.redirect('/products');
  } catch (err) { res.status(500).send('Error: ' + err.message); }
});

router.delete('/:id', async (req, res) => {
  try {
    await Medicine.findByIdAndDelete(req.params.id);
    res.redirect('/products');
  } catch (err) { res.status(500).send('Error'); }
});

// ✅ Naya stock add karna (restock — batch/expiry/box ke bina, seedha
// tablets/units mein total ke sath jama hota hai)
router.post('/:id/add-stock', async (req, res) => {
  try {
    const { quantity, purchasePrice, sellingPrice } = req.body;
    const medicine = await Medicine.findById(req.params.id);
    if (!medicine) return res.status(404).send('Medicine nahi mili');

    const qty = parseFloat(quantity) || 0;
    if (qty <= 0) return res.status(400).send('Quantity must be > 0');

    medicine.stockBoxes = (medicine.stockBoxes || 0) + qty;

    // Reference price bhi update kar do latest restock ke hisaab se
    if (purchasePrice) medicine.purchasePrice = parseFloat(purchasePrice);
    if (sellingPrice)  medicine.sellingPrice  = parseFloat(sellingPrice);

    await medicine.save();

    res.redirect('/products');
  } catch (err) { res.status(500).send('Error: ' + err.message); }
});

module.exports = router;