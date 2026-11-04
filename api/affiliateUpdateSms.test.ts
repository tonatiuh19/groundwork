import { describe, expect, it } from "vitest";
import { affiliateUpdateSms } from "./index";

const base = { lang: "en" as const, who: "Sandra G.", status: null, portalUrl: "https://x.example.com/affiliate/clients" };

describe("affiliate update text", () => {
  it("carries the note as written, the link, and no double period", () => {
    const t = affiliateUpdateSms({ ...base, note: "I called Sandra on Friday." });
    expect(t).toContain("update on Sandra G.\n\nI called Sandra on Friday.\n\nSee it in your portal: https://x.example.com/affiliate/clients");
    expect(t).not.toContain("G..");
  });
  it("includes status and note; status alone still works; Spanish", () => {
    expect(affiliateUpdateSms({ ...base, status: "Contacted", note: "Hi" })).toContain("Sandra G. · Contacted\n\nHi\n\n");
    expect(affiliateUpdateSms({ ...base, status: "Contacted", note: null })).toContain("Contacted\n\nSee it");
    expect(affiliateUpdateSms({ ...base, lang: "es", note: "Hola" })).toContain("actualización de Sandra G.\n\nHola\n\nVéalo en su portal:");
  });
  it("cuts only at the SMS limit and keeps the link", () => {
    const t = affiliateUpdateSms({ ...base, note: "x".repeat(4000) });
    expect([...t].length).toBeLessThanOrEqual(1600);
    expect(t).toContain("...\n\nSee it in your portal:");
    expect(affiliateUpdateSms({ ...base, note: "y".repeat(1400) })).toContain("y".repeat(1400));
  });
});
