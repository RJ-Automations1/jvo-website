# How the Mailbox Application Workflow Works

End-to-end walkthrough of what happens when someone applies for a JVO mailbox at
`jonesborovirtualoffice.com/mailbox-application`.

---

## The short version

```
Applicant fills out the form and photographs their ID
        │
        ▼
Browser builds the PS Form 1583 PDF and shrinks the photos
        │
        ▼ "Continue Registration"
One request to the JVO server carrying form + photos
        │
        ├──► Dropbox   — one folder per client, form + ID images inside
        ├──► Sheets    — one row on the client master list (with a timestamp)
        └──► Email     — "New member signup" to the JVO team
        │
        ▼
Applicant continues to Deskworks registration (the only step left for them)
        │
        ▼
Staff assign a suite number, invoice from the master list (/admin/invoices)
        │
        ▼
In-office visit: originals inspected, form signed and witnessed
```

**Nothing is downloaded or printed by the applicant — business or residential.** JVO
holds the filled form and has it ready to sign at the visit. The PDF exists only long
enough to be sent to JVO.

---

## Step by step

### 1. The applicant starts from a membership plan

Clicking any plan CTA sends them to `/mailbox-application?plan=<Plan Name>`. The plan name
rides along the whole way through and lands in the master list and the team email.

### 2. Six questions

The wizard collects, one step at a time:

| Step | What's collected |
|---|---|
| Service type | Business/organization (commercial) or residential/personal — each with a gold ⓘ explaining what that choice means for them |
| Your information | Name, phone, email, home address, court-protection flag |
| Business details | *(business only)* Name, type, address, place of registration |
| Photo ID | ID type, number, issuing entity, expiration — **plus photos of both sides** |
| Proof of address | Document type, the address as printed — **plus a photo or PDF** |
| Authorized individual | Optional second person allowed to receive mail |

Two rules are enforced as they go:

- **A driver's license can't count twice.** USPS requires two separate documents, so if the
  license is the photo ID, it's disabled as the address proof.
- **Uploads are required.** They cannot advance past the ID steps, and the generate button
  stays disabled, until both sides of the ID and at least one proof-of-address file are attached.

### 3. Photos are shrunk in the browser

A phone photo is 3–8 MB. Before anything is sent, each image is redrawn at a maximum of
2000 pixels on its longest edge and saved as JPEG — typically 300–700 KB, still easily
sharp enough to read an ID number.

- **PDFs pass through untouched**, since proof of address is often a bank statement PDF.
- **HEIC (iPhone) images** that the browser can't decode are sent as-is up to 8 MB rather
  than dead-ending the applicant.

### 4. Review and continue

The summary screen lists everything back, including an "Uploads" row, with an *Edit* link
to any step. Clicking **Continue Registration**:

1. Fills the official PS Form 1583 in the browser.
2. Sends the form plus every uploaded file to JVO in one request.
3. Shows the next step — continue to Deskworks registration.

The form is never offered to the applicant as a download, on either service type.
Their job is to finish registration and turn up with two IDs; JVO prints the 1583 for
the visit. If someone needs a copy for a lender or registered agent, staff send it from
the Dropbox folder.

If the transfer to JVO fails they see a plain explanation and a **Retry sending** button
that re-sends without rebuilding the form, plus the reassurance that they can continue
to registration regardless — staff fill the form with them at the office.

### 5. What the server does

Three things, in this order:

**a. Dropbox** — creates or reuses one folder per client and uploads every file:

```
/JVO Mailbox Applications/
  Acme LLC - Robinson/                          ← business:    "<Company> - <Last>"
    PS-Form-1583-Robinson-2026-08-06.pdf
    Photo-ID-front-Robinson-2026-08-06.jpg
    Photo-ID-back-Robinson-2026-08-06.jpg
    Address-Proof-1-Robinson-2026-08-06.jpg
  Robinson, Robert/                             ← residential: "<Last>, <First>"
```

Nothing is ever overwritten. A repeat submission on the same day becomes `... (1).pdf`.
Uploads are all-or-nothing — if any file fails, the applicant is told to retry rather than
JVO being left with a folder that only looks complete.

**b. Google Sheets master list** — appends one row:

| Column | Filled by |
|---|---|
| Submitted, Name, Company, Email, Phone, Address, Type of Business, Plan, Dropbox Folder, Documents | Automatic |
| **Suite #** | **Staff** — assigned at the visit |
| **Status** | Starts at `New`, then staff |
| **Notes** | **Staff** |
| Invoice #, Invoice Total, Invoice Status, Balance Due | Automatic — written by the invoicing desk (see `invoicing.md`) |

**Submitted is a date AND a time** (office-local, e.g. `2026-09-09 2:41 PM`), like the events
site. A bare date can't tell two same-day applications apart, and staff work the list in
arrival order. The column is also given a real date-time *number format* on first write —
without that, Sheets stores the value as a date serial and a number-formatted column
displays it as `46274`.

**Columns are addressed by header name, never by position.** The live sheet is edited by
people: columns get added, renamed, and moved, and a positional write eventually lands a
phone number under "Suite #". A few spellings are accepted as synonyms ("Submission Date"
counts as "Submitted"), and any column we need but can't find is appended to the right.

Appends never touch an existing row. The *only* cells ever overwritten are the four billing
columns, on the row an invoice was raised for — so anything the team types is safe.

**c. Team email** — subject `New member signup — <Name>`, containing the applicant's contact
details, plan, which documents they uploaded, the Dropbox folder path, and a reminder to
assign a suite number. Reply-to is set to the applicant, so hitting reply reaches them directly.
Set `NOTIFY_TO` to a comma-separated list to copy the whole team.

### 6. Staff prep

Before the client arrives, staff open the Dropbox folder and can already check the ID hasn't
expired, that the name matches, and that the address on the proof matches the form.

### 7. The in-office visit — unchanged in substance

The applicant brings their **original** documents; JVO brings the **printed, unsigned** form.
Staff inspect the originals, witness the signature, complete the JVO sections, and file the
form with USPS.

> **The uploads never replace this.** USPS requires the CMRA to physically inspect original
> identification. The photos exist so the visit starts prepared, not so it can be skipped.

---

## Privacy and security notes

- ID images are held in browser memory only — never written to `localStorage`, so closing
  the tab disposes of them.
- Dropbox credentials and the Google service-account key live only in server environment
  variables. Neither is ever present in the frontend bundle.
- **No public share links are created.** The team email contains the Dropbox *path*, which
  staff open through their own authenticated Dropbox. An anyone-with-the-link URL to a folder
  of driver's licenses would be one forward away from exposure.
- Uploaded files are checked against their actual magic bytes, not just the declared type,
  so content can't be smuggled in under an image label. Limits: 8 MB per file, 20 MB total,
  10 files.
- Server logs record folder names only — never ID numbers or file contents.

### Retention — an open decision for JVO

The signed 1583 must be retained under USPS rules. The **ID images do not** — they only need
to exist until staff verify the originals at the visit. Keeping them indefinitely means JVO
accumulates a growing archive of customer government IDs. Worth setting a deliberate practice
(for example: staff delete the image files once the member is activated).

---

## Configuration

All values are environment variables — in `.env` locally, in the Render dashboard for production.
Locally, `pnpm dev:server` reads `.env` directly (Node's `--env-file-if-exists`), so filling in
the values below and restarting the dev server is all that's needed to test the real flow.

| Variable | What it is |
|---|---|
| `DROPBOX_APP_KEY` / `DROPBOX_APP_SECRET` | From the Dropbox App Console, Settings tab |
| `DROPBOX_REFRESH_TOKEN` | From the one-time OAuth authorization |
| `DROPBOX_ROOT` | Parent folder, default `/JVO Mailbox Applications` |
| `JVO_SHEET_ID` | The long ID in the spreadsheet URL: `/spreadsheets/d/<THIS>/edit` |
| `JVO_SHEET_TAB` | Tab name, default `Clients` |
| `SMTP_USER` / `SMTP_PASS` | Gmail address and a 16-character **App Password** |
| `NOTIFY_TO` | Who gets the signup alert; comma-separated for the team |

**The Dropbox app needs the `files.content.write` scope**, ticked and submitted on the
Permissions tab *before* authorizing. A token minted before the scope is granted stays
permanently unscoped — this is the single most common way this setup fails.

**The spreadsheet must be shared as an Editor** with the service-account address inside
`GOOGLE_SERVICE_ACCOUNT_JSON`, or the append returns 403.

## Where the code lives

| File | Role |
|---|---|
| `client/src/pages/MailboxApplication.tsx` | The wizard, validation, review screen |
| `client/src/components/DocumentUpload.tsx` | File picker with previews |
| `client/src/lib/imagePrep.ts` | Browser-side image downscaling |
| `client/src/lib/fill1583.ts` | Fills the official PDF |
| `client/src/lib/fileApplication.ts` | Sends everything to the server |
| `server/mailboxApplication.ts` | Intake, validation, Dropbox upload, email |
| `server/clientSheet.ts` | Master list — header-driven append, read, and billing write-back |
| `server/invoices.ts` | Invoicing desk + the customer pay page (see `invoicing.md`) |
| `server/googleAuth.ts` | Shared Google service-account auth |
