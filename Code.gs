/**
 * ফর্ম অ্যাপ ব্যাকএন্ড (Google Apps Script)
 * ------------------------------------------------
 * সেটআপ:
 * 1) একটা Google Sheet খুলুন, নিচের দুইটা শিট বানান:
 *    - "Form Responses Network"      কলাম: Name | Phone Number
 *    - "Form Responses My Inventory" কলাম: Date Time | Category | Name | Phone Number | Take Amount | Give Amount | Reason
 * 2) Extensions > Apps Script এ গিয়ে এই কোড পেস্ট করুন।
 * 3) Deploy > New deployment > Type: Web app
 *    - Execute as: Me
 *    - Who has access: Anyone
 *    Deploy করে যে URL পাবেন সেটাই index.html এর APPS_SCRIPT_URL এ বসান।
 *
 * কোড বদলালে: Deploy > Manage deployments > (পেন্সিল আইকন) > Version: New version > Deploy
 * (URL একই থাকবে)
 */

var NETWORK_SHEET = 'Form Responses Network';
var INVENTORY_SHEET = 'Form Responses My Inventory';

function doGet(e) {
  try {
    var action = e.parameter.action;
    if (action === 'checkPhone') {
      return jsonOut(checkPhone(e.parameter.phone));
    }
    if (action === 'getEntries') {
      return jsonOut(getEntries());
    }
    return jsonOut({ error: 'unknown action' });
  } catch (err) {
    return jsonOut({ error: err.message });
  }
}

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    var action = body.action;
    if (action === 'submitForm') {
      return jsonOut(submitForm(body));
    }
    return jsonOut({ error: 'unknown action' });
  } catch (err) {
    return jsonOut({ error: err.message });
  }
}

function getSheet(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    if (name === NETWORK_SHEET) sh.appendRow(['Name', 'Phone Number']);
    if (name === INVENTORY_SHEET) sh.appendRow(['Date Time', 'Category', 'Name', 'Phone Number', 'Take Amount', 'Give Amount', 'Reason']);
  }
  return sh;
}

function normalizePhone(p) {
  return String(p || '').replace(/\D/g, '');
}

function checkPhone(phone) {
  var sh = getSheet(NETWORK_SHEET);
  var data = sh.getDataRange().getValues();
  var target = normalizePhone(phone);
  if (!target) return { found: false };
  for (var i = 1; i < data.length; i++) {
    if (normalizePhone(data[i][1]) === target) {
      return { found: true, name: data[i][0] };
    }
  }
  return { found: false };
}

// H কলামে ClientId রাখে, যাতে একই এন্ট্রি অ্যাপ থেকে দুইবার পাঠালেও শিটে দুইবার না বসে
function ensureClientIdColumn(sh) {
  if (sh.getRange(1, 8).getValue() !== 'Client Id') {
    sh.getRange(1, 8).setValue('Client Id');
  }
}

function findClientId(sh, clientId) {
  var last = sh.getLastRow();
  if (!clientId || last < 2) return false;
  var vals = sh.getRange(2, 8, last - 1, 1).getValues();
  for (var i = 0; i < vals.length; i++) {
    if (vals[i][0] && String(vals[i][0]) === String(clientId)) return true;
  }
  return false;
}

function submitForm(body) {
  var inv = getSheet(INVENTORY_SHEET);
  ensureClientIdColumn(inv);

  var clientId = body.clientId || '';
  if (clientId && findClientId(inv, clientId)) {
    return { success: true, duplicate: true }; // আগেই সেভ হয়েছে, আবার বসানো হলো না
  }

  inv.appendRow([
    body.dateTime || new Date(),
    body.category || '',
    body.name || '',
    body.phone || '',
    body.takeAmount || '',
    body.giveAmount || '',
    body.reason || '',
    clientId
  ]);

  // নতুন কন্টাক্ট হলে Network শিটে সেভ করা
  if (body.phone) {
    var existing = checkPhone(body.phone);
    if (!existing.found && body.name) {
      getSheet(NETWORK_SHEET).appendRow([body.name, body.phone]);
    }
  }

  return { success: true };
}

/* ---------- অ্যাপে সব এন্ট্রি ফেরত পাঠানো ---------- */

function toIso(v) {
  if (v instanceof Date) return isNaN(v.getTime()) ? '' : v.toISOString();
  if (!v) return '';
  var d = new Date(v);
  return isNaN(d.getTime()) ? '' : d.toISOString();
}

function toNum(v) {
  if (v === '' || v === null || v === undefined) return '';
  if (typeof v === 'number') return v;
  var n = parseFloat(String(v).replace(/[^\d.\-]/g, ''));
  return isNaN(n) ? '' : n;
}

// শিটে ফোন নম্বরের শুরুর 0 উঠে গেলে ফিরিয়ে দেয় (১০ ডিজিট, 1 দিয়ে শুরু)
function fixPhone(p) {
  var d = normalizePhone(p);
  if (d.length === 10 && d.charAt(0) === '1') d = '0' + d;
  return d;
}

function getEntries() {
  var sh = getSheet(INVENTORY_SHEET);
  var last = sh.getLastRow();
  if (last < 2) return { success: true, entries: [] };

  var data = sh.getRange(2, 1, last - 1, 7).getValues();
  var out = [];
  for (var i = 0; i < data.length; i++) {
    var r = data[i];
    var take = toNum(r[4]);
    var give = toNum(r[5]);
    var category = String(r[1] || '').trim();
    var name = String(r[2] || '').trim();
    if (!category && !name && take === '' && give === '') continue; // ফাঁকা সারি
    out.push({
      dateTime: toIso(r[0]),
      category: category,
      name: name,
      phone: fixPhone(r[3]),
      takeAmount: take,
      giveAmount: give,
      reason: String(r[6] || '')
    });
  }
  return { success: true, entries: out };
}

function jsonOut(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
