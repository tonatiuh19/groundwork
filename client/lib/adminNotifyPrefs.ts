import type {
  AdminNotificationPrefs,
  AdminNotifyChannel,
  AdminNotifyEventKey,
  AdminNotifyEventToggles,
} from "@shared/api";

/** Keep in sync with api/index.ts ADMIN_NOTIFY_EVENT_KEYS. */
export const ADMIN_NOTIFY_EVENT_KEYS: AdminNotifyEventKey[] = [
  "lead_submitted",
  "get_credit_report_lead",
  "contact_submitted",
  "partner_referral",
  "affiliate_signup",
  "affiliate_client_registered",
  "client_signup",
  "client_signup_reminder",
  "contractor_signup",
  "contractor_signup_reminder",
  "contractor_application_submitted",
  "contractor_compliance_alert",
  "affiliate_onboarding",
  "line_needs_owner",
  "duplicate_blocked",
  "draw_submitted",
  "lead_converted",
  "client_created",
  "milestone_changed",
  "commission_accrued",
  "contract_sent",
  "inbound_sms",
];

/** Primary alert types shown in Settings Team notifications. */
export const NOTIFY_EXTRA_EVENT_KEYS: AdminNotifyEventKey[] =
  ADMIN_NOTIFY_EVENT_KEYS;

export type AdminNotifyPrefsPatch = {
  channel_masters?: Partial<Record<AdminNotifyChannel, boolean>>;
  email?: Partial<Record<AdminNotifyEventKey, boolean>>;
  in_app?: Partial<Record<AdminNotifyEventKey, boolean>>;
  sms?: Partial<Record<AdminNotifyEventKey, boolean>>;
};

function allOn(): AdminNotifyEventToggles {
  const out = {} as AdminNotifyEventToggles;
  for (const key of ADMIN_NOTIFY_EVENT_KEYS) out[key] = true;
  return out;
}

function cloneToggles(t: AdminNotifyEventToggles): AdminNotifyEventToggles {
  return { ...t };
}

function applyChannelMaster(
  prefs: AdminNotificationPrefs,
  channel: AdminNotifyChannel,
  value: boolean,
): void {
  const next = cloneToggles(prefs[channel]);
  for (const key of ADMIN_NOTIFY_EVENT_KEYS) next[key] = value;
  prefs[channel] = next;
}

/** Apply a prefs patch the same way the API merges writes (optimistic UI). */
export function applyAdminNotifyPrefsPatch(
  current: AdminNotificationPrefs,
  patch: AdminNotifyPrefsPatch,
): AdminNotificationPrefs {
  const next: AdminNotificationPrefs = {
    email: cloneToggles(current.email),
    in_app: cloneToggles(current.in_app),
    sms: cloneToggles(current.sms),
  };
  if (patch.channel_masters) {
    if (typeof patch.channel_masters.email === "boolean") {
      applyChannelMaster(next, "email", patch.channel_masters.email);
    }
    if (typeof patch.channel_masters.in_app === "boolean") {
      applyChannelMaster(next, "in_app", patch.channel_masters.in_app);
    }
    if (typeof patch.channel_masters.sms === "boolean") {
      applyChannelMaster(next, "sms", patch.channel_masters.sms);
    }
  }
  if (patch.email) next.email = { ...next.email, ...patch.email };
  if (patch.in_app) next.in_app = { ...next.in_app, ...patch.in_app };
  if (patch.sms) next.sms = { ...next.sms, ...patch.sms };
  return next;
}

/** Master switch is On when any event on that channel is On. */
export function adminNotifyChannelMasterOn(
  prefs: AdminNotificationPrefs,
  channel: AdminNotifyChannel,
): boolean {
  return ADMIN_NOTIFY_EVENT_KEYS.some((k) => prefs[channel][k]);
}

export function notifyExtraAllowsEvent(
  events: AdminNotifyEventKey[] | null | undefined,
  eventKey: AdminNotifyEventKey,
): boolean {
  if (events == null) return true;
  return events.includes(eventKey);
}

/**
 * Toggle one event for an extra email.
 * All selected → null (all types). Partial → selected keys.
 */
export function toggleNotifyExtraEvent(
  current: AdminNotifyEventKey[] | null | undefined,
  eventKey: AdminNotifyEventKey,
  value: boolean,
  catalog: AdminNotifyEventKey[] = NOTIFY_EXTRA_EVENT_KEYS,
): AdminNotifyEventKey[] | null {
  const base = current == null ? [...catalog] : [...current];
  const next = value
    ? Array.from(new Set([...base, eventKey]))
    : base.filter((k) => k !== eventKey);
  return next.length === catalog.length ? null : next;
}

export function defaultAdminNotificationPrefs(): AdminNotificationPrefs {
  const all = allOn();
  return { email: { ...all }, in_app: { ...all }, sms: { ...all } };
}
