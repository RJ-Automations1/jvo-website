# How Membership Invoicing Works

Writing up a member's invoice from the client master list, sending it, and taking the
money — including a 3% card fee and payments made in instalments.

---

## The short version

```
Mailbox application lands a row on the Google Sheets master list
        │
        ▼
Staff open the Invoicing Desk  →  /admin/invoices
        │   the master list is already there: name, email, plan, suite
        ▼
Pick a client — the plan's price is filled in as the first line item
        │
        ▼
Create Invoice  ──► emailed to the member with a pay link
        │       └──► Invoice #, Total, Status, Balance Due written back
        │            to that same master-list row
        ▼
Member opens /invoice/<token> and pays ALL or PART of it by card
        │   card payments add a 3% processing fee on top
        ▼
Stripe webhook credits the payment → balance falls → receipt emailed
        │
        ▼
Balance reaches zero → status "Paid in full", on the page and on the sheet
```

Cash and check are recorded by staff on the same invoice and carry **no fee**.

---

## Why the ledger lives here and not in Stripe Invoicing

A Stripe invoice is paid once, in full. JVO needed the opposite: a balance a member can
pay down in instalments. So the invoice — what is owed, what's been paid, what's left —
is ours, and Stripe is only how card money arrives. Each payment is its own Checkout
session credited against the invoice.

---

## Step by step

### 1. The master list is the source

`/admin/invoices` reads the same Google Sheet the mailbox application writes to
(`server/clientSheet.ts`). Staff never retype a name, email, plan, or suite number — and
because the read is keyed by *header name*, it keeps working when someone reorders the
sheet's columns.

Each row shows either the plan's suggested price or the invoice already raised against
it, so "who still needs invoicing" is answerable at a glance.

### 2. Line items come from the price list

Picking a client pre-fills one line item from their **Plan** column, priced from
`shared/billing.ts` — the single place plan prices live for billing purposes (it mirrors
the memberships section and `/pricing`; change all three in the same commit).

Staff can edit any line, add another from the memberships/services dropdown, or add a
blank line for something one-off. The running total is live.

### 3. Terms on the invoice

| Field | Meaning |
|---|---|
| **Due date** | Shown to the member; nothing is enforced automatically |
| **Minimum payment** | The smallest instalment accepted (default **$25**) |
| **Partial payments** | On by default. Off means the balance is payable in full only |
| **Note** | Free text shown on the invoice and in the email |

A minimum is never allowed to exceed what's payable — a $10 balance can't demand a $25
instalment, and a 40¢ remainder can't be made unpayable by a $1 floor.

### 4. What the member gets

An email with the line items, the balance, and a **Pay This Invoice** button, pointing at
`/invoice/<token>` — a crypto-random token, so the link is the credential; there is no
login. The page shows:

- every line item, the total, anything paid so far, and the balance
- an amount box (defaulting to everything payable) with *Full balance / Half / Minimum* shortcuts
- a live breakdown: **payment + 3% card fee = charged to your card**
- what the remaining balance will be afterwards, if they're paying part

### 5. The 3% card fee

Set by `CARD_FEE_PERCENT` (default `3`, `0` switches it off, capped at 10 in code so a
typo can't overcharge anyone).

- It is a straight percentage **of the payment**, not a gross-up — "3% card fee" is what
  the member is told, so 3% is what they're charged.
- It rides as its **own Stripe line item**, named and visible before they confirm.
- It is **not credited against the balance**. Pay $199 by card, you're charged $204.97
  and owe nothing. Pay the same $199 in cash, there's no fee at all.
- Staff-recorded payments (cash, check, bank transfer) never attract one — the fee exists
  to cover card processing.
- **The same rate applies to room bookings** (`/booking`), from the same env var and the
  same `server/cardFee.ts`. There, it's itemised on the booking summary, the Stripe page,
  the confirmation email, and the calendar event. A free booking (a tour) never attracts
  one.

### 6. Partial payments

The member enters any amount between the minimum and the balance. The server re-reads the
invoice and decides: the browser sends *how much*, never *how much it costs*.

Each attempt is a row in `invoice_payments`, written **before** the member reaches Stripe
so the webhook can always find it. Status follows the ledger automatically:

```
open  ──first payment──►  partial  ──balance hits zero──►  paid
```

**A live attempt is held back from what's payable.** A pending row doesn't reduce the
*balance* (no money has arrived), but its amount is subtracted from what the page will let
them pay next. Without that, a member who opens checkout for the full balance, hits Back,
and opens it again has two live sessions for the same money — pay both and they've
overpaid. The held-back amount is released the moment they press Back on Stripe's page
(the cancel return expires that session at Stripe and frees the hold immediately), and
otherwise when the session times out — `CHECKOUT_TTL_MINUTES`, 60 — which the page sweeps
for on every load. If Stripe takes money for a session we had already written off, the
payment is credited anyway and logged: money arriving is the fact that settles it.

Remainders under **50¢** can't be charged at all — Stripe's floor — so the page asks them
to settle it at the office instead of showing a button that would always fail.

### 7. How a payment gets credited

Two independent paths, both idempotent (keyed on the Stripe session id, so neither can
double-credit):

1. **Webhook** — `/api/stripe/webhook`, the *same* endpoint the room bookings use. Stripe
   sends every event for the account to one URL, so invoice sessions are told apart by
   `metadata.kind = "invoice_payment"`.
2. **Return page** — when the member lands back on `/invoice/<token>?session_id=…` the
   server asks Stripe directly and settles it there and then.

So a webhook that is merely slow, or misconfigured entirely, never leaves someone charged
with their balance untouched.

A receipt email follows each credited payment, saying what was applied, what the fee was,
and what (if anything) is still owed.

The return page says only what it can stand behind. A delayed method (ACH and friends)
comes back authorised but unsettled, so that member is told their payment is **processing**
and that the receipt follows when it clears — never "your payment is in" over an unchanged
balance.

### 8. Back onto the sheet

After every change — raised, paid, part-paid, voided — four columns on that client's row
are updated: **Invoice #**, **Invoice Total**, **Invoice Status**, **Balance Due**. These
are the only existing cells this codebase ever overwrites.

Because membership billing is monthly, a row accumulates invoices, so those cells are
written from **all** of that row's invoices, not just the one that changed:

- **Invoice #** / **Invoice Total** / **Invoice Status** — the newest live invoice
- **Balance Due** — everything the client owes across every invoice on the row
- the status gains `· +N more unpaid` when an older invoice is still outstanding

Otherwise a late payment on September's invoice would overwrite the row with September's
numbers while October's was still open, and the sheet would claim October was settled.

If the sheet is unreachable the invoice is unaffected; the sheet is a mirror, never the
source of truth.

---

## Staff actions

| Action | Where | Notes |
|---|---|---|
| Create invoice | Master list tab → pick a client | Emails the pay link unless you untick it |
| Resend invoice | Invoices tab → pick an invoice | Same link; nothing is re-created |
| Copy pay link | Invoice detail | For reading out over the phone |
| Record cash / check | Invoice detail | No card fee; can't exceed the balance |
| Void | Invoice detail | Only while nothing has been paid — refund in Stripe otherwise. Any open checkout session is expired at Stripe too, so a member sitting on the payment page can't pay a cancelled invoice. If one slips through the race anyway, the invoice **reopens** and logs loudly rather than pocketing the money silently |

---

## Security notes

- `/admin/invoices` and every `/api/admin/…` route sit behind the same HTTP Basic Auth as
  the membership dashboard (`ADMIN_USER` / `ADMIN_PASSWORD`), applied explicitly rather
  than inherited by mount order.
- The pay page is reachable only with the invoice's token, is `noindex`, and is rate
  limited (30 requests/minute/IP) to discourage token guessing.
- **The browser never sends a price.** It sends how much of its own balance it wants to
  pay; the server re-reads the invoice, refuses anything above the balance or below the
  minimum, and computes the fee itself.
- Overpayment is impossible through the page: the amount is clamped to the balance *minus
  anything already in a live checkout session*, and staff can't record more than the
  outstanding balance either.

---

## Configuration

| Variable | What it is |
|---|---|
| `JVO_SHEET_ID` / `JVO_SHEET_TAB` | The client master list — shared as an **Editor** with the service account |
| `STRIPE_SECRET_KEY` | Without it, invoices can still be raised and cash recorded; the pay page says to call |
| `STRIPE_WEBHOOK_SECRET` | Same endpoint as bookings — no second webhook to configure |
| `PUBLIC_BASE_URL` | The origin used in every pay link. A wrong value emails members a dead link |
| `CARD_FEE_PERCENT` | Default `3`. `0` turns the surcharge off |
| `ADMIN_USER` / `ADMIN_PASSWORD` | The Basic Auth gate on the invoicing desk |
| `SMTP_USER` / `SMTP_PASS` | Sends the invoice and the receipts |

Invoice emails and receipts are **not** held back by `MEMBER_EMAILS_ENABLED`: one goes out
because staff pressed *send*, the other is a receipt for money that just left someone's
card. Silently holding either back would be worse than not offering the button.

## Where the code lives

| File | Role |
|---|---|
| `server/invoices.ts` | The ledger, the staff desk, the customer pay page |
| `shared/billing.ts` | Plan prices, the card-fee maths, money formatting |
| `server/clientSheet.ts` | Reading the master list and writing the billing columns back |
| `server/memberEmail.ts` | `sendInvoiceIssued`, `sendPaymentReceipt` |
| `server/bookingPayments.ts` | The shared Stripe webhook that dispatches invoice sessions |
| `server/db.ts` | `invoices` and `invoice_payments` tables |
