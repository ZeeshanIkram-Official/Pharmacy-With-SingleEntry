const mongoose = require('mongoose');

// ─── Journal Entry Line: ek account ki ek Dr ya Cr line ────────────────────
const journalLineSchema = new mongoose.Schema({
  account:     { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true },
  accountCode: { type: String, trim: true },   // snapshot — account delete/rename ho jaye tab bhi record theek rahe
  accountName: { type: String, trim: true },
  debit:       { type: Number, default: 0, min: 0 },
  credit:      { type: Number, default: 0, min: 0 }
}, { _id: false });

// ─── Journal Entry: double-entry voucher ─────────────────────────────────
// Har business transaction (sale, purchase, expense, payment, etc) yahan
// ek balanced entry (sum(debit) === sum(credit)) ke through record hoti
// hai. refType/refId se original transaction (Sale, Expense, waghera) se
// link rehta hai — taake edit/delete hone par reverse kiya ja sake.
const journalEntrySchema = new mongoose.Schema({
  voucherNo: { type: String, unique: true },

  date: { type: Date, required: true, default: Date.now },

  narration: { type: String, trim: true, default: '' },

  // Source transaction jis se yeh entry auto-generate hui (Sale, SaleReturn,
  // SupplierPurchase, SupplierPayment, CreditPayment, CreditVoucher,
  // Expense, Transfer, OpeningBalance, Manual)
  refType: { type: String, trim: true, default: 'Manual' },
  refId:   { type: mongoose.Schema.Types.ObjectId, default: null },

  lines: {
    type: [journalLineSchema],
    validate: {
      validator: function (lines) {
        return Array.isArray(lines) && lines.length >= 2;
      },
      message: 'Journal entry mein kam az kam 2 lines honi chahiye'
    }
  },

  // Reversal entries ek dusre se link rehti hain (audit trail ke liye —
  // purani entry delete nahi hoti, reverse-post hoti hai)
  isReversal: { type: Boolean, default: false },
  reversalOf: { type: mongoose.Schema.Types.ObjectId, ref: 'JournalEntry', default: null },

  createdBy: { type: String, trim: true, default: 'system' }

}, { timestamps: true, versionKey: false });

journalEntrySchema.index({ refType: 1, refId: 1 });
journalEntrySchema.index({ date: 1 });

// Auto voucher number: JV-YYMM-0001
journalEntrySchema.pre('save', async function () {
  if (!this.voucherNo) {
    const count = await mongoose.model('JournalEntry').countDocuments();
    const d = new Date();
    const year  = d.getFullYear().toString().slice(-2);
    const month = String(d.getMonth() + 1).padStart(2, '0');
    this.voucherNo = `JV-${year}${month}-${String(count + 1).padStart(4, '0')}`;
  }
});

// Sanity check — kabhi bhi unbalanced entry save na ho
journalEntrySchema.pre('save', function () {
  const totalDebit  = this.lines.reduce((s, l) => s + (l.debit  || 0), 0);
  const totalCredit = this.lines.reduce((s, l) => s + (l.credit || 0), 0);
  if (Math.abs(totalDebit - totalCredit) > 0.5) {
    throw new Error(`Journal entry balance nahi ho rahi: Dr ${totalDebit.toFixed(2)} vs Cr ${totalCredit.toFixed(2)}`);
  }
});

module.exports = mongoose.model('JournalEntry', journalEntrySchema);
