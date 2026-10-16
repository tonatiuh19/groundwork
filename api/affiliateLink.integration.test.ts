import "dotenv/config";
import crypto from "crypto";
import type { ResultSetHeader } from "mysql2";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createServer } from "./index";
import { cleanupPortalFixturesByPrefix, createIntegrationTestPool } from "./testDbCleanup";

const hasDb = Boolean(process.env.DB_HOST && process.env.DB_USER && process.env.DB_NAME);

/** Affiliate link: EN/ES URLs, self-service link name (30-day rule + history), flyer PDF. */
describe.runIf(hasDb)("affiliate link (integration)", () => {
  const app = createServer();
  const db = createIntegrationTestPool();
  const stamp = Date.now();
  const prefix = `gwlink-${stamp}-`;
  const em = (n: string) => `${prefix}${n}@example.com`;
  const slugBase = `gwl${String(stamp).slice(-8)}`;
  let cookie = "";
  let otherCookie = "";
  let adminCookie = "";
  let affId = 0;

  const insertId = async (sql: string, params: unknown[]) =>
    Number(((await db.execute(sql, params as any[])) as unknown as [ResultSetHeader])[0].insertId);
  const session = async (actor: "affiliate" | "admin", id: number) => {
    const token = crypto.randomBytes(32).toString("hex");
    await db.execute(`INSERT INTO \`${actor}_sessions\` (\`${actor}_id\`, token_hash, expires_at) VALUES (?, ?, ?)`, [
      id, crypto.createHash("sha256").update(token).digest("hex"), new Date(Date.now() + 86_400_000),
    ]);
    return `gw_${actor}_sid=${token}`;
  };
  const code = () => `L${crypto.randomBytes(5).toString("hex").toUpperCase()}`;

  beforeAll(async () => {
    process.env.VITEST = "true";
    affId = await insertId(`INSERT INTO affiliates (email, first_name, last_name, company, status, referral_code, slug) VALUES (?, 'María', 'López', 'Casa Realty', 'active', ?, ?)`, [em("maria"), code(), `${slugBase}-a`]);
    const otherId = await insertId(`INSERT INTO affiliates (email, first_name, last_name, status, referral_code) VALUES (?, 'Otro', 'Afiliado', 'active', ?)`, [em("other"), code()]);
    const adminId = await insertId(`INSERT INTO admins (email, first_name, last_name, role, status) VALUES (?, 'Link', 'Admin', 'admin', 'active')`, [em("admin")]);
    cookie = await session("affiliate", affId);
    otherCookie = await session("affiliate", otherId);
    adminCookie = await session("admin", adminId);
  });

  afterAll(async () => {
    try {
      await db.query(`DELETE FROM affiliate_slug_history WHERE slug LIKE ?`, [`${slugBase}%`]);
      await cleanupPortalFixturesByPrefix(db, prefix);
    } finally {
      await db.end();
    }
  });

  it("returns EN + ES links with stats", async () => {
    const r = await request(app).get("/api/affiliate/link").set("Cookie", cookie).expect(200);
    expect(r.body.slug).toBe(`${slugBase}-a`);
    expect(r.body.urls.en).toMatch(new RegExp(`/r/${slugBase}-a$`));
    expect(r.body.urls.es).toBe(`${r.body.urls.en}?lang=es`);
    expect(r.body.can_change_slug_at).toBeNull();
    expect(r.body.stats).toMatchObject({ clicks_total: 0, leads: 0, clients: 0 });
  });

  it("self-service rename: old name keeps resolving 30 days, others can't take it, once per 30 days", async () => {
    await request(app).patch("/api/affiliate/link").set("Cookie", cookie).send({ slug: "admin" }).expect(400);
    const r = await request(app).patch("/api/affiliate/link").set("Cookie", cookie).send({ slug: `${slugBase} María B` }).expect(200);
    expect(r.body.slug).toBe(`${slugBase}-maria-b`);
    expect(r.body.can_change_slug_at).toBeTruthy();
    // Old link still lands on this affiliate (and counts the click).
    const old = await request(app).get(`/api/public/affiliates/by-code/${slugBase}-a`).expect(200);
    expect(old.body.affiliate.first_name).toBe("María");
    const fresh = await request(app).get(`/api/public/affiliates/by-code/${slugBase}-maria-b`).expect(200);
    expect(fresh.body.affiliate.slug).toBe(`${slugBase}-maria-b`);
    // Another affiliate can't grab the retired name while it still resolves.
    const steal = await request(app).patch("/api/affiliate/link").set("Cookie", otherCookie).send({ slug: `${slugBase}-a` });
    expect(steal.status).toBe(409);
    // Second change inside 30 days → refused.
    const again = await request(app).patch("/api/affiliate/link").set("Cookie", cookie).send({ slug: `${slugBase}-c` });
    expect(again.status).toBe(429);
    expect(again.body.error).toBe("errors.slugChangeTooSoon");
    const [[click]] = (await db.query(`SELECT COUNT(*) n FROM affiliate_link_clicks WHERE affiliate_id = ?`, [affId])) as any;
    expect(Number(click.n)).toBe(2);
  });

  it("admin slug edits also keep the old name working", async () => {
    await request(app).patch(`/api/admin/affiliates/${affId}`).set("Cookie", adminCookie).send({ slug: `${slugBase}-admin` }).expect(200);
    await request(app).get(`/api/public/affiliates/by-code/${slugBase}-maria-b`).expect(200);
  });

  it("flyer: valid PDF in English and Spanish", async () => {
    for (const lang of ["en", "es"]) {
      const r = await request(app).get(`/api/affiliate/link/flyer?lang=${lang}`).set("Cookie", cookie).buffer(true).parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => cb(null, Buffer.concat(chunks)));
      }).expect(200);
      expect(r.headers["content-type"]).toContain("application/pdf");
      expect((r.body as Buffer).subarray(0, 5).toString("latin1")).toBe("%PDF-");
      expect((r.body as Buffer).length).toBeGreaterThan(5000);
    }
    await request(app).get("/api/affiliate/link/flyer").expect(401);
  });
});
