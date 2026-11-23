// ─── Ledger Service ─────────────────────────────────────────────────────
// Poore accounting module (Chart of Accounts + Journal Entries + Trial
// Balance) ka core. Har route se yeh functions call hote hain — koi bhi
// route seedha Account/JournalEntry models ko directly nahi chhedta.
//
// IMPORTANT: Har posting function try/catch mein wrap ho ke use honi
// chahiye jahan call ho rahi ho, taake agar ledger mein koi masla aaye
// (jaise validation fail) to woh asli POS operation (sale/purchase/etc)
// ko crash na kare — sirf console mein log ho.

const mongoose = require('mongoose');
const Account = require('../models/Account');
const JournalEntry = require('../models/JournalEntry');

// =====================================================================
// FIXED SYSTEM ACCOUNTS — inke codes fixed hain, poore app mein inhi
// codes se refer kiya jayega.
// =====================================================================
const SYSTEM_ACCOUNTS = [
  { code: '1000', name: 'Cash in Hand',              type: 'asset' },
  { code: '1100', name: 'Accounts Receivable (Customers)', type: 'asset' },
  { code: '1200', name: 'Inventory',                 type: 'asset' },
  { code: '2000', name: 'Accounts Payable (Suppliers)', type: 'liability' },
  { code: '2100', name: 'Customer Advances / Wallet', type: 'liability' },
  { code: '3000', name: "Owner's Capital",           type: 'equity' },
  { code: '4000', name: 'Sales Revenue',             type: 'income' },
  { code: '4100', name: 'Sales Returns & Allowances', type: 'income' },
  { code: '5000', name: 'Cost of Goods Sold',        type: 'expense' },
  { code: '5100', name: 'Credit Adjustments / Write-offs', type: 'expense' },
];

// Expense.category enum se milte-julte expense ledger accounts
const EXPENSE_CATEGORY_ACCOUNTS = {
  petrol:      { code: '6010', name: 'Petrol Expense' },
  food:        { code: '6020', name: 'Food Expense' },
  services:    { code: '6030', name: 'Services Expense' },
  rent:        { code: '6040', name: 'Rent Expense' },
  electricity: { code: '6050', name: 'Electricity Expense' },
  salary:      { code: '6060', name: 'Salary Expense' },
  maintenance: { code: '6070', name: 'Maintenance Expense' },
  stationery:  { code: '6080', name: 'Stationery Expense' },
  transport:   { code: '6090', name: 'Transport Expense' },
  other:       { code: '6100', name: 'Other Expense' }
};

let seeded = false;

// ─── Chart of Accounts seed karo (idempotent — dobara call karna safe hai) ──
async function seedChartOfAccounts() {
  for (const acc of SYSTEM_ACCOUNTS) {
    await Account.findOneAndUpdate(
      { code: acc.code },
      { $setOnInsert: { ...acc, isSystem: true } },
      { upsert: true }
    );
  }
  for (const key of Object.keys(EXPENSE_CATEGORY_ACCOUNTS)) {
    const acc = EXPENSE_CATEGORY_ACCOUNTS[key];
    await Account.findOneAndUpdate(
      { code: acc.code },
      { $setOnInsert: { code: acc.code, name: acc.name, type: 'expense', isSystem: true, refType: 'ExpenseCategory', refId: null } },
      { upsert: true }
    );
  }
  seeded = true;
}

async function getSystemAccount(code) {
  if (!seeded) await seedChartOfAccounts();
  const acc = await Account.findOne({ code });
  if (!acc) throw new Error(`System account ${code} nahi mila — seed nahi hua shayad`);
  return acc;
}

const A = {
  cash:          () => getSystemAccount('1000'),
  receivable:    () => getSystemAccount('1100'),
  inventory:     () => getSystemAccount('1200'),
  payable:       () => getSystemAccount('2000'),
  advances:      () => getSystemAccount('2100'),
  capital:       () => getSystemAccount('3000'),
  salesRevenue:  () => getSystemAccount('4000'),
  salesReturns:  () => getSystemAccount('4100'),
  cogs:          () => getSystemAccount('5000')
};

// ─── Kisi BankAccount ke liye uska dedicated ledger account laao (na ho to bana do) ──
async function getBankLedgerAccount(bankAccountDoc) {
  let acc = await Account.findOne({ refType: 'BankAccount', refId: bankAccountDoc._id });
  if (!acc) {
    // 1500 range reserve hai bank accounts ke liye
    const count = await Account.countDocuments({ refType: 'BankAccount' });
    acc = await Account.create({
      code: `15${String(count + 1).padStart(2, '0')}`,
      name: `Bank — ${bankAccountDoc.bankName} (${bankAccountDoc.accountTitle})`,
      type: 'asset',
      isSystem: false,
      refType: 'BankAccount',
      refId: bankAccountDoc._id
    });
  }
  return acc;
}

// ─── Expense category ke liye ledger account ──
async function getExpenseAccount(category) {
  const meta = EXPENSE_CATEGORY_ACCOUNTS[(category || 'other').toLowerCase()] || EXPENSE_CATEGORY_ACCOUNTS.other;
  return getSystemAccount(meta.code);
}

// ─── Cash ya Bank account resolve karo, payment method ke hisaab se ──
// (App mein jahan bhi paymentMethod==='bank' hota hai, wahan specific
// BankAccount select hota hai; baaki sab (cash/credit-partial) Cash
// account mein jata hai.)
async function resolveMoneyAccount(method, bankAccountDoc) {
  if (method === 'bank' && bankAccountDoc) {
    return getBankLedgerAccount(bankAccountDoc);
  }
  return A.cash();
}

// =====================================================================
// POSTING
// =====================================================================

// lines: [{ account: AccountDoc, debit, credit }]
async function postJournal({ date, narration, refType, refId, lines, createdBy }) {
  const cleanLines = lines
    .filter(l => (l.debit || 0) > 0.004 || (l.credit || 0) > 0.004)
    .map(l => ({
      account:     l.account._id,
      accountCode: l.account.code,
      accountName: l.account.name,
      debit:       Math.round((l.debit  || 0) * 100) / 100,
      credit:      Math.round((l.credit || 0) * 100) / 100
    }));

  if (cleanLines.length < 2) return null; // kuch move hi nahi hua — koi entry ki zarurat nahi

  const entry = new JournalEntry({
    date: date || new Date(),
    narration: narration || '',
    refType: refType || 'Manual',
    refId: refId || null,
    lines: cleanLines,
    createdBy: createdBy || 'system'
  });
  await entry.save();
  return entry;
}

// ─── Kisi source transaction (Sale, Expense, waghera) ki purani entries ko
// reverse karo — edit/delete hone par use hota hai. Purani entry delete
// nahi hoti (audit trail), balke uska exact ulta (Dr<->Cr swap) post hota
// hai, refType/refId same rakh ke.
async function reverseJournalFor(refType, refId, narrationSuffix = '(reversed)') {
  const originals = await JournalEntry.find({ refType, refId, isReversal: false });
  const reversedIds = new Set(
    (await JournalEntry.find({ refType, refId, isReversal: true })).map(r => r.reversalOf?.toString())
  );

  for (const orig of originals) {
    if (reversedIds.has(orig._id.toString())) continue; // pehle se reverse ho chuki

    const swapped = orig.lines.map(l => ({
      account:     l.account,
      accountCode: l.accountCode,
      accountName: l.accountName,
      debit:       l.credit,
      credit:      l.debit
    }));

    const rev = new JournalEntry({
      date: new Date(),
      narration: `${orig.narration} ${narrationSuffix}`.trim(),
      refType,
      refId,
      lines: swapped,
      isReversal: true,
      reversalOf: orig._id,
      createdBy: 'system'
    });
    await rev.save();
  }
}

module.exports = {
  seedChartOfAccounts,
  getSystemAccount,
  getBankLedgerAccount,
  getExpenseAccount,
  resolveMoneyAccount,
  postJournal,
  reverseJournalFor,
  accounts: A,
  Account,
  JournalEntry
};
