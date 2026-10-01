import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "..");
const load = (l: string) =>
  JSON.parse(readFileSync(path.join(__dirname, l, "translation.json"), "utf8"));

function flatten(o: unknown, p = ""): Record<string, string> {
  if (typeof o === "string") return { [p]: o };
  return Object.entries(o as object).reduce(
    (acc, [k, v]) => ({ ...acc, ...flatten(v, p ? `${p}.${k}` : k) }),
    {} as Record<string, string>,
  );
}

function walk(dir: string, out: string[] = []) {
  for (const f of readdirSync(dir)) {
    const full = path.join(dir, f);
    if (statSync(full).isDirectory()) {
      if (f !== "locales" && f !== "test") walk(full, out);
    } else if (/\.(tsx?|ts)$/.test(f) && !/\.spec\./.test(f)) out.push(full);
  }
  return out;
}

const en = flatten(load("en"));
const es = flatten(load("es"));

const PORTAL_NAMESPACES = [
  "pf",
  "admin",
  "aff",
  "affSignup",
  "ctr",
  "ctrInvite",
  "cli",
  "portalNav",
  "portalAuth",
  "portalDash",
  "role",
  "milestone",
  "loan",
  "lenderType",
  "leadStatus",
  "accountStatus",
  "drawStatus",
  "commStatus",
  "contractStatus",
  "contractKind",
  "actor",
];

describe("i18n", () => {
  it("EN and ES have identical keys", () => {
    expect(Object.keys(es).sort()).toEqual(Object.keys(en).sort());
  });

  it("keeps the same {{placeholders}} in both languages", () => {
    const ph = (s: string) => (s.match(/\{\{\w+\}\}/g) || []).sort().join();
    for (const k of Object.keys(en)) expect(ph(es[k]), k).toBe(ph(en[k]));
  });

  it("every statically referenced key exists", () => {
    const re =
      /(?:\bt\(\s*|\w*Key\s*[:=]\s*\{?\s*)["'`]([A-Za-z]\w*(?:\.\w+)+)["'`]/g;
    const missing: string[] = [];
    for (const file of walk(root)) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(re)) {
        if (!(m[1] in en))
          missing.push(`${m[1]} (${path.relative(root, file)})`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("every portal key-like string literal exists (catches keys passed via arrays/props)", () => {
    const q = "[\"'\u0060]";
    const re = new RegExp(
      q +
        "((?:" +
        PORTAL_NAMESPACES.join("|") +
        ")\\.[A-Za-z_-]+(?:\\.[A-Za-z_-]+)*)" +
        q,
      "g",
    );
    const missing: string[] = [];
    for (const file of walk(root)) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(re)) {
        if (!(m[1] in en))
          missing.push(`${m[1]} (${path.relative(root, file)})`);
      }
    }
    expect(missing).toEqual([]);
  });
});
