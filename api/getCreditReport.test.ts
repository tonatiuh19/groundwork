import { describe, expect, it } from "vitest";
import {
  tplGetCreditReportWelcome,
  __test,
} from "./index";

describe("get-credit-report", () => {
  it("parses a valid GCR payload", () => {
    const parsed = __test.parseGetCreditReportBody({
      first_name: "Alex",
      last_name: "Gomez",
      email: "Alex@Example.com",
      phone: "5550102030",
      preferred_language: "en",
      soft_pull_consent: true,
      notes: "From Fontana event",
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.data.email).toBe("alex@example.com");
      expect(parsed.data.first_name).toBe("Alex");
    }
  });

  it("requires soft-pull consent", () => {
    const parsed = __test.parseGetCreditReportBody({
      first_name: "Alex",
      last_name: "Gomez",
      email: "alex@example.com",
      phone: "5550102030",
      soft_pull_consent: false,
    });
    expect(parsed.ok).toBe(false);
  });

  it("welcome email includes MFSN link", () => {
    const url = __test.MFSN_FREE_SNAPSHOT_URL;
    const tpl = tplGetCreditReportWelcome({
      firstName: "Alex",
      mfsnUrl: url,
    });
    expect(tpl.html).toContain(url);
    expect(tpl.html).toContain("Open my free report");
    expect(tpl.subject).toMatch(/Groundwork Capital/i);
  });

  it("dry-runs email delivery under Vitest", () => {
    expect(__test.shouldDeliverEmail()).toBe(false);
  });
});
