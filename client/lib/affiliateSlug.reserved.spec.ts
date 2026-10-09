import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { AFFILIATE_RESERVED_SLUGS as CANONICAL } from "@shared/affiliateSlugReserved";
import { AFFILIATE_RESERVED_SLUGS as CLIENT_SET } from "./affiliateSlug";

/** Parse `const AFFILIATE_RESERVED_SLUGS = new Set([ ... ])` from api/index.ts. */
function parseApiReservedSlugs(): string[] {
  const src = fs.readFileSync(
    path.resolve(__dirname, "../../api/index.ts"),
    "utf8",
  );
  const start = src.indexOf("const AFFILIATE_RESERVED_SLUGS = new Set([");
  expect(start).toBeGreaterThanOrEqual(0);
  const from = src.indexOf("[", start);
  const end = src.indexOf("]);", from);
  expect(end).toBeGreaterThan(from);
  const body = src.slice(from + 1, end);
  return [...body.matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort();
}

describe("affiliate reserved slug list drift", () => {
  it("shared canonical matches client Set and api/index.ts inline Set", () => {
    const canonical = [...CANONICAL].slice().sort();
    const client = [...CLIENT_SET].slice().sort();
    const api = parseApiReservedSlugs();
    expect(client).toEqual(canonical);
    expect(api).toEqual(canonical);
  });
});
