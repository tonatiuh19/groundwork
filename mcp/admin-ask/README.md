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
| `dashboard_summary` | Leads, pending affiliates, draws, milestones, finance rollups |
| `search_leads` / `get_lead` | Lead inbox |
| `search_clients` / `get_client` | Clients |
| `search_projects` / `get_project` | ADU projects + milestones |
| `search_affiliates` / `get_affiliate` | Affiliates |
| `search_contractors` / `get_contractor` | Contractors |
| `list_draws` | Draw requests |
| `list_commissions` | Affiliate commissions |
| `list_events` / `get_event` | Marketing events |
| `search_staff` | Admin staff |
| `list_plans` | ADU plans |
| `search_contacts` / `get_contact` | CRM Contacts address book (not pipeline clients) |
| `list_sms` / `get_texts` / `get_conversation` | Conversations hub timeline for a client |
| `get_call_insights` | Call/voicemail rows + Twilio `transcript_full` when ready (no AI summaries) |
| `list_brand_phone_numbers` / `list_ofg_phone_numbers` | Brand Twilio lines + `acting_admin_from` |
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
| `update_commission_status` | approved / paid / void |
| `create_staff` | Invite staff (`admin`/`agent`/`finance`/`content` only — not `super_admin`) |
| `create_contact` / `update_contact` | CRM address book; use `confirm_duplicate=true` when phone/email matches |
| `convert_contact` | Contact → client prospect (phone and/or email); re-links Conversations |
| `send_sms` / `send_text` | Twilio SMS to client or staff; From = assigned brand line (or `from_*` override) |
| `send_contact_sms` | SMS CRM contact; logs hub + contact notes |
| `send_contact_email` | Branded Resend email to CRM contact + notes stamp |
| `send_whatsapp` / `send_wa` / `send_contact_whatsapp` | Stub — returns `whatsapp_not_configured` |

## Auth

- Bearer OAuth access token (from Claude/Cursor), **or**
- `gw_admin_sid` cookie (browser / local testing)
- Must be `admins.role = super_admin` and `status = active`
- Access token TTL: **1 hour**. Refresh token TTL: **30 days** (rotated + extended on each refresh).
- HTTPS redirect URIs limited to Claude `/api/mcp/auth_callback*` and Cursor `/agents/mcp/oauth/callback*` (plus loopback / `cursor:`).
