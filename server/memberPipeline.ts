/**
 * Membership-activation status pipeline.
 * --------------------------------------
 * Every new member moves through a fixed status pipeline (from the JVO
 * Membership Activation Workflow doc v1.1):
 *
 *   awaiting_onboarding → documents_pending → documents_complete
 *     → appointment_scheduled → awaiting_1583_signature → active
 *
 * with exception statuses:
 *   missing_documents — staff flagged an upload as missing/unusable; resolves
 *                       back to the status it came from
 *   needs_correction  — staff asked the member to fix something (with a note);
 *                       resolves back to the status it came from
 *   denied            — application denied
 *   cancelled         — member or staff cancelled onboarding
 *
 * Auto-advances (the member portal drives these):
 *   awaiting_onboarding → documents_pending    when the member confirms info
 *   documents_pending → documents_complete     when all three docs are on file
 *   documents_complete → appointment_scheduled when a visit slot is picked
 *   appointment_scheduled → awaiting_1583_signature when the visit day arrives
 *     (daily sweep) or staff mark the signed 1583 as received
 *   awaiting_1583_signature → active            staff "Approve Membership"
 */

import crypto from "node:crypto";
import type { Database } from "better-sqlite3";
import { nowIso } from "./db.js";

export const STATUSES = [
  "awaiting_onboarding",
  "documents_pending",
  "documents_complete",
  "appointment_scheduled",
  "awaiting_1583_signature",
  "active",
  "missing_documents",
  "needs_correction",
  "denied",
  "cancelled",
] as const;

export type MemberStatus = (typeof STATUSES)[number];

/** Statuses of members still moving toward activation (the sweep acts on these). */
export const ACTIVE_PIPELINE_STATUSES = [
  "awaiting_onboarding",
  "documents_pending",
  "documents_complete",
  "appointment_scheduled",
  "awaiting_1583_signature",
];

const EXCEPTIONS = ["missing_documents", "needs_correction", "denied", "cancelled"];
/** The two exception statuses that resolve back to where they came from. */
const RETURNABLE = ["missing_documents", "needs_correction"];

/**
 * from-status → the statuses it may move to. Any in-flight status can also
 * drop into an exception. missing_documents / needs_correction are
 * special-cased in transition(): they return to the status they came from
 * (looked up in member_status_history), or can be denied/cancelled.
 */
export const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  awaiting_onboarding: ["documents_pending", ...EXCEPTIONS],
  documents_pending: ["documents_complete", ...EXCEPTIONS],
  documents_complete: ["appointment_scheduled", ...EXCEPTIONS],
  appointment_scheduled: ["awaiting_1583_signature", ...EXCEPTIONS],
  awaiting_1583_signature: ["active", ...EXCEPTIONS],
  active: [],
  // Resolved dynamically — see transition(). Denying/cancelling is always allowed.
  missing_documents: ["needs_correction", "denied", "cancelled"],
  needs_correction: ["missing_documents", "denied", "cancelled"],
  denied: [],
  cancelled: [],
};

/**
 * The status a missing_documents / needs_correction member should return to:
 * the from_status of its most recent hop INTO that exception. Falls back to
 * null when history is missing.
 */
export function exceptionReturnStatus(db: Database, memberId: number): string | null {
  const row = db
    .prepare(
      `SELECT from_status FROM member_status_history
       WHERE member_id = ? AND to_status IN ('missing_documents','needs_correction')
       ORDER BY id DESC LIMIT 1`
    )
    .get(memberId) as { from_status: string | null } | undefined;
  const back = row?.from_status || null;
  // Never "return" into another exception.
  return back && !EXCEPTIONS.includes(back) ? back : null;
}

/** Allowed next statuses for a member, including the dynamic exception return. */
export function allowedTransitionsFor(db: Database, member: { id: number; status: string }): string[] {
  let allowed = ALLOWED_TRANSITIONS[member.status] || [];
  if (RETURNABLE.includes(member.status)) {
    const back = exceptionReturnStatus(db, member.id);
    if (back) allowed = [back, ...allowed];
  }
  return allowed;
}

export interface TransitionResult {
  ok: boolean;
  error?: string;
  member?: any;
}

/**
 * Move a member to a new status, validating the hop against
 * ALLOWED_TRANSITIONS, stamping approved_at when the hop implies it, and
 * appending a member_status_history row.
 */
export function transition(
  db: Database,
  memberId: number,
  to: string,
  actor: string,
  note = ""
): TransitionResult {
  const member = db.prepare("SELECT * FROM members WHERE id = ?").get(memberId) as any;
  if (!member) return { ok: false, error: "member not found" };
  if (!(STATUSES as readonly string[]).includes(to)) {
    return { ok: false, error: `unknown status "${to}"` };
  }

  const from = member.status as string;
  const allowed = allowedTransitionsFor(db, member);
  if (!allowed.includes(to)) {
    return {
      ok: false,
      error: `cannot move from "${from}" to "${to}" (allowed: ${allowed.join(", ") || "none"})`,
    };
  }

  const at = nowIso();
  const stamps: string[] = [];
  const params: Record<string, unknown> = { id: memberId, to, at };
  if (to === "active" && !member.approved_at) {
    stamps.push("approved_at = @at");
  }

  const apply = db.transaction(() => {
    db.prepare(
      `UPDATE members SET status = @to, updated_at = @at${stamps.length ? ", " + stamps.join(", ") : ""} WHERE id = @id`
    ).run(params);
    db.prepare(
      `INSERT INTO member_status_history (member_id, from_status, to_status, actor, note, at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(memberId, from, to, actor || "system", note || "", at);
  });
  apply();

  return { ok: true, member: db.prepare("SELECT * FROM members WHERE id = ?").get(memberId) };
}

/** Next public id for the year, e.g. JVO-2026-00001 (5-digit counter). */
function nextPublicId(db: Database, year: number): string {
  const prefix = `JVO-${year}-`;
  const row = db
    .prepare(
      `SELECT MAX(CAST(SUBSTR(public_id, ?) AS INTEGER)) AS n FROM members WHERE public_id LIKE ?`
    )
    .get(prefix.length + 1, `${prefix}%`) as { n: number | null } | undefined;
  const n = (row?.n || 0) + 1;
  return `${prefix}${String(n).padStart(5, "0")}`;
}

export interface NewMemberInput {
  name: string;
  email: string;
  phone?: string;
  membership_type?: string;
  notes?: string;
}

/**
 * Insert a new member record in status awaiting_onboarding, generating its
 * public id (JVO-YYYY-NNNNN) and a crypto-random portal token.
 */
export function createMember(db: Database, input: NewMemberInput) {
  const at = nowIso();
  const year = new Date().getFullYear();

  const insert = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO members (
           public_id, status, name, email, phone, membership_type, notes,
           portal_token, created_at, updated_at
         ) VALUES (
           @public_id, 'awaiting_onboarding', @name, @email, @phone,
           @membership_type, @notes, @portal_token, @at, @at
         )`
      )
      .run({
        public_id: nextPublicId(db, year),
        name: input.name || "",
        email: input.email || "",
        phone: input.phone || "",
        membership_type: input.membership_type || "",
        notes: input.notes || "",
        portal_token: crypto.randomBytes(24).toString("hex"),
        at,
      });
    db.prepare(
      `INSERT INTO member_status_history (member_id, from_status, to_status, actor, note, at)
       VALUES (?, NULL, 'awaiting_onboarding', ?, ?, ?)`
    ).run(info.lastInsertRowid, "staff", "onboarding started", at);
    return info.lastInsertRowid as number;
  });

  const id = insert();
  return db.prepare("SELECT * FROM members WHERE id = ?").get(id) as any;
}

/* ── Portal link ─────────────────────────────────────────────────────── */

const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || "https://jonesborovirtualoffice.com").replace(/\/$/, "");

/** The member's tokenized onboarding-checklist URL. */
export function portalUrlFor(member: { portal_token: string }): string {
  return `${PUBLIC_BASE_URL}/onboard/${member.portal_token}`;
}

/* ── Document checklist helpers ──────────────────────────────────────── */

/** The three documents the member must upload before their visit. */
export const REQUIRED_DOC_KINDS = ["license_front", "license_back", "proof_of_residence"] as const;
/** All accepted document kinds (signed_1583 is uploaded by staff). */
export const DOC_KINDS = [...REQUIRED_DOC_KINDS, "signed_1583"] as const;

export function documentsFor(db: Database, memberId: number) {
  return db
    .prepare("SELECT * FROM member_documents WHERE member_id = ? ORDER BY kind ASC")
    .all(memberId) as any[];
}

export function missingRequiredDocs(db: Database, memberId: number): string[] {
  const have = new Set(documentsFor(db, memberId).map((d) => d.kind));
  return REQUIRED_DOC_KINDS.filter((k) => !have.has(k));
}

/* ── America/New_York wall-clock helpers (DST-correct via Intl) ──────── */

export const OFFICE_TZ = "America/New_York";

function tzOffsetMs(tz: string, date: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const p = Object.fromEntries(dtf.formatToParts(date).map((x) => [x.type, x.value])) as Record<string, string>;
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asUTC - date.getTime();
}

/** Wall-clock time in the office timezone -> the exact UTC instant. */
export function wallToInstant(dateStr: string, hour: number, minute: number): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  const utcGuess = Date.UTC(y, m - 1, d, hour, minute, 0);
  const off = tzOffsetMs(OFFICE_TZ, new Date(utcGuess));
  return new Date(utcGuess - off);
}

/** Today's date (YYYY-MM-DD) in the office timezone. */
export function todayInOfficeTz(): string {
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone: OFFICE_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return dtf.format(new Date());
}

/** Day of week (0 = Sunday … 6 = Saturday) for a YYYY-MM-DD date string. */
export function dayOfWeek(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** appointment_at is stored as "YYYY-MM-DDTHH:MM" office wall-clock time. */
export function appointmentInstant(appointmentAt: string | null): Date | null {
  const m = String(appointmentAt || "").match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/);
  if (!m) return null;
  return wallToInstant(m[1], Number(m[2]), Number(m[3]));
}
