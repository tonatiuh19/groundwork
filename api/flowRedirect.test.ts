import { describe, expect, it } from "vitest";
import { isSafeFlowRedirect } from "./index";

describe("tracked flow links only redirect to this site", () => {
  it("allows same-site paths and our own origin", () => {
    expect(isSafeFlowRedirect("/start?t=abc")).toBe(true);
    expect(isSafeFlowRedirect("/affiliate/onboarding/x")).toBe(true);
  });
  it("blocks protocol-relative, backslash, other origins and lookalike hosts", () => {
    expect(isSafeFlowRedirect("//evil.com/x")).toBe(false);
    expect(isSafeFlowRedirect("/\\evil.com")).toBe(false);
    expect(isSafeFlowRedirect("https://evil.com/")).toBe(false);
    expect(isSafeFlowRedirect("https://groundworkcapitalgroup.com.evil.com/")).toBe(false);
    expect(isSafeFlowRedirect("javascript:alert(1)")).toBe(false);
    expect(isSafeFlowRedirect("")).toBe(false);
  });
});
