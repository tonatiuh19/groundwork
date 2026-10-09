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
  created_by_admin_id?: number | null;
  created_at?: string;
  updated_at?: string;
}

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
  status: "new" | "contacted" | "qualified" | "closed" | "spam";
  /** Public submissions merged into this lead (repeat forms). */
  submission_count?: number;
  last_submitted_at?: string | null;
  created_at: string;
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
}

export type AffiliateCommissionRole = "direct" | "closer" | "parent";

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
