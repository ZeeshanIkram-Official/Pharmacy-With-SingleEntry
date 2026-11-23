// ─── ONE-TIME MIGRATION SCRIPT ─────────────────────────────────────────────
// Purani suppliers jinka totalPurchases number pehle se maujood hai, unke
// liye ek "Opening Balance" SupplierPurchase entry bana deta hai — taake
// Purchase Ledger (naya FIFO system) sahi se kaam kare.
//
// Sirf EK BAAR chalana hai:
//   node migrate-supplier-purchases.js
//
// Safe hai dobara chalane ke liye bhi — jis supplier ki already koi purchase
// entry ho chuki ho, usko skip kar dega (dobara opening balance nahi banega).
// ────────────────────────────────────────────────────────────────────────────

const mongoose = require('mongoose');
const Supplier = require('./models/Supplier');
const SupplierPurchase = require('./models/SupplierPurchase');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/pharmacypos';

async function migrate() {
  await mongoose.connect(MONGODB_URI);
  console.log('MongoDB Connected —', MONGODB_URI);

  const suppliers = await Supplier.find({});
  console.log(`Total suppliers found: ${suppliers.length}`);

  let created = 0;
  let skipped = 0;

  for (const supplier of suppliers) {
    // Agar is supplier ki koi purchase entry pehle se hai to skip karo
    const existing = await SupplierPurchase.findOne({ supplier: supplier._id });
    if (existing) {
      skipped++;
      continue;
    }

    const purchases = supplier.totalPurchases || 0;
    if (purchases <= 0) {
      // Koi purani purchase hai hi nahi — kuch banane ki zaroorat nahi
      skipped++;
      continue;
    }

    const paid = Math.min(supplier.totalPaid || 0, purchases);

    await SupplierPurchase.create({
      supplier: supplier._id,
      supplierName: supplier.name,
      amount: purchases,
      amountPaid: paid,
      note: 'Opening Balance (migrated)',
      status: paid >= purchases ? 'completed' : 'pending'
    });

    created++;
    console.log(`✓ ${supplier.name} — Rs. ${purchases} (paid: Rs. ${paid})`);
  }

  console.log(`\nDone. Created: ${created}, Skipped: ${skipped}`);
  await mongoose.disconnect();
  process.exit(0);
}

migrate().catch(err => {
  console.error('Migration error:', err);
  process.exit(1);
});
