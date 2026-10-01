/**
 * Anchor lender sync coverage.
 */
import crypto from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import {
  __test,
  createServer,
  mapAnchorLoanStatus,
} from "./index";
import {
  cleanupPortalFixturesByPrefix,
  createIntegrationTestPool,
} from "./testDbCleanup";

const hasDb = Boolean(process.env.DB_HOST && process.env.DB_USER && process.env.DB_NAME);
const app = createServer();
const db = createIntegrationTestPool();
const prefix = `gwanchor-${Date.now()}-`;
const em = (n: string) => `${prefix}${n}@example.com`;

async function insertId(sql: string, params: any[]): Promise<number> {
  const [r] = await db.execute(sql, params);
  return Number((r as { insertId: number }).insertId);
}

describe("mapAnchorLoanStatus (pure)", () => {
  it("maps common Anchor statuses", () => {
    expect(mapAnchorLoanStatus("funded")).toBe("finalized");
    expect(mapAnchorLoanStatus("Under Writing")).toBe("underwriting");
    expect(mapAnchorLoanStatus("CLEAR_TO_CLOSE")).toBe("approved");
    expect(mapAnchorLoanStatus("nope")).toBeNull();
  });
});

describe.runIf(hasDb)("Anchor sync (integration)", () => {
  let adminCookie = "";
  let publicId = "";
  let projectId = 0;
  const prevKey = process.env.ANCHOR_API_KEY;
  const prevBase = process.env.ANCHOR_API_BASE;
  const prevCron = process.env.CRON_SECRET;

  beforeAll(async () => {
    process.env.VITEST = "true";
    process.env.ANCHOR_API_KEY = "test-anchor-key";
    process.env.ANCHOR_API_BASE = "https://anchor.test";
    process.env.CRON_SECRET = "test-cron-secret";

    const adminId = await insertId(
      `INSERT INTO admins (email, first_name, last_name, role, status) VALUES (?, 'A', 'N', 'super_admin', 'active')`,
      [em("admin")],
    );
    const token = crypto.randomBytes(32).toString("hex");
    await db.execute(
      `INSERT INTO admin_sessions (admin_id, token_hash, expires_at) VALUES (?, ?, ?)`,
      [
        adminId,
        crypto.createHash("sha256").update(token).digest("hex"),
        new Date(Date.now() + 86400000),
      ],
    );
    adminCookie = `gw_admin_sid=${token}`;

    const clientId = await insertId(
      `INSERT INTO clients (email, first_name, last_name, status) VALUES (?, 'C', 'L', 'active')`,
      [em("client")],
    );
    publicId = `GW-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
    projectId = await insertId(
      `INSERT INTO projects (public_id, client_id, milestone, loan_lender_type, loan_status, anchor_external_id)
       VALUES (?, ?, 'financing', 'anchor', 'in_process', 'LN-ANCHOR-1')`,
      [publicId, clientId],
    );
  });

  afterAll(async () => {
    __test.__testSetAnchorHttp?.(null);
    process.env.ANCHOR_API_KEY = prevKey;
    process.env.ANCHOR_API_BASE = prevBase;
    process.env.CRON_SECRET = prevCron;
    try {
      await cleanupPortalFixturesByPrefix(db, prefix);
    } finally {
      await db.end();
    }
  });

  it("rejects sync when Anchor env is missing", async () => {
    const key = process.env.ANCHOR_API_KEY;
    delete process.env.ANCHOR_API_KEY;
    const res = await request(app)
      .post(`/api/admin/projects/${publicId}/anchor/sync`)
      .set("Cookie", adminCookie);
    expect(res.status).toBe(503);
    expect(res.body.error).toBe("errors.anchorNotConfigured");
    process.env.ANCHOR_API_KEY = key;
  });

  it("syncs loan status from Anchor and updates last_synced_at", async () => {
    __test.__testSetAnchorHttp(async () =>
      new Response(JSON.stringify({ status: "underwriting" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const res = await request(app)
      .post(`/api/admin/projects/${publicId}/anchor/sync`)
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.sync.loan_status).toBe("underwriting");
    expect(res.body.sync.changed).toBe(true);
    expect(res.body.project.loan_status).toBe("underwriting");
    expect(res.body.project.anchor_last_synced_at).toBeTruthy();

    const [rows] = await db.query(
      `SELECT loan_status, anchor_last_synced_at FROM projects WHERE id = ?`,
      [projectId],
    );
    const row = (rows as { loan_status: string; anchor_last_synced_at: string }[])[0];
    expect(row.loan_status).toBe("underwriting");
    expect(row.anchor_last_synced_at).toBeTruthy();
  });

  it("cron sync requires bearer secret and processes Anchor projects", async () => {
    __test.__testSetAnchorHttp(async () =>
      new Response(JSON.stringify({ loan_status: "approved" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    expect((await request(app).post("/api/cron/anchor-sync")).status).toBe(401);
    const res = await request(app)
      .post("/api/cron/anchor-sync")
      .set("Authorization", "Bearer test-cron-secret");
    expect(res.status).toBe(200);
    expect(res.body.synced).toBeGreaterThanOrEqual(1);
    expect(
      res.body.results.some(
        (r: { public_id: string; ok: boolean; loan_status?: string }) =>
          r.public_id === publicId && r.ok && r.loan_status === "approved",
      ),
    ).toBe(true);
  });
});
