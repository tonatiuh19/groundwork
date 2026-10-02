# Groundwork Capital — Design System

Canonical visual + product design contract. **Update this file whenever UI, branding, email chrome, or public flows change.**

## Brand

- **Name:** Groundwork Capital Group
- **Tagline:** Build more from home
- **Logo:** `/public/logos/groundwork-logo.png` (hex mark + wordmark; gold + outlined charcoal on transparent — no CSS background plate)
- **Favicon:** `/public/favicon.ico` only
- **Email logo:** Hosted HTTPS `https://www.groundworkcapitalgroup.com/logos/groundwork-logo.png` (override with `EMAIL_LOGO_URL`). Prefer **www** — apex redirects with 308 and many clients will not load redirected images. Do not use CID embeds for the header mark.
- **Product mode:** hybrid — financing primary + ADU education secondary (aligned with adu-ez.com)
- **Production domain:** `groundworkcapitalgroup.com` (`PUBLIC_APP_URL`)
- **Support email:** `info@groundworkcapitalgroup.com` (override with `SUPPORT_EMAIL`)
- **Support phone:** `(949) 239-6358`
- **Office:** `1234 Horizon Avenue, San Diego, CA 92121`
- **Social:** Instagram [`@groundworkcapitalgroupllc`](https://www.instagram.com/groundworkcapitalgroupllc) in the footer (Lucide icon). Facebook / TikTok URLs are reserved in `SITE_SOCIAL` but **not shown** until those profiles are public.

## Palette

| Token | Hex | Use |
|-------|-----|-----|
| Ink | `#0e2a4a` | Primary navy / trust |
| Gold | `#d9a441` | CTAs, accents, email bar |
| Clay | `#c1633b` | Sparse emphasis |
| Paper | `#f8f5ef` | Page + email outer/header background |
| Charcoal | `#1f2430` | Body text |
| Black | `#000000` | Favicon plate only |
| Pine | `#1f4a3a` | Why-ADU solutions badge / challenge bullets |

CSS variables live on `.groundwork-page` in `client/global.css`. Tailwind semantic tokens map ink → `primary`, gold → `accent`.

**Page shell:** `.groundwork-page` is a column flex with `min-height: 100dvh` and `> main { flex: 1 }` so the site footer sits at the bottom of short pages (no cream gap below it) and still follows content on long pages. Prefer `overflow-x: hidden` (not `overflow: hidden`) so vertical scroll stays on the document.

## Mobile responsiveness (mandatory)

Every public page, enroll wizard, portal login, and admin/affiliate/contractor/client shell **must** work on phones (~320–430px) and tablets without layout breaks, clipped controls, or **document-level horizontal scrolling**.

| Rule | Practice |
|------|----------|
| No page sideways scroll | `html` / `body` / `#root` / page shells use `overflow-x: hidden` + `max-width: 100%` |
| Fluid grids | Prefer `minmax(0, 1fr)`, collapsing to 1 column under ~760–900px |
| Contained sideways scroll | Kanban (`.pf-board`), milestone trackers (`.pf-tracker`), portal chip nav — local `overflow-x: auto` only |
| Tables | `.pf-table-wrap` scrolls; ≤640px tables stack as labeled cards via `data-label` |
| Toolbars / CTAs | Wrap or stack (`.pf-filters`, `.pf-header .pf-actions`, `.hero-actions`, enroll next/back) |
| Media | `img` / `video` / `svg` → `max-width: 100%` |
| Copy | Long tokens wrap (`overflow-wrap`); avoid fixed widths wider than the viewport |

Breakpoint habits in `client/global.css`: marketing chrome ~760px; portal shell / login / multi-col ~900px; table cardify + OTP densify ~640px; enroll rail ~879px / 640px.

Validate new UI at ~375px before shipping. Intentional horizontal regions must never widen the document. In `client/global.css`, place `@media (max-width: …)` overrides **after** the base rules for those selectors (equal specificity — later wins), or use mobile-first `min-width` queries.

Home **Why build an ADU** (`#why-adu`): ink band, centered opportunity eyebrow + white title, two white comparison cards with overlapping square badges (gold/target challenges, pine/users solutions) and icon bullets.
## Typography

- **UI:** Manrope (geometric sans)
- **Editorial lift:** Instrument Serif italics on hero/section emphasis

## i18n

- EN + ES catalogs under `client/locales/{en,es}/translation.json`
- Detect browser language when possible; **fallback English**
- No hardcoded UI strings in components
- Header **language switcher** (`LanguageSwitcher`): compact EN / ES segmented control — ink thumb slides under the active code, gold hover on inactive; persists via `i18nextLng` localStorage. Used in `SiteHeader` (home, events, get-credit-report, marketing interiors) and 404.
- Home lead submit sends `preferred_language` from current UI locale → DB + confirmation email locale
- GCR form keeps its own `preferred_language` select (contact preference); header switcher does **not** overwrite a manual form choice

## SEO / PageMeta

- Use `client/components/PageMeta.tsx` on every route (never raw `Helmet` for titles/descriptions)
- Covers: title, description, keywords, canonical, robots, Open Graph, Twitter cards, hreflang, theme-color, JSON-LD helpers
- Site URL from **`PUBLIC_APP_URL` only** (Vite `envPrefix` includes `PUBLIC_` so PageMeta reads the same var as the API; fallback `https://groundworkcapitalgroup.com`) — never emit localhost into share tags
- API validation / rate-limit / 500 responses return **i18n keys** (`validation.*`, `errors.*`); UI translates via `translateApiError`
- JSON-LD Organization / FinancialService descriptions follow UI locale (EN/ES)
- Default share image: `/logos/groundwork-logo.png` (378×106 until a dedicated `1200×630` `/og-image.jpg` is added)
- Home: indexable + Organization / FinancialService / WebSite JSON-LD
- `/get-credit-report` and 404: `noIndex`

## Portals (passwordless)

Four independent portals — each with its own login page, left-sidebar shell, OTP table, and HttpOnly session cookie:

| Portal | Login | Shell | Cookie |
|--------|-------|-------|--------|
| Admin | `/admin/login` | `/admin` | `gw_admin_sid` |
| Affiliate | `/affiliate/login` | `/affiliate` | `gw_affiliate_sid` |
| Contractor | `/contractor/login` | `/contractor` | `gw_contractor_sid` |
| Homeowner | `/client/login` | `/client` | `gw_client_sid` |

- **Legacy URLs:** `/portal`, `/portal/login`, `/portal/*` redirect (replace) to the same path under `/client`, keeping query + hash.
- Email OTP only (no SMS in v1). Same email may exist across portals with separate sessions.
- **Account status on login:** unknown / inactive / suspended OTP requests still answer "sent" (no enumeration). **Pending** accounts answer `403 errors.authPending` and **invited** accounts answer `403 errors.authInvited` so the login card can show a gold-border legend instead of advancing to the code step. Verify still answers "invalid code" for anything but a valid code on an active (or client `prospect`) account. If the email provider fails for an active account the code is burned and the UI shows `errors.otpSendFailed` (never a false "sent").
- Admin roles: `super_admin | admin | agent | finance | content`
- Affiliates start `pending` until admin approval; contractors are invite-only.
- **Busy action buttons:** Shared `BusyButton` + `useRowBusy` / `useBusyAction` in `kit.tsx` power portal mutations — gold shimmer + spinner label while in flight, optional pine success flash, then refresh. Used for affiliate approve, contractor/client invites, draw/commission transitions, contract mark sent/signed/void, generate contract, Anchor sync, event archive/delete/CSV export, board confirm move, settings notify-extra remove, contractor submit-draw / invite accept, portal OTP resend, and locked inline status selects during PATCH.
- Login pages: split brand stage + white card (event-card language), gold CTA, language switcher. Brand copy and login card share one vertically centered composition (`align-items: center`, max-width ~1040px) so they read as a pair — not a top-left stack with a floating mid-page card. Affiliate login shows a pending-approval legend under the email hint and links to `/affiliate/signup`. **Existing session:** visiting `/{portal}/login` with a valid cookie calls `/auth/me` and `replace`s into the portal home (no OTP form flash after the check settles).
- OTP step: six discrete digit boxes (`OtpCodeInput`) — paste or autofill of a full 6-digit code auto-submits verify; verifying shows a gold-ring overlay + pulsed boxes (`otp-code--verifying`). Shared across all four portal logins.
- **Admin projects board:** `/admin/projects` defaults to **Board** (List | Board toggle; preference in `localStorage`). Board columns are milestones `lead → financing → contracted → in_build → closed → cancelled` via `GET /api/admin/projects/board` (server filters: `q`, affiliate, contractor, assignee, loan status; per-column load-more). Cards use paper/gold event-card language (`pf-board-*`) on white columns with clearer contrast. Drag moves call existing `PATCH` milestone rules (`MILESTONE_TRANSITIONS`); jumps/back/cancel/restore confirm first; illegal drops (incl. `in_build` without contractor) are blocked in UI and enforced server-side.
- **Portal shell scroll:** Desktop shell is viewport-locked (`100dvh`): left sidebar stays fixed while `.portal-main` scrolls; board columns scroll horizontally and each column body scrolls vertically.
- **Portal boot skeleton:** While `/auth/me` resolves, the shell shows a branded layout skeleton (`PortalShellSkeleton`) — real logo, shimmering nav/user bars on the actor-colored sidebar, and paper/gold shimmer blocks for header + stats in main — instead of a plain “Loading portal…” line.
- Shell: ink/pine/clay sidebars, sticky nav; below 900px the nav becomes a horizontal scroll strip above the content. Admin shell shows the role chip (`portal-role`) and hides nav items the role cannot use. The admin sidebar user block is a clickable profile card (avatar + name + email + role) linking to `/admin/profile`. Signed-in portal shells do **not** show the EN/ES switcher — language for staff is set on `/admin/profile` (preferred language); login pages and marketing still use `LanguageSwitcher`.
- **Admin profile:** `/admin/profile` (self only). Editable name, phone, preferred language; email read-only. Avatar: pick JPEG/PNG/WebP → `react-easy-crop` 1:1 modal → 512px JPEG uploaded to Vercel Blob (`POST /api/admin/me/avatar`); no local `/uploads` fallback — `BLOB_READ_WRITE_TOKEN` required. Profile fields save via `PATCH /api/admin/me`.
- **Admin CRM detail pages:** `/admin/clients/:id`, `/admin/affiliates/:id`, `/admin/contractors/:id` for full edits. Project assignee uses `GET /api/admin/assignees` (`people.read`). People lists and the projects **list** view use shared `ListPager` (`pf-pager`) with server `limit`/`offset` (page size 50). Project list filters match the board. Only **active** affiliates/contractors may be assigned. Draw approve/reject/pay is temporarily open to any `projects.read` staff (not finance-only).
  - Each detail page is `PageHeader` + `BackLink` + `RecordHeadCard` (name, contact, status chip, row action) + a `StatCard` strip + one edit form. Clients edit name/phone/status/address/affiliate/assignee/language/internal notes and can send a portal invite; affiliates edit company/phone/slug/status/notes and show the referral code with a copyable tracking link; contractors edit company/phone/license/status/notes, with status locked (and a Resend invite action) while the invite is outstanding. Email is read-only everywhere — it is the login identity.
  - People list rows are clickable into their detail page; inline status selects, copy buttons and row actions stop propagation so they stay usable. `FilterSelect` renders the "All …" dropdowns above every admin list.
  - **Projects:** List and Board share one filter bar and one filter state (search, milestone in list only, affiliate, contractor, assignee, loan status) so toggling views keeps the same scope.
  - **Leads:** notes are editable from the table through a modal (`pf-note-cell`), and Convert opens a modal with an optional ADU plan picker before creating the client + project.
- **Marketing events (API/email):** the home lead form runs in event mode only while `GET /api/public/events/live` returns an event; otherwise the standard (soft-pull) form shows. Event RSVPs (`mode=event` + `event_id`) never require soft-pull consent; capacity overflow is **waitlisted** (or 409 `errors.eventFull` when the waitlist is off). The RSVP confirmation email states confirmed vs waitlisted, shows event title/location/date (Pacific time), and **always** ends with the gold "Check my free credit report" CTA to `/get-credit-report` (two-step flow). Staff lead alerts add event title + registration status. Admin `events` permission = super_admin | admin | content; agents see RSVPs through leads/attendees.
- **Events — homepage (auto):** `/` fetches `GET /api/public/events/live?lang=` on mount (and on language change). A live event switches the page to event mode: gold ribbon (`ribbon.line` with city + Pacific date), the `event-section` band (title, summary, date/time, location, calendar-mark day-of-month, spots left or "Waitlist open", **Event details** link to `/events/:slug`) and the RSVP form. `?mode=standard` forces the standard credit-report homepage. No live event (or a failed lookup) → standard mode, no flash of event copy. Content is bilingual per field (`*_en` / `*_es`), resolved by the API for the requested `lang`.
- **Events — `/events/:slug` (public, outside the portals):** interior layout — back link, eyebrow, display title, summary, `event-meta` (date/time in Pacific, location + venue, optional Zoom link, availability), hero image (or the `event-card` calendar mark when none) with the paper/gold offset shadow, body copy (blank-line paragraphs), then the same `form-section` RSVP. Registration closed → inline gold-ruled `event-closed` notice while details stay visible; unknown/unpublished slug → empty state with a home CTA (`noindex`).
- **Events — RSVP (`LeadForm`):** one shared form for home + event page. Event RSVPs ask name, phone, email, property address only — **no soft-pull consent** (the credit report is a separate, optional step). Submits `mode=event` + `event_id`. Full + waitlist enabled → paper/gold `event-waitlist-note`, button reads "Join the waitlist". Success shows **confirmed** (green check) or **waitlisted** (gold clock) copy plus a gold CTA to `credit_cta_url` (same-origin → in-app link, else new tab; default `/get-credit-report`). Standard mode is unchanged (soft-pull checkbox, `mode=standard`, no `event_id`).
- **Events — admin (`/admin/events`, `/admin/events/:id`):** sidebar item (CalendarDays) visible to roles with `events` (super_admin | admin | content) **or** `leads` (agents, read-only; `PortalNavItem.perm` accepts an any-of array). List = `PageHeader` + search + status `FilterSelect` + `DataTable` (title + `/events/slug` + star when featured, Pacific date, city, confirmed/capacity + waitlisted, registration open, status badge) + `ListPager`; "Add event" modal (EN/ES title, city, start, optional slug) creates a draft and opens it. Detail = `BackLink`, `RecordHeadCard` (status, view public page, delete or archive), `StatCard`s (confirmed / waitlisted / spots remaining / registration open), a sectioned form (basics + featured, schedule, capacity + waitlist, venue/Zoom/image, English copy, Spanish copy; read-only inputs for roles without `events`), and an attendees `DataTable` with registration-status filter, search, pager and **client-side CSV export** (pages through the API's 100-row cap; spreadsheet formula prefixes neutralised). Datetimes are entered and shown in **Pacific** time and stored as UTC. Only one event can be featured; published events and events with RSVPs are archived, never deleted. Status badges: draft muted, published/confirmed green, waitlisted gold, archived muted.
- **Events — capacity / waitlist:** `capacity` empty = unlimited. At capacity, new RSVPs become `waitlisted` when `waitlist_enabled`, otherwise registration closes (`errors.eventFull`). Leads list gains **Type** (event RSVP / standard) and **Event** columns (title link + registration badge) with mode and event filters.
- **Staff notify:** all active admin roles receive portal/staff events; Settings manages `admin_notify_extra_emails` (add/toggle/remove) below commission rules. Notices also fire on lead convert, client create, milestone change, commission accrue, and contract sent.
- **Finance action notes:** Draw and commission status transitions accept an optional note (`note` / `notes`) from a compact field above the action buttons; commissions list shows a Notes column. Commissions also get an **Edit** modal for amount, expected payout date and notes — hidden once `paid`, which the API locks.

### Feature layer (shared `pf-*` kit)

All portal screens use `client/components/portal/kit.tsx` (`PageHeader`, `HeaderAction`, `StatCard`, `DataTable`, `ListPager`, `Modal`, `StatusBadge`, `MilestoneTracker`, form fields) and the `pf-*` classes in `client/global.css`. Data only flows through Redux slices (`adminPortal`, `affiliatePortal`, `contractorPortal`, `clientPortal`, `onboarding`).

- **Section header:** Every portal page uses shared `PageHeader` — clay “Overview” eyebrow + ink title + slate lead + optional right-side actions (`HeaderAction` for gold primary CTAs). Admin list/detail screens must use this chrome for uniformity (Staff is the reference layout).
- **Tables** stack into labelled rows under 640px (`data-label`). Modals scroll internally and never exceed the viewport.
- **Portal modals:** `Modal` portals to `document.body` (escapes the viewport-locked shell). Solid white panel + gold rule + ink offset shadow; brand tokens (`--ink/--gold/--paper/...`) live on `:root` so portal screens get the same vars as marketing. Backdrop click / Escape / close control dismiss; body scroll locks while open.
- **Status badges** map to 4 tones: good (green), warn (gold), bad (clay), muted. Labels always come from i18n groups (`milestone`, `loan`, `drawStatus`, `commStatus`, `contractStatus`, `accountStatus`, `leadStatus`).
- **Milestone tracker:** `lead → financing → contracted → in_build → closed` (+ `cancelled` badge). Affiliates and homeowners only ever see this pipeline, never loan or money fields.

### Core object: project

`projects` (public id `GW-XXXXXXXX`) link client, optional affiliate, contractor and ADU plan. Staff edit operations; finance fields require `finance.write`.

| Admin role | Can do |
|------------|--------|
| `super_admin` | everything, including staff + settings |
| `admin` | leads, people, approvals, projects, finance, plans (no staff, no settings) |
| `agent` | leads, people, projects (no approvals, no commissions/money fields, no plans). **Temporary:** may also approve/reject/pay draws (`projects.read`) |
| `finance` | read people + projects, finance read/write (commissions, project money), settings; draw review shared with project staff |
| `content` | edit ADU plans only |

The source of truth is `ADMIN_PERMS` (`shared/api.ts`, mirrored inline in `api/index.ts`; a test asserts parity).

### Affiliate signup + referral link

1. `/affiliate/signup` → account is `pending` → admin approves → affiliate signs in with OTP.
2. Each affiliate has a tracking link `/r/CODE` (SPA-owned; Vite/Vercel serve the enrollment wizard, not a marketing dump). The default share URL is the branded enrollment landing (`/r/:code` or slug) with no query string. **Advanced** links on the affiliate Tracking page add `?to=` for legacy deep links (`partners`, `contact`, `get-credit-report`). Clicks are logged via `GET /api/public/affiliates/by-code/:code`; the code is stored 30 days in `localStorage` (`gw_ref`) and sent as `referral_code` on enroll and lead forms. Unknown or inactive codes show a soft “link no longer active” state inside the enroll app shell. The portal builds shareable URLs from the **current browsing origin**. Email CTAs still use `PUBLIC_APP_URL`.
3. Branded `/r/:code` opens the enrollment wizard with affiliate context in the header (“with {name}”) and a step-rail partner card (photo / initials / bio). Affiliates edit card fields at `/affiliate/profile` (avatar crop + bio).
4. Affiliates can register homeowners themselves in the portal; the homeowner-consent checkbox is mandatory on every enroll path.

### Homeowner enroll + client portal invite

- **`/start`** and branded **`/r/:code`** use a dedicated **enrollment app shell** (`EnrollApp`) — compact brand header, left step rail, form stage, slim trust footer. They do **not** use the marketing `SiteHeader` / `SiteFooter` (avoids empty paper bands under short wizards).
- Wizard chrome matches header language switcher: thin ink-tint borders, ~3–4px corners (not pills). Current step = **ink** icon plate + white glyph; gold stays on Continue. Step badge is a bordered uppercase rectangle. Local Vite/dev on localhost also shows a dashed **Fill test data** control (unique `@example.com` email) so manual flow QA is one click.
- Soft credit pull is optional; homeowner consent is required. Success creates client + project and emails a 5-day magic-link portal invite.
- **`/client/invite/:token`** — magic-link accept (AuthStage, pine accent) mirrors contractor invite; accept sets the session cookie and lands in `/client`.
- Returning homeowners use **`/client/login`** (email OTP). First successful OTP also flips `prospect` → `active`.

### Contractor invite

Staff invite by email → contractor opens `/contractor/invite/:token` → accepts → status `active`. Only active contractors can be assigned; `in_build` needs a contractor. Progress photos and admin avatars are uploaded as JPEG/PNG/WebP files (max 4 MB, magic bytes verified) straight to Vercel Blob by the API (`BLOB_READ_WRITE_TOKEN`); there is no local `public/uploads` fallback in any environment. Stored URLs must be https on Vercel Blob or `PHOTO_URL_ALLOWED_HOSTS`. The contractor upload form is a file picker + caption (no URL field). Draws are allowed only in `contracted` / `in_build` and are capped by the contractor cost via an atomic `draw_committed_cents` counter (rejects concurrent over-draws; rejected draws release the reservation).

### Economics + commission rules

- Commission = project override → plan default → `sq_ft × per-sq-ft rate` (default $10, `system_settings`).
- Net profit = sale price − contractor cost − affiliate commission − agent commission; per sq ft = net ÷ sq ft.
- When the loan becomes `finalized` a `pending` commission is created due `commission_payout_days_after_loan_close` (default 5) days later (skipped if amount is $0); leaving `finalized` voids unpaid commissions. After a commission is **paid**, `sq_ft` / plan / override edits are locked and profit uses the paid amount.
- Lender fields are manual (`anchor` / `external`) and Anchor-ready (`anchor_external_id`). When `ANCHOR_API_KEY` + `ANCHOR_API_BASE` are set, admins can **Sync from Anchor** on a project (`POST /api/admin/projects/:id/anchor/sync`) and Vercel Cron can batch-sync via `POST /api/cron/anchor-sync` (Bearer `CRON_SECRET`). Sync updates `loan_status` + `anchor_last_synced_at` and accrues/voids commissions when finalize flips. Contract generation stores a data snapshot; the PDF (Letter, EN/ES via `?lang=`, brand ink + gold rule, signature lines, paginated footer) is rendered on demand from that snapshot and linked with a `PDF` download link in the admin, contractor and homeowner document tables (homeowners never see affiliate terms or draft/void contracts).

### Milestone state machine

Admins can only move a project one step forward (`lead → financing → contracted → in_build → closed`, financing may be skipped for cash buyers), one step back to correct a mistake, or to `cancelled`; `closed` only re-opens to `in_build` and `cancelled` only to `lead`. Anything else is rejected with `errors.invalidTransition`, enforced under a row lock so two admins cannot race each other.

### Tracking-link abuse guard

Affiliate lookup (`GET /api/public/affiliates/by-code/:code`) is rate limited per IP (60 / 15 min). Over-limit responses omit click logging; the SPA still renders enrollment or inactive messaging where possible.

### Notice emails

`tplPortalNotice` (bilingual EN/ES) reuses the email chrome below: paper header, title, short body, single gold button deep-linking to the relevant portal page (`/admin/...`, `/affiliate`, `/contractor/...`, `/client/invite/:token` for homeowners, `/client` after accept). Used for affiliate approval, contractor invite, client portal magic-link invite (5-day TTL), new-project-assigned, draw status updates, commission paid, staff welcome, and staff alerts.

## Composition

Editorial landing (`/`): hero + benefit grid + ADU definition + dark why-ADU comparison cards + process + risks (copy + scaffolding renovation photo) + market numbers + ADU designs gallery (3 exterior viz + specialist CTA) + partner teaser + financing explainer + interactive ADU floor-plan options (tabbed card, event-section language) + event band (when live) + lead form (event mode) + credit-report CTA.

Interior routes share home band language:
- `/about` — interior hero → benefit steps → opportunity who-band → statement mission → financing why-list + CTA
- `/partners` — interior hero → path cards (commission / who) → form-section partner referral
- `/contact` — interior hero with event-meta phone/email/address → form-section (intent + SMS consents)

Header nav: **About**, **Partners**, **Contact**, **Homeowner portal** (`/client/login`). On viewports ≤760px the text nav collapses and the homeowner portal link moves into the header actions next to the language switcher.

Footer: Explore links + **Portals** column (**Admin**, **Affiliate**, **Contractor** login paths). Homeowner portal stays in the header, not the footer portal list.

Anti-references: generic fintech blue, real-estate flyer clutter, stock-photo-heavy layouts, purple gradients, glassmorphism.

## Email chrome

- Paper header (`#f8f5ef`) matching the site header — logo + ink tagline
- Gold rule under header
- White body on paper outer canvas
- Ink footer with gold support link
- Templates in `api/index.ts`: `tplLeadConfirmation`, `tplGetCreditReportWelcome`, `tplStaffLeadAlert`, `tplPortalNotice`
- Live send whenever `RESEND_API_KEY` is set (local + prod); Vitest always dry-runs; `NOTIFY_EMAILS=false` forces dry-run

## Get Credit Report

- Route: `/get-credit-report` (unlisted / noindex) — **Fontana event registration landing** (slug `fontana-oct-6`), same hero/body/RSVP as `/events/fontana-oct-6`.
- Primary CTA: event RSVP (`LeadForm` with `mode=event`). Post-RSVP “free credit report” scrolls to `#free-report` on the same page (not a circular link).
- Optional end section: soft-pull capture (`POST /api/public/get-credit-report-lead`) → MyFreeScoreNow link. Clearly labeled optional — not required to attend.
- Partner URL (same as OFG): MyFreeScoreNow free snapshot; short path `/go/free-score` → 302.
- Soft-pull consent on the optional form only (checked by default). Event RSVP never asks for soft-pull.
- Home marketing CTAs that still say “Check your free credit report” may land here; the page leads with Fontana RSVP first.
- Mobile: fluid event + form sections; no document horizontal scroll.

## Logo sizes

- Header logo ~52px height; footer ~56px
- Transparent PNG as provided — no black rounded plate behind the wordmark

## Remote MCP (super_admin · Claude / Cursor)

- **Endpoint:** `https://www.groundworkcapitalgroup.com/api/mcp` (Streamable HTTP). Issuer forces **www** (apex 308s break OAuth discovery).
- **Who:** `admins.role = super_admin` only. Cookie (`gw_admin_sid`) or Bearer OAuth token.
- **Consent:** `/admin/mcp-consent` — mobile-friendly card outside the admin shell; login via `?return=` then Allow/Deny. No in-app Ask AI panel yet.
- **Connections:** Admin → Profile → **Connected AI apps** (revoke). Scope `groundwork.admin.read`. Access tokens ~1h; refresh tokens expire after **30 days** (rotated on refresh).
- **Writes:** tools dry-run first; execute only with **both** `confirm=true` **and** `confirm_phrase=CONFIRM` (phrase alone never writes). `create_staff` cannot mint `super_admin` (use Admin → Staff).
- **Docs:** `mcp/admin-ask/README.md`. Cursor prod URL in `.cursor/mcp.json` (local override in user config — do not commit localhost).

