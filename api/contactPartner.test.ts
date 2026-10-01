import { describe, expect, it } from "vitest";
import { __test, tplGenericConfirmation } from "./index";

describe("parseContactBody", () => {
  it("accepts a valid contact payload", () => {
    const parsed = __test.parseContactBody({
      full_name: "Alex Rivera",
      email: "alex@example.com",
      phone: "9492396358",
      intent: "adu_project",
      sms_transactional_consent: true,
      preferred_language: "es",
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.data.intent).toBe("adu_project");
      expect(parsed.data.preferred_language).toBe("es");
    }
  });

  it("requires transactional SMS consent", () => {
    const parsed = __test.parseContactBody({
      full_name: "Alex Rivera",
      email: "alex@example.com",
      phone: "9492396358",
      intent: "financing",
      sms_transactional_consent: false,
    });
    expect(parsed).toMatchObject({ error: "validation.smsTransactional" });
  });
});

describe("parsePartnerBody", () => {
  it("accepts partner signup", () => {
    const parsed = __test.parsePartnerBody({
      full_name: "Jordan Lee",
      email: "jordan@example.com",
      phone: "5550102030",
      company: "Lee Realty",
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.data.company).toBe("Lee Realty");
    }
  });
});

describe("tplGenericConfirmation", () => {
  it("builds partner confirmation", () => {
    const tpl = tplGenericConfirmation({
      fullName: "Jordan Lee",
      kind: "partner",
      lang: "en",
    });
    expect(tpl.subject).toMatch(/Partner/i);
    expect(tpl.html).toContain("Jordan");
  });
});
