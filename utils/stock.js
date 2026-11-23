// =====================================================================
// Stock Helper — simple total-stock deduct/restore (no batch/expiry
// tracking). Ek hi medicine ke stock mein alag-alag purchases se aaye
// boxes mix ho jate hain, isliye expiry-wise nahi, seedha total
// stockBoxes ke hisaab se kaam karte hain. sales.js aur returns dono
// isay use karte hain.
// =====================================================================

const Medicine = require('../models/Medicine');

/**
 * Medicine ke total stock mein se `quantityBoxes` deduct karta hai.
 * Agar available stock se zyada quantity nikali jaye (out-of-stock
 * sale is system mein allowed hai) to stock 0 par floor ho jata hai.
 */
async function deductStock(medicineId, quantityBoxes) {
  const medicine = await Medicine.findById(medicineId);
  if (!medicine) throw new Error('Medicine nahi mili');

  medicine.stockBoxes = Math.max(0, (medicine.stockBoxes || 0) - quantityBoxes);
  await medicine.save();
}

/**
 * Pehle deduct kiya gaya stock wapis add karta hai (edit/return ke waqt).
 */
async function restoreStock(medicineId, quantityBoxes) {
  const medicine = await Medicine.findById(medicineId);
  if (!medicine) return;

  medicine.stockBoxes = (medicine.stockBoxes || 0) + quantityBoxes;
  await medicine.save();
}

module.exports = { deductStock, restoreStock };
