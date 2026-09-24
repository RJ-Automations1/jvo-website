/*
 * Where Stripe sends the customer back to after paying.
 *
 * The redirect itself proves nothing — anyone can type this URL — so the page
 * asks our server, which asks Stripe, whether the session really is paid. That
 * same call also finishes the booking if the webhook hasn't landed yet, so a
 * slow or misconfigured webhook never leaves someone paid-but-unbooked.
 *
 * Payment can be a moment behind the redirect, so a "pending" answer is retried
 * a few times before we tell anyone anything is wrong.
 */
import { useEffect, useState } from "react";
import { Link } from "wouter";

type Booking = {
  space: string;
  date: string;
  startTime: string;
  hours: number;
  amount: number;
  /** Card surcharge, when one applied. */
  fee?: number;
  total?: number;
  isMember: boolean;
  name: string;
  email: string;
};

type State =
  | { kind: "checking" }
  | { kind: "confirmed"; booking: Booking }
  | { kind: "expired" }
  | { kind: "problem"; message: string };

const RETRY_MS = 2000;
const MAX_TRIES = 8; // ~16s of "the webhook is probably just a beat behind"

/** "2026-08-11" → "Tuesday, August 11, 2026" */
function longDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC",
  });
}

export default function BookingConfirmed() {
  const [state, setState] = useState<State>({ kind: "checking" });

  useEffect(() => {
    const sessionId = new URLSearchParams(window.location.search).get("session_id");
    if (!sessionId) {
      setState({ kind: "problem", message: "This link is missing its payment reference." });
      return;
    }

    let cancelled = false;
    let tries = 0;

    const poll = async () => {
      tries += 1;
      try {
        const res = await fetch(`/api/book/session/${encodeURIComponent(sessionId)}`);
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;

        if (res.ok && data.status === "confirmed") {
          setState({ kind: "confirmed", booking: data.booking as Booking });
          return;
        }
        if (data.status === "expired") {
          setState({ kind: "expired" });
          return;
        }
        if (data.status === "paid_not_booked") {
          setState({ kind: "problem", message: data.error });
          return;
        }
        if (tries < MAX_TRIES) {
          setTimeout(poll, RETRY_MS);
          return;
        }
        setState({
          kind: "problem",
          message:
            "We haven't seen your payment confirmed yet. If you were charged, please call us on " +
            "(678) 519-4723 and we'll confirm your booking straight away.",
        });
      } catch {
        if (cancelled) return;
        if (tries < MAX_TRIES) setTimeout(poll, RETRY_MS);
        else setState({ kind: "problem", message: "We couldn't reach the server to confirm your booking." });
      }
    };

    void poll();
    return () => { cancelled = true; };
  }, []);

  return (
    <main className="min-h-screen bg-white text-black flex items-center justify-center px-6 py-24">
      <div className="w-full max-w-lg">
        {state.kind === "checking" && (
          <div className="text-center">
            <div className="mx-auto mb-6 h-10 w-10 animate-spin rounded-full border-2 border-black/15 border-t-black" />
            <h1 className="text-2xl font-semibold">Confirming your payment…</h1>
            <p className="mt-3 text-black/60">This only takes a moment. Please don't close this page.</p>
          </div>
        )}

        {state.kind === "confirmed" && (
          <div>
            <div className="mb-7 flex h-12 w-12 items-center justify-center rounded-full border border-black/15 text-xl">
              ✓
            </div>
            <h1 className="text-3xl font-semibold tracking-tight">You're booked.</h1>
            <p className="mt-3 text-black/60">
              We've emailed a confirmation to {state.booking.email}.
            </p>

            <dl className="mt-8 divide-y divide-black/10 border-y border-black/10">
              {[
                ["Space", state.booking.space],
                ["Date", longDate(state.booking.date)],
                ["Time", state.booking.startTime],
                ["Duration", `${state.booking.hours} ${state.booking.hours === 1 ? "hour" : "hours"}`],
                // Itemised when a card fee applied, so the figure here matches
                // the card statement rather than just the room rate.
                ...(state.booking.fee
                  ? [
                      ["Room", `$${state.booking.amount.toFixed(2)}${state.booking.isMember ? " (member rate)" : ""}`],
                      ["Card fee", `$${state.booking.fee.toFixed(2)}`],
                    ]
                  : []),
                [
                  "Paid",
                  `$${(state.booking.total ?? state.booking.amount).toFixed(2)}` +
                    (state.booking.fee || !state.booking.isMember ? "" : " (member rate)"),
                ],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between gap-6 py-3 text-sm">
                  <dt className="text-black/50">{label}</dt>
                  <dd className="text-right font-medium">{value}</dd>
                </div>
              ))}
            </dl>

            <p className="mt-7 text-sm text-black/55">
              Need to change or cancel? Reply to your confirmation email or call (678) 519-4723.
            </p>
            <Link
              href="/booking"
              className="mt-8 inline-block border border-black px-6 py-3 text-sm font-medium hover:bg-black hover:text-white transition-colors"
            >
              Book another space
            </Link>
          </div>
        )}

        {state.kind === "expired" && (
          <div>
            <h1 className="text-2xl font-semibold">That checkout expired.</h1>
            <p className="mt-3 text-black/60">
              You haven't been charged, and the slot has gone back on sale. You're welcome to pick it
              again.
            </p>
            <Link
              href="/booking"
              className="mt-8 inline-block border border-black px-6 py-3 text-sm font-medium hover:bg-black hover:text-white transition-colors"
            >
              Back to booking
            </Link>
          </div>
        )}

        {state.kind === "problem" && (
          <div>
            <h1 className="text-2xl font-semibold">We need to check something.</h1>
            <p className="mt-3 text-black/70">{state.message}</p>
            <p className="mt-6 text-sm text-black/55">
              Call (678) 519-4723 and we'll sort it out. You won't be charged twice.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
