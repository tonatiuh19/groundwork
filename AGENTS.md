# Groundwork Capital — Agent / Copilot Instructions

## ⚠️ CRITICAL RULES - MUST FOLLOW

- **ALWAYS reference `database/schema.sql` for exact table structure and column names**
- **NEVER assume column names - verify in schema.sql before writing SQL queries**
- **NEVER fetch data directly in components with axios or fetch**
- **ALL data fetching MUST be done in Redux store (slices) using createAsyncThunk**
- **Components ONLY dispatch actions and select state from store**
- **NEVER touch schema.sql directly for schema changes — use migration files in `database/migrations/`**
- **When using any console logging for debugging use logger functions from `client/utils/logger.ts` for consistent formatting and log levels only in UI components**
- **NEVER Patch issues, always fix the root cause of type errors or bugs immediately**
- **if any update is made to api/index.ts, ALWAYS update `api/swagger.yaml` in the same change**
- **if any UI, branding, email chrome, or public-flow change is made, ALWAYS update `DESIGN_SYSTEM.md` in the same change**
- **Always think about mobile responsiveness and cool, engaging UI/UX when making frontend changes**
- **Mobile (mandatory, no exceptions):** every public page, portal shell, form, table, modal, and wizard MUST work on phones (~320–430px) and tablets without layout breaks, clipped controls, or **document-level horizontal scrolling** (vertical scroll only at the page level). Prefer fluid widths (`minmax(0, …)`, `%`, `clamp`), collapsing grids, and wrapping toolbars. If a region must scroll sideways (e.g. kanban board, milestone tracker, wide table), contain it with `overflow-x: auto` + `max-width: 100%` on an inner wrapper — never let the page itself scroll horizontally. Fix overflowing children; do not rely on body `overflow-x: hidden` alone. Validate at **~320px and ~375px** before finishing (`npm run audit:mobile` checks every portal page and fails on any sideways scrolling). Full agent standard: `.cursor/rules/mobile-responsive.mdc`.
- **if there is an opportunity to add reusable components or utilities, do it immediately to avoid technical debt**
- **Avoid any breaking changes**
- **i18n: When making any UI change that introduces new user-visible strings, ALWAYS add the corresponding key to BOTH `client/locales/en/translation.json` AND `client/locales/es/translation.json`, and use `t('key')` via `useTranslation()` — NEVER hardcode user-facing strings in components. Browser language is detected when possible; fallback is English.**
- **No long dashes (—) in customer-facing copy**: emails, SMS, public pages and the affiliate / contractor / homeowner portals (EN + ES) must not use " — " to join sentences. Write a period ("Nothing is charged today. Your 90 free days…") or a comma; for title separators use " · " ("You're approved · Groundwork affiliate program"). Allowed: a lone "—" as an empty-value placeholder in tables, code comments, and staff-only admin screens. Enforced by `client/locales/noEmDash.spec.ts`.
- **Tests & local QA: never send real notifications.** `VITEST=true` must never send live Resend email, Twilio SMS, Ably publishes, or in-app `admin_notifications` to real staff — staff fan-out in tests is limited to `@example.com` / `@example.test` fixtures. Integration tests that write to TiDB must clean fixtures in `afterAll` using `api/testDbCleanup.ts` (only `@example.com` / `@example.test`). Tag every fixture with a run prefix `gw<suite>-${Date.now()}-` (emails, slugs, titles, labels) and clean with `cleanupPortalFixturesByPrefix(prefix)` — it also removes SET NULL children (templates, test lines, events, contact threads) and FK-less logs (`people_dedupe_log`, bell rows). `api/testGlobalSetup.ts` sweeps every interrupted run (any age: it holds the run lock, so earlier fixture sets are from dead runs) before each run and fails the run if this run's fixtures survive; when a suite creates a new kind of row, extend `cleanupPortalFixturesByPrefix` + `api/testDbCleanup.integration.test.ts`. Enforced in code by `notifySandbox()` in `api/index.ts` (on for every Vitest run): email / SMS / Ably are dry-run and staff fan-out skips non-test admins. Manual QA on the dev server delivers for real unless you set `NOTIFY_SANDBOX=true` in `.env` — always do that before QA, and only use `@example.com` fixtures. New outbound channels MUST check `notifySandbox()`. Staff must never see test data: (1) one test run at a time (DB lock in `api/testGlobalSetup.ts`; a second run waits); (2) every run ends with `purgeTestLeftovers` and fails if any test-signature row survives; (3) `npm run deploy:prod` purges test data after the test step on pass, fail or Ctrl+C (`npm run test:cleanup-fixtures`, `-- --dry-run` to preview); (4) fixtures MUST carry a test signature: `gw<suite>-<ts>-` prefix or `@example.com` / `@example.test` email, and **phone lines MUST be fictional `+1555…` numbers** (enforced by `api/testFixtureRules.test.ts`). Never create a fixture cleanup can't recognize.
- **Tests never depend on or change live data.** Settings: under Vitest `readSetting` answers money / pricing / session keys from `TEST_SETTING_DEFAULTS` and every settings write (`writeSetting`, the Settings PUT, `upsertSystemSetting`) stays in per-file memory, so never read or write `system_settings` in a test or in code outside those helpers. Versioned documents that staff approve (legal pages, construction agreements, City Partner agreements) are read through a test scope: a suite inserts its own version with notes starting with its prefix and sets `GW_LEGAL_TEST_PREFIX` / `GW_CP_TEST_PREFIX`; any new staff-approved table MUST get the same scope.
- **Tests: cheapest test that proves the rule.** Pure rules (math, state machines, validators, matching, permission matrix) are unit tests with no DB; integration tests on the shared TiDB only prove wiring (sessions, role gates, FKs, transactions, races) with one legal + one illegal path, fixtures by direct SQL, and every outside service faked through its `__testSet…` seam. Full rule: `.cursor/rules/testing.mdc`.
- **Always review the chat history before making changes to understand what has already been fixed or implemented, and avoid reintroducing previously resolved issues**
- **All required API logic should remain inline within api/index.ts, as the application is deployed on Vercel using a serverless architecture**
- **NO EXCEPTIONS to these rules**

### Database cost (TiDB Cloud Serverless bills per request unit)

- Settings reads go through `readSetting` / `getSettingInt` / `getSystemSettingValue` (30s in-process cache). Every write to `system_settings` MUST call `forgetSetting(key)` after it; never query `system_settings` directly for a single key.
- Keep crons infrequent (current: mail-sync hourly :05, reminder-flows hourly :15, appointment-reminders hourly :30, anchor-sync 6h, daily billing / contractor apps, weekly legal notices). Every cron must exit early with one tiny indexed query when there's nothing to do; housekeeping (deletes, sweeps) runs once a day, not on every run. Prefer on-demand work (on page open, throttled) over polling.

### Package Manager

- **Always use npm** (never pnpm or yarn)

### Backend

- Apis are in api/index.ts
- TypeScript throughout
- Single port (8080) for both frontend/backend in development
- **CRITICAL: Always reference `database/schema.sql` for database structure and table definitions**
- **If any database update is made based on schema.sql, generate a migration file** in `database/migrations/` with timestamp prefix (e.g. `YYYYMMDD_HHMMSS_description.sql`) for **TiDB Cloud Serverless** (MySQL 8.0 compatible)
- After applying, **update `database/schema.sql`** to reflect the new table/column

### Running Migrations (TiDB Cloud)

```bash
npm run db:migrate
```

`scripts/apply-migrations.sh` records each file in `schema_migrations` and skips already-applied ones. Legacy re-applies that hit duplicate column/key errors are recorded and continued; other SQL errors still abort.

Or apply a single file:

```bash
DB_PASS=$(grep "^DB_PASSWORD" .env | cut -d'=' -f2-) && \
DB_HOST=$(grep "^DB_HOST" .env | cut -d'=' -f2-) && \
DB_PORT=$(grep "^DB_PORT" .env | cut -d'=' -f2-) && \
DB_USER=$(grep "^DB_USER" .env | cut -d'=' -f2-) && \
DB_NAME=$(grep "^DB_NAME" .env | cut -d'=' -f2-) && \
mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" -p"$DB_PASS" "$DB_NAME" \
  --ssl-mode=REQUIRED --protocol=TCP \
  < database/migrations/YOUR_MIGRATION_FILE.sql
```

### Project Structure

- `client/pages/` — Route components (`Index.tsx` = home)
- `client/store/slices/` — Redux async thunks
- `client/locales/{en,es}/` — i18n
- `shared/api.ts` — shared types (`import type` only from API)
- `api/index.ts` — Vercel Express monolith
- `database/schema.sql` + `database/migrations/`

### Path Aliases

- `@/*` → `client/`
- `@shared/*` → `shared/`

### Deploy

```bash
npm run deploy:prod
```

Git: runs only on `main`, never behind origin, never with `.env` / key files. Uncommitted or unpushed work is asked about first: commit + push with the suggested message (rule-based from the changed files) or my own, "I'll handle it in the terminal" (waits until main is clean and pushed), or abort. Order: git → api inline check → typecheck → vitest (live progress bar) → strict git re-check → version (suggested patch / minor / custom / type it / abort) → `vercel --prod` → stamp `system_settings.app_version` → tag `v<version>`. `--allow-dirty` ships uncommitted files. Questions also go to Telegram when `TELEGRAM_BOT_TOKEN` is set (`scripts/deployAsk.ts`; first answer wins, terminal or Telegram; only the saved `TELEGRAM_CHAT_ID` can answer), plus started / live / aborted messages. Once tests have started, any abort purges test data, and a failed purge stops the deploy.

### Staff notify

Staff notify events are **routed by area** (Settings → Team notifications → "Who gets what", super_admin; table `notify_routing`): leads & events, clients, contractors, affiliates, projects & money, system. An area that isn't set up goes to **super admins only**. The record's assigned staff member (`clients.assigned_admin_id`, `projects.assigned_admin_id`) also gets it unless the area turns that off: pass `{ clientId }` / `{ projectPublicId }` as the 3rd arg of `notifyStaff`. Each person's `notification_prefs_json` still picks email / bell / SMS; `admin_notify_extra_emails` still opt in per event. `inbound_sms` / `inbound_email` go to the line / mailbox owner (never routed). New events MUST be added to `NOTIFY_EVENT_AREA`. Tests never write `notify_routing` (use `__testSetNotifyRouting`).

### Sign-in and phone-only homeowners

- Every portal signs in by email **or phone** (`findPortalLogin`): a phone gets the 6-digit code by text (campaign line, STOP honored → `errors.otpSmsUnavailable`); a number shared by two live accounts → `errors.phoneShared`. Sign-in codes (email or text) are sent with `manual: true` so they never appear in a person's message history.
- Homeowner forms (affiliate add client, admin new client, public enroll) take email, phone or both, at least one (`validation.emailOrPhoneOne`). Homeowners can be saved without an email: `clients.email` NULL, `client_portal_invites.email` NULL, leads keep `''`. Affiliate / enroll need `sms_consent` when there's no email (`PhoneOnlyConsent`); the invite, appointment notices and agreement links go by text. Test fixtures for phone-only clients carry the run prefix in `first_name` (cleanup matches it).

### Inbound text alerts

- Staff alerts for a text name the sender: client / CRM contact threads use their name; unmatched numbers go through `inboundSenderLabel` (staff-given `display_name`, else the person on that number via `resolvePeopleByPhone` with their role in the admin's language, else the number).

### Improve with AI (staff composers)

- `POST /api/admin/ai/improve-text` (any staff) → `aiImproveText` (Claude via `assistantApi`, model `ANTHROPIC_REWRITE_MODEL` default `claude-haiku-5-5`): same language, never invents facts; `aiRewriteKeepsFacts` refuses any rewrite that adds / drops a `{{placeholder}}`, link, email or number (422 `errors.aiChangedFacts`). Nothing is sent or saved. UI: `ImproveWithAiButton` (rewrite in place + Undo) in every staff composer; new composers MUST use it. Tests fake Claude with `__testSetAssistantApi`.

### Automatic messages

- `sendEmail` / `sendSms` log every send to a CRM person (client / lead / affiliate / contractor / contact) in `automatic_messages` and in their Conversations thread (`metadata_json.automatic = true`). Staff-typed, campaign and staff-alert sends MUST pass `manual: true`. Phone threads for non-clients are only opened for `+1555` numbers under the notification sandbox.

### Affiliate card prompts

- Signup: `sendAffiliateWelcome` adds a separate card email + text using the onboarding link (never a billing card link, which treats the person as approved). Approval: `sendAffiliateCardPrompt(id, "approved")` at every approval path. Daily `runAffiliateCardReminders` in the billing cron: up to 3 reminders (3 days after approval, then 4 and 7 days apart), batch of 25, stops once a membership runs; `affiliates.card_reminder_count`. Texts honor `sms_opt_outs`. Tests pass a fixture email prefix.

### City Partners (invite-only portal `/city`, actor `city`)

- Tables `city_partners` (+ `_otp_codes`, `_sessions`, `_cities`), `city_partner_agreement_templates` (v1 = Peter's agreement, approved as is; placeholders `{{partner_legal_name}}`, `{{fee_per_sqft}}`. v2 = "Groundwork City Access": adds `{{effective_date}}` (signing day, Pacific), `{{opened_cities_clause}}` (their opened / pending cities), `{{contractor_address}}` (typed on the signing screen, `needs_address`); a version with any unfilled `{{…}}` can't be shown or signed (`errors.agreementNotReady`). Partners on v2+ keep paid fees when a project is cancelled; only v1 fees become `refund_due`. The latest approved version is the one partners sign; drafts have `approved_at` NULL), `city_partner_agreements` (frozen text + SHA-256 + rate; Groundwork countersigns), `city_partner_w9s` (reuses `buildW9Pdf`; full TIN only in the private PDF), `city_contacts`, `city_activities`, `city_partner_fees`; pipeline + city sheet columns on `service_cities`; `projects.funds_received_on`.
- Void & re-issue (super admin, `POST /api/admin/city-partners/:id/agreements/:aid/void`): reason + typed LLC name + new rate; keeps the voided copy (`void_reason`, `voided_by_admin_id`), voids unpaid fees, unlocks the terms, emails `tplCityPartnerNewAgreement` so the partner signs again at the new rate (own signed record). Refused once a fee was paid. Every agreement query MUST filter `voided_at IS NULL`.
- Rate (`fee_cents_per_sqft`, integer cents 0-10000, default 200 = $2.00 per LLC) and LLC name are editable only until the partner signs (`cpHasAgreement`; then 409 locked). Signing must send `text_sha256` of the exact text shown (`errors.agreementChanged` if staff edited meanwhile). Fees always use the rate frozen in the countersigned agreement. Every staff change is logged in `city_partner_changes`.
- City requests: partners ask (`city_partner_city_requests`, one pending per name); staff approve (`approvals`: picked city → pipeline Target + assigned + `cpLog`) or decline with a reason; partner emailed either way (`tplCityPartnerRequestDecided`). City meetings: partners book on an assigned city (`POST /api/city/meetings`) through `createAppointment` (kind `city_meeting`, source `city_partner`, `appointments.city_id` / `city_partner_id`): first picked staff member owns it (their Outlook calendar), picked staff + partner get invites, staff get a bell, a `meeting` activity is logged. Every City Partner staff alert uses event `city_partner`, area `city_partners` (Team notifications → Who gets what).
- View as partner (super_admin): `POST /api/admin/city-partners/:id/view-as` opens a 30-minute `city_partner_sessions` row with `viewer_admin_id`; `requirePortal` blocks every non-GET (`errors.viewOnly`), `/auth/me` returns `view_as_admin`, `ViewAsBanner` shows it, and each view is logged (`viewed_as`).
- Only staff create partners (no signup); the LLC legal name is required (it is the Contractor in the agreement). Countersign: super_admin only. Finance (`finance.read`) can open the partner pages and the "Fees to handle" list; pays with `finance.write`. Agreement PDFs are built on demand from the frozen text (watermarked until countersigned). Partners get email on countersign and on each paid fee; staff get an alert on agreement sign and W-9. Partners edit only name, phone, language (`/city/profile`). MCP (read-only): `get_city_pipeline`, `get_city`, `list_city_partners`.
- Only staff create partners (no signup). Partners see only their assigned cities, the city sheet only once staff verify it, and homeowners in their Opened Cities as first name + last initial + street name (`streetOnly`). They can't mark a city pre-approved.
- Opened City fee: `syncCityPartnerFees(projectId)` on funds received / milestone or sq ft change: one fee per active, countersigned partner of the city, at the agreement's frozen rate, due funds + 5 days; cancelled or un-funded voids unpaid fees, paid ones become `refund_due`. Staff move every fee (`finance.write`).
- Portal UI is built from the partner portal kit (`client/components/partnerKit/PartnerKit.tsx`); future partner roles reuse it. Feed: `/api/city/feed` (activities, `city_stage_changes`, Opened City moments, homeowner milestones as first name + last initial, fees, agreement); overview adds 12-month `earnings` and `next_due_on`.
- City intelligence uses Groundwork's own rules, never an outside AI: `cityIntelScore`, `cityNextStep`, `cityFollowUp`, duplicate / stale contact checks, printable intel sheet / leave-behind / 2-part agenda (`CityPrint`).
- Tests: partner emails and city names `gw<suite>-<ts>-…`; set `GW_CP_TEST_PREFIX` and insert your own approved agreement version (notes start with the prefix): `cpTemplateScopeSql` hides real versions from tests and test versions from partners.

### Cities
- Partner emails use `tplPartnerEmail` (`tplCityPartnerInvite` / `Countersigned` / `FeePaid`); the invite preview routes (`POST /api/admin/city-partners/invite-preview`, `GET …/:id/invite-preview`) render the same template and never send.
- Cities are only ever picked (search picker), never typed. Record forms use `CityField` (`city_id` + the old text column, which mirrors the name). Server: `resolveCity(city_id, text)` / `applyCityPatch` (picked id wins and fills the text; a typed city alone is tagged only on an exact name match; bad id → 400) on clients, projects, contacts, events, affiliate clients and enroll (`createClientWithProject`); other writes call `tagCityFromText`. `marketing_events.city_id`: RSVP leads without a city inherit it. Fuzzy guesses still go to staff in Settings → Cities. Pickers for admins offer "Add as a new city" (`CityCreateModal`, near-duplicate check via `/api/admin/cities/similar`) and a "Manage cities" link to Settings (`#cities`). Settings → Cities is a server-side grid: rename, show or hide, archive (`archived_at`: hidden everywhere, history kept), merge (moves every record, then deletes), delete only when unused (`cityUsage`). Every risky action goes through `DangerConfirmModal`. City Partners are hard-deleted only by a super admin who types the LLC name (agreement, W-9 file and fees go too); deactivate keeps records.

- `service_cities` (Settings) feeds public pickers (`CityPickerField`, body `city_ids`, saved by `saveSignupCities`) and the admin `city_id` filters. `affiliate_cities` / `contractor_cities`: `assigned = 0` asked for at sign-up, `1` staff assigned. Records: `leads|clients|projects.city_id`, inherited through `CITY_CLIENT_SQL` / `CITY_PROJECT_SQL`. Visibility only: never use it for commissions or lead credit without a product decision. Older records are fixed only by staff confirming `suggestCity` guesses. Tests: city names `gw<suite>-<ts>-…`.

### Remote MCP (super_admin)

- Streamable HTTP at `/api/mcp` + OAuth under `/api/mcp/oauth/*` (tables `mcp_oauth_*` → `admins.id`).
- Always on (no kill switch). Logic stays **inline** in `api/index.ts`. Writes need dry-run then `confirm=true` + `confirm_phrase=CONFIRM`.
- Includes `list_inbox` / `get_thread` / `reply_to_thread` (any thread, unknown numbers too; never texts STOP), `get_call_insights` by `conversation_id`, mail folder and rule tools, `get_city_report`, `list_qr_codes`, and Conversations/Contacts tools (`search_contacts`, `send_sms` / `send_contact_sms`, `list_sms`, `get_call_insights` with Twilio transcripts, `list_brand_phone_numbers`, etc.). WhatsApp tools stubbed until a WA channel ships.
- Mail tools (`list_mailboxes`, `search_email`, `get_email_thread`, `send_email`, `sync_mailbox`, `find_free_time`) work on Microsoft 365 mailboxes connected under Mail.

### Automations (reminder flows)

- Tables `reminder_flows` / `_steps` / `_edges` / `_runs` / `_events` / `_links`, `sms_opt_outs`. Engine inline in `api/index.ts` (`startFlows`, `processFlowRun`, `runReminderFlows`); cron `/api/cron/reminder-flows` hourly (exits after one tiny query when no automation is on). Edit: super_admin + admin (`flows.write`).
- Event host affiliate (`marketing_events.host_affiliate_id`, active affiliates only): an RSVP without another affiliate's link is credited to the host (`eventRsvpCreditAffiliate`: link wins, then host), the host gets `tplAffiliateEventRsvp` per credited RSVP and sees only their own RSVPs (with contact) at `GET /api/affiliate/events` (`/affiliate/events`).
- Event RSVPs never use `startFlows("event_rsvp")`: each event picks one automation (`marketing_events.rsvp_flow_id`, trigger `event_rsvp`, NULL = nothing sent) and `startEventRsvpFlow` enrolls only while it is on. There is no built-in A/B/C welcome; the seeded `event_rsvp_welcome` (off) holds it. Flow texts to a lead call `markLeadRolePrompt` so A / B / C replies are recognized.
- Fire triggers with `startFlows(trigger, kind, id)` (never throws). New triggers go in `FLOW_TRIGGERS`, goals in `FLOW_GOALS`, condition checks in `FLOW_CHECKS`, plus `flows.trigger_*` / `goal_*` / `check_*` in both locales.
- Texts only with consent (`sms_marketing_consent`), never to `sms_opt_outs` (STOP / ALTO), only in the flow's quiet hours (Pacific). Any inbound text / CRM email calls `onFlowPersonReplied` (stop on reply or wake wait-for-reply).
- Daniel's three sequences are seeded inactive (`system_key`); staff turn them on. Exception: `activateAffiliateOnboardingOnce` (first hourly cron after its deploy, guarded by `system_settings.affiliate_onboarding_v2_at`, never under Vitest) refreshes the affiliate sequence (agreement, W-9, card; alerts staff, never closes), switches it on and enrolls pending affiliates. Old CPQ draft reminders skip contractors that have a flow run.
- Tests: name test flows `gw<suite>-<ts>-…`. Production never runs those; Vitest only runs those (`flowScopeSql`).

### ADU construction agreement

- Tables `construction_agreement_templates` (versioned; `approved_at` NULL = draft), `construction_agreements` (one live per project; `fields_json`, frozen `body_rendered` + `body_sha256` when sent), `construction_agreement_signers` (client / contractor by hashed link token, Groundwork countersigns in the admin). Logic inline in `api/index.ts` (`CA_FIELDS`, `caPrefill`, `renderConstructionAgreement`, `finalizeConstructionAgreement`).
- Never send an agreement on a draft template: only a super admin marks a version attorney-approved (typed APPROVED) and approved versions are locked. Drafts always print with a DRAFT watermark.
- New merge fields: add to `CA_FIELDS` + `agreement.field_*` in both locales; prefill in `caPrefill` when the CRM knows it.
- Tests: create your own template version with notes starting `gw<suite>-<ts>-` and pass `template_version`; never approve a real version in tests (test versions are never the default).

### Legal pages (Terms, Privacy, Refunds)

- Tables `legal_documents` (slug terms | privacy | refunds, versioned: draft → published → archived) and `legal_acceptances` (who accepted which version, IP, browser). Public `/terms`, `/privacy`, `/refund-policy`; edited in Settings → Legal pages; only a super admin publishes. Prices / free days are live fields from Settings, never typed into the text. A version is live from its effective date (California time); future dates are scheduled. "Notify members" emails active/pending affiliates and contractors once per version from the weekly `/api/cron/legal-notices` (`legal_notices`).
- Signups (`/api/public/affiliate/signup`, `/api/public/contractor/signup`, `/api/public/partner-referral`) require `accept_terms: true` once Terms are published and record acceptance; members without a current acceptance see `LegalAcceptGate` in their portal.
- Tests: set `process.env.GW_LEGAL_TEST_PREFIX = prefix` and insert your own legal versions with `notes` starting with that prefix. Under Vitest only that suite sees legal versions; the real site never sees test ones.
- Recorded calls must keep the spoken notice (`sayRecordingNotice` inbound, `<Number url=/api/voice/recording-notice>` outbound): California all-party consent. Free-period-ending reminder runs in the daily billing cron (`runTrialEndingReminders`; pass a fixture email prefix in tests).

### Mail + Outlook calendar (Microsoft 365)

- Graph app-only auth in the Encore tenant (`OFFICE365_TENANT_ID` / `CLIENT_ID` / `CLIENT_SECRET`, same app registration as real-state). Only `MAIL_ALLOWED_DOMAINS` mailboxes can be connected; keep the Exchange application access policy limited to Groundwork mailboxes.
- Cron `/api/cron/mail-sync` hourly, plus `/api/admin/mail/sync-visible` when staff open Mail (2-minute throttle) and the Sync button: mail delta (Inbox + Sent) and calendar both ways (`appointment_calendar_links`). CRM appointments go onto Outlook calendars without Outlook attendees (CRM sends the only invite); `source = 'outlook'` appointments never send CRM invites or reminders.
- Staff alert `inbound_email` (bell + SMS, per prefs) fires once per new email from a CRM person (`mail_messages.alerted_at`); Outlook archive moves keep mail as Archived (immutable Graph ids); drafts live in `mail_drafts` (mirrored to Outlook Drafts).
- Folders: `mail_folders` mirrors real Outlook folders (discovered hourly, top level + one down, system folders excluded), each with its own delta in `syncCustomMailFolders`; `mail_messages.folder = 'custom'` + `mail_folder_id`; `mail_threads.filed` keeps filed mail out of Inbox. Only empty folders can be deleted. Rules: Outlook rules live in Graph (need `MailboxSettings.ReadWrite`, app permission + delegated reconnect; read on open, never stored); CRM rules in `mail_rules`, applied to fresh inbox mail by `applyMailRules`.
- Two ways in: admins connect org mailboxes with app access (Exchange access policy group "Groundwork CRM Mailboxes"), or any staff member clicks "Connect with Microsoft" (delegated OAuth via `/common`, any work or personal account, tokens sealed with `MAIL_TOKEN_KEY`; never rotate that key casually).
- Tests never call Microsoft: inject `api/testFakeGraph.ts` via `__testSetGraphApi`. Sending checks `notifySandbox()`. Sign-in tests use `__testSetMailOAuth`.
- See `mcp/admin-ask/README.md` and `.cursor/mcp.json`.


### QR codes and affiliate link names

- Every QR goes through `client/lib/brandQr.ts` (error correction H + centered mark); never call `qrcode` directly in components. The server flyer uses the same ratio.
- Admin → QR codes: table `qr_links`, public `/go/:slug` (slug permanent, `events` perm). Destinations and fallbacks are picked, never typed: `dest_type` page (`QR_PAGES`, labels `qrCodes.page_<key>`) | event | next_event | affiliate | external (`qr_external_links`, https only, `approvals` perm to manage). `qrResolver` resolves them; off, archived or unavailable destinations use the fallback, else home. Real scans write `qr_link_daily` and set the `gw_qr` cookie (30 days); public signups call `creditQrScan` (first code wins, `qr_link_id` on leads, clients, affiliates, contractors), so new public signup routes MUST call it. Changes log to `qr_link_changes`. `?test=1` never counts. Test fixtures: slug and external label `gw<suite>-<ts>-…`.
- Affiliate link names (`affiliates.slug`) are staff-only; `PATCH /api/affiliate/link` always 403s and `/api/affiliate/me` rejects a changed slug.

### Scorecards (affiliates + contractors, `SCORECARD_ENABLED`)

- Fully gated: `scorecardEnabled()` (env `SCORECARD_ENABLED=true`). Off = every `/api/admin/scorecards*` route 404s, `scorecard_enabled` is false on `/api/admin/auth/me`, and the UI hides the nav item, record buttons and project panel. Admins only (`approvals`).
- Logic inline in `api/index.ts`: `SCORECARD_METRICS` (goals + weights, mirrored in `client/components/scorecard/ScorecardRules.tsx`), `computeScorecardWeek`, `ensureScorecards`, `scorecardColor`. Tables `scorecard_weeks` (one row per person, scorecard and Mon-Sun Pacific week; frozen `final = 1` 3 days after the week), `scorecard_actions` (automatic follow-ups keyed by `auto_key`, never twice), `scorecard_activities`, `scorecard_time_off`, `project_plan_deliverables`, `project_city_corrections`, `project_milestone_targets`; `contractors.scorecard_roles`, `leads.assigned_contractor_id` / `contractor_assigned_at`.
- Scoring starts the week it first runs (`system_settings.scorecard_start_week`): nobody is graded for weeks before launch. No cron: open weeks recompute on demand only (page open or the MCP tools, 2-minute throttle), past weeks freeze and escalate the first time they're viewed after the 3-day window; writes call `invalidateScorecard`. MCP: read-only `get_scorecards` / `get_scorecard` (hidden while the flag is off).
- Escalation bells go to active super admins only (`insertAdminInAppNotification`, event `scorecard_alert`, sandbox-safe); never for weeks older than 2 weeks.
- Tests: set `GW_SCORECARD_TEST_PREFIX` to the run prefix; only people whose email starts with it are scored (under Vitest nothing else ever is). Local QA can set the same env on the dev server to avoid scoring real people. Cleanup removes scorecard rows for fixture affiliates / contractors.

