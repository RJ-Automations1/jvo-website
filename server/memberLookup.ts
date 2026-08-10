/*
 * "Is this email a member?" — the one place that question gets answered.
 * ---------------------------------------------------------------------
 * The booking form has an "I am a member" step, and the answer decides which
 * rate Stripe charges. So this runs server-side only and is never influenced by
 * anything the browser claims.
 *
 * Two sources, checked in order:
 *
 *   1. DESKWORKS — the system of record for who is actually a paying member.
 *      Requires a token scoped to member/user records AND the lookup path,
 *      which are account-specific. See the note in deskworksMemberLookup().
 *   2. The local `members` table — everyone who completed onboarding through
 *      this site (see memberPipeline.ts). Always available, but only covers
 *      members who signed up here, not ones added directly in Deskworks.
 *
 * A miss in one source falls through to the next; a member found in either is a
 * member. Errors never grant the discount — an outage must not become a
 * coupon — but they also never deny a local match, because the local table is
 * ours and can be trusted when Deskworks is unreachable.
 */
import { getDb } from "./db.js";

const DESKWORKS_KEY = process.env.DESKWORKS_API_KEY || "";
const DESKWORKS_BASE = (process.env.DESKWORKS_BASE_URL || "").replace(/\/$/, "");
/*
 * The path that looks a member up by email, e.g.
 * "/api/v1/centers/6/users?email={email}". Left UNSET on purpose: the token
 * currently issued for this account is a read-only *catalog* token — it serves
 * /centers and /centers/:id/reservations and 404s on every user/member/customer
 * path that was tried. Until Deskworks issues a member-scoped token and
 * confirms the path, this stays empty and lookups fall through to the local
 * table. Set DESKWORKS_MEMBER_PATH (with a {email} placeholder) to switch it on
 * — no code change needed.
 */
const DESKWORKS_MEMBER_PATH = process.env.DESKWORKS_MEMBER_PATH || "";

export type MemberSource = "deskworks" | "local" | null;
export interface MemberResult {
  member: boolean;
  source: MemberSource;
  /** True when Deskworks was asked and answered (so "no" is authoritative). */
  deskworksChecked: boolean;
}

/** Pull a truthy answer out of whatever shape the account's API returns. */
function looksLikeAMatch(data: unknown, email: string): boolean {
  const wanted = email.trim().toLowerCase();
  const hasEmail = (o: any): boolean =>
    o && typeof o === "object" &&
    typeof o.email === "string" && o.email.trim().toLowerCase() === wanted;

  if (Array.isArray(data)) return data.some(hasEmail);
  if (data && typeof data === "object") {
    const o = data as any;
    if (hasEmail(o)) return true;
    // Common envelope shapes: { data: [...] } / { users: [...] } / { results: [...] }
    for (const key of ["data", "users", "members", "customers", "results", "items"]) {
      const inner = o[key];
      if (Array.isArray(inner) && inner.some(hasEmail)) return true;
    }
  }
  return false;
}

/**
 * Ask Deskworks whether this email belongs to a member.
 * Returns null when we can't get an authoritative answer (not configured,
 * unreachable, or the endpoint rejected us) so the caller can fall through.
 */
async function deskworksMemberLookup(email: string): Promise<boolean | null> {
  if (!DESKWORKS_KEY || !DESKWORKS_BASE || !DESKWORKS_MEMBER_PATH) return null;

  const url =
    DESKWORKS_BASE + DESKWORKS_MEMBER_PATH.replace("{email}", encodeURIComponent(email));
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        Authorization: `Bearer ${DESKWORKS_KEY}`,
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0 (compatible; JVOWebsiteBot/1.0; +https://jonesborovirtualoffice.com)",
      },
    });
    if (res.status === 404) {
      /*
       * Ambiguous by design: a REST API returns 404 both for "no such member"
       * and "no such endpoint". Treat it as no-answer rather than a firm "not a
       * member", so a wrong path can't quietly overcharge every member.
       */
      return null;
    }
    if (!res.ok) {
      console.warn(`deskworks member lookup: HTTP ${res.status}`);
      return null;
    }
    return looksLikeAMatch(await res.json(), email);
  } catch (e: any) {
    console.warn("deskworks member lookup failed:", e?.name || e?.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Everyone who finished onboarding here and was approved. */
function localMemberLookup(email: string): boolean {
  const db = getDb();
  if (!db || !email) return false;
  try {
    const row = db
      .prepare("SELECT 1 FROM members WHERE lower(email) = lower(?) AND status = 'active' LIMIT 1")
      .get(email.trim());
    return Boolean(row);
  } catch {
    return false; // a lookup failure must never hand out the discount
  }
}

/** The answer, and where it came from. */
export async function verifyMember(email: string): Promise<MemberResult> {
  const addr = String(email || "").trim();
  if (!addr) return { member: false, source: null, deskworksChecked: false };

  const viaDeskworks = await deskworksMemberLookup(addr);
  if (viaDeskworks === true) return { member: true, source: "deskworks", deskworksChecked: true };

  if (localMemberLookup(addr)) return { member: true, source: "local", deskworksChecked: viaDeskworks !== null };

  return { member: false, source: null, deskworksChecked: viaDeskworks !== null };
}

/** Whether member lookup can consult Deskworks at all. */
export function deskworksLookupConfigured(): boolean {
  return Boolean(DESKWORKS_KEY && DESKWORKS_BASE && DESKWORKS_MEMBER_PATH);
}
