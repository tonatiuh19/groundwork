/** Shared API contracts — import type only from api/index.ts */

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
  | "draw_submitted"
  | "lead_converted"
  | "client_created"
  | "milestone_changed"
  | "commission_accrued"
  | "contract_sent";

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
  | "settings";

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
};

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
}

export interface SubmitPartnerReferralRequest {
  full_name: string;
  email: string;
  phone: string;
  company?: string | null;
  notes?: string | null;
  preferred_language?: "en" | "es";
}

export interface SubmitSimpleLeadResponse {
  ok: true;
  lead_id: number;
  message: string;
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
}

export interface AdminProjectDetail {
  project: AdminProject;
  photos: ProjectPhoto[];
  draws: ProjectDraw[];
  contracts: ProjectContract[];
  events: MilestoneEvent[];
  commission: AdminCommission | null;
}

export interface AdminCommission {
  id: number;
  affiliate_id: number;
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
  affiliate_id: number | null;
  affiliate_name: string | null;
  client_id: number | null;
  referral_code: string | null;
  notes: string | null;
  status: "new" | "contacted" | "qualified" | "closed" | "spam";
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

export interface EnrollResponse {
  ok: true;
  project_public_id: string;
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
  status: "invited" | "active" | "inactive" | "suspended";
  notes: string | null;
  activated_at: string | null;
  last_login_at: string | null;
  created_at: string;
  project_count: number;
}

export interface AdminClient {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  status: "prospect" | "active" | "inactive" | "suspended";
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
  commission_cents_per_sqft: number;
}

export interface AdminNotifyExtraEmail {
  id: number;
  email: string;
  label: string | null;
  is_active: boolean;
  events_json: string | null;
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
  project_public_id: string;
  client_name: string;
  amount_cents: number;
  sq_ft: number | null;
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
