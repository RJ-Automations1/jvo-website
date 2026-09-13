/**
 * Staff admin dashboard for the membership-activation pipeline.
 * -------------------------------------------------------------
 * Express-served (NOT part of the Vite SPA):
 *   GET  /admin                                  — self-contained dashboard page
 *   GET  /api/admin/members?status=              — list members
 *   POST /api/admin/members                      — "Start Onboarding" (name/email/type)
 *   GET  /api/admin/members/:id                  — one member + docs + history
 *   POST /api/admin/members/:id/transition       {to, note}
 *   PATCH /api/admin/members/:id                 {notes}
 *   POST /api/admin/members/:id/resend-portal    — resend the welcome/portal email
 *   POST /api/admin/members/:id/signed-1583      — upload the signed 1583 copy
 *   POST /api/admin/members/:id/approve          — → active + welcome-active email
 *   POST /api/admin/members/:id/needs-correction {note} — → needs_correction + email
 *   GET  /api/admin/members/:id/documents/:kind  — stream an uploaded doc (AUTHED —
 *                                                  uploads are never publicly reachable)
 *   POST /api/admin/members-sweep?dryRun=1       — run the daily sweep on demand
 *
 * All routes sit behind HTTP Basic Auth (ADMIN_USER / ADMIN_PASSWORD env vars,
 * timing-safe compare). If those aren't set the routes answer 503 — nothing is
 * ever exposed unauthenticated by accident.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import express from "express";
import { getDb, nowIso } from "./db.js";
import {
  DOC_KINDS,
  STATUSES,
  allowedTransitionsFor,
  createMember,
  documentsFor,
  portalUrlFor,
  transition,
} from "./memberPipeline.js";
import { uploadSingle } from "./memberPortal.js";
import {
  sendMemberWelcome,
  sendMembershipActive,
  sendNeedsCorrection,
} from "./memberEmail.js";
import { runMemberSweep } from "./memberScheduler.js";

const ADMIN_USER = process.env.ADMIN_USER || "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";

/** Constant-time string compare (avoids leaking prefix length via timing). */
function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

/**
 * HTTP Basic Auth gate. 503 when creds aren't configured, 401 on a bad login.
 * Exported so other staff-only routers (the invoicing desk) sit behind the SAME
 * gate explicitly, rather than inheriting it by mount order.
 */
export function requireAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (!ADMIN_USER || !ADMIN_PASSWORD) {
    return res.status(503).send("Admin dashboard not configured (set ADMIN_USER and ADMIN_PASSWORD).");
  }
  const header = req.headers.authorization || "";
  const m = header.match(/^Basic (.+)$/);
  if (m) {
    const decoded = Buffer.from(m[1], "base64").toString("utf8");
    const idx = decoded.indexOf(":");
    const user = idx >= 0 ? decoded.slice(0, idx) : decoded;
    const pass = idx >= 0 ? decoded.slice(idx + 1) : "";
    if (safeEqual(user, ADMIN_USER) && safeEqual(pass, ADMIN_PASSWORD)) return next();
  }
  res.set("WWW-Authenticate", 'Basic realm="JVO Admin", charset="UTF-8"');
  return res.status(401).send("Authentication required.");
}

/** 503 helper when SQLite isn't available. */
function requireDb(res: express.Response) {
  const db = getDb();
  if (!db) {
    res.status(503).json({ error: "database unavailable" });
    return null;
  }
  return db;
}

export const memberAdminRouter = express.Router();
// Scope the auth gate to the admin paths only — this router is mounted at the
// app root, so a bare .use(requireAdmin) would challenge every request that
// flows through it (including /onboard and the SPA fallback).
memberAdminRouter.use(["/admin", "/api/admin"], requireAdmin);
memberAdminRouter.use("/api/admin", express.json());

/** List members, newest first. ?status= filters to one status. */
memberAdminRouter.get("/api/admin/members", (req, res) => {
  const db = requireDb(res);
  if (!db) return;
  const status = req.query.status ? String(req.query.status) : "";
  const rows = status
    ? db.prepare("SELECT * FROM members WHERE status = ? ORDER BY id DESC").all(status)
    : db.prepare("SELECT * FROM members ORDER BY id DESC").all();
  res.json({ ok: true, statuses: STATUSES, members: rows });
});

/**
 * "Start Onboarding" — staff enter name + email + membership type after seeing
 * the Deskworks signup come through. Creates the member record and sends the
 * welcome/portal email.
 */
memberAdminRouter.post("/api/admin/members", async (req, res) => {
  const db = requireDb(res);
  if (!db) return;
  const name = String(req.body?.name || "").trim().slice(0, 200);
  const email = String(req.body?.email || "").trim().toLowerCase().slice(0, 320);
  const phone = String(req.body?.phone || "").trim().slice(0, 50);
  const membershipType = String(req.body?.membership_type || "").trim().slice(0, 100);
  if (!name) return res.status(400).json({ error: "name is required" });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: "a valid email is required" });
  }
  if (!membershipType) return res.status(400).json({ error: "membership type is required" });

  const member = createMember(db, { name, email, phone, membership_type: membershipType });
  try {
    const result = await sendMemberWelcome(member, portalUrlFor(member));
    if (result.sent) {
      db.prepare(
        "INSERT OR IGNORE INTO member_email_log (member_id, kind, to_email, sent_at) VALUES (?, 'welcome', ?, ?)"
      ).run(member.id, member.email, nowIso());
    }
  } catch (err: any) {
    console.error("[admin] welcome email failed:", err?.message);
  }
  res.json({ ok: true, member, portalUrl: portalUrlFor(member) });
});

/** One member with documents, history, and allowed transitions. */
memberAdminRouter.get("/api/admin/members/:id", (req, res) => {
  const db = requireDb(res);
  if (!db) return;
  const member = db.prepare("SELECT * FROM members WHERE id = ?").get(Number(req.params.id)) as any;
  if (!member) return res.status(404).json({ error: "member not found" });
  const history = db
    .prepare("SELECT * FROM member_status_history WHERE member_id = ? ORDER BY id ASC")
    .all(member.id);
  const emails = db
    .prepare("SELECT * FROM member_email_log WHERE member_id = ? ORDER BY id ASC")
    .all(member.id);
  res.json({
    ok: true,
    member,
    documents: documentsFor(db, member.id),
    history,
    emails,
    allowedTransitions: allowedTransitionsFor(db, member),
    portalUrl: portalUrlFor(member),
  });
});

/** Move a member to a new status (validated by the pipeline rules). */
memberAdminRouter.post("/api/admin/members/:id/transition", (req, res) => {
  const db = requireDb(res);
  if (!db) return;
  const to = String(req.body?.to || "");
  const note = req.body?.note ? String(req.body.note).slice(0, 2000) : "";
  const result = transition(db, Number(req.params.id), to, "staff", note);
  if (!result.ok) return res.status(400).json({ error: result.error });
  res.json({ ok: true, member: result.member });
});

/** Update the staff notes on a member. */
memberAdminRouter.patch("/api/admin/members/:id", (req, res) => {
  const db = requireDb(res);
  if (!db) return;
  const member = db.prepare("SELECT id FROM members WHERE id = ?").get(Number(req.params.id)) as any;
  if (!member) return res.status(404).json({ error: "member not found" });
  if (typeof req.body?.notes !== "string") {
    return res.status(400).json({ error: "nothing to update — send notes" });
  }
  db.prepare("UPDATE members SET notes = ?, updated_at = ? WHERE id = ?").run(
    String(req.body.notes).slice(0, 10000),
    nowIso(),
    member.id
  );
  res.json({ ok: true, member: db.prepare("SELECT * FROM members WHERE id = ?").get(member.id) });
});

/** Resend the welcome/portal-link email. */
memberAdminRouter.post("/api/admin/members/:id/resend-portal", async (req, res) => {
  const db = requireDb(res);
  if (!db) return;
  const member = db.prepare("SELECT * FROM members WHERE id = ?").get(Number(req.params.id)) as any;
  if (!member) return res.status(404).json({ error: "member not found" });
  try {
    const result = await sendMemberWelcome(member, portalUrlFor(member));
    res.json({ ok: true, sent: result.sent, dryRun: result.dryRun || false, portalUrl: portalUrlFor(member) });
  } catch (err: any) {
    res.status(502).json({ error: `send failed: ${err?.message}` });
  }
});

/**
 * Mark 1583 signed — staff upload the notarized, signed copy after the visit.
 * Stores it as document kind "signed_1583" and moves appointment_scheduled →
 * awaiting_1583_signature (the "signature on file, pending approval" stage).
 */
memberAdminRouter.post("/api/admin/members/:id/signed-1583", uploadSingle("file"), (req, res) => {
  const db = requireDb(res);
  if (!db) {
    if (req.file) fs.promises.unlink(req.file.path).catch(() => undefined);
    return;
  }
  const member = db.prepare("SELECT * FROM members WHERE id = ?").get(Number(req.params.id)) as any;
  if (!member) {
    if (req.file) fs.promises.unlink(req.file.path).catch(() => undefined);
    return res.status(404).json({ error: "member not found" });
  }
  if (!req.file) return res.status(400).json({ error: "attach the signed 1583 file" });

  const at = nowIso();
  const previous = db
    .prepare("SELECT * FROM member_documents WHERE member_id = ? AND kind = 'signed_1583'")
    .get(member.id) as any;
  db.prepare(
    `INSERT INTO member_documents (member_id, kind, filename, stored_path, mime, size, uploaded_at)
     VALUES (@member_id, 'signed_1583', @filename, @stored_path, @mime, @size, @at)
     ON CONFLICT(member_id, kind) DO UPDATE SET
       filename = @filename, stored_path = @stored_path, mime = @mime, size = @size, uploaded_at = @at`
  ).run({
    member_id: member.id,
    filename: String(req.file.originalname || "signed-1583").slice(0, 300),
    stored_path: req.file.path,
    mime: req.file.mimetype,
    size: req.file.size,
    at,
  });
  db.prepare("UPDATE members SET updated_at = ? WHERE id = ?").run(at, member.id);
  if (previous?.stored_path && previous.stored_path !== req.file.path) {
    fs.promises.unlink(previous.stored_path).catch(() => undefined);
  }

  if (member.status === "appointment_scheduled") {
    transition(db, member.id, "awaiting_1583_signature", "staff", "signed 1583 uploaded");
  } else {
    db.prepare(
      `INSERT INTO member_status_history (member_id, from_status, to_status, actor, note, at)
       VALUES (?, ?, ?, 'staff', 'signed 1583 uploaded (replacement)', ?)`
    ).run(member.id, member.status, member.status, at);
  }
  res.json({ ok: true, member: db.prepare("SELECT * FROM members WHERE id = ?").get(member.id) });
});

/** Approve membership: awaiting_1583_signature → active + welcome-active email. */
memberAdminRouter.post("/api/admin/members/:id/approve", async (req, res) => {
  const db = requireDb(res);
  if (!db) return;
  const result = transition(db, Number(req.params.id), "active", "staff", "membership approved");
  if (!result.ok) return res.status(400).json({ error: result.error });
  try {
    const sent = await sendMembershipActive(result.member);
    if (sent.sent) {
      db.prepare(
        "INSERT OR IGNORE INTO member_email_log (member_id, kind, to_email, sent_at) VALUES (?, 'active_welcome', ?, ?)"
      ).run(result.member.id, result.member.email, nowIso());
    }
  } catch (err: any) {
    console.error("[admin] active-welcome email failed:", err?.message);
  }
  res.json({ ok: true, member: result.member });
});

/** Flag for correction (with a note) and email the member about it. */
memberAdminRouter.post("/api/admin/members/:id/needs-correction", async (req, res) => {
  const db = requireDb(res);
  if (!db) return;
  const note = String(req.body?.note || "").trim().slice(0, 2000);
  if (!note) return res.status(400).json({ error: "a note explaining what to fix is required" });
  const result = transition(db, Number(req.params.id), "needs_correction", "staff", note);
  if (!result.ok) return res.status(400).json({ error: result.error });
  try {
    await sendNeedsCorrection(result.member, note, portalUrlFor(result.member));
  } catch (err: any) {
    console.error("[admin] needs-correction email failed:", err?.message);
  }
  res.json({ ok: true, member: result.member });
});

/**
 * Stream an uploaded document from disk — the ONLY way documents are served.
 * Behind Basic Auth; uploads are never reachable without credentials.
 */
memberAdminRouter.get("/api/admin/members/:id/documents/:kind", (req, res) => {
  const db = requireDb(res);
  if (!db) return;
  const kind = String(req.params.kind || "");
  if (!(DOC_KINDS as readonly string[]).includes(kind)) {
    return res.status(400).json({ error: "unknown document kind" });
  }
  const doc = db
    .prepare("SELECT * FROM member_documents WHERE member_id = ? AND kind = ?")
    .get(Number(req.params.id), kind) as any;
  if (!doc) return res.status(404).json({ error: "document not found" });
  const abs = path.resolve(doc.stored_path);
  if (!fs.existsSync(abs)) return res.status(404).json({ error: "file missing from disk" });
  res.setHeader("Content-Type", doc.mime || "application/octet-stream");
  res.setHeader("Content-Disposition", `inline; filename="${String(doc.filename || kind).replace(/["\\\r\n]/g, "")}"`);
  res.setHeader("Cache-Control", "no-store");
  fs.createReadStream(abs).pipe(res);
});

/** Run the daily reminder sweep on demand (testing / catch-up). */
memberAdminRouter.post("/api/admin/members-sweep", async (req, res) => {
  const db = requireDb(res);
  if (!db) return;
  const dryRun = String(req.query.dryRun || "") === "1";
  try {
    const report = await runMemberSweep(dryRun);
    res.json({ ok: true, dryRun, report });
  } catch (err: any) {
    res.status(500).json({ error: `sweep failed: ${err?.message}` });
  }
});

/** The dashboard itself — a single self-contained page (inline CSS + JS). */
memberAdminRouter.get("/admin", (_req, res) => {
  res.type("html").send(ADMIN_PAGE);
});

const ADMIN_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>JVO — Membership Pipeline</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,600;1,600&family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  :root { --bg:#FAFAFA; --panel:#FFFFFF; --line:#E5E5E5; --ink:#0A0A0A; --body:#1C1C1E; --muted:#6B7280; }
  * { box-sizing:border-box; margin:0; padding:0; }
  body { background:var(--bg); color:var(--ink); font-family:'DM Sans',Arial,sans-serif; min-height:100vh; }
  header { padding:24px 28px 16px; border-bottom:1px solid var(--line); background:var(--panel); display:flex; align-items:baseline; gap:14px; flex-wrap:wrap; }
  header h1 { font-family:'Cormorant Garamond',Georgia,serif; font-weight:600; font-size:26px; }
  header h1 em { font-style:italic; }
  header .sub { color:var(--muted); font-size:11px; letter-spacing:2px; text-transform:uppercase; }
  main { display:grid; grid-template-columns:1fr 420px; min-height:calc(100vh - 67px); }
  @media (max-width: 1020px) { main { grid-template-columns:1fr; } #detail { border-left:none; border-top:1px solid var(--line); } }
  #board { padding:22px 28px; overflow-x:auto; }
  #start { background:var(--panel); border:1px solid var(--line); border-radius:4px; padding:18px 20px; margin-bottom:24px; }
  #start h2 { font-family:'Cormorant Garamond',Georgia,serif; font-size:19px; font-weight:600; margin-bottom:4px; }
  #start h2 em { font-style:italic; }
  #start .hint { color:var(--muted); font-size:12px; margin-bottom:12px; }
  #start form { display:flex; flex-wrap:wrap; gap:8px; align-items:center; }
  input, select, textarea { background:#fff; color:var(--ink); border:1px solid #D6D6D6; border-radius:4px; padding:9px 10px; font-family:'DM Sans',Arial,sans-serif; font-size:13px; }
  input:focus, select:focus, textarea:focus { outline:none; border-color:var(--ink); }
  button { font-family:'DM Sans',Arial,sans-serif; font-size:11px; font-weight:600; letter-spacing:1.5px; text-transform:uppercase; padding:10px 16px; cursor:pointer; background:var(--ink); color:#fff; border:1px solid var(--ink); border-radius:4px; }
  button:hover { background:#1C1C1E; }
  button.ghost { background:transparent; color:var(--ink); border:1px solid #C9C9C9; font-weight:500; }
  button.ghost:hover { border-color:var(--ink); }
  button.danger { background:transparent; color:#B42318; border:1px solid #E5C5C0; font-weight:500; }
  button.danger:hover { border-color:#B42318; }
  .group { margin-bottom:24px; }
  .group h2 { font-family:'Cormorant Garamond',Georgia,serif; font-size:16px; font-weight:600; letter-spacing:.3px; margin-bottom:8px; }
  .group h2 .count { color:var(--muted); font-family:'DM Sans',sans-serif; font-size:12px; margin-left:8px; }
  .card { background:var(--panel); border:1px solid var(--line); border-left:2px solid var(--ink); border-radius:4px; padding:11px 15px; margin-bottom:8px; cursor:pointer; display:flex; justify-content:space-between; gap:12px; align-items:center; }
  .card:hover, .card.sel { border-color:var(--ink); }
  .card .who { font-weight:600; font-size:14px; }
  .card .meta { color:var(--muted); font-size:12px; }
  .card .pid { color:var(--muted); font-size:11px; letter-spacing:1px; }
  #detail { border-left:1px solid var(--line); background:var(--panel); padding:22px 24px; }
  #detail h2 { font-family:'Cormorant Garamond',Georgia,serif; font-size:22px; font-weight:600; margin-bottom:2px; }
  #detail .pid { color:var(--muted); font-size:11px; letter-spacing:2px; }
  .status-pill { display:inline-block; border:1px solid var(--ink); color:var(--ink); border-radius:3px; padding:3px 10px; font-size:10px; letter-spacing:2px; text-transform:uppercase; margin:10px 0 16px; }
  dl { display:grid; grid-template-columns:auto 1fr; gap:4px 14px; font-size:13px; margin-bottom:14px; }
  dt { color:var(--muted); }
  dd { word-break:break-word; color:var(--body); }
  .sec { color:var(--ink); font-size:10px; font-weight:600; letter-spacing:2px; text-transform:uppercase; margin:18px 0 8px; border-top:1px solid var(--line); padding-top:14px; }
  .actions { display:flex; flex-wrap:wrap; gap:8px; margin-bottom:6px; }
  textarea { width:100%; min-height:80px; resize:vertical; font-size:13px; }
  .hist { font-size:12px; color:var(--muted); border-left:1px solid var(--line); padding-left:12px; }
  .hist div { margin-bottom:6px; }
  .hist b { color:var(--body); font-weight:600; }
  .doc { display:flex; justify-content:space-between; align-items:center; gap:8px; font-size:13px; border:1px solid var(--line); border-radius:4px; padding:8px 12px; margin-bottom:6px; }
  .doc a { color:var(--ink); }
  .doc .missing { color:var(--muted); }
  .empty { color:var(--muted); padding:28px 0; font-size:14px; }
  #msg { position:fixed; bottom:18px; right:18px; background:var(--ink); color:#fff; border-radius:4px; padding:10px 16px; font-size:13px; display:none; z-index:10; }
  .filerow { display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin-bottom:8px; }
  .filerow input[type=file] { font-size:12px; }
</style>
</head>
<body>
<header>
  <h1>Membership <em>Pipeline.</em></h1>
  <div class="sub">Jonesboro Virtual Office — Staff Dashboard</div>
  <a href="/admin/invoices" style="margin-left:auto;font-size:11px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:var(--ink)">Invoicing desk →</a>
</header>
<main>
  <section id="board">
    <div id="start">
      <h2>Start <em>Onboarding.</em></h2>
      <div class="hint">After a Deskworks signup comes through, enter the new member here — they'll get their onboarding checklist by email.</div>
      <form onsubmit="startOnboarding(event)">
        <input type="text" id="new-name" placeholder="Full name" required>
        <input type="email" id="new-email" placeholder="Email" required>
        <input type="tel" id="new-phone" placeholder="Phone (optional)">
        <select id="new-type" required>
          <option value="" disabled selected>Membership type…</option>
          <option>Mail Only — $39/mo</option>
          <option>Business Essential (Solo) — $199/mo</option>
          <option>Team — $459/mo</option>
        </select>
        <button type="submit">Start Onboarding</button>
      </form>
    </div>
    <div id="groups"><div class="empty">Loading members…</div></div>
  </section>
  <aside id="detail"><div class="empty">Select a member to see their details.</div></aside>
</main>
<div id="msg"></div>
<script>
const STATUS_ORDER = ["needs_correction","missing_documents","awaiting_onboarding","documents_pending","documents_complete","appointment_scheduled","awaiting_1583_signature","active","denied","cancelled"];
const LABELS = {
  awaiting_onboarding:"Awaiting Onboarding", documents_pending:"Documents Pending", documents_complete:"Documents Complete",
  appointment_scheduled:"Appointment Scheduled", awaiting_1583_signature:"Awaiting 1583 Signature", active:"Active",
  missing_documents:"Missing Documents", needs_correction:"Needs Correction", denied:"Denied", cancelled:"Cancelled"
};
const DOC_LABELS = {
  license_front:"Driver's license — front", license_back:"Driver's license — back",
  proof_of_residence:"Proof of residence", signed_1583:"Signed Form 1583"
};
let selectedId = null;

function toast(t){ const m=document.getElementById("msg"); m.textContent=t; m.style.display="block"; clearTimeout(m._t); m._t=setTimeout(()=>m.style.display="none", 3500); }
async function api(path, opts){
  const r = await fetch(path, Object.assign({headers:{"Content-Type":"application/json"}}, opts));
  const j = await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(j.error || ("HTTP "+r.status));
  return j;
}
function esc(s){ const d=document.createElement("div"); d.textContent = s==null? "" : String(s); return d.innerHTML; }

async function startOnboarding(e){
  e.preventDefault();
  const body = {
    name: document.getElementById("new-name").value.trim(),
    email: document.getElementById("new-email").value.trim(),
    phone: document.getElementById("new-phone").value.trim(),
    membership_type: document.getElementById("new-type").value
  };
  try {
    const j = await api("/api/admin/members", {method:"POST", body:JSON.stringify(body)});
    e.target.reset();
    toast("Member "+j.member.public_id+" created — welcome email queued");
    loadBoard();
    openMember(j.member.id);
  } catch(err){ toast("Error: "+err.message); }
}

async function loadBoard(){
  const box = document.getElementById("groups");
  try {
    const j = await api("/api/admin/members");
    const groups = {};
    for(const m of j.members){ (groups[m.status] = groups[m.status]||[]).push(m); }
    let html = "";
    for(const st of STATUS_ORDER){
      const ms = groups[st];
      if(!ms || !ms.length) continue;
      html += '<div class="group"><h2>'+esc(LABELS[st]||st)+'<span class="count">'+ms.length+'</span></h2>';
      for(const m of ms){
        html += '<div class="card'+(m.id===selectedId?" sel":"")+'" onclick="openMember('+m.id+')">'
          + '<div><div class="who">'+esc(m.name||"(no name)")+'</div>'
          + '<div class="meta">'+esc(m.membership_type||"")+(m.appointment_at?" · visit "+esc(m.appointment_at.replace("T"," ")):"")+'</div></div>'
          + '<div class="pid">'+esc(m.public_id||"")+'</div></div>';
      }
      html += '</div>';
    }
    box.innerHTML = html || '<div class="empty">No members yet — start your first onboarding above.</div>';
  } catch(e){ box.innerHTML = '<div class="empty">Could not load members: '+esc(e.message)+'</div>'; }
}

async function openMember(id){
  selectedId = id;
  const box = document.getElementById("detail");
  try {
    const j = await api("/api/admin/members/"+id);
    const m = j.member, allowed = j.allowedTransitions;
    const docsBy = {};
    for(const d of j.documents) docsBy[d.kind] = d;
    const row = (k,v)=> v==null||v===""? "" : "<dt>"+esc(k)+"</dt><dd>"+esc(v)+"</dd>";
    let authUsers = "";
    try { const a = JSON.parse(m.authorized_users||"[]"); if(Array.isArray(a) && a.length) authUsers = a.join(", "); } catch(e){}
    const docRow = (kind)=>{
      const d = docsBy[kind];
      return '<div class="doc"><span>'+esc(DOC_LABELS[kind])+'</span>'
        + (d ? '<a href="/api/admin/members/'+m.id+'/documents/'+kind+'" target="_blank" rel="noopener">View · '+esc(d.filename)+'</a>'
             : '<span class="missing">not uploaded</span>')
        + '</div>';
    };
    let html = '<div class="pid">'+esc(m.public_id||"")+'</div><h2>'+esc(m.name||"(no name)")+'</h2>'
      + '<div class="status-pill">'+esc(LABELS[m.status]||m.status)+'</div>'
      + '<dl>'
      + row("Email", m.email) + row("Phone", m.phone)
      + row("Membership", m.membership_type)
      + row("Business", m.business_name) + row("Business address", m.business_address)
      + row("Authorized users", authUsers) + row("Mail prefs", m.mailing_prefs)
      + row("Info confirmed", m.info_confirmed_at)
      + row("1583 downloaded", m.form1583_downloaded_at)
      + row("Visit", m.appointment_at ? m.appointment_at.replace("T"," ") : "")
      + row("Approved", m.approved_at)
      + row("Created", m.created_at) + row("Updated", m.updated_at)
      + '</dl>'
      + '<div class="sec">Documents</div>'
      + docRow("license_front") + docRow("license_back") + docRow("proof_of_residence") + docRow("signed_1583")
      + '<div class="sec">Portal Link</div>'
      + '<div class="actions">'
      + '<button class="ghost" onclick="copyPortal(this)" data-url="'+esc(j.portalUrl)+'">Copy portal link</button>'
      + '<button class="ghost" onclick="resendPortal('+m.id+')">Resend portal email</button>'
      + '</div>'
      + '<div class="sec">Mark 1583 Signed</div>'
      + '<div class="filerow"><input type="file" id="signed-file" accept=".jpg,.jpeg,.png,.webp,.heic,.pdf">'
      + '<button class="ghost" onclick="uploadSigned('+m.id+')">Upload Signed Copy</button></div>'
      + '<div class="sec">Actions</div><div class="actions">'
      + (allowed.includes("active") ? '<button onclick="approve('+m.id+')">Approve Membership</button>' : "")
      + (allowed.includes("awaiting_1583_signature") ? '<button class="ghost" onclick="doTransition('+m.id+',\\'awaiting_1583_signature\\')">Visit Done — Awaiting Approval</button>' : "")
      + (["missing_documents","needs_correction"].includes(m.status) && allowed[0] && !["denied","cancelled","missing_documents","needs_correction"].includes(allowed[0])
          ? '<button onclick="doTransition('+m.id+',\\''+allowed[0]+'\\')">Resolve → '+esc(LABELS[allowed[0]]||allowed[0])+'</button>' : "")
      + (allowed.includes("needs_correction") ? '<button class="ghost" onclick="needsCorrection('+m.id+')">Needs Correction…</button>' : "")
      + (allowed.includes("missing_documents") ? '<button class="ghost" onclick="doTransition('+m.id+',\\'missing_documents\\')">Missing Documents</button>' : "")
      + '</div><div class="actions">'
      + (allowed.includes("denied") ? '<button class="danger" onclick="doTransition('+m.id+',\\'denied\\')">Deny</button>' : "")
      + (allowed.includes("cancelled") ? '<button class="danger" onclick="doTransition('+m.id+',\\'cancelled\\')">Cancel</button>' : "")
      + '</div>'
      + '<div class="sec">Staff Notes</div>'
      + '<textarea id="notes">'+esc(m.notes||"")+'</textarea>'
      + '<div class="actions" style="margin-top:8px"><button class="ghost" onclick="saveNotes('+m.id+')">Save Notes</button></div>'
      + '<div class="sec">History</div><div class="hist">'
      + j.history.map(h=>'<div>'+esc((h.at||"").slice(0,16).replace("T"," "))+' — <b>'+esc(h.from_status||"new")+' → '+esc(h.to_status)+'</b> ('+esc(h.actor||"")+')'+(h.note?' — '+esc(h.note):'')+'</div>').join("")
      + '</div>';
    box.innerHTML = html;
    loadBoard();
  } catch(e){ box.innerHTML = '<div class="empty">Could not load member: '+esc(e.message)+'</div>'; }
}

async function doTransition(id, to){
  const note = prompt("Optional note for the history log:", "") || "";
  try { await api("/api/admin/members/"+id+"/transition", {method:"POST", body:JSON.stringify({to, note})}); toast("Moved to "+(LABELS[to]||to)); openMember(id); }
  catch(e){ toast("Error: "+e.message); }
}
async function approve(id){
  if(!confirm("Approve this membership and send the welcome-active email?")) return;
  try { await api("/api/admin/members/"+id+"/approve", {method:"POST", body:"{}"}); toast("Membership active"); openMember(id); }
  catch(e){ toast("Error: "+e.message); }
}
async function needsCorrection(id){
  const note = prompt("What does the member need to fix? (this is emailed to them)");
  if(!note) return;
  try { await api("/api/admin/members/"+id+"/needs-correction", {method:"POST", body:JSON.stringify({note})}); toast("Marked needs correction"); openMember(id); }
  catch(e){ toast("Error: "+e.message); }
}
async function resendPortal(id){
  try { const j = await api("/api/admin/members/"+id+"/resend-portal", {method:"POST", body:"{}"}); toast(j.sent ? "Portal email sent" : (j.dryRun ? "Dry run — emails are disabled (MEMBER_EMAILS_ENABLED)" : "Email skipped — SMTP not configured")); }
  catch(e){ toast("Error: "+e.message); }
}
async function saveNotes(id){
  try { await api("/api/admin/members/"+id, {method:"PATCH", body:JSON.stringify({notes: document.getElementById("notes").value})}); toast("Notes saved"); }
  catch(e){ toast("Error: "+e.message); }
}
async function uploadSigned(id){
  const input = document.getElementById("signed-file");
  if(!input.files || !input.files[0]) return toast("Choose the signed 1583 file first");
  const fd = new FormData();
  fd.append("file", input.files[0]);
  try {
    const r = await fetch("/api/admin/members/"+id+"/signed-1583", {method:"POST", body: fd});
    const j = await r.json().catch(()=>({}));
    if(!r.ok) throw new Error(j.error || ("HTTP "+r.status));
    toast("Signed 1583 uploaded"); openMember(id);
  } catch(e){ toast("Error: "+e.message); }
}
function copyPortal(btn){
  const url = btn.getAttribute("data-url");
  if(navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(url).then(function(){ toast("Portal link copied"); }, function(){ prompt("Portal link:", url); });
  } else { prompt("Portal link:", url); }
}

loadBoard();
setInterval(loadBoard, 60000);
</script>
</body>
</html>`;
