import { describe, expect, it } from "vitest";
import en from "./en/translation.json";
import es from "./es/translation.json";

/**
 * House style: customer-facing copy never joins sentences with " — " (use a
 * period, a comma, or " · " for title separators). Staff-only admin namespaces
 * are exempt; a lone "—" (empty-value placeholder) is fine.
 */
const STAFF_ONLY = new Set([
  "admin",
  "cc",
  "billAdmin",
  "duplicates",
  "clientRevert",
  "personConflict",
  "templates",
  "conversations",
  "phoneLine",
  "calendar",
  "picker",
  "erase",
  "appt",
]);

function offenders(tree: Record<string, unknown>): string[] {
  const out: string[] = [];
  const walk = (node: unknown, path: string) => {
    if (typeof node === "string") {
      if (node.includes(" — ")) out.push(path);
    } else if (node && typeof node === "object") {
      for (const [k, v] of Object.entries(node)) walk(v, path ? `${path}.${k}` : k);
    }
  };
  for (const [ns, v] of Object.entries(tree)) if (!STAFF_ONLY.has(ns)) walk(v, ns);
  return out;
}

describe("copy style", () => {
  it("customer-facing EN copy has no ' — ' joins", () => {
    expect(offenders(en as Record<string, unknown>)).toEqual([]);
  });
  it("customer-facing ES copy has no ' — ' joins", () => {
    expect(offenders(es as Record<string, unknown>)).toEqual([]);
  });
});
