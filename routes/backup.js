const express = require("express");
const router = express.Router();
const fs = require("fs");
const path = require("path");
const os = require("os");
const multer = require("multer");
const ExcelJS = require("exceljs");
const mongoose = require("mongoose");

const Product = require("../models/Medicine"); // naam Product hi rakha, model Medicine hai
const Customer = require("../models/Customer");
const Supplier = require("../models/Supplier");
const Sale = require("../models/Sale");
const CreditPayment = require("../models/CreditPayment");
const SupplierPayment = require("../models/SupplierPayment");
const BankAccount = require("../models/BankAccount");
const Expense = require("../models/Expense");
const Salesman = require("../models/Salesman");
const Transfer = require("../models/Transfer");
const RolePermission = require("../models/RolePermission");
const User = require("../models/User");
const SaleReturn = require("../models/SaleReturn");
const SupplierPurchase = require("../models/SupplierPurchase");
const CreditVoucher = require("../models/CreditVoucher");
const Account = require("../models/Account");
const JournalEntry = require("../models/JournalEntry");

// ================= BACKUP LOCATION =================
// Default: D:\PharmacyPOSBackup  (override with BACKUP_DIR env var)
// Falls back to a folder next to the app if D: isn't available (e.g. dev machine without a D: drive)
function resolveBackupDir() {
  const preferred = process.env.BACKUP_DIR || path.join("D:", "PharmacyPOSBackup");
  try {
    fs.mkdirSync(preferred, { recursive: true });
    return preferred;
  } catch (err) {
    const fallback = path.join(os.homedir(), "PharmacyPOSBackup");
    fs.mkdirSync(fallback, { recursive: true });
    return fallback;
  }
}

const BACKUP_DIR = resolveBackupDir();

const upload = multer({ storage: multer.memoryStorage() });

// ================= SHEET DEFINITIONS =================
// column.type: undefined = string, 'number', 'boolean', 'date', 'objectId', 'json'
const SHEETS = [
  {
    name: "Products",
    model: Product,
    columns: [
      { header: "_id" },
      { header: "name" },
      { header: "genericName" },
      { header: "manufacturer" },
      { header: "category" },
      { header: "requiresPrescription", type: "boolean" },
      { header: "barcode" },
      { header: "purchasePrice", type: "number" },
      { header: "sellingPrice", type: "number" },
      { header: "stockBoxes", type: "number" },
      { header: "minStockBoxes", type: "number" },
      { header: "description" },
      { header: "isActive", type: "boolean" },
      { header: "createdAt", type: "date" },
      { header: "updatedAt", type: "date" },
    ],
  },
  {
    name: "Customers",
    model: Customer,
    columns: [
      { header: "_id" },
      { header: "name" },
      { header: "phone" },
      { header: "whatsapp" },
      { header: "address" },
      { header: "totalPurchases", type: "number" },
      { header: "totalSpent", type: "number" },
      { header: "balance", type: "number" },
      { header: "walletBalance", type: "number" },
      { header: "notes" },
      { header: "isActive", type: "boolean" },
      { header: "createdAt", type: "date" },
      { header: "updatedAt", type: "date" },
    ],
  },
  {
    name: "Suppliers",
    model: Supplier,
    columns: [
      { header: "_id" },
      { header: "name" },
      { header: "phone" },
      { header: "whatsapp" },
      { header: "email" },
      { header: "address" },
      { header: "company" },
      { header: "totalPurchases", type: "number" },
      { header: "totalPaid", type: "number" },
      { header: "balance", type: "number" },
      { header: "creditLimit", type: "number" },
      { header: "paymentTerms" },
      { header: "status" },
      { header: "notes" },
      { header: "isActive", type: "boolean" },
      { header: "createdAt", type: "date" },
      { header: "updatedAt", type: "date" },
    ],
  },
  {
    name: "Sales",
    model: Sale,
    columns: [
      { header: "_id" },
      { header: "invoiceNumber" },
      { header: "customer", type: "objectId" },
      { header: "customerName" },
      { header: "items", type: "json" },
      { header: "returnedItems", type: "json" },
      { header: "totalRefunded", type: "number" },
      { header: "subtotal", type: "number" },
      { header: "discountPercent", type: "number" },
      { header: "discountAmount", type: "number" },
      { header: "tax", type: "number" },
      { header: "totalAmount", type: "number" },
      { header: "totalCost", type: "number" },
      { header: "amountPaid", type: "number" },
      { header: "change", type: "number" },
      { header: "walletUsed", type: "number" },
      { header: "paymentMethod" },
      { header: "bankAccount", type: "objectId" },
      { header: "bankAccountName" },
      { header: "status" },
      { header: "notes" },
      { header: "salesman", type: "objectId" },
      { header: "salesmanName" },
      { header: "createdAt", type: "date" },
      { header: "updatedAt", type: "date" },
    ],
  },
  {
    name: "CreditPayments",
    model: CreditPayment,
    columns: [
      { header: "_id" },
      { header: "sale", type: "objectId" },
      { header: "customer", type: "objectId" },
      { header: "customerName" },
      { header: "invoiceNumber" },
      { header: "method" },
      { header: "bankAccount", type: "objectId" },
      { header: "amount", type: "number" },
      { header: "createdAt", type: "date" },
      { header: "updatedAt", type: "date" },
    ],
  },
  {
    name: "SupplierPayments",
    model: SupplierPayment,
    columns: [
      { header: "_id" },
      { header: "supplier", type: "objectId" },
      { header: "supplierName" },
      { header: "method" },
      { header: "bankAccount", type: "objectId" },
      { header: "amount", type: "number" },
      { header: "note" },
      { header: "createdAt", type: "date" },
      { header: "updatedAt", type: "date" },
    ],
  },
  {
    name: "BankAccounts",
    model: BankAccount,
    columns: [
      { header: "_id" },
      { header: "bankName" },
      { header: "accountTitle" },
      { header: "accountNumber" },
      { header: "balance", type: "number" },
      { header: "isActive", type: "boolean" },
      { header: "notes" },
      { header: "createdAt", type: "date" },
      { header: "updatedAt", type: "date" },
    ],
  },
  {
    name: "Expenses",
    model: Expense,
    columns: [
      { header: "_id" },
      { header: "category" },
      { header: "amount", type: "number" },
      { header: "description" },
      { header: "paymentMethod" },
      { header: "bankAccount", type: "objectId" },
      { header: "date", type: "date" },
      { header: "receiptImage" },
      { header: "addedBy" },
      { header: "createdAt", type: "date" },
      { header: "updatedAt", type: "date" },
    ],
  },
  {
    name: "Salesmen",
    model: Salesman,
    columns: [
      { header: "_id" },
      { header: "name" },
      { header: "phone" },
      { header: "isActive", type: "boolean" },
      { header: "createdAt", type: "date" },
      { header: "updatedAt", type: "date" },
    ],
  },
  {
    name: "Transfers",
    model: Transfer,
    columns: [
      { header: "_id" },
      { header: "fromType" },
      { header: "fromAccount", type: "objectId" },
      { header: "fromLabel" },
      { header: "toType" },
      { header: "toAccount", type: "objectId" },
      { header: "toLabel" },
      { header: "amount", type: "number" },
      { header: "note" },
      { header: "createdAt", type: "date" },
      { header: "updatedAt", type: "date" },
    ],
  },
  {
    name: "RolePermissions",
    model: RolePermission,
    columns: [
      { header: "_id" },
      { header: "role" },
      { header: "allowedScreens", type: "json" },
      { header: "createdAt", type: "date" },
      { header: "updatedAt", type: "date" },
    ],
  },
  {
    name: "Users",
    model: User,
    columns: [
      { header: "_id" },
      { header: "name" },
      { header: "username" },
      { header: "password" },
      { header: "role" },
      { header: "isActive", type: "boolean" },
      { header: "createdAt", type: "date" },
      { header: "updatedAt", type: "date" },
    ],
  },
  {
    name: "SaleReturns",
    model: SaleReturn,
    columns: [
      { header: "_id" },
      { header: "returnNumber" },
      { header: "returnType" },
      { header: "originalSale", type: "objectId" },
      { header: "originalInvoiceNumber" },
      { header: "customer", type: "objectId" },
      { header: "customerName" },
      { header: "items", type: "json" },
      { header: "totalRefundAmount", type: "number" },
      { header: "cashRefunded", type: "number" },
      { header: "refundMode" },
      { header: "processedBy" },
      { header: "notes" },
      { header: "createdAt", type: "date" },
      { header: "updatedAt", type: "date" },
    ],
  },
  {
    name: "SupplierPurchases",
    model: SupplierPurchase,
    columns: [
      { header: "_id" },
      { header: "supplier", type: "objectId" },
      { header: "supplierName" },
      { header: "amount", type: "number" },
      { header: "amountPaid", type: "number" },
      { header: "note" },
      { header: "status" },
      { header: "createdAt", type: "date" },
      { header: "updatedAt", type: "date" },
    ],
  },
  {
    name: "CreditVouchers",
    model: CreditVoucher,
    columns: [
      { header: "_id" },
      { header: "customer", type: "objectId" },
      { header: "customerName" },
      { header: "method" },
      { header: "bankAccount", type: "objectId" },
      { header: "amount", type: "number" },
      { header: "creditBefore", type: "number" },
      { header: "creditAfter", type: "number" },
      { header: "appliedToCredit", type: "number" },
      { header: "walletAdded", type: "number" },
      { header: "notes" },
      { header: "createdBy" },
      { header: "createdAt", type: "date" },
      { header: "updatedAt", type: "date" },
    ],
  },
  {
    name: "Accounts",
    model: Account,
    columns: [
      { header: "_id" },
      { header: "code" },
      { header: "name" },
      { header: "type" },
      { header: "isSystem", type: "boolean" },
      { header: "refType" },
      { header: "refId", type: "objectId" },
      { header: "isActive", type: "boolean" },
      { header: "createdAt", type: "date" },
      { header: "updatedAt", type: "date" },
    ],
  },
  {
    name: "JournalEntries",
    model: JournalEntry,
    columns: [
      { header: "_id" },
      { header: "voucherNo" },
      { header: "date", type: "date" },
      { header: "narration" },
      { header: "refType" },
      { header: "refId", type: "objectId" },
      { header: "lines", type: "json" },
      { header: "isReversal", type: "boolean" },
      { header: "reversalOf", type: "objectId" },
      { header: "createdBy" },
      { header: "createdAt", type: "date" },
      { header: "updatedAt", type: "date" },
    ],
  },
];

function timestampForFilename() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(
    d.getHours()
  )}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

// ================= LIST BACKUPS PAGE =================
router.get("/", async (req, res) => {
  try {
    let files = fs.existsSync(BACKUP_DIR) ? fs.readdirSync(BACKUP_DIR) : [];
    files = files
      .filter((f) => f.toLowerCase().endsWith(".xlsx"))
      .map((f) => {
        const stat = fs.statSync(path.join(BACKUP_DIR, f));
        return { name: f, size: stat.size, mtime: stat.mtime };
      })
      .sort((a, b) => b.mtime - a.mtime);

    const counts = {};
    for (const sheet of SHEETS) {
      counts[sheet.name] = await sheet.model.countDocuments();
    }

    res.render("backup/index", {
      currentPage: "backup",
      backupDir: BACKUP_DIR,
      files,
      counts,
      success: req.flash("success"),
      error: req.flash("error"),
    });
  } catch (err) {
    console.error(err);
    req.flash("error", "Backup page load nahi ho saki: " + err.message);
    res.redirect("/dashboard");
  }
});

// ================= CREATE BACKUP =================
router.post("/create", async (req, res) => {
  try {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Pharmacy POS Software";
    workbook.created = new Date();

    let totalRows = 0;

    for (const sheet of SHEETS) {
      const ws = workbook.addWorksheet(sheet.name);
      ws.columns = sheet.columns.map((c) => ({ header: c.header, key: c.header, width: 22 }));
      ws.getRow(1).font = { bold: true };
      ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDDDDDD" } };

      const docs = await sheet.model.find().lean();
      totalRows += docs.length;

      docs.forEach((doc) => {
        const row = {};
        sheet.columns.forEach((col) => {
          const key = col.header;
          if (key === "_id") {
            row._id = doc._id.toString();
            return;
          }
          const val = doc[key];
          if (val === undefined || val === null) {
            row[key] = "";
          } else if (col.type === "objectId") {
            row[key] = val.toString();
          } else if (col.type === "json") {
            row[key] = JSON.stringify(val);
          } else {
            row[key] = val;
          }
        });
        ws.addRow(row);
      });
    }

    // Summary sheet
    const summary = workbook.addWorksheet("Summary");
    summary.columns = [
      { header: "Item", key: "item", width: 28 },
      { header: "Value", key: "value", width: 30 },
    ];
    summary.getRow(1).font = { bold: true };
    summary.addRow({ item: "Backup Date/Time", value: new Date().toLocaleString() });
    summary.addRow({ item: "Total Records", value: totalRows });
    for (const sheet of SHEETS) {
      summary.addRow({ item: sheet.name + " Count", value: await sheet.model.countDocuments() });
    }
    summary.addRow({ item: "Note", value: "Receipt images public/data/uploads folder me hain, is Excel me nahi" });

    const filename = `PharmacyPOS_Backup_${timestampForFilename()}.xlsx`;
    const filepath = path.join(BACKUP_DIR, filename);

    await workbook.xlsx.writeFile(filepath);

    req.flash("success", `Backup ban gaya: ${filename} (${totalRows} records) — saved to ${BACKUP_DIR}`);
    res.redirect("/backup");
  } catch (err) {
    console.error(err);
    req.flash("error", "Backup fail ho gaya: " + err.message);
    res.redirect("/backup");
  }
});

// ================= DOWNLOAD A BACKUP FILE =================
router.get("/download/:filename", (req, res) => {
  const filename = path.basename(req.params.filename);
  const filepath = path.join(BACKUP_DIR, filename);
  if (!fs.existsSync(filepath)) {
    req.flash("error", "File nahi mili");
    return res.redirect("/backup");
  }
  res.download(filepath, filename);
});

// ================= DELETE A BACKUP FILE =================
router.delete("/:filename", (req, res) => {
  const filename = path.basename(req.params.filename);
  const filepath = path.join(BACKUP_DIR, filename);
  try {
    if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
    req.flash("success", "Backup file delete ho gayi");
  } catch (err) {
    req.flash("error", "Delete nahi ho saki: " + err.message);
  }
  res.redirect("/backup");
});

// ================= RESTORE FROM EXCEL =================
// WARNING: har sheet ka current collection wipe karke Excel wala data reload karta hai
router.post("/restore", upload.single("backupFile"), async (req, res) => {
  if (!req.body.confirmRestore) {
    req.flash("error", "Restore cancel: confirmation checkbox tick nahi ki gayi");
    return res.redirect("/backup");
  }
  if (!req.file) {
    req.flash("error", "Koi Excel file select nahi ki");
    return res.redirect("/backup");
  }

  try {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(req.file.buffer);

    const results = [];

    for (const sheetDef of SHEETS) {
      const ws = workbook.getWorksheet(sheetDef.name);
      if (!ws) {
        results.push(`${sheetDef.name}: sheet nahi mili, skip kiya`);
        continue;
      }

      const headerRow = ws.getRow(1).values;
      const headers = {};
      headerRow.forEach((h, idx) => {
        if (h) headers[h.toString()] = idx;
      });

      const docs = [];
      ws.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        const values = row.values;
        const idCell = values[headers["_id"]];
        if (!idCell) return;

        const doc = { _id: new mongoose.Types.ObjectId(idCell.toString()) };

        sheetDef.columns.forEach((col) => {
          if (col.header === "_id") return;
          const cellVal = values[headers[col.header]];
          if (cellVal === undefined || cellVal === null || cellVal === "") return;

          if (col.type === "date") {
            doc[col.header] = cellVal instanceof Date ? cellVal : new Date(cellVal);
          } else if (col.type === "number") {
            doc[col.header] = Number(cellVal);
          } else if (col.type === "boolean") {
            doc[col.header] = cellVal === true || cellVal === "true" || cellVal === "TRUE";
          } else if (col.type === "objectId") {
            doc[col.header] = new mongoose.Types.ObjectId(cellVal.toString());
          } else if (col.type === "json") {
            try {
              doc[col.header] = JSON.parse(cellVal.toString());
            } catch (e) {
              doc[col.header] = [];
            }
          } else {
            doc[col.header] = cellVal.toString();
          }
        });

        docs.push(doc);
      });

      await sheetDef.model.deleteMany({});
      if (docs.length) await sheetDef.model.insertMany(docs, { ordered: false });
      results.push(`${sheetDef.name}: ${docs.length} records restore hue`);
    }

    req.flash("success", "Restore mukammal ho gaya. " + results.join(" | "));
    res.redirect("/backup");
  } catch (err) {
    console.error(err);
    req.flash("error", "Restore fail ho gaya: " + err.message);
    res.redirect("/backup");
  }
});

module.exports = router;
