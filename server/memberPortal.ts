/**
 * Member onboarding portal (member-facing).
 * -----------------------------------------
 * Staff start onboarding from /admin; the member gets a tokenized link:
 *   GET  /onboard/:token                        — office-brand checklist page
 *   POST /onboard/:token/info                   — confirm/edit contact + business info
 *   POST /onboard/:token/documents/:kind        — upload license front/back, proof of residence
 *   POST /onboard/:token/form1583               — "I've downloaded my Form 1583"
 *   POST /onboard/:token/appointment            — pick the in-office visit slot
 *
 * Tokens are crypto-random per member (members.portal_token). Unknown tokens
 * get a friendly branded 404. A light in-memory rate limit (20 req/min/IP)
 * discourages token guessing without hurting real members.
 *
 * Uploads go to DISK at UPLOADS_DIR (default ./data/uploads) with random
 * stored filenames; 8 MB cap; images + PDF only (checked by mime AND
 * extension). Files are ONLY served back through the Basic-Auth'd admin route
 * (/api/admin/members/:id/documents/:kind) — never publicly.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import express from "express";
import multer from "multer";
import { getDb, nowIso } from "./db.js";
import {
  REQUIRED_DOC_KINDS,
  dayOfWeek,
  documentsFor,
  missingRequiredDocs,
  todayInOfficeTz,
  transition,
} from "./memberPipeline.js";
import {
  sendAppointmentConfirmation,
  sendStaffNotification,
  prettyAppointment,
} from "./memberEmail.js";

const UPLOADS_DIR = process.env.UPLOADS_DIR || "./data/uploads";

export const onboardRouter = express.Router();

/* ── Rate limit: 20 requests per minute per IP ────────────────────────── */
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60 * 1000;
const hits = new Map<string, { count: number; windowStart: number }>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const rec = hits.get(ip);
  if (!rec || now - rec.windowStart > RATE_WINDOW_MS) {
    hits.set(ip, { count: 1, windowStart: now });
    return false;
  }
  rec.count++;
  return rec.count > RATE_LIMIT;
}

setInterval(() => {
  const now = Date.now();
  hits.forEach((rec, ip) => {
    if (now - rec.windowStart > RATE_WINDOW_MS) hits.delete(ip);
  });
}, 5 * 60 * 1000).unref();

onboardRouter.use("/onboard", (req, res, next) => {
  if (rateLimited(req.ip || req.socket?.remoteAddress || "?")) {
    return res.status(429).type("html").send(page("Slow down", `
      <h1>One moment, <em>please.</em></h1>
      <p>Too many requests — please wait a minute and try again.</p>`));
  }
  next();
});

/* ── Uploads (multer → disk, random names, strict type check) ─────────── */

const ALLOWED_MIMES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/pdf",
]);
const ALLOWED_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif", ".pdf"]);
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024; // 8 MB

const storage = multer.diskStorage({
  destination(_req, _file, cb) {
    try {
      fs.mkdirSync(path.resolve(UPLOADS_DIR), { recursive: true });
      cb(null, path.resolve(UPLOADS_DIR));
    } catch (err: any) {
      cb(err, "");
    }
  },
  filename(_req, file, cb) {
    const ext = path.extname(file.originalname || "").toLowerCase();
    cb(null, `${crypto.randomBytes(16).toString("hex")}${ALLOWED_EXTS.has(ext) ? ext : ""}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
  fileFilter(_req, file, cb) {
    const ext = path.extname(file.originalname || "").toLowerCase();
    if (!ALLOWED_MIMES.has(file.mimetype) || !ALLOWED_EXTS.has(ext)) {
      return cb(new Error("Please upload a JPG, PNG, WEBP, HEIC, or PDF file."));
    }
    cb(null, true);
  },
});

/** Wrap multer so its errors come back as clean 400 JSON, not a 500.
 *  (Also used by the admin router for the signed-1583 upload.) */
export function uploadSingle(field: string) {
  const handler = upload.single(field);
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    handler(req, res, (err: any) => {
      if (err) {
        const msg =
          err.code === "LIMIT_FILE_SIZE"
            ? "That file is too large — the limit is 8 MB."
            : err.message || "Upload failed.";
        return res.status(400).json({ error: msg });
      }
      next();
    });
  };
}

/* ── Lookup + helpers ─────────────────────────────────────────────────── */

function lookup(token: unknown) {
  const db = getDb();
  if (!db) return { db: null as any, member: null as any };
  const t = String(token || "").trim();
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(t)) return { db, member: null };
  return { db, member: db.prepare("SELECT * FROM members WHERE portal_token = ?").get(t) as any };
}

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * After an upload or info change: advance documents_pending →
 * documents_complete once all three docs are in, then straight on to
 * appointment_scheduled when the member already picked their slot. Fires the
 * one-time staff "docs complete" notification.
 */
async function autoAdvance(db: any, memberId: number) {
  let member = db.prepare("SELECT * FROM members WHERE id = ?").get(memberId);
  if (!member) return;
  if (member.status === "documents_pending" && missingRequiredDocs(db, memberId).length === 0) {
    const moved = transition(db, memberId, "documents_complete", "member", "all documents uploaded");
    if (moved.ok) {
      member = moved.member;
      await notifyStaffOnce(db, member, "staff_docs_complete", `Documents complete — ${member.public_id}`, [
        `${member.name || "A new member"} (${member.public_id}) has uploaded all three onboarding documents.`,
        `Review them on the dashboard: /admin`,
      ]);
    }
  }
  if (member.status === "documents_complete" && member.appointment_at) {
    transition(db, memberId, "appointment_scheduled", "member", "appointment already picked");
  }
}

/** Send a staff notification once per member per kind (member_email_log dedupe). */
async function notifyStaffOnce(db: any, member: any, kind: string, subject: string, lines: string[]) {
  if (db.prepare("SELECT 1 FROM member_email_log WHERE member_id = ? AND kind = ?").get(member.id, kind)) return;
  try {
    await sendStaffNotification(subject, lines);
    db.prepare(
      "INSERT OR IGNORE INTO member_email_log (member_id, kind, to_email, sent_at) VALUES (?, ?, ?, ?)"
    ).run(member.id, kind, "staff", nowIso());
  } catch (err: any) {
    console.error(`[onboard] staff notification failed (${kind}):`, err?.message);
  }
}

/* ── Appointment slot rules ───────────────────────────────────────────── */

/** Weekday slots 9:00 AM – 4:30 PM, 30-minute granularity. */
export const APPOINTMENT_SLOTS: string[] = (() => {
  const out: string[] = [];
  for (let h = 9; h <= 16; h++) {
    out.push(`${String(h).padStart(2, "0")}:00`);
    out.push(`${String(h).padStart(2, "0")}:30`);
  }
  return out; // 09:00 … 16:30
})();

function slotLabel(t: string): string {
  let [h, m] = t.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${String(m).padStart(2, "0")} ${ampm}`;
}

/** Validate a requested slot: weekday, valid slot, at least 1 business day out. */
function validateSlot(date: string, time: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "Please pick a valid date.";
  if (!APPOINTMENT_SLOTS.includes(time)) return "Please pick a time between 9:00 AM and 4:30 PM.";
  const dow = dayOfWeek(date);
  if (dow === 0 || dow === 6) return "We schedule visits Monday through Friday — please pick a weekday.";
  const today = todayInOfficeTz();
  if (date <= today) return "Please pick a date at least one business day from today.";
  return null;
}

/* ── JSON endpoints ───────────────────────────────────────────────────── */

function requireMemberJson(req: express.Request, res: express.Response) {
  const { db, member } = lookup(req.params.token);
  if (!db) {
    res.status(503).json({ error: "Temporarily unavailable — please try again shortly." });
    return null;
  }
  if (!member) {
    res.status(404).json({ error: "This link isn't valid." });
    return null;
  }
  if (["denied", "cancelled"].includes(member.status)) {
    res.status(409).json({ error: "This onboarding is closed. Call (678) 519-4723 if you think this is a mistake." });
    return null;
  }
  return { db, member };
}

/** Step (a): confirm/edit contact + business info. */
onboardRouter.post("/onboard/:token/info", express.json(), async (req, res) => {
  const ctx = requireMemberJson(req, res);
  if (!ctx) return;
  const { db, member } = ctx;
  const b = req.body || {};

  const name = String(b.name ?? member.name ?? "").trim().slice(0, 200);
  if (!name) return res.status(400).json({ error: "Please tell us your name." });
  const phone = String(b.phone ?? "").trim().slice(0, 50);
  const businessName = String(b.business_name ?? "").trim().slice(0, 300);
  const businessAddress = String(b.business_address ?? "").trim().slice(0, 600);
  const mailingPrefs = String(b.mailing_prefs ?? "").trim().slice(0, 600);
  let authorizedUsers = "";
  if (b.authorized_users != null) {
    const list = Array.isArray(b.authorized_users)
      ? b.authorized_users.map((x: unknown) => String(x).trim().slice(0, 200)).filter(Boolean).slice(0, 10)
      : String(b.authorized_users)
          .split(/[\n,]+/)
          .map((x) => x.trim().slice(0, 200))
          .filter(Boolean)
          .slice(0, 10);
    authorizedUsers = JSON.stringify(list);
  }

  const at = nowIso();
  db.prepare(
    `UPDATE members SET name = ?, phone = ?, business_name = ?, business_address = ?,
       mailing_prefs = ?, authorized_users = ?, info_confirmed_at = COALESCE(info_confirmed_at, ?), updated_at = ?
     WHERE id = ?`
  ).run(name, phone, businessName, businessAddress, mailingPrefs, authorizedUsers, at, at, member.id);

  if (member.status === "awaiting_onboarding") {
    transition(db, member.id, "documents_pending", "member", "contact + business info confirmed");
  }
  await autoAdvance(db, member.id);
  res.json({ ok: true });
});

/** Steps (b)+(c): document uploads. Re-upload replaces the previous file. */
onboardRouter.post("/onboard/:token/documents/:kind", uploadSingle("file"), async (req, res) => {
  const ctx = requireMemberJson(req, res);
  if (!ctx) {
    if (req.file) fs.promises.unlink(req.file.path).catch(() => undefined);
    return;
  }
  const { db, member } = ctx;
  const kind = String(req.params.kind || "");
  if (!(REQUIRED_DOC_KINDS as readonly string[]).includes(kind)) {
    if (req.file) fs.promises.unlink(req.file.path).catch(() => undefined);
    return res.status(400).json({ error: "Unknown document type." });
  }
  if (!req.file) return res.status(400).json({ error: "Please choose a file to upload." });

  const at = nowIso();
  const previous = db
    .prepare("SELECT * FROM member_documents WHERE member_id = ? AND kind = ?")
    .get(member.id, kind) as any;
  db.prepare(
    `INSERT INTO member_documents (member_id, kind, filename, stored_path, mime, size, uploaded_at)
     VALUES (@member_id, @kind, @filename, @stored_path, @mime, @size, @at)
     ON CONFLICT(member_id, kind) DO UPDATE SET
       filename = @filename, stored_path = @stored_path, mime = @mime, size = @size, uploaded_at = @at`
  ).run({
    member_id: member.id,
    kind,
    filename: String(req.file.originalname || "upload").slice(0, 300),
    stored_path: req.file.path,
    mime: req.file.mimetype,
    size: req.file.size,
    at,
  });
  db.prepare("UPDATE members SET updated_at = ? WHERE id = ?").run(at, member.id);
  if (previous?.stored_path && previous.stored_path !== req.file.path) {
    fs.promises.unlink(previous.stored_path).catch(() => undefined);
  }

  await autoAdvance(db, member.id);
  res.json({ ok: true });
});

/** Step (d): the member confirms they downloaded their filled Form 1583. */
onboardRouter.post("/onboard/:token/form1583", express.json(), (req, res) => {
  const ctx = requireMemberJson(req, res);
  if (!ctx) return;
  const { db, member } = ctx;
  if (!req.body?.downloaded) {
    return res.status(400).json({ error: "Check the box once you've downloaded your form." });
  }
  const at = nowIso();
  db.prepare(
    "UPDATE members SET form1583_downloaded_at = COALESCE(form1583_downloaded_at, ?), updated_at = ? WHERE id = ?"
  ).run(at, at, member.id);
  res.json({ ok: true });
});

/** Step (e): pick the in-office visit slot. */
onboardRouter.post("/onboard/:token/appointment", express.json(), async (req, res) => {
  const ctx = requireMemberJson(req, res);
  if (!ctx) return;
  const { db, member } = ctx;
  const date = String(req.body?.date || "");
  const time = String(req.body?.time || "");
  const problem = validateSlot(date, time);
  if (problem) return res.status(400).json({ error: problem });

  const at = nowIso();
  const appointmentAt = `${date}T${time}`;
  db.prepare("UPDATE members SET appointment_at = ?, updated_at = ? WHERE id = ?").run(
    appointmentAt,
    at,
    member.id
  );
  if (member.status === "documents_complete") {
    transition(db, member.id, "appointment_scheduled", "member", `visit scheduled for ${appointmentAt}`);
  }

  const fresh = db.prepare("SELECT * FROM members WHERE id = ?").get(member.id) as any;
  try {
    await sendAppointmentConfirmation(fresh);
    await sendStaffNotification(`New onboarding visit — ${fresh.public_id}`, [
      `${fresh.name || "A new member"} (${fresh.public_id}) scheduled their in-office visit:`,
      prettyAppointment(fresh.appointment_at),
      `Membership: ${fresh.membership_type || "—"} · Email: ${fresh.email || "—"} · Phone: ${fresh.phone || "—"}`,
    ]);
  } catch (err: any) {
    console.error("[onboard] appointment emails failed:", err?.message);
  }
  res.json({ ok: true, appointment_at: appointmentAt });
});

/* ── The checklist page ───────────────────────────────────────────────── */

/** Office-brand page shell — light, minimal, serif headings, black buttons. */
function page(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${esc(title)} — Jonesboro Virtual Office</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,600;1,600&family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  * { box-sizing:border-box; margin:0; padding:0; }
  body { background:#FAFAFA; color:#0A0A0A; font-family:'DM Sans',Arial,sans-serif; min-height:100vh; display:flex; flex-direction:column; align-items:center; padding:44px 16px; }
  .wrap { width:100%; max-width:680px; }
  .brand { margin-bottom:30px; }
  .brand .word { font-size:11px; font-weight:600; letter-spacing:3px; text-transform:uppercase; color:#0A0A0A; }
  .brand .sub { font-size:11px; letter-spacing:2px; text-transform:uppercase; color:#6B7280; margin-top:4px; }
  h1 { font-family:'Cormorant Garamond',Georgia,serif; font-weight:600; font-size:36px; line-height:1.15; margin-bottom:10px; }
  h1 em { font-style:italic; }
  .lede { color:#1C1C1E; font-size:15px; line-height:1.65; margin-bottom:26px; max-width:56ch; }
  .progress { display:flex; gap:6px; margin-bottom:26px; }
  .progress span { flex:1; height:3px; background:#E5E5E5; border-radius:2px; }
  .progress span.done { background:#0A0A0A; }
  .step { background:#FFFFFF; border:1px solid #E5E5E5; border-radius:4px; padding:24px 26px; margin-bottom:14px; }
  .step.done { border-left:2px solid #0A0A0A; }
  .step .tag { font-size:10px; font-weight:600; letter-spacing:2.5px; text-transform:uppercase; color:#6B7280; margin-bottom:6px; }
  .step.done .tag { color:#0A0A0A; }
  .step h2 { font-family:'Cormorant Garamond',Georgia,serif; font-weight:600; font-size:23px; margin-bottom:8px; }
  .step h2 em { font-style:italic; }
  .step p { font-size:14px; line-height:1.65; color:#1C1C1E; margin-bottom:12px; max-width:58ch; }
  label { display:block; font-size:10px; font-weight:600; letter-spacing:2px; text-transform:uppercase; color:#6B7280; margin:14px 0 6px; }
  input[type=text], input[type=tel], input[type=email], input[type=date], select, textarea {
    width:100%; background:#FFFFFF; border:1px solid #D6D6D6; border-radius:4px; color:#0A0A0A;
    padding:11px 12px; font-family:'DM Sans',Arial,sans-serif; font-size:15px; }
  input:focus, select:focus, textarea:focus { outline:none; border-color:#0A0A0A; }
  input[readonly] { background:#F5F5F5; color:#6B7280; }
  textarea { min-height:70px; resize:vertical; }
  .grid2 { display:grid; grid-template-columns:1fr 1fr; gap:0 16px; }
  @media (max-width:560px){ .grid2 { grid-template-columns:1fr; } }
  button { font-family:'DM Sans',Arial,sans-serif; font-size:12px; font-weight:600; letter-spacing:1.5px; text-transform:uppercase;
    padding:13px 24px; cursor:pointer; background:#0A0A0A; color:#FFFFFF; border:1px solid #0A0A0A; border-radius:4px; margin-top:16px; }
  button:hover { background:#1C1C1E; }
  button:disabled { opacity:.4; cursor:not-allowed; }
  .filelbl { display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin-top:8px; }
  input[type=file] { font-size:13px; }
  .have { font-size:13px; color:#1C1C1E; background:#F5F5F5; border-radius:4px; padding:8px 12px; display:inline-block; margin-top:8px; }
  .checkrow { display:flex; gap:10px; align-items:flex-start; margin-top:10px; font-size:14px; line-height:1.5; color:#1C1C1E; }
  .checkrow input { margin-top:3px; }
  .note { font-size:13px; color:#6B7280; line-height:1.6; }
  .err { color:#B42318; font-size:13px; margin-top:10px; display:none; }
  .okmsg { color:#0A0A0A; font-size:13px; margin-top:10px; display:none; }
  a { color:#0A0A0A; }
  .foot { color:#6B7280; font-size:12px; margin-top:26px; line-height:1.7; }
  .confirmed { border-left:2px solid #0A0A0A; background:#F5F5F5; border-radius:4px; padding:12px 16px; font-size:14px; margin-top:6px; }
</style>
</head>
<body>
  <div class="wrap">
    <div class="brand">
      <div class="word">Jonesboro Virtual Office</div>
      <div class="sub">Member Onboarding</div>
    </div>
    ${bodyHtml}
    <div class="foot">Questions? Email <a href="mailto:jonesborovirtualoffice@gmail.com">jonesborovirtualoffice@gmail.com</a> or call (678) 519-4723.<br>127 Jonesboro Rd, Suite 100, Jonesboro, GA 30236</div>
  </div>
</body>
</html>`;
}

const NOT_FOUND_HTML = `
  <h1>We couldn't find that <em>link.</em></h1>
  <p class="lede">This onboarding link isn't valid — it may have been mistyped or replaced by a newer one.</p>
  <p class="lede">No worries: reply to your welcome email, or reach us at jonesborovirtualoffice@gmail.com / (678) 519-4723, and we'll send you a fresh link.</p>`;

const DOC_STEPS: { kind: string; label: string; hint: string }[] = [
  { kind: "license_front", label: "Driver's license — front", hint: "A clear photo or scan of the front of your driver's license or state ID." },
  { kind: "license_back", label: "Driver's license — back", hint: "The back of the same license or ID." },
  { kind: "proof_of_residence", label: "Proof of residence", hint: "A document showing your home address — lease, utility bill, vehicle registration, or voter card. USPS requires this in addition to your photo ID." },
];

onboardRouter.get("/onboard/:token", (req, res) => {
  const { db, member } = lookup(req.params.token);
  if (!db) {
    return res.status(503).type("html").send(page("Temporarily unavailable", `
      <h1>One moment, <em>please.</em></h1>
      <p class="lede">This page is temporarily unavailable. Please try again shortly, or reply to your welcome email and we'll take care of it.</p>`));
  }
  if (!member) return res.status(404).type("html").send(page("Link not found", NOT_FOUND_HTML));

  if (["denied", "cancelled"].includes(member.status)) {
    return res.type("html").send(page("Onboarding closed", `
      <h1>This onboarding is <em>closed.</em></h1>
      <p class="lede">If you think this is a mistake, call us at (678) 519-4723 or email jonesborovirtualoffice@gmail.com and we'll sort it out.</p>`));
  }

  const docs = documentsFor(db, member.id);
  const docByKind = new Map<string, any>(docs.map((d: any) => [d.kind, d]));
  const missing = missingRequiredDocs(db, member.id);
  const infoDone = Boolean(member.info_confirmed_at);
  const docsDone = missing.length === 0;
  const formDone = Boolean(member.form1583_downloaded_at);
  const apptDone = Boolean(member.appointment_at);
  const isActive = member.status === "active";

  const doneCount = [infoDone, docsDone, formDone, apptDone].filter(Boolean).length;
  const progress = `<div class="progress">${[infoDone, docsDone, formDone, apptDone]
    .map((d) => `<span class="${d ? "done" : ""}"></span>`)
    .join("")}</div>`;

  if (isActive) {
    return res.type("html").send(page("Membership active", `
      <h1>Welcome — you're <em>active.</em></h1>
      <p class="lede">Your membership <strong>${esc(member.public_id)}</strong> is fully active. Watch your inbox for your welcome email with mail-pickup details, and reach out any time you need us.</p>`));
  }

  const authorizedUsersText = (() => {
    try {
      const parsed = JSON.parse(member.authorized_users || "[]");
      return Array.isArray(parsed) ? parsed.join("\n") : "";
    } catch {
      return "";
    }
  })();

  const uploadBlocks = DOC_STEPS.map((d) => {
    const have = docByKind.get(d.kind);
    return `
      <label>${esc(d.label)}</label>
      <div class="note">${esc(d.hint)}</div>
      ${have ? `<div class="have">On file: ${esc(have.filename)} (${new Date(have.uploaded_at).toLocaleDateString("en-US")}) — upload again to replace.</div>` : ""}
      <div class="filelbl">
        <input type="file" id="file-${d.kind}" accept=".jpg,.jpeg,.png,.webp,.heic,.pdf,image/jpeg,image/png,image/webp,image/heic,application/pdf">
        <button type="button" onclick="uploadDoc('${d.kind}')">${have ? "Replace" : "Upload"}</button>
      </div>`;
  }).join("");

  // Earliest selectable date: tomorrow (weekends rejected server-side too).
  const today = todayInOfficeTz();
  const [ty, tm, td] = today.split("-").map(Number);
  const minDate = new Date(Date.UTC(ty, tm - 1, td + 1)).toISOString().slice(0, 10);
  const slotOptions = APPOINTMENT_SLOTS.map(
    (t) => `<option value="${t}">${slotLabel(t)}</option>`
  ).join("");

  const needsCorrection = ["missing_documents", "needs_correction"].includes(member.status);

  const body = `
    <h1>Let's activate your <em>membership.</em></h1>
    <p class="lede">Hi ${esc((member.name || "there").split(/\s+/)[0])} — welcome to Jonesboro Virtual Office. Your membership <strong>${esc(member.public_id)}</strong> is ${doneCount} of 4 steps from ready. Finish the checklist below, then we'll see you for a quick visit to make it official.</p>
    ${needsCorrection ? `<p class="lede" style="border-left:2px solid #0A0A0A;background:#F5F5F5;border-radius:4px;padding:12px 16px">Our team flagged something that needs your attention — check your email for the details, update the items below, and we'll take another look.</p>` : ""}
    ${progress}

    <div class="step ${infoDone ? "done" : ""}">
      <div class="tag">Step 1 ${infoDone ? "· Done" : ""}</div>
      <h2>Confirm your <em>details.</em></h2>
      <p>Make sure we have your business exactly right — this is what goes on your mailbox record.</p>
      <div class="grid2">
        <div><label for="f-name">Full name</label><input type="text" id="f-name" value="${esc(member.name)}"></div>
        <div><label for="f-phone">Phone</label><input type="tel" id="f-phone" value="${esc(member.phone)}"></div>
      </div>
      <label for="f-email">Email</label><input type="email" id="f-email" value="${esc(member.email)}" readonly>
      <label for="f-bizname">Business name</label><input type="text" id="f-bizname" value="${esc(member.business_name)}" placeholder="Your registered business name (or leave blank if personal)">
      <label for="f-bizaddr">Business address on file</label><input type="text" id="f-bizaddr" value="${esc(member.business_address)}" placeholder="Street, city, state, ZIP">
      <label for="f-auth">Authorized users (one per line — anyone else who may collect mail)</label>
      <textarea id="f-auth" placeholder="Optional">${esc(authorizedUsersText)}</textarea>
      <label for="f-mail">Mail preferences</label>
      <textarea id="f-mail" placeholder="Optional — e.g. scan everything, forward weekly, shred junk mail">${esc(member.mailing_prefs)}</textarea>
      <button type="button" onclick="saveInfo()">${infoDone ? "Update Details" : "Confirm Details"}</button>
      <div class="err" id="err-info"></div><div class="okmsg" id="ok-info"></div>
    </div>

    <div class="step ${docsDone ? "done" : ""}">
      <div class="tag">Step 2 ${docsDone ? "· Done" : ""}</div>
      <h2>Upload your <em>documents.</em></h2>
      <p>USPS requires two forms of ID before we can accept mail on your behalf. Files stay private — only JVO staff can view them. JPG, PNG, WEBP, HEIC, or PDF, up to 8&nbsp;MB each.</p>
      ${uploadBlocks}
      <div class="err" id="err-docs"></div><div class="okmsg" id="ok-docs"></div>
    </div>

    <div class="step ${formDone ? "done" : ""}">
      <div class="tag">Step 3 ${formDone ? "· Done" : ""}</div>
      <h2>Prepare your USPS Form <em>1583.</em></h2>
      <p>Every mailbox needs a USPS Form 1583. Our online wizard fills it out for you in about five minutes — nothing leaves your device. Download the finished PDF and bring it to your visit <strong>unsigned</strong>; we witness and notarize your signature in person.</p>
      <p><a href="/mailbox-application" target="_blank" rel="noopener">Open the Form 1583 wizard →</a></p>
      <div class="checkrow">
        <input type="checkbox" id="f-1583" ${formDone ? "checked disabled" : ""}>
        <span>I've completed the wizard and downloaded my Form 1583.</span>
      </div>
      ${formDone ? "" : `<button type="button" onclick="mark1583()">Mark This Step Done</button>`}
      <div class="err" id="err-1583"></div>
    </div>

    <div class="step ${apptDone ? "done" : ""}">
      <div class="tag">Step 4 ${apptDone ? "· Done" : ""}</div>
      <h2>Schedule your <em>visit.</em></h2>
      <p>A quick in-office stop finishes everything: we verify your ID, notarize your Form 1583, and activate your membership. Weekdays, 9:00 AM – 4:30 PM.</p>
      ${apptDone ? `<div class="confirmed">Your visit is scheduled for <strong>${esc(prettyAppointment(member.appointment_at))}</strong>. Need a different time? Pick a new slot below and we'll update it.</div>` : ""}
      <div class="grid2">
        <div><label for="f-date">Date</label><input type="date" id="f-date" min="${minDate}"></div>
        <div><label for="f-time">Time</label><select id="f-time">${slotOptions}</select></div>
      </div>
      <button type="button" onclick="pickSlot()">${apptDone ? "Reschedule Visit" : "Schedule Visit"}</button>
      <div class="err" id="err-appt"></div>
    </div>

    <script>
      const TOKEN = ${JSON.stringify(String(member.portal_token))};
      function show(id, msg){ const el=document.getElementById(id); if(!el) return; el.textContent=msg; el.style.display="block"; }
      async function post(path, opts){
        const r = await fetch("/onboard/"+TOKEN+path, opts);
        const j = await r.json().catch(()=>({}));
        if(!r.ok) throw new Error(j.error || "Something went wrong — please try again.");
        return j;
      }
      async function saveInfo(){
        try {
          await post("/info", {method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({
            name: document.getElementById("f-name").value,
            phone: document.getElementById("f-phone").value,
            business_name: document.getElementById("f-bizname").value,
            business_address: document.getElementById("f-bizaddr").value,
            authorized_users: document.getElementById("f-auth").value,
            mailing_prefs: document.getElementById("f-mail").value
          })});
          location.reload();
        } catch(e){ show("err-info", e.message); }
      }
      async function uploadDoc(kind){
        const input = document.getElementById("file-"+kind);
        if(!input.files || !input.files[0]) return show("err-docs", "Choose a file first.");
        const fd = new FormData();
        fd.append("file", input.files[0]);
        try { await post("/documents/"+kind, {method:"POST", body: fd}); location.reload(); }
        catch(e){ show("err-docs", e.message); }
      }
      async function mark1583(){
        if(!document.getElementById("f-1583").checked) return show("err-1583", "Check the box once you've downloaded your form.");
        try { await post("/form1583", {method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({downloaded:true})}); location.reload(); }
        catch(e){ show("err-1583", e.message); }
      }
      async function pickSlot(){
        const date = document.getElementById("f-date").value;
        const time = document.getElementById("f-time").value;
        if(!date) return show("err-appt", "Pick a date first.");
        try { await post("/appointment", {method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({date, time})}); location.reload(); }
        catch(e){ show("err-appt", e.message); }
      }
    </script>`;

  res.type("html").send(page("Activate your membership", body));
});
