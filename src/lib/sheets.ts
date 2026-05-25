import "server-only";
import crypto from "crypto";

/**
 * dump.thebnut Sheets adapter.
 *
 * Talks to the Google Sheets v4 REST API using a service account loaded
 * from the GOOGLE_SERVICE_ACCOUNT_JSON_B64 env var. Deliberately uses
 * native Node crypto + fetch — pulling in `googleapis` would add ~30 MB
 * to the function bundle for the small slice of the API we need.
 *
 * Contract mirrors the Apps Script template in examples/todo-sheet so
 * the same SPA can target either backend by swapping its API base URL:
 *
 *   list()                       → [{id, ...columns}]
 *   create({title, ...})         → {id, ...columns}  (id auto-generated)
 *   update(id, {title})          → {id, ...columns}
 *   remove(id)                   → {deleted: true, id}
 *
 * First row of the sheet's tab is the schema. If no "id" column exists,
 * we prepend one and back-fill UUIDs for existing rows on the first
 * write. The "id" column is immutable; updates by id are stable across
 * row reordering/deletion in the sheet.
 *
 * String values starting with `=`, `+`, `-`, `@` are escaped with a
 * leading apostrophe to defuse Sheets formula injection (anyone with a
 * project's public URL can mutate the linked sheet — same threat model
 * as Apps Script "Anyone" deployment).
 */

// ---------------------------------------------------------------------------
// Service-account JWT → access token
// ---------------------------------------------------------------------------

type ServiceAccount = {
  client_email: string;
  private_key: string;
  token_uri: string;
};

let cachedToken: { value: string; expiresAt: number } | null = null;

function loadServiceAccount(): ServiceAccount {
  const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_B64;
  if (!b64) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON_B64 is not set");
  }
  const json = Buffer.from(b64, "base64").toString("utf-8");
  return JSON.parse(json) as ServiceAccount;
}

function b64url(input: string | Buffer): string {
  const b = Buffer.isBuffer(input) ? input : Buffer.from(input, "utf-8");
  return b
    .toString("base64")
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

/**
 * Sign an RS256 JWT, exchange it for a Sheets-scoped OAuth2 access token.
 * Cached for 50 minutes (Google tokens live 60); a small safety margin.
 */
export async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.value;
  }
  const sa = loadServiceAccount();
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/spreadsheets",
      aud: sa.token_uri ?? "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    }),
  );
  const data = `${header}.${payload}`;
  const signature = b64url(
    crypto.createSign("RSA-SHA256").update(data).sign(sa.private_key),
  );
  const assertion = `${data}.${signature}`;

  const res = await fetch(sa.token_uri ?? "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!res.ok) {
    throw new Error(`token exchange failed (${res.status}): ${await res.text()}`);
  }
  const body = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    value: body.access_token,
    expiresAt: Date.now() + (body.expires_in - 60) * 1000,
  };
  return body.access_token;
}

// ---------------------------------------------------------------------------
// Sheets API thin wrapper
// ---------------------------------------------------------------------------

type Range = { sheetId: string; tabName: string };

async function sheetsFetch(
  path: string,
  init: RequestInit = {},
): Promise<unknown> {
  const token = await getAccessToken();
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets${path}`, {
    ...init,
    headers: {
      ...(init.headers as Record<string, string> | undefined),
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    // If Google rejected our token (rotated key, revoked SA, etc.), drop
    // the cached value so the *next* request mints a fresh one — without
    // this, a key rotation mid-deploy means ~50 minutes of stale-token
    // 401s until the module-scope cache expires naturally.
    if (res.status === 401) cachedToken = null;
    const text = await res.text();
    throw new SheetsError(res.status, text);
  }
  if (res.status === 204) return null;
  return res.json();
}

export class SheetsError extends Error {
  constructor(public status: number, public detail: string) {
    super(`Sheets API ${status}: ${detail}`);
    this.name = "SheetsError";
  }
}

/**
 * Read a 2D range. Returns rows as arrays of cell values (strings for
 * most cell types; Sheets coerces booleans to "TRUE"/"FALSE" which the
 * client SPA already handles).
 */
async function readValues(
  { sheetId, tabName }: Range,
  a1Range: string,
): Promise<string[][]> {
  const ranged = `${quoteTab(tabName)}!${a1Range}`;
  const body = (await sheetsFetch(
    `/${encodeURIComponent(sheetId)}/values/${encodeURIComponent(ranged)}?valueRenderOption=UNFORMATTED_VALUE`,
  )) as { values?: string[][] };
  return body.values ?? [];
}

async function writeValues(
  { sheetId, tabName }: Range,
  a1Range: string,
  values: unknown[][],
): Promise<void> {
  const ranged = `${quoteTab(tabName)}!${a1Range}`;
  await sheetsFetch(
    `/${encodeURIComponent(sheetId)}/values/${encodeURIComponent(ranged)}?valueInputOption=RAW`,
    {
      method: "PUT",
      body: JSON.stringify({ values }),
    },
  );
}

async function appendValues(
  { sheetId, tabName }: Range,
  values: unknown[][],
): Promise<void> {
  const ranged = `${quoteTab(tabName)}!A1`;
  await sheetsFetch(
    `/${encodeURIComponent(sheetId)}/values/${encodeURIComponent(ranged)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    {
      method: "POST",
      body: JSON.stringify({ values }),
    },
  );
}

/**
 * Delete a row by absolute index (1-based, where 1 is the header row, so
 * a data row at index N is the N-th data row + 1). Uses batchUpdate with
 * a DeleteDimensionRequest because the values API has no per-row delete.
 */
async function deleteRow(
  { sheetId, tabName }: Range,
  rowIndex1Based: number,
): Promise<void> {
  // We need the *numeric* sheetId (gid) of the tab for batchUpdate;
  // tabName isn't accepted there. Fetch tab metadata once.
  const meta = (await sheetsFetch(
    `/${encodeURIComponent(sheetId)}?fields=sheets(properties(sheetId,title))`,
  )) as { sheets: Array<{ properties: { sheetId: number; title: string } }> };
  const tab = meta.sheets.find((s) => s.properties.title === tabName);
  if (!tab) throw new SheetsError(404, `tab "${tabName}" not found`);
  await sheetsFetch(`/${encodeURIComponent(sheetId)}:batchUpdate`, {
    method: "POST",
    body: JSON.stringify({
      requests: [
        {
          deleteDimension: {
            range: {
              sheetId: tab.properties.sheetId,
              dimension: "ROWS",
              startIndex: rowIndex1Based - 1, // batchUpdate uses 0-based
              endIndex: rowIndex1Based,
            },
          },
        },
      ],
    }),
  });
}

/**
 * Insert a column at position 1 (before existing column A). Used when the
 * sheet has no "id" header — we prepend the id column then back-fill.
 */
async function prependIdColumn(range: Range): Promise<void> {
  const meta = (await sheetsFetch(
    `/${encodeURIComponent(range.sheetId)}?fields=sheets(properties(sheetId,title))`,
  )) as { sheets: Array<{ properties: { sheetId: number; title: string } }> };
  const tab = meta.sheets.find((s) => s.properties.title === range.tabName);
  if (!tab) throw new SheetsError(404, `tab "${range.tabName}" not found`);
  await sheetsFetch(`/${encodeURIComponent(range.sheetId)}:batchUpdate`, {
    method: "POST",
    body: JSON.stringify({
      requests: [
        {
          insertDimension: {
            range: {
              sheetId: tab.properties.sheetId,
              dimension: "COLUMNS",
              startIndex: 0,
              endIndex: 1,
            },
          },
        },
      ],
    }),
  });
}

function quoteTab(name: string): string {
  // Apostrophes in tab names doubled; whole name wrapped in apostrophes.
  return `'${name.replace(/'/g, "''")}'`;
}

// ---------------------------------------------------------------------------
// Public API: ensureSchema → list → create → update → remove
// ---------------------------------------------------------------------------

/** Headers are alphabetised columns: A → 0, B → 1, ... AA → 26 */
function colLetter(idx0: number): string {
  let n = idx0;
  let s = "";
  while (n >= 0) {
    s = String.fromCharCode((n % 26) + 65) + s;
    n = Math.floor(n / 26) - 1;
  }
  return s;
}

function rowToObject(headers: string[], row: unknown[]): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  for (let i = 0; i < headers.length; i++) o[headers[i]] = row[i] ?? "";
  return o;
}

function sanitiseCell(v: unknown): unknown {
  if (typeof v === "string" && /^[=+\-@]/.test(v)) return "'" + v;
  return v;
}

/**
 * Read the header row and, if there's no "id" column, prepend one and
 * back-fill UUIDs for any existing data rows. Returns the (possibly
 * mutated) headers array. Idempotent — safe to call on every request.
 *
 * No locking. The Sheets API isn't transactional; two concurrent first-
 * ever requests against a non-empty sheet without an id column could in
 * theory both insert columns. The window is tiny (one-shot bootstrap)
 * and the failure mode (two id columns) is obvious + manually fixable.
 * Same trade-off as the Apps Script template.
 */
async function ensureIdHeader(range: Range): Promise<string[]> {
  // Read whatever's in row 1 — Sheets returns [] if the sheet is empty.
  const headerRows = await readValues(range, "1:1");
  let headers = headerRows[0] ?? [];

  if (headers.length === 0) {
    // Brand new sheet, no headers. Just write the id header.
    await writeValues(range, "A1", [["id"]]);
    return ["id"];
  }
  if (headers.includes("id")) return headers;

  // Existing rows but no id column. Prepend, then back-fill.
  await prependIdColumn(range);
  // Re-read full first column to know how many data rows to back-fill.
  const allRowsA = await readValues(range, "A:A");
  const dataRowCount = Math.max(0, allRowsA.length - 1); // minus header row
  if (dataRowCount > 0) {
    const fill: string[][] = [];
    for (let i = 0; i < dataRowCount; i++) fill.push([crypto.randomUUID()]);
    await writeValues(range, `A2:A${dataRowCount + 1}`, fill);
  }
  await writeValues(range, "A1", [["id"]]);
  headers = ["id", ...headers];
  return headers;
}

export type SheetRow = Record<string, unknown>;

export async function listRows(range: Range): Promise<SheetRow[]> {
  const headers = await ensureIdHeader(range);
  const all = await readValues(range, `A1:${colLetter(headers.length - 1)}`);
  return all.slice(1).map((r) => rowToObject(headers, r));
}

export async function createRow(range: Range, row: SheetRow): Promise<SheetRow> {
  const headers = await ensureIdHeader(range);
  // Always server-generate the id. NEVER honour a caller-supplied value —
  // that would let a hostile POST inject a Sheets formula via the id cell
  // (e.g. `{id: '=HYPERLINK("evil","x")'}`), which sanitiseCell wouldn't
  // touch because we used to skip it for the id column. Server-generating
  // UUIDs makes ids cryptographically random and side-steps the whole
  // injection surface on that column.
  const id = crypto.randomUUID();
  const newRow = headers.map((h) => {
    if (h === "id") return id;
    return sanitiseCell(Object.prototype.hasOwnProperty.call(row, h) ? row[h] : "");
  });
  await appendValues(range, [newRow]);
  return rowToObject(headers, newRow);
}

async function findRowIndex(range: Range, id: string): Promise<number> {
  // Returns 1-based row index (where 1 is the header). -1 if not found.
  const idCol = await readValues(range, "A:A");
  const target = String(id);
  for (let i = 1; i < idCol.length; i++) {
    if (String(idCol[i]?.[0] ?? "") === target) return i + 1;
  }
  return -1;
}

export async function updateRow(
  range: Range,
  id: string,
  patch: SheetRow,
): Promise<SheetRow | null> {
  const headers = await ensureIdHeader(range);
  const rowIdx = await findRowIndex(range, id);
  if (rowIdx === -1) return null;
  const lastCol = colLetter(headers.length - 1);
  const currentRows = await readValues(range, `A${rowIdx}:${lastCol}${rowIdx}`);
  const current = currentRows[0] ?? [];
  const updated = headers.map((h, i) => {
    if (h === "id") return current[i] ?? id; // immutable
    return Object.prototype.hasOwnProperty.call(patch, h)
      ? sanitiseCell(patch[h])
      : current[i] ?? "";
  });
  await writeValues(range, `A${rowIdx}:${lastCol}${rowIdx}`, [updated]);
  return rowToObject(headers, updated);
}

export async function removeRow(
  range: Range,
  id: string,
): Promise<{ ok: true; id: string } | { ok: false }> {
  const rowIdx = await findRowIndex(range, id);
  if (rowIdx === -1) return { ok: false };
  await deleteRow(range, rowIdx);
  return { ok: true, id };
}

// ---------------------------------------------------------------------------
// Sheet URL parsing
// ---------------------------------------------------------------------------

/**
 * Extract the spreadsheet id from a sharing URL. Accepts:
 *   - https://docs.google.com/spreadsheets/d/<id>/...
 *   - just the bare id (44 chars, base64url-ish)
 * Returns null if it can't parse.
 */
export function parseSheetUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const urlMatch = /\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/.exec(trimmed);
  if (urlMatch) return urlMatch[1];
  // Bare id — letters, digits, dashes, underscores, typically 40+ chars.
  if (/^[a-zA-Z0-9_-]{20,}$/.test(trimmed)) return trimmed;
  return null;
}

/**
 * Sanity check — fetch the sheet's metadata. Returns the tab list so the
 * UI can let the user pick which tab to use. Throws SheetsError(404) if
 * the sheet isn't shared with the service account.
 */
export async function probeSheet(
  sheetId: string,
): Promise<{ title: string; tabs: string[] }> {
  const meta = (await sheetsFetch(
    `/${encodeURIComponent(sheetId)}?fields=properties(title),sheets(properties(title))`,
  )) as {
    properties: { title: string };
    sheets: Array<{ properties: { title: string } }>;
  };
  return {
    title: meta.properties.title,
    tabs: meta.sheets.map((s) => s.properties.title),
  };
}
