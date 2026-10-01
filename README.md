# Groundwork Capital

Vite SPA + Express API (`api/index.ts`) on Vercel. TiDB Cloud + Resend.

## Setup

```bash
npm install
cp .env.example .env   # if needed — DB + Resend already configured in this workspace
npm run db:migrate
npm run dev            # https://localhost:8080
```

## Scripts

| Script | Purpose |
|--------|---------|
| `npm run dev` | Vite + Express (proxy `/api` and `/go`) |
| `npm test` | Vitest (unit + integration) |
| `npm run typecheck` | `tsc` |
| `npm run db:migrate` | Apply `database/migrations/*.sql` |
| `npm run deploy:prod` | Inline gate + tests + `vercel --prod` |

## Lead form

`POST /api/public/leads` stores the lead, emails the applicant a branded confirmation, and notifies all active `super_admin` / `admin` / `agent` staff (seeded: Daniel Carrillo, Cesar Gomez).
