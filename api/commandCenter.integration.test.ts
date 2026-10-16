import crypto from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createServer } from "./index";
import { cleanupPortalFixturesByPrefix, createIntegrationTestPool } from "./testDbCleanup";

const hasDb = Boolean(process.env.DB_HOST && process.env.DB_USER && process.env.DB_NAME);

describe.runIf(hasDb)("staff command center (dashboard) — role-aware", () => {
  const app = createServer();
  const db = createIntegrationTestPool();
  const prefix = `gwcmd-${Date.now()}-`;
  const em = (n: string) => `${prefix}${n}@example.com`;
  const cookies: Record<string, string> = {};
  const ids: Record<string, number> = {};

  beforeAll(async () => {
    process.env.VITEST = "true";
    for (const role of ["super_admin", "agent", "finance", "content"]) {
      const [r]: any = await db.execute(`INSERT INTO admins (email, first_name, last_name, role, status) VALUES (?, ?, 'Cmd', ?, 'active')`, [em(role), role, role]);
      ids[role] = Number(r.insertId);
      const t = crypto.randomBytes(32).toString("hex");
      await db.execute(`INSERT INTO admin_sessions (admin_id, token_hash, expires_at) VALUES (?, ?, NOW() + INTERVAL 1 HOUR)`, [ids[role], crypto.createHash("sha256").update(t).digest("hex")]);
      cookies[role] = `gw_admin_sid=${t}`;
    }
    // A fresh pending affiliate + new lead so the inbox and activity have something of ours.
    await db.execute(`INSERT INTO affiliates (email, first_name, last_name, status, referral_code) VALUES (?, 'Pen', 'Ding', 'pending', ?)`, [em("aff"), `GWC${String(Date.now()).slice(-7)}`]);
    await db.execute(`INSERT INTO leads (first_name, last_name, full_name, email, phone, status, source) VALUES ('Lee', 'Lead', 'Lee Lead', ?, ?, 'new', ?)`, [em("lead"), `951${String(Date.now()).slice(-7)}`, `${prefix}source`]);
  });

  afterAll(async () => {
    try {
      await cleanupPortalFixturesByPrefix(db, prefix);
    } finally {
      await db.end();
    }
  });

  const get = (role: string, q = "") => request(app).get(`/api/admin/command-center${q}`).set("Cookie", cookies[role]);

  it("super admin: inbox (approvals + leads), money, trends and activity", async () => {
    const r = await get("super_admin").expect(200);
    const keys = r.body.inbox.map((i: any) => i.key);
    expect(keys).toEqual(expect.arrayContaining(["affiliates_pending", "leads_new"]));
    expect(r.body.inbox.every((i: any) => i.count > 0 && i.to.startsWith("/admin"))).toBe(true);
    expect(r.body.money).toMatchObject({ mrr_cents: expect.any(Number), pipeline: expect.any(Array) });
    expect(r.body.trends.weeks).toHaveLength(12);
    expect(r.body.trends.funnel.leads).toBeGreaterThanOrEqual(1);
    expect(r.body.activity.some((a: any) => a.kind === "lead" && a.title === "Lee Lead")).toBe(true);
    // Alerts first.
    const tones = r.body.inbox.map((i: any) => i.tone);
    expect([...tones].sort((a: string, b: string) => ["alert", "warn", "info"].indexOf(a) - ["alert", "warn", "info"].indexOf(b))).toEqual(tones);
  });

  it("agent: leads work, no approvals or money", async () => {
    const r = await get("agent").expect(200);
    const keys = r.body.inbox.map((i: any) => i.key);
    expect(keys).toContain("leads_new");
    expect(keys).not.toContain("affiliates_pending");
    expect(r.body.money).toBeNull();
    expect(r.body.trends).not.toBeNull();
  });

  it("finance: money without leads; content: no money, no leads", async () => {
    const f = await get("finance").expect(200);
    expect(f.body.money).not.toBeNull();
    expect(f.body.inbox.map((i: any) => i.key)).not.toContain("leads_new");
    const c = await get("content").expect(200);
    expect(c.body.money).toBeNull();
    expect(c.body.trends).toBeNull();
    expect(c.body.inbox.map((i: any) => i.key)).not.toContain("leads_new");
  });

  it("mine narrows appointments to the signed-in staff member", async () => {
    const start = new Date(Date.now() + 30 * 60_000);
    for (const [who, title] of [["super_admin", `${prefix}mine`], ["agent", `${prefix}theirs`]] as const) {
      await db.execute(
        `INSERT INTO appointments (title, kind, starts_at, ends_at, timezone, location_type, owner_admin_id, created_by_admin_id, ics_uid) VALUES (?, 'call', ?, ?, 'America/Los_Angeles', 'phone', ?, ?, ?)`,
        [title, start, new Date(start.getTime() + 30 * 60_000), ids[who], ids[who], `${title}@groundwork.test`],
      );
    }
    const all = await get("super_admin").expect(200);
    const mine = await get("super_admin", "?mine=1").expect(200);
    const titles = (r: any) => r.body.appointments.map((a: any) => a.title);
    // Only assert when "now + 30 min" is still today in Pacific time.
    if (titles(all).includes(`${prefix}theirs`)) {
      expect(titles(mine)).toContain(`${prefix}mine`);
      expect(titles(mine)).not.toContain(`${prefix}theirs`);
    }
  });

  it("requires a staff session", async () => {
    await request(app).get("/api/admin/command-center").expect(401);
  });
});
