# Leads → multi-role Convert + Partners intake fix

**Project:** Groundwork Capital (`/Users/felixgomez/Code/groundwork`)  
**Status:** Implemented (locked decisions 1b–13a)  
**Origin:** Staff report — partner/affiliate-link signups land in **Leads** with only a generic **Convert** (homeowner/client+project). Need Convert → Borrower / Affiliate / Contractor.  
**Terminology (confirmed):** **Borrower = Client = Homeowner** (same entity: `clients` table). Prefer admin label **Client / homeowner** in Convert UI (not “Borrower”).

---

## Problem

1. `/partners` and partner-interest flows insert into `leads` with `source=partner_referral` (marketing waitlist).
2. Real affiliate onboarding is a different path: `/affiliate/signup` → `affiliates` (`pending`).
3. Admin **Convert** (`POST /api/admin/leads/:id/convert`) always runs `createClientWithProject` — never Affiliate or Contractor.
4. Example pain: partner_referral lead (e.g. Angelica Rivera / Encore Mortgage) sits in Leads with only Convert → wrong entity.

---

## Locked decisions

| # | Topic | Choice |
|---|--------|--------|
| **1** | `/partners` (and partner-program interest) going forward | **b** — Create a **pending Affiliate** immediately (do **not** create a Lead for this path). |
| **2** | Convert modal targets | **a** — **Client/homeowner** + **Affiliate** + **Contractor**. |
| **3** | Client/homeowner convert | **a** — **Client + project** (keep today’s behavior). |
| **4** | Affiliate convert status | **b** + dialog — Default toward **active**, but show a **confirm dialog** where staff choose **`pending` or `active`**. |
| **5** | Contractor convert | **b** + dialog — Primary path is **send invite** (no full row until accept, matching invite flow). Confirm dialog also lets staff choose **`pending` or `active`** when that creates/updates a contractor record as part of the invite flow (align with existing contractor invite UX). |
| **6** | Email already exists as client / affiliate / contractor | **a** — **Block** with a clear error (do not create a second identity). |
| **7** | Phone match, different email | **b + c** — Detect phone match → **warn** → on staff confirm → **auto-link** as same person (do not silently create a duplicate). |
| **8** | Convert UI default target | **c** — Smart default from `audience_tag` / `source` / notes intent (`partner_referral`, `company=`, `intent=partner`, SMS tags, etc.). |
| **9** | Mark lead done after non-client convert | **b** — Add FKs on `leads` (e.g. `converted_affiliate_id`, `converted_contractor_id`) analogous to `client_id`. |
| **10** | Permissions | **c** — Client/homeowner convert: `projects.write`. Affiliate/Contractor convert: `approvals`. |
| **11** | `/r/:code` → Partners | **b** — Attribute **parent affiliate** (`referral_code` / `parent_affiliate_id`) on the new affiliate. |
| **12** | Historical `partner_referral` leads | **a** — Leave in Leads; staff use new Convert picker (no bulk migrate). |
| **13** | Convert UI label for homeowner target | **a** — Keep **Client / homeowner** (not rename to “Borrower”). |

---

## Implementation scope

### A. Intake (new Partners traffic) — decision 1b + 11b

- Change `POST /api/public/partner-referral` (and any “join partner program” contact intent that should match) so it:
  - Creates/updates an **`affiliates`** row (`pending` on public signup — staff activate later via normal approvals, unless product later changes this for public path only).
  - Does **not** insert a new `leads` row for pure partner interest.
  - Accepts and persists **`referral_code`** from `/r/:code?to=partners` (same cookie/helper as public leads) → set parent attribution on the affiliate.
- Update Partners page + Redux (`contactSlice` / partner submit) to send `referral_code` like `leadSlice`.
- Preserve staff notification behavior (adapt from `partner_referral` lead notify → affiliate pending notify if needed).
- i18n: success copy should say affiliate application received / pending review, not “we’ll add you as a lead.”

### B. Leads Convert — multi-target (2a, 3a, 4, 5, 6a, 7b+c, 8c, 9b, 10c, 13a)

**UI** (`client/pages/admin/Leads.tsx` + i18n EN/ES):

- Replace single Convert with target picker:
  1. **Client / homeowner** (default when smart default says so)
  2. **Affiliate**
  3. **Contractor**
- Smart default (8c) from `source`, `audience_tag`, notes (`company=`, `intent=partner`, etc.).
- **Affiliate:** confirm dialog — status **`pending` | `active`** (default prefer **active** per 4b).
- **Contractor:** confirm dialog — invite-first (5b); status **`pending` | `active`** when a row is created as part of that flow.
- **Phone collision (7):** if phone matches another person with different email → warning modal → Confirm to link / Cancel.
- Hide Convert when already converted (`client_id` **or** new affiliate/contractor FKs).
- Gate Affiliate/Contractor actions on `approvals`; Client convert on `projects.write`.

**API** (`POST /api/admin/leads/:id/convert` — extend body, keep backward compatible if possible):

```ts
{
  target: "client" | "affiliate" | "contractor"; // default "client" for old clients
  // client:
  adu_plan_id?: number | null;
  // affiliate / contractor:
  status?: "pending" | "active"; // from confirm dialog
  // phone-match override:
  confirm_phone_link?: boolean;
}
```

Behavior:

| target | Behavior |
|--------|----------|
| `client` | Existing: `createClientWithProject`, set `leads.client_id`, `status=qualified`, portal invite. Requires `projects.write`. |
| `affiliate` | Create/link affiliate; set status from dialog; set `leads.converted_affiliate_id` (name TBD); close/qualify lead appropriately. Requires `approvals`. Block if email already on `affiliates`/`clients`/`contractors` (6a) unless phone-link confirm applies. |
| `contractor` | Invite-first flow (5b); on confirm create/link as needed with chosen status; set `leads.converted_contractor_id`. Requires `approvals`. Same email block rules. |

**Email collision (6a):** if email exists on the target table (or cross-table per product rule “any identity”), return **409** with clear code/message (`email_exists_client` / `email_exists_affiliate` / `email_exists_contractor`).

**Phone match (7b+c):** if phone matches another record with different email → **409** or structured response requiring `confirm_phone_link: true`; when confirmed, link to existing person instead of creating a duplicate.

### C. Schema

Migration (do not edit `schema.sql` first):

- `leads.converted_affiliate_id` NULL FK → `affiliates.id` ON DELETE SET NULL  
- `leads.converted_contractor_id` NULL FK → `contractors.id` ON DELETE SET NULL  
- Indexes for lookup  
- Sync `database/schema.sql` after apply  

Optional: expose `audience_tag` on admin lead list/API if useful for smart default/badges (field already exists; mostly unused in Leads UI).

### D. Docs / contracts / tests

- Update `api/swagger.yaml` for convert body + responses + partner-referral behavior.
- Update `shared/api.ts` types.
- Tests:
  - Partner referral → affiliate pending, **no** lead row; referral_code attribution.
  - Convert → client (regression).
  - Convert → affiliate pending/active.
  - Convert → contractor invite path + status dialog values.
  - Email exists → 409.
  - Phone mismatch email → warn path + confirm link.
  - Permissions: `projects.write` vs `approvals`.
  - Historical lead still convertible via picker (12a).
- i18n EN + ES for all new strings.

---

## Out of scope (this change)

- Bulk migrate historical `partner_referral` leads (12a — manual Convert only).
- Renaming Clients nav to “Borrowers”.
- OFG / Gomez Framework — this is Groundwork-only.
- Changing enroll (`/start`) or event RSVP lead creation beyond what’s needed for referral attribution on Partners / contact intent=partner.

---

## Key code map (current)

| Area | Path (approx.) |
|------|----------------|
| Leads UI Convert | `client/pages/admin/Leads.tsx` |
| Convert thunk | `client/store/slices/adminPortalSlice.ts` → `POST /admin/leads/:id/convert` |
| Convert API | `api/index.ts` ~`POST /api/admin/leads/:id/convert` |
| createClientWithProject | `api/index.ts` |
| Partner referral API | `api/index.ts` ~`POST /api/public/partner-referral` |
| Partners form | `client/pages/Partners.tsx` + `client/store/slices/contactSlice.ts` |
| Affiliate signup (keep) | `client/pages/auth/AffiliateSignup.tsx` → `/public/affiliate/signup` |
| Referral landing | `client/pages/ReferralLanding.tsx` `/r/:code` |
| Schema | `database/schema.sql` — `leads`, `affiliates`, `contractors`, `clients` |

---

## Acceptance checklist

- [x] New Partners submission creates **pending affiliate**, not a Lead; parent affiliate attributed when `?ref=` / `/r/:code` present.
- [x] Leads Convert offers **Client/homeowner | Affiliate | Contractor** with smart default.
- [x] Client convert still creates **client + project** and invite.
- [x] Affiliate convert confirm: **pending | active** (default lean active).
- [x] Contractor convert confirm: **invite-first** + **pending | active** as applicable.
- [x] Duplicate email → blocked with clear error.
- [x] Phone match different email → warn → confirm → link.
- [x] Lead FKs set for affiliate/contractor converts; Convert hidden when already converted.
- [x] Permission split enforced.
- [x] Swagger + EN/ES + tests green; no breaking change to existing client convert callers (default `target=client`).

---

## Suggested reply template for implementer chat

> Implement `docs/LEAD_MULTI_ROLE_CONVERT.md` as locked. Decisions: 1b, 2a, 3a, 4b+status dialog, 5b+status dialog, 6a, 7b+c, 8c, 9b, 10c, 11b, 12a, 13a. Borrower = client = homeowner; UI label Client/homeowner.
