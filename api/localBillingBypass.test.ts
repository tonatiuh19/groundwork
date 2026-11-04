import { afterEach, describe, expect, it } from "vitest";
import { localBillingBypass } from "./index";

/** BILLING_BYPASS_EMAILS is a local-dev convenience; it must never apply in tests, prod or on Vercel. */
describe("localBillingBypass", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it("never applies under Vitest, on Vercel or in production", () => {
    process.env.BILLING_BYPASS_EMAILS = "a@example.com";
    expect(localBillingBypass("a@example.com")).toBe(false); // VITEST=true
    process.env.VITEST = "false";
    process.env.VERCEL = "1";
    expect(localBillingBypass("a@example.com")).toBe(false);
    delete process.env.VERCEL;
    process.env.NODE_ENV = "production";
    expect(localBillingBypass("a@example.com")).toBe(false);
  });

  it("matches listed emails locally, case-insensitive", () => {
    process.env.VITEST = "false";
    delete process.env.VERCEL;
    process.env.NODE_ENV = "development";
    process.env.BILLING_BYPASS_EMAILS = " A@Example.com , b@example.com";
    expect(localBillingBypass("a@example.com")).toBe(true);
    expect(localBillingBypass("c@example.com")).toBe(false);
    expect(localBillingBypass(null)).toBe(false);
  });
});
