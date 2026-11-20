import "dotenv/config";
import crypto from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createServer } from "./index";
import { cleanupPortalFixturesByPrefix, createIntegrationTestPool } from "./testDbCleanup";

const hasDb = Boolean(process.env.DB_HOST && process.env.DB_USER && process.env.DB_NAME);
const PNG = `data:image/png;base64,${Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(160, 7)]).toString("base64")}`;

/**
 * Special agreements wiring: send → sign (exact text) → super admin countersign; a replace agreement turns
 * the affiliate's own row on an event project into rate × sq ft, an extra-on-top owner agreement adds its own
 * row; void restores the normal amount; staff exclude removes a project. Illegal: non-super countersign,
 * signing changed text.
 */
describe.skipIf(!hasDb)("affiliate special agreements (integration)", () => {
  const app = createServer();
  const db = createIntegrationTestPool();
  const prefix = `gwaddm-${Date.now()}-`;
  const em = (n: string) => `${prefix}${n}@example.com`;
  const ins = async (sql: string, p: unknown[]) => Number(((await db.execute(sql, p as any[])) as any)[0].insertId);
  const q = async (sql: string, p: unknown[]) => ((await db.query(sql, p as any[])) as any)[0] as any[];
  const session = async (table: string, col: string, id: number) => {
    const t = crypto.randomBytes(32).toString("hex");
    await db.execute(`INSERT INTO ${table} (${col}, token_hash, expires_at) VALUES (?, ?, NOW() + INTERVAL 1 HOUR)`, [id, crypto.createHash("sha256").update(t).digest("hex")]);
    return t;
  };
  const affiliate = (n: string) =>
    ins(`INSERT INTO affiliates (email, first_name, last_name, status, referral_code) VALUES (?, ?, 'Addm', 'active', ?)`, [em(n), `${prefix}${n}`, `AD${crypto.randomBytes(4).toString("hex").toUpperCase()}`]);
  let brendaId = 0;
  let ownerId = 0;
  let loId = 0;
  let projectId = 0;
  let publicId = "";
  let eventId = 0;
  let superCookie = "";
  let adminCookie = "";
  let brendaCookie = "";
  let ownerCookie = "";

  const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
  const row = async (affId: number) => (await q(`SELECT amount_cents, status, role, addendum_id, addendum_base_cents FROM affiliate_commissions WHERE project_id = ? AND affiliate_id = ?`, [projectId, affId]))[0];
  /** Create → send → affiliate signs → super admin countersigns. */
  const fullAddendum = async (affId: number, cookie: string, body: Record<string, unknown>) => {
    const id = (await request(app).post(`/api/admin/affiliates/${affId}/addenda`).set("Cookie", superCookie).send(body).expect(201)).body.addendum.id;
    const sent = (await request(app).post(`/api/admin/addenda/${id}/send`).set("Cookie", superCookie).expect(200)).body.addendum;
    await request(app)
      .post(`/api/affiliate/addenda/${id}/sign`)
      .set("Cookie", cookie)
      .send({ lang: "en", text_sha256: sha(sent.rendered_en), signed_name: `${prefix}Signer`, signature_image: PNG, consent: true })
      .expect(200);
    return id as number;
  };

  beforeAll(async () => {
    process.env.VITEST = "true";
    brendaId = await affiliate("brenda");
    ownerId = await affiliate("owner");
    loId = await affiliate("lo");
    eventId = await ins(
      `INSERT INTO marketing_events (slug, status, starts_at, city, title_en, title_es) VALUES (?, 'published', NOW() + INTERVAL 5 DAY, 'Fontana', ?, ?)`,
      [`${prefix}night`, `${prefix}Mortgage night`, `${prefix}Noche`],
    );
    const clientId = await ins(`INSERT INTO clients (first_name, last_name, email, status, affiliate_id) VALUES ('Ana', 'Homeowner', ?, 'active', ?)`, [em("client"), brendaId]);
    const leadId = await ins(`INSERT INTO leads (full_name, email, phone, mode, event_id, client_id) VALUES ('Ana Homeowner', ?, '+15555550188', 'event', ?, ?)`, [em("lead"), eventId, clientId]);
    publicId = `A${crypto.randomBytes(6).toString("hex").toUpperCase()}`;
    projectId = await ins(
      `INSERT INTO projects (public_id, client_id, lead_id, affiliate_id, closer_affiliate_id, sq_ft, loan_status) VALUES (?, ?, ?, ?, ?, 1000, 'finalized')`,
      [publicId, clientId, leadId, brendaId, brendaId],
    );
    // The owner already has a (sponsor-style) row on this project: "extra" adds to it.
    await db.execute(
      `INSERT INTO affiliate_commissions (affiliate_id, role, project_id, client_id, amount_cents, sq_ft, rate_cents_per_sqft, status) VALUES (?, 'parent', ?, ?, 50000, 1000, 50, 'pending')`,
      [ownerId, projectId, clientId],
    );
    // Brenda's normal commission on this project ($1.50 / sq ft).
    await db.execute(
      `INSERT INTO affiliate_commissions (affiliate_id, role, project_id, client_id, amount_cents, sq_ft, rate_cents_per_sqft, status) VALUES (?, 'direct', ?, ?, 150000, 1000, 150, 'pending')`,
      [brendaId, projectId, clientId],
    );
    const superId = await ins(`INSERT INTO admins (email, first_name, last_name, role, status) VALUES (?, 'Ad', 'Super', 'super_admin', 'active')`, [em("super")]);
    const adminId = await ins(`INSERT INTO admins (email, first_name, last_name, role, status) VALUES (?, 'Ad', 'Admin', 'admin', 'active')`, [em("admin")]);
    superCookie = `gw_admin_sid=${await session("admin_sessions", "admin_id", superId)}`;
    adminCookie = `gw_admin_sid=${await session("admin_sessions", "admin_id", adminId)}`;
    brendaCookie = `gw_affiliate_sid=${await session("affiliate_sessions", "affiliate_id", brendaId)}`;
    ownerCookie = `gw_affiliate_sid=${await session("affiliate_sessions", "affiliate_id", ownerId)}`;
  });

  afterAll(async () => {
    try {
      await db.execute(`DELETE FROM affiliate_commissions WHERE project_id = ?`, [projectId]);
      await db.execute(`DELETE FROM projects WHERE id = ?`, [projectId]);
      await cleanupPortalFixturesByPrefix(db, prefix);
    } finally {
      await db.end();
    }
  });

  it("refuses changed text and a non-super countersign", async () => {
    const id = (await request(app).post(`/api/admin/affiliates/${brendaId}/addenda`).set("Cookie", superCookie).send({ rate_cents_per_sqft: 200, event_ids: [eventId] }).expect(201)).body.addendum.id;
    await request(app).post(`/api/admin/addenda/${id}/send`).set("Cookie", superCookie).expect(200);
    // Saving with nothing changed (e.g. Preview) keeps it sent; a real change takes it back to draft.
    expect((await request(app).put(`/api/admin/addenda/${id}`).set("Cookie", superCookie).send({ event_ids: [eventId] }).expect(200)).body.addendum.status).toBe("sent");
    expect((await request(app).put(`/api/admin/addenda/${id}`).set("Cookie", superCookie).send({ rate_cents_per_sqft: 250 }).expect(200)).body.addendum.status).toBe("draft");
    await request(app).post(`/api/admin/addenda/${id}/send`).set("Cookie", superCookie).expect(200);
    await request(app)
      .post(`/api/affiliate/addenda/${id}/sign`)
      .set("Cookie", brendaCookie)
      .send({ lang: "en", text_sha256: "0".repeat(64), signed_name: "Brenda", signature_image: PNG, consent: true })
      .expect(409);
    await request(app).post(`/api/admin/addenda/${id}/void`).set("Cookie", superCookie).send({ reason: "test cleanup" }).expect(200);
    const id2 = await fullAddendum(brendaId, brendaCookie, { rate_cents_per_sqft: 200, event_ids: [eventId] });
    await request(app).post(`/api/admin/addenda/${id2}/countersign`).set("Cookie", adminCookie).send({ name: "Admin" }).expect(403);
    await request(app).post(`/api/admin/addenda/${id2}/void`).set("Cookie", superCookie).send({ reason: "test cleanup" }).expect(200);
  });

  it("replace + extra apply on countersign, exclude and void restore", async () => {
    // Brenda: $2 replaces her own $1.50 on the event project. Owner: $1 on his loan officer's clients + the event.
    const bId = await fullAddendum(brendaId, brendaCookie, { rate_cents_per_sqft: 200, pay_mode: "replace", event_ids: [eventId] });
    const oId = await fullAddendum(ownerId, ownerCookie, { rate_cents_per_sqft: 100, pay_mode: "extra", event_ids: [eventId], affiliate_ids: [loId] });
    expect(await row(brendaId)).toMatchObject({ amount_cents: 150000, addendum_id: null }); // nothing until countersigned
    await request(app).post(`/api/admin/addenda/${bId}/countersign`).set("Cookie", superCookie).send({ name: "Groundwork" }).expect(200);
    await request(app).post(`/api/admin/addenda/${oId}/countersign`).set("Cookie", superCookie).send({ name: "Groundwork" }).expect(200);
    expect(await row(brendaId)).toMatchObject({ amount_cents: 200000, role: "direct", addendum_id: bId, addendum_base_cents: 150000 });
    expect(await row(ownerId)).toMatchObject({ amount_cents: 150000, role: "parent", status: "pending", addendum_id: oId, addendum_base_cents: 50000 });

    // Applying again (staff include, then undo) never doubles an amount.
    await request(app).post(`/api/admin/addenda/${bId}/projects/${projectId}`).set("Cookie", superCookie).send({ mode: "include", reason: "Confirmed at the door" }).expect(200);
    await request(app).post(`/api/admin/addenda/${bId}/projects/${projectId}`).set("Cookie", superCookie).send({ mode: "clear" }).expect(200);
    expect((await row(brendaId)).amount_cents).toBe(200000);
    expect((await row(ownerId)).amount_cents).toBe(150000);

    // Sq ft changes re-price through the normal commission recalc, still without doubling.
    await request(app).patch(`/api/admin/projects/${publicId}`).set("Cookie", superCookie).send({ sq_ft: 1200 }).expect(200);
    expect((await row(brendaId)).amount_cents).toBe(240000);
    expect((await row(ownerId)).amount_cents).toBe(50000 + 120000);

    // The owner sees the project in Production (first name + last initial).
    const prod = (await request(app).get(`/api/affiliate/production`).set("Cookie", ownerCookie).expect(200)).body.agreements;
    expect(prod[0].projects[0]).toMatchObject({ name: "Ana H.", fee_cents: 170000 });
    expect(prod[0].signups.length).toBe(1);

    // Staff exclude the project from the owner's agreement: his row goes back to its own amount.
    await request(app).post(`/api/admin/addenda/${oId}/projects/${projectId}`).set("Cookie", superCookie).send({ mode: "exclude", reason: "Not his deal" }).expect(200);
    expect(await row(ownerId)).toMatchObject({ amount_cents: 50000, addendum_id: null });

    // Voiding Brenda's agreement puts her normal commission (recorded when it was replaced) back.
    const normal = Number((await row(brendaId)).addendum_base_cents);
    await request(app).post(`/api/admin/addenda/${bId}/void`).set("Cookie", superCookie).send({ reason: "Deal changed" }).expect(200);
    const back = await row(brendaId);
    expect(back).toMatchObject({ addendum_id: null, addendum_base_cents: null, amount_cents: normal });

    // Event page lists the agreements attached to it (voided ones too, with their status).
    const ev = (await request(app).get(`/api/admin/events/${eventId}/addenda`).set("Cookie", superCookie).expect(200)).body.addenda;
    expect(ev.find((a: any) => a.id === oId)?.status).toBe("countersigned");
    expect(ev.find((a: any) => a.id === bId)?.status).toBe("void");
  });
});
