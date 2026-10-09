import { describe, expect, it } from "vitest";
import { __test, isSandboxSafeEmail, notifySandbox } from "./index";

describe("email delivery gate", () => {
  it("never delivers live email when VITEST=true", () => {
    const prevVitest = process.env.VITEST;
    const prevNotify = process.env.NOTIFY_EMAILS;
    process.env.VITEST = "true";
    process.env.NOTIFY_EMAILS = "true";
    expect(__test.shouldDeliverEmail()).toBe(false);
    process.env.VITEST = prevVitest;
    process.env.NOTIFY_EMAILS = prevNotify;
  });

  it("delivers when Resend is configured and not under Vitest", () => {
    const prevVitest = process.env.VITEST;
    const prevKey = process.env.RESEND_API_KEY;
    const prevNotify = process.env.NOTIFY_EMAILS;
    delete process.env.VITEST;
    process.env.RESEND_API_KEY = "re_test_key";
    delete process.env.NOTIFY_EMAILS;
    expect(__test.shouldDeliverEmail()).toBe(true);
    process.env.VITEST = prevVitest;
    process.env.RESEND_API_KEY = prevKey;
    process.env.NOTIFY_EMAILS = prevNotify;
  });

  it("dry-runs when NOTIFY_EMAILS=false even with a Resend key", () => {
    const prevVitest = process.env.VITEST;
    const prevKey = process.env.RESEND_API_KEY;
    const prevNotify = process.env.NOTIFY_EMAILS;
    delete process.env.VITEST;
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.NOTIFY_EMAILS = "false";
    expect(__test.shouldDeliverEmail()).toBe(false);
    process.env.VITEST = prevVitest;
    process.env.RESEND_API_KEY = prevKey;
    process.env.NOTIFY_EMAILS = prevNotify;
  });

  it("dry-runs when RESEND_API_KEY is missing", () => {
    const prevVitest = process.env.VITEST;
    const prevKey = process.env.RESEND_API_KEY;
    const prevNotify = process.env.NOTIFY_EMAILS;
    delete process.env.VITEST;
    delete process.env.RESEND_API_KEY;
    delete process.env.NOTIFY_EMAILS;
    expect(__test.shouldDeliverEmail()).toBe(false);
    process.env.VITEST = prevVitest;
    process.env.RESEND_API_KEY = prevKey;
    process.env.NOTIFY_EMAILS = prevNotify;
  });

  it("NOTIFY_SANDBOX=true dry-runs local QA even with a live Resend key", () => {
    const prevVitest = process.env.VITEST;
    const prevKey = process.env.RESEND_API_KEY;
    const prevSandbox = process.env.NOTIFY_SANDBOX;
    delete process.env.VITEST;
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.NOTIFY_SANDBOX = "true";
    expect(notifySandbox()).toBe(true);
    expect(__test.shouldDeliverEmail()).toBe(false);
    delete process.env.NOTIFY_SANDBOX;
    expect(notifySandbox()).toBe(false);
    process.env.VITEST = prevVitest;
    process.env.RESEND_API_KEY = prevKey;
    if (prevSandbox === undefined) delete process.env.NOTIFY_SANDBOX;
    else process.env.NOTIFY_SANDBOX = prevSandbox;
  });

  it("sandbox staff fan-out only reaches test fixture emails", () => {
    expect(notifySandbox()).toBe(true); // Vitest
    expect(isSandboxSafeEmail("QA.Admin@Example.com")).toBe(true);
    expect(isSandboxSafeEmail("ops@example.test")).toBe(true);
    expect(isSandboxSafeEmail("teamdc@encoremortgage.org")).toBe(false);
    expect(isSandboxSafeEmail("someone@example.com.evil.io")).toBe(false);
  });
});
