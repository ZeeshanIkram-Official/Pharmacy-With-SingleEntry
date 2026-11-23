const path = require('path');
const fs = require('fs');

// ─── Writable data folder resolver ─────────────────────────────────────────
// Jab app normal Node se chalti hai (npm start / dev), __dirname se uploads
// folder use karte hain (jaisa pehle se ho raha tha).
//
// Jab app 'pkg' se bani .exe ke andar chal rahi hai, to __dirname ek
// read-only virtual snapshot path (/snapshot/...) hota hai — wahan files
// likhi nahi ja sakti. Is liye us case mein .exe file ke real folder
// (process.execPath ke paas) mein ek "data" folder banate hain.
//
// process.pkg sirf pkg-bundled build mein hi defined hota hai.
function getWritableBase() {
  if (process.pkg) {
    // .exe jis folder mein hai, usi ke andar "data" folder
    return path.join(path.dirname(process.execPath), 'data');
  }
  // Normal dev mode — purana behavior barqarar (public folder ke andar)
  return path.join(__dirname, '..', 'public');
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Receipts upload folder (Expense ke liye)
function getReceiptsUploadDir() {
  return ensureDir(path.join(getWritableBase(), 'uploads', 'receipts'));
}

// ─── License / Trial tracking ──────────────────────────────────────────────
// Pehli baar app chalne ki date ek chhoti file mein save karte hain.
// Yeh file sirf ek baar likhi jaati hai — agar app dobara chalayi jaye,
// purani date hi yaad rehti hai (naya trial dobara shuru nahi hota).
function getLicenseFilePath() {
  return path.join(ensureDir(getWritableBase()), 'license.json');
}

function getOrCreateFirstRunDate() {
  const filePath = getLicenseFilePath();

  if (fs.existsSync(filePath)) {
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (data && data.firstRunAt) return new Date(data.firstRunAt);
    } catch (err) {
      // Corrupt file ho to neeche se nayi date likh denge
    }
  }

  const now = new Date();
  fs.writeFileSync(filePath, JSON.stringify({ firstRunAt: now.toISOString() }, null, 2));
  return now;
}

function getDaysSinceFirstRun() {
  const firstRun = getOrCreateFirstRunDate();
  const diffMs = Date.now() - firstRun.getTime();
  return diffMs / (1000 * 60 * 60 * 24);
}

// ─── Combined check: license.config.js ke hisaab se trial khatam hua ya nahi ──
// EXPIRY_DATE set ho to usay priority milti hai (fixed-date mode), warna
// TRIAL_DAYS ke hisaab se rolling-trial calculate hota hai.
function isTrialExpired() {
  const { EXPIRY_DATE, TRIAL_DAYS } = require('../license.config');

  if (EXPIRY_DATE) {
    // Fixed-date mode: us din ke pure 24 ghante (raat 11:59:59 tak) allow karte hain
    const expiry = new Date(EXPIRY_DATE + 'T23:59:59');
    return Date.now() > expiry.getTime();
  }

  // Rolling-trial mode
  return getDaysSinceFirstRun() > TRIAL_DAYS;
}

module.exports = {
  getWritableBase,
  ensureDir,
  getReceiptsUploadDir,
  getDaysSinceFirstRun,
  isTrialExpired
};
