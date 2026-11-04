import { describe, expect, it } from "vitest";
import { affiliateMissingItems, affiliateOnboardingSeed, seedFlowGraph } from "./index";

describe("affiliate onboarding sequence", () => {
  const seed = affiliateOnboardingSeed();
  const graph = seedFlowGraph(seed);
  const text = JSON.stringify(seed.touches);

  it("alerts staff at the end and never closes an application", () => {
    expect(graph.steps.some((s) => s.step_type === "close")).toBe(false);
    expect(graph.steps[graph.steps.length - 1].step_type).toBe("notify_staff");
    expect(text).not.toMatch(/48 hours|48 horas|will be closed|se cerrará|Thanks for signing up|since you signed up/i);
  });

  it("every touch names what's missing, keeps STOP on texts, and has no long dashes", () => {
    for (const t of seed.touches) {
      for (const m of [...(t.sms || []), ...(t.email?.body || [])]) expect(m).toContain("{{missing_items}}");
      for (const m of t.sms || []) expect(m).toMatch(/STOP/);
    }
    expect(text).not.toContain("—");
  });

  it("lists only what's still owed", () => {
    expect(affiliateMissingItems({ agreement_signed: false, w9_status: "missing", billing_ready: false }, "en")).toEqual(["your signed agreement", "your W-9", "your card"]);
    expect(affiliateMissingItems({ agreement_signed: true, w9_status: "submitted", billing_ready: false }, "es")).toEqual(["su tarjeta"]);
    expect(affiliateMissingItems({ agreement_signed: true, w9_status: "accepted", billing_ready: true }, "en")).toEqual([]);
  });
});
