import { describe, expect, it } from "vitest";
import { withTransientRetry } from "./testDbCleanup";

/** Fake pool: fails with the given codes in order, then succeeds. */
function fakePool(codes: string[]) {
  let calls = 0;
  const fail = async () => {
    const code = codes[calls++];
    if (code) throw Object.assign(new Error(`fake ${code}`), { code });
    return [[{ ok: 1 }], []];
  };
  return { query: fail, execute: fail, getConnection: fail, calls: () => calls } as any;
}

describe("integration test pool: transient connection retry", () => {
  it("retries a connect timeout / dropped connection and then succeeds", async () => {
    const p = withTransientRetry(fakePool(["ETIMEDOUT", "PROTOCOL_CONNECTION_LOST"]), 1);
    await expect(p.query("SELECT 1")).resolves.toEqual([[{ ok: 1 }], []]);
    expect(p.calls()).toBe(3);
  });
  it("gives up after two retries", async () => {
    const p = withTransientRetry(fakePool(["ECONNRESET", "ECONNRESET", "ECONNRESET"]), 1);
    await expect(p.execute("SELECT 1")).rejects.toMatchObject({ code: "ECONNRESET" });
    expect(p.calls()).toBe(3);
  });
  it("never retries a real SQL error (it would hide bugs or repeat a write)", async () => {
    const p = withTransientRetry(fakePool(["ER_DUP_ENTRY"]), 1);
    await expect(p.execute("INSERT")).rejects.toMatchObject({ code: "ER_DUP_ENTRY" });
    expect(p.calls()).toBe(1);
  });
  it("repeats a write only when it never reached the database", async () => {
    const dropped = withTransientRetry(fakePool(["PROTOCOL_CONNECTION_LOST"]), 1);
    await expect(dropped.execute("INSERT INTO x VALUES (1)")).rejects.toMatchObject({ code: "PROTOCOL_CONNECTION_LOST" });
    expect(dropped.calls()).toBe(1);
    const notConnected = withTransientRetry(fakePool(["ETIMEDOUT"]), 1);
    await expect(notConnected.execute("INSERT INTO x VALUES (1)")).resolves.toEqual([[{ ok: 1 }], []]);
    expect(notConnected.calls()).toBe(2);
  });
});
