import { describe, expect, it } from "vitest";
import {
  CPQ_ADU_PROJECT_TYPES,
  CPQ_DISCLOSURE_KEYS,
  CPQ_DOC_SPECS,
  CPQ_ROWS,
  buildContractorApplicationPdf,
  cpqDocApplicable,
  cpqEmptyData,
  cpqMissingFields,
  cpqRequirements,
  detectCpqDocType,
  isIsoDateOnly,
  normalizeCpqData,
} from "./index";
import {
  ADU_PROJECT_TYPES,
  CONTRACTOR_DOC_SPECS,
  CPQ_DISCLOSURE_KEYS as SHARED_DISCLOSURE_KEYS,
  CPQ_ROWS as SHARED_ROWS,
  contractorApplicationMissingFields,
  contractorApplicationRequirements,
  contractorDocApplicable,
  emptyContractorApplicationData,
  type ContractorApplicationData,
} from "../shared/contractorApplication";
import { completeCpqData } from "./contractorApplication.fixtures";

const NO_TEMPLATES = { master_contractor_agreement: null, background_check_authorization: null };
const ALL_TEMPLATES = {
  master_contractor_agreement: "https://x.public.blob.vercel-storage.com/mca.pdf",
  background_check_authorization: "https://x.public.blob.vercel-storage.com/bg.pdf",
};

describe("CPQ catalog parity (api inline mirror ↔ shared)", () => {
  it("keeps doc specs, rows, disclosure keys, project types and empty data identical", () => {
    expect(CPQ_DOC_SPECS).toEqual(CONTRACTOR_DOC_SPECS);
    expect(CPQ_ROWS).toEqual(SHARED_ROWS);
    expect([...CPQ_DISCLOSURE_KEYS]).toEqual([...SHARED_DISCLOSURE_KEYS]);
    expect(CPQ_ADU_PROJECT_TYPES).toEqual(ADU_PROJECT_TYPES);
    expect(cpqEmptyData()).toEqual(emptyContractorApplicationData());
  });

  it("agrees on required fields + doc applicability across scenarios", () => {
    const scenarios: ContractorApplicationData[] = [cpqEmptyData(), completeCpqData()];
    const wcExempt = completeCpqData();
    wcExempt.insurance.wc_exempt = "yes";
    wcExempt.insurance.workers_comp = { carrier: "", policy_number: "", limits: "", expires_on: "" };
    scenarios.push(wcExempt);
    const disclosures = completeCpqData();
    disclosures.safety.lawsuits_5yrs = "yes";
    disclosures.licensing.epa_rrp_certified = "yes";
    disclosures.licensing.dir_registration_number = "DIR-1";
    disclosures.financial.surety_company = "Big Surety";
    disclosures.insurance.umbrella.carrier = "Umb";
    scenarios.push(disclosures);
    for (const d of scenarios) {
      expect(cpqMissingFields(d)).toEqual(contractorApplicationMissingFields(d));
      for (const t of [NO_TEMPLATES, ALL_TEMPLATES]) {
        expect(cpqRequirements(d, t)).toEqual(contractorApplicationRequirements(d, t));
      }
      for (const spec of CPQ_DOC_SPECS) {
        expect(cpqDocApplicable(spec.key, d)).toBe(contractorDocApplicable(spec.key, d));
      }
    }
  });
});

describe("CPQ requirement rules", () => {
  it("a complete application has no missing fields", () => {
    expect(cpqMissingFields(completeCpqData())).toEqual([]);
  });

  it("workers' comp policy is optional only when exempt", () => {
    const d = completeCpqData();
    d.insurance.workers_comp.carrier = "";
    expect(cpqMissingFields(d)).toContain("insurance.workers_comp");
    d.insurance.wc_exempt = "yes";
    expect(cpqMissingFields(d)).not.toContain("insurance.workers_comp");
  });

  it("any YES disclosure (or past discipline) requires an explanation", () => {
    const d = completeCpqData();
    d.licensing.license_disciplined = "yes";
    expect(cpqMissingFields(d)).toContain("safety.disclosure_explanation");
    d.safety.disclosure_explanation = "2019 citation, resolved";
    expect(cpqMissingFields(d)).toEqual([]);
  });

  it("needs three client references", () => {
    const d = completeCpqData();
    d.references.clients[2].phone = "";
    expect(cpqMissingFields(d)).toContain("references.clients");
  });

  it("conditional docs follow answers; missing templates downgrade signed docs to approval", () => {
    const d = completeCpqData();
    expect(cpqDocApplicable("epa_rrp", d)).toBe(false);
    d.licensing.epa_rrp_certified = "yes";
    expect(cpqDocApplicable("epa_rrp", d)).toBe(true);
    const mca = (t: typeof NO_TEMPLATES) =>
      cpqRequirements(d, t).docs.find((x) => x.key === "master_contractor_agreement")!.requirement;
    expect(mca(NO_TEMPLATES)).toBe("approval");
    expect(mca(ALL_TEMPLATES)).toBe("core");
  });
});

describe("normalizeCpqData", () => {
  it("drops unknown keys, enforces enums/dates/lengths, keeps fixed row counts", () => {
    const d = normalizeCpqData({
      company: { legal_name: "  Acme  ", entity_type: "cooperative", hacker: "x", ein: 123 },
      licensing: { license_expires_on: "2026-02-30", license_disciplined: "maybe" },
      insurance: { general_liability: { expires_on: "2027-06-01", carrier: "A".repeat(500) } },
      experience: { project_types: ["jadu", "castle", "jadu"], recent_projects: [{ address: "1" }, 5, null, { address: "extra" }] },
      personnel: "nope",
      __proto__: { polluted: true },
    });
    expect(d.company.legal_name).toBe("Acme");
    expect(d.company.entity_type).toBe("");
    expect(d.company.ein).toBe("123");
    expect((d.company as Record<string, unknown>).hacker).toBeUndefined();
    expect(d.licensing.license_expires_on).toBe("");
    expect(d.licensing.license_disciplined).toBe("");
    expect(d.insurance.general_liability.expires_on).toBe("2027-06-01");
    expect(d.insurance.general_liability.carrier.length).toBe(200);
    expect(d.experience.project_types).toEqual(["jadu"]);
    expect(d.experience.recent_projects).toHaveLength(3);
    expect(d.experience.recent_projects[0].address).toBe("1");
    expect(d.personnel).toHaveLength(3);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("merges a partial save onto the existing draft", () => {
    const base = completeCpqData();
    const merged = normalizeCpqData({ warranty: { period: "3 years" } }, base);
    expect(merged.warranty.period).toBe("3 years");
    expect(merged.warranty.terms).toBe(base.warranty.terms);
    expect(merged.company.legal_name).toBe("Crew Builders LLC");
    // explicit null clears a field
    expect(normalizeCpqData({ company: { dba: null } }, { ...base, company: { ...base.company, dba: "X" } }).company.dba).toBe("");
  });

  it("validates ISO dates strictly", () => {
    expect(isIsoDateOnly("2026-10-09")).toBe(true);
    expect(isIsoDateOnly("2026-13-01")).toBe(false);
    expect(isIsoDateOnly("10/09/2026")).toBe(false);
  });
});

describe("detectCpqDocType", () => {
  it("accepts PDF and images by magic bytes only", () => {
    expect(detectCpqDocType(Buffer.from("%PDF-1.7\n"))?.mime).toBe("application/pdf");
    expect(
      detectCpqDocType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]))?.mime,
    ).toBe("image/png");
    expect(detectCpqDocType(Buffer.from("<html><script>"))).toBeNull();
  });
});

describe("buildContractorApplicationPdf", () => {
  const input = (redactFinancial: boolean, lang: "en" | "es" = "en") => ({
    number: "CPQ-2026-ABC234",
    status: "submitted",
    data: completeCpqData(),
    submittedAt: "2026-10-09T18:00:00.000Z",
    redactFinancial,
    docs: [{ doc_type: "cslb_license", status: "uploaded", expires_on: "2028-03-31" }],
    requirements: cpqRequirements(completeCpqData(), NO_TEMPLATES),
    signer: {
      name: "Ana Crew",
      title: "Owner",
      email: "ana@example.com",
      phone: "9495550100",
      signed_at: "2026-10-09T18:00:00.000Z",
      ip: "203.0.113.9",
      version: "2026-10-09",
    },
    office: {
      reviewer: null,
      reviewed_at: null,
      license_verified: true,
      insurance_verified: null,
      decision: null,
      notes: null,
    },
    lang,
  });

  it("renders every section, paginates, and redacts financials on request", () => {
    const pdf = buildContractorApplicationPdf(input(false)).toString("latin1");
    expect(pdf.startsWith("%PDF-1.4")).toBe(true);
    expect(pdf).toContain("(ADU Contractor Prequalification Application)");
    expect(pdf).toContain("CPQ-2026-ABC234");
    expect(pdf).toContain("Crew Builders LLC");
    expect(pdf).toContain("$3M");
    expect(Number(/\/Count (\d+)/.exec(pdf)![1])).toBeGreaterThan(1);
    const redacted = buildContractorApplicationPdf(input(true)).toString("latin1");
    expect(redacted).not.toContain("$3M");
    expect(redacted).toContain("Restricted");
  });

  it("localises to Spanish and is deterministic", () => {
    const a = buildContractorApplicationPdf(input(false, "es"));
    const b = buildContractorApplicationPdf(input(false, "es"));
    expect(a.equals(b)).toBe(true);
    expect(a.toString("latin1")).toContain("Solicitud de precalificaci\\363n");
  });
});
