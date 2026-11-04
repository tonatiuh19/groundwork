import { readdirSync, readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

/**
 * Static guard for tests that write to the shared TiDB. Cleanup finds test data by
 * signature (gw<suite>-<ts>- emails, @example.com / @example.test, +1555 numbers);
 * a fixture outside the signature is invisible to cleanup and stays in front of real
 * staff (e.g. a test phone line "+1888…" left "hi from Jaz" threads in the live inbox).
 */
const ROOTS = [path.join(__dirname), path.join(__dirname, "..", "scripts")];
const files = ROOTS.flatMap((dir) =>
  readdirSync(dir)
    .filter((f) => /\.(test|spec)\.ts$|\.mts$/.test(f) && f !== "testFixtureRules.test.ts")
    .map((f) => path.join(dir, f)),
);

/** Every phone number a test assigns to a staff phone line must be a fictional +1555 number. */
function lineNumberViolations(file: string): string[] {
  const src = readFileSync(file, "utf8");
  const out: string[] = [];
  const re = /INSERT INTO admin_phone_numbers/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    // Just this statement: up to the end of the insert call (`);`).
    const end = src.indexOf(");", m.index);
    const block = src.slice(m.index, end === -1 ? m.index + 500 : end);
    for (const lit of block.match(/\+1\d{3}/g) ?? []) {
      if (lit !== "+1555") out.push(`${path.basename(file)}: line number literal ${lit}… (use +1555)`);
    }
    // Variables passed as the number: their declaration must be +1555 too.
    for (const id of new Set(block.match(/\b[a-zA-Z_]*[eE]164[a-zA-Z_]*\b/g) ?? [])) {
      if (id === "e164") continue; // column name
      const decl = new RegExp(`(?:const|let)\\s+${id}\\s*=\\s*([^;\\n]+)`).exec(src);
      if (decl && /\+1\d{3}/.test(decl[1]) && !/\+1555/.test(decl[1])) {
        out.push(`${path.basename(file)}: ${id} = ${decl[1].trim()} (use +1555)`);
      }
    }
  }
  return out;
}

describe("test fixture rules (shared DB)", () => {
  it("found the test files", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it("test phone lines always use fictional +1555 numbers (cleanup only removes those)", () => {
    expect(files.flatMap(lineNumberViolations)).toEqual([]);
  });
});
