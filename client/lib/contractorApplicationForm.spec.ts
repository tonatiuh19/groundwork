import { describe, expect, it } from "vitest";
import en from "../locales/en/translation.json";
import es from "../locales/es/translation.json";
import {
  CONTRACTOR_APPLICATION_STATUSES,
  CONTRACTOR_DOC_SPECS,
  emptyContractorApplicationData,
} from "@shared/contractorApplication";
import {
  CPQ_POLICY_COLUMNS,
  CPQ_SECTION_FIELDS,
  CPQ_STEPS,
  cpqDisclosureAnyYes,
  cpqSectionIssues,
  cslbLookupUrl,
} from "./contractorApplicationForm";

const lookup = (catalog: unknown, key: string) =>
  key.split(".").reduce<unknown>((acc, k) => (acc as Record<string, unknown> | undefined)?.[k], catalog);

/** Every label the wizard / admin view builds dynamically. */
function dynamicKeys(): string[] {
  const keys = new Set<string>();
  for (const s of CPQ_STEPS) {
    keys.add(`cpq.step.${s}`);
    keys.add(`cpq.lead.${s}`);
  }
  for (const fields of Object.values(CPQ_SECTION_FIELDS)) {
    for (const f of fields) {
      if (f.kind === "note") {
        keys.add(f.textKey);
        continue;
      }
      keys.add(`cpq.f.${f.path}`);
      if ("hintKey" in f && f.hintKey) keys.add(f.hintKey);
      if (f.kind === "policy" && f.optionalHintKey) keys.add(f.optionalHintKey);
      if (f.kind === "rows") for (const c of f.columns) keys.add(`cpq.col.${f.path}.${c.key}`);
      if (f.kind === "select" || f.kind === "checks") for (const o of f.options) keys.add(`${f.optionGroup}.${o}`);
    }
  }
  for (const c of CPQ_POLICY_COLUMNS) keys.add(`cpq.f.policy.${c}`);
  for (const d of CONTRACTOR_DOC_SPECS) keys.add(`cpq.doc.${d.key}`);
  for (const st of [...CONTRACTOR_APPLICATION_STATUSES, "none"]) keys.add(`cpqStatus.${st}`);
  for (const st of ["submitted", "in_review", "approved", "denied"]) {
    keys.add(`cpq.status.${st}.title`);
    keys.add(`cpq.status.${st}.body`);
  }
  for (const st of ["none", "draft", "needs_info", "submitted", "in_review"]) {
    keys.add(`cpq.banner.${st}.title`);
    keys.add(`cpq.banner.${st}.body`);
  }
  for (const st of ["uploaded", "accepted", "rejected"]) keys.add(`cpqDocStatus.${st}`);
  return [...keys];
}

describe("contractor application i18n", () => {
  it.each([
    ["en", en],
    ["es", es],
  ])("%s has every dynamic label", (_lang, catalog) => {
    const missing = dynamicKeys().filter((k) => typeof lookup(catalog, k) !== "string");
    expect(missing).toEqual([]);
  });
});

describe("cpqSectionIssues", () => {
  it("scopes shared required rules to one section and adds format checks", () => {
    const d = emptyContractorApplicationData();
    const company = cpqSectionIssues(d, "company");
    expect(company["company.legal_name"]).toBe("required");
    expect(Object.keys(company).every((k) => k.startsWith("company."))).toBe(true);
    d.company.email = "not-an-email";
    d.company.zip = "123";
    d.company.year_established = "1800";
    const fmt = cpqSectionIssues(d, "company");
    expect(fmt["company.email"]).toBe("format");
    expect(fmt["company.zip"]).toBe("format");
    expect(fmt["company.year_established"]).toBe("format");
  });

  it("shows the explanation only after a YES disclosure", () => {
    const d = emptyContractorApplicationData();
    expect(cpqDisclosureAnyYes(d)).toBe(false);
    d.safety.liens_5yrs = "yes";
    expect(cpqDisclosureAnyYes(d)).toBe(true);
  });

  it("builds a CSLB lookup link from the digits only", () => {
    expect(cslbLookupUrl(" #1023456 ")).toMatch(/LicNum=1023456$/);
  });
});
