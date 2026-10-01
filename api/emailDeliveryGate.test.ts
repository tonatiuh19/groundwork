import { describe, expect, it } from "vitest";
import { __test } from "./index";

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
});
