/*
 * Mailbox application intake — POST /api/mailbox-application
 *
 * The browser generates the filled PS Form 1583 (client/src/lib/fill1583.ts) and posts
 * it here together with the applicant's uploaded photo ID (front + back) and proof of
 * address. For each application we:
 *   1. file every file into Dropbox under one per-client folder,
 *   2. append a row to the client master sheet (clientSheet.ts),
 *   3. email the JVO team that a new member signed up.
 *
 * Dropbox auth uses a refresh token from a Dropbox *app* (App Console -> scoped access),
 * NOT an account password. Short-lived access tokens are minted on demand and cached in
 * memory. Required scope: files.content.write. Secrets live only in env vars.
 *
 * We deliberately do NOT create public Dropbox share links: these folders hold
 * photographs of government IDs, and an anyone-with-the-link URL in an email is one
 * forward away from exposing them. Staff open the folder path through their own
 * authenticated Dropbox instead.
 *
 * Uploads are all-or-nothing. A half-filled folder is worse than none, because staff
 * would prep a visit against an application that only looks complete.
 */
import type { Express, Request, Response } from "express";
import express from "express";
import nodemailer from "nodemailer";
import { appendClientRow, submissionStamp } from "./clientSheet.js";
import { sendApplicationWelcome } from "./memberEmail.js";

const DROPBOX_ROOT = process.env.DROPBOX_ROOT || "/JVO Mailbox Applications";
/** Where the applicant finishes registration — the next step in their welcome email. */
const REGISTRATION_URL =
  process.env.DESKWORKS_SIGNUP_URL || "https://jvo.satellitedeskworks.com/member-sign-up";
const MAX_PDF_BYTES = 5 * 1024 * 1024;
const MAX_DOC_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;
const MAX_DOCS = 10;

/* ── Dropbox ──────────────────────────────────────────────────────────── */
type DropboxCfg = { appKey: string; appSecret: string; refreshToken: string };

function dropboxCfg(): DropboxCfg | null {
  const appKey = process.env.DROPBOX_APP_KEY;
  const appSecret = process.env.DROPBOX_APP_SECRET;
  const refreshToken = process.env.DROPBOX_REFRESH_TOKEN;
  if (!appKey || !appSecret || !refreshToken) return null;
  return { appKey, appSecret, refreshToken };
}

let cachedToken: { value: string; expiresAt: number } | null = null;

async function accessToken(cfg: DropboxCfg): Promise<string> {
  // Refresh a minute early so a token can't expire mid-upload.
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;
  const basic = Buffer.from(`${cfg.appKey}:${cfg.appSecret}`).toString("base64");
  const res = await fetch("https://api.dropboxapi.com/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: cfg.refreshToken }),
  });
  if (!res.ok) throw new Error(`Dropbox token refresh failed (${res.status}): ${await res.text()}`);
  const json = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { value: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  return cachedToken.value;
}

// Dropbox-API-Arg must be HTTP-header-safe ASCII, so escape anything above 0x7F.
function asciiJson(value: unknown): string {
  let out = "";
  for (const ch of JSON.stringify(value)) {
    const code = ch.charCodeAt(0);
    out += code > 0x7f ? `\\u${code.toString(16).padStart(4, "0")}` : ch;
  }
  return out;
}

/** Upload one file. Content-type agnostic — used for the PDF and the ID images alike. */
async function uploadFile(cfg: DropboxCfg, dropboxPath: string, bytes: Buffer): Promise<void> {
  const res = await fetch("https://content.dropboxapi.com/2/files/upload", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${await accessToken(cfg)}`,
      "Content-Type": "application/octet-stream",
      "Dropbox-API-Arg": asciiJson({
        path: dropboxPath,
        mode: "add",
        autorename: true, // a re-submission the same day becomes "... (1)", never an overwrite
        mute: false,
      }),
    },
    body: new Uint8Array(bytes),
  });
  if (!res.ok) throw new Error(`Dropbox upload failed (${res.status}): ${await res.text()}`);
}

/* ── Naming ───────────────────────────────────────────────────────────── */
// Dropbox rejects / \ and control chars in names; the rest is just tidiness.
function safeName(raw: string): string {
  return raw
    .replace(/[\/\\:*?"<>|]/g, " ")
    .replace(/[\x00-\x1f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

/**
 * Business  -> "Acme LLC - Robinson"
 * Residential -> "Robinson, Robert"
 * Falls back to something non-empty so a folder is never named "".
 */
export function clientFolderName(a: Applicant): string {
  const last = safeName(a.lastName || "");
  const first = safeName(a.firstName || "");
  const company = a.serviceType === "business" ? safeName(a.businessName || "") : "";
  const name = company
    ? `${company}${last ? ` - ${last}` : ""}`
    : [last, first].filter(Boolean).join(", ");
  return name || "Unnamed Applicant";
}

/* ── Payload validation ───────────────────────────────────────────────── */
export type DocKind = "photo-id-front" | "photo-id-back" | "address-proof";
const DOC_KINDS: DocKind[] = ["photo-id-front", "photo-id-back", "address-proof"];

const MAGIC: Record<string, (b: Buffer) => boolean> = {
  "application/pdf": (b) => b.subarray(0, 5).toString("latin1") === "%PDF-",
  "image/jpeg": (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  "image/png": (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
};

/**
 * Decode base64 to bytes, rejecting anything that isn't actually the declared type.
 * Sniffing magic bytes matters here: the declared mime comes from the browser and a
 * caller could claim "image/jpeg" for arbitrary content.
 */
function decodeBase64(b64: unknown, mime: string, maxBytes: number): Buffer | null {
  if (typeof b64 !== "string" || !b64) return null;
  // Reject oversized payloads before allocating the decoded buffer.
  if (b64.length > (maxBytes / 3) * 4 + 1024) return null;
  const buf = Buffer.from(b64, "base64");
  if (buf.length === 0 || buf.length > maxBytes) return null;
  const check = MAGIC[mime];
  if (!check || !check(buf)) return null;
  return buf;
}

interface IncomingDoc { kind: DocKind; filename: string; mime: string; bytes: Buffer }

/** Validate the documents array, or return a message explaining what's wrong. */
function parseDocuments(raw: unknown): { docs: IncomingDoc[] } | { error: string } {
  if (!Array.isArray(raw)) return { error: "documents must be an array." };
  if (raw.length > MAX_DOCS) return { error: `Too many files (limit ${MAX_DOCS}).` };

  const docs: IncomingDoc[] = [];
  let total = 0;
  for (const d of raw) {
    const kind = d?.kind;
    if (!DOC_KINDS.includes(kind)) return { error: `Unknown document type "${kind}".` };
    const mime = String(d?.mime || "");
    if (!(mime in MAGIC)) return { error: `Unsupported file type "${mime}". Use JPEG, PNG, or PDF.` };
    const bytes = decodeBase64(d?.base64, mime, MAX_DOC_BYTES);
    if (!bytes) return { error: `"${d?.filename || kind}" is empty, too large, or not a valid ${mime}.` };
    total += bytes.length;
    if (total > MAX_TOTAL_BYTES) return { error: "Those files add up to more than 20 MB in total." };
    docs.push({ kind, filename: String(d?.filename || kind), mime, bytes });
  }

  // The browser already gates on these, but enforce them here too: a folder that
  // is missing a side of the ID looks complete to staff prepping a visit.
  const missing = [
    docs.some((d) => d.kind === "photo-id-front") ? null : "the front of your photo ID",
    docs.some((d) => d.kind === "photo-id-back") ? null : "the back of your photo ID",
    docs.some((d) => d.kind === "address-proof") ? null : "your proof of address",
  ].filter(Boolean);
  if (missing.length) return { error: `Missing ${missing.join(", ")}.` };

  return { docs };
}

const extFor = (mime: string) => (mime === "application/pdf" ? ".pdf" : mime === "image/png" ? ".png" : ".jpg");

/** Deterministic, sortable Dropbox filenames so a folder reads at a glance. */
function documentFilenames(docs: IncomingDoc[], last: string, stamp: string): string[] {
  let addressN = 0;
  return docs.map((d) => {
    const ext = extFor(d.mime);
    if (d.kind === "photo-id-front") return `Photo-ID-front-${last}-${stamp}${ext}`;
    if (d.kind === "photo-id-back") return `Photo-ID-back-${last}-${stamp}${ext}`;
    return `Address-Proof-${++addressN}-${last}-${stamp}${ext}`;
  });
}

/** Human summary for the email and the sheet, e.g. "ID front, ID back, 2 address files". */
function describeDocuments(docs: IncomingDoc[]): string {
  const addr = docs.filter((d) => d.kind === "address-proof").length;
  return [
    docs.some((d) => d.kind === "photo-id-front") ? "ID front" : null,
    docs.some((d) => d.kind === "photo-id-back") ? "ID back" : null,
    addr ? `${addr} address ${addr === 1 ? "file" : "files"}` : null,
  ].filter(Boolean).join(", ") || "none";
}

/* ── Notification ─────────────────────────────────────────────────────── */
function mailer() {
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!user || !pass) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: Number(process.env.SMTP_PORT || 465),
    secure: true,
    auth: { user, pass },
  });
}

async function notifyTeam(a: Applicant, folder: string, docSummary: string, plan: string, sheetRow: number | null) {
  const transport = mailer();
  // NOTIFY_TO accepts a comma-separated list so the whole team is copied.
  const to = process.env.NOTIFY_TO || process.env.SMTP_USER;
  if (!transport || !to) {
    console.warn("mailbox-application: SMTP not configured, skipping notification");
    return false;
  }
  const who = [a.firstName, a.lastName].filter(Boolean).join(" ") || "New applicant";
  const lines = [
    `${who} signed up as a new member on jonesborovirtualoffice.com.`,
    ``,
    `Plan:        ${plan || "—"}`,
    `Service:     ${a.serviceType === "business" ? "Business / Organization" : "Residential / Personal"}`,
    ...(a.businessName ? [`Business:    ${a.businessName}${a.businessType ? ` (${a.businessType})` : ""}`] : []),
    `Phone:       ${a.phone || "—"}`,
    `Email:       ${a.email || "—"}`,
    `Address:     ${a.homeAddress || "—"}`,
    `Photo ID:    ${a.photoIdLabel || "—"}`,
    `Address ID:  ${a.addressIdLabel || "—"}`,
    ...(a.courtProtected ? [`NOTE:        Court protection order — handle per USPS 1583 privacy rules.`] : []),
    ``,
    `Uploaded:    ${docSummary}`,
    `Dropbox:     ${DROPBOX_ROOT}/${folder}`,
    `Master list: ${sheetRow === null ? "NOT added — check the sheet configuration" : sheetRow ? `row ${sheetRow}` : "row added"}`,
    ``,
    `Next: assign a suite number in the master list, then write up their first invoice`,
    `from the invoicing desk (/admin/invoices) — it reads that same row.`,
    `The form is unsigned — they sign in front of staff at the in-office visit, where`,
    `the original IDs are inspected.`,
  ];
  try {
    await transport.sendMail({
      from: process.env.NOTIFY_FROM || `JVO Website <${process.env.SMTP_USER}>`,
      to,
      replyTo: a.email || undefined,
      subject: `New member signup — ${who}`,
      text: lines.join("\n"),
    });
    return true;
  } catch (e: any) {
    console.error("mailbox-application: notification failed", e?.message);
    return false;
  }
}

/* ── Route ────────────────────────────────────────────────────────────── */
export interface Applicant {
  serviceType: "residential" | "business" | string;
  firstName: string;
  lastName: string;
  businessName?: string;
  businessType?: string;
  phone?: string;
  email?: string;
  homeAddress?: string;
  photoIdLabel?: string;
  addressIdLabel?: string;
  courtProtected?: boolean;
}

export function mountMailboxApplication(app: Express) {
  // Bigger body limit than the global parser: the form runs ~1-2 MB and the ID images
  // add a few MB more even after the browser downscales them.
  app.post("/api/mailbox-application", express.json({ limit: "25mb" }), async (req: Request, res: Response) => {
    const cfg = dropboxCfg();
    if (!cfg) {
      return res.status(503).json({ error: "Document filing is not configured on the server yet." });
    }

    const { applicant, pdfBase64, plan, documents } = (req.body || {}) as {
      applicant?: Applicant; pdfBase64?: string; plan?: string; documents?: unknown;
    };
    if (!applicant?.lastName || !applicant?.firstName) {
      return res.status(400).json({ error: "Applicant name is required." });
    }
    const pdf = decodeBase64(pdfBase64, "application/pdf", MAX_PDF_BYTES);
    if (!pdf) return res.status(400).json({ error: "A valid PS Form 1583 PDF is required." });

    const parsed = parseDocuments(documents);
    if ("error" in parsed) return res.status(400).json({ error: parsed.error });
    const { docs } = parsed;

    const folderName = clientFolderName(applicant);
    const folderPath = `${DROPBOX_ROOT}/${folderName}`;
    const stamp = new Date().toISOString().slice(0, 10);
    const last = safeName(applicant.lastName);

    const files: { name: string; bytes: Buffer }[] = [
      { name: `PS-Form-1583-${last}-${stamp}.pdf`, bytes: pdf },
      ...documentFilenames(docs, last, stamp).map((name, i) => ({ name, bytes: docs[i].bytes })),
    ];

    try {
      for (const f of files) await uploadFile(cfg, `${folderPath}/${f.name}`, f.bytes);
    } catch (e: any) {
      // Log the folder, never the applicant's ID numbers or file contents.
      console.error(`mailbox-application: upload failed for "${folderName}"`, e?.message);
      return res.status(502).json({ error: "Could not file your documents to Dropbox." });
    }

    const docSummary = describeDocuments(docs);

    // Neither of these can fail the application — the Dropbox folder is the record of
    // truth, and the applicant is already done. We report what happened instead.
    const sheetRow = await appendClientRow({
      // Date AND time, office-local — staff work the list in arrival order, and
      // two applications on the same day have to be tellable apart.
      submitted: submissionStamp(),
      name: [applicant.firstName, applicant.lastName].filter(Boolean).join(" "),
      company: applicant.businessName || "",
      email: applicant.email || "",
      phone: applicant.phone || "",
      address: applicant.homeAddress || "",
      businessType: applicant.businessType || (applicant.serviceType === "business" ? "" : "Residential / Personal"),
      plan: String(plan || ""),
      folder: folderName,
      documents: docSummary,
    });
    const logged = sheetRow !== null;
    const notified = await notifyTeam(applicant, folderName, docSummary, String(plan || ""), sheetRow);

    /*
     * Welcome the applicant themselves. They have just handed over their ID and
     * their address; hearing nothing back is the wrong end of that exchange — and
     * this is their only written record of what to bring to the office.
     *
     * Never allowed to fail the application: their documents are already filed.
     */
    let welcomed = false;
    try {
      const result = await sendApplicationWelcome({
        to: applicant.email || "",
        firstName: applicant.firstName,
        plan: String(plan || ""),
        isBusiness: applicant.serviceType === "business",
        businessName: applicant.serviceType === "business" ? applicant.businessName : undefined,
        photoIdLabel: applicant.photoIdLabel,
        addressIdLabel: applicant.addressIdLabel,
        registrationUrl: REGISTRATION_URL,
      });
      welcomed = result.sent;
      if (!result.sent && applicant.email) {
        console.warn(`mailbox-application: welcome email not sent to ${applicant.email} (${result.skipped || "SMTP not configured"})`);
      }
    } catch (e: any) {
      console.error("mailbox-application: welcome email failed", e?.message);
    }

    console.log(
      `mailbox-application: filed "${folderName}" (${files.length} files, sheet=${logged ? `row ${sheetRow}` : "no"}, team=${notified}, welcome=${welcomed})`
    );
    res.json({ ok: true, folder: folderName, uploaded: files.length, notified, logged, welcomed });
  });
}
