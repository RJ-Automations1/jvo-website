/*
 * clientSheet.ts — the JVO client master list in Google Sheets.
 *
 * Every completed mailbox application appends one row. The sheet is JVO's backend
 * working document, so it deliberately mixes three kinds of columns:
 *
 *   - CAPTURED  — filled from the application, written once on append.
 *   - STAFF     — left blank for the team to fill in (suite number, status, notes).
 *   - BILLING   — written back by the invoice ledger (invoices.ts) so the sheet
 *                 says what was invoiced, what it totalled, and what's still owed.
 *
 * ── Why everything here is keyed by HEADER NAME, not column position ──
 * The live spreadsheet is edited by people. Columns get added, moved, and renamed,
 * and a positional write then lands a phone number under "Suite #". So we read the
 * header row and address every cell by its header (with a few spelling aliases),
 * appending any column we need but cannot find. A sheet that's missing "Submitted"
 * gains the column instead of silently dropping the submission date.
 *
 * Appends never touch an existing row. The only cells we ever overwrite are the
 * BILLING columns, on the row an invoice was raised for — staff notes are safe.
 *
 * Auth reuses the Google service account that already backs the booking calendar.
 * The spreadsheet must be shared with that service-account address as an Editor,
 * or the write 403s — the error below says so explicitly, since that's the likely
 * failure.
 */
import { getScopedClient, serviceAccountEmail } from "./googleAuth.js";
import type { JWT } from "google-auth-library";

const SHEETS_BASE = "https://sheets.googleapis.com/v4/spreadsheets";
const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];

/** Layout written when the sheet is empty. An existing sheet keeps its own order. */
const HEADERS = [
  "Submitted",        // captured — date AND time, see submissionStamp()
  "Name",             // captured
  "Company",          // captured
  "Email",            // captured
  "Phone",            // captured
  "Address",          // captured
  "Suite #",          // STAFF — assigned by JVO at the in-office visit
  "Type of Business", // captured
  "Plan",             // captured
  "Dropbox Folder",   // captured
  "Documents",        // captured
  "Status",           // STAFF
  "Notes",            // STAFF
  "Invoice #",        // BILLING — written by invoices.ts
  "Invoice Total",    // BILLING
  "Invoice Status",   // BILLING
  "Balance Due",      // BILLING
] as const;

/** The billing columns, in the order they're added to a sheet that lacks them. */
export const BILLING_HEADERS = ["Invoice #", "Invoice Total", "Invoice Status", "Balance Due"] as const;

/** Columns an append fills. Any of these the sheet lacks is added on the fly. */
const CAPTURED_HEADERS = [
  "Submitted", "Name", "Company", "Email", "Phone", "Address",
  "Type of Business", "Plan", "Dropbox Folder", "Documents", "Status",
] as const;

/**
 * Header spellings we accept for a canonical column. The live sheet was set up by
 * hand, so "Submission Date" and "Date Submitted" must count as "Submitted" rather
 * than causing a duplicate column to be bolted on beside it.
 */
const ALIASES: Record<string, string[]> = {
  "Submitted": ["submission date", "date submitted", "submitted on", "timestamp"],
  "Name": ["client name", "full name", "applicant", "applicant name"],
  "Company": ["business name", "business", "organization"],
  "Email": ["email address", "e mail"],
  "Phone": ["phone number", "telephone", "tel"],
  "Address": ["home address", "mailing address", "street address"],
  "Suite #": ["suite", "suite number", "box", "box number", "mailbox"],
  "Type of Business": ["business type", "type of business organization", "entity type"],
  "Plan": ["membership", "membership plan", "membership type", "package"],
  "Dropbox Folder": ["dropbox", "folder", "documents folder"],
  "Documents": ["docs", "uploads", "files"],
  "Status": ["member status", "onboarding status"],
  "Notes": ["staff notes", "note", "comments"],
  "Invoice #": ["invoice number", "invoice no", "invoice"],
  "Invoice Total": ["invoice amount", "total invoiced", "amount invoiced"],
  "Invoice Status": ["billing status", "payment status"],
  "Balance Due": ["balance", "amount due", "outstanding"],
};

const tab = () => process.env.JVO_SHEET_TAB || "Clients";

/** Lowercase, collapse punctuation to spaces — for header matching only. */
function squash(s: string): string {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** 1 -> "A", 26 -> "Z", 27 -> "AA". Sheets ranges are 1-indexed letters. */
export function colLetter(n: number): string {
  let out = "";
  let i = Math.max(1, Math.floor(n));
  while (i > 0) {
    const rem = (i - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    i = Math.floor((i - 1) / 26);
  }
  return out;
}

/* ── Sheet plumbing ───────────────────────────────────────────────────── */

const sheetId = (): string | null => process.env.JVO_SHEET_ID || null;
const client = (): JWT | null => getScopedClient(SCOPES);

/** True when a master list is configured at all. Lets callers skip quietly. */
export function clientSheetConfigured(): boolean {
  return Boolean(sheetId() && client());
}

async function getValues(c: JWT, id: string, range: string): Promise<string[][]> {
  const res = await c.request<{ values?: string[][] }>({
    url: `${SHEETS_BASE}/${id}/values/${encodeURIComponent(range)}`,
  });
  return res.data.values || [];
}

async function putValues(c: JWT, id: string, range: string, values: string[][]) {
  await c.request({
    url: `${SHEETS_BASE}/${id}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`,
    method: "PUT",
    data: { values },
  });
}

/**
 * Resolve the header row to { canonical header -> 1-based column }, creating any
 * of `required` that the sheet doesn't have yet (appended to the right, so no
 * existing column ever shifts under the team's feet).
 */
async function resolveColumns(
  c: JWT,
  id: string,
  required: readonly string[],
): Promise<{ index: Record<string, number>; width: number }> {
  const headerRow = (await getValues(c, id, `${tab()}!1:1`))[0] || [];

  // An empty sheet lays itself out — JVO can point JVO_SHEET_ID at a blank tab.
  if (!headerRow.some((h) => String(h || "").trim())) {
    await putValues(c, id, `${tab()}!A1:${colLetter(HEADERS.length)}1`, [HEADERS as unknown as string[]]);
    console.log("clientSheet: wrote header row on an empty sheet");
    const index: Record<string, number> = {};
    HEADERS.forEach((h, i) => (index[h] = i + 1));
    return { index, width: HEADERS.length };
  }

  const index: Record<string, number> = {};
  const taken = new Set<number>();
  const locate = (canonical: string): number | null => {
    const wanted = [squash(canonical), ...(ALIASES[canonical] || []).map(squash)];
    for (const want of wanted) {
      for (let i = 0; i < headerRow.length; i++) {
        if (taken.has(i + 1)) continue;
        if (squash(String(headerRow[i] || "")) === want) return i + 1;
      }
    }
    return null;
  };

  // Canonical order matters: an exact "Status" claims its column before
  // "Invoice Status" could reach it through an alias.
  for (const canonical of HEADERS) {
    const col = locate(canonical);
    if (col) {
      index[canonical] = col;
      taken.add(col);
    }
  }

  // Anything still missing is appended to the right of the real header row.
  let width = headerRow.length;
  const missing = required.filter((h) => !index[h]);
  if (missing.length) {
    const startCol = width + 1;
    await ensureGridWidth(c, id, width + missing.length);
    await putValues(
      c,
      id,
      `${tab()}!${colLetter(startCol)}1:${colLetter(width + missing.length)}1`,
      [missing as string[]],
    );
    missing.forEach((h, i) => (index[h] = startCol + i));
    width += missing.length;
    console.log(`clientSheet: added missing column(s) — ${missing.join(", ")}`);
  }
  return { index, width };
}

/* ── Column formatting ────────────────────────────────────────────────── */

/** Tab title -> its gid and width. Cached; only a rename or a resize changes it. */
let cachedTab: { tab: string; gid: number; columns: number } | null = null;

async function tabMeta(c: JWT, id: string): Promise<{ gid: number; columns: number } | null> {
  if (cachedTab && cachedTab.tab === tab()) return cachedTab;
  const res = await c.request<{
    sheets?: { properties?: { sheetId?: number; title?: string; gridProperties?: { columnCount?: number } } }[];
  }>({
    url: `${SHEETS_BASE}/${id}?fields=${encodeURIComponent("sheets.properties(sheetId,title,gridProperties/columnCount)")}`,
  });
  const match = (res.data.sheets || []).find((s) => s.properties?.title === tab());
  const gid = match?.properties?.sheetId;
  if (gid === undefined) return null;
  cachedTab = { tab: tab(), gid, columns: match?.properties?.gridProperties?.columnCount ?? 26 };
  return cachedTab;
}

/**
 * Make room for `needed` columns. A values.update past the last column of the grid
 * 400s rather than growing the sheet, so a tab trimmed to exactly its current width
 * would refuse the billing columns instead of gaining them.
 */
async function ensureGridWidth(c: JWT, id: string, needed: number): Promise<void> {
  const meta = await tabMeta(c, id);
  if (!meta || meta.columns >= needed) return;
  const add = needed - meta.columns;
  await c.request({
    url: `${SHEETS_BASE}/${id}:batchUpdate`,
    method: "POST",
    data: { requests: [{ appendDimension: { sheetId: meta.gid, dimension: "COLUMNS", length: add } }] },
  });
  cachedTab = { tab: tab(), gid: meta.gid, columns: needed };
  console.log(`clientSheet: widened the sheet by ${add} column(s) to fit the new headers`);
}

/** Done once per process — the format is a property of the sheet, not of a row. */
let submittedFormatChecked = false;

/**
 * Give the Submitted column a real date-time format.
 *
 * Without this the column is the single worst cell on the sheet: Sheets parses the
 * submitted value into a date serial, and a column formatted as a plain number then
 * displays it as "46274" instead of "2026-08-06 2:41 PM". Applying the format fixes
 * every row already written, not just new ones.
 *
 * Best-effort: a failure here must never cost JVO an application, so it's logged
 * and swallowed.
 */
async function ensureSubmittedFormat(c: JWT, id: string, col: number): Promise<void> {
  if (submittedFormatChecked || !col) return;
  submittedFormatChecked = true;
  try {
    const meta = await tabMeta(c, id);
    if (!meta) return;
    await c.request({
      url: `${SHEETS_BASE}/${id}:batchUpdate`,
      method: "POST",
      data: {
        requests: [
          {
            repeatCell: {
              range: {
                sheetId: meta.gid,
                startRowIndex: 1, // row 1 is the header
                startColumnIndex: col - 1,
                endColumnIndex: col,
              },
              cell: {
                userEnteredFormat: {
                  numberFormat: { type: "DATE_TIME", pattern: "yyyy-mm-dd h:mm am/pm" },
                },
              },
              fields: "userEnteredFormat.numberFormat",
            },
          },
        ],
      },
    });
    console.log("clientSheet: Submitted column formatted as a date-time");
  } catch (e: any) {
    console.warn("clientSheet: could not format the Submitted column —", e?.message);
  }
}

/**
 * Apply the date-time format to an EXISTING sheet, on demand.
 *
 * Appends do this themselves, but a sheet that already holds rows shows "46274"
 * until something writes to it. This is the one-off repair for that: it reformats
 * the column, which fixes every row already there.
 *
 *   npx tsx -e "import('./server/clientSheet.ts').then(m => m.repairSubmittedFormat())"
 */
export async function repairSubmittedFormat(): Promise<boolean> {
  const id = sheetId();
  const c = client();
  if (!id || !c) {
    console.warn("clientSheet: no sheet configured — nothing to repair");
    return false;
  }
  const { index } = await resolveColumns(c, id, ["Submitted"]);
  submittedFormatChecked = false; // this call is the explicit request to do it
  await ensureSubmittedFormat(c, id, index["Submitted"]);
  return true;
}

/* ── Submission stamp ─────────────────────────────────────────────────── */

/**
 * When the client hit submit, as office-local date AND time — e.g.
 * "2026-09-09 2:41 PM". Matching the events site: a bare date can't tell two
 * same-day applications apart, and staff work the list in arrival order.
 *
 * Sent with USER_ENTERED so Sheets stores it as a real date-time and sorts
 * correctly, rather than as text that sorts alphabetically.
 */
export function submissionStamp(at: Date = new Date()): string {
  const tz = process.env.JVO_TIMEZONE || "America/New_York";
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "numeric", minute: "2-digit", hour12: true,
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute} ${parts.dayPeriod}`;
}

/* ── Append one application ───────────────────────────────────────────── */

export interface ClientRow {
  submitted: string;
  name: string;
  company: string;
  email: string;
  phone: string;
  address: string;
  businessType: string;
  plan: string;
  folder: string;
  documents: string;
}

/**
 * Append one client to the master list. Returns the 1-based sheet row on success
 * (0 if Sheets didn't say which row), or null — without throwing — when the sheet
 * isn't configured or the write fails. An application must never be rejected
 * because the spreadsheet was unreachable; the Dropbox folder is the record of
 * truth.
 */
export async function appendClientRow(row: ClientRow): Promise<number | null> {
  const id = sheetId();
  if (!id) {
    console.warn("clientSheet: JVO_SHEET_ID not set, skipping master-list row");
    return null;
  }
  const c = client();
  if (!c) {
    console.warn("clientSheet: no Google service account configured, skipping master-list row");
    return null;
  }

  try {
    const { index, width } = await resolveColumns(c, id, CAPTURED_HEADERS);
    await ensureSubmittedFormat(c, id, index["Submitted"]);

    const values: Record<string, string> = {
      "Submitted": row.submitted,
      "Name": row.name,
      "Company": row.company,
      "Email": row.email,
      "Phone": row.phone,
      "Address": row.address,
      "Type of Business": row.businessType,
      "Plan": row.plan,
      "Dropbox Folder": row.folder,
      "Documents": row.documents,
      "Status": "New", // starting value, staff take it from here
    };

    // Build the row from the sheet's OWN layout. Every column we don't fill
    // (Suite #, Notes, the billing columns) is left blank.
    const cells: string[] = new Array(width).fill("");
    for (const [header, value] of Object.entries(values)) {
      const col = index[header];
      if (col) cells[col - 1] = value;
      else console.warn(`clientSheet: no "${header}" column on the sheet — value dropped`);
    }

    const res = await c.request<{ updates?: { updatedRange?: string } }>({
      url:
        `${SHEETS_BASE}/${id}/values/${encodeURIComponent(`${tab()}!A:${colLetter(width)}`)}:append` +
        `?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
      method: "POST",
      data: { values: [cells] },
    });

    // "Clients!A37:Q37" → 37, so the invoice ledger can write back to this row.
    const m = String(res.data.updates?.updatedRange || "").match(/![A-Z]+(\d+)/);
    return m ? Number(m[1]) : 0;
  } catch (e: any) {
    explainSheetError(e, "append");
    return null;
  }
}

/* ── Read the list (what staff invoice from) ──────────────────────────── */

export interface MasterListClient {
  row: number;
  submitted: string;
  name: string;
  company: string;
  email: string;
  phone: string;
  address: string;
  suite: string;
  businessType: string;
  plan: string;
  folder: string;
  documents: string;
  status: string;
  notes: string;
  invoiceNumber: string;
  invoiceTotal: string;
  invoiceStatus: string;
  balanceDue: string;
}

/**
 * Every client on the master list, newest first, addressed by header name.
 *
 * This is what staff invoice from: the sheet already says who signed up, on which
 * plan, and what's been billed, so the invoice screen never asks them to retype
 * it. Throws on a real Sheets failure — the invoicing screen shows the reason
 * rather than pretending the list is empty.
 */
export async function readClientList(): Promise<MasterListClient[]> {
  const id = sheetId();
  const c = client();
  if (!id || !c) {
    throw new Error("The client master list isn't configured (JVO_SHEET_ID and a Google service account).");
  }

  let rows: string[][];
  let index: Record<string, number>;
  try {
    // Read-only: resolve against the header row as it stands, adding nothing.
    ({ index } = await resolveColumns(c, id, []));
    rows = await getValues(c, id, `${tab()}!A2:ZZ`);
  } catch (e: any) {
    explainSheetError(e, "read");
    throw new Error(sheetErrorMessage(e));
  }

  const cell = (r: string[], header: string): string => {
    const col = index[header];
    return col ? String(r[col - 1] ?? "").trim() : "";
  };

  const out: MasterListClient[] = [];
  rows.forEach((r, i) => {
    const entry: MasterListClient = {
      row: i + 2, // +1 for the header row, +1 because sheets are 1-based
      submitted: cell(r, "Submitted"),
      name: cell(r, "Name"),
      company: cell(r, "Company"),
      email: cell(r, "Email"),
      phone: cell(r, "Phone"),
      address: cell(r, "Address"),
      suite: cell(r, "Suite #"),
      businessType: cell(r, "Type of Business"),
      plan: cell(r, "Plan"),
      folder: cell(r, "Dropbox Folder"),
      documents: cell(r, "Documents"),
      status: cell(r, "Status"),
      notes: cell(r, "Notes"),
      invoiceNumber: cell(r, "Invoice #"),
      invoiceTotal: cell(r, "Invoice Total"),
      invoiceStatus: cell(r, "Invoice Status"),
      balanceDue: cell(r, "Balance Due"),
    };
    // Skip blank spacer rows; keep anything with something identifying on it.
    if (entry.name || entry.email || entry.company) out.push(entry);
  });

  return out.reverse(); // newest first — the people most likely to need invoicing
}

/* ── Write the billing columns back ───────────────────────────────────── */

export interface BillingUpdate {
  invoiceNumber: string;
  invoiceTotal: string;
  invoiceStatus: string;
  balanceDue: string;
}

/**
 * Stamp one row's billing columns. The ONLY write that touches an existing row —
 * scoped to those four columns by header name, so a sheet that has since gained,
 * lost, or reordered columns still gets the right cells and nothing else is
 * disturbed. Returns false on failure; invoicing never depends on it.
 */
export async function writeBillingColumns(row: number, update: BillingUpdate): Promise<boolean> {
  const id = sheetId();
  const c = client();
  if (!id || !c || !row || row < 2) return false;

  try {
    const { index } = await resolveColumns(c, id, BILLING_HEADERS);
    const pairs: [string, string][] = [
      ["Invoice #", update.invoiceNumber],
      ["Invoice Total", update.invoiceTotal],
      ["Invoice Status", update.invoiceStatus],
      ["Balance Due", update.balanceDue],
    ];
    const data = pairs
      .filter(([header]) => index[header])
      .map(([header, value]) => ({
        range: `${tab()}!${colLetter(index[header])}${row}`,
        values: [[value]],
      }));
    if (!data.length) return false;

    await c.request({
      url: `${SHEETS_BASE}/${id}/values:batchUpdate`,
      method: "POST",
      data: { valueInputOption: "USER_ENTERED", data },
    });
    return true;
  } catch (e: any) {
    explainSheetError(e, "billing write");
    return false;
  }
}

/* ── Errors ───────────────────────────────────────────────────────────── */

function sheetErrorMessage(e: any): string {
  const status = e?.response?.status;
  if (status === 403) {
    return `Google Sheets refused access. Share the spreadsheet with ${serviceAccountEmail() || "the service account"} as an Editor.`;
  }
  if (status === 400 || status === 404) {
    return `Google Sheets rejected the request (${status}). Check JVO_SHEET_ID and that a tab named "${tab()}" exists.`;
  }
  return `Google Sheets error: ${e?.message || "unknown"}`;
}

function explainSheetError(e: any, what: string) {
  console.error(`clientSheet: ${what} failed — ${sheetErrorMessage(e)}`);
}
