# Stripe: webhook setup and go-live checklist (Groundwork account)

Internal doc. Never show "Stripe" in the UI (customer copy says "card" / "membership").

## What the app uses Stripe for

- **Platform membership** for affiliates and contractors: monthly subscription with a free trial, card saved with a SetupIntent, card on file shown in the portals.
- **Prices are created automatically** by the app (looked up by `lookup_key`, created if missing). You do **not** create products or prices by hand in the dashboard.
- **Customers are recreated automatically** if a saved customer ID doesn't exist in the current account (3 affiliates have IDs from the old account; they self-heal on their next card action).

## Environment variables (Vercel + local `.env`)

| Variable | Test mode (now) | Live (go-live day) | Where to find it |
|---|---|---|---|
| `STRIPE_SECRET_KEY` | `sk_test_…` | `sk_live_…` | Dashboard → Developers → API keys → Secret key |
| `VITE_STRIPE_PUBLISHABLE_KEY` | `pk_test_…` | `pk_live_…` | Same page → Publishable key |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…` (test endpoint, or from `stripe listen` locally) | `whsec_…` (live endpoint) | Developers → Webhooks → your endpoint → Signing secret → Reveal |

All three must be from the **same account and the same mode**. `VITE_…` is baked into the front end at build time, so **redeploy after changing it**.

## Webhook endpoint

- **URL:** `https://www.groundworkcapitalgroup.com/api/webhooks/billing`
  - Use **www**. The bare domain answers with a 308 redirect, and Stripe does not follow redirects, so every delivery would fail.
- **Listen to:** events on *Your account* (not Connected accounts)
- **API version:** `2026-09-30.endive` (matches the app's Stripe library, v23)
- **Events to select (9):**
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `customer.subscription.paused`
  - `customer.subscription.resumed`
  - `invoice.paid`
  - `invoice.payment_failed`
  - `invoice.payment_action_required`
  - `payment_method.updated`
  - (optional, card networks auto-update expired cards) `payment_method.automatically_updated`

The app verifies every event with the signing secret, ignores duplicates (`billing_webhook_events`), and on:
- `customer.subscription.*` → syncs status / trial end / period end on the affiliate or contractor
- `invoice.payment_failed` / `payment_action_required` → emails + texts the member a secure "update your card" link and starts the **Payment failed** automation (if on)
- `invoice.paid` → clears the failure state
- `payment_method.*` → refreshes the card on file (brand, last 4, expiry)

## A. Dev / test setup (now)

### Option 1: local machine (recommended for dev)
No dashboard endpoint needed: the Stripe CLI forwards test events to your laptop.
1. Install the CLI: `brew install stripe/stripe-cli/stripe`, then `stripe login` (pick the **Groundwork** account).
2. Put the **test** keys in `.env` (`STRIPE_SECRET_KEY=sk_test_…`, `VITE_STRIPE_PUBLISHABLE_KEY=pk_test_…`).
3. Run the dev server with Stripe: `bash scripts/dev-stripe.sh` (or the **dev-stripe** preview). It refuses live keys, sets `NOTIFY_SANDBOX=true`, and gets the webhook secret from `stripe listen` automatically.
4. In a second terminal: `stripe listen --api-key "$(grep ^STRIPE_SECRET_KEY= .env | cut -d= -f2-)" --forward-to https://localhost:8080/api/webhooks/billing --skip-verify`
5. Trigger a test: `stripe trigger invoice.payment_failed`

### Option 2: the deployed site in test mode
1. Dashboard → toggle **Test mode** → Developers → Webhooks → **Add endpoint**.
2. URL and events as above → **Add endpoint** → reveal **Signing secret**.
3. Vercel → Project → Settings → Environment Variables (Production): set the three **test** values → **Redeploy**.
4. Endpoint page → **Send test webhook** → `invoice.paid` → expect **200**.

### Test cards
- Success: `4242 4242 4242 4242`, any future date, any CVC, any ZIP
- Needs authentication (3D Secure): `4000 0025 0000 3155`
- Declined on renewal: attach `4000 0000 0000 0341` (attaches fine, fails when charged)
- Full list: https://docs.stripe.com/testing

### Test plan (test mode)
1. Affiliate portal → Membership → add card `4242…` → status **Trialing**, card shows in admin → Billing.
2. Dashboard → the customer's subscription → **Actions → End trial now** (or use a test clock) → invoice paid → status **Active**.
3. Swap card to `…0341` → end trial / advance → `invoice.payment_failed` → member gets the update-card email + text (with `NOTIFY_SANDBOX=true` locally nothing real is sent), admin Billing shows **Past due**.
4. Update the card from the secure link → `invoice.paid` → back to **Active**.
5. Cancel from the portal → `customer.subscription.updated` (cancel at period end) → admin shows it.
6. Dashboard → Webhooks → endpoint → every event **200** (no 4xx/5xx).

## B. Go-live checklist (live mode)

### 1. Activate the account (Dashboard → Settings)
- [ ] **Business details** complete: legal name *Groundwork Capital Group*, EIN, address (2717 W Coast Hwy Ste C, Newport Beach, CA 92663), website `https://groundworkcapitalgroup.com`, industry, product description ("Monthly platform membership for real-estate affiliates and licensed contractors").
- [ ] **Representative / owners** verified (ID + SSN last 4).
- [ ] **Bank account** for payouts added and verified.
- [ ] **Public details** (Settings → Business → Public details): statement descriptor e.g. `GROUNDWORK CAPITAL` (max 22 chars), short descriptor `GROUNDWORK`, support phone **(866) 864-7506**, support email **info@groundworkcapitalgroup.com**, website. This is what members see on their bank statement.
- [ ] **Branding** (Settings → Branding): logo, icon, brand color `#0E2A4A`, accent `#D9A441` (used on receipts/invoices).
- [ ] **Emails** (Settings → Customer emails): turn on *Successful payments* receipts and *Failed payments* only if you want Stripe's emails in addition to the app's (the app already sends the update-card email; avoid double emails: leave Stripe's failed-payment email **off**).
- [ ] **Retries** (Settings → Billing → Subscriptions and emails → Manage failed payments): Smart Retries on, e.g. 4 tries over 2 weeks, then **mark the subscription unpaid** or **cancel** (pick one; the app syncs either).
- [ ] **Card updater**: on by default (keeps expiring cards current; triggers `payment_method.automatically_updated`).
- [ ] **Radar** (fraud): defaults are fine; optionally block if CVC fails.
- [ ] **Tax**: memberships are typically not taxable in CA, but confirm with your accountant before enabling Stripe Tax.
- [ ] **Two-factor auth** on for every team member; invite only who needs access (Settings → Team, roles: Administrator for owners, Developer for engineers, Support/View-only otherwise).

### 2. Live webhook
- [ ] Turn **off** Test mode → Developers → Webhooks → **Add endpoint**: same URL, same events, API version `2026-09-30.endive`.
- [ ] Copy the **live** signing secret.

### 3. Switch keys (Vercel → Production)
- [ ] `STRIPE_SECRET_KEY=sk_live_…`
- [ ] `VITE_STRIPE_PUBLISHABLE_KEY=pk_live_…`
- [ ] `STRIPE_WEBHOOK_SECRET=whsec_…` (live endpoint)
- [ ] **Redeploy** (`npm run deploy:prod`) so the front end picks up the live publishable key.
- [ ] Keep **test** keys in your local `.env` (never live keys on a laptop; `dev-stripe.sh` refuses them).

### 4. Data from test mode
- Test-mode customers / subscriptions don't exist in live mode. The app recreates customers automatically on the next card action, but members who saved a **test** card must add a real card. Before launch, clear test billing data so nobody shows a stale status:
  ```sql
  -- run once, right after switching to live keys
  UPDATE affiliates  SET billing_customer_id = NULL, billing_subscription_id = NULL, billing_payment_method_id = NULL, billing_status = 'none', billing_card_brand = NULL, billing_card_last4 = NULL, billing_card_exp = NULL WHERE billing_customer_id IS NOT NULL;
  UPDATE contractors SET billing_customer_id = NULL, billing_subscription_id = NULL, billing_payment_method_id = NULL, billing_status = 'none', billing_card_brand = NULL, billing_card_last4 = NULL, billing_card_exp = NULL WHERE billing_customer_id IS NOT NULL;
  ```
  (Ask Claude to turn this into a migration when you're ready, so it's recorded.)

### 5. Live smoke test (real card, small risk)
- [ ] Your own affiliate test account → add your real card → **Trialing**, no charge today.
- [ ] Dashboard (live) → Webhooks → endpoint shows `customer.subscription.created` **200**.
- [ ] Cancel that subscription in the dashboard → app shows canceled → `customer.subscription.deleted` **200**.
- [ ] Optional real charge: set a $1 price override on your own record (admin → Billing → price) and end the trial → receipt arrives → refund it from the dashboard.

### 6. After launch
- Watch Developers → Webhooks → endpoint for failures the first week (Stripe retries for 3 days; fix and click **Resend**).
- Payouts: Balance → Payouts (default: daily, 2 business days).
- Disputes: Payments → Disputes; respond within the deadline (receipts, membership terms, signed affiliate agreement PDF from the app).

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Webhook shows **308** / "redirect" | Endpoint URL without `www` | Edit the endpoint URL to `https://www.groundworkcapitalgroup.com/api/webhooks/billing` |
| Webhook shows **400** "signature" | `STRIPE_WEBHOOK_SECRET` from a different endpoint / mode | Copy the secret from *this* endpoint, set it in Vercel, redeploy |
| Card form doesn't load | `VITE_STRIPE_PUBLISHABLE_KEY` missing or mode mismatch with secret key | Set it, **redeploy** (build-time variable) |
| "No such customer" in logs | ID from the other account/mode | Self-heals on next card action; or run the reset SQL above |
| Member paid but still "Past due" | `invoice.paid` not subscribed or failing | Add the event / check endpoint deliveries, **Resend** |

## Useful links
- API keys: https://dashboard.stripe.com/apikeys (test: `/test/apikeys`)
- Webhooks: https://dashboard.stripe.com/webhooks (test: `/test/webhooks`)
- Account activation: https://dashboard.stripe.com/account/onboarding
- Testing cards: https://docs.stripe.com/testing
- Stripe CLI: https://docs.stripe.com/stripe-cli
- Webhook best practices: https://docs.stripe.com/webhooks
- Going live checklist (official): https://docs.stripe.com/get-started/checklist/go-live
