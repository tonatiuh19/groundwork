import crypto from "crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { PNG } from "pngjs";
import { PDFDocument } from "pdf-lib";

// ── In-memory private Blob store: signed PDFs never leave the test ───────────
const blobStore = vi.hoisted(() => new Map<string, Buffer>());
vi.mock("@vercel/blob", async (orig) => {
  const real = await orig<typeof import("@vercel/blob")>();
  return {
    ...real,
    put: vi.fn(async (pathname: string, body: Buffer) => {
      blobStore.set(pathname, Buffer.from(body));
      return { url: `https://store.private.blob.vercel-storage.com/${pathname}`, pathname };
    }),
    issueSignedToken: vi.fn(async () => ({ clientSigningToken: "c", delegationToken: "d", validUntil: 0 })),
    presignUrl: vi.fn(async (_t: unknown, o: { pathname: string }) => ({
      presignedUrl: `https://store.private.blob.vercel-storage.com/${o.pathname}?sig=1`,
    })),
  };
});

process.env.BLOB_PRIVATE_READ_WRITE_TOKEN = "vercel_blob_rw_test_private";

import { __test, createServer } from "./index";
import { cleanupPortalFixturesByPrefix, createIntegrationTestPool } from "./testDbCleanup";

const hasDb = Boolean(process.env.DB_HOST && process.env.DB_USER && process.env.DB_NAME);

/** Real PNG (pdf-lib embeds it) — a short stroke. */
function signaturePng(): string {
  const png = new PNG({ width: 120, height: 40 });
  for (let x = 5; x < 115; x++) {
    const i = ((20 + Math.round(8 * Math.sin(x / 9))) * 120 + x) * 4;
    png.data[i] = 14;
    png.data[i + 3] = 255;
  }
  return `data:image/png;base64,${PNG.sync.write(png).toString("base64")}`;
}

describe("affiliate onboarding (pure)", () => {
  it("validates SSN / EIN shapes", () => {
    expect(__test.validateTin("ssn", "123-45-6789")).toBe("123456789");
    for (const bad of ["000-12-3456", "666-12-3456", "900-12-3456", "123-00-4567", "123-45-0000", "111111111", "12345678"]) {
      expect(__test.validateTin("ssn", bad)).toBeNull();
    }
    expect(__test.validateTin("ein", "12-3456789")).toBe("123456789");
    expect(__test.validateTin("ein", "07-1234567")).toBeNull();
  });

  it("fills agreement placeholders and leaves unknown ones visible", () => {
    const out = __test.renderAffiliateAgreement("On {{effective_date}} {{affiliate_party}} pays {{subscription_price}} {{nope}}", {
      effective_date: "October 15, 2026",
      party: { legal_name: "Ana Ruiz", business_name: "Ruiz Realty", address: "1 Main St, Irvine, CA", phone: "9495550100", email: "ana@example.com" },
      subscription_price_cents: 4950,
    });
    expect(out).toBe("On October 15, 2026 Ana Ruiz (Ruiz Realty), 1 Main St, Irvine, CA, 9495550100, ana@example.com pays $49.50 {{nope}}");
  });

  it("v1 template: no reviewer notes, Orange County, all placeholders, both languages", () => {
    for (const l of ["en", "es"] as const) {
      const body = __test.AFFILIATE_AGREEMENT_V1[l];
      expect(body).toContain("{{effective_date}}");
      expect(body).toContain("{{affiliate_party}}");
      expect(body).toContain("{{subscription_price}}");
      expect(body).toMatch(/Orange/);
      expect(body).not.toMatch(/Review notes|Notas de revisión|\[county\]|\[condado\]|\[amount\]|\[cantidad\]/);
      expect(body).toContain("| 830"); // Section 5 fee table
    }
  });

  it("fills the official IRS W-9 (TIN only inside the PDF)", async () => {
    const sig = Buffer.from(signaturePng().split(",")[1], "base64");
    const pdf = await __test.buildW9Pdf({
      legal_name: "Ana Ruiz", business_name: null, tax_classification: "individual", llc_tax_class: null,
      other_classification: null, foreign_partners: false, exempt_payee_code: null, fatca_code: null,
      address: "1 Main St", city_state_zip: "Irvine, CA 92618", tin_type: "ssn", tin: "123456789",
      signature_png: sig, signed_at: new Date("2026-10-15T18:00:00Z"),
    });
    const doc = await PDFDocument.load(pdf);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(6);
    expect(doc.getForm().getFields()).toHaveLength(0); // flattened
  });
});

describe.runIf(hasDb)("affiliate onboarding (integration)", () => {
  const app = createServer();
  const db = createIntegrationTestPool();
  const prefix = `gwaob-${Date.now()}-`;
  const em = (n: string) => `${prefix}${n}@example.com`;
  const runPhone = String(100 + Math.floor(Math.random() * 900));
  let affId = 0;
  let pendingId = 0;
  let affCookie = "";
  let pendingCookie = "";
  let superCookie = "";
  let agentCookie = "";
  let commissionId = 0;

  const session = async (actor: "admin" | "affiliate", id: number) => {
    const token = crypto.randomBytes(32).toString("hex");
    await db.execute(
      `INSERT INTO \`${actor}_sessions\` (\`${actor}_id\`, token_hash, expires_at) VALUES (?, ?, ?)`,
      [id, crypto.createHash("sha256").update(token).digest("hex"), new Date(Date.now() + 86_400_000)],
    );
    return `gw_${actor}_sid=${token}`;
  };
  const insertId = async (sql: string, params: unknown[]) => {
    const [r] = await db.execute(sql, params as any[]);
    return Number((r as { insertId: number }).insertId);
  };
  const as = (c: string) => ({
    get: (u: string) => request(app).get(u).set("Cookie", c),
    post: (u: string) => request(app).post(u).set("Cookie", c),
    patch: (u: string) => request(app).patch(u).set("Cookie", c),
  });

  beforeAll(async () => {
    process.env.VITEST = "true";
    const code = () => `T${crypto.randomBytes(5).toString("hex").toUpperCase()}`;
    affId = await insertId(
      `INSERT INTO affiliates (email, first_name, last_name, phone, status, referral_code) VALUES (?, 'Ana', 'Ruiz', ?, 'active', ?)`,
      [em("ana"), `949${runPhone}0101`, code()],
    );
    pendingId = await insertId(
      `INSERT INTO affiliates (email, first_name, last_name, status, referral_code) VALUES (?, 'Pat', 'Pending', 'pending', ?)`,
      [em("pending"), code()],
    );
    affCookie = await session("affiliate", affId);
    pendingCookie = await session("affiliate", pendingId);
    const superId = await insertId(
      `INSERT INTO admins (email, first_name, last_name, role, status) VALUES (?, 'S', 'Admin', 'super_admin', 'active')`,
      [em("super")],
    );
    const agentId = await insertId(
      `INSERT INTO admins (email, first_name, last_name, role, status) VALUES (?, 'A', 'Agent', 'agent', 'active')`,
      [em("agent")],
    );
    superCookie = await session("admin", superId);
    agentCookie = await session("admin", agentId);
    // A finalized deal with an approved commission waiting to be paid.
    const clientId = await insertId(
      `INSERT INTO clients (first_name, last_name, email, status) VALUES ('Cli', 'Ent', ?, 'active')`,
      [em("client")],
    );
    const projectId = await insertId(
      `INSERT INTO projects (public_id, client_id, affiliate_id, closer_affiliate_id, sq_ft, loan_status, commission_plan)
       VALUES (?, ?, ?, ?, 445, 'finalized', 'two_level')`,
      [`T${crypto.randomBytes(6).toString("hex").toUpperCase()}`, clientId, affId, affId],
    );
    commissionId = await insertId(
      `INSERT INTO affiliate_commissions (affiliate_id, role, project_id, client_id, amount_cents, sq_ft, rate_cents_per_sqft, status)
       VALUES (?, 'direct', ?, ?, 445000, 445, 1000, 'approved')`,
      [affId, projectId, clientId],
    );
  });

  afterAll(async () => {
    try {
      await cleanupPortalFixturesByPrefix(db, prefix);
    } finally {
      await db.end();
    }
  });

  it("locks signing until approved and priced; payouts held meanwhile", async () => {
    // Pending affiliates cannot open the portal at all (approval comes first).
    await as(pendingCookie).get("/api/affiliate/onboarding").expect(401);
    const fresh = await as(affCookie).get("/api/affiliate/onboarding?lang=es").expect(200);
    expect(fresh.body.state).toMatchObject({ agreement_signed: false, w9_status: "missing", payout_ready: false });
    expect(fresh.body.template.body).toContain("Acuerdo de Afiliados de Groundwork");

    const priceless = await as(affCookie).post("/api/affiliate/onboarding/agreement").send({});
    expect(priceless.body.error).toBe("errors.agreementPricePending");

    const pay = await as(superCookie).patch(`/api/admin/commissions/${commissionId}`).send({ status: "paid" });
    expect(pay.status).toBe(409);
    expect(pay.body.error).toBe("errors.affiliateOnboardingIncomplete");
  });

  it("only approvals can set the price; first price emails the affiliate", async () => {
    await as(agentCookie).patch(`/api/admin/affiliates/${affId}/subscription-price`).send({ subscription_price_cents: 4900 }).expect(403);
    const r = await as(superCookie).patch(`/api/admin/affiliates/${affId}/subscription-price`).send({ subscription_price_cents: 4900 }).expect(200);
    expect(r.body.emailed).toBe(true);
    expect(r.body.state.subscription_price_cents).toBe(4900);
  });

  it("signs in Spanish (with controlling English), stores a private PDF, then W-9 unlocks payouts", async () => {
    const tpl = await as(affCookie).get("/api/affiliate/onboarding?lang=es").expect(200);
    const base = {
      version: tpl.body.template.version, lang: "es", legal_name: "Ana Ruiz", address: "1 Main St, Irvine, CA 92618",
      signature_image: signaturePng(), consent: true,
    };
    await as(affCookie).post("/api/affiliate/onboarding/agreement").send({ ...base, consent: false }).expect(400);
    await as(affCookie).post("/api/affiliate/onboarding/agreement").send({ ...base, signature_image: "data:image/png;base64,AAAA" }).expect(400);
    const stale = await as(affCookie).post("/api/affiliate/onboarding/agreement").send({ ...base, version: base.version + 99 });
    expect(stale.body.error).toBe("errors.agreementVersionChanged");

    const signed = await as(affCookie).post("/api/affiliate/onboarding/agreement").send(base).expect(201);
    expect(signed.body.state.agreement_signed).toBe(true);
    const [[row]] = (await db.query(`SELECT * FROM affiliate_agreements WHERE affiliate_id = ?`, [affId])) as any;
    expect(row).toMatchObject({ lang: "es", subscription_price_cents: 4900, legal_name: "Ana Ruiz" });
    const pdf = blobStore.get(row.pdf_blob_pathname)!;
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect((await PDFDocument.load(pdf)).getPageCount()).toBeGreaterThanOrEqual(8); // ES + EN + signature page
    await as(affCookie).post("/api/affiliate/onboarding/agreement").send(base).expect(409);
    // Price is locked once signed.
    await as(superCookie).patch(`/api/admin/affiliates/${affId}/subscription-price`).send({ subscription_price_cents: 100 }).expect(409);

    // Still held: no W-9 yet.
    await as(superCookie).patch(`/api/admin/commissions/${commissionId}`).send({ status: "paid" }).expect(409);

    const w9 = {
      legal_name: "Ana Ruiz", tax_classification: "individual", address: "1 Main St", city_state_zip: "Irvine, CA 92618",
      tin_type: "ssn", tin: "123-45-6789", signature_image: signaturePng(), certify: true,
    };
    const badTin = await as(affCookie).post("/api/affiliate/onboarding/w9").send({ ...w9, tin: "000-00-0000" });
    expect(badTin.body.error).toBe("validation.w9Tin");
    await as(affCookie).post("/api/affiliate/onboarding/w9").send({ ...w9, tax_classification: "llc" }).expect(400);
    const ok = await as(affCookie).post("/api/affiliate/onboarding/w9").send(w9).expect(201);
    expect(ok.body.w9).toMatchObject({ status: "submitted", tin_type: "ssn", tin_last4: "6789" });
    // Section 2: payouts also need the platform plan (card on file) once billing is configured.
    expect(ok.body.state.payout_ready).toBe(!ok.body.billing.configured);
    await db.execute(`UPDATE affiliates SET billing_status = 'trialing' WHERE id = ?`, [affId]);
    const ready = await as(affCookie).get("/api/affiliate/onboarding").expect(200);
    expect(ready.body.state).toMatchObject({ billing_ready: true, payout_ready: true });
    // Full TIN is never in the database.
    const [[w9row]] = (await db.query(`SELECT * FROM affiliate_w9s WHERE affiliate_id = ?`, [affId])) as any;
    expect(JSON.stringify(w9row)).not.toContain("123456789");

    await as(superCookie).patch(`/api/admin/commissions/${commissionId}`).send({ status: "paid" }).expect(200);
  });

  it("admin review: W-9 PDF is finance-only; reject reopens the W-9 and emails the affiliate", async () => {
    const view = await as(agentCookie).get(`/api/admin/affiliates/${affId}/onboarding`).expect(200);
    const w9Id = view.body.w9s[0].id;
    expect(view.body.w9s[0]).not.toHaveProperty("tin");
    await as(agentCookie).get(`/api/admin/affiliates/${affId}/w9s/${w9Id}/pdf`).expect(403);
    const pdf = await as(superCookie).get(`/api/admin/affiliates/${affId}/w9s/${w9Id}/pdf`);
    expect(pdf.status).toBe(302);
    await as(superCookie).post(`/api/admin/affiliates/${affId}/w9s/${w9Id}/review`).send({ status: "rejected" }).expect(400);
    const rej = await as(superCookie)
      .post(`/api/admin/affiliates/${affId}/w9s/${w9Id}/review`)
      .send({ status: "rejected", note: "Name does not match the SSN." })
      .expect(200);
    expect(rej.body.state).toMatchObject({ w9_status: "rejected", payout_ready: false });
    const again = await as(affCookie).get("/api/affiliate/onboarding").expect(200);
    expect(again.body.w9.review_note).toBe("Name does not match the SSN.");
  });

  it("template publish rejects unknown placeholders", async () => {
    const body = "x".repeat(250);
    const r = await as(superCookie).post("/api/admin/affiliate-agreement/template").send({ body_en: `${body} {{bogus}}`, body_es: body });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("validation.unknownPlaceholder");
  });
});
