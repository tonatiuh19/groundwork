/**
 * Field layout for the contractor prequalification wizard + admin read-only view.
 * Labels: `cpq.f.<path>` (row columns: `cpq.col.<path>.<column>`). Validation rules live in
 * `@shared/contractorApplication` (same rules the API enforces on submit).
 */
import {
  ADU_PROJECT_TYPES,
  CONTRACTOR_APPLICATION_SECTIONS,
  CPQ_DISCLOSURE_KEYS,
  contractorApplicationMissingFields,
  contractorApplicationPathSection,
  type ContractorApplicationData,
  type ContractorApplicationSection,
} from "@shared/contractorApplication";

export type CpqInputKind = "text" | "email" | "tel" | "date" | "url" | "number" | "textarea";

export type CpqField =
  | {
      kind: CpqInputKind;
      path: string;
      /** Grid columns out of 4 (collapses on narrow screens). */
      span?: 1 | 2 | 4;
      required?: boolean;
      hintKey?: string;
      autoComplete?: string;
    }
  | {
      kind: "select";
      path: string;
      options: readonly string[];
      optionGroup: string;
      span?: 1 | 2 | 4;
      required?: boolean;
    }
  | { kind: "yesno"; path: string; required?: boolean }
  | { kind: "policy"; path: string; required?: boolean; optionalHintKey?: string }
  | {
      kind: "rows";
      path: string;
      columns: Array<{ key: string; kind: CpqInputKind }>;
      requiredRows?: number;
      hintKey?: string;
    }
  | { kind: "checks"; path: string; options: readonly string[]; optionGroup: string; required?: boolean }
  | { kind: "note"; textKey: string };

export const CPQ_POLICY_COLUMNS = ["carrier", "policy_number", "limits", "expires_on"] as const;

export const CPQ_SECTION_FIELDS: Record<ContractorApplicationSection, CpqField[]> = {
  company: [
    { kind: "text", path: "company.legal_name", span: 2, required: true, autoComplete: "organization" },
    { kind: "text", path: "company.dba", span: 2 },
    { kind: "text", path: "company.address", span: 2, required: true, autoComplete: "street-address" },
    { kind: "text", path: "company.city", required: true, autoComplete: "address-level2" },
    { kind: "text", path: "company.state", required: true, autoComplete: "address-level1" },
    { kind: "text", path: "company.zip", required: true, autoComplete: "postal-code" },
    { kind: "text", path: "company.contact_name", required: true, autoComplete: "name" },
    { kind: "text", path: "company.contact_title", autoComplete: "organization-title" },
    { kind: "tel", path: "company.phone", required: true, autoComplete: "tel" },
    { kind: "email", path: "company.email", span: 2, required: true, autoComplete: "email" },
    { kind: "url", path: "company.website", span: 2, autoComplete: "url" },
    { kind: "number", path: "company.year_established", required: true },
    {
      kind: "select",
      path: "company.entity_type",
      options: ["corporation", "llc", "partnership", "sole_proprietor"],
      optionGroup: "cpq.entity",
      required: true,
    },
    { kind: "text", path: "company.ein", required: true },
    { kind: "text", path: "company.sos_entity_number" },
    { kind: "number", path: "company.employee_count", required: true },
    { kind: "textarea", path: "company.service_area", span: 4, required: true, hintKey: "cpq.h.serviceArea" },
  ],
  licensing: [
    { kind: "text", path: "licensing.cslb_license_number", required: true },
    { kind: "text", path: "licensing.classifications", required: true, hintKey: "cpq.h.classifications" },
    { kind: "date", path: "licensing.license_expires_on", required: true },
    { kind: "text", path: "licensing.qualifier_name", required: true },
    { kind: "text", path: "licensing.qualifier_title" },
    {
      kind: "select",
      path: "licensing.qualifier_status",
      options: ["active", "inactive"],
      optionGroup: "cpq.qualifierStatus",
      required: true,
    },
    { kind: "text", path: "licensing.bond_company", span: 2, required: true },
    { kind: "text", path: "licensing.bond_number", required: true },
    { kind: "text", path: "licensing.bond_amount", required: true, hintKey: "cpq.h.bondAmount" },
    { kind: "text", path: "licensing.business_license_numbers", span: 2 },
    { kind: "text", path: "licensing.dir_registration_number", span: 2, hintKey: "cpq.h.ifApplicable" },
    { kind: "yesno", path: "licensing.license_disciplined", required: true },
    { kind: "yesno", path: "licensing.epa_rrp_certified", required: true },
  ],
  insurance: [
    { kind: "note", textKey: "cpq.n.insurance" },
    { kind: "policy", path: "insurance.general_liability", required: true },
    { kind: "yesno", path: "insurance.wc_exempt", required: true },
    { kind: "policy", path: "insurance.workers_comp", required: true, optionalHintKey: "cpq.h.wcExempt" },
    { kind: "policy", path: "insurance.commercial_auto", required: true },
    { kind: "policy", path: "insurance.umbrella", optionalHintKey: "cpq.h.optional" },
    { kind: "yesno", path: "insurance.builders_risk_available", required: true },
  ],
  experience: [
    { kind: "number", path: "experience.years_building_adus", required: true },
    { kind: "number", path: "experience.adus_completed_3yrs", required: true },
    { kind: "text", path: "experience.typical_value_range", required: true, hintKey: "cpq.h.valueRange" },
    { kind: "number", path: "experience.max_concurrent_projects", required: true },
    {
      kind: "checks",
      path: "experience.project_types",
      options: ADU_PROJECT_TYPES,
      optionGroup: "cpq.projectType",
      required: true,
    },
    {
      kind: "rows",
      path: "experience.recent_projects",
      columns: [
        { key: "address", kind: "text" },
        { key: "type_sqft", kind: "text" },
        { key: "contract_value", kind: "text" },
        { key: "completed_on", kind: "date" },
      ],
      requiredRows: 1,
      hintKey: "cpq.h.recentProjects",
    },
  ],
  personnel: [
    {
      kind: "rows",
      path: "personnel",
      columns: [
        { key: "name", kind: "text" },
        { key: "role", kind: "text" },
        { key: "years_experience", kind: "number" },
        { key: "certifications", kind: "text" },
      ],
      requiredRows: 1,
      hintKey: "cpq.h.personnel",
    },
  ],
  references: [
    {
      kind: "rows",
      path: "references.clients",
      columns: [
        { key: "name", kind: "text" },
        { key: "project_address", kind: "text" },
        { key: "phone", kind: "tel" },
        { key: "email", kind: "email" },
      ],
      requiredRows: 3,
      hintKey: "cpq.h.clientRefs",
    },
    {
      kind: "rows",
      path: "references.suppliers",
      columns: [
        { key: "company", kind: "text" },
        { key: "contact_name", kind: "text" },
        { key: "phone", kind: "tel" },
        { key: "relationship", kind: "text" },
      ],
      hintKey: "cpq.h.optional",
    },
  ],
  financial: [
    { kind: "note", textKey: "cpq.n.financial" },
    { kind: "text", path: "financial.bank_name", span: 2, required: true },
    { kind: "text", path: "financial.bank_contact" },
    { kind: "tel", path: "financial.bank_phone", required: true },
    { kind: "text", path: "financial.surety_company", span: 2 },
    { kind: "text", path: "financial.single_bonding_capacity" },
    { kind: "text", path: "financial.aggregate_bonding_capacity" },
    { kind: "text", path: "financial.revenue_recent_year", span: 2, required: true },
    { kind: "text", path: "financial.revenue_prior_year", span: 2 },
  ],
  safety: [
    { kind: "text", path: "safety.emr", hintKey: "cpq.h.emr" },
    { kind: "number", path: "safety.osha_recordables_3yrs" },
    { kind: "text", path: "safety.safety_officer", span: 2 },
    { kind: "yesno", path: "safety.has_iipp", required: true },
    ...CPQ_DISCLOSURE_KEYS.map((k) => ({ kind: "yesno" as const, path: `safety.${k}`, required: true })),
    { kind: "textarea", path: "safety.disclosure_explanation", span: 4, hintKey: "cpq.h.explanation" },
  ],
  warranty: [
    { kind: "text", path: "warranty.period", span: 4, required: true, hintKey: "cpq.h.warrantyPeriod" },
    { kind: "textarea", path: "warranty.terms", span: 4, required: true },
  ],
};

/** Wizard steps: 9 data sections, then documents, then review & sign. */
export type CpqStep = ContractorApplicationSection | "documents" | "review";
export const CPQ_STEPS: CpqStep[] = [...CONTRACTOR_APPLICATION_SECTIONS, "documents", "review"];
export const CPQ_DOCUMENTS_STEP = CPQ_STEPS.indexOf("documents");
export const CPQ_REVIEW_STEP = CPQ_STEPS.indexOf("review");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const digits = (v: string) => v.replace(/\D/g, "").length;

/** Missing-field paths for one section (shared rules) + light format checks. */
export function cpqSectionIssues(
  data: ContractorApplicationData,
  section: ContractorApplicationSection,
): Record<string, "required" | "format"> {
  const out: Record<string, "required" | "format"> = {};
  for (const p of contractorApplicationMissingFields(data)) {
    if (contractorApplicationPathSection(p) === section) out[p] = "required";
  }
  const fmt = (path: string, bad: boolean) => {
    if (bad && !out[path]) out[path] = "format";
  };
  if (section === "company") {
    const c = data.company;
    fmt("company.email", !!c.email && !EMAIL_RE.test(c.email.trim()));
    fmt("company.phone", !!c.phone && digits(c.phone) < 10);
    fmt("company.zip", !!c.zip && !/^\d{5}(-\d{4})?$/.test(c.zip.trim()));
    fmt(
      "company.year_established",
      !!c.year_established &&
        !(/^\d{4}$/.test(c.year_established.trim()) &&
          Number(c.year_established) <= new Date().getFullYear() &&
          Number(c.year_established) >= 1900),
    );
  }
  if (section === "financial") {
    fmt("financial.bank_phone", !!data.financial.bank_phone && digits(data.financial.bank_phone) < 10);
  }
  return out;
}

export function cpqDisclosureAnyYes(d: ContractorApplicationData): boolean {
  return CPQ_DISCLOSURE_KEYS.some((k) => d.safety[k] === "yes") || d.licensing.license_disciplined === "yes";
}

/** Read a dotted path from the data tree. */
export function cpqGet(data: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>(
    (acc, k) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[k] : undefined),
    data,
  );
}

/** Expiry prefill for document uploads, from answers already given. */
export const CPQ_DOC_EXPIRY_SOURCE: Partial<Record<string, string>> = {
  cslb_license: "licensing.license_expires_on",
  coi_general_liability: "insurance.general_liability.expires_on",
  workers_comp: "insurance.workers_comp.expires_on",
  coi_auto: "insurance.commercial_auto.expires_on",
  coi_umbrella: "insurance.umbrella.expires_on",
};

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Public CSLB license lookup (for staff verification). */
export function cslbLookupUrl(license: string): string {
  return `https://www.cslb.ca.gov/OnlineServices/CheckLicenseII/LicenseDetail.aspx?LicNum=${encodeURIComponent(
    license.replace(/\D/g, ""),
  )}`;
}
