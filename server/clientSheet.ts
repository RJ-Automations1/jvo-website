/*
 * clientSheet.ts — the JVO client master list in Google Sheets.
 *
 * Every completed mailbox application appends one row. The sheet is JVO's backend
 * working document, so it deliberately mixes two kinds of columns:
 *
 *   - CAPTURED  — filled from the application, written once on append.
 *   - STAFF     — left blank for the team to fill in (suite number, status, notes).
 *
 * We only ever APPEND. Nothing here updates or rewrites an existing row, so anything
 * staff type into the sheet is safe from being overwritten by a later submission.
 *
 * Auth reuses the Google service account that already backs the booking calendar. The
 * spreadsheet must be shared with that service-account address as an Editor, or the
 * append 403s — the error below says so explicitly, since that's the likely failure.
 */
import { getScopedClient, serviceAccountEmail } from "./googleAuth.js";

const SHEETS_BASE = "https://sheets.googleapis.com/v4/spreadsheets";
const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];

/** Column order. Changing this changes the sheet layout — append, don't reorder. */
const HEADERS = [
  "Submitted",        // captured
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
] as const;

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

const tab = () => process.env.JVO_SHEET_TAB || "Clients";

/**
 * Write the header row if the sheet is empty. Lets JVO point JVO_SHEET_ID at a blank
 * spreadsheet and have it lay itself out on the first application.
 */
async function ensureHeaders(client: NonNullable<ReturnType<typeof getScopedClient>>, sheetId: string) {
  const range = `${tab()}!A1:M1`;
  const existing = await client.request<{ values?: string[][] }>({
    url: `${SHEETS_BASE}/${sheetId}/values/${encodeURIComponent(range)}`,
  });
  if (existing.data.values?.[0]?.length) return;

  await client.request({
    url: `${SHEETS_BASE}/${sheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`,
    method: "PUT",
    data: { values: [HEADERS as unknown as string[]] },
  });
  console.log("clientSheet: wrote header row");
}

/**
 * Append one client to the master list. Returns false (without throwing) when the
 * sheet isn't configured or the write fails — an application must never be rejected
 * because the spreadsheet was unreachable; the Dropbox folder is the source of truth.
 */
export async function appendClientRow(row: ClientRow): Promise<boolean> {
  const sheetId = process.env.JVO_SHEET_ID;
  if (!sheetId) {
    console.warn("clientSheet: JVO_SHEET_ID not set, skipping master-list row");
    return false;
  }
  const client = getScopedClient(SCOPES);
  if (!client) {
    console.warn("clientSheet: no Google service account configured, skipping master-list row");
    return false;
  }

  try {
    await ensureHeaders(client, sheetId);
    await client.request({
      url:
        `${SHEETS_BASE}/${sheetId}/values/${encodeURIComponent(`${tab()}!A:M`)}:append` +
        `?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
      method: "POST",
      data: {
        values: [[
          row.submitted,
          row.name,
          row.company,
          row.email,
          row.phone,
          row.address,
          "",              // Suite # — staff fill this in
          row.businessType,
          row.plan,
          row.folder,
          row.documents,
          "New",           // Status — starting value, staff take it from here
          "",              // Notes — staff
        ]],
      },
    });
    return true;
  } catch (e: any) {
    const status = e?.response?.status;
    if (status === 403) {
      console.error(
        `clientSheet: 403 from Sheets. Share the spreadsheet with ${serviceAccountEmail() || "the service account"} as an Editor.`
      );
    } else if (status === 400 || status === 404) {
      console.error(`clientSheet: Sheets rejected the write (${status}). Check JVO_SHEET_ID and that a tab named "${tab()}" exists.`);
    } else {
      console.error("clientSheet: append failed", e?.message);
    }
    return false;
  }
}
