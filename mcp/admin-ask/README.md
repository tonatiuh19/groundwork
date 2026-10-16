# Groundwork Capital — Remote MCP (OAuth)

**Preferred:** Claude and Cursor connect to:

```text
https://www.groundworkcapitalgroup.com/api/mcp
```

No shared master token. Each **super_admin** signs in, consents, and can revoke in **Admin → Profile → Connected AI apps**.

MCP is always on (no kill switch). Scope: `groundwork.admin.read`.

## Claude setup (primary)

Remote MCP is a **custom connector** (not `claude_desktop_config.json` — that file is stdio-only).

1. Deploy API (ensure `mcp_oauth_*` migration is applied)
2. In Claude (web or Desktop): **Customize → Connectors → Add custom connector**
3. Name: `Groundwork Capital`
4. URL: `https://www.groundworkcapitalgroup.com/api/mcp`
5. Connect → browser opens Groundwork → log in as **super_admin** → **Allow access**
6. Tools appear under your admin identity

Help: [Custom connectors (remote MCP)](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp)

OAuth callbacks we allow for Claude:

- `https://claude.ai/api/mcp/auth_callback`
- `https://claude.com/api/mcp/auth_callback`
- Claude Code loopback: `http://localhost/callback` / `http://127.0.0.1/callback` (any port)

## Cursor (optional)

Repo `.cursor/mcp.json` points at production:

```json
{
  "mcpServers": {
    "groundwork-capital": {
      "url": "https://www.groundworkcapitalgroup.com/api/mcp"
    }
  }
}
```

**Local override:** for a local API (`http://localhost:8080/api/mcp`), copy that URL into your user-level Cursor MCP config (or temporarily edit `.cursor/mcp.json` — do not commit localhost). Discovery and OAuth issuer always force `https://www.groundworkcapitalgroup.com` in production.

Then Customize → MCP → Connect → same consent flow.

## Discovery

- Issuer / resource: `https://www.groundworkcapitalgroup.com/api/mcp` (www forced from apex)
- `/.well-known/oauth-protected-resource`
- `/.well-known/oauth-authorization-server/api/mcp`
- Authorize / token / register / revoke under `/api/mcp/oauth/*`
- Consent approve: `POST /api/admin/mcp/oauth/approve` (super_admin cookie)

## Tools (Groundwork ADU financing domain)

### Reads

| Tool | Notes |
|---|---|
| `dashboard_summary` | Leads (new + active queue), pending affiliates, affiliates awaiting agreement, W-9s to review, phone lines needing an owner, draws, milestones, finance rollups |
| `search_leads` / `get_lead` | Lead inbox; `view=active\|converted\|all` (same scopes as the Leads page) + `last_sms` / `last_call` per lead |
| `search_clients` / `get_client` | Clients; `get_client` adds deal status, referring affiliate and the updates feed |
| `list_deal_statuses` | Deal statuses (Credit repair, Not enough equity, …) — separate from portal account status |
| `search_projects` / `get_project` | ADU projects + milestones |
| `search_affiliates` / `get_affiliate` | Affiliates; `get_affiliate` adds sponsor / senior sponsor, agreement + W-9 onboarding state (`payout_ready`), W-9 last 4 only |
| `search_contractors` / `get_contractor` | Contractors |
| `list_draws` | Draw requests |
| `list_commissions` | Commissions with `role` (direct, closer=referring, parent=sponsor, grandparent=senior sponsor), `payout_ready`; filters `status`, `role`, `affiliate_id` |
| `list_events` / `get_event` | Marketing events with `is_past`, public + QR (`/e/<slug>`) links, media count; `get_event` lists photos / videos / reels |
| `search_staff` | Admin staff |
| `list_plans` | ADU plans |
| `search_contacts` / `get_contact` | CRM Contacts address book (not pipeline clients) |
| `list_sms` / `get_texts` / `get_conversation` | Conversations hub timeline for a client |
| `get_call_insights` | Call/voicemail rows + Twilio `transcript_full` when ready (no AI summaries) |
| `list_brand_phone_numbers` / `list_ofg_phone_numbers` | Brand Twilio lines (`line_mode`, `needs_owner`) + `acting_admin_from` (own personal line first, then shared memberships) |
| `get_phone_line` | One line's settings by `line_id` or `e164`: mode, owner, members, what rings, ring time, voicemail, needs owner |
| `list_message_templates` | Active SMS templates (EN/ES, category, usage); fill `{{first_name}}` etc. before sending |
| `list_whatsapp` | Stub — WhatsApp not configured (use `list_sms`) |

### Writes (dry-run then confirm)

Always call with `confirm=false` (or omit) first; show the preview; then re-call with **both** `confirm=true` **and** `confirm_phrase=CONFIRM`. Phrase alone never writes.

| Tool | Notes |
|---|---|
| `convert_lead` | Lead → `client` (project + invite), `affiliate`, or `contractor` (same as Admin Convert; supports `status` + `confirm_phone_link`) |
| `update_project_milestone` | Uses `assertMilestoneTransition` |
| `approve_affiliate` | pending → active |
| `approve_client` | pending homeowner signup → prospect + portal invite |
| `approve_contractor` | pending contractor signup → active + login email |
| `invite_contractor` | Invite-only contractor portal |
| `invite_client_portal` | Re-send client portal invite |
| `update_draw_status` | approved / rejected / paid |
| `update_commission_status` | approved / paid / void — `paid` refused until the affiliate has a signed agreement + W-9 (`errors.affiliateOnboardingIncomplete`) |
| `set_client_deal_status` | Set / clear a client's deal status (`deal_status_id` or label); notifies the referring affiliate by text + email + portal unless `notify_affiliate=false` |
| `add_client_update` | Client note — internal, or `share_with_affiliate=true` (portal + text + email) |
| `set_affiliate_subscription_price` | Agreement Section 3 price (cents); first price emails the affiliate; locked once signed |
| `set_affiliate_sponsor` | Set / clear sponsor (refuses loops); new projects only |
| `list_appointments` | Appointments in a range with tagged people (filters: client, project, lead, staff) |
| `create_appointment` | Schedule on a client / lead / project; tag contractor, lender, staff, guests; everyone gets email + calendar invite + text |
| `reschedule_appointment` | Change time / place / tagged people (updated invites; untagged get a cancellation) |
| `cancel_appointment` | Cancel; everyone tagged gets a cancellation invite |
| `list_lenders` / `upsert_lender` | Lenders directory (tag on appointments, link to projects) |
| `get_affiliate_billing` | Platform subscription: status (free period / active / past due / canceled), price, next charge, card brand + last 4 |
| `get_contractor_billing` | Contractor membership ($99.90/mo, 30 days free from approval): status, price (0 = waived), card brand + last 4, awaiting approval, portal locked |
| `list_memberships` | Every contractor + affiliate membership with totals (monthly revenue, paying, free period, past due, paused, free periods ending in 7 days); filter by role / status |
| `resend_affiliate_welcome` | Re-send the welcome email + text (presentation + new secure link: agreement, W-9, card); older links stop working |
| `list_affiliate_faqs` | Affiliate FAQ (EN/ES) shown in the portal and used by the assistant |
| `upsert_affiliate_faq` | Add or edit a FAQ entry (EN required, ES optional) |
| `list_affiliate_assistant_questions` | What affiliates asked the assistant; `handoff_only` = questions it passed to the team |
| `create_staff` | Invite staff (`admin`/`agent`/`finance`/`content` only — not `super_admin`) |
| `create_contact` / `update_contact` | CRM address book; use `confirm_duplicate=true` when phone/email matches |
| `convert_contact` | Contact → client prospect (phone and/or email); re-links Conversations |
| `revert_client_to_lead` | Undo a client conversion ("Move back to Leads"): lead → Active again, CRM contact un-converted, Conversations unknown reopened, or a new lead for direct clients. Keeps texts/calls + notes, removes the empty project + unused invite, audits a snapshot. Blocked once the portal was used / project past Lead / contractor / money. Dry-run shows the plan. |
| `send_sms` / `send_text` | Twilio SMS to client or staff; From = the line the client's conversation is on (number they know), else the acting admin's own line, or `from_*` override |
| `send_contact_sms` | SMS CRM contact (From = their thread's line when one exists); logs hub + contact notes |
| `send_contact_email` | Branded Resend email to CRM contact + notes stamp |
| `send_whatsapp` / `send_wa` / `send_contact_whatsapp` | Stub — returns `whatsapp_not_configured` |

## Auth

- Bearer OAuth access token (from Claude/Cursor), **or**
- `gw_admin_sid` cookie (browser / local testing)
- Must be `admins.role = super_admin` and `status = active`
- Access token TTL: **1 hour**. Refresh token TTL: **30 days** (rotated + extended on each refresh).
- HTTPS redirect URIs limited to Claude `/api/mcp/auth_callback*` and Cursor `/agents/mcp/oauth/callback*` (plus loopback / `cursor:`).
