import { describe, expect, it } from "vitest";
import { cityFollowUp, cityIntelScore, cityNextStep, cityPartnerOpenedClause, renderCityPartnerAgreement, streetOnly } from "./index";

describe("City Partner rules (own logic, no outside AI)", () => {
  it("follow-ups match the spreadsheet", () => {
    expect(cityFollowUp("2026-11-01", "2026-11-02")).toBe("overdue");
    expect(cityFollowUp("2026-11-02", "2026-11-02")).toBe("due_today");
    expect(cityFollowUp("2026-11-09", "2026-11-02")).toBe("upcoming");
    expect(cityFollowUp(null, "2026-11-02")).toBe("none");
  });
  it("suggests the next step from the stage and flags quiet cities", () => {
    expect(cityNextStep(null, null, "2026-11-02")).toEqual({ key: "add_to_pipeline", stale: false });
    expect(cityNextStep("comments_received", "2026-10-30", "2026-11-02")).toEqual({ key: "answer_comments", stale: false });
    expect(cityNextStep("target", "2026-10-01", "2026-11-02").stale).toBe(true);
    expect(cityNextStep("preapproved", null, "2026-11-02").stale).toBe(false);
  });
  it("scores the city sheet, lists what's missing, and finds stale and duplicate contacts", () => {
    const now = new Date("2026-11-02T12:00:00Z");
    const empty = cityIntelScore({ council_summary: null, adu_program_status: "unknown", adu_program_notes: null, intel_sources: null, intel_verified_at: null }, [], now);
    expect(empty.score).toBe(0);
    expect(empty.missing).toContain("planning");
    const full = cityIntelScore(
      { council_summary: "5 members", adu_program_status: "active", adu_program_notes: "Fee waiver", intel_sources: "https://city.example.com", intel_verified_at: "2026-10-30T00:00:00Z" },
      [
        { kind: "planning", email: "a@example.com", phone: null, verified_at: "2026-10-30T00:00:00Z" },
        { kind: "building", email: "A@example.com", phone: null, verified_at: "2026-01-01T00:00:00Z" },
      ],
      now,
    );
    expect(full.score).toBe(100);
    expect(full.duplicates).toBe(1);
    expect(full.stale_contacts).toBe(1);
  });
  it("shows partners the street name only, never the house number or unit", () => {
    expect(streetOnly("8421 Sierra Ave, Fontana, CA")).toBe("Sierra Ave");
    expect(streetOnly("12-B Elm St Apt 4")).toBe("Elm St");
    expect(streetOnly("1234")).toBeNull();
    expect(streetOnly("")).toBeNull();
  });
  it("fills the LLC name and the frozen rate into the agreement", () => {
    expect(renderCityPartnerAgreement("pay {{partner_legal_name}} {{fee_per_sqft}}; {{partner_legal_name}}", "Remedio LLC", 200)).toBe("pay Remedio LLC $2.00; Remedio LLC");
  });

  it("v2 agreement: per-partner date, cities and address; any unfilled field blocks sending", () => {
    expect(cityPartnerOpenedClause(["Fontana"], ["Rancho Cucamonga"])).toBe("Opened Cities as of signing: Fontana. Rancho Cucamonga becomes an Opened City once the Company's plans are pre-approved there.");
    expect(cityPartnerOpenedClause(["Fontana"], ["Rialto", "Upland", "Riverside"])).toBe("Opened Cities as of signing: Fontana. Rialto, Upland and Riverside become Opened Cities once the Company's plans are pre-approved there.");
    expect(cityPartnerOpenedClause([], [])).toBe("Opened Cities as of signing: none yet.");
    const body = "As of {{effective_date}}, {{partner_legal_name}} earns {{fee_per_sqft}}. {{opened_cities_clause}}\nADDRESS\n{{contractor_address}}";
    const shown = renderCityPartnerAgreement(body, "Remedio LLC", 200, { effective_date: "November 6, 2026", opened_cities: ["Fontana"], pending_cities: ["Rialto"], contractor_address: null });
    expect(shown).toContain("As of November 6, 2026, Remedio LLC earns $2.00. Opened Cities as of signing: Fontana. Rialto becomes");
    expect(shown).toContain("_____________________, California __________");
    const signed = renderCityPartnerAgreement(body, "Remedio LLC", 200, { effective_date: "November 6, 2026", opened_cities: ["Fontana"], pending_cities: ["Rialto"], contractor_address: "1 Main St\n\nFontana, California 92335" });
    expect(signed).toContain("ADDRESS\n1 Main St");
    // A term nobody filled in (e.g. the cancellation fee %) can never be shown or signed.
    expect(() => renderCityPartnerAgreement("fee of {{cancellation_fee_pct}}%", "Remedio LLC", 200)).toThrow();
    // v1 templates keep working with only name + rate.
    expect(renderCityPartnerAgreement("pay {{partner_legal_name}} {{fee_per_sqft}}", "Remedio LLC", 250)).toBe("pay Remedio LLC $2.50");
  });
});
