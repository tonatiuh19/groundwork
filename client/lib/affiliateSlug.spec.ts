import { describe, expect, it } from "vitest";
import {
  baseSlugFromAffiliateName,
  isReservedAffiliateSlug,
  isValidAffiliateSlugFormat,
  slugifyAffiliate,
} from "./affiliateSlug";

describe("slugifyAffiliate", () => {
  it("strips accents and dashes names", () => {
    expect(slugifyAffiliate("María López")).toBe("maria-lopez");
    expect(slugifyAffiliate("  Tonatiuh  Gómez! ")).toBe("tonatiuh-gomez");
  });

  it("collapses junk to single dashes", () => {
    expect(slugifyAffiliate("Ann--Marie")).toBe("ann-marie");
  });
});

describe("baseSlugFromAffiliateName", () => {
  it("uses firstname-lastname", () => {
    expect(baseSlugFromAffiliateName("Maria", "Lopez")).toBe("maria-lopez");
  });

  it("falls back for tiny names", () => {
    expect(baseSlugFromAffiliateName("Jo", "Li").length).toBeGreaterThanOrEqual(3);
  });
});

describe("isValidAffiliateSlugFormat", () => {
  it("requires 3–64, no edge dashes", () => {
    expect(isValidAffiliateSlugFormat("ab")).toBe(false);
    expect(isValidAffiliateSlugFormat("-abc")).toBe(false);
    expect(isValidAffiliateSlugFormat("abc-")).toBe(false);
    expect(isValidAffiliateSlugFormat("maria-lopez")).toBe(true);
    expect(isValidAffiliateSlugFormat("maria-lopez-2")).toBe(true);
  });
});

describe("isReservedAffiliateSlug", () => {
  it("blocks route-ish words", () => {
    expect(isReservedAffiliateSlug("admin")).toBe(true);
    expect(isReservedAffiliateSlug("expired")).toBe(true);
    expect(isReservedAffiliateSlug("maria-lopez")).toBe(false);
  });
});
