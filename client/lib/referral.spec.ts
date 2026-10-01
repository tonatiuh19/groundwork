import { describe, expect, it, vi, afterEach } from "vitest";
import { buildAffiliateTrackingUrl } from "./referral";

describe("buildAffiliateTrackingUrl", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("prefers slug over referral code and uses the current origin", () => {
    vi.stubGlobal("window", { location: { origin: "https://localhost:8080" } });
    expect(
      buildAffiliateTrackingUrl({
        referral_code: "TONATEST1",
        slug: "tonatiuh-gomez",
      }),
    ).toBe("https://localhost:8080/r/tonatiuh-gomez");
  });

  it("falls back to referral code and appends landing targets", () => {
    expect(
      buildAffiliateTrackingUrl({
        referral_code: "ABC123",
        slug: null,
        landing: "partners",
        origin: "http://localhost:8080",
      }),
    ).toBe("http://localhost:8080/r/ABC123?to=partners");
  });
});
