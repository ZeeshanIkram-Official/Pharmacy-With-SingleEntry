// ─── Opening Balance Migration ──────────────────────────────────────────
// Yeh app pehle se (bina ledger ke) chal rahi thi, matlab data pehle se
// maujood hai (stock, customer credit, supplier balance, bank balances).
// Ledger system pehli baar chalte waqt ek "Opening Balance" journal
// entry post karta hai taake Trial Balance din-1 se hi sahi tasveer
// dikhaye, na ke sirf aaj ke baad ki transactions.
//
// Sirf EK BAAR chalta hai (agar OpeningBalance refType ki entry pehle se
// mojood hai to skip). Cash ka opening balance is se calculate nahi ho
// sakta (app ne kabhi track nahi kiya tha) — is liye 0 se start hota hai;
// agar Zeeshan ke paas asal cash-in-hand ka pata ho to woh Journal Voucher
// (manual entry) se add kar sakta hai.

const { Account, JournalEntry, seedChartOfAccounts, accounts, getBankLedgerAccount } = require('./ledger');
const Medicine = require('../models/Medicine');
const Sale = require('../models/Sale');
const Customer = require('../models/Customer');
const Supplier = require('../models/Supplier');
const BankAccount = require('../models/BankAccount');

async function runOpeningBalanceMigration() {
  const already = await JournalEntry.findOne({ refType: 'OpeningBalance' });
  if (already) return; // pehle se chal chuka hai

  await seedChartOfAccounts();

  const lines = [];

  // ── Inventory value (Medicine.stockBoxes * purchasePrice) ──
  const products = await Medicine.find({}, 'stockBoxes purchasePrice');
  const inventoryValue = products.reduce((sum, p) => sum + ((p.stockBoxes || 0) * (p.purchasePrice || 0)), 0);

  // ── Accounts Receivable — saari unpaid sales minus har customer ka creditAdjustment ──
  const sales = await Sale.find({ status: { $ne: 'refunded' } }, 'totalAmount amountPaid');
  const liveReceivable = sales.reduce((sum, s) => sum + Math.max(0, (s.totalAmount || 0) - (s.amountPaid || 0)), 0);
  const customers = await Customer.find({}, 'creditAdjustment walletBalance');
  const totalAdjustment = customers.reduce((sum, c) => sum + (c.creditAdjustment || 0), 0);
  const receivableValue = Math.max(0, liveReceivable - totalAdjustment);

  // ── Customer Advances (wallet balances jo customers ke paas advance pare hain) ──
  const advancesValue = customers.reduce((sum, c) => sum + Math.max(0, c.walletBalance || 0), 0);

  // ── Accounts Payable — suppliers ka balance jo unhe dena hai ──
  const suppliers = await Supplier.find({}, 'balance');
  const payableValue = suppliers.reduce((sum, s) => sum + Math.max(0, s.balance || 0), 0);

  // ── Bank accounts — jo balance already track ho raha hai, wahi opening bana do ──
  const bankAccounts = await BankAccount.find({});
  let bankTotal = 0;
  for (const b of bankAccounts) {
    const ledgerAcc = await getBankLedgerAccount(b);
    if (Math.abs(b.balance || 0) > 0.004) {
      lines.push({ account: ledgerAcc, debit: b.balance > 0 ? b.balance : 0, credit: b.balance < 0 ? -b.balance : 0 });
    }
    bankTotal += (b.balance || 0);
  }

  if (inventoryValue > 0) lines.push({ account: await accounts.inventory(), debit: inventoryValue, credit: 0 });
  if (receivableValue > 0) lines.push({ account: await accounts.receivable(), debit: receivableValue, credit: 0 });
  if (payableValue > 0) lines.push({ account: await accounts.payable(), debit: 0, credit: payableValue });
  if (advancesValue > 0) lines.push({ account: await accounts.advances(), debit: 0, credit: advancesValue });

  if (lines.length === 0) return; // koi purana data hi nahi — kuch post karne ki zarurat nahi

  // Capital = balancing plug (Dr side - existing Cr side, ya vice versa) —
  // yeh line "ab tak ka accumulated net worth" represent karti hai jo
  // pehle track nahi ho raha tha.
  const totalDebit  = lines.reduce((s, l) => s + (l.debit  || 0), 0);
  const totalCredit = lines.reduce((s, l) => s + (l.credit || 0), 0);
  const diff = totalDebit - totalCredit;
  const capitalAcc = await accounts.capital();
  if (diff > 0) {
    lines.push({ account: capitalAcc, debit: 0, credit: diff });
  } else if (diff < 0) {
    lines.push({ account: capitalAcc, debit: -diff, credit: 0 });
  }

  const entry = new JournalEntry({
    date: new Date(),
    narration: 'Opening Balance — ledger system pehli baar chalte waqt maujooda data se banaya gaya',
    refType: 'OpeningBalance',
    refId: null,
    lines: lines.map(l => ({
      account: l.account._id,
      accountCode: l.account.code,
      accountName: l.account.name,
      debit: Math.round((l.debit || 0) * 100) / 100,
      credit: Math.round((l.credit || 0) * 100) / 100
    })),
    createdBy: 'system'
  });
  await entry.save();
  console.log('✅ Opening Balance journal entry ban gayi — Trial Balance ab maujooda data reflect karega.');
}

module.exports = { runOpeningBalanceMigration };
