/*
 * Shared Google service-account auth.
 *
 * One key (GOOGLE_SERVICE_ACCOUNT_JSON — the same account JVO Events uses) backs both
 * the booking calendar and the client master spreadsheet. Scopes differ per use, so
 * clients are cached per scope set rather than globally.
 *
 * The key lives ONLY on the server and is never exposed to the frontend bundle.
 */
import fs from "fs";
import { JWT } from "google-auth-library";

export function loadServiceAccount(): { client_email: string; private_key: string } | null {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (raw) {
    try { return JSON.parse(raw); } catch { console.error("GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON"); return null; }
  }
  const file = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (file && fs.existsSync(file)) {
    try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
  }
  return null;
}

const clients = new Map<string, JWT>();

/** A JWT client for the given scopes, or null when no service account is configured. */
export function getScopedClient(scopes: string[]): JWT | null {
  const key = scopes.join(" ");
  const cached = clients.get(key);
  if (cached) return cached;

  const sa = loadServiceAccount();
  if (!sa) return null;
  const client = new JWT({ email: sa.client_email, key: sa.private_key, scopes });
  clients.set(key, client);
  return client;
}

/** Useful in errors: the address a spreadsheet or calendar must be shared with. */
export const serviceAccountEmail = (): string | null => loadServiceAccount()?.client_email ?? null;
