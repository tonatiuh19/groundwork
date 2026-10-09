/**
 * ADU Contractor Prequalification Application — shared catalog.
 *
 * Types are `import type`d by the API; the runtime catalog + requirement rules
 * are used by the client wizard. `api/index.ts` keeps an inline mirror (Vercel
 * single-bundle rule) and `api/contractorApplication.test.ts` asserts parity.
 */

export type ContractorApplicationStatus =
  | "draft"
  | "submitted"
  | "in_review"
  | "needs_info"
  | "approved"
  | "denied";

export const CONTRACTOR_APPLICATION_STATUSES: ContractorApplicationStatus[] = [
  "draft",
  "submitted",
  "in_review",
  "needs_info",
  "approved",
  "denied",
];

/** Statuses where the contractor may still edit answers / documents. */
export const CONTRACTOR_APPLICATION_EDITABLE: ContractorApplicationStatus[] = [
  "draft",
  "needs_info",
];

export type YesNo = "yes" | "no" | "";

export type ContractorEntityType =
  | "corporation"
  | "llc"
  | "partnership"
  | "sole_proprietor"
  | "";

export type AduProjectType =
  | "detached"
  | "attached"
  | "garage_conversion"
  | "jadu"
  | "prefab_modular"
  | "manufactured";

export const ADU_PROJECT_TYPES: AduProjectType[] = [
  "detached",
  "attached",
  "garage_conversion",
  "jadu",
  "prefab_modular",
  "manufactured",
];

export interface InsurancePolicy {
  carrier: string;
  policy_number: string;
  limits: string;
  expires_on: string;
}

export interface RecentAduProject {
  address: string;
  type_sqft: string;
  contract_value: string;
  completed_on: string;
}

export interface KeyPerson {
  name: string;
  role: string;
  years_experience: string;
  certifications: string;
}

export interface ClientReference {
  name: string;
  project_address: string;
  phone: string;
  email: string;
}

export interface SupplierReference {
  company: string;
  contact_name: string;
  phone: string;
  relationship: string;
}

export interface ContractorApplicationData {
  company: {
    legal_name: string;
    dba: string;
    address: string;
    city: string;
    state: string;
    zip: string;
    contact_name: string;
    contact_title: string;
    phone: string;
    email: string;
    website: string;
    year_established: string;
    entity_type: ContractorEntityType;
    ein: string;
    sos_entity_number: string;
    employee_count: string;
    service_area: string;
  };
  licensing: {
    cslb_license_number: string;
    classifications: string;
    license_expires_on: string;
    qualifier_name: string;
    qualifier_title: string;
    qualifier_status: "active" | "inactive" | "";
    bond_company: string;
    bond_number: string;
    bond_amount: string;
    business_license_numbers: string;
    dir_registration_number: string;
    license_disciplined: YesNo;
    epa_rrp_certified: YesNo;
  };
  insurance: {
    general_liability: InsurancePolicy;
    workers_comp: InsurancePolicy;
    commercial_auto: InsurancePolicy;
    umbrella: InsurancePolicy;
    wc_exempt: YesNo;
    builders_risk_available: YesNo;
  };
  experience: {
    years_building_adus: string;
    adus_completed_3yrs: string;
    typical_value_range: string;
    max_concurrent_projects: string;
    project_types: AduProjectType[];
    recent_projects: RecentAduProject[];
  };
  personnel: KeyPerson[];
  references: {
    clients: ClientReference[];
    suppliers: SupplierReference[];
  };
  financial: {
    bank_name: string;
    bank_contact: string;
    bank_phone: string;
    surety_company: string;
    single_bonding_capacity: string;
    aggregate_bonding_capacity: string;
    revenue_recent_year: string;
    revenue_prior_year: string;
  };
  safety: {
    emr: string;
    osha_recordables_3yrs: string;
    safety_officer: string;
    has_iipp: YesNo;
    osha_citations_3yrs: YesNo;
    lawsuits_5yrs: YesNo;
    cslb_complaints_5yrs: YesNo;
    liens_5yrs: YesNo;
    failed_to_complete: YesNo;
    bankruptcy_7yrs: YesNo;
    disclosure_explanation: string;
  };
  warranty: {
    period: string;
    terms: string;
  };
}

export type ContractorApplicationSection =
  | "company"
  | "licensing"
  | "insurance"
  | "experience"
  | "personnel"
  | "references"
  | "financial"
  | "safety"
  | "warranty";

/** Wizard order: data sections, then documents, then review & sign. */
export const CONTRACTOR_APPLICATION_SECTIONS: ContractorApplicationSection[] = [
  "company",
  "licensing",
  "insurance",
  "experience",
  "personnel",
  "references",
  "financial",
  "safety",
  "warranty",
];

/** Fixed row counts that mirror the paper form. */
export const CPQ_ROWS = {
  recent_projects: 3,
  personnel: 3,
  client_references: 3,
  supplier_references: 2,
} as const;

/** Disclosure questions — any "yes" requires `disclosure_explanation`. */
export const CPQ_DISCLOSURE_KEYS = [
  "osha_citations_3yrs",
  "lawsuits_5yrs",
  "cslb_complaints_5yrs",
  "liens_5yrs",
  "failed_to_complete",
  "bankruptcy_7yrs",
] as const;

// ── Documents ────────────────────────────────────────────────────────────────

export type ContractorApplicationDocType =
  | "cslb_license"
  | "license_bond"
  | "articles_sos"
  | "business_license"
  | "w9"
  | "coi_general_liability"
  | "workers_comp"
  | "coi_auto"
  | "coi_umbrella"
  | "company_profile"
  | "portfolio"
  | "final_inspections"
  | "financial_statements"
  | "bank_reference"
  | "surety_letter"
  | "iipp"
  | "emr_osha"
  | "epa_rrp"
  | "dir_registration"
  | "sample_contract"
  | "warranty_policy"
  | "background_check_authorization"
  | "master_contractor_agreement";

/**
 * `core` = must be uploaded before the contractor can submit.
 * `approval` = may follow after submit, but staff approval requires it.
 */
export type ContractorDocRequirement = "core" | "approval";

export interface ContractorDocSpec {
  key: ContractorApplicationDocType;
  requirement: ContractorDocRequirement;
  /** Expiration date captured with the upload (and tracked for reminders). */
  expires: boolean;
  /** Several files allowed (photos, multiple sign-offs). */
  multiple: boolean;
  /** Hidden from staff without `finance.read`. */
  sensitive: boolean;
  /** Blank template the contractor downloads, signs and uploads. */
  template?: "master_contractor_agreement" | "background_check_authorization";
}

export const CONTRACTOR_DOC_SPECS: ContractorDocSpec[] = [
  { key: "cslb_license", requirement: "core", expires: true, multiple: false, sensitive: false },
  { key: "license_bond", requirement: "core", expires: true, multiple: false, sensitive: false },
  { key: "articles_sos", requirement: "approval", expires: false, multiple: true, sensitive: false },
  { key: "business_license", requirement: "approval", expires: true, multiple: true, sensitive: false },
  { key: "w9", requirement: "core", expires: false, multiple: false, sensitive: true },
  { key: "coi_general_liability", requirement: "core", expires: true, multiple: false, sensitive: false },
  { key: "workers_comp", requirement: "core", expires: true, multiple: false, sensitive: false },
  { key: "coi_auto", requirement: "approval", expires: true, multiple: false, sensitive: false },
  { key: "coi_umbrella", requirement: "approval", expires: true, multiple: false, sensitive: false },
  { key: "company_profile", requirement: "approval", expires: false, multiple: false, sensitive: false },
  { key: "portfolio", requirement: "approval", expires: false, multiple: true, sensitive: false },
  { key: "final_inspections", requirement: "approval", expires: false, multiple: true, sensitive: false },
  { key: "financial_statements", requirement: "approval", expires: false, multiple: true, sensitive: true },
  { key: "bank_reference", requirement: "approval", expires: false, multiple: false, sensitive: true },
  { key: "surety_letter", requirement: "approval", expires: false, multiple: false, sensitive: true },
  { key: "iipp", requirement: "approval", expires: false, multiple: false, sensitive: false },
  { key: "emr_osha", requirement: "approval", expires: false, multiple: true, sensitive: false },
  { key: "epa_rrp", requirement: "approval", expires: true, multiple: false, sensitive: false },
  { key: "dir_registration", requirement: "approval", expires: true, multiple: false, sensitive: false },
  { key: "sample_contract", requirement: "approval", expires: false, multiple: false, sensitive: false },
  { key: "warranty_policy", requirement: "approval", expires: false, multiple: false, sensitive: false },
  {
    key: "background_check_authorization",
    requirement: "core",
    expires: false,
    multiple: false,
    sensitive: true,
    template: "background_check_authorization",
  },
  {
    key: "master_contractor_agreement",
    requirement: "core",
    expires: false,
    multiple: false,
    sensitive: false,
    template: "master_contractor_agreement",
  },
];

/** Upload limits (direct-to-Blob client uploads; not bound by the 4.5MB function body cap). */
export const CPQ_DOC_MAX_BYTES = 25 * 1024 * 1024;
export const CPQ_DOC_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;
export const CPQ_DOC_MAX_FILES_PER_TYPE = 12;

/** Which blank templates staff have published (Settings). */
export interface ContractorApplicationTemplates {
  master_contractor_agreement: string | null;
  background_check_authorization: string | null;
}

export interface ContractorDocRequirementResult {
  key: ContractorApplicationDocType;
  /** Effective requirement once templates are considered. */
  requirement: ContractorDocRequirement;
  applicable: boolean;
}

export interface ContractorApplicationRequirements {
  /** Dotted paths like `company.legal_name` or `references.clients` that block submit. */
  missing_fields: string[];
  docs: ContractorDocRequirementResult[];
}

// ── Empty data ───────────────────────────────────────────────────────────────

const emptyPolicy = (): InsurancePolicy => ({
  carrier: "",
  policy_number: "",
  limits: "",
  expires_on: "",
});

export function emptyContractorApplicationData(): ContractorApplicationData {
  return {
    company: {
      legal_name: "",
      dba: "",
      address: "",
      city: "",
      state: "CA",
      zip: "",
      contact_name: "",
      contact_title: "",
      phone: "",
      email: "",
      website: "",
      year_established: "",
      entity_type: "",
      ein: "",
      sos_entity_number: "",
      employee_count: "",
      service_area: "",
    },
    licensing: {
      cslb_license_number: "",
      classifications: "",
      license_expires_on: "",
      qualifier_name: "",
      qualifier_title: "",
      qualifier_status: "",
      bond_company: "",
      bond_number: "",
      bond_amount: "",
      business_license_numbers: "",
      dir_registration_number: "",
      license_disciplined: "",
      epa_rrp_certified: "",
    },
    insurance: {
      general_liability: emptyPolicy(),
      workers_comp: emptyPolicy(),
      commercial_auto: emptyPolicy(),
      umbrella: emptyPolicy(),
      wc_exempt: "",
      builders_risk_available: "",
    },
    experience: {
      years_building_adus: "",
      adus_completed_3yrs: "",
      typical_value_range: "",
      max_concurrent_projects: "",
      project_types: [],
      recent_projects: Array.from({ length: CPQ_ROWS.recent_projects }, () => ({
        address: "",
        type_sqft: "",
        contract_value: "",
        completed_on: "",
      })),
    },
    personnel: Array.from({ length: CPQ_ROWS.personnel }, () => ({
      name: "",
      role: "",
      years_experience: "",
      certifications: "",
    })),
    references: {
      clients: Array.from({ length: CPQ_ROWS.client_references }, () => ({
        name: "",
        project_address: "",
        phone: "",
        email: "",
      })),
      suppliers: Array.from({ length: CPQ_ROWS.supplier_references }, () => ({
        company: "",
        contact_name: "",
        phone: "",
        relationship: "",
      })),
    },
    financial: {
      bank_name: "",
      bank_contact: "",
      bank_phone: "",
      surety_company: "",
      single_bonding_capacity: "",
      aggregate_bonding_capacity: "",
      revenue_recent_year: "",
      revenue_prior_year: "",
    },
    safety: {
      emr: "",
      osha_recordables_3yrs: "",
      safety_officer: "",
      has_iipp: "",
      osha_citations_3yrs: "",
      lawsuits_5yrs: "",
      cslb_complaints_5yrs: "",
      liens_5yrs: "",
      failed_to_complete: "",
      bankruptcy_7yrs: "",
      disclosure_explanation: "",
    },
    warranty: { period: "", terms: "" },
  };
}

// ── Requirement rules (mirrored inline in api/index.ts) ──────────────────────

const filled = (v: unknown) => String(v ?? "").trim().length > 0;
const yesNoAnswered = (v: unknown) => v === "yes" || v === "no";

const policyComplete = (p: InsurancePolicy | undefined) =>
  !!p && filled(p.carrier) && filled(p.policy_number) && filled(p.limits) && filled(p.expires_on);

/** Required fields per section (dotted paths). Order matches the wizard. */
export function contractorApplicationMissingFields(
  d: ContractorApplicationData,
): string[] {
  const out: string[] = [];
  const need = (path: string, ok: boolean) => {
    if (!ok) out.push(path);
  };
  const c = d.company;
  for (const k of [
    "legal_name",
    "address",
    "city",
    "state",
    "zip",
    "contact_name",
    "phone",
    "email",
    "year_established",
    "entity_type",
    "ein",
    "employee_count",
    "service_area",
  ] as const) {
    need(`company.${k}`, filled(c[k]));
  }
  const l = d.licensing;
  for (const k of [
    "cslb_license_number",
    "classifications",
    "license_expires_on",
    "qualifier_name",
    "qualifier_status",
    "bond_company",
    "bond_number",
    "bond_amount",
  ] as const) {
    need(`licensing.${k}`, filled(l[k]));
  }
  need("licensing.license_disciplined", yesNoAnswered(l.license_disciplined));
  need("licensing.epa_rrp_certified", yesNoAnswered(l.epa_rrp_certified));

  const ins = d.insurance;
  need("insurance.wc_exempt", yesNoAnswered(ins.wc_exempt));
  need("insurance.builders_risk_available", yesNoAnswered(ins.builders_risk_available));
  need("insurance.general_liability", policyComplete(ins.general_liability));
  if (ins.wc_exempt !== "yes") {
    need("insurance.workers_comp", policyComplete(ins.workers_comp));
  }
  need("insurance.commercial_auto", policyComplete(ins.commercial_auto));
  if (filled(ins.umbrella?.carrier)) {
    need("insurance.umbrella", policyComplete(ins.umbrella));
  }

  const e = d.experience;
  for (const k of [
    "years_building_adus",
    "adus_completed_3yrs",
    "typical_value_range",
    "max_concurrent_projects",
  ] as const) {
    need(`experience.${k}`, filled(e[k]));
  }
  need("experience.project_types", (e.project_types || []).length > 0);
  need(
    "experience.recent_projects",
    (e.recent_projects || []).some(
      (p) => filled(p.address) && filled(p.type_sqft) && filled(p.contract_value) && filled(p.completed_on),
    ),
  );

  need(
    "personnel",
    (d.personnel || []).some((p) => filled(p.name) && filled(p.role)),
  );

  need(
    "references.clients",
    (d.references?.clients || []).filter((r) => filled(r.name) && filled(r.phone)).length >=
      CPQ_ROWS.client_references,
  );

  const f = d.financial;
  need("financial.bank_name", filled(f.bank_name));
  need("financial.bank_phone", filled(f.bank_phone));
  need("financial.revenue_recent_year", filled(f.revenue_recent_year));

  const s = d.safety;
  need("safety.has_iipp", yesNoAnswered(s.has_iipp));
  for (const k of CPQ_DISCLOSURE_KEYS) need(`safety.${k}`, yesNoAnswered(s[k]));
  const anyYes =
    CPQ_DISCLOSURE_KEYS.some((k) => s[k] === "yes") || l.license_disciplined === "yes";
  if (anyYes) need("safety.disclosure_explanation", filled(s.disclosure_explanation));

  need("warranty.period", filled(d.warranty.period));
  need("warranty.terms", filled(d.warranty.terms));
  return out;
}

/** Whether a document applies to this applicant (conditional docs). */
export function contractorDocApplicable(
  key: ContractorApplicationDocType,
  d: ContractorApplicationData,
): boolean {
  switch (key) {
    case "coi_umbrella":
      return filled(d.insurance.umbrella?.carrier);
    case "surety_letter":
      return filled(d.financial.surety_company);
    case "epa_rrp":
      return d.licensing.epa_rrp_certified === "yes";
    case "dir_registration":
      return filled(d.licensing.dir_registration_number);
    default:
      return true;
  }
}

export function contractorApplicationRequirements(
  d: ContractorApplicationData,
  templates: ContractorApplicationTemplates,
): ContractorApplicationRequirements {
  return {
    missing_fields: contractorApplicationMissingFields(d),
    docs: CONTRACTOR_DOC_SPECS.map((spec) => ({
      key: spec.key,
      // Without a published template the signed doc can't block submit.
      requirement:
        spec.template && !templates[spec.template] ? "approval" : spec.requirement,
      applicable: contractorDocApplicable(spec.key, d),
    })),
  };
}

/** Section a missing-field path belongs to (for "jump to step" links). */
export function contractorApplicationPathSection(
  path: string,
): ContractorApplicationSection {
  return path.split(".")[0] as ContractorApplicationSection;
}

// ── API payloads ─────────────────────────────────────────────────────────────

export type ContractorApplicationDocStatus = "uploaded" | "accepted" | "rejected";

export interface ContractorApplicationDocument {
  id: number;
  doc_type: ContractorApplicationDocType;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  expires_on: string | null;
  status: ContractorApplicationDocStatus;
  review_note: string | null;
  uploaded_at: string;
  /** Admin view only: hidden when the viewer lacks finance.read. */
  redacted?: boolean;
}

export interface ContractorApplicationSigner {
  signer_name: string | null;
  signer_title: string | null;
  signer_email: string | null;
  signer_phone: string | null;
  signed_at: string | null;
}

/** GET /api/public/contractor-application/:token */
export interface ContractorApplicationPublicView {
  ok: true;
  application: {
    application_number: string;
    status: ContractorApplicationStatus;
    current_step: number;
    data: ContractorApplicationData;
    submitted_at: string | null;
    due_at: string | null;
    info_request_note: string | null;
    info_request_doc_types: ContractorApplicationDocType[];
    signer: ContractorApplicationSigner;
    certification_version: string;
    /** Exact text the signer certifies (hash stored with the signature). */
    certification_text: string;
  };
  contractor: {
    first_name: string;
    last_name: string;
    email: string;
    company: string | null;
  };
  documents: ContractorApplicationDocument[];
  requirements: ContractorApplicationRequirements;
  templates: ContractorApplicationTemplates;
}

export interface SaveContractorApplicationRequest {
  data: Partial<ContractorApplicationData>;
  current_step?: number;
}

export interface ContractorApplicationUploadTokenResponse {
  ok: true;
  client_token: string;
  pathname: string;
}

export interface RegisterContractorDocumentRequest {
  doc_type: ContractorApplicationDocType;
  pathname: string;
  file_name: string;
  expires_on?: string | null;
}

export interface SubmitContractorApplicationRequest {
  signer_name: string;
  signer_title: string;
  signer_email: string;
  signer_phone: string;
  /** PNG data URL from the signature pad. */
  signature_image: string;
  certify: true;
}

export interface ContractorApplicationOfficeUse {
  reviewed_by_name: string | null;
  reviewed_at: string | null;
  license_verified: boolean | null;
  insurance_verified: boolean | null;
  decision_notes: string | null;
}

export interface ContractorApplicationEvent {
  id: number;
  kind: string;
  actor_type: "admin" | "contractor" | "system";
  actor_name: string | null;
  note: string | null;
  created_at: string;
}

/** GET /api/admin/contractors/:id/application */
export interface AdminContractorApplicationView {
  ok: true;
  application: {
    id: number;
    application_number: string;
    status: ContractorApplicationStatus;
    current_step: number;
    /** `financial` is emptied when `financial_redacted`. */
    data: ContractorApplicationData;
    financial_redacted: boolean;
    submitted_at: string | null;
    due_at: string | null;
    sent_at: string | null;
    last_reminder_at: string | null;
    info_request_note: string | null;
    info_request_doc_types: ContractorApplicationDocType[];
    signer: ContractorApplicationSigner & {
      signature_image: string | null;
      signed_ip: string | null;
      signed_user_agent: string | null;
    };
    office: ContractorApplicationOfficeUse;
    created_at: string;
  } | null;
  documents: ContractorApplicationDocument[];
  requirements: ContractorApplicationRequirements | null;
  events: ContractorApplicationEvent[];
  templates: ContractorApplicationTemplates;
}

/** GET /api/contractor/application (portal banner). */
export interface ContractorPortalApplicationSummary {
  ok: true;
  application: {
    application_number: string;
    status: ContractorApplicationStatus;
    due_at: string | null;
    submitted_at: string | null;
  } | null;
}
