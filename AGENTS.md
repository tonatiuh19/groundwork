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
- **Tests & local QA: never send real notifications.** `VITEST=true` must never send live Resend email, Twilio SMS, Ably publishes, or in-app `admin_notifications` to real staff — staff fan-out in tests is limited to `@example.com` / `@example.test` fixtures. Integration tests that write to TiDB must clean fixtures in `afterAll` using `api/testDbCleanup.ts` (only `@example.com` / `@example.test`). Tag every fixture with a run prefix `gw<suite>-${Date.now()}-` (emails, slugs, titles, labels) and clean with `cleanupPortalFixturesByPrefix(prefix)` — it also removes SET NULL children (templates, test lines, events, contact threads) and FK-less logs (`people_dedupe_log`, bell rows). `api/testGlobalSetup.ts` sweeps interrupted runs (>2h) before each run and fails the run if this run's fixtures survive; when a suite creates a new kind of row, extend `cleanupPortalFixturesByPrefix` + `api/testDbCleanup.integration.test.ts`. Enforced in code by `notifySandbox()` in `api/index.ts` (on for every Vitest run): email / SMS / Ably are dry-run and staff fan-out skips non-test admins. Manual QA on the dev server delivers for real unless you set `NOTIFY_SANDBOX=true` in `.env` — always do that before QA, and only use `@example.com` fixtures. New outbound channels MUST check `notifySandbox()`.
- **Always review the chat history before making changes to understand what has already been fixed or implemented, and avoid reintroducing previously resolved issues**
- **All required API logic should remain inline within api/index.ts, as the application is deployed on Vercel using a serverless architecture**
- **NO EXCEPTIONS to these rules**

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

Preflight: api inline check → typecheck → vitest → `vercel --prod` → stamp `system_settings.app_version`.

### Staff notify

Active `admins` with any role (`super_admin` | `admin` | `agent` | `finance` | `content`) receive staff notify events via Resend (honoring `notification_prefs_json`), plus any `admin_notify_extra_emails` rows. Settings → Team notifications manages staff Email/In-app/SMS prefs and extras.

### Remote MCP (super_admin)

- Streamable HTTP at `/api/mcp` + OAuth under `/api/mcp/oauth/*` (tables `mcp_oauth_*` → `admins.id`).
- Always on (no kill switch). Logic stays **inline** in `api/index.ts`. Writes need dry-run then `confirm=true` + `confirm_phrase=CONFIRM`.
- Includes Conversations/Contacts tools (`search_contacts`, `send_sms` / `send_contact_sms`, `list_sms`, `get_call_insights` with Twilio transcripts, `list_brand_phone_numbers`, etc.). WhatsApp tools stubbed until a WA channel ships.
- See `mcp/admin-ask/README.md` and `.cursor/mcp.json`.

