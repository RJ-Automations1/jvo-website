/**
 * Daily membership-pipeline sweep.
 * --------------------------------
 * Runs every morning at 9:00 AM America/New_York (node-cron):
 *
 *   1. Members stuck in awaiting_onboarding / documents_pending for >3 days
 *      with items still missing get a friendly reminder email. Deduped via
 *      member_email_log with DATED kinds (docs_reminder_2026-08-12) — at most
 *      one reminder per member per 7 days.
 *   2. Members stuck >7 days additionally trigger a staff notification
 *      (staff_stale_YYYY-MM-DD, same 7-day dedupe).
 *   3. Members with a visit in the next 24 hours get an appointment reminder
 *      (appt_reminder_<slot>, once per scheduled slot).
 *   4. Members whose visit time has passed auto-advance appointment_scheduled
 *      → awaiting_1583_signature so the dashboard surfaces them for approval.
 *
 * MEMBER_EMAILS_ENABLED (default "false") keeps every send a DRY RUN log line
 * — the email layer enforces it, and dry runs are NOT recorded in
 * member_email_log so nothing is suppressed once emails go live. Status
 * auto-advance (step 4) always runs; it writes no emails.
 */

import cron from "node-cron";
import { getDb, nowIso } from "./db.js";
import {
  appointmentInstant,
  missingRequiredDocs,
  portalUrlFor,
  transition,
} from "./memberPipeline.js";
import {
  prettyAppointment,
  sendAppointmentReminder,
  sendDocumentReminder,
  sendStaffNotification,
} from "./memberEmail.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/** True when a member_email_log row with this kind-prefix exists in the last N days. */
function sentRecently(db: any, memberId: number, kindPrefix: string, days: number): boolean {
  const cutoff = new Date(Date.now() - days * DAY_MS).toISOString();
  return Boolean(
    db
      .prepare(
        "SELECT 1 FROM member_email_log WHERE member_id = ? AND kind LIKE ? AND sent_at > ? LIMIT 1"
      )
      .get(memberId, `${kindPrefix}%`, cutoff)
  );
}

function logEmail(db: any, memberId: number, kind: string, to: string) {
  db.prepare(
    "INSERT OR IGNORE INTO member_email_log (member_id, kind, to_email, sent_at) VALUES (?, ?, ?, ?)"
  ).run(memberId, kind, to, nowIso());
}

export interface SweepReport {
  documentReminders: number;
  staleStaffAlerts: number;
  appointmentReminders: number;
  visitsAdvanced: number;
  dryRun: boolean;
}

/**
 * One pass of the daily sweep. `forceDryRun` (the admin test endpoint) logs
 * what WOULD happen without sending or recording anything; normal runs defer
 * to the email layer's own MEMBER_EMAILS_ENABLED gate.
 */
export async function runMemberSweep(forceDryRun = false): Promise<SweepReport> {
  const report: SweepReport = {
    documentReminders: 0,
    staleStaffAlerts: 0,
    appointmentReminders: 0,
    visitsAdvanced: 0,
    dryRun: forceDryRun,
  };
  const db = getDb();
  if (!db) {
    console.warn("[member-sweep] database unavailable — skipping sweep");
    return report;
  }

  const now = Date.now();
  const today = new Date().toISOString().slice(0, 10);

  /* 1 + 2 — stalled onboarding reminders */
  const stalled = db
    .prepare(
      "SELECT * FROM members WHERE status IN ('awaiting_onboarding','documents_pending') ORDER BY id ASC"
    )
    .all() as any[];
  for (const m of stalled) {
    const createdMs = Date.parse(m.created_at || "") || now;
    const ageDays = (now - createdMs) / DAY_MS;
    const missing = missingRequiredDocs(db, m.id);
    const missingItems = missing.length > 0 || !m.info_confirmed_at;
    if (!missingItems) continue;

    if (ageDays > 3 && !sentRecently(db, m.id, "docs_reminder_", 7)) {
      if (forceDryRun) {
        console.log(
          `[member-sweep] DRY RUN — would send document reminder to ${m.email} (${m.public_id}; missing: ${[...(m.info_confirmed_at ? [] : ["info"]), ...missing].join(", ")})`
        );
        report.documentReminders++;
      } else {
        try {
          const result = await sendDocumentReminder(m, missing, portalUrlFor(m));
          if (result.sent) logEmail(db, m.id, `docs_reminder_${today}`, m.email || "");
          report.documentReminders++;
        } catch (err: any) {
          console.error(`[member-sweep] document reminder failed for ${m.public_id}:`, err?.message);
        }
      }
    }

    if (ageDays > 7 && !sentRecently(db, m.id, "staff_stale_", 7)) {
      const lines = [
        `${m.name || "A member"} (${m.public_id}) has been onboarding for ${Math.floor(ageDays)} days without finishing.`,
        `Still missing: ${[...(m.info_confirmed_at ? [] : ["contact/business info"]), ...missing].join(", ") || "—"}`,
        `Email: ${m.email || "—"} · Phone: ${m.phone || "—"}`,
      ];
      if (forceDryRun) {
        console.log(`[member-sweep] DRY RUN — would alert staff about stale member ${m.public_id}`);
        report.staleStaffAlerts++;
      } else {
        try {
          const result = await sendStaffNotification(`Onboarding stalled — ${m.public_id}`, lines);
          if (result.sent) logEmail(db, m.id, `staff_stale_${today}`, "staff");
          report.staleStaffAlerts++;
        } catch (err: any) {
          console.error(`[member-sweep] staff alert failed for ${m.public_id}:`, err?.message);
        }
      }
    }
  }

  /* 3 + 4 — appointment reminders and visit-day advance */
  const scheduled = db
    .prepare("SELECT * FROM members WHERE status = 'appointment_scheduled' ORDER BY id ASC")
    .all() as any[];
  for (const m of scheduled) {
    const instant = appointmentInstant(m.appointment_at);
    if (!instant) continue;

    if (instant.getTime() <= now) {
      // The visit time has passed — surface for the signed-1583 / approval step.
      const moved = transition(db, m.id, "awaiting_1583_signature", "scheduler", "visit time passed");
      if (moved.ok) report.visitsAdvanced++;
      continue;
    }

    const hoursOut = (instant.getTime() - now) / (60 * 60 * 1000);
    const kind = `appt_reminder_${m.appointment_at}`;
    const already = db
      .prepare("SELECT 1 FROM member_email_log WHERE member_id = ? AND kind = ?")
      .get(m.id, kind);
    if (hoursOut <= 24 && !already) {
      if (forceDryRun) {
        console.log(
          `[member-sweep] DRY RUN — would send appointment reminder to ${m.email} (${m.public_id}, ${prettyAppointment(m.appointment_at)})`
        );
        report.appointmentReminders++;
      } else {
        try {
          const result = await sendAppointmentReminder(m);
          if (result.sent) logEmail(db, m.id, kind, m.email || "");
          report.appointmentReminders++;
        } catch (err: any) {
          console.error(`[member-sweep] appointment reminder failed for ${m.public_id}:`, err?.message);
        }
      }
    }
  }

  console.log(
    `[member-sweep] done${forceDryRun ? " (dry run)" : ""} — reminders:${report.documentReminders} staleAlerts:${report.staleStaffAlerts} apptReminders:${report.appointmentReminders} visitsAdvanced:${report.visitsAdvanced}`
  );
  return report;
}

/** Schedule the daily 9:00 AM America/New_York sweep. */
export function initMemberScheduler(): void {
  cron.schedule(
    "0 9 * * *",
    () => {
      runMemberSweep(false).catch((err) => console.error("[member-sweep] failed:", err?.message));
    },
    { timezone: "America/New_York" }
  );
  console.log("[member-sweep] daily sweep scheduled for 9:00 AM America/New_York");
}
