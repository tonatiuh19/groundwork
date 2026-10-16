/** Shared API contracts — import type only from api/index.ts */

import type { ContractorApplicationStatus } from "./contractorApplication";

export type AdminRole =
  | "super_admin"
  | "admin"
  | "agent"
  | "finance"
  | "content";

export type PortalActor = "admin" | "affiliate" | "contractor" | "client";

export type AdminNotifyEventKey =
  | "lead_submitted"
  | "get_credit_report_lead"
  | "contact_submitted"
  | "partner_referral"
  | "affiliate_signup"
  | "affiliate_client_registered"
  | "client_signup"
  | "client_signup_reminder"
  | "contractor_signup"
  | "contractor_signup_reminder"
  | "contractor_application_submitted"
  | "contractor_compliance_alert"
  | "affiliate_onboarding"
  | "line_needs_owner"
  | "duplicate_blocked"
  | "draw_submitted"
  | "lead_converted"
  | "client_created"
  | "milestone_changed"
  | "commission_accrued"
  | "contract_sent"
  | "inbound_sms";

export type AdminNotifyChannel = "email" | "in_app" | "sms";

export type AdminNotifyEventToggles = Record<AdminNotifyEventKey, boolean>;

export interface AdminNotificationPrefs {
  email: AdminNotifyEventToggles;
  in_app: AdminNotifyEventToggles;
  sms: AdminNotifyEventToggles;
}

export interface AdminNotificationChannelMeta {
  available: boolean;
  disabled_reason?: string | null;
}

export interface AdminNotifyStaffRecipient {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  role: string;
  phone: string | null;
  prefs: AdminNotificationPrefs;
  channels: Record<AdminNotifyChannel, AdminNotificationChannelMeta>;
}

export interface AdminNotifyRecipientsResponse {
  staff: AdminNotifyStaffRecipient[];
  extras: AdminNotifyExtraEmail[];
  events: AdminNotifyEventKey[];
}

export interface AdminNotificationPrefsResponse {
  prefs: AdminNotificationPrefs;
  channels: Record<AdminNotifyChannel, AdminNotificationChannelMeta>;
  events: AdminNotifyEventKey[];
}

export interface AdminInAppNotification {
  id: number;
  event_key: string;
  title: string;
  body: string | null;
  link_url: string | null;
  read_at: string | null;
  created_at: string;
}

export interface AdminInAppNotificationsResponse {
  notifications: AdminInAppNotification[];
  unread_count: number;
}

export interface AdminPhoneNumber {
  id: number;
  e164: string;
  friendly_name: string | null;
  twilio_sid: string | null;
  assigned_admin_id: number | null;
  assigned_admin_name?: string | null;
  is_active: boolean;
  capabilities: { sms?: boolean; mms?: boolean; voice?: boolean } | null;
  is_primary?: boolean;
  /** shared = members + ring list; personal = one staff owner (visible to admins too). */
  line_mode?: PhoneLineMode;
  /** Staff on a shared line. */
  member_count?: number;
  /** Active line with no owner or a deactivated owner (traffic falls back to the main line). */
  needs_owner?: boolean;
}

export type PhoneLineMode = "shared" | "personal";

/** Twilio number on the account that isn't connected to Groundwork yet. */
export interface AvailableTwilioNumber {
  sid: string;
  e164: string;
  friendly_name: string | null;
  capabilities: { sms?: boolean; mms?: boolean; voice?: boolean } | null;
  current_host: string | null;
  in_use_elsewhere: boolean;
}

/** Phone line settings: who sees the line, what rings, one bilingual voicemail. */
export interface PhoneLineSettings {
  ok: true;
  line: {
    id: number;
    e164: string;
    friendly_name: string | null;
    is_primary: boolean;
    line_mode: PhoneLineMode;
    assigned_admin_id: number | null;
    assigned_admin_name: string | null;
    ring_timeout_sec: number;
    voicemail_greeting_en: string | null;
    voicemail_greeting_es: string | null;
  };
  members: Array<{
    admin_id: number;
    name: string;
    role: string;
    active: boolean;
    ring_browser: boolean;
    browser_online: boolean;
  }>;
  ring_numbers: Array<{ id?: number; label: string; e164: string; is_active: boolean }>;
  staff: Array<{ id: number; name: string; role: string }>;
  defaults: { en: string; es: string };
  now: { ringing_browsers: number; ringing_phones: string[]; timeout: number; personal_line: boolean; needs_owner: boolean };
}

export interface PhoneLineSettingsBody {
  line_mode: PhoneLineMode;
  assigned_admin_id: number | null;
  members: Array<{ admin_id: number; ring_browser: boolean }>;
  ring_numbers: Array<{ label: string; e164: string; is_active: boolean }>;
  ring_timeout_sec: number;
  voicemail_greeting_en: string | null;
  voicemail_greeting_es: string | null;
}

export type DealStatusTone = "neutral" | "warn" | "bad" | "good";

export interface DealStatus {
  id: number;
  label_en: string;
  label_es: string;
  tone: DealStatusTone;
  sort_order: number;
  is_active: boolean;
}

/** Fields joined onto clients / projects / affiliate client rows. */
export interface DealStatusFields {
  deal_status_en?: string | null;
  deal_status_es?: string | null;
  deal_status_tone?: DealStatusTone | null;
}

export interface ClientUpdate {
  id: number;
  client_id: number;
  kind: "note" | "deal_status";
  visibility: "internal" | "affiliate";
  body: string | null;
  deal_status_id?: number | null;
  deal_status_label_en: string | null;
  deal_status_label_es: string | null;
  author_name?: string | null;
  notified_affiliate_name?: string | null;
  notified_at?: string | null;
  created_at: string;
}

export interface CrmContact {
  id: number;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  preferred_language: "en" | "es";
  admin_notes: string | null;
  assigned_admin_id: number | null;
  created_by_admin_id: number | null;
  converted_client_id: number | null;
  converted_at: string | null;
  deleted_at: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export type ConversationContactKind = "client" | "contact" | "unknown";

export interface ConversationHubContact {
  kind: ConversationContactKind;
  contact_id: number;
  client_id?: number;
  crm_contact_id?: number;
  unknown_contact_id?: number;
  display_name: string;
  phone?: string | null;
  email?: string | null;
  last_message_at?: string | null;
  last_message_preview?: string | null;
  unread_count: number;
  status: string;
  assigned_admin_id?: number | null;
  primary_conversation_id?: number | null;
  client_status?: string | null;
  /** Unknown threads: who this number belongs to in our records (best match first). */
  match?: PhoneMatch | null;
}

export type PhoneMatchRole = "client" | "affiliate" | "contractor" | "contact" | "lead" | "staff";
export interface PhoneMatch {
  role: PhoneMatchRole;
  id: number;
  name: string;
  /** Other records sharing this number (lower priority). */
  others: { role: PhoneMatchRole; id: number; name: string }[];
}

export interface ConversationMessage {
  id: number;
  conversation_id?: number;
  direction: "inbound" | "outbound" | "internal" | "system";
  channel: string;
  body: string | null;
  media_url?: string | null;
  media_content_type?: string | null;
  from_address?: string | null;
  to_address?: string | null;
  sent_by_admin_id?: number | null;
  sent_by_admin_name?: string | null;
  provider_message_id?: string | null;
  provider_status?: string | null;
  error_message?: string | null;
  call_duration_sec?: number | null;
  recording_url?: string | null;
  metadata_json?: Record<string, unknown> | null;
  /** Twilio transcription text when ready (from metadata_json.transcript). */
  transcript?: string | null;
  transcript_status?: string | null;
  created_at: string;
}

export interface ConversationThread {
  id: number;
  channel: string;
  status: string;
  assigned_admin_id?: number | null;
  ofg_number_id?: number | null;
  unread_count?: number;
  last_message_at?: string | null;
}

export interface ConversationTimelineResponse {
  kind: ConversationContactKind;
  contact: Record<string, unknown>;
  threads?: ConversationThread[];
  messages: ConversationMessage[];
}

export interface ConversationsListResponse {
  contacts: ConversationHubContact[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface ConversationsAccessResponse {
  enabled: boolean;
  numbers: AdminPhoneNumber[];
}

/** SMS / note library row (`conversation_templates`). */
export interface ConversationTemplate {
  id: number;
  title: string;
  body_en: string;
  body_es: string | null;
  is_active: boolean;
  sort_order: number;
  category?: ConversationTemplateCategory;
  usage_count?: number;
  last_used_at?: string | null;
  created_by_admin_id?: number | null;
  created_at?: string;
  updated_at?: string;
}

export const CONVERSATION_TEMPLATE_CATEGORIES = [
  "general",
  "welcome",
  "follow_up",
  "reminder",
  "status_update",
  "documents",
  "scheduling",
] as const;
export type ConversationTemplateCategory = (typeof CONVERSATION_TEMPLATE_CATEGORIES)[number];

export interface CrmContactWritePayload {
  first_name: string;
  last_name: string;
  email?: string | null;
  phone?: string | null;
  address_line1?: string | null;
  address_line2?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  preferred_language?: "en" | "es";
  admin_notes?: string | null;
}

export interface CrmContactsListResponse {
  contacts: CrmContact[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface ConvertCrmContactResponse {
  ok: true;
  contact_id: number;
  client_id: number;
  preferred_language: "en" | "es";
  existing?: boolean;
  linked_existing?: boolean;
}

export interface CallForwardingSettings {
  success: true;
  call_forwarding_enabled: boolean;
  call_forwarding_phone: string | null;
  call_forwarding_number?: string | null;
}

/** Admin capability keys. The API keeps an inline copy (Vercel); a test asserts they match. */
export type AdminPerm =
  | "leads"
  | "people.read"
  | "people.write"
  | "approvals"
  | "projects.read"
  | "projects.write"
  | "finance.read"
  | "finance.write"
  | "plans.write"
  | "events"
  | "staff"
  | "settings"
  | "campaigns";

export const ADMIN_PERMS: Record<AdminPerm, AdminRole[]> = {
  leads: ["super_admin", "admin", "agent"],
  "people.read": ["super_admin", "admin", "agent", "finance"],
  "people.write": ["super_admin", "admin", "agent"],
  approvals: ["super_admin", "admin"],
  "projects.read": ["super_admin", "admin", "agent", "finance"],
  "projects.write": ["super_admin", "admin", "agent"],
  "finance.read": ["super_admin", "admin", "finance"],
  "finance.write": ["super_admin", "admin", "finance"],
  "plans.write": ["super_admin", "admin", "content"],
  events: ["super_admin", "admin", "content"],
  staff: ["super_admin"],
  settings: ["super_admin", "finance"],
  campaigns: ["super_admin", "admin", "agent", "content"],
};

export type CampaignAudienceKind = "leads" | "affiliates" | "contractors";

export type CampaignStatus =
  | "draft"
  | "scheduled"
  | "sending"
  | "sent"
  | "cancelled"
  | "failed";

export type CampaignTemplateRole =
  | "opener"
  | "reply_1"
  | "reply_2"
  | "reply_3"
  | "reply_4";

export type LeadAudienceTag =
  | "homeowner"
  | "information"
  | "affiliate_lead"
  | "contractor_lead";

export interface CampaignAudienceFilter {
  status?: string | null;
  created_from?: string | null;
  created_to?: string | null;
  event_id?: number | null;
}

export interface CampaignChannels {
  email: boolean;
  sms: boolean;
}

export interface CampaignTemplate {
  id?: number;
  role: CampaignTemplateRole;
  subject_en: string | null;
  subject_es: string | null;
  email_html_en: string | null;
  email_html_es: string | null;
  sms_body_en: string | null;
  sms_body_es: string | null;
}

export interface Campaign {
  id: number;
  name: string;
  audience_kind: CampaignAudienceKind;
  audience_filter: CampaignAudienceFilter;
  channels: CampaignChannels;
  status: CampaignStatus;
  created_by_admin_id: number | null;
  scheduled_at: string | null;
  sent_at: string | null;
  resend_segment_id_en: string | null;
  resend_segment_id_es: string | null;
  resend_broadcast_id_en: string | null;
  resend_broadcast_id_es: string | null;
  stats: Record<string, unknown> | null;
  templates: CampaignTemplate[];
  created_at: string | null;
  updated_at: string | null;
}

export interface CampaignAudiencePreviewRow {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  lang: "en" | "es";
  sms_marketing_consent: boolean;
}

export interface CampaignAudiencePreview {
  total: number;
  email_eligible: number;
  sms_eligible: number;
  sms_skipped_no_consent: number;
  by_lang: { en: number; es: number };
  /** Recipients for review (capped; see sample_truncated). */
  sample: CampaignAudiencePreviewRow[];
  sample_truncated: boolean;
}

export function adminCan(role: AdminRole | undefined, perm: AdminPerm): boolean {
  return Boolean(role && ADMIN_PERMS[perm].includes(role));
}

export type LeadMode = "event" | "standard";

export type EventRegistrationStatus = "confirmed" | "waitlisted";

export type MarketingEventStatus = "draft" | "published" | "archived";

export interface MarketingEvent {
  id: number;
  slug: string;
  status: MarketingEventStatus;
  is_featured: boolean;
  starts_at: string;
  ends_at: string | null;
  registration_opens_at: string | null;
  registration_closes_at: string | null;
  capacity: number | null;
  waitlist_enabled: boolean;
  city: string;
  venue_name: string | null;
  venue_address: string | null;
  zoom_url: string | null;
  image_url: string | null;
  title_en: string;
  title_es: string;
  summary_en: string | null;
  summary_es: string | null;
  body_en: string | null;
  body_es: string | null;
  location_label_en: string | null;
  location_label_es: string | null;
  cta_en: string | null;
  cta_es: string | null;
  created_at: string;
  updated_at: string;
  /** Confirmed RSVP count (admin list/detail). */
  confirmed_count?: number;
  /** Waitlisted RSVP count (admin list/detail). */
  waitlisted_count?: number;
  /** Whether public registration is currently open. */
  registration_open?: boolean;
  /** Scans of the `/e/<slug>` QR short link. */
  qr_scan_count?: number;
  qr_last_scanned_at?: string | null;
  /** RSVPs submitted after a QR scan (`leads.source = 'qr'`; admin detail). */
  qr_rsvp_count?: number;
}

/** `POST /api/public/events/:slug/qr-scan` — where a scanned flyer should land. */
export interface EventQrScanResponse {
  ok: true;
  /** Destination event slug (scanned event, or the next open one once it is over); null → `/events`. */
  slug: string | null;
  /** True when the destination accepts RSVPs (land on `#register`). */
  register: boolean;
  /** Event id the RSVP should be attributed to as `source = 'qr'`. */
  event_id: number | null;
}

/** Public event payload — bilingual fields resolved for the requested lang. */
export interface PublicEventView {
  id: number;
  slug: string;
  city: string;
  starts_at: string;
  ends_at: string | null;
  capacity: number | null;
  waitlist_enabled: boolean;
  confirmed_count: number;
  spots_remaining: number | null;
  registration_open: boolean;
  venue_name: string | null;
  venue_address: string | null;
  zoom_url: string | null;
  image_url: string | null;
  title: string;
  summary: string | null;
  body: string | null;
  location_label: string | null;
  cta: string | null;
  /** True after 11:59 PM Pacific on the event day (ends_at day when set). */
  is_past: boolean;
  /** Cover image: chosen media cover, else image_url. */
  cover_url: string | null;
  media_count: number;
  /** Detail view only: highlights (reel first) + gallery in display order. */
  media?: PublicEventMedia[];
}

export type EventMediaKind = "photo" | "video" | "embed";
export type EventEmbedProvider = "instagram" | "youtube" | "tiktok";

export interface PublicEventMedia {
  id: number;
  kind: EventMediaKind;
  url: string;
  embed_provider: EventEmbedProvider | null;
  caption: string | null;
  is_cover: boolean;
  is_highlight: boolean;
}

/** Admin: both caption languages + storage details. */
export interface AdminEventMedia {
  id: number;
  event_id: number;
  kind: EventMediaKind;
  url: string;
  source_url: string | null;
  embed_provider: EventEmbedProvider | null;
  mime_type: string | null;
  size_bytes: number | null;
  caption_en: string | null;
  caption_es: string | null;
  sort_order: number;
  is_cover: boolean;
  is_highlight: boolean;
  created_at: string;
}

export interface PublicEventsListResponse {
  ok: true;
  tab: "upcoming" | "past";
  events: PublicEventView[];
}

export type ContactIntent =
  | "adu_project"
  | "financing"
  | "partner"
  | "general";

export type ProjectMilestone =
  | "lead"
  | "financing"
  | "contracted"
  | "in_build"
  | "closed"
  | "cancelled";

export interface PortalAuthUser {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  phone?: string | null;
  role?: AdminRole;
  status: string;
  preferred_language: "en" | "es";
  avatar_url?: string | null;
  /** Admin only — Conversations unlocks when a brand Twilio line is assigned. */
  conversations_enabled?: boolean;
  assigned_phone_numbers?: AdminPhoneNumber[];
  voice_available?: boolean;
  call_forwarding_enabled?: boolean;
  call_forwarding_phone?: string | null;
}

export interface PortalOtpRequest {
  email: string;
}

export interface PortalOtpVerifyRequest {
  email: string;
  code: string;
}

export interface PortalAuthResponse {
  ok: true;
  actor: PortalActor;
  user: PortalAuthUser;
}

export interface SubmitLeadRequest {
  full_name: string;
  email: string;
  phone: string;
  property_address: string;
  soft_pull_consent: boolean;
  /** TCPA: required for future campaign SMS (optional on submit; defaults false). */
  sms_marketing_consent?: boolean;
  preferred_language?: "en" | "es";
  mode?: LeadMode;
  event_city?: string | null;
  /** Required when mode=event — server validates the event is open. */
  event_id?: number | null;
  source?: string | null;
  /** Affiliate referral code captured from `?ref=` (attributes the lead). */
  referral_code?: string | null;
}

export interface SubmitLeadResponse {
  ok: true;
  lead_id: number;
  message: string;
  event_registration_status?: EventRegistrationStatus | null;
  /** Optional next-step credit CTA (event RSVP two-step). */
  credit_cta_url?: string | null;
}

export interface SubmitGetCreditReportLeadRequest {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  preferred_language: "en" | "es";
  soft_pull_consent: boolean;
  notes?: string | null;
  referral_code?: string | null;
}

export interface SubmitGetCreditReportLeadResponse {
  ok: true;
  lead_id: number;
  mfsn_url: string;
  short_url: string;
  email_sent: boolean;
  message: string;
}

export interface SubmitContactRequest {
  full_name: string;
  email: string;
  phone: string;
  intent: ContactIntent;
  preferred_language?: "en" | "es";
  sms_transactional_consent: boolean;
  sms_marketing_consent: boolean;
  /** Used when intent=partner (same cookie helper as Partners / leads). */
  referral_code?: string | null;
}

export interface SubmitPartnerReferralRequest {
  full_name: string;
  email: string;
  phone: string;
  company?: string | null;
  notes?: string | null;
  preferred_language?: "en" | "es";
  /** From `/r/:code` cookie / `?ref=` — attributes parent affiliate on the new pending affiliate. */
  referral_code?: string | null;
}

export interface SubmitSimpleLeadResponse {
  ok: true;
  lead_id: number;
  message: string;
}

/** Partners intake creates a pending affiliate (not a lead). */
export interface SubmitPartnerReferralResponse {
  ok: true;
  affiliate_id: number;
  message: string;
}

/** Contact form: normal intents → lead; intent=partner → pending affiliate. */
export type SubmitContactResponse =
  | SubmitSimpleLeadResponse
  | (SubmitPartnerReferralResponse & { kind: "partner_affiliate" });

/** Admin Leads Convert target (Borrower = Client = Homeowner). */
export type LeadConvertTarget = "client" | "affiliate" | "contractor";

export type LeadConvertStatus = "pending" | "active";

export interface ConvertAdminLeadRequest {
  /** Default `client` for backward compatibility. */
  target?: LeadConvertTarget;
  adu_plan_id?: number | null;
  /** Affiliate / contractor confirm dialog. Affiliate defaults toward active; contractor toward pending. */
  status?: LeadConvertStatus;
  /** Required when API returns `errors.phoneLinkConfirmRequired`. */
  confirm_phone_link?: boolean;
  /** Staff confirmation that a phone-only match with another role is a different person (audited). */
  shared_phone_reason?: string;
  /** super_admin: convert a contractor straight to active without prequalification (audited). */
  override_reason?: string;
}

/** One role per person: a client, an affiliate or a contractor (never two). */
export type PersonEntity = "client" | "affiliate" | "contractor";
export type DedupeEntity = "lead" | PersonEntity;

/** Existing record that shares an email or phone (409 `errors.personExists*` → `match`). */
export interface PersonMatch {
  entity: PersonEntity;
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  status: string;
  by: "email" | "phone";
}

export interface DuplicateMember {
  entity: DedupeEntity;
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  status: string;
  created_at: string;
  /** Leads: person this lead already points at. */
  linked?: { entity: PersonEntity; id: number } | null;
  submission_count?: number;
  /** Linked rows a merge would move (projects, commissions, draws, conversations…). */
  links: Record<string, number>;
  /** Present when delete is blocked (non-empty means "resolve these first"). */
  delete_blockers: string[];
}

export interface DuplicateCluster {
  /** Sorted member keys (`client:12|lead:40`) — used for "not duplicates". */
  signature: string;
  kind: "same_role" | "cross_role" | "repeat_leads" | "lead_of_person";
  match_keys: string[];
  members: DuplicateMember[];
}

export interface AdminDuplicatesResponse {
  ok: true;
  clusters: DuplicateCluster[];
  total: number;
}

/** Lead pipeline statuses (leads.status). */
export const LEAD_STATUSES = ["new", "contacted", "qualified", "closed", "spam"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

/**
 * "Move back to Leads" (undo a client conversion). Where the person goes back
 * to depends on where the client came from:
 * - lead: the lead(s) linked to the client return to the Active list
 * - contact: the CRM contact is un-converted (threads move back to it)
 * - unknown: the Conversations unknown contact is reopened (threads move back)
 * - new_lead: client was created directly → a new lead is made from its info
 */
export type ClientRevertOrigin = "lead" | "contact" | "unknown" | "new_lead";
export type ClientRevertBlocker =
  | "portal_used"
  | "projects_in_progress"
  | "contractor_assigned"
  | "commissions"
  | "missing_contact_info";

export interface ClientRevertPlan {
  client_id: number;
  client_name: string;
  origin: ClientRevertOrigin;
  leads: Array<{ id: number; full_name: string; status: LeadStatus }>;
  contact_id: number | null;
  unknown_contact_ids: number[];
  /** Referring affiliate (kept on the lead). */
  affiliate_id: number | null;
  /** What moves / is removed (counts). */
  counts: { conversations: number; projects: number; notes: number; invites: number };
  blockers: ClientRevertBlocker[];
}

export interface ClientRevertResponse {
  ok: true;
  dry_run: boolean;
  plan: ClientRevertPlan;
  /** Where the person lives now (after a real revert). */
  result: { lead_id: number | null; contact_id: number | null; unknown_contact_id: number | null } | null;
}

export interface LeadConvertPhoneMatch {
  entity: "client" | "affiliate" | "contractor";
  id: number;
  email: string;
  name: string;
}

export interface ConvertAdminLeadResponse {
  ok: true;
  target: LeadConvertTarget;
  client_id?: number;
  project_public_id?: string;
  affiliate_id?: number;
  contractor_id?: number;
  invite_sent?: boolean;
}

export interface ApiErrorResponse {
  error: string;
  message?: string;
}

export interface HealthResponse {
  ok: true;
  service: string;
  time: string;
}

// ─── Portal feature layer ────────────────────────────────────────────────────

export type LoanStatus =
  | "not_started"
  | "in_process"
  | "underwriting"
  | "approved"
  | "finalized"
  | "denied"
  | "withdrawn";

export type LoanLenderType = "anchor" | "external" | "unknown";
export type DrawStatus = "draft" | "submitted" | "approved" | "rejected" | "paid";
export type CommissionStatus = "pending" | "approved" | "paid" | "void";
export type ContractStatus = "draft" | "generated" | "sent" | "signed" | "void";
export type ContractKind = "contractor_client" | "affiliate_terms" | "other";

export const MILESTONES: ProjectMilestone[] = [
  "lead",
  "financing",
  "contracted",
  "in_build",
  "closed",
];

/** Full board columns including cancelled (list tracker omits cancelled). */
export const BOARD_MILESTONES: ProjectMilestone[] = [
  ...MILESTONES,
  "cancelled",
];

/**
 * Allowed project milestone moves — keep in sync with `api/index.ts`
 * `MILESTONE_TRANSITIONS` (API cannot runtime-import shared).
 */
export const MILESTONE_TRANSITIONS: Record<
  ProjectMilestone,
  readonly ProjectMilestone[]
> = {
  lead: ["financing", "contracted", "cancelled"],
  financing: ["lead", "contracted", "cancelled"],
  contracted: ["financing", "in_build", "cancelled"],
  in_build: ["contracted", "closed", "cancelled"],
  closed: ["in_build"],
  cancelled: ["lead"],
};

export function canTransitionMilestone(
  from: ProjectMilestone,
  to: ProjectMilestone,
): boolean {
  if (from === to) return true;
  return MILESTONE_TRANSITIONS[from]?.includes(to) ?? false;
}

export type MilestoneMoveDirection =
  | "forward"
  | "back"
  | "jump-forward"
  | "jump-back"
  | "same"
  | "cancel"
  | "restore";

/** Direction of a milestone move for confirm copy (pipeline order ignores cancelled). */
export function getMilestoneMoveDirection(
  from: ProjectMilestone,
  to: ProjectMilestone,
): MilestoneMoveDirection {
  if (from === to) return "same";
  if (to === "cancelled") return "cancel";
  if (from === "cancelled") return "restore";
  const fromIdx = MILESTONES.indexOf(from);
  const toIdx = MILESTONES.indexOf(to);
  if (fromIdx < 0 || toIdx < 0) return "same";
  const delta = toIdx - fromIdx;
  if (delta === 1) return "forward";
  if (delta === -1) return "back";
  if (delta > 1) return "jump-forward";
  return "jump-back";
}

export interface AdminProjectBoardColumn {
  items: AdminProject[];
  total: number;
  offset: number;
  limit: number;
  has_more: boolean;
}

export interface AdminProjectBoardResponse {
  ok: true;
  q: string;
  limit: number;
  filters: {
    affiliate_id: number | null;
    contractor_id: number | null;
    assigned_admin_id: number | null;
    loan_status: string | null;
  };
  columns: Record<ProjectMilestone, AdminProjectBoardColumn>;
}

export interface AdminProjectBoardColumnPage {
  ok: true;
  milestone: ProjectMilestone;
  q: string;
  items: AdminProject[];
  total: number;
  offset: number;
  limit: number;
  has_more: boolean;
}

export interface AduPlan {
  id: number;
  code: string;
  name: string;
  bedrooms: number;
  bathrooms: string | number;
  stories: number;
  sq_ft: number;
  default_commission_cents: number;
  layout_image_url: string | null;
  exterior_image_url: string | null;
  description: string | null;
  is_active: number;
  sort_order: number;
}

export interface MilestoneEvent {
  id: number;
  from_milestone: string | null;
  to_milestone: string;
  changed_by_type: string;
  note: string | null;
  created_at: string;
}

export interface ProjectPhoto {
  id: number;
  project_id?: number;
  storage_url: string;
  caption: string | null;
  taken_at: string | null;
  created_at: string;
  project_public_id?: string;
  property_address?: string | null;
}

export interface ProjectDraw {
  id: number;
  project_id: number;
  amount_cents: number;
  status: DrawStatus;
  note: string | null;
  reviewed_at: string | null;
  paid_at: string | null;
  created_at: string;
  project_public_id?: string;
  property_address?: string | null;
  contractor_name?: string | null;
}

export interface ProjectContract {
  id: number;
  project_id: number;
  kind: ContractKind;
  status: ContractStatus;
  storage_url: string | null;
  payload_json?: Record<string, unknown> | null;
  generated_at: string | null;
  signed_at: string | null;
  created_at: string;
  project_public_id?: string;
}

/** Shape returned to admins; finance fields are omitted without `finance.read`. */
export interface AdminProject {
  id: number;
  public_id: string;
  client_id: number;
  lead_id: number | null;
  affiliate_id: number | null;
  contractor_id: number | null;
  assigned_admin_id: number | null;
  adu_plan_id: number | null;
  milestone: ProjectMilestone;
  milestone_changed_at: string | null;
  property_address: string | null;
  property_city: string | null;
  property_state: string | null;
  property_zip: string | null;
  sq_ft: number | null;
  loan_lender_type: LoanLenderType;
  loan_lender_name: string | null;
  /** Lenders directory link (loan_lender_name kept in sync). */
  lender_id?: number | null;
  loan_status: LoanStatus;
  loan_finalized_at: string | null;
  anchor_external_id: string | null;
  anchor_last_synced_at: string | null;
  commission_expected_pay_at: string | null;
  commission_paid_at: string | null;
  notes: string | null;
  created_at: string;
  client_name: string;
  client_email: string;
  affiliate_name: string | null;
  contractor_name: string | null;
  plan_name: string | null;
  sale_price_cents?: number | null;
  contractor_cost_cents?: number | null;
  affiliate_commission_cents?: number | null;
  agent_commission_cents?: number | null;
  net_profit_cents?: number | null;
  net_profit_per_sqft_cents?: number | null;
  commission_override_cents?: number | null;
  /** Frozen at first loan finalize; unpaid recalcs use these, not live Settings. */
  commission_rate_direct_cents_per_sqft?: number | null;
  commission_rate_closer_cents_per_sqft?: number | null;
  commission_rate_parent_cents_per_sqft?: number | null;
  client_deal_status_id?: number | null;
  deal_status_en?: string | null;
  deal_status_es?: string | null;
  deal_status_tone?: DealStatusTone | null;
}

export interface AdminProjectDetail {
  project: AdminProject;
  photos: ProjectPhoto[];
  draws: ProjectDraw[];
  contracts: ProjectContract[];
  events: MilestoneEvent[];
  /** Primary row (direct/closer); kept for older UI. Prefer `commissions` for splits. */
  commission: AdminCommission | null;
  /** All commission rows for the project (direct and/or closer + parent). */
  commissions?: AdminCommission[];
}

export interface AdminCommission {
  id: number;
  affiliate_id: number;
  role?: AffiliateCommissionRole;
  project_id: number;
  amount_cents: number;
  sq_ft: number | null;
  rate_cents_per_sqft: number | null;
  status: CommissionStatus;
  expected_pay_at: string | null;
  paid_at: string | null;
  notes: string | null;
  created_at: string;
  affiliate_name?: string;
  affiliate_email?: string;
  project_public_id?: string;
  client_name?: string;
}

export interface AdminLead {
  id: number;
  full_name: string;
  email: string;
  phone: string;
  property_address: string | null;
  mode: LeadMode;
  event_city: string | null;
  event_id: number | null;
  event_registration_status: EventRegistrationStatus | null;
  event_title?: string | null;
  source: string | null;
  audience_tag?: string | null;
  affiliate_id: number | null;
  affiliate_name: string | null;
  client_id: number | null;
  converted_affiliate_id?: number | null;
  converted_contractor_id?: number | null;
  referral_code: string | null;
  notes: string | null;
  status: LeadStatus;
  /** Public submissions merged into this lead (repeat forms). */
  submission_count?: number;
  last_submitted_at?: string | null;
  created_at: string;
  /** Latest SMS / call with this lead's phone (any Groundwork line), or null. */
  last_sms?: LeadTouch | null;
  last_call?: LeadTouch | null;
}

/** Last text or call with a lead, matched by phone (last 10 digits). */
export interface LeadTouch {
  at: string;
  direction: "inbound" | "outbound";
  /** SMS: first ~80 chars of the body. */
  preview?: string | null;
  /** Calls: seconds connected (null/0 → missed / not answered). */
  duration_sec?: number | null;
  status?: string | null;
  /** Conversations thread to open. */
  thread: { kind: "client" | "contact" | "unknown"; id: number } | null;
}

/** Leads list scope: `active` = not yet a client/affiliate/contractor (and not spam). */
export type LeadListView = "active" | "converted" | "all";

/** Conversations search hit for a lead not yet linked to a thread contact. */
export interface ConversationLeadMatch {
  lead_id: number;
  full_name: string;
  email: string;
  phone: string;
  status: AdminLead["status"];
  /** Open unknown-number thread for this phone, if any. */
  unknown_contact_id: number | null;
  /** Client already linked (lead converted) — open that thread instead. */
  client_id: number | null;
}

export interface AdminAffiliate {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  company: string | null;
  status: "pending" | "active" | "inactive" | "suspended";
  referral_code: string;
  slug: string | null;
  notes: string | null;
  preferred_language?: "en" | "es";
  avatar_url?: string | null;
  bio?: string | null;
  parent_affiliate_id?: number | null;
  parent_name?: string | null;
  sub_count?: number;
  approved_at: string | null;
  last_login_at: string | null;
  created_at: string;
  click_count: number;
  client_count: number;
}

export interface PublicAffiliateCard {
  first_name: string;
  last_name: string;
  company: string | null;
  avatar_url: string | null;
  bio: string | null;
  referral_code: string;
  slug: string | null;
  initials: string;
}

export interface PublicAffiliateByCodeResponse {
  ok: true;
  affiliate: PublicAffiliateCard;
  landing: string;
}

export interface EnrollRequest {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  property_address: string;
  property_city?: string | null;
  property_zip?: string | null;
  adu_plan_id?: number | null;
  preferred_language: "en" | "es";
  soft_pull_consent?: boolean;
  homeowner_consent: boolean;
  referral_code?: string | null;
}

export type EnrollOutcome =
  /** New lead + client + project; portal magic link emailed. */
  | "created"
  /** Already a (not yet active) homeowner: fresh portal link emailed. */
  | "invite_resent"
  /** Email/phone already on file (active homeowner or another role); staff alerted. */
  | "exists";

export interface EnrollResponse {
  ok: true;
  outcome: EnrollOutcome;
  project_public_id: string | null;
  invite_sent: boolean;
}

export interface ClientInvitePreview {
  ok: true;
  email: string;
  first_name: string;
}

export interface AffiliateProfile extends PortalAuthUser {
  company: string | null;
  referral_code: string;
  slug: string | null;
  bio: string | null;
}

export interface AdminContractor {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  company: string | null;
  license_number: string | null;
  status: "pending" | "invited" | "active" | "inactive" | "suspended";
  notes: string | null;
  activated_at: string | null;
  last_login_at: string | null;
  created_at: string;
  project_count: number;
  /** Prequalification (null = never sent). */
  application_status: ContractorApplicationStatus | null;
  application_number: string | null;
  application_submitted_at: string | null;
  application_due_at: string | null;
}

export interface AdminClient {
  id: number;
  email: string | null;
  first_name: string;
  last_name: string;
  phone: string | null;
  status: "pending" | "prospect" | "active" | "inactive" | "suspended";
  preferred_language: "en" | "es";
  address_line1: string | null;
  city: string | null;
  zip: string | null;
  affiliate_id: number | null;
  affiliate_name: string | null;
  assigned_admin_id: number | null;
  admin_notes: string | null;
  last_login_at: string | null;
  created_at: string;
  project_count: number;
  deal_status_id?: number | null;
  deal_status_changed_at?: string | null;
  deal_status_en?: string | null;
  deal_status_es?: string | null;
  deal_status_tone?: DealStatusTone | null;
}

export interface AdminStaff {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  role: AdminRole;
  status: "active" | "inactive" | "suspended";
  last_login_at: string | null;
  created_at: string;
}

export interface AdminDashboard {
  leads_new: number;
  affiliates_pending: number;
  clients_pending: number;
  contractors_pending: number;
  contractors_invited: number;
  draws_submitted: number;
  draws_submitted_cents: number;
  projects_by_milestone: Record<string, number>;
  finance?: {
    commissions_pending_cents: number;
    commissions_approved_cents: number;
    commissions_paid_cents: number;
    projects_closed: number;
    net_profit_closed_cents: number;
    avg_net_profit_per_sqft_cents: number | null;
  };
}

export interface CommissionSettings {
  commission_payout_days_after_loan_close: number;
  /** @deprecated Alias of commission_direct_cents_per_sqft */
  commission_cents_per_sqft: number;
  commission_direct_cents_per_sqft: number;
  commission_closer_cents_per_sqft: number;
  commission_parent_cents_per_sqft: number;
  /** Sponsor share when a Senior Sponsor also earns (two-level plan). */
  commission_parent_shared_cents_per_sqft?: number;
  /** Senior Sponsor share (two-level plan). */
  commission_grandparent_cents_per_sqft?: number;
}

export type AffiliateCommissionRole = "direct" | "closer" | "parent" | "grandparent";

export interface AffiliateTeamMember {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  company: string | null;
  status: string;
  referral_code: string;
  slug: string | null;
  tracking_url: string;
  client_count: number;
  commission_cents: number;
  last_login_at: string | null;
  created_at: string;
}

export interface AdminNotifyExtraEmail {
  id: number;
  email: string;
  label: string | null;
  is_active: boolean;
  /** null = all event types; else selected AdminNotifyEventKey values */
  events: AdminNotifyEventKey[] | null;
  created_at: string;
}

export interface AffiliateOverview {
  affiliate: {
    referral_code: string;
    slug: string | null;
    tracking_url: string;
    company: string | null;
    first_name: string;
    last_name: string;
    avatar_url: string | null;
    bio: string | null;
    parent_affiliate_id?: number | null;
    /** Top-level affiliates can invite/manage sub-affiliates. */
    can_manage_team?: boolean;
  };
  stats: {
    clicks: number;
    leads: number;
    clients: number;
    in_process: number;
    closed: number;
    commission_pending_cents: number;
    commission_approved_cents: number;
    commission_paid_cents: number;
    payout_days: number;
  };
}

/** Simplified milestone view — never includes loan detail (decision 8B). */
export interface AffiliateClientRow {
  public_id: string;
  milestone: ProjectMilestone;
  milestone_changed_at: string | null;
  property_city: string | null;
  plan_name: string | null;
  sq_ft: number | null;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  commission_cents: number | null;
  commission_status: CommissionStatus | null;
  expected_pay_at: string | null;
  created_at: string;
  client_id?: number;
  deal_status_en?: string | null;
  deal_status_es?: string | null;
  deal_status_tone?: DealStatusTone | null;
  deal_status_changed_at?: string | null;
  /** Updates staff shared with the affiliate (newest first, up to 5). */
  updates?: Array<Pick<ClientUpdate, "id" | "kind" | "body" | "deal_status_label_en" | "deal_status_label_es" | "created_at">>;
}

export interface AffiliateCommissionRow {
  id: number;
  role?: AffiliateCommissionRole;
  project_public_id: string;
  client_name: string;
  amount_cents: number;
  sq_ft: number | null;
  rate_cents_per_sqft?: number | null;
  status: CommissionStatus;
  expected_pay_at: string | null;
  paid_at: string | null;
  created_at: string;
}

export interface RegisterClientRequest {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  property_address: string;
  property_city?: string | null;
  property_zip?: string | null;
  adu_plan_id?: number | null;
  preferred_language?: "en" | "es";
  homeowner_consent: boolean;
}

export interface AffiliateSignupRequest {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  company?: string | null;
  preferred_language?: "en" | "es";
}

export type PortalSignupOutcome =
  | "created"
  | "resent"
  | "invite_resent"
  | "ready"
  /** Email/phone already belongs to another Groundwork record (one role per person). */
  | "exists";

export interface PortalSignupResponse {
  ok: true;
  outcome: PortalSignupOutcome;
  message?: string;
}

export interface ClientSignupRequest {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  address_line1?: string | null;
  city?: string | null;
  zip?: string | null;
  preferred_language?: "en" | "es";
}

export interface ContractorSignupRequest {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  company?: string | null;
  preferred_language?: "en" | "es";
}

export interface ContractorProjectRow {
  public_id: string;
  milestone: ProjectMilestone;
  property_address: string | null;
  property_city: string | null;
  property_zip: string | null;
  sq_ft: number | null;
  plan_name: string | null;
  client_name: string;
  client_phone: string | null;
  budget_cents: number | null;
  drawn_cents: number;
  photo_count: number;
  created_at: string;
}

export interface ContractorProjectDetail {
  project: ContractorProjectRow;
  photos: ProjectPhoto[];
  draws: ProjectDraw[];
  contracts: ProjectContract[];
}

export interface ClientProjectView {
  public_id: string;
  milestone: ProjectMilestone;
  milestone_changed_at: string | null;
  loan_status: LoanStatus;
  property_address: string | null;
  property_city: string | null;
  sq_ft: number | null;
  plan: Pick<
    AduPlan,
    | "name"
    | "bedrooms"
    | "bathrooms"
    | "stories"
    | "sq_ft"
    | "exterior_image_url"
    | "layout_image_url"
  > | null;
  contractor_name: string | null;
  events: MilestoneEvent[];
  photos: ProjectPhoto[];
}

export interface ClientOverview {
  projects: ClientProjectView[];
}

export interface ClientDocument {
  id: number;
  project_public_id: string;
  kind: ContractKind;
  status: ContractStatus;
  storage_url: string | null;
  generated_at: string | null;
  signed_at: string | null;
}

export type PublicAduPlan = Pick<
  AduPlan,
  | "id"
  | "code"
  | "name"
  | "bedrooms"
  | "bathrooms"
  | "stories"
  | "sq_ft"
  | "layout_image_url"
  | "exterior_image_url"
  | "description"
>;

export interface ContractorInvitePreview {
  ok: true;
  email: string;
  first_name: string;
  company: string | null;
}

// ── Affiliate onboarding (agreement e-sign + W-9) ───────────────────────────

export type AffiliateW9Status = "missing" | "submitted" | "accepted" | "rejected";
export type W9TaxClassification =
  | "individual"
  | "c_corp"
  | "s_corp"
  | "partnership"
  | "trust_estate"
  | "llc"
  | "other";

export interface AffiliateOnboardingState {
  /** Monthly platform price in the agreement; null = pending (cannot sign yet). */
  subscription_price_cents: number | null;
  agreement_signed: boolean;
  agreement_signed_at: string | null;
  agreement_version: number | null;
  /** Signed an older version than the one published now (asked to re-sign). */
  agreement_outdated: boolean;
  agreement_current_version: number | null;
  w9_status: AffiliateW9Status;
  /** Card on file with an active (or free-period) platform subscription. */
  billing_ready: boolean;
  /** Signed agreement + W-9 on file (not rejected) + active subscription — required before payouts. */
  payout_ready: boolean;
}

export type AffiliateBillingStatus = "none" | "trialing" | "active" | "past_due" | "canceled" | "incomplete";

/** Platform subscription (card on file → free period → monthly). */
export interface AffiliateBilling {
  configured: boolean;
  status: AffiliateBillingStatus;
  price_cents: number | null;
  trial_days: number;
  trial_ends_at: string | null;
  current_period_end: string | null;
  card: { brand: string | null; last4: string; exp: string | null } | null;
  cancel_at_period_end: boolean;
  /** Card saved; the plan (and its free period) starts when Groundwork approves. */
  awaiting_approval: boolean;
  /** Staff waived the fee (price 0). */
  waived: boolean;
  /** Approved: saving a card starts the plan right away. */
  approved: boolean;
  /** Billing is in good standing or not required (portal locks use this). */
  in_good_standing: boolean;
  /** The card on file expires within 30 days. */
  card_expiring: boolean;
}

/** Same shape for every paying role (affiliates, contractors). */
export type PlatformBilling = AffiliateBilling;

export type BillingRole = "affiliate" | "contractor";

export interface AdminBillingRow {
  role: BillingRole;
  id: number;
  name: string;
  email: string;
  company: string | null;
  member_status: string;
  billing: PlatformBilling;
  locked: boolean;
}

export interface AdminBillingOverview {
  ok: true;
  configured: boolean;
  totals: {
    mrr_cents: number;
    active: number;
    trialing: number;
    past_due: number;
    paused: number;
    trials_ending_7d: number;
    awaiting_approval: number;
    canceling: number;
  };
  members: AdminBillingRow[];
}

export interface BillingInvoice {
  id: string;
  number: string | null;
  created: string;
  period_start: string | null;
  period_end: string | null;
  status: string;
  amount_due: number;
  amount_paid: number;
  amount_refunded: number;
  refundable: boolean;
  hosted_url: string | null;
  pdf_url: string | null;
  receipt_url: string | null;
}

export interface BillingAdminAction {
  id: number;
  action: string;
  reason: string | null;
  detail: Record<string, unknown>;
  created_at: string | null;
  admin_name: string | null;
}

export interface AdminMembership {
  ok: true;
  member: { role: BillingRole; id: number; name: string; email: string; phone: string | null; company: string | null; status: string };
  billing: PlatformBilling;
  locked: boolean;
  invoices: BillingInvoice[];
  actions: BillingAdminAction[];
  open_link: { price_cents: number | null; free_days: number | null; expires_at: string | null; created_at: string | null } | null;
}

export interface BillingCardLinkView {
  ok: true;
  member: { first_name: string; last_name: string; email: string; role: BillingRole };
  billing: PlatformBilling;
  expires_at: string | null;
}

/** Contractor portal: membership + whether the portal is locked to the billing page. */
export interface ContractorBillingResponse {
  ok: true;
  billing: PlatformBilling;
  locked: boolean;
}

export interface AffiliateFaq {
  id: number;
  question_en: string;
  answer_en: string;
  question_es: string | null;
  answer_es: string | null;
  sort_order: number;
  is_active: boolean;
  updated_at: string | null;
}

export type AffiliateFaqBody = Pick<AffiliateFaq, "question_en" | "answer_en"> &
  Partial<Pick<AffiliateFaq, "question_es" | "answer_es" | "sort_order" | "is_active">>;

export interface AffiliateAssistantMessage {
  id: number;
  role: "user" | "assistant";
  content: string;
  handoff: boolean;
  created_at: string | null;
}

export interface AffiliateOnboardingResponse {
  ok: true;
  state: AffiliateOnboardingState;
  affiliate: {
    first_name: string;
    last_name: string;
    email: string;
    phone: string | null;
    company: string | null;
    status: string;
  };
  template: { version: number; body: string; body_en: string };
  sponsor_name: string | null;
  senior_sponsor_name: string | null;
  agreement: {
    id: number;
    version: number;
    lang: string;
    legal_name: string;
    business_name: string | null;
    signed_at: string | null;
  } | null;
  w9: {
    id: number;
    status: AffiliateW9Status;
    legal_name: string;
    tin_type: "ssn" | "ein";
    tin_last4: string;
    review_note: string | null;
    signed_at: string | null;
  } | null;
  blank_w9_url: string;
  /** Program presentation (welcome step). */
  presentation_url: string | null;
  billing: AffiliateBilling;
}

export interface AffiliateAgreementSignBody {
  version: number;
  lang: "en" | "es";
  legal_name: string;
  business_name?: string | null;
  title?: string | null;
  address: string;
  phone?: string | null;
  signature_image: string;
  consent: true;
}

export interface AffiliateW9Body {
  legal_name: string;
  business_name?: string | null;
  tax_classification: W9TaxClassification;
  llc_tax_class?: "C" | "S" | "P" | null;
  other_classification?: string | null;
  foreign_partners?: boolean;
  exempt_payee_code?: string | null;
  fatca_code?: string | null;
  address: string;
  city_state_zip: string;
  tin_type: "ssn" | "ein";
  tin: string;
  signature_image: string;
  certify: true;
  lang?: "en" | "es";
}

export interface AdminAffiliateOnboarding {
  ok: true;
  state: AffiliateOnboardingState;
  sponsor_name: string | null;
  senior_sponsor_name: string | null;
  agreements: Array<{
    id: number;
    template_version: number;
    lang: string;
    status: "signed" | "void";
    legal_name: string;
    business_name: string | null;
    title: string | null;
    address: string;
    phone: string | null;
    email: string;
    subscription_price_cents: number;
    sponsor_name: string | null;
    signed_at: string | null;
    signed_ip: string | null;
    voided_at: string | null;
    void_reason: string | null;
  }>;
  w9s: Array<{
    id: number;
    status: Exclude<AffiliateW9Status, "missing">;
    legal_name: string;
    business_name: string | null;
    tax_classification: W9TaxClassification;
    llc_tax_class: string | null;
    tin_type: "ssn" | "ein";
    tin_last4: string;
    address: string;
    city_state_zip: string;
    signed_at: string | null;
    reviewed_at: string | null;
    review_note: string | null;
  }>;
}

export interface AffiliateAgreementTemplateResponse {
  ok: true;
  template: { version: number; body_en: string; body_es: string; published_at: string | null };
  signed_count: number;
}

// ── Scheduler (appointments, lenders, booking links) ────────────────────────

export const APPOINTMENT_KINDS = ["property_inspection", "site_visit", "lender_meeting", "consultation", "call", "other"] as const;
export type AppointmentKind = (typeof APPOINTMENT_KINDS)[number];
export const APPOINTMENT_LOCATION_TYPES = ["onsite", "office", "phone", "video"] as const;
export type AppointmentLocationType = (typeof APPOINTMENT_LOCATION_TYPES)[number];
export type AppointmentStatus = "scheduled" | "cancelled" | "completed" | "no_show";
export type AppointmentAttendeeKind = "admin" | "contractor" | "lender" | "homeowner" | "guest";

export interface AppointmentAttendee {
  id: number;
  kind: AppointmentAttendeeKind;
  admin_id: number | null;
  contractor_id: number | null;
  lender_id: number | null;
  name: string | null;
  email?: string | null;
  phone?: string | null;
  notified_at?: string | null;
}

export interface Appointment {
  id: number;
  title: string;
  kind: AppointmentKind;
  starts_at: string;
  ends_at: string;
  timezone: string;
  location_type: AppointmentLocationType;
  location: string | null;
  video_url: string | null;
  description: string | null;
  /** Internal (staff only). */
  notes?: string | null;
  status: AppointmentStatus;
  source: "staff" | "booking";
  notify_homeowner: boolean;
  client_id: number | null;
  client_name: string | null;
  lead_id: number | null;
  lead_name: string | null;
  project_id: number | null;
  project_public_id: string | null;
  owner_admin_id: number | null;
  owner_name: string | null;
  cancelled_reason: string | null;
  attendees: AppointmentAttendee[];
}

export type AppointmentAttendeeInput =
  | { kind: "admin"; admin_id: number }
  | { kind: "contractor"; contractor_id: number }
  | { kind: "lender"; lender_id: number }
  | { kind: "guest"; name: string; email?: string | null; phone?: string | null; preferred_language?: "en" | "es" };

export interface AppointmentBody {
  title?: string;
  kind: AppointmentKind;
  /** Local date + time in `timezone`. */
  date: string;
  start: string;
  duration_minutes: number;
  timezone?: string;
  location_type: AppointmentLocationType;
  location?: string | null;
  video_url?: string | null;
  description?: string | null;
  notes?: string | null;
  client_id?: number | null;
  lead_id?: number | null;
  project_id?: number | null;
  owner_admin_id?: number | null;
  notify_homeowner: boolean;
  attendees: AppointmentAttendeeInput[];
}

export interface AppointmentConflict {
  id: number;
  title: string;
  starts_at: string | null;
  ends_at: string | null;
}

/** Affiliate portal view: referred clients only, no address / notes. */
export interface AffiliateAppointment {
  id: number;
  kind: AppointmentKind;
  starts_at: string;
  ends_at: string;
  timezone: string;
  status: AppointmentStatus;
  client_name: string;
}

export interface Lender {
  id: number;
  company: string;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  preferred_language: "en" | "es";
  notes: string | null;
  is_active: boolean;
  project_count: number;
}

export type LenderBody = Pick<Lender, "company"> &
  Partial<Pick<Lender, "contact_name" | "email" | "phone" | "preferred_language" | "notes" | "is_active">>;

export interface SchedulerAvailability {
  day_of_week: number;
  start_time: string;
  end_time: string;
}

export interface SchedulerSettings {
  admin_id: number;
  is_enabled: boolean;
  slug: string;
  title_en: string;
  title_es: string;
  description_en: string | null;
  description_es: string | null;
  kind: AppointmentKind;
  duration_minutes: number;
  buffer_minutes: number;
  advance_days: number;
  min_notice_hours: number;
  timezone: string;
  allow_phone: boolean;
  allow_video: boolean;
  allow_office: boolean;
  allow_onsite: boolean;
  video_url: string | null;
  availability: SchedulerAvailability[];
}

export interface SchedulerResponse {
  ok: true;
  settings: SchedulerSettings;
  booking_url: string;
  blocked?: Array<{ id: number; starts_at: string | null; ends_at: string | null; label: string | null }>;
}

export interface PublicBookingInfo {
  ok: true;
  host: { name: string; avatar_url: string | null };
  title: string;
  description: string | null;
  duration_minutes: number;
  timezone: string;
  advance_days: number;
  location_types: AppointmentLocationType[];
  days: number[];
}

export interface PublicAppointmentView {
  ok: true;
  appointment: {
    title: string;
    kind: AppointmentKind;
    starts_at: string;
    ends_at: string;
    timezone: string;
    location_type: AppointmentLocationType;
    location: string | null;
    video_url: string | null;
    status: AppointmentStatus;
    host: string | null;
  };
  reschedule_slug: string | null;
}

/** Affiliate portal → my link (EN/ES URLs, short display, stats, link-name rule). */
export interface AffiliateLinkInfo {
  ok: true;
  slug: string | null;
  referral_code: string;
  urls: { en: string; es: string };
  display: string;
  /** Next allowed self-service name change (ISO), or null when allowed now. */
  can_change_slug_at: string | null;
  stats: { clicks_total: number; clicks_7d: number; leads: number; clients: number };
}

/** Staff dashboard (command center): sections are filtered by the viewer's role. */
export interface CommandCenterInboxItem {
  key: string;
  count: number;
  to: string;
  tone: "alert" | "warn" | "info";
  amount_cents?: number;
}
export interface CommandCenter {
  ok: true;
  role: AdminRole;
  generated_at: string;
  inbox: CommandCenterInboxItem[];
  appointments: { id: number; title: string; starts_at: string | null; kind: string; location_type: string; owner: string | null }[];
  money: null | {
    mrr_cents: number;
    commissions: { pending: number; approved: number; paid: number };
    pipeline: { milestone: string; count: number; value_cents: number }[];
    closed: { count: number; net_cents: number };
  };
  activity: { kind: string; at: string; title: string; detail?: string | null; to?: string | null }[];
  trends: null | {
    weeks: { start: string; leads: number; clients: number; contracted: number; closed: number; affiliates: number; contractors: number }[];
    funnel: { leads: number; clients: number; contracted: number; closed: number };
    sources: { source: string; count: number }[];
    events: { id: number; title: string; starts_at: string | null; rsvps: number }[];
  };
}

/** Staff record search (appointment "who is this for" and other pickers). */
export interface RecordSearchResults {
  clients: { id: number; name: string; email: string | null; phone: string | null; city: string | null; status: string }[];
  leads: { id: number; name: string; email: string | null; phone: string | null; address: string | null; status: string }[];
  projects: { id: number; public_id: string; client_id: number | null; client_name: string; address: string | null; milestone: string }[];
}
export type RecordRef = { kind: "client" | "lead" | "project"; id: number; label: string; sub?: string | null };

/** What erasing a person removes (confirm modal). */
export interface ErasePreview {
  ok: true;
  person: { entity: "client" | "affiliate" | "contractor"; id: number; name: string; email: string | null; status: string };
  counts: Record<string, number>;
  kept: Record<string, number>;
  subscription: boolean;
  card_on_file: boolean;
  files: number;
}
