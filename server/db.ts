/**
 * SQLite persistence for the membership-activation pipeline.
 * ----------------------------------------------------------
 * A tiny embedded database (better-sqlite3) that tracks every new member as
 * they move through onboarding (see server/memberPipeline.ts). The DB file
 * lives at DB_PATH (default ./data/jvo-members.db; on Render it points at the
 * mounted persistent disk, /data/jvo-members.db).
 *
 * GRACEFUL DEGRADATION: the rest of the site must keep working without a DB.
 * getDb() lazily opens the database once; if the native module fails to load or
 * the path isn't writable it logs ONE warning and returns null forever after —
 * callers must handle a null return and carry on.
 */

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import type { Database } from "better-sqlite3";

const require = createRequire(import.meta.url);

const DB_PATH = process.env.DB_PATH || "./data/jvo-members.db";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS members (
  id INTEGER PRIMARY KEY,
  public_id TEXT UNIQUE,
  status TEXT NOT NULL,
  name TEXT,
  email TEXT,
  phone TEXT,
  business_name TEXT,
  business_address TEXT,
  membership_type TEXT,
  authorized_users TEXT,
  mailing_prefs TEXT,
  portal_token TEXT UNIQUE,
  info_confirmed_at TEXT,
  form1583_downloaded_at TEXT,
  appointment_at TEXT,
  approved_at TEXT,
  notes TEXT,
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS member_documents (
  id INTEGER PRIMARY KEY,
  member_id INTEGER NOT NULL REFERENCES members(id),
  kind TEXT NOT NULL,
  filename TEXT,
  stored_path TEXT,
  mime TEXT,
  size INTEGER,
  uploaded_at TEXT,
  UNIQUE(member_id, kind)
);

CREATE TABLE IF NOT EXISTS member_status_history (
  id INTEGER PRIMARY KEY,
  member_id INTEGER NOT NULL REFERENCES members(id),
  from_status TEXT,
  to_status TEXT NOT NULL,
  actor TEXT,
  note TEXT,
  at TEXT
);

CREATE TABLE IF NOT EXISTS member_email_log (
  id INTEGER PRIMARY KEY,
  member_id INTEGER NOT NULL REFERENCES members(id),
  kind TEXT NOT NULL,
  to_email TEXT,
  sent_at TEXT,
  UNIQUE(member_id, kind)
);

CREATE INDEX IF NOT EXISTS idx_members_status ON members(status);
CREATE INDEX IF NOT EXISTS idx_member_docs_member ON member_documents(member_id);
CREATE INDEX IF NOT EXISTS idx_member_history_member ON member_status_history(member_id);
CREATE INDEX IF NOT EXISTS idx_member_email_member ON member_email_log(member_id);
`;

let db: Database | null = null;
let failed = false;

/**
 * Lazy singleton. Returns the open Database, or null when SQLite isn't
 * available (missing native module, read-only filesystem, …). Warns once.
 */
export function getDb(): Database | null {
  if (db) return db;
  if (failed) return null;
  try {
    const BetterSqlite3 = require("better-sqlite3");
    fs.mkdirSync(path.dirname(path.resolve(DB_PATH)), { recursive: true });
    const opened: Database = new BetterSqlite3(DB_PATH);
    opened.pragma("journal_mode = WAL");
    opened.pragma("foreign_keys = ON");
    opened.exec(SCHEMA);
    db = opened;
    console.log(`[db] SQLite open at ${path.resolve(DB_PATH)}`);
    return db;
  } catch (err: any) {
    failed = true;
    console.warn(
      `[db] SQLite unavailable (${err?.message}) — membership pipeline persistence disabled; the site will keep working without it.`
    );
    return null;
  }
}

/** Current time as an ISO-8601 string (UTC) — the stamp format used everywhere. */
export function nowIso(): string {
  return new Date().toISOString();
}
