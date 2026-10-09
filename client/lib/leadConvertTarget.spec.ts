import { describe, expect, it } from "vitest";
import { leadAlreadyConverted, smartLeadConvertTarget } from "./leadConvertTarget";

describe("smartLeadConvertTarget", () => {
  it("defaults to client", () => {
    expect(smartLeadConvertTarget({ source: null, notes: null, audience_tag: null })).toBe(
      "client",
    );
  });

  it("picks affiliate from partner_referral / company notes / tag", () => {
    expect(
      smartLeadConvertTarget({ source: "partner_referral", notes: null, audience_tag: null }),
    ).toBe("affiliate");
    expect(
      smartLeadConvertTarget({
        source: "web",
        notes: "company=Encore Mortgage",
        audience_tag: null,
      }),
    ).toBe("affiliate");
    expect(
      smartLeadConvertTarget({
        source: null,
        notes: null,
        audience_tag: "affiliate_lead",
      }),
    ).toBe("affiliate");
  });

  it("picks contractor from tag / intent", () => {
    expect(
      smartLeadConvertTarget({
        source: null,
        notes: "intent=contractor",
        audience_tag: null,
      }),
    ).toBe("contractor");
    expect(
      smartLeadConvertTarget({
        source: null,
        notes: null,
        audience_tag: "contractor_lead",
      }),
    ).toBe("contractor");
  });
});

describe("leadAlreadyConverted", () => {
  it("is true when any convert FK is set", () => {
    expect(
      leadAlreadyConverted({
        client_id: null,
        converted_affiliate_id: 1,
        converted_contractor_id: null,
      }),
    ).toBe(true);
    expect(
      leadAlreadyConverted({
        client_id: null,
        converted_affiliate_id: null,
        converted_contractor_id: null,
      }),
    ).toBe(false);
  });
});
