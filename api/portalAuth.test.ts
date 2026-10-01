import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createServer, __testClearEmailDryRuns, __testGetEmailDryRuns } from "./index";
import { cleanupTestLeadsByEmail } from "./testDbCleanup";

const app = createServer();
const email = `portal-admin-${Date.now()}@example.com`;

describe("portal admin auth", () => {
  beforeAll(() => {
    process.env.VITEST = "true";
    __testClearEmailDryRuns();
  });

  afterAll(async () => {
    // no lead cleanup needed; admin may not exist — ignore
    __testClearEmailDryRuns();
  });

  it("anti-enumerates unknown emails on otp request", async () => {
    const res = await request(app)
      .post("/api/admin/auth/otp/request")
      .send({ email });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("rejects invalid verify payload", async () => {
    const res = await request(app)
      .post("/api/admin/auth/otp/verify")
      .send({ email, code: "12" });
    expect(res.status).toBe(400);
  });

  it("me is unauthorized without cookie", async () => {
    const res = await request(app).get("/api/admin/auth/me");
    expect(res.status).toBe(401);
  });
});
