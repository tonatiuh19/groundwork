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
- **Support phone:** `+1 562 573 5110` (`SITE_PHONE_*` in `client/lib/site.ts`; `system_settings.support_phone`; brand Twilio line). Shown in header (full label desktop; icon tap-to-call on ≤760px), footer, and Contact page.
- **Office:** `2717 W Coast Hwy Ste C, Newport Beach, CA 92663`
- **Social:** Instagram [`@groundworkcapitalgroupllc`](https://www.instagram.com/groundworkcapitalgroupllc) in the footer (Lucide icon). Facebook / TikTok URLs are reserved in `SITE_SOCIAL` but **not shown** until those profiles are public.

## Palette

| Token    | Hex       | Use                                         |
| -------- | --------- | ------------------------------------------- |
| Ink      | `#0e2a4a` | Primary navy / trust                        |
| Gold     | `#d9a441` | CTAs, accents, email bar                    |
| Clay     | `#c1633b` | Sparse emphasis                             |
| Paper    | `#f8f5ef` | Page + email outer/header background        |
| Charcoal | `#1f2430` | Body text                                   |
| Black    | `#000000` | Favicon plate only                          |
| Pine     | `#1f4a3a` | Why-ADU solutions badge / challenge bullets |

CSS variables live on `.groundwork-page` in `client/global.css`. Tailwind semantic tokens map ink → `primary`, gold → `accent`.

**Page shell:** `.groundwork-page` is a column flex with `min-height: 100dvh` and `> main { flex: 1 }` so the site footer sits at the bottom of short pages (no cream gap below it) and still follows content on long pages. Prefer `overflow-x: hidden` (not `overflow: hidden`) so vertical scroll stays on the document.

## Mobile responsiveness (mandatory)

Every public page, enroll wizard, portal login, and admin/affiliate/contractor/client shell **must** work on phones (~320–430px) and tablets without layout breaks, clipped controls, or **document-level horizontal scrolling** (page scrolls vertically only). Agent standard: `.cursor/rules/mobile-responsive.mdc`.

| Rule                       | Practice                                                                                                                  |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| No page sideways scroll    | `html` / `body` / `#root` / page shells use `overflow-x: hidden` + `max-width: 100%`; still **fix** overflowing children |
| Fluid grids                | Prefer `minmax(0, 1fr)`, collapsing to 1 column under ~760–900px; flex/grid kids use `min-width: 0`                        |
| Contained sideways scroll  | Kanban (`.pf-board`), trackers (`.pf-tracker`), chip nav, campaign audience table — local `overflow-x: auto` only          |
| Tables                     | `.pf-table-wrap` scrolls; ≤640px tables stack as labeled cards via `data-label`                                           |
| Toolbars / CTAs            | Wrap or stack (`.pf-filters`, `.pf-header .pf-actions`, `.hero-actions`, enroll next/back); filters stack ≤640px           |
| Portal / admin under 900px | **Off-canvas drawer** (hamburger + dark overlay + slide-in sidebar) — not chip nav; sticky mobile top bar with brand + bell + Menu/X; Conversations list/thread swap; shell stays `100dvh` with `min-width: 0`; boards use `min(280px, calc(100vw - 2.5rem))` columns inside local scroll |
| Media                      | `img` / `video` / `svg` → `max-width: 100%`                                                                                |
| Copy                       | Long tokens wrap (`overflow-wrap`); avoid fixed widths wider than the viewport                                            |

Breakpoint habits in `client/global.css`: marketing chrome ~760px; portal shell / login / multi-col ~900px; table cardify + filters/pager stack + OTP densify ~640px; enroll rail ~879px / 640px; ultra-narrow padding ~360px.

Validate new UI at **~320px and ~375px** before shipping (`scrollWidth <= clientWidth`). Intentional horizontal regions must never widen the document. In `client/global.css`, place `@media (max-width: …)` overrides **after** the base rules for those selectors (equal specificity — later wins), or use mobile-first `min-width` queries.

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

| Portal     | Login               | Shell         | Cookie              |
| ---------- | ------------------- | ------------- | ------------------- |
| Admin      | `/admin/login`      | `/admin`      | `gw_admin_sid`      |
| Affiliate  | `/affiliate/login`  | `/affiliate`  | `gw_affiliate_sid`  |
| Contractor | `/contractor/login` | `/contractor` | `gw_contractor_sid` |
| Homeowner  | `/client/login`     | `/client`     | `gw_client_sid`     |

- **Legacy URLs:** `/portal`, `/portal/login`, `/portal/*` redirect (replace) to the same path under `/client`, keeping query + hash.
- Email OTP only (no SMS in v1). Same email may exist across portals with separate sessions.
- **Account status on login:** unknown / inactive / suspended OTP requests still answer "sent" (no enumeration). **Pending** accounts answer `403 errors.authPending` and **invited** accounts answer `403 errors.authInvited` so the login card can show a gold-border legend instead of advancing to the code step. Verify still answers "invalid code" for anything but a valid code on an active (or client `prospect`) account. If the email provider fails for an active account the code is burned and the UI shows `errors.otpSendFailed` (never a false "sent").
- **OTP copy (anti-enumeration UX):** login never claims a code was definitely emailed. Email step + code step use conditional wording (“If an account exists…”) plus a spam/no-account hint. Affiliate code step adds a gold legend with **Become an affiliate** when no mail arrives.
- Admin roles: `super_admin | admin | agent | finance | content`
- Affiliates start `pending` until admin approval; contractors are invite-only.
- **Busy action buttons:** Shared `BusyButton` + `useRowBusy` / `useBusyAction` in `kit.tsx` power portal mutations — gold shimmer + spinner label while in flight, optional pine success flash, then refresh. Used for affiliate approve, contractor/client invites, draw/commission transitions, contract mark sent/signed/void, generate contract, Anchor sync, event archive/delete/CSV export, board confirm move, settings notify-extra remove, contractor submit-draw / invite accept, portal OTP resend, and locked inline status selects during PATCH.
- Login pages: split brand stage + white card (event-card language), gold CTA, language switcher. Brand copy and login card share one vertically centered composition (`align-items: center`, max-width ~1040px) so they read as a pair — not a top-left stack with a floating mid-page card. Affiliate, homeowner, and contractor logins show a pending-approval legend under the email hint and link to their self-signup pages (`/affiliate/signup`, `/client/signup`, `/contractor/signup`). **Existing session:** visiting `/{portal}/login` with a valid cookie calls `/auth/me` and `replace`s into the portal home (no OTP form flash after the check settles).
- OTP step: six discrete digit boxes (`OtpCodeInput`) — paste or autofill of a full 6-digit code auto-submits verify; verifying shows a gold-ring overlay + pulsed boxes (`otp-code--verifying`). Shared across all four portal logins. Code-step hints stay conditional (no false “Sent to…”) and affiliate / client / contractor logins surface signup when a code never arrives.
- **Admin projects board:** `/admin/projects` defaults to **Board** (List | Board toggle; preference in `localStorage`). Board columns are milestones `lead → financing → contracted → in_build → closed → cancelled` via `GET /api/admin/projects/board` (server filters: `q`, affiliate, contractor, assignee, loan status; per-column load-more). Cards use paper/gold event-card language (`pf-board-*`) on white columns with clearer contrast. Drag moves call existing `PATCH` milestone rules (`MILESTONE_TRANSITIONS`); jumps/back/cancel/restore confirm first; illegal drops (incl. `in_build` without contractor) are blocked in UI and enforced server-side.
- **Portal shell scroll:** Desktop shell is viewport-locked (`100dvh`): left sidebar stays fixed while `.portal-main` scrolls; board columns scroll horizontally and each column body scrolls vertically.
- **Portal boot skeleton:** While `/auth/me` resolves, the shell shows a branded layout skeleton (`PortalShellSkeleton`) — real logo, shimmering nav/user bars on the actor-colored sidebar, and paper/gold shimmer blocks for header + stats in main — instead of a plain “Loading portal…” line.
- Shell: ink/pine/clay sidebars, sticky nav. Below 900px (admin / affiliate / contractor / client): **mobile top bar** + **off-canvas drawer** (Optimum-style) — Menu/X toggles a fixed sidebar over a dimmed overlay; Escape / overlay / nav click / route change close it; body scroll locks while open. Desktop keeps the permanent left rail. Admin shell hides nav items the role cannot use. Footer **account strip** merges profile (avatar + name + truncated email + muted role → `/admin/profile`) with embedded notification bell; inbox panel is portaled/fixed into the main column. Signed-in portal shells do **not** show the EN/ES switcher — language for staff is set on `/admin/profile` (preferred language); login pages and marketing still use `LanguageSwitcher`.
- **Admin profile:** `/admin/profile` (self only). Editable name, phone, preferred language; email read-only. Avatar: pick JPEG/PNG/WebP → `react-easy-crop` 1:1 modal → 512px JPEG uploaded to Vercel Blob (`POST /api/admin/me/avatar`); no local `/uploads` fallback — `BLOB_READ_WRITE_TOKEN` required. Profile fields save via `PATCH /api/admin/me`.
- **Admin CRM detail pages:** `/admin/clients/:id`, `/admin/affiliates/:id`, `/admin/contractors/:id` for full edits. Project assignee uses `GET /api/admin/assignees` (`people.read`). People lists and the projects **list** view use shared `ListPager` (`pf-pager`) with server `limit`/`offset` (page size 50). Project list filters match the board. Only **active** affiliates/contractors may be assigned. Draw approve/reject/pay is temporarily open to any `projects.read` staff (not finance-only).
  - Each detail page is `PageHeader` + `BackLink` + `RecordHeadCard` (name, contact, status chip, row action) + a `StatCard` strip + one edit form. Clients edit name/**email**/phone/status/address/affiliate/assignee/language/internal notes and can send a portal invite (invite requires an email); affiliates edit company/phone/**vanity slug**/status/notes (slug defaults from name on create; stats show `/r/{slug}` tracking path + copyable full URL — **referral codes are not shown in admin/affiliate UI**); contractors edit company/phone/license/status/notes, with status locked (and a Resend invite action) while the invite is outstanding. Affiliate/contractor/admin emails stay read-only (login identity); **client email is editable** (nullable unique; used for portal OTP/invite when set).
  - **Admin Affiliates list:** Tracking link column uses `TrackingLinkChip` — gold-rail chip with `/r/` + vanity slug (truncatedates long names), click-to-copy full URL, pine flash when copied. No referral-code line. Actions column: Message / Call (phone deep-link into Conversations compose/dial) + Approve when pending.
  - **People grid actions parity:** Affiliates + Contractors share Message / Call / Approve (and contractor Resend invite). Clients keep Message / Call / portal invite (+ Approve when pending). Contacts keep Message / Call / Edit / Convert / Delete. Compact `pf-btn--sm` + `gw-people-actions` wrapping; under ~375px actions stack full-width.
  - **Demote confirm:** Changing status from `active` → `inactive` or `suspended` opens shared `ConfirmStatusChangeModal` on Affiliates, Contractors, Clients, and Staff lists **and** Affiliate/Contractor/Client detail Save when the status field demotes (promote / pending→active still applies immediately). Modal stays open with busy state until the PATCH finishes.
  - **Conversations phone deep-links:** Affiliates/Contractors without a hub thread use `?compose=1&phone=&name=` / `?dial=1&phone=` (`conversationDeepLink.ts`). Clients/Contacts still deep-link by `?client=` / `?contact=` (+ optional `&dial=1`).
  - People list rows are clickable into their detail page; inline status selects, copy buttons and row actions stop propagation so they stay usable. `FilterSelect` renders the "All …" dropdowns above every admin list.
  - **Projects:** List and Board share one filter bar and one filter state (search, milestone in list only, affiliate, contractor, assignee, loan status) so toggling views keeps the same scope.
  - **Leads:** notes are editable from the table through a modal (`pf-note-cell`), and Convert opens a modal with an optional ADU plan picker before creating the client + project.
- **Marketing events (API/email):** the home lead form runs in event mode only while `GET /api/public/events/live` returns an event; otherwise the standard (soft-pull) form shows. Event RSVPs (`mode=event` + `event_id`) never require soft-pull consent; capacity overflow is **waitlisted** (or 409 `errors.eventFull` when the waitlist is off). The RSVP confirmation email states confirmed vs waitlisted, shows event title/location/date (Pacific time), and **always** ends with the gold "Check my free credit report" CTA to `/get-credit-report` (two-step flow). Staff lead alerts add event title + registration status. Admin `events` permission = super_admin | admin | content; agents see RSVPs through leads/attendees.
- **Fontana Oct 6 (`fontana-oct-6`):** starts **7:00 PM PDT** (`starts_at` UTC `2026-10-07 02:00:00`); `ends_at` is null (no public end time). Schedule-correction broadcast for prior 11:00 AM confirmations uses one-shot `scripts/fontana-schedule-update-broadcast.ts` (Resend; `--to=` sample, `--all --confirm --send` for full audience of `mode=event` leads, deduped by email).
- **Events — homepage (auto):** `/` fetches `GET /api/public/events/live?lang=` on mount (and on language change). A live event switches the page to event mode: gold ribbon (`ribbon.line` with city + Pacific date), the `event-section` band (title, summary, date/time, location, calendar-mark day-of-month, spots left or "Waitlist open", **Event details** link to `/events/:slug`) and the RSVP form. `?mode=standard` forces the standard credit-report homepage. No live event (or a failed lookup) → standard mode, no flash of event copy. Content is bilingual per field (`*_en` / `*_es`), resolved by the API for the requested `lang`.
- **Events — `/events/:slug` (public, outside the portals):** interior layout — back link, eyebrow, display title, summary, `event-meta` (date/time in Pacific, location + venue, optional Zoom link, availability), hero image (or the `event-card` calendar mark when none) with the paper/gold offset shadow, body copy (blank-line paragraphs), then the same `form-section` RSVP. Registration closed → inline gold-ruled `event-closed` notice while details stay visible; unknown/unpublished slug → empty state with a home CTA (`noindex`).
- **Events — RSVP (`LeadForm`):** one shared form for home + event page. Event RSVPs ask name, phone, email, property address only — **no soft-pull consent** (the credit report is a separate, optional step). Submits `mode=event` + `event_id`. Full + waitlist enabled → paper/gold `event-waitlist-note`, button reads "Join the waitlist". Success shows **confirmed** (green check) or **waitlisted** (gold clock) copy plus a gold CTA to `credit_cta_url` (same-origin → in-app link, else new tab; default `/get-credit-report`). Standard mode is unchanged (soft-pull checkbox, `mode=standard`, no `event_id`).
- **Events — admin (`/admin/events`, `/admin/events/:id`):** sidebar item (CalendarDays) visible to roles with `events` (super_admin | admin | content) **or** `leads` (agents, read-only; `PortalNavItem.perm` accepts an any-of array). List = `PageHeader` + search + status `FilterSelect` + `DataTable` (title + `/events/slug` + star when featured, Pacific date, city, confirmed/capacity + waitlisted, registration open, status badge) + `ListPager`; "Add event" modal (EN/ES title, city, start, optional slug) creates a draft and opens it. Detail = `BackLink`, `RecordHeadCard` (status, view public page, delete or archive), `StatCard`s (confirmed / waitlisted / spots remaining / registration open), a sectioned form (basics + featured, schedule, capacity + waitlist, venue/Zoom/image, English copy, Spanish copy; read-only inputs for roles without `events`), and an attendees `DataTable` with registration-status filter, search, pager and **client-side CSV export** (pages through the API's 100-row cap; spreadsheet formula prefixes neutralised). Datetimes are entered and shown in **Pacific** time and stored as UTC. Only one event can be featured; published events and events with RSVPs are archived, never deleted. Status badges: draft muted, published/confirmed green, waitlisted gold, archived muted.
- **Events — capacity / waitlist:** `capacity` empty = unlimited. At capacity, new RSVPs become `waitlisted` when `waitlist_enabled`, otherwise registration closes (`errors.eventFull`). Leads list gains **Type** (event RSVP / standard) and **Event** columns (title link + registration badge) with mode and event filters.
- **Campaigns (Admin → Campaigns):** Product for bilingual follow-ups. Audience filters (leads / affiliates / contractors by status + date range + optional event). **Create Fontana** seeds CTA openers (path buttons / SMS short links to credit report, site info, affiliate signup, contractor signup) and resolves audience to marketing event slug `fontana-oct-6` (`event_id`). Default channels: **email on, SMS off** (toggle SMS when consent allows). **Email** via Resend **transactional** sends (personalized per recipient; unsubscribe → `/contact`) so send-only API keys work. **SMS** via Twilio brand line only when `sms_marketing_consent=1` (TCPA). Preview shows counts **plus a scrollable recipient table** (name / email / phone / lang / SMS consent, capped at 1000). Flow: Preview → dry-run → confirm checkbox → Send live. Optional SMS keyword digits `1`–`4` still auto-tag leads and send `reply_*` templates when used. Lead forms collect optional SMS marketing consent. Perm: `campaigns`.
- **Team notifications (Settings + Profile + bell):** `TeamNotificationsPanel` — **Staff team** (Email / In-app / SMS channel masters + expandable **per-channel** alert types → `admins.notification_prefs_json`) and **Extra email recipients** (`admin_notify_extra_emails.events_json`; null = all types; new extras default to all **except** `inbound_sms`). Delivery honors prefs on all three channels for team events (SMS needs personal phone + assigned brand From). In-app rows write to `admin_notifications`; staff read them via sidebar **account strip** (`portal-account-strip`: avatar/name → Profile + embedded `AdminNotificationBell`). Live updates (no interval polling): shell **`AdminRealtimeBridge`** opens one Ably client (`GET /api/admin/me/ably-token`) on `admin:{id}:notifications` + `admin:{id}:conversations` (SMS/call inbox + nav badge). Softphone ringing stays on Twilio Device SDK. Fallback 60s poll only if Ably is unavailable. Profile self-service: `MyNotificationPrefsPanel` → `GET/PUT /api/admin/me/notification-prefs`. Settings: `GET /api/admin/notify-recipients`, `PUT /api/admin/admins/:id/notification-prefs`.
- **Admin sidebar account strip:** One compact foot card merges identity + inbox — profile link (avatar, name, truncated email, muted role) with circular bell + gold unread badge on the right; quiet text logout underneath. Inbox panel is **portaled + fixed** beside the strip (opens into the main column) so sidebar `overflow` cannot clip it.
- **Brand phone numbers (Settings + Staff):** shared `AdminPhoneNumbersPanel` lists `admin_phone_numbers` (E.164, capabilities, assignee). Super admin / admin can assign lines to active `super_admin|admin|agent` staff (unlocks Conversations); super admin can **Sync Twilio**. Same panel on Staff for convenience.
- **Conversations hub (mobile):** Under 900px the drawer top bar is `3.5rem`; `.portal-main:has(.gw-conv-page)` fills the remaining flex height with `overflow: hidden` so list/thread scroll inside (not the document). Header actions stay a compact icon toolbar (labels visually hidden when an icon is present). List↔thread swap uses `is-hidden-mobile` / `is-open-mobile`.
- **Conversations hub (API + UI):** SMS/MMS + voice inbox at `/admin/conversations` (MessagesSquare nav) + CRM address book at `/admin/contacts` (BookUser, `people.read`). Unlocks only when the admin has an assigned brand Twilio line (`admin_phone_numbers` → `conversations_enabled` on `/auth/me`). **Nav lock UX:** without a number, the Conversations row is a disabled `portal-nav-link--locked` (Lock icon + tooltip) and does not navigate; the route shows centered `gw-lock-card`. With access: **full-viewport hub** (`.portal-main:has(.gw-conv-page)` flex column + overflow hidden; `.gw-conv-shell` fills remaining height with `minmax(16rem, 24rem) 1fr` list/thread — no `70vh` cap). Split inbox + thread (`gw-conv-*`) with server-side `q` search, inbox views (`all|mine|unassigned|unread|unknown|open|closed`), **true SQL `LIMIT/OFFSET` pagination** over a `UNION ALL` of client + CRM contact + unknown hub rows (`ORDER BY last_message_at DESC` + separate COUNT), relative list times, onboarding tip (`localStorage`), list/timeline skeletons, **New message Modal** with `ConversationComposeTargetPicker` (clients + CRM contacts + raw phone), also-send extra phones (**partial failure UX**: primary send first; also-send successes/failures reported via `conversations.alsoSendPartial`; modal closes when primary succeeds), from-number picker when multiple lines, collapsible thread composer, static suggested replies, MMS attach (Vercel Blob only → `media_url`), delivery status ticks (`ConversationMessageStatus`), media lightbox, unknown tools (**searchable client picker** via `fetchAdminClients` / create prospect / dismiss), assign-to-me on client threads, templates admin Modal (CRUD), dialpad Modal (Call + Text), and voice settings Modal (softphone availability, call forwarding, voicemail — forwarding Redux lives in `voiceSlice`, also used on `/admin/profile`). Softphone: `GlobalVoiceManager` wraps `PortalShell` so `VoiceDeviceProvider` reaches Conversations dial/Call; **header Active/Inactive toggle** (`.gw-voice-avail` — defaults **Active**; uses `accountStatus.active/inactive` i18n; green pulse when ready); Device `register()` only while Active; unmount does not persist Inactive; Voice settings checkbox + header share `voice.isAvailable`. **Pre-call audio:** Dialpad Modal shows `VoiceAudioDevicePicker` (mic meter + speaker + volume) before Call; thread Call opens dialpad instead of connecting immediately. In-call panel still has expandable pickers. Prefs persist in `localStorage` (`gw.voice.*`) and apply via Twilio `Device.audio` before connect. Prefs persist in `localStorage` (`gw.voice.*`) and apply through Twilio `Device.audio.setInputDevice` / `speakerDevices.set` before connect. Token refresh on `tokenWillExpire`; busy inbound rejected. Device identity `admin_{id}`. APIs `/api/voice/token|twiml|availability|log|recording-status|transcription|dial-status|voicemail-settings`. Inbound voice rings softphone when `voice_available` and/or call-forward phone; unanswered can fall to voicemail. Call rows log to `conversation_messages` (`channel=call`); recording/Twilio media play via cookie proxy `GET /api/conversations/media?url=`. **Call transcripts — Twilio Voice v3 Transcriptions** (same engine as Optimum Credit; not AI summaries): on recording completed (answered calls + voicemail, any length), the recording is submitted to `voice.twilio.com/v3/Transcriptions` using the auto-created `groundwork_call_transcript` configuration (Deepgram nova-3, `language: multi` = English/Spanish auto, channel 1 **Caller** / 2 **Agent**). The callback `/api/voice/call-transcript` re-fetches the job and stores `Caller: … / Agent: …` lines with `transcript_status: ready|failed`. Under each recording the card shows Transcribing… / Transcript failed / Transcription isn't enabled on the Twilio account / No transcript yet, plus a small **Transcribe / Check transcript / Retry transcript** button (`POST /api/admin/conversations/messages/:id/transcribe`, also recovers missed webhooks) — never "pending" forever. Needs only the TWILIO_* creds + the account's AI/ML addendum. MCP `get_call_insights` returns `transcript_full` when ready. Client list/detail + Contacts deep-link Message/Call into the hub. Ably realtime when token available else ~30s poll. WhatsApp / Social DM are intentionally not in this hub. Prod softphone needs TwiML App voice URL → **`https://www.groundworkcapitalgroup.com/api/voice/twiml`** (never apex — 308 breaks Twilio with error 11200), brand numbers → `/api/voice/incoming`, and Recording Transcription callbacks → `/api/voice/transcription`.

- **Contacts (CRM):** `/admin/contacts` — create/edit/soft-delete address-book rows; **Convert to client** posts `/api/admin/contacts/:id/convert` and deep-links to the client detail. Phone **and/or** email required on create and convert (`clients.email` may be null for phone-only prospects; portal invite still needs email later).
- **Finance action notes:** Draw and commission status transitions accept an optional note (`note` / `notes`) from a compact field above the action buttons; commissions list shows a Notes column. Commissions also get an **Edit** modal for amount, expected payout date and notes — hidden once `paid`, which the API locks.

### Feature layer (shared `pf-*` kit)

All portal screens use `client/components/portal/kit.tsx` (`PageHeader`, `HeaderAction`, `StatCard`, `DataTable`, `ListPager`, `Modal`, `StatusBadge`, `MilestoneTracker`, form fields) and the `pf-*` classes in `client/global.css`. Data only flows through Redux slices (`adminPortal`, `affiliatePortal`, `contractorPortal`, `clientPortal`, `onboarding`, `conversations`, `contacts`, `voice`).

- **Section header:** Every portal page uses shared `PageHeader` — clay “Overview” eyebrow + ink title + slate lead + optional right-side actions (`HeaderAction` for gold primary CTAs). Admin list/detail screens must use this chrome for uniformity (Staff is the reference layout).
- **Tables** stack into labelled rows under 640px (`data-label`). Modals scroll internally and never exceed the viewport.
- **Portal modals:** `Modal` portals to `document.body` (escapes the viewport-locked shell). Solid white panel + gold rule + ink offset shadow; brand tokens (`--ink/--gold/--paper/...`) live on `:root` so portal screens get the same vars as marketing. Backdrop click / Escape / close control dismiss; body scroll locks while open. Autofocus runs once when `open` becomes true (close control by default, or `initialFocusRef` — e.g. dialpad number field); parent re-renders / new `onClose` identities must not steal focus mid-typing.
- **Status badges** map to 4 tones: good (green), warn (gold), bad (clay), muted. Labels always come from i18n groups (`milestone`, `loan`, `drawStatus`, `commStatus`, `contractStatus`, `accountStatus`, `leadStatus`).
- **Milestone tracker:** `lead → financing → contracted → in_build → closed` (+ `cancelled` badge). Affiliates and homeowners only ever see this pipeline, never loan or money fields.

### Core object: project

`projects` (public id `GW-XXXXXXXX`) link client, optional affiliate, contractor and ADU plan. Staff edit operations; finance fields require `finance.write`.

| Admin role    | Can do                                                                                                                                            |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `super_admin` | everything, including staff + settings                                                                                                            |
| `admin`       | leads, people, approvals, projects, finance, plans (no staff, no settings)                                                                        |
| `agent`       | leads, people, projects (no approvals, no commissions/money fields, no plans). **Temporary:** may also approve/reject/pay draws (`projects.read`) |
| `finance`     | read people + projects, finance read/write (commissions, project money), settings; draw review shared with project staff                          |
| `content`     | edit ADU plans only                                                                                                                               |

The source of truth is `ADMIN_PERMS` (`shared/api.ts`, mirrored inline in `api/index.ts`; a test asserts parity).

### Affiliate signup + referral link

1. `/affiliate/signup` → account is `pending` → admin approves → affiliate signs in with OTP.
2. Each affiliate has a tracking link `/r/{slug|CODE}` (SPA-owned; Vite/Vercel serve the enrollment wizard, not a marketing dump). On create (signup, Partners, lead→affiliate, sub-invite) the API auto-assigns a vanity **slug** from `firstname-lastname` (accent-stripped, lowercase; collisions get `-2`, `-3`, …; reserved route words blocked — canonical list `shared/affiliateSlugReserved.ts`, inlined in the API monolith; create inserts retry on rare slug/referral unique races). Share URLs prefer slug when set; **`referral_code` stays the stable attribution id** (cookie/`?ref=`). A vanity slug cannot equal any affiliate’s referral code (avoids `/r/:code` ambiguity). Affiliates and admins can customize the slug; changing it makes the old vanity path stop resolving immediately (no alias history) — `/r/{referral_code}` always works. Clear slug → fall back to code. **Advanced** links on the affiliate Tracking page add `?to=` for legacy deep links (`partners`, `contact`, `get-credit-report`). Clicks are logged via `GET /api/public/affiliates/by-code/:code`; the code is stored 30 days in `localStorage` (`gw_ref`) and sent as `referral_code` on enroll and lead forms. Unknown or inactive codes show a soft “link no longer active” state inside the enroll app shell. The portal builds shareable URLs from the **current browsing origin**. Email CTAs still use `PUBLIC_APP_URL`.
3. Branded `/r/:code` opens the enrollment wizard with affiliate context in the header (“with {name}”) and a step-rail partner card (photo / initials / bio). Affiliates edit card fields at `/affiliate/profile` (avatar crop, bio, **custom tracking slug** with live preview; preview code wraps on narrow viewports).
4. Affiliates can register homeowners themselves in the portal; the homeowner-consent checkbox is mandatory on every enroll path.

### Public join chooser (`/join`)

- Shareable marketing entry (`SiteHeader` / `SiteFooter`) — **not** wired into header/footer/home CTAs yet (QR / SMS / WhatsApp).
- Four equal interactive path cards (credit first): Free credit report → `/get-credit-report#free-report` (auto-scrolls to `#free-report` after event content loads), Homeowner → `/client/signup`, Affiliate → `/affiliate/signup`, Contractor → `/contractor/signup`.
- “Already have an account?” links to `/client/login`, `/affiliate/login`, `/contractor/login`.
- 2×2 grid → single column under ~760px; brand-first interior hero; light paper cards for signups, gold accent only on free credit report.
- Global `ScrollToTop` resets window scroll on pathname changes (hash targets skipped so `#free-report` still works).

### Homeowner + contractor self-signup

- **`/client/signup` = the homeowner enrollment wizard** (same `EnrollApp` + `EnrollWizard` as the affiliate link `/r/:code`, also served at `/start`) — the only difference is no affiliate header/rail card. A 30-day referral cookie from an earlier affiliate link still credits that affiliate silently. Creates lead + prospect client + project + 5-day portal invite instantly (no approval). Returning people get a calm done screen instead of an error: `invite_resent` (pending/prospect homeowner → fresh portal link) or `exists` (active homeowner or another role → Sign in CTA; staff get `duplicate_blocked`).
- **`/contractor/signup`** (AuthStage, pine accent): short form, outcome card (created / resent / invite_resent / ready / exists), no enumeration errors for duplicates. (The legacy `POST /api/public/client/signup` API stays for compatibility; no UI uses it.)
- Staff see queue counts on the admin dashboard (`clients_pending`, `contractors_pending`) and gold **Approve** actions on Clients / Contractors lists (and detail pages). Dashboard cards deep-link with `?status=pending` (or `invited` for open contractor invites).
- **Client approve** (`pending` → `prospect`, requires `approvals`) emails a 5-day magic-link portal invite. **Contractor approve** happens by approving the prequalification application (`pending` → `active`, requires `approvals`) and emails a login CTA; they use OTP like other portals. Contractor signup's outcome card now says "Check your email" for the application link. Agents (`people.write`) can edit client records but cannot approve self-signups.
- Pending / invited accounts get `errors.authPending` / `errors.authInvited` on OTP request (login form stays on email step with legend). Existing portal logins remain the only sign-in path after approval.
- Super-admin MCP write tools: `approve_client` (pending → prospect + invite) and `approve_contractor` (pending → active + login email; needs an approved prequalification or an audited `override_reason`), same dry-run → `confirm=true` + `confirm_phrase=CONFIRM` gate as other writes.

### Homeowner enroll + client portal invite

- **`/start`** and branded **`/r/:code`** use a dedicated **enrollment app shell** (`EnrollApp`) — compact brand header, left step rail, form stage, slim trust footer. They do **not** use the marketing `SiteHeader` / `SiteFooter` (avoids empty paper bands under short wizards).
- Wizard chrome matches header language switcher: thin ink-tint borders, ~3–4px corners (not pills). Current step = **ink** icon plate + white glyph; gold stays on Continue. Step badge is a bordered uppercase rectangle. Local Vite/dev on localhost also shows a dashed **Fill test data** control (unique `@example.com` email) so manual flow QA is one click.
- Soft credit pull is optional; homeowner consent is required. Success creates client + project and emails a 5-day magic-link portal invite.
- **`/client/invite/:token`** — magic-link accept (AuthStage, pine accent) mirrors contractor invite; accept sets the session cookie and lands in `/client`.
- Returning homeowners use **`/client/login`** (email OTP). First successful OTP also flips `prospect` → `active`.

### One person, one role (duplicate prevention)

- **Rule:** a person (matched by **email** case-insensitively **or phone** last 10 digits) is exactly one of client / affiliate / contractor. Enforced server-side by `assertPersonAvailable()` on every create path (public signups, enrollment, partner referral, affiliate-registered homeowners, sub-affiliates, admin create / invite, lead convert, CRM contact convert, unknown-caller prospect, MCP invite) and on email/phone edits (only when the value changes).
- **Public forms:** never create a second record and never reveal who matched — homeowner/contractor signup answer outcome `exists` ("We already have you"), other forms `errors.personExistsPublic`; staff get the `duplicate_blocked` alert.
- **Staff forms:** shared `PersonConflictNotice` (clay-rail card) shows the matching record (role chip, name, email/phone, status, Open record). Phone-only matches offer "Different person — continue" with a required reason (household phones) → `shared_phone_reason`, audited in `people_dedupe_log`. Email matches always block.
- **Repeat leads:** standard (non-event) submissions merge into the person's existing lead — count + `last_submitted_at` bump it to the top, the submission is appended to notes. Leads list shows a gold `×N submissions` chip and an "Already client / affiliate / contractor →" link instead of Convert. Event RSVPs stay one row per event.
- **Duplicates subsection (no separate page):** `DuplicatesPanel entity=…` sits under the header of **Leads, Clients, Affiliates and Contractors** and shows only clusters involving that record type — a collapsible clay-rail bar "Possible duplicates (N)" (hidden when N = 0; `people.read` view, `approvals` act). Expanded: kind filter chips (when >1 kind) + cluster cards (gold rail; clay for two roles; pine for lead clusters) listing each record with role chip, status, contact, linked counts. Actions: pick the record to keep → **Merge** (same role only; dry-run preview of what moves, blockers, warnings), **Delete** (refused while projects in progress, commissions, draws, conversations, referred clients or a submitted prequalification hang off it; empty pipeline projects go with a client), **Link lead**, **Not duplicates** (reason; resurfaces if a new match appears). Cards stack under 640px.

### Contractor prequalification application (`/contractor/apply/:token`)

Every new contractor (public signup, staff invite, MCP invite, lead → contractor as pending) is emailed a secure link to the **ADU Contractor Prequalification Application** — the online version of the paper form (11 sections). Activation (`pending → active`) requires an **approved** application; only a `super_admin` can override with a reason (logged on the application's audit trail, also via MCP `approve_contractor.override_reason` and lead convert `status=active`).

- **Shell:** reuses `EnrollApp` (compact brand header + language switcher + slim footer; `productKey="cpq.appTitle"`). Desktop: sticky left step rail (9 data sections → Documents → Review & sign; rail items are buttons, free navigation saves first). Under 880px the rail hides and a 4px gold progress bar + "Step x of 11" pill lead the stage.
- **Fields:** data-driven from `client/lib/contractorApplicationForm.ts` (`CPQ_SECTION_FIELDS`) — same catalog renders the read-only `CpqSummary` (review step + admin). 4-col `cpq-grid` → 2 cols ≤760px → 1 col ≤480px. Insurance policies / recent projects / personnel / references are bordered paper `cpq-group` fieldsets with `#n` row labels. Yes/No questions use kit `YesNoField` (ink segmented pill, stacks ≤480px); project types use `MultiCheckField` chips (gold tint when on). Required marker = clay `*` (`pf-req`), hints = `pf-hint`. Validation = shared `contractorApplicationMissingFields` (exact API submit rules) + light format checks; group errors show under the fieldset after Continue. Workers' comp collapses when exempt; disclosure explanation appears only after a YES.
- **Saving:** Continue validates the section, saves (`PUT`) and advances; Back / rail jumps save without validation; "Save & finish later" saves in place with a pine confirmation. Links last 30 days; expired links show a "Email me a new link" card (no enumeration).
- **Documents step:** one card per applicable document (conditional: umbrella, surety, EPA RRP, DIR follow answers). Chips: ink "Required to submit" (core: CSLB license, bond, W-9, GL COI, workers' comp/exemption, + signed MCA / background authorization once staff publish their PDF templates) vs muted "Required for approval" (may follow within 14 days). Expiring docs require an expiration date (prefilled from answers). Files go **browser → private Vercel Blob** (`@vercel/blob/client` with a pathname-scoped token, ≤25 MB, PDF/JPG/PNG/WebP, progress bar) and are verified server-side (magic bytes) before registering. Done cards turn pine; staff-requested/rejected cards get a clay rail + note.
- **Review & sign:** summary with Edit links and clay "missing" flags, the certification text served by the API (EN/ES; version + SHA-256 stored), signer fields, a draw-to-sign `SignaturePad` (DPR-scaled canvas, touch/pen/mouse, Clear), certify checkbox, gold full-width submit on phones.
- **After submit:** status card (submitted / in review / approved / denied) + documents still owed (or, once approved, renewals of expiring license/bond/COIs only) + collapsible answers.
- **Portal banner:** contractor dashboard shows a gold `cpq-banner` (clay rail when overdue) until the application is approved.
- **Admin:** Contractors list adds a **Prequalification** status column + filter, a "Review application" gold link for submitted pending rows, and a header **Prequalification** tools modal (bulk-send to active contractors without one — 30-day soft deadline, access unaffected — and upload the blank MCA / background-check PDFs). Contractor detail (`#application`) shows `AdminApplicationPanel`: stat strip, office-use card (license / insurance verified, CSLB lookup link, reviewer), Approve / Request info / Deny / Reopen modals, documents table (missing rows in clay, expiring dates gold/clay, accept / reject-with-note), collapsible answers, e-signature image + IP/time, activity timeline, and an EN/ES PDF (paper-form layout via the shared PDF writer). Staff without `finance.read` see the financial section and sensitive documents as "Restricted".
- **Emails:** `tplPortalNotice` variants for new / existing (deadline) / reminder / info request / resend / missing documents / expiring documents / received / approved / denied. Staff events: `contractor_application_submitted`, `contractor_compliance_alert` (overdue soft deadline, expired documents). Daily Vercel Cron `GET /api/cron/contractor-applications`.

### Contractor invite

Staff invite by email → the email is the prequalification link (opening it accepts the invite → `pending`). Legacy `/contractor/invite/:token` links still work: accepting starts the application (`next=application`) unless the application is already approved (then → `active`). Only active contractors can be assigned; `in_build` needs a contractor. Progress photos and admin avatars are uploaded as JPEG/PNG/WebP files (max 4 MB, magic bytes verified) straight to Vercel Blob by the API (`BLOB_READ_WRITE_TOKEN`); there is no local `public/uploads` fallback in any environment. Stored URLs must be https on Vercel Blob or `PHOTO_URL_ALLOWED_HOSTS`. The contractor upload form is a file picker + caption (no URL field). Draws are allowed only in `contracted` / `in_build` and are capped by the contractor cost via an atomic `draw_committed_cents` counter (rejects concurrent over-draws; rejected draws release the reservation).

### Economics + commission rules

- **Two-level affiliates:** `affiliates.parent_affiliate_id` (NULL = top-level). Top-level affiliates invite **sub-affiliates** from Affiliate → My team (subs activate immediately; admin can suspend). Subs cannot invite further levels.
- **Deal attribution:** `projects.closer_affiliate_id` + frozen `projects.parent_affiliate_id` at enrollment. Legacy `projects.affiliate_id` stays the closer for older rows.
- **Rates** (`system_settings`, Admin → Settings): `commission_direct_cents_per_sqft` ($10), `commission_closer_cents_per_sqft` ($7), `commission_parent_cents_per_sqft` ($3). Legacy `commission_cents_per_sqft` aliases direct. On first loan finalize, rates are **frozen on the project** (`commission_rate_*_cents_per_sqft`) and copied onto each commission row; unpaid recalcs use the freeze (not live Settings). Unfinalize clears the freeze.
- **Split math (plan defaults ignored):** override (if set) else `sq_ft × frozen rates`. Direct (no parent): one `role=direct` row. Sub closer: `role=closer` + `role=parent` rows. Self-parent pointers are ignored (treated as direct). If the parent is **inactive**, parent share is withheld (company) and unpaid parent rows are voided immediately on status change; closer keeps their share. Admin per-row amount edits on split deals update that share only (do not become the project-total override) and are blocked once any share is paid.
- Net profit = sale price − contractor cost − **total** affiliate commission (closer + parent) − agent commission; per sq ft = net ÷ sq ft.
- When the loan becomes `finalized`, `pending` commission row(s) are created due `commission_payout_days_after_loan_close` (default 5) days later (skipped if amount is $0); each payee is emailed; leaving `finalized` voids unpaid commissions. After **any** share is **paid**, `sq_ft` / plan / override / amount edits are locked and profit freezes to the sum of live non-void shares; remaining unpaid shares can still be approved/paid. `commission_paid_at` is set only when **all** non-void shares are paid.
- Lender fields are manual (`anchor` / `external`) and Anchor-ready (`anchor_external_id`). When `ANCHOR_API_KEY` + `ANCHOR_API_BASE` are set, admins can **Sync from Anchor** on a project (`POST /api/admin/projects/:id/anchor/sync`) and Vercel Cron can batch-sync via `POST /api/cron/anchor-sync` (Bearer `CRON_SECRET`). Sync updates `loan_status` + `anchor_last_synced_at` and accrues/voids commissions when finalize flips. Contract generation stores a data snapshot; the PDF (Letter, EN/ES via `?lang=`, brand ink + gold rule, signature lines, paginated footer) is rendered on demand from that snapshot and linked with a `PDF` download link in the admin, contractor and homeowner document tables (homeowners never see affiliate terms or draft/void contracts).

### Milestone state machine

Admins can only move a project one step forward (`lead → financing → contracted → in_build → closed`, financing may be skipped for cash buyers), one step back to correct a mistake, or to `cancelled`; `closed` only re-opens to `in_build` and `cancelled` only to `lead`. Anything else is rejected with `errors.invalidTransition`, enforced under a row lock so two admins cannot race each other.

### Tracking-link abuse guard

Affiliate lookup (`GET /api/public/affiliates/by-code/:code`) is rate limited per IP (60 / 15 min). Over-limit responses omit click logging; the SPA still renders enrollment or inactive messaging where possible.

### Notice emails

`tplPortalNotice` (bilingual EN/ES) reuses the email chrome below: paper header, title, short body, single gold button deep-linking to the relevant portal page (`/admin/...`, `/affiliate`, `/contractor/...`, `/client/invite/:token` for homeowners, `/client` after accept). Used for affiliate approval, contractor invite, client portal magic-link invite (5-day TTL), new-project-assigned, draw status updates, commission paid, staff welcome, staff alerts, and **voicemail transcripts** (assignee only, deep link `/admin/conversations?client|contact|unknown=`). Answered-call transcripts stay in the inbox and are not emailed.

## Composition

Editorial landing (`/`): hero (copy + cinematic ADU commercial) + benefit grid + ADU definition + dark why-ADU comparison cards + process + risks + market numbers + ADU designs (exterior cards + View larger) + partner teaser + financing + ADU options (3D preview + View more details with 3D+CAD) + event band (when live) + lead form + credit-report CTA.

### Home hero commercial

- `HeroCommercial` in the hero art column: `/public/adu/groundwork-adu-commercial.mp4` + poster. Gold-framed **16:9** stage with `object-fit: contain` so the full commercial (logo + on-video copy) is never cropped. Silent clip; **autoplays muted on load** (`autoPlay` + `playsInline`, preload auto) and resumes whenever ~35% in view (pauses when away / modal open). iOS Low Power Mode may still block autoplay → poster + Watch full. The `muted` HTML attribute is set from a ref (React only sets the property; iOS needs the attribute). **Static media must be listed in the `vercel.json` file route** (`mp4|webm|mov|webp|avif|mp3|pdf|…`) or Vercel rewrites it to `index.html`. **Watch full** opens `VideoLightbox` — dark cinematic dialog with gold rule, native controls, Escape/backdrop/close. Mobile: video under copy; modal fluid; no document horizontal scroll.

### Market numbers (`#numbers`)

- Dark ink band with 2×2 stat tiles only (commercial lives in the hero).

### ADU designs gallery (`#designs`)

- Order: **474 → 830 → 445**. Assets `design-viz-1/2/3.jpg` = header + exterior + icon row only (no floor plan), cropped from enhanced marketing sheets.
- **Focus stage** (`AduDesignsStage`): perspective deck — center hero, angled peeks. Center **View larger** opens `ImageLightbox` with the same exterior card. Keyboard ←/→. Mobile: no document horizontal scroll.

### ADU floor-plan options (`#adu-options`)

- Same order **474 → 830 → 445** = **The Veranda** (2 bed · 1 bath) → **The Summit** (2 story · 2 bed · 2 bath) → **The Haven** (1 bed · 1 bath); card titles use the model names + taglines ("More Room. More Possibilities.", "Elevated Two-Story Living", "Compact Living, Thoughtfully Designed"); `adu_plans` rows #1 Haven · #2 Veranda · #3 Summit. Card shows 3D plan (`plan-3d-*.jpg`). **View more details** opens `PlanDetailLightbox` with stacked **3D** then **CAD** (`plan-cad-*.png`). Fixed preview height so tabs don’t jump layout. Mobile: detail stage scrolls; no document horizontal scroll.

Interior routes share home band language:

- `/about` — interior hero → benefit steps → opportunity who-band → statement mission → financing why-list + CTA
- `/partners` — interior hero → path cards (commission / who) → form-section partner application. Submits `POST /api/public/partner-referral` which creates a **pending affiliate** (not a Lead), attributes `parent_affiliate_id` from `/r/:code` / `?ref=` / `gw_ref`, and notifies staff via the existing `partner_referral` event (copy says pending affiliate). Success copy: application received / pending review.
- `/contact` with **intent=partner** uses the same pending-affiliate intake (no lead); success copy uses `contact.partnerSuccess*`.

### Admin Leads → Convert (multi-role)

Admin **Leads** Convert opens a target picker: **Client / homeowner** (client + project + portal invite; needs `projects.write`), **Affiliate**, **Contractor** (need `approvals`). Smart default from `source` / `audience_tag` / notes (`partner_referral`, `company=`, `intent=partner|contractor`, tags). Affiliate/Contractor confirm dialog chooses **pending | active** (affiliate defaults active; contractor invite-first defaults pending). Phone match with a different email shows a link-confirm dialog (`confirm_phone_link`). Convert is hidden when `client_id`, `converted_affiliate_id`, or `converted_contractor_id` is set. Historical `partner_referral` leads stay in Leads for manual Convert (no bulk migrate).
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
- Live send whenever `RESEND_API_KEY` is set (local + prod); `NOTIFY_EMAILS=false` forces email dry-run. **Notification sandbox** (`notifySandbox()`: always under Vitest, or `NOTIFY_SANDBOX=true` for local QA) dry-runs email + SMS + Ably and limits staff alerts (email / in-app / SMS) to `@example.com` / `@example.test` admins

## Get Credit Report

- Route: `/get-credit-report` (unlisted / noindex) — **Fontana event registration landing** (slug `fontana-oct-6`), same hero/body/RSVP as `/events/fontana-oct-6`.
- Primary CTA: event RSVP (`LeadForm` with `mode=event`). Post-RSVP “free credit report” scrolls to `#free-report` on the same page (not a circular link).
- Optional end section (`#free-report`): soft-pull capture (`POST /api/public/get-credit-report-lead`) → MyFreeScoreNow link. Clearly labeled optional — not required to attend. `/join` links here with `#free-report` and re-scrolls after async event content loads.
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
- **Conversations / Contacts MCP (Optimum parity):** `search_contacts` / `get_contact` / `create_contact` / `update_contact` / `convert_contact`; `send_sms` (+ `send_text`) to clients or staff; `send_contact_sms` / `send_contact_email`; `list_sms` (+ `get_texts` / `get_conversation`); `get_call_insights` (call rows + Twilio `transcript_full` when ready — **no AI summaries**); `list_brand_phone_numbers` (+ alias `list_ofg_phone_numbers`). WhatsApp tools exist as stubs (`whatsapp_not_configured`) until a WA channel ships. SMS From defaults to the MCP admin’s assigned brand Twilio line; override with `from_admin_*` or `from_phone_number_id`.
- **Docs:** `mcp/admin-ask/README.md`. Cursor prod URL in `.cursor/mcp.json` (local override in user config — do not commit localhost).
