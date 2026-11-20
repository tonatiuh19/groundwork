import { describe, expect, it } from "vitest";
import { addendumRowAmount, pickAddendumPerAffiliate, renderAddendum, unfilledPlaceholders } from "./index";

/** Special agreement rules (pure): amounts, one agreement per affiliate, text placeholders. */
describe("addendumRowAmount", () => {
  it("replace pays rate × sq ft instead of the normal amount", () => {
    expect(addendumRowAmount("replace", 150000, 200, 1000)).toBe(200000);
  });
  it("extra adds rate × sq ft on top", () => {
    expect(addendumRowAmount("extra", 150000, 100, 1000)).toBe(250000);
  });
  it("unknown sq ft pays nothing extra; never negative", () => {
    expect(addendumRowAmount("replace", 150000, 200, null)).toBe(0);
    expect(addendumRowAmount("extra", -5, 100, 10)).toBe(1000);
  });
});

describe("pickAddendumPerAffiliate", () => {
  it("newest agreement per affiliate wins", () => {
    const m = pickAddendumPerAffiliate([
      { id: 3, affiliate_id: 7 },
      { id: 9, affiliate_id: 7 },
      { id: 4, affiliate_id: 8 },
    ]);
    expect([...m.entries()].map(([k, v]) => [k, v.id])).toEqual([
      [7, 9],
      [8, 4],
    ]);
  });
});

describe("renderAddendum", () => {
  it("fills known placeholders and leaves unknown ones visible", () => {
    const out = renderAddendum("Pay {{ rate_per_sqft }} to {{affiliate_name}} on {{events}} {{oops}}", { rate_per_sqft: "$2.00", affiliate_name: "Brenda", events: "Fontana night" });
    expect(out).toBe("Pay $2.00 to Brenda on Fontana night {{oops}}");
    expect(unfilledPlaceholders(out)).toEqual(["oops"]);
  });
});
