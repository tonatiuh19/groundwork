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
- **Mobile (mandatory, no exceptions):** every public page, portal shell, form, table, modal, and wizard MUST work on phones (~320–430px) and tablets without layout breaks, clipped controls, or **document-level horizontal scrolling**. Prefer fluid widths (`minmax(0, …)`, `%`, `clamp`), collapsing grids, and wrapping toolbars. If a region must scroll sideways (e.g. kanban board, milestone tracker), contain it with `overflow-x: auto` on an inner wrapper — never let the page itself scroll horizontally. Validate new UI at a narrow viewport before finishing.
- **if there is an opportunity to add reusable components or utilities, do it immediately to avoid technical debt**
- **Avoid any breaking changes**
- **i18n: When making any UI change that introduces new user-visible strings, ALWAYS add the corresponding key to BOTH `client/locales/en/translation.json` AND `client/locales/es/translation.json`, and use `t('key')` via `useTranslation()` — NEVER hardcode user-facing strings in components. Browser language is detected when possible; fallback is English.**
- **Tests: `VITEST=true` must never send live Resend email. Integration tests that write to TiDB must clean fixtures in `afterAll` using `api/testDbCleanup.ts` (only `@example.com` / `@example.test`).**
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

Active `admins` with any role (`super_admin` | `admin` | `agent` | `finance` | `content`) receive staff notify events via Resend, plus any `admin_notify_extra_emails` rows.
