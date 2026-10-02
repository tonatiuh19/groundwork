/**
 * Pure unit tests (no DB): milestone state machine, photo URL allow-list,
 * image sniffing, contract PDF builder, and route ↔ swagger parity.
 */
import fs from "fs";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { __test, createServer } from "./index";

const {
  assertMilestoneTransition,
  MILESTONE_TRANSITIONS,
  buildContractPdf,
  isAllowedPhotoUrl,
  detectImageType,
} = __test;

const ALL = ["lead", "financing", "contracted", "in_build", "closed", "cancelled"] as const;

function transitionError(from: unknown, to: unknown): { status: number; key: string } | null {
  try {
    assertMilestoneTransition(from, to);
    return null;
  } catch (e: any) {
    return { status: e.status, key: e.key };
  }
}

describe("assertMilestoneTransition", () => {
  it("allows the documented moves and nothing else (full 6x6 matrix)", () => {
    const allowed: Record<string, string[]> = {
      lead: ["financing", "contracted", "cancelled"],
      financing: ["lead", "contracted", "cancelled"],
      contracted: ["financing", "in_build", "cancelled"],
      in_build: ["contracted", "closed", "cancelled"],
      closed: ["in_build"],
      cancelled: ["lead"],
    };
    for (const from of ALL) {
      for (const to of ALL) {
        const err = transitionError(from, to);
        if (from === to || allowed[from].includes(to)) {
          expect(err, `${from} → ${to}`).toBeNull();
        } else {
          expect(err, `${from} → ${to}`).toEqual({ status: 409, key: "errors.invalidTransition" });
        }
      }
    }
    expect(MILESTONE_TRANSITIONS.closed).toEqual(["in_build"]);
  });

  it("stays in sync with shared/api MILESTONE_TRANSITIONS (API cannot import shared runtime)", async () => {
    const shared = await import("../shared/api");
    expect(shared.MILESTONE_TRANSITIONS).toEqual(MILESTONE_TRANSITIONS);
    expect(shared.BOARD_MILESTONES).toEqual([...ALL]);
  });

  it("blocks the audited hole: closed can no longer jump back to lead", () => {
    expect(transitionError("closed", "lead")?.key).toBe("errors.invalidTransition");
    expect(transitionError("closed", "financing")?.key).toBe("errors.invalidTransition");
    expect(transitionError("lead", "in_build")?.key).toBe("errors.invalidTransition");
    expect(transitionError("lead", "closed")?.key).toBe("errors.invalidTransition");
  });

  it("rejects unknown milestones with 400", () => {
    expect(transitionError("lead", "nonsense")).toEqual({ status: 400, key: "validation.invalidField" });
    expect(transitionError(null, "lead")?.status).toBe(400);
    expect(transitionError("lead", undefined)?.status).toBe(400);
  });

  it("every stage can be cancelled except closed/cancelled themselves", () => {
    for (const from of ["lead", "financing", "contracted", "in_build"] as const) {
      expect(transitionError(from, "cancelled")).toBeNull();
    }
    expect(transitionError("closed", "cancelled")?.status).toBe(409);
  });
});

describe("isAllowedPhotoUrl", () => {
  afterEach(() => {
    delete process.env.PHOTO_URL_ALLOWED_HOSTS;
  });

  it("accepts Vercel Blob public URLs only by default", () => {
    expect(isAllowedPhotoUrl("https://abc123.public.blob.vercel-storage.com/projects/x.jpg")).toBe(true);
    expect(isAllowedPhotoUrl("https://public.blob.vercel-storage.com/x.jpg")).toBe(true);
    expect(isAllowedPhotoUrl("https://example.com/p.jpg")).toBe(false);
  });

  it("rejects lookalike hosts, non-https, credentials, ports, junk and oversize", () => {
    const bad = [
      "http://abc.public.blob.vercel-storage.com/x.jpg",
      "javascript:alert(1)",
      "data:image/png;base64,AAAA",
      "https://evilpublic.blob.vercel-storage.com/x.jpg",
      "https://public.blob.vercel-storage.com.evil.com/x.jpg",
      "https://user:pw@abc.public.blob.vercel-storage.com/x.jpg",
      "https://abc.public.blob.vercel-storage.com:8443/x.jpg",
      "not a url",
      "",
      null,
      undefined,
      `https://abc.public.blob.vercel-storage.com/${"a".repeat(1000)}`,
    ];
    for (const u of bad) expect(isAllowedPhotoUrl(u), String(u)).toBe(false);
  });

  it("honours PHOTO_URL_ALLOWED_HOSTS (subdomains included)", () => {
    process.env.PHOTO_URL_ALLOWED_HOSTS = "cdn.example.org, .media.test";
    expect(isAllowedPhotoUrl("https://cdn.example.org/a.jpg")).toBe(true);
    expect(isAllowedPhotoUrl("https://x.cdn.example.org/a.jpg")).toBe(true);
    expect(isAllowedPhotoUrl("https://a.media.test/a.jpg")).toBe(true);
    expect(isAllowedPhotoUrl("https://example.org/a.jpg")).toBe(false);
  });
});

describe("detectImageType", () => {
  it("detects JPEG, PNG and WebP by magic bytes", () => {
    expect(detectImageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]))?.mime).toBe("image/jpeg");
    expect(
      detectImageType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))?.mime,
    ).toBe("image/png");
    const webp = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBPVP8 ")]);
    expect(detectImageType(webp)).toEqual({ mime: "image/webp", ext: "webp" });
  });

  it("rejects scripts, HTML, SVG, GIF, empty and truncated buffers", () => {
    for (const b of [
      Buffer.from("<script>alert(1)</script>"),
      Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"),
      Buffer.from("GIF89a"),
      Buffer.alloc(0),
      Buffer.from([0xff, 0xd8]),
      Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WAVE")]),
    ]) {
      expect(detectImageType(b)).toBeNull();
    }
  });
});

// ── PDF ──────────────────────────────────────────────────────────────────────

const payload = {
  project: "GW-ABCD2345",
  generated_on: "2026-09-30",
  property: { address: "123 Calle Niño (Unit #4) \\ Back", city: "Fontana", state: "CA", zip: "92335" },
  plan: { name: "Fontana 1BR — “Classic”", sq_ft: 550, bedrooms: 1, bathrooms: "1.0" },
  client: { name: "José Peña", email: "jose@example.com", phone: "9495551234" },
  contractor: { name: "Ana Ruiz", company: "Ruiz Builders", license: "CA-123", email: "ana@example.com" },
  contract_price_cents: 20_000_000,
};

/** Structural validation: header, xref offsets point at `N 0 obj`, trailer, EOF. */
function assertValidPdf(buf: Buffer): { pages: number; text: string } {
  const s = buf.toString("latin1");
  expect(s.startsWith("%PDF-1.4\n")).toBe(true);
  expect(s.trimEnd().endsWith("%%EOF")).toBe(true);
  const startxref = Number(/startxref\n(\d+)\n%%EOF/.exec(s)![1]);
  expect(s.slice(startxref, startxref + 4)).toBe("xref");
  const m = /xref\n0 (\d+)\n/.exec(s.slice(startxref))!;
  const count = Number(m[1]);
  const entries = s
    .slice(startxref + m[0].length)
    .split("\n")
    .slice(0, count);
  expect(entries[0]).toBe("0000000000 65535 f ");
  entries.slice(1).forEach((line, i) => {
    expect(line).toMatch(/^\d{10} 00000 n $/);
    const off = Number(line.slice(0, 10));
    expect(s.slice(off, off + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`);
  });
  // every stream /Length matches its bytes
  for (const sm of s.matchAll(/<< \/Length (\d+) >>\nstream\n([\s\S]*?)\nendstream/g)) {
    expect(sm[2].length).toBe(Number(sm[1]));
  }
  const pages = Number(/\/Count (\d+)/.exec(s)![1]);
  expect((s.match(/\/Type \/Page /g) || []).length).toBe(pages);
  return { pages, text: s };
}

describe("buildContractPdf", () => {
  it("produces a structurally valid PDF with correct xref offsets", () => {
    const pdf = buildContractPdf({ payload, kind: "contractor_client", status: "generated", lang: "en" });
    expect(Buffer.isBuffer(pdf)).toBe(true);
    const { text } = assertValidPdf(pdf);
    expect(text).toContain("(Construction Agreement Summary)");
    expect(text).toContain("GW-ABCD2345");
    expect(text).toContain("$200,000.00");
  });

  it("is deterministic (same input → same bytes)", () => {
    const a = buildContractPdf({ payload, kind: "contractor_client", status: "signed", lang: "es" });
    const b = buildContractPdf({ payload, kind: "contractor_client", status: "signed", lang: "es" });
    expect(a.equals(b)).toBe(true);
  });

  it("localises copy and keeps accents (WinAnsi octal escapes)", () => {
    const es = buildContractPdf({ payload, kind: "contractor_client", status: "signed", lang: "es" });
    const { text } = assertValidPdf(es);
    expect(text).toContain("Resumen del contrato de construcci\\363n"); // ó = 0o363
    expect(text).toContain("Jos\\351 Pe\\361a"); // é = 0o351, ñ = 0o361
    expect(text).toContain("Firmado");
    const en = assertValidPdf(buildContractPdf({ payload, kind: "affiliate_terms", status: "void", lang: "en" }));
    expect(en.text).toContain("(Affiliate Terms Summary)");
    expect(en.text).toContain("Void");
  });

  it("escapes PDF metacharacters and neutralises control / non-Latin-1 chars", () => {
    const pdf = buildContractPdf({
      payload: {
        ...payload,
        client: { name: "a)b(c\\d\u0000e\n漢字", email: null, phone: undefined },
      },
      kind: "other",
      status: "generated",
      lang: "en",
    });
    const { text } = assertValidPdf(pdf);
    expect(text).toContain("a\\)b\\(c\\\\d?e ??");
    // no raw non-ASCII bytes inside content streams
    for (const sm of text.matchAll(/stream\n([\s\S]*?)\nendstream/g)) {
      expect(/^[\x09\x0a\x20-\x7e]*$/.test(sm[1])).toBe(true);
    }
  });

  it("paginates long content and numbers every page footer", () => {
    const long = buildContractPdf({
      payload: { ...payload, property: { address: "word ".repeat(1200) } },
      kind: "contractor_client",
      status: "generated",
      lang: "en",
    });
    const { pages, text } = assertValidPdf(long);
    expect(pages).toBeGreaterThan(2);
    for (let i = 1; i <= pages; i++) expect(text).toContain(`Page ${i} of ${pages}`);
  });

  it("tolerates a minimal / empty payload (no contractor, no plan)", () => {
    const pdf = buildContractPdf({ payload: {}, kind: "weird", status: "draft", lang: "en" });
    const { text } = assertValidPdf(pdf);
    expect(text).toContain("(Project Document)");
    expect(text).not.toContain("Contractor — Signature");
    // null-ish price prints an em dash (WinAnsi 0x97 = \227), never NaN/undefined
    expect(text).not.toMatch(/NaN|undefined|null/);
  });
});

// ── Route ↔ swagger parity ───────────────────────────────────────────────────

function registeredRoutes(): Set<string> {
  const app: any = createServer();
  const out = new Set<string>();
  for (const layer of app.router.stack) {
    if (!layer.route) continue;
    const paths: string[] = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
    for (const p of paths) {
      for (const method of Object.keys(layer.route.methods)) {
        if (layer.route.methods[method]) out.add(`${method} ${p.replace(/:(\w+)/g, "{$1}")}`);
      }
    }
  }
  return out;
}

function documentedRoutes(): Set<string> {
  const yaml = fs.readFileSync(path.resolve(__dirname, "swagger.yaml"), "utf8");
  const out = new Set<string>();
  let current: string | null = null;
  for (const line of yaml.split("\n")) {
    const p = /^ {2}(\/\S*):\s*$/.exec(line);
    if (p) {
      current = p[1];
      continue;
    }
    const m = /^ {4}(get|post|put|patch|delete|options):\s*$/.exec(line);
    if (m && current) out.add(`${m[1]} ${current}`);
  }
  return out;
}

describe("swagger parity", () => {
  it("documents every registered route and nothing that does not exist", () => {
    const registered = registeredRoutes();
    const documented = documentedRoutes();
    const undocumented = [...registered].filter((r) => !documented.has(r)).sort();
    expect(registered.size).toBeGreaterThan(60);
    expect(documented.size).toBeGreaterThan(60);
    const phantom = [...documented].filter((r) => !registered.has(r)).sort();
    expect({ undocumented, phantom }).toEqual({ undocumented: [], phantom: [] });
  });
});
