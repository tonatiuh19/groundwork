import { describe, expect, it } from "vitest";
import { slugifyEvent, suggestEventSlug } from "./eventOptions";

describe("event slug generator", () => {
  it("builds city-mon-year from the start date", () => {
    expect(suggestEventSlug({ city: "Fontana", starts_at: "2026-10-06T19:00" })).toBe("fontana-oct-2026");
    expect(suggestEventSlug({ city: "Rancho Cucamonga", starts_at: "2027-01-15T18:30" })).toBe(
      "rancho-cucamonga-jan-2027",
    );
  });

  it("strips accents and symbols", () => {
    expect(suggestEventSlug({ city: "San José / Montebello!", starts_at: "2026-12-01T10:00" })).toBe(
      "san-jose-montebello-dec-2026",
    );
    expect(slugifyEvent("  Noche de ADU — Peñasco  ")).toBe("noche-de-adu-penasco");
  });

  it("falls back to city or English title when the date is missing", () => {
    expect(suggestEventSlug({ city: "Riverside" })).toBe("riverside");
    expect(suggestEventSlug({ title_en: "ADU Discovery Night" })).toBe("adu-discovery-night");
    expect(suggestEventSlug({})).toBe("");
  });

  it("stays within the 64-char form limit and keeps the date", () => {
    const s = suggestEventSlug({ city: "A".repeat(100), starts_at: "2026-10-06T19:00" });
    expect(s.length).toBeLessThanOrEqual(64);
    expect(s.endsWith("-oct-2026")).toBe(true);
    expect(s).toMatch(/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/);
  });
});
