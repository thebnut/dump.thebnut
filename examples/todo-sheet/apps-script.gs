/**
 * dump.thebnut — Google Sheets CRUD backend (Apps Script template)
 *
 * This script turns a Google Sheet into a tiny JSON HTTP backend for a
 * dump.thebnut-hosted prototype. The first row of the sheet is treated as
 * the column headers; each subsequent row is one record.
 *
 * Setup (~5 min, see examples/todo-sheet/README.md for screenshots):
 *
 *   1. Open the Google Sheet you want to use as your backend.
 *   2. Extensions → Apps Script. Replace the placeholder code with this
 *      whole file. Save.
 *   3. If your sheet's tab isn't called "Sheet1", change SHEET_NAME below.
 *   4. Click "Deploy" → "New deployment" → gear → "Web app". Configure:
 *        • Description:      todo-sheet
 *        • Execute as:       Me
 *        • Who has access:   Anyone
 *      Click Deploy, authorize when prompted, copy the Web app URL.
 *   5. Paste that URL as SHEET_API in your prototype's index.html and
 *      upload the prototype to dump.thebnut.
 *
 * Security note: "Who has access: Anyone" means the URL is unauthenticated —
 * anyone who has it can read AND mutate your sheet. Treat the URL like a
 * password. If you want to revoke access, redeploy with a new version (the
 * old URL stops working). Don't store anything sensitive in the sheet.
 *
 * The script auto-adds an "id" column on first use if one isn't present
 * (existing rows get back-filled with UUIDs). The "id" column is immutable
 * once assigned; updates by id are stable across row reordering/deletion.
 */

const SHEET_NAME = "Sheet1";

// ---------------------------------------------------------------------------
// HTTP entrypoints
// ---------------------------------------------------------------------------

function doGet() {
  return jsonResponse_(listRows_());
}

function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonResponse_({ error: "invalid_json", message: String(err) });
  }
  const op = body.op;
  try {
    if (op === "create") return jsonResponse_(createRow_(body.row || {}));
    if (op === "update") return jsonResponse_(updateRow_(body.id, body.row || {}));
    if (op === "delete") return jsonResponse_(deleteRow_(body.id));
    return jsonResponse_({ error: "unknown_op", op });
  } catch (err) {
    return jsonResponse_({ error: "exception", message: String(err) });
  }
}

function jsonResponse_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

// ---------------------------------------------------------------------------
// CRUD primitives
// ---------------------------------------------------------------------------

function listRows_() {
  const sh = sheet_();
  if (sh.getLastRow() <= 1) return [];
  const data = sh.getDataRange().getValues();
  const headers = data[0];
  return data.slice(1).map(row => rowToObject_(headers, row));
}

function createRow_(row) {
  const sh = sheet_();
  const headers = readHeaders_(sh);
  const id = row.id || Utilities.getUuid();
  const newRow = headers.map(h => {
    if (h === "id") return id;
    return Object.prototype.hasOwnProperty.call(row, h) ? row[h] : "";
  });
  sh.appendRow(newRow);
  return rowToObject_(headers, newRow);
}

function updateRow_(id, patch) {
  if (id == null) return { error: "missing_id" };
  const sh = sheet_();
  const rowIdx = findRowIndex_(sh, id);
  if (rowIdx === -1) return { error: "not_found", id };
  const headers = readHeaders_(sh);
  const current = sh.getRange(rowIdx, 1, 1, headers.length).getValues()[0];
  const updated = headers.map((h, i) => {
    if (h === "id") return current[i];                       // id is immutable
    if (Object.prototype.hasOwnProperty.call(patch, h)) return patch[h];
    return current[i];
  });
  sh.getRange(rowIdx, 1, 1, headers.length).setValues([updated]);
  return rowToObject_(headers, updated);
}

function deleteRow_(id) {
  if (id == null) return { error: "missing_id" };
  const sh = sheet_();
  const rowIdx = findRowIndex_(sh, id);
  if (rowIdx === -1) return { error: "not_found", id };
  sh.deleteRow(rowIdx);
  return { deleted: true, id };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) throw new Error(`Sheet tab "${SHEET_NAME}" not found`);
  ensureIdColumn_(sh);
  return sh;
}

/**
 * If the sheet has no "id" column, prepend one and back-fill UUIDs for
 * existing rows. Runs once; idempotent after that.
 */
function ensureIdColumn_(sh) {
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1).setValue("id");
    return;
  }
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  if (headers.indexOf("id") !== -1) return;
  sh.insertColumnBefore(1);
  sh.getRange(1, 1).setValue("id");
  const rowCount = sh.getLastRow() - 1;
  if (rowCount > 0) {
    const ids = [];
    for (let i = 0; i < rowCount; i++) ids.push([Utilities.getUuid()]);
    sh.getRange(2, 1, rowCount, 1).setValues(ids);
  }
}

function readHeaders_(sh) {
  return sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
}

function findRowIndex_(sh, id) {
  if (sh.getLastRow() <= 1) return -1;
  const ids = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
  const target = String(id);
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === target) return i + 2;          // 1-indexed + header
  }
  return -1;
}

function rowToObject_(headers, row) {
  const obj = {};
  for (let i = 0; i < headers.length; i++) obj[headers[i]] = row[i];
  return obj;
}
