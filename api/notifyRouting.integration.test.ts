import crypto from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { __testNotifyRecipients, __testSetNotifyRouting, createServer } from "./index";
import { cleanupPortalFixturesByPrefix, createIntegrationTestPool } from "./testDbCleanup";

const hasDb = Boolean(process.env.DB_HOST && process.env.DB_USER && process.env.DB_NAME);

describe.runIf(hasDb)("staff notification routing (who gets what)", () => {
  const app = createServer();
  const db = createIntegrationTestPool();
  const prefix = `gwroute-${Date.now()}-`;
  const em = (n: string) => `${prefix}${n}@example.com`;
  const ids: Record<string, number> = {};
  const cookies: Record<string, string> = {};
  const ins = async (sql: string, p: unknown[]) => Number(((await db.execute(sql, p as any[])) as any)[0].insertId);
  const bells = async (who: string, event: string) =>
    Number(((await db.query(`SELECT COUNT(*) n FROM admin_notifications WHERE admin_id = ? AND event_key = ?`, [ids[who], event])) as any)[0][0].n);

  beforeAll(async () => {
    process.env.VITEST = "true";
    __testSetNotifyRouting(null);
    for (const [who, role] of [["super", "super_admin"], ["sales", "agent"], ["ops", "admin"], ["owner", "agent"]] as const) {
      ids[who] = await ins(`INSERT INTO admins (email, first_name, last_name, role, status) VALUES (?, ?, 'Route', ?, 'active')`, [em(who), who, role]);
      const t = crypto.randomBytes(32).toString("hex");
      await db.execute(`INSERT INTO admin_sessions (admin_id, token_hash, expires_at) VALUES (?, ?, NOW() + INTERVAL 1 HOUR)`, [ids[who], crypto.createHash("sha256").update(t).digest("hex")]);
      cookies[who] = `gw_admin_sid=${t}`;
    }
  });

  afterAll(async () => {
    __testSetNotifyRouting(null);
    try {
      await cleanupPortalFixturesByPrefix(db, prefix);
    } finally {
      await db.end();
    }
  });

  it("not set up: super admins only (no more 'everyone gets everything')", async () => {
    const r = await __testNotifyRecipients("client_created");
    expect(r).toContain(ids.super);
    expect(r).not.toContain(ids.sales);
    expect(r).not.toContain(ids.ops);
  });

  it("an area goes to the chosen people; other areas are unaffected", async () => {
    __testSetNotifyRouting({ leads: { adminIds: [ids.sales], includeOwner: true }, contractors: { adminIds: [ids.ops], includeOwner: true } });
    expect(await __testNotifyRecipients("lead_submitted")).toEqual([ids.sales]);
    expect(await __testNotifyRecipients("get_credit_report_lead")).toEqual([ids.sales]);
    expect(await __testNotifyRecipients("contractor_application_submitted")).toEqual([ids.ops]);
    const affiliates = await __testNotifyRecipients("affiliate_signup");
    expect(affiliates).toContain(ids.super);
    expect(affiliates).not.toContain(ids.sales);
  });

  it("the client's / project's assigned staff member also gets it (unless the area turns that off)", async () => {
    const clientId = await ins(`INSERT INTO clients (first_name, last_name, email, status, assigned_admin_id) VALUES ('Own', 'Ed', ?, 'active', ?)`, [em("cli"), ids.owner]);
    const pub = `GW-R${String(Date.now()).slice(-6)}`;
    await ins(`INSERT INTO projects (public_id, client_id) VALUES (?, ?)`, [pub, clientId]);
    __testSetNotifyRouting({ clients: { adminIds: [ids.ops], includeOwner: true }, projects: { adminIds: [ids.ops], includeOwner: false } });
    expect((await __testNotifyRecipients("client_created", { clientId })).sort()).toEqual([ids.ops, ids.owner].sort());
    expect(await __testNotifyRecipients("milestone_changed", { projectPublicId: pub })).toEqual([ids.ops]);
    // Not set up: super admins + the owner.
    __testSetNotifyRouting({});
    const d = await __testNotifyRecipients("draw_submitted", { projectPublicId: pub });
    expect(d).toContain(ids.owner);
    expect(d).toContain(ids.super);
  });

  it("end to end: a client added by staff rings the routed people + its new owner (the creator), nobody else", async () => {
    __testSetNotifyRouting({ clients: { adminIds: [ids.sales], includeOwner: true } });
    await request(app).post("/api/admin/clients").set("Cookie", cookies.ops).send({ first_name: "Rita", last_name: "Route", email: em("rita") }).expect(201);
    expect(await bells("sales", "client_created")).toBe(1);
    // Staff who add a client are its assigned owner.
    expect(await bells("ops", "client_created")).toBe(1);
    expect(await bells("owner", "client_created")).toBe(0);
    expect(await bells("super", "client_created")).toBe(0);
  });

  it("settings API: super admins only; can't save an empty area; save + reset", async () => {
    __testSetNotifyRouting({});
    await request(app).get("/api/admin/notify-routing").set("Cookie", cookies.ops).expect(403);
    const g = await request(app).get("/api/admin/notify-routing").set("Cookie", cookies.super).expect(200);
    const leads = g.body.areas.find((a: any) => a.area === "leads");
    expect(leads).toMatchObject({ configured: false });
    expect(leads.events).toEqual(expect.arrayContaining(["lead_submitted", "get_credit_report_lead"]));
    expect(g.body.areas.some((a: any) => a.events.includes("inbound_sms") || a.events.includes("inbound_email"))).toBe(false);
    const empty = await request(app).put("/api/admin/notify-routing").set("Cookie", cookies.super).send({ areas: [{ area: "leads", admin_ids: [], include_owner: true }] });
    expect(empty.body.error).toBe("validation.notifyRoutingEmpty");
    const saved = await request(app).put("/api/admin/notify-routing").set("Cookie", cookies.super).send({ areas: [{ area: "leads", admin_ids: [ids.sales], include_owner: true }] }).expect(200);
    expect(saved.body.areas.find((a: any) => a.area === "leads")).toMatchObject({ configured: true, admin_ids: [ids.sales] });
    expect(await __testNotifyRecipients("lead_submitted")).toEqual([ids.sales]);
    const reset = await request(app).put("/api/admin/notify-routing").set("Cookie", cookies.super).send({ areas: [{ area: "leads", reset: true }] }).expect(200);
    expect(reset.body.areas.find((a: any) => a.area === "leads").configured).toBe(false);
    // The shared table was never written by this suite.
    const [[row]] = (await db.query(`SELECT COUNT(*) n FROM notify_routing WHERE JSON_CONTAINS(admin_ids_json, CAST(? AS JSON))`, [String(ids.sales)])) as any;
    expect(Number(row.n)).toBe(0);
  });
});
