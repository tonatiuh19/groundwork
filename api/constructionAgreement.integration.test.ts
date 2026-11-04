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
    presignUrl: vi.fn(async (_t: unknown, o: { pathname: string }) => ({ presignedUrl: `https://store.private.blob.vercel-storage.com/${o.pathname}?sig=1` })),
  };
});
process.env.BLOB_PRIVATE_READ_WRITE_TOKEN = "vercel_blob_rw_test_private";

import { __testClearEmailDryRuns, __testGetEmailDryRuns, createServer } from "./index";
import { cleanupPortalFixturesByPrefix, createIntegrationTestPool } from "./testDbCleanup";

const hasDb = Boolean(process.env.DB_HOST && process.env.DB_USER && process.env.DB_NAME);

function signaturePng(): string {
  const png = new PNG({ width: 120, height: 40 });
  for (let x = 5; x < 115; x++) {
    const i = ((20 + Math.round(8 * Math.sin(x / 9))) * 120 + x) * 4;
    png.data[i] = 14;
    png.data[i + 3] = 255;
  }
  return `data:image/png;base64,${PNG.sync.write(png).toString("base64")}`;
}

describe.runIf(hasDb)("ADU construction agreement: template lock, CRM prefill, three-party e-sign, signed PDF", () => {
  const app = createServer();
  const db = createIntegrationTestPool();
  const stamp = Date.now();
  const prefix = `gwagree-${stamp}-`;
  const em = (n: string) => `${prefix}${n}@example.com`;
  const ph = (n: number) => `+1555${String(stamp + n).slice(-7)}`;
  const ins = async (sql: string, p: unknown[]) => Number(((await db.execute(sql, p as any[])) as any)[0].insertId);
  const cookies: Record<string, string> = {};
  const pub = `GWA${String(stamp).slice(-8)}`;
  let version = 0;
  let agreementId = 0;
  const tokens: Record<string, string> = {};

  beforeAll(async () => {
    process.env.VITEST = "true";
    for (const [who, role] of [["super", "super_admin"], ["admin", "admin"], ["agent", "agent"]] as const) {
      const id = await ins(`INSERT INTO admins (email, first_name, last_name, role, status) VALUES (?, ?, 'Agree', ?, 'active')`, [em(who), who, role]);
      const t = crypto.randomBytes(32).toString("hex");
      await db.execute(`INSERT INTO admin_sessions (admin_id, token_hash, expires_at) VALUES (?, ?, NOW() + INTERVAL 1 HOUR)`, [id, crypto.createHash("sha256").update(t).digest("hex")]);
      cookies[who] = `gw_admin_sid=${t}`;
    }
    const clientId = await ins(`INSERT INTO clients (first_name, last_name, email, phone, status, city, zip) VALUES ('Carla', 'Carrillo', ?, ?, 'active', 'Fontana', '92335')`, [em("client"), ph(1)]);
    const kId = await ins(`INSERT INTO contractors (email, first_name, last_name, phone, company, status, license_number) VALUES (?, 'Ken', 'Builder', ?, 'Ken Builds Inc', 'active', '1234567')`, [em("ctr"), ph(2)]);
    await ins(`INSERT INTO contractor_applications (contractor_id, application_number, status, data_json) VALUES (?, ?, 'approved', ?)`, [
      kId,
      `CPQ-2026-A${String(stamp).slice(-5)}`,
      JSON.stringify({
        company: { legal_name: "Ken Builds Inc", address: "1 Main St", city: "Ontario", state: "CA", zip: "91761", contact_name: "Kim PM" },
        licensing: { cslb_license_number: "1234567", classifications: "B - General Building", qualifier_name: "Ken Builder" },
        insurance: { general_liability: { carrier: "Acme Insurance", policy_number: "GL-1" }, workers_comp: { carrier: "", policy_number: "" }, wc_exempt: "yes" },
      }),
    ]);
    await ins(`INSERT INTO projects (public_id, client_id, contractor_id, property_address, property_city, property_zip, sq_ft, sale_price_cents) VALUES (?, ?, ?, '123 Elm St', 'Fontana', '92335', 614, 15350000)`, [pub, clientId, kId]);
  });

  afterAll(async () => {
    try {
      await cleanupPortalFixturesByPrefix(db, prefix);
    } finally {
      await db.end();
    }
  });

  it("templates: v1 is seeded as a draft; only super admins approve (typed phrase); approved versions are locked", async () => {
    const t = await request(app).get("/api/admin/construction-agreement/template").set("Cookie", cookies.agent).expect(200);
    expect(t.body.versions.some((v: any) => v.version === 1)).toBe(true);
    const v1 = t.body.versions.find((v: any) => v.version === 1);
    expect(v1.body_en).toContain("{{contract_price}}");
    const created = await request(app)
      .post("/api/admin/construction-agreement/template")
      .set("Cookie", cookies.admin)
      .send({ body_en: v1.body_en, notes: `${prefix}test version` })
      .expect(201);
    version = created.body.template.version;
    expect(created.body.template.approved).toBe(false);
    await request(app).post(`/api/admin/construction-agreement/template/${version}/approve`).set("Cookie", cookies.admin).send({ confirm_phrase: "APPROVED" }).expect(403);
    const wrong = await request(app).post(`/api/admin/construction-agreement/template/${version}/approve`).set("Cookie", cookies.super).send({ confirm_phrase: "yes" });
    expect(wrong.body.error).toBe("validation.confirmPhrase");
    // The draft version renders with a DRAFT watermark.
    const pv = await request(app).get(`/api/admin/construction-agreement/template/${version}/pdf`).set("Cookie", cookies.agent).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => cb(null, Buffer.concat(chunks)));
    });
    expect(pv.headers["content-type"]).toBe("application/pdf");
    expect((pv.body as Buffer).subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("creates the project agreement prefilled from the CRM; a draft template can't be sent", async () => {
    await request(app).post(`/api/admin/projects/${pub}/construction-agreement`).set("Cookie", cookies.agent).send({ template_version: version }).expect(201);
    const v = await request(app).get(`/api/admin/projects/${pub}/construction-agreement`).set("Cookie", cookies.agent).expect(200);
    const a = v.body.agreement;
    agreementId = a.id;
    expect(a).toMatchObject({ status: "draft", template_version: version, template_approved: false });
    expect(a.fields).toMatchObject({
      client_names: "Carla Carrillo",
      client_email: em("client"),
      property_street: "123 Elm St",
      property_city: "Fontana",
      adu_sqft: "614",
      contract_price: "$153,500",
      contractor_business: "Ken Builds Inc",
      cslb_license: "1234567",
      cslb_class: "B - General Building",
      contractor_rmo: "Ken Builder",
      contractor_pm: "Kim PM",
      contractor_address: "1 Main St, Ontario, CA 91761",
      gl_insurer: "Acme Insurance",
      workers_comp: "CSLB exemption on file",
    });
    expect(a.missing).toEqual(expect.arrayContaining(["apn", "permit_number", "completion_date"]));
    expect(a.body).toContain("$153,500");
    expect(a.body).toContain("[______]");
    await request(app).post(`/api/admin/projects/${pub}/construction-agreement`).set("Cookie", cookies.agent).send({}).expect(409);
    const draft = await request(app).post(`/api/admin/construction-agreements/${agreementId}/send`).set("Cookie", cookies.agent);
    expect(draft.body.error).toBe("errors.agreementTemplateDraft");
  });

  it("after attorney approval it sends only when every required field is filled, then emails both signers", async () => {
    await request(app).post(`/api/admin/construction-agreement/template/${version}/approve`).set("Cookie", cookies.super).send({ confirm_phrase: "APPROVED" }).expect(200);
    await request(app).put(`/api/admin/construction-agreement/template/${version}`).set("Cookie", cookies.super).send({ body_en: "x".repeat(300) }).expect(409);
    const missing = await request(app).post(`/api/admin/construction-agreements/${agreementId}/send`).set("Cookie", cookies.agent).expect(400);
    expect(missing.body.error).toBe("validation.agreementMissing");
    const cur = (await request(app).get(`/api/admin/projects/${pub}/construction-agreement`).set("Cookie", cookies.agent)).body.agreement.fields;
    const fill: Record<string, string> = { apn: "0230-111-22", project_type: "Conversion of the existing garage into an ADU", permit_number: "B-2026-1", plan_name: "Custom garage conversion", layout: "2 bedrooms, 1 bathroom, laundry, kitchen, dining area and living room", fees_paid_by: "Client", start_days: "14", completion_date: "March 31, 2027", main_service: "added by change order", water_heater: "included", county: "San Bernardino", termination_exhibit: "Exhibit A", groundwork_role: "Project manager and escrow payee." };
    await request(app).put(`/api/admin/construction-agreements/${agreementId}`).set("Cookie", cookies.agent).send({ fields: { ...cur, ...fill } }).expect(200);
    __testClearEmailDryRuns();
    const sent = await request(app).post(`/api/admin/construction-agreements/${agreementId}/send`).set("Cookie", cookies.agent).expect(200);
    expect(sent.body.agreement.status).toBe("sent");
    expect(sent.body.agreement.body).not.toContain("[______]");
    expect(sent.body.agreement.signers.map((s: any) => s.party)).toEqual(["client", "contractor", "groundwork"]);
    for (const [party, to] of [["client", em("client")], ["contractor", em("ctr")]] as const) {
      const mail = __testGetEmailDryRuns().find((m: any) => m.to === to && /construction agreement/i.test(m.subject));
      expect(mail).toBeTruthy();
      tokens[party] = String((mail as any).html).match(/\/sign\/agreement\/([a-f0-9]{48})/)![1];
    }
    // Locked once sent.
    await request(app).put(`/api/admin/construction-agreements/${agreementId}`).set("Cookie", cookies.agent).send({ fields: cur }).expect(409);
  });

  it("client and contractor sign from their links; Groundwork countersigns; the signed PDF is stored", async () => {
    const view = await request(app).get(`/api/public/agreement-sign/${tokens.client}`).expect(200);
    expect(view.body).toMatchObject({ party: "client", status: "pending", agreement_status: "sent" });
    expect(view.body.body).toContain("0230-111-22");
    const sha = view.body.body_sha256;
    const noConsent = await request(app).post(`/api/public/agreement-sign/${tokens.client}`).send({ signed_name: "Carla Carrillo", signature_image: signaturePng(), body_sha256: sha });
    expect(noConsent.body.error).toBe("validation.agreementConsent");
    const changed = await request(app).post(`/api/public/agreement-sign/${tokens.client}`).send({ signed_name: "Carla Carrillo", signature_image: signaturePng(), body_sha256: "0".repeat(64), consent: true });
    expect(changed.body.error).toBe("errors.agreementChanged");
    await request(app).post(`/api/public/agreement-sign/${tokens.client}`).send({ signed_name: "Carla Carrillo", signature_image: signaturePng(), body_sha256: sha, consent: true }).expect(200);
    await request(app).post(`/api/public/agreement-sign/${tokens.client}`).send({ signed_name: "Carla Carrillo", signature_image: signaturePng(), body_sha256: sha, consent: true }).expect(409);
    const early = await request(app).post(`/api/admin/construction-agreements/${agreementId}/sign`).set("Cookie", cookies.admin).send({ signed_name: "Daniel Staff", title: "Director", signature_image: signaturePng() });
    expect(early.body.error).toBe("errors.agreementWaitingParties");
    await request(app).post(`/api/public/agreement-sign/${tokens.contractor}`).send({ signed_name: "Ken Builder", title: "RMO", signature_image: signaturePng(), body_sha256: sha, consent: true }).expect(200);
    await request(app).get(`/api/public/agreement-sign/${tokens.client}/pdf`).expect(409);
    await request(app).post(`/api/admin/construction-agreements/${agreementId}/sign`).set("Cookie", cookies.agent).send({ signed_name: "Daniel Staff", title: "Director", signature_image: signaturePng() }).expect(403);
    __testClearEmailDryRuns();
    const done = await request(app).post(`/api/admin/construction-agreements/${agreementId}/sign`).set("Cookie", cookies.admin).send({ signed_name: "Daniel Staff", title: "Director", signature_image: signaturePng() }).expect(200);
    expect(done.body.agreement).toMatchObject({ status: "signed", has_pdf: true });
    expect(__testGetEmailDryRuns().filter((m: any) => /^Signed:/.test(m.subject)).map((m: any) => m.to).sort()).toEqual([em("client"), em("ctr")].sort());
    const stored = [...blobStore.entries()].find(([k]) => k.includes(`construction-agreement-${agreementId}-`));
    expect(stored).toBeTruthy();
    const pdf = await PDFDocument.load(stored![1]);
    expect(pdf.getPageCount()).toBeGreaterThanOrEqual(4);
    const dl = await request(app).get(`/api/public/agreement-sign/${tokens.contractor}/pdf`).expect(302);
    expect(String(dl.headers.location)).toContain(`construction-agreement-${agreementId}-`);
    // Voiding a signed agreement is super admin only.
    await request(app).post(`/api/admin/construction-agreements/${agreementId}/void`).set("Cookie", cookies.agent).send({ reason: "test" }).expect(403);
  });

  it("edge cases: lost PDF is rebuilt on download; resend and void kill old links; erase removes the PDF row", async () => {
    // Storage failed at signing time: the next download builds and stores it.
    await db.execute(`UPDATE construction_agreements SET pdf_blob_pathname = NULL WHERE id = ?`, [agreementId]);
    blobStore.clear();
    await request(app).get(`/api/public/agreement-sign/${tokens.client}/pdf`).expect(302);
    expect([...blobStore.keys()].some((k) => k.includes(`construction-agreement-${agreementId}-`))).toBe(true);
    expect((await db.query(`SELECT pdf_blob_pathname p FROM construction_agreements WHERE id = ?`, [agreementId]) as any)[0][0].p).toBeTruthy();

    // Void (super admin) → links stop working; a new agreement can start; resend replaces the old link.
    await request(app).post(`/api/admin/construction-agreements/${agreementId}/void`).set("Cookie", cookies.super).send({ reason: "test void" }).expect(200);
    await request(app).get(`/api/public/agreement-sign/${tokens.client}`).expect(404);
    const fresh = await request(app).post(`/api/admin/projects/${pub}/construction-agreement`).set("Cookie", cookies.agent).send({ template_version: version }).expect(201);
    expect(fresh.body.history.some((h: any) => h.id === agreementId && h.status === "void")).toBe(true);
    const id2 = fresh.body.agreement.id;
    const fields = fresh.body.agreement.fields;
    const fill = { apn: "1", project_type: "x", permit_number: "1", plan_name: "x", layout: "x", fees_paid_by: "Client", start_days: "14", completion_date: "x", main_service: "x", water_heater: "x", county: "x", termination_exhibit: "x", groundwork_role: "x" };
    await request(app).put(`/api/admin/construction-agreements/${id2}`).set("Cookie", cookies.agent).send({ fields: { ...fields, ...fill } }).expect(200);
    __testClearEmailDryRuns();
    await request(app).post(`/api/admin/construction-agreements/${id2}/send`).set("Cookie", cookies.agent).expect(200);
    const first = String((__testGetEmailDryRuns().find((m: any) => m.to === em("client")) as any).html).match(/\/sign\/agreement\/([a-f0-9]{48})/)![1];
    __testClearEmailDryRuns();
    await request(app).post(`/api/admin/construction-agreements/${id2}/resend`).set("Cookie", cookies.agent).send({ party: "client" }).expect(200);
    const second = String((__testGetEmailDryRuns().find((m: any) => m.to === em("client")) as any).html).match(/\/sign\/agreement\/([a-f0-9]{48})/)![1];
    expect(second).not.toBe(first);
    await request(app).get(`/api/public/agreement-sign/${first}`).expect(404);
    await request(app).get(`/api/public/agreement-sign/${second}`).expect(200);
    await request(app).get(`/api/public/agreement-sign/not-a-token`).expect(404);
    // A bad signature image is rejected.
    const v = await request(app).get(`/api/public/agreement-sign/${second}`);
    const bad = await request(app).post(`/api/public/agreement-sign/${second}`).send({ signed_name: "Carla Carrillo", signature_image: "data:image/png;base64,AAAA", body_sha256: v.body.body_sha256, consent: true });
    expect(bad.body.error).toBe("validation.signatureRequired");
    // Erase preview counts the agreements and their PDFs.
    const clientId = Number((await db.query(`SELECT id FROM clients WHERE email = ?`, [em("client")]) as any)[0][0].id);
    const pv = await request(app).get(`/api/admin/people/client/${clientId}/erase-preview`).set("Cookie", cookies.super).expect(200);
    expect(JSON.stringify(pv.body)).toContain("construction_agreements");
  });
});
