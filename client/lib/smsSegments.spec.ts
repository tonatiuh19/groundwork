import { describe, expect, it } from "vitest";
import { smsSegmentInfo } from "./smsSegments";

describe("smsSegmentInfo", () => {
  it("counts GSM segments", () => {
    expect(smsSegmentInfo("Hello").segments).toBe(1);
    expect(smsSegmentInfo("a".repeat(161)).segments).toBe(2);
  });

  it("uses UCS-2 when non-ASCII present", () => {
    const info = smsSegmentInfo("Hola ¡");
    expect(info.encoding).toBe("ucs2");
    expect(info.segments).toBeGreaterThanOrEqual(1);
  });
});
