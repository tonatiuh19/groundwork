import "dotenv/config";
import crypto from "crypto";
import { PNG } from "pngjs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const blobStore = vi.hoisted(() => new Map<string, Buffer>());
vi.mock("@vercel/blob", async (orig) => {
  const real = await orig<typeof import("@vercel/blob")>();
  return {
    ...real,
    put: vi.fn(async (pathname: string, body: Buffer) => {
      blobStore.set(pathname, Buffer.from(body));
      return { url: `https://store.private.blob.vercel-storage.com/${pathname}`, pathname };
    }),
  };
});
const signaturePng = () => {
  const png = new PNG({ width: 120, height: 40 });
  for (let x = 10; x < 110; x++) png.data[((20 * 120 + x) << 2) + 3] = 255;
  return `data:image/png;base64,${PNG.sync.write(png).toString("base64")}`;
};
import request from "supertest";
import { __testClearEmailDryRuns, __testGetEmailDryRuns, createServer } from "./index";
import { cleanupPortalFixturesByPrefix, createIntegrationTestPool } from "./testDbCleanup";

const hasDb = Boolean(process.env.DB_HOST && process.env.DB_USER && process.env.DB_NAME);

/** City Partners end to end: invite-only, agreement + countersign, scoped pipeline, Opened City fees. */
describe.runIf(hasDb)("City Partners (integration)", () => {
  const app = createServer();
  const db = createIntegrationTestPool();
  const prefix = `gwcp-${Date.now()}-`;
  const em = (n: string) => `${prefix}${n}@example.com`;
  let admin = "";
  let plainAdmin = "";
  let finance = "";
  let agent = "";
  let partner = "";
  let partnerId = 0;
  let openCity = 0;
  let otherCity = 0;
  let projectId = 0;
  let publicId = "";
  const ins = async (sql: string, p: unknown[]) => Number(((await db.execute(sql, p as any[])) as any)[0].insertId);
  const session = async (table: string, col: string, id: number, cookie: string) => {
    const t = crypto.randomBytes(32).toString("hex");
    await db.execute(`INSERT INTO ${table} (${col}, token_hash, expires_at) VALUES (?, ?, NOW() + INTERVAL 1 HOUR)`, [id, crypto.createHash("sha256").update(t).digest("hex")]);
    return `${cookie}=${t}`;
  };

  beforeAll(async () => {
    process.env.VITEST = "true";
    // This suite signs its own approved agreement version: staff approving a real version never changes it.
    process.env.GW_CP_TEST_PREFIX = prefix;
    const body = [
      "Groundwork City Access test agreement between Ground Work Capital LLC and {{partner_legal_name}} (the Contractor), effective {{effective_date}}.",
      "Compensation. The Company will pay the Contractor {{fee_per_sqft}} per square foot of each ADU the Company builds in any Opened City. {{opened_cities_clause}}",
      "If a homeowner cancels after funding, the Company charges the homeowner a cancellation fee of 10% of the total project amount.",
      "Notices to the Contractor go to:\n\n{{contractor_address}}",
    ].join("\n\n");
    await db.execute(`INSERT INTO city_partner_agreement_templates (version, body, approved_at, notes) VALUES (?, ?, NOW(), ?)`, [
      900_000 + Math.floor(Math.random() * 90_000_000),
      body,
      `${prefix}test agreement`,
    ]);
    admin = await session("admin_sessions", "admin_id", await ins(`INSERT INTO admins (email, first_name, last_name, role, status) VALUES (?, 'Cp', 'Admin', 'super_admin', 'active')`, [em("admin")]), "gw_admin_sid");
    agent = await session("admin_sessions", "admin_id", await ins(`INSERT INTO admins (email, first_name, last_name, role, status) VALUES (?, 'Cp', 'Agent', 'agent', 'active')`, [em("agent")]), "gw_admin_sid");
    plainAdmin = await session("admin_sessions", "admin_id", await ins(`INSERT INTO admins (email, first_name, last_name, role, status) VALUES (?, 'Cp', 'Plain', 'admin', 'active')`, [em("plain")]), "gw_admin_sid");
    finance = await session("admin_sessions", "admin_id", await ins(`INSERT INTO admins (email, first_name, last_name, role, status) VALUES (?, 'Cp', 'Fin', 'finance', 'active')`, [em("fin")]), "gw_admin_sid");
    openCity = await ins(`INSERT INTO service_cities (name, active, pipeline_stage, opened_on) VALUES (?, 0, 'preapproved', '2026-10-01')`, [`${prefix}Fontana`]);
    otherCity = await ins(`INSERT INTO service_cities (name, active, pipeline_stage) VALUES (?, 0, 'target')`, [`${prefix}Rialto`]);
    const lead = await ins(`INSERT INTO leads (first_name, last_name, full_name, email, phone, status, city_id) VALUES ('Maria', 'Ramirez', 'Maria Ramirez', ?, '+15555550191', 'new', ?)`, [em("lead"), openCity]);
    const client = await ins(`INSERT INTO clients (first_name, last_name, email, status, lead_id) VALUES ('Maria', 'Ramirez', ?, 'active', ?)`, [em("client"), lead]);
    publicId = `GW-${prefix.slice(-9).replace(/\W/g, "").toUpperCase()}`.slice(0, 24);
    projectId = await ins(`INSERT INTO projects (public_id, client_id, sq_ft, property_address) VALUES (?, ?, 830, '8421 Sierra Ave, Fontana')`, [publicId, client]);
  });
  afterAll(async () => {
    delete process.env.GW_CP_TEST_PREFIX;
    await db.execute(`DELETE FROM projects WHERE id = ?`, [projectId]);
    await cleanupPortalFixturesByPrefix(db, prefix);
    await db.end();
  });

  it("only staff with approvals invite; the invite email goes out; nobody can sign up", async () => {
    __testClearEmailDryRuns();
    expect((await request(app).post("/api/admin/city-partners").set("Cookie", agent).send({ email: em("peter"), first_name: "Peter", company: "x" })).status).toBe(403);
    const noLlc = await request(app).post("/api/admin/city-partners").set("Cookie", admin).send({ email: em("peter"), first_name: "Peter" });
    expect(noLlc.body.error).toBe("validation.cityPartnerCompany");
    const r = await request(app).post("/api/admin/city-partners").set("Cookie", admin).send({ email: em("peter"), first_name: "Peter", last_name: "Lee", company: `${prefix}Remedio LLC`, city_ids: [openCity] }).expect(201);
    partnerId = r.body.id;
    const invite = __testGetEmailDryRuns().find((m: any) => [].concat(m.to).includes(em("peter") as never)) as any;
    expect(invite).toBeTruthy();
    // The partner email set: city, rate, inviter, the 3 steps; no long dashes.
    for (const s of [`${prefix}Fontana`, "$2.00 per sq ft", "Cp Admin", "Submit your W-9", "/city/login"]) expect(String(invite.html)).toContain(s);
    expect(String(invite.html)).not.toContain(" — ");
    // Previews render the same email and never send.
    __testClearEmailDryRuns();
    const draft = await request(app).post("/api/admin/city-partners/invite-preview").set("Cookie", admin).send({ first_name: "Ana", company: "Norte LLC", city_ids: [openCity], fee_cents_per_sqft: 350, preferred_language: "es" }).expect(200);
    expect(draft.body.subject).toContain("Tienes una invitación");
    for (const s of ["Ana", "Norte LLC", `${prefix}Fontana`, "$3.50 por pie cuadrado"]) expect(draft.body.html).toContain(s);
    expect((await request(app).get(`/api/admin/city-partners/${partnerId}/invite-preview`).set("Cookie", admin).expect(200)).body.html).toContain(`${prefix}Remedio LLC`);
    expect((await request(app).post("/api/admin/city-partners/invite-preview").set("Cookie", agent).send({ first_name: "x" })).status).toBe(403);
    expect(__testGetEmailDryRuns()).toHaveLength(0);
    expect((await request(app).post("/api/admin/city-partners").set("Cookie", admin).send({ email: em("peter"), first_name: "Dup", company: "x" })).status).toBe(409);
    expect((await request(app).post("/api/admin/city-partners").set("Cookie", admin).send({ email: em("badrate"), first_name: "B", company: "x", fee_cents_per_sqft: 20000 })).body.error).toBe("validation.cityPartnerRate");
    expect((await request(app).post("/api/city/auth/otp/request").send({ email: em("nobody") })).status).toBe(200);
    // Full sign-in with an emailed code (known code inserted: hashes can't be read back).
    expect((await request(app).post("/api/city/auth/otp/request").send({ email: em("peter") })).status).toBe(200);
    await db.execute(`INSERT INTO city_partner_otp_codes (city_partner_id, code_hash, purpose, expires_at) VALUES (?, ?, 'login', NOW() + INTERVAL 10 MINUTE)`, [partnerId, crypto.createHash("sha256").update("424242").digest("hex")]);
    const login = await request(app).post("/api/city/auth/otp/verify").send({ email: em("peter"), code: "424242" }).expect(200);
    const cookie = String(login.headers["set-cookie"]).match(/gw_city_sid=[0-9a-f]+/)![0];
    expect((await request(app).get("/api/city/auth/me").set("Cookie", cookie).expect(200)).body.user.email).toBe(em("peter"));
    partner = cookie;
  });

  it("signs the agreement once with the LLC name and frozen rate; fees wait for the countersign", async () => {
    const o = await request(app).get("/api/city/onboarding").set("Cookie", partner).expect(200);
    expect(o.body.template.body).toContain(`${prefix}Remedio LLC`);
    expect(o.body.template.body).toContain("$2.00 per square foot");
    expect(o.body.template.body).not.toContain("{{");
    expect((await request(app).post("/api/city/onboarding/agreement").set("Cookie", partner).send({ signer_name: "Peter Lee" })).status).toBe(400);
    // Staff fix the rate before signing: allowed, logged, and invalid amounts refused.
    for (const bad of [-1, 10001, 1.5, "abc"]) expect((await request(app).patch(`/api/admin/city-partners/${partnerId}`).set("Cookie", admin).send({ fee_cents_per_sqft: bad })).body.error).toBe("validation.cityPartnerRate");
    expect((await request(app).patch(`/api/admin/city-partners/${partnerId}`).set("Cookie", admin).send({ company: " " })).body.error).toBe("validation.cityPartnerCompany");
    const read = o.body.template.sha256;
    await request(app).patch(`/api/admin/city-partners/${partnerId}`).set("Cookie", admin).send({ fee_cents_per_sqft: 250 }).expect(200);
    // The partner still has the $2.00 text open: signing it is refused, the new text says $2.50.
    const stale = await request(app).post("/api/city/onboarding/agreement").set("Cookie", partner).send({ signer_name: "Peter Lee", consent: true, text_sha256: read });
    expect(stale.body.error).toBe("errors.agreementChanged");
    const fresh = await request(app).get("/api/city/onboarding").set("Cookie", partner).expect(200);
    expect(fresh.body.template.body).toContain("$2.50 per square foot");
    await request(app).patch(`/api/admin/city-partners/${partnerId}`).set("Cookie", admin).send({ fee_cents_per_sqft: 200 }).expect(200);
    const back = (await request(app).get("/api/city/onboarding").set("Cookie", partner)).body.template.sha256;
    expect(back).toBe(read);
    // v2+ asks for the business address on the signing screen (ignored on v1).
    const addr = { address_line: "1 Test Way", address_city: "Fontana", address_zip: "92335" };
    const s = await request(app).post("/api/city/onboarding/agreement").set("Cookie", partner).send({ signer_name: "Peter Lee", consent: true, text_sha256: back, ...addr }).expect(201);
    expect(s.body.agreement.fee_cents_per_sqft).toBe(200);
    expect((await request(app).post("/api/city/onboarding/agreement").set("Cookie", partner).send({ signer_name: "Peter Lee", consent: true, text_sha256: back, ...addr })).status).toBe(409);
    // Signed: rate and LLC name are frozen; contact details still editable; history records it all.
    expect((await request(app).patch(`/api/admin/city-partners/${partnerId}`).set("Cookie", admin).send({ fee_cents_per_sqft: 300 })).body.error).toBe("errors.cityRateLocked");
    expect((await request(app).patch(`/api/admin/city-partners/${partnerId}`).set("Cookie", admin).send({ company: "Other LLC" })).body.error).toBe("errors.cityCompanyLocked");
    await request(app).patch(`/api/admin/city-partners/${partnerId}`).set("Cookie", admin).send({ fee_cents_per_sqft: 200, phone: "+15555550193" }).expect(200);
    const d = await request(app).get(`/api/admin/city-partners/${partnerId}`).set("Cookie", admin).expect(200);
    expect(d.body.terms_locked).toBe(true);
    expect(d.body.changes.map((c: any) => c.field)).toEqual(expect.arrayContaining(["invited", "fee_cents_per_sqft", "signed", "phone"]));
    expect(d.body.changes.filter((c: any) => c.field === "fee_cents_per_sqft").map((c: any) => `${c.before}->${c.after}`)).toEqual(["250->200", "200->250"]);
    await request(app).patch(`/api/admin/projects/${publicId}/funds-received`).set("Cookie", admin).send({ date: "2026-11-02" }).expect(200);
    const [[none]] = (await db.query(`SELECT COUNT(*) n FROM city_partner_fees WHERE project_id = ?`, [projectId])) as any;
    expect(none.n).toBe(0);
  });

  it("W-9 goes in after signing: private PDF, last 4 only, finance reviews; staff and partner get the agreement PDF", async () => {
    const w9 = { legal_name: `${prefix}Remedio LLC`, tax_classification: "llc", llc_tax_class: "P", address: "1 Main St", city_state_zip: "Fontana, CA 92335", tin_type: "ein", tin: "12-3456789", signature_image: signaturePng(), certify: true };
    expect((await request(app).post("/api/city/onboarding/w9").set("Cookie", partner).send({ ...w9, tin: "000000000" })).status).toBe(400);
    const r = await request(app).post("/api/city/onboarding/w9").set("Cookie", partner).send(w9).expect(201);
    expect(r.body.w9).toMatchObject({ tin_type: "ein", tin_last4: "6789", status: "submitted" });
    expect(JSON.stringify(r.body)).not.toContain("123456789");
    const [[row]] = (await db.query(`SELECT pdf_blob_pathname FROM city_partner_w9s WHERE city_partner_id = ?`, [partnerId])) as any;
    expect(blobStore.get(row.pdf_blob_pathname)!.subarray(0, 5).toString()).toBe("%PDF-");
    expect((await request(app).post("/api/city/onboarding/w9").set("Cookie", partner).send(w9)).status).toBe(409);
    expect((await request(app).post(`/api/admin/city-partners/${partnerId}/w9s/${r.body.w9.id}/review`).set("Cookie", agent).send({ status: "accepted" })).status).toBe(403);
    await request(app).post(`/api/admin/city-partners/${partnerId}/w9s/${r.body.w9.id}/review`).set("Cookie", finance).send({ status: "accepted" }).expect(200);
    const pdf = await request(app).get("/api/city/agreement/pdf").set("Cookie", partner).buffer(true).parse((res, cb) => { const c: Buffer[] = []; res.on("data", (d: Buffer) => c.push(d)); res.on("end", () => cb(null, Buffer.concat(c))); }).expect(200);
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe("%PDF-");
    await request(app).get(`/api/admin/city-partners/${partnerId}/agreement/pdf`).set("Cookie", finance).expect(200);
  });

  it("finance opens partner pages but can't invite; only a super admin countersigns", async () => {
    await request(app).get("/api/admin/city-partners").set("Cookie", finance).expect(200);
    await request(app).get(`/api/admin/city-partners/${partnerId}`).set("Cookie", finance).expect(200);
    expect((await request(app).post("/api/admin/city-partners").set("Cookie", finance).send({ email: em("x"), first_name: "X", company: "X" })).status).toBe(403);
    const agId = (await request(app).get("/api/city/onboarding").set("Cookie", partner)).body.agreement.id;
    expect((await request(app).post(`/api/admin/city-partners/${partnerId}/agreements/${agId}/countersign`).set("Cookie", plainAdmin).send({ name: "Plain Admin" })).status).toBe(403);
  });

  it("partners edit their own contact details, not the LLC name or rate", async () => {
    const r = await request(app).patch("/api/city/profile").set("Cookie", partner).send({ phone: "+15555550192", preferred_language: "es", company: "Hacked LLC", fee_cents_per_sqft: 9999 }).expect(200);
    expect(r.body.partner).toMatchObject({ phone: "+15555550192", preferred_language: "es", company: `${prefix}Remedio LLC`, fee_cents_per_sqft: 200 });
  });

  it("after the countersign, funds received creates one fee due in 5 days; cancelling voids it", async () => {
    __testClearEmailDryRuns();
    await request(app).post(`/api/admin/city-partners/${partnerId}/agreements/${(await request(app).get("/api/city/onboarding").set("Cookie", partner)).body.agreement.id}/countersign`).set("Cookie", admin).send({ name: "Daniel Carrillo" }).expect(200);
    expect(__testGetEmailDryRuns().some((m: any) => [].concat(m.to).includes(em("peter") as never))).toBe(true);
    // Funded before the countersign: the fee appears now, without re-saving the funds date.
    const [[early]] = (await db.query(`SELECT amount_cents, status FROM city_partner_fees WHERE project_id = ? AND city_partner_id = ?`, [projectId, partnerId])) as any;
    expect(early).toMatchObject({ amount_cents: 166000, status: "pending" });
    const f = await request(app).patch(`/api/admin/projects/${publicId}/funds-received`).set("Cookie", admin).send({ date: "2026-11-02" }).expect(200);
    expect(f.body.fees).toHaveLength(1);
    expect(f.body.fees[0]).toMatchObject({ amount_cents: 830 * 200, due_on: "2026-11-07", status: "pending" });
    const fees = await request(app).get("/api/city/fees").set("Cookie", partner).expect(200);
    expect(fees.body.items[0].amount_cents).toBe(166000);
    await request(app).patch(`/api/admin/city-partner-fees/${f.body.fees[0].id}`).set("Cookie", admin).send({ status: "paid" }).expect(409);
    await request(app).patch(`/api/admin/city-partner-fees/${f.body.fees[0].id}`).set("Cookie", admin).send({ status: "approved" }).expect(200);
    __testClearEmailDryRuns();
    await request(app).patch(`/api/admin/city-partner-fees/${f.body.fees[0].id}`).set("Cookie", finance).send({ status: "paid" }).expect(200);
    expect(__testGetEmailDryRuns().some((m: any) => /1660\.00/.test(String(m.subject)))).toBe(true);
    expect((await request(app).get("/api/admin/city-partner-fees").set("Cookie", finance).expect(200)).body.items.some((x: any) => x.city_partner_id === partnerId)).toBe(true);
    // Partners on v2+ keep paid fees when a project is cancelled; only v1 fees become refund_due.
    // This suite's own test version has a high version number (v2+ rules), so mark the signed agreement as v1
    // to cover the refund rule (the later grid / feed tests read the refund_due fee).
    const [[signed]] = (await db.query(`SELECT template_version FROM city_partner_agreements WHERE city_partner_id = ?`, [partnerId])) as any;
    expect(Number(signed.template_version)).toBeGreaterThanOrEqual(1);
    await db.execute(`UPDATE city_partner_agreements SET template_version = 1 WHERE city_partner_id = ?`, [partnerId]);
    await request(app).patch(`/api/admin/projects/${publicId}`).set("Cookie", admin).send({ milestone: "cancelled" });
    const [[row]] = (await db.query(`SELECT status FROM city_partner_fees WHERE project_id = ?`, [projectId])) as any;
    expect(row.status).toBe("refund_due");
  });

  it("partners see only their cities, minimal homeowner data, and the city sheet only once checked", async () => {
    const list = await request(app).get("/api/city/cities").set("Cookie", partner).expect(200);
    expect(list.body.cities.map((c: any) => c.id)).toEqual([openCity]);
    expect((await request(app).get(`/api/city/cities/${otherCity}`).set("Cookie", partner)).status).toBe(404);
    const clients = await request(app).get("/api/city/clients").set("Cookie", partner).expect(200);
    expect(clients.body.clients[0]).toMatchObject({ name: "Maria R.", street: "Sierra Ave", sq_ft: 830 });
    expect(JSON.stringify(clients.body)).not.toContain("8421");
    expect(JSON.stringify(clients.body)).not.toContain("@example.com");
    expect((await request(app).get(`/api/city/cities/${openCity}`).set("Cookie", partner)).body.intel).toBeNull();
    await request(app).patch(`/api/admin/city-pipeline/${openCity}/intel`).set("Cookie", admin).send({ council_summary: "5 members", adu_program_status: "active" }).expect(200);
    await request(app).post(`/api/admin/city-pipeline/${openCity}/intel/verify`).set("Cookie", admin).expect(200);
    expect((await request(app).get(`/api/city/cities/${openCity}`).set("Cookie", partner)).body.intel.council_summary).toBe("5 members");
  });

  it("partners log activity and move stages but can't pre-approve; follow-ups feed the pipeline; CSV is safe", async () => {
    expect((await request(app).patch(`/api/city/cities/${openCity}`).set("Cookie", partner).send({ opened_on: "2026-01-01" })).status).toBe(403);
    expect((await request(app).patch(`/api/city/cities/${openCity}`).set("Cookie", partner).send({ pipeline_stage: null })).status).toBe(403);
    expect((await request(app).patch(`/api/city/cities/${openCity}`).set("Cookie", partner).send({ pipeline_stage: "preapproved" })).status).toBe(403);
    const add = await request(app).post(`/api/city/cities/${openCity}/activities`).set("Cookie", partner).send({ activity_type: "meeting", summary: "=HYPERLINK(\"x\")", follow_up_on: "2026-11-01", next_step: "Send plans" }).expect(201);
    expect(add.body.city.follow_up).toBe("overdue");
    expect(add.body.city.next_action).toBe("Send plans");
    expect((await request(app).post(`/api/city/cities/${openCity}/activities`).set("Cookie", partner).send({ activity_type: "call", summary: "x", link_url: "javascript:alert(1)" })).status).toBe(400);
    const csv = await request(app).get("/api/admin/city-pipeline/export.csv").set("Cookie", admin).expect(200);
    expect(csv.text).toContain(`${prefix}Fontana`);
    const other = await request(app).patch(`/api/admin/city-pipeline/${otherCity}`).set("Cookie", admin).send({ pipeline_stage: "preapproved" }).expect(200);
    expect(other.body.city.opened_on).toBeTruthy();
  });

  it("feed tells the story; overview has 12 months of earnings; stage moves are dated for the journey", async () => {
    await request(app).patch(`/api/admin/city-partners/${partnerId}`).set("Cookie", admin).send({ status: "active", city_ids: [openCity, otherCity] }).expect(200);
    await request(app).patch(`/api/admin/city-pipeline/${otherCity}`).set("Cookie", admin).send({ pipeline_stage: "staff_meeting" }).expect(200);
    const feed = await request(app).get("/api/city/feed").set("Cookie", partner).expect(200);
    const kinds = feed.body.items.map((i: any) => i.kind);
    expect(kinds).toEqual(expect.arrayContaining(["fee_earned", "fee_paid", "countersigned", "signed", "activity_meeting", "stage"]));
    expect(feed.body.items.find((i: any) => i.kind === "stage" && i.city_id === otherCity).title).toBe("staff_meeting");
    expect(JSON.stringify(feed.body)).not.toContain("@example.com");
    const sorted = [...feed.body.items].map((i: any) => i.at);
    expect(sorted).toEqual([...sorted].sort().reverse());
    const o = await request(app).get("/api/city/overview").set("Cookie", partner).expect(200);
    expect(o.body.earnings).toHaveLength(12);
    // Paid only counts fees still paid (this one became refund_due when its project was cancelled).
    const fees = (await request(app).get("/api/city/fees").set("Cookie", partner)).body.items;
    expect(o.body.earnings.reduce((n: number, m: any) => n + m.paid, 0)).toBe(fees.filter((f: any) => f.status === "paid").reduce((n: number, f: any) => n + f.amount_cents, 0));
    expect(fees.some((f: any) => f.status === "refund_due")).toBe(true);
    const d = await request(app).get(`/api/city/cities/${otherCity}`).set("Cookie", partner).expect(200);
    expect(Object.keys(d.body.stage_dates)).toContain("staff_meeting");
  });

  it("MCP: super admins read the pipeline and City Partners", async () => {
    let rpc = 1;
    const call = async (name: string, args: Record<string, unknown> = {}) => {
      const r = await request(app).post("/api/mcp").set("Cookie", admin).set("Accept", "application/json, text/event-stream").set("Content-Type", "application/json").send({ jsonrpc: "2.0", id: rpc++, method: "tools/call", params: { name, arguments: args } });
      const body = r.body?.result ? r.body : JSON.parse(String(r.text).split("\n").find((l) => l.startsWith("data: "))!.slice(6));
      return JSON.parse(body.result.content[0].text);
    };
    expect((await call("get_city_pipeline")).cities.some((c: any) => c.id === openCity)).toBe(true);
    expect((await call("get_city", { city_id: openCity })).city.name).toBe(`${prefix}Fontana`);
    expect((await call("list_city_partners")).partners.find((p: any) => p.id === partnerId)).toMatchObject({ agreement: "fully signed", w9: "accepted" });
  });

  it("server-side grids filter and page; only a super admin deletes a partner, typing the LLC name", async () => {
    const g = await request(app).get("/api/admin/city-partners").query({ q: prefix, agreement: "countersigned", city_id: openCity, limit: 5, offset: 0 }).set("Cookie", admin).expect(200);
    expect(g.body.total).toBe(1);
    expect((await request(app).get("/api/admin/city-partners").query({ q: prefix, agreement: "none" }).set("Cookie", admin)).body.total).toBe(0);
    const fees = await request(app).get("/api/admin/city-partner-fees").query({ partner_id: partnerId, status: "refund_due" }).set("Cookie", finance).expect(200);
    expect(fees.body.total).toBe(1);
    expect(fees.body.totals[0]).toMatchObject({ status: "refund_due", count: 1 });
    const pipe = await request(app).get("/api/admin/city-pipeline").query({ q: prefix, follow_up: "overdue", limit: 1 }).set("Cookie", admin).expect(200);
    expect(pipe.body.cities.map((c: any) => c.id)).toEqual([openCity]);
    const temp = (await request(app).post("/api/admin/city-partners").set("Cookie", admin).send({ email: em("temp"), first_name: "Temp", company: `${prefix}Temp LLC`, send_invite: false }).expect(201)).body.id;
    expect((await request(app).delete(`/api/admin/city-partners/${temp}`).set("Cookie", plainAdmin).send({ confirm_name: `${prefix}Temp LLC` })).status).toBe(403);
    expect((await request(app).delete(`/api/admin/city-partners/${temp}`).set("Cookie", admin).send({ confirm_name: "wrong" })).body.error).toBe("validation.confirmNameMismatch");
    await request(app).delete(`/api/admin/city-partners/${temp}`).set("Cookie", admin).send({ confirm_name: `${prefix}temp llc` }).expect(200);
    expect((await request(app).get(`/api/admin/city-partners/${temp}`).set("Cookie", admin)).status).toBe(404);
  });

  it("cities are picked: city_id wins and fills the text, exact typed names are tagged, bad ids are refused", async () => {
    const typed = await request(app).post("/api/admin/clients").set("Cookie", admin).send({ email: em("typed"), first_name: "Tia", last_name: "Typed", city: `${prefix}FONTANA` }).expect(201);
    const typedRow = ((await db.query(`SELECT city, city_id FROM clients WHERE id = ?`, [typed.body.client_id ?? typed.body.id])) as any)[0][0];
    expect(typedRow).toMatchObject({ city_id: openCity, city: `${prefix}Fontana` });
    const cid = typed.body.client_id ?? typed.body.id;
    await request(app).patch(`/api/admin/clients/${cid}`).set("Cookie", admin).send({ city_id: otherCity }).expect(200);
    expect(((await db.query(`SELECT city, city_id FROM clients WHERE id = ?`, [cid])) as any)[0][0]).toMatchObject({ city_id: otherCity, city: `${prefix}Rialto` });
    await request(app).patch(`/api/admin/clients/${cid}`).set("Cookie", admin).send({ city_id: 999999999 }).expect(400);
    // Not on the list: kept as typed, no city (staff tag it in Settings → Cities).
    const loose = await request(app).post("/api/admin/clients").set("Cookie", admin).send({ email: em("loose"), first_name: "Lu", last_name: "Loose", city: `${prefix}Nowhere` }).expect(201);
    expect(((await db.query(`SELECT city, city_id FROM clients WHERE id = ?`, [loose.body.client_id ?? loose.body.id])) as any)[0][0]).toMatchObject({ city_id: null, city: `${prefix}Nowhere` });
    // Events carry the picked city.
    const ev = await request(app).post("/api/admin/events").set("Cookie", admin).send({ slug: `${prefix}evt`, title_en: "City event", city_id: openCity, starts_at: new Date(Date.now() + 86400000).toISOString() }).expect(201);
    expect(ev.body.event).toMatchObject({ city_id: openCity, city: `${prefix}Fontana` });
  });

  it("View as partner: super admins only, read-only, logged on the partner", async () => {
    await request(app).post(`/api/admin/city-partners/${partnerId}/view-as`).set("Cookie", plainAdmin).expect(403);
    const r = await request(app).post(`/api/admin/city-partners/${partnerId}/view-as`).set("Cookie", admin).expect(200);
    const cookie = String([].concat(r.headers["set-cookie"] as never).find((c: string) => c.startsWith("gw_city_sid=")) || "").split(";")[0];
    expect(cookie).toMatch(/^gw_city_sid=[a-f0-9]{64}$/);
    const me = await request(app).get("/api/city/auth/me").set("Cookie", cookie).expect(200);
    expect(me.body.user.view_as_admin).toMatchObject({ name: "Cp Admin" });
    await request(app).get("/api/city/clients").set("Cookie", cookie).expect(200);
    const blocked = await request(app).patch("/api/city/profile").set("Cookie", cookie).send({ first_name: "Hacked" }).expect(403);
    expect(blocked.body.error).toBe("errors.viewOnly");
    const log = ((await db.query(`SELECT field, admin_id FROM city_partner_changes WHERE city_partner_id = ? AND field = 'viewed_as'`, [partnerId])) as any)[0];
    expect(log.length).toBe(1);
    // The partner's own session is untouched and still read-write.
    expect((await request(app).get("/api/city/auth/me").set("Cookie", partner).expect(200)).body.user.view_as_admin ?? null).toBeNull();
  });

  it("city requests: partner asks, duplicates refused, staff decline with a reason or approve (assigned + emailed)", async () => {
    const ask = (city_name: string) => request(app).post("/api/city/city-requests").set("Cookie", partner).send({ city_name, county: "San Bernardino", note: "Met the planning director" });
    const r1 = await ask(`${prefix}Upland`).expect(201);
    expect(r1.body.item).toMatchObject({ status: "pending", city_name: `${prefix}Upland` });
    expect((await ask(`${prefix}upland`).expect(409)).body.error).toBe("errors.cityRequestPending");
    expect((await ask(`${prefix}Fontana`).expect(409)).body.error).toBe("errors.cityAlreadyYours");
    const r2 = await ask(`${prefix}Ontario`).expect(201);
    await request(app).get("/api/admin/city-requests").set("Cookie", agent).expect(403);
    const list = await request(app).get("/api/admin/city-requests?status=pending").set("Cookie", admin).expect(200);
    expect(list.body.items.map((x: any) => x.id)).toEqual(expect.arrayContaining([r1.body.item.id, r2.body.item.id]));
    __testClearEmailDryRuns();
    await request(app).post(`/api/admin/city-requests/${r2.body.item.id}/decline`).set("Cookie", admin).send({ reason: "" }).expect(400);
    await request(app).post(`/api/admin/city-requests/${r2.body.item.id}/decline`).set("Cookie", admin).send({ reason: "Not in our area yet" }).expect(200);
    await request(app).post(`/api/admin/city-requests/${r1.body.item.id}/approve`).set("Cookie", admin).send({ city_id: otherCity }).expect(200);
    await request(app).post(`/api/admin/city-requests/${r1.body.item.id}/approve`).set("Cookie", admin).send({ city_id: otherCity }).expect(409);
    const assigned = ((await db.query(`SELECT 1 FROM city_partner_cities WHERE city_partner_id = ? AND city_id = ?`, [partnerId, otherCity])) as any)[0];
    expect(assigned.length).toBe(1);
    const mails = __testGetEmailDryRuns().filter((m: any) => [].concat(m.to).includes(em("peter") as never)) as any[];
    // Partner's language decides the copy (EN or ES).
    expect(mails.map((m) => m.subject)).toEqual(expect.arrayContaining([expect.stringMatching(/City added|Ciudad agregada/), expect.stringMatching(/About your city request|Sobre tu solicitud/)]));
    expect(mails.some((m) => String(m.html).includes("Not in our area yet"))).toBe(true);
    for (const m of mails) expect(String(m.html)).not.toMatch(/ — /);
    const mine = await request(app).get("/api/city/city-requests").set("Cookie", partner).expect(200);
    expect(mine.body.items.map((x: any) => x.status).sort()).toEqual(["approved", "declined"]);
  });

  it("city meetings: partner books on an assigned city, staff are invited (owner first), logged on the city; cancel works", async () => {
    const staff = await request(app).get("/api/city/staff").set("Cookie", partner).expect(200);
    const adminRow = staff.body.staff.find((x: any) => x.name === "Cp Admin");
    expect(adminRow).toBeTruthy();
    const when = new Date(Date.now() + 9 * 86400000).toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
    const body = { city_id: openCity, title: `${prefix}City staff meeting`, date: when, start: "10:00", duration_minutes: 60, location_type: "office", location: "City Hall", admin_ids: [adminRow.id] };
    await request(app).post("/api/city/meetings").set("Cookie", partner).send({ ...body, admin_ids: [] }).expect(400);
    const notMine = ((await db.query(`SELECT id FROM service_cities WHERE id NOT IN (SELECT city_id FROM city_partner_cities WHERE city_partner_id = ?) LIMIT 1`, [partnerId])) as any)[0][0];
    if (notMine) await request(app).post("/api/city/meetings").set("Cookie", partner).send({ ...body, city_id: notMine.id }).expect(403);
    __testClearEmailDryRuns();
    const booked = await request(app).post("/api/city/meetings").set("Cookie", partner).send(body).expect(201);
    expect(booked.body.item).toMatchObject({ city_id: openCity, staff: ["Cp Admin"], status: "scheduled" });
    const appt = ((await db.query(`SELECT kind, source, owner_admin_id, city_partner_id FROM appointments WHERE id = ?`, [booked.body.item.id])) as any)[0][0];
    expect(appt).toMatchObject({ kind: "city_meeting", source: "city_partner", owner_admin_id: adminRow.id, city_partner_id: partnerId });
    const invited = __testGetEmailDryRuns().map((m: any) => [].concat(m.to)).flat();
    expect(invited).toEqual(expect.arrayContaining([em("admin"), em("peter")]));
    const act = ((await db.query(`SELECT activity_type, follow_up_on FROM city_activities WHERE city_id = ? AND city_partner_id = ? AND activity_type = 'meeting' ORDER BY id DESC LIMIT 1`, [openCity, partnerId])) as any)[0][0];
    expect(act).toBeTruthy();
    const list = await request(app).get(`/api/city/meetings?city_id=${openCity}`).set("Cookie", partner).expect(200);
    expect(list.body.items.some((m: any) => m.id === booked.body.item.id)).toBe(true);
    await request(app).post(`/api/city/meetings/${booked.body.item.id}/cancel`).set("Cookie", partner).send({}).expect(200);
    expect(((await db.query(`SELECT status FROM appointments WHERE id = ?`, [booked.body.item.id])) as any)[0][0].status).toBe("cancelled");
  });

  it("an inactive partner is signed out and can't request a code", async () => {
    await request(app).patch(`/api/admin/city-partners/${partnerId}`).set("Cookie", admin).send({ status: "inactive" }).expect(200);
    expect((await request(app).get("/api/city/overview").set("Cookie", partner)).status).toBe(401);
    __testClearEmailDryRuns();
    await request(app).post("/api/city/auth/otp/request").send({ email: em("peter") });
    expect(__testGetEmailDryRuns().some((m: any) => [].concat(m.to).includes(em("peter") as never))).toBe(false);
  });
});
