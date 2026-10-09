import crypto from "crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";

// ── In-memory private Blob store (browser direct uploads are simulated) ──────
const blobStore = vi.hoisted(() => new Map<string, Buffer>());
vi.mock("@vercel/blob", async (orig) => {
  const real = await orig<typeof import("@vercel/blob")>();
  const urlFor = (p: string) => `https://store.private.blob.vercel-storage.com/${p}`;
  const keyOf = (u: string) => u.replace(/^https:\/\/[^/]+\//, "");
  return {
    ...real,
    put: vi.fn(async (pathname: string) => ({
      url: `https://store.public.blob.vercel-storage.com/${pathname}`,
    })),
    head: vi.fn(async (pathname: string) => {
      const buf = blobStore.get(keyOf(pathname));
      if (!buf) throw new Error("not found");
      return { size: buf.length, url: urlFor(keyOf(pathname)), pathname, contentType: "x" };
    }),
    get: vi.fn(async (pathname: string) => {
      const buf = blobStore.get(keyOf(pathname));
      if (!buf) return null;
      return {
        statusCode: 200,
        stream: new ReadableStream({
          start(c) {
            c.enqueue(new Uint8Array(buf));
            c.close();
          },
        }),
      };
    }),
    del: vi.fn(async (paths: string[] | string) => {
      for (const p of [paths].flat()) blobStore.delete(keyOf(p));
    }),
    issueSignedToken: vi.fn(async () => ({ clientSigningToken: "c", delegationToken: "d", validUntil: 0 })),
    presignUrl: vi.fn(async (_t: unknown, o: { pathname: string }) => ({
      presignedUrl: `${urlFor(o.pathname)}?sig=1`,
    })),
  };
});
vi.mock("@vercel/blob/client", () => ({
  generateClientTokenFromReadWriteToken: vi.fn(async () => "client-token"),
}));

process.env.BLOB_PRIVATE_READ_WRITE_TOKEN = "vercel_blob_rw_test_private";
process.env.CRON_SECRET = "cron-test-secret";

import { __testClearEmailDryRuns, __testGetEmailDryRuns, createServer } from "./index";
import { cleanupPortalFixturesByPrefix, createIntegrationTestPool } from "./testDbCleanup";
import { completeCpqData } from "./contractorApplication.fixtures";

// Unique-per-run test phones: the one-person-per-phone rule must never match other suites or real rows.
const RUN_PHONE = String(100 + Math.floor(Math.random() * 900));
const ph = (last4: string) => `949${RUN_PHONE}${last4}`;

const app = createServer();
const db = createIntegrationTestPool();
const prefix = `gwcpq-${Date.now()}-`;
const em = (name: string) => `${prefix}${name}@example.com`;
const PDF = Buffer.from("%PDF-1.7\n% test document\n");
// 8-byte PNG signature + padding (detectImageType only sniffs magic bytes).
const SIGNATURE = `data:image/png;base64,${Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(160, 7),
]).toString("base64")}`;

async function makeSession(actor: "admin" | "contractor", id: number): Promise<string> {
  const token = crypto.randomBytes(32).toString("hex");
  await db.execute(
    `INSERT INTO \`${actor}_sessions\` (\`${actor}_id\`, token_hash, expires_at) VALUES (?, ?, ?)`,
    [id, crypto.createHash("sha256").update(token).digest("hex"), new Date(Date.now() + 86_400_000)],
  );
  return `gw_${actor}_sid=${token}`;
}

async function insertId(sql: string, params: unknown[]): Promise<number> {
  const [r] = await db.execute(sql, params as any[]);
  return Number((r as { insertId: number }).insertId);
}

const as = (cookie: string) => ({
  get: (u: string) => request(app).get(u).set("Cookie", cookie),
  post: (u: string) => request(app).post(u).set("Cookie", cookie),
  patch: (u: string) => request(app).patch(u).set("Cookie", cookie),
});

function applyTokenFor(email: string): string {
  const mail = [...__testGetEmailDryRuns()].reverse().find((m) => m.to === email);
  const m = /contractor\/apply\/([a-f0-9]{64})/.exec(mail?.html || "");
  if (!m) throw new Error(`no application link emailed to ${email}`);
  return m[1];
}

async function uploadDoc(token: string, docType: string, body: Buffer, expires?: string) {
  const base = `/api/public/contractor-application/${token}`;
  const t = await request(app)
    .post(`${base}/upload-token`)
    .send({ doc_type: docType, content_type: "application/pdf", size_bytes: body.length });
  expect(t.status).toBe(200);
  blobStore.set(t.body.pathname, body);
  return request(app)
    .post(`${base}/documents`)
    .send({ doc_type: docType, pathname: t.body.pathname, file_name: `${docType}.pdf`, expires_on: expires });
}

let superCookie = "";
const suiteStartedAt = new Date(Date.now() - 1000);
let adminCookie = "";
let agentCookie = "";

beforeAll(async () => {
  const roles = ["super_admin", "admin", "agent"] as const;
  const ids: number[] = [];
  for (const role of roles) {
    ids.push(
      await insertId(
        `INSERT INTO admins (email, first_name, last_name, role, status) VALUES (?, ?, 'Test', ?, 'active')`,
        [em(role), role, role],
      ),
    );
  }
  [superCookie, adminCookie, agentCookie] = await Promise.all(ids.map((id) => makeSession("admin", id)));
});

afterAll(async () => {
  await cleanupPortalFixturesByPrefix(db, prefix);
  await db.end();
});

describe("contractor prequalification application", () => {
  // Runs last (vitest runs tests in order): nothing in this suite may alert real staff.
  afterAll(async () => {
    const [rows] = await db.query(
      `SELECT COUNT(*) AS n FROM admin_notifications n
       JOIN admins a ON a.id = n.admin_id
       WHERE n.created_at >= ? AND n.event_key LIKE 'contractor_%'
         AND LOWER(a.email) NOT LIKE '%@example.com' AND LOWER(a.email) NOT LIKE '%@example.test'`,
      [suiteStartedAt],
    );
    expect(Number((rows as any[])[0].n)).toBe(0);
  });

  it("signup → wizard → documents → e-sign → review → approve → login", async () => {
    const email = em("applicant");
    __testClearEmailDryRuns();
    const signup = await request(app).post("/api/public/contractor/signup").send({
      first_name: "Ana",
      last_name: "Crew",
      email,
      phone: ph("0100"),
      company: "Crew Builders LLC",
      preferred_language: "en",
    });
    expect(signup.status).toBe(201);
    const token = applyTokenFor(email);
    const base = `/api/public/contractor-application/${token}`;

    expect((await request(app).get(`/api/public/contractor-application/${"0".repeat(64)}`)).status).toBe(404);
    const view = await request(app).get(base);
    expect(view.status).toBe(200);
    expect(view.body.application.status).toBe("draft");
    expect(view.body.application.application_number).toMatch(/^CPQ-\d{4}-[A-Z0-9]{6}$/);
    expect(view.body.application.data.company.legal_name).toBe("Crew Builders LLC");
    expect(view.body.application.certification_text).toMatch(/I certify/);
    expect(view.body.requirements.missing_fields.length).toBeGreaterThan(10);

    // Incomplete submit is rejected with the missing field list.
    const early = await request(app)
      .post(`${base}/submit`)
      .send({ signer_name: "Ana Crew", signer_title: "Owner", signer_email: email, signer_phone: ph("0100"), signature_image: SIGNATURE, certify: true });
    expect(early.status).toBe(400);
    expect(early.body.error).toBe("validation.applicationIncomplete");
    expect(early.body.missing_fields).toContain("licensing.cslb_license_number");

    const save = await request(app).put(base).send({ data: completeCpqData(), current_step: 9 });
    expect(save.status).toBe(200);
    expect(save.body.requirements.missing_fields).toEqual([]);

    // Core docs gate submit.
    const noDocs = await request(app)
      .post(`${base}/submit`)
      .send({ signer_name: "Ana Crew", signer_title: "Owner", signer_email: email, signer_phone: ph("0100"), signature_image: SIGNATURE, certify: true });
    expect(noDocs.status).toBe(400);
    expect(noDocs.body.error).toBe("validation.applicationDocsMissing");

    // Wrong magic bytes are rejected and the blob is deleted.
    const t = await request(app)
      .post(`${base}/upload-token`)
      .send({ doc_type: "w9", content_type: "application/pdf", size_bytes: 20 });
    blobStore.set(t.body.pathname, Buffer.from("<html>not a pdf</html>"));
    const bad = await request(app)
      .post(`${base}/documents`)
      .send({ doc_type: "w9", pathname: t.body.pathname, file_name: "w9.pdf" });
    expect(bad.status).toBe(400);
    expect(blobStore.has(t.body.pathname)).toBe(false);
    // Pathname must belong to this application + doc type.
    const tamper = await request(app)
      .post(`${base}/documents`)
      .send({ doc_type: "w9", pathname: "cpq/CPQ-2026-ZZZZZZ/w9/x.pdf", file_name: "w9.pdf" });
    expect(tamper.status).toBe(400);
    // Expiring docs need a date.
    expect((await uploadDoc(token, "cslb_license", PDF)).body.error).toBe("validation.expirationRequired");

    for (const [type, exp] of [
      ["cslb_license", "2028-03-31"],
      ["license_bond", "2027-12-31"],
      ["w9", undefined],
      ["coi_general_liability", "2027-01-01"],
      ["workers_comp", "2027-01-01"],
    ] as const) {
      expect((await uploadDoc(token, type, PDF, exp)).status).toBe(201);
    }
    // Single-file types replace the previous upload.
    expect((await uploadDoc(token, "w9", PDF)).status).toBe(201);
    const afterReplace = await request(app).get(base);
    expect(afterReplace.body.documents.filter((d: any) => d.doc_type === "w9")).toHaveLength(1);

    const badSig = await request(app)
      .post(`${base}/submit`)
      .send({ signer_name: "Ana Crew", signer_title: "Owner", signer_email: email, signer_phone: ph("0100"), signature_image: "data:image/png;base64,AAAA", certify: true });
    expect(badSig.body.error).toBe("validation.signatureRequired");

    __testClearEmailDryRuns();
    const submit = await request(app)
      .post(`${base}/submit`)
      .send({ signer_name: "Ana Crew", signer_title: "Owner", signer_email: email, signer_phone: ph("0100"), signature_image: SIGNATURE, certify: true, lang: "en" });
    expect(submit.status).toBe(200);
    expect(submit.body.status).toBe("submitted");
    expect(submit.body.missing_docs).toContain("financial_statements");
    expect(__testGetEmailDryRuns().some((m) => m.to === email && /received/i.test(m.subject))).toBe(true);

    // Answers lock after submit; owed documents can still be uploaded.
    expect((await request(app).put(base).send({ data: {} })).status).toBe(409);
    expect((await uploadDoc(token, "financial_statements", PDF)).status).toBe(201);

    const [kRows] = await db.query(`SELECT id, status FROM contractors WHERE email = ?`, [email]);
    const contractorId = Number((kRows as any[])[0].id);
    expect((kRows as any[])[0].status).toBe("pending");
    const adminBase = `/api/admin/contractors/${contractorId}/application`;

    // Financial section + sensitive docs are hidden without finance.read.
    const asAgent = await as(agentCookie).get(adminBase);
    expect(asAgent.status).toBe(200);
    expect(asAgent.body.application.financial_redacted).toBe(true);
    expect(asAgent.body.application.data.financial.revenue_recent_year).toBe("");
    const w9 = asAgent.body.documents.find((d: any) => d.doc_type === "w9");
    expect(w9.redacted).toBe(true);
    expect((await as(agentCookie).get(`${adminBase}/documents/${w9.id}/file`)).status).toBe(403);
    expect((await as(agentCookie).post(`${adminBase}/decision`).send({ decision: "approved" })).status).toBe(403);

    const asAdmin = await as(adminCookie).get(adminBase);
    expect(asAdmin.body.application.data.financial.revenue_recent_year).toBe("$3M");
    expect(asAdmin.body.application.signer.signature_image).toBe(SIGNATURE);
    const file = await as(adminCookie).get(`${adminBase}/documents/${w9.id}/file`);
    expect(file.status).toBe(302);
    expect(file.headers.location).toMatch(/private\.blob\.vercel-storage\.com\/cpq\//);

    const pdf = await as(adminCookie).get(`${adminBase}/pdf?lang=en`);
    expect(pdf.status).toBe(200);
    expect(pdf.headers["content-type"]).toBe("application/pdf");

    // Plain staff approve is blocked until the application is approved.
    const directApprove = await as(adminCookie).patch(`/api/admin/contractors/${contractorId}`).send({ status: "active" });
    expect(directApprove.status).toBe(409);
    expect(directApprove.body.error).toBe("errors.contractorApplicationRequired");

    // Request info → contractor edits → resubmits.
    __testClearEmailDryRuns();
    const info = await as(adminCookie)
      .post(`${adminBase}/request-info`)
      .send({ note: "Please add your bank reference letter.", doc_types: ["bank_reference", "nope"] });
    expect(info.status).toBe(200);
    const token2 = applyTokenFor(email);
    const reopened = await request(app).get(`/api/public/contractor-application/${token2}`);
    expect(reopened.body.application.status).toBe("needs_info");
    expect(reopened.body.application.info_request_doc_types).toEqual(["bank_reference"]);
    expect((await uploadDoc(token2, "bank_reference", PDF)).status).toBe(201);
    const resubmit = await request(app)
      .post(`/api/public/contractor-application/${token2}/submit`)
      .send({ signer_name: "Ana Crew", signer_title: "Owner", signer_email: email, signer_phone: ph("0100"), signature_image: SIGNATURE, certify: true });
    expect(resubmit.status).toBe(200);

    // Approval requires license + insurance verification first.
    expect((await as(adminCookie).post(`${adminBase}/decision`).send({ decision: "approved" })).body.error).toBe(
      "errors.applicationVerifyFirst",
    );
    expect(
      (await as(adminCookie).patch(`${adminBase}/review`).send({ license_verified: true, insurance_verified: true })).status,
    ).toBe(200);
    const missing = await as(adminCookie).post(`${adminBase}/decision`).send({ decision: "approved" });
    expect(missing.status).toBe(409);
    expect(missing.body.error).toBe("errors.applicationDocsMissing");

    const docRow = asAdmin.body.documents.find((d: any) => d.doc_type === "cslb_license");
    expect(
      (await as(adminCookie).patch(`${adminBase}/documents/${docRow.id}`).send({ status: "rejected" })).body.error,
    ).toBe("validation.rejectNoteRequired");
    expect(
      (await as(adminCookie).patch(`${adminBase}/documents/${docRow.id}`).send({ status: "accepted" })).status,
    ).toBe(200);

    __testClearEmailDryRuns();
    const approved = await as(adminCookie)
      .post(`${adminBase}/decision`)
      .send({ decision: "approved", allow_missing: true, notes: "Remaining docs waived for pilot (vitest)." });
    expect(approved.status).toBe(200);
    expect(approved.body.contractor_status).toBe("active");
    expect(__testGetEmailDryRuns().some((m) => m.to === email && /approved/i.test(m.subject))).toBe(true);
    expect((await request(app).post("/api/contractor/auth/otp/request").send({ email })).status).toBe(200);

    // After approval only expiring-doc renewals are accepted.
    expect((await uploadDoc(token2, "coi_general_liability", PDF, "2028-01-01")).status).toBe(201);
    const late = await request(app)
      .post(`/api/public/contractor-application/${token2}/upload-token`)
      .send({ doc_type: "w9", content_type: "application/pdf", size_bytes: 10 });
    expect(late.status).toBe(409);

    // Expiring-document sweep: reminder at the 7-day threshold, only once.
    const soon = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
    await db.execute(
      `UPDATE contractor_application_documents d
       JOIN contractor_applications a ON a.id = d.application_id
       SET d.expires_on = ? WHERE a.contractor_id = ? AND d.doc_type = 'license_bond'`,
      [soon, contractorId],
    );
    __testClearEmailDryRuns();
    expect((await request(app).get("/api/cron/contractor-applications")).status).toBe(401);
    const cron = await request(app)
      .get(`/api/cron/contractor-applications?email_prefix=${prefix}`)
      .set("Authorization", "Bearer cron-test-secret");
    expect(cron.status).toBe(200);
    expect(__testGetEmailDryRuns().some((m) => m.to === email && /expiring/i.test(m.subject))).toBe(true);
    const [rem] = await db.query(
      `SELECT d.expiry_reminded_days FROM contractor_application_documents d
       JOIN contractor_applications a ON a.id = d.application_id
       WHERE a.contractor_id = ? AND d.doc_type = 'license_bond'`,
      [contractorId],
    );
    expect(Number((rem as any[])[0].expiry_reminded_days)).toBe(7);
    __testClearEmailDryRuns();
    await request(app).get(`/api/cron/contractor-applications?email_prefix=${prefix}`).set("Authorization", "Bearer cron-test-secret");
    expect(__testGetEmailDryRuns().some((m) => m.to === email && /expiring/i.test(m.subject))).toBe(false);

    const events = (await as(adminCookie).get(adminBase)).body.events.map((e: any) => e.kind);
    expect(events).toEqual(expect.arrayContaining(["created", "submitted", "info_requested", "resubmitted", "approved"]));
  });

  it("existing active contractors get a soft deadline; overdue only flags staff", async () => {
    const email = em("existing");
    const id = await insertId(
      `INSERT INTO contractors (email, first_name, last_name, status, preferred_language)
       VALUES (?, 'Eli', 'Existing', 'active', 'es')`,
      [email],
    );
    const dry = await as(adminCookie).post("/api/admin/contractors/application/send-bulk").send({});
    expect(dry.body.dry_run).toBe(true);
    expect(dry.body.count).toBeGreaterThanOrEqual(1);

    __testClearEmailDryRuns();
    const sent = await as(adminCookie).post(`/api/admin/contractors/${id}/application/send`).send({});
    expect(sent.status).toBe(200);
    const mail = __testGetEmailDryRuns().find((m) => m.to === email);
    expect(mail?.subject).toMatch(/Acción requerida/);
    const [a] = await db.query(`SELECT due_at FROM contractor_applications WHERE contractor_id = ?`, [id]);
    const due = new Date((a as any[])[0].due_at).getTime();
    expect(due).toBeGreaterThan(Date.now() + 29 * 86_400_000);

    await db.execute(`UPDATE contractor_applications SET due_at = ? WHERE contractor_id = ?`, [
      new Date(Date.now() - 86_400_000),
      id,
    ]);
    await request(app).post(`/api/cron/contractor-applications?email_prefix=${prefix}`).set("Authorization", "Bearer cron-test-secret");
    const [after] = await db.query(
      `SELECT a.overdue_notified_at, k.status FROM contractor_applications a
       JOIN contractors k ON k.id = a.contractor_id WHERE a.contractor_id = ?`,
      [id],
    );
    expect((after as any[])[0].overdue_notified_at).toBeTruthy();
    expect((after as any[])[0].status).toBe("active");

    // Portal shortcut mints a fresh link for the signed-in contractor.
    const ctrCookie = await makeSession("contractor", id);
    const summary = await as(ctrCookie).get("/api/contractor/application");
    expect(summary.body.application.status).toBe("draft");
    const link = await as(ctrCookie).post("/api/contractor/application/link").send({});
    expect(link.body.path).toMatch(/^\/contractor\/apply\/[a-f0-9]{64}$/);

    const list = await as(adminCookie).get(`/api/admin/contractors?application_status=draft&q=${encodeURIComponent(prefix)}`);
    expect(list.body.contractors.some((c: any) => c.id === id && c.application_status === "draft")).toBe(true);
  });

  it("resend never enumerates; super_admin override is audited", async () => {
    expect((await request(app).post("/api/public/contractor-application/resend").send({ email: em("ghost") })).body).toEqual({ ok: true });

    const id = await insertId(
      `INSERT INTO contractors (email, first_name, last_name, status, preferred_language)
       VALUES (?, 'Pat', 'Pending', 'pending', 'en')`,
      [em("override")],
    );
    expect((await as(superCookie).patch(`/api/admin/contractors/${id}`).send({ status: "active", override_reason: "no" })).body.error).toBe(
      "errors.contractorOverrideReasonRequired",
    );
    const ok = await as(superCookie)
      .patch(`/api/admin/contractors/${id}`)
      .send({ status: "active", override_reason: "Long-time partner, vetted 2025" });
    expect(ok.status).toBe(200);
    const view = await as(superCookie).get(`/api/admin/contractors/${id}/application`);
    expect(view.body.events.find((e: any) => e.kind === "activation_override")?.note).toBe("Long-time partner, vetted 2025");
  });
});
