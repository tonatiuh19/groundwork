import { describe, expect, it } from "vitest";
import { isDemotingAccountStatus } from "./accountStatus";

describe("isDemotingAccountStatus", () => {
  it("flags active → inactive/suspended", () => {
    expect(isDemotingAccountStatus("active", "inactive")).toBe(true);
    expect(isDemotingAccountStatus("active", "suspended")).toBe(true);
  });

  it("allows other transitions without confirm", () => {
    expect(isDemotingAccountStatus("active", "active")).toBe(false);
    expect(isDemotingAccountStatus("pending", "active")).toBe(false);
    expect(isDemotingAccountStatus("inactive", "active")).toBe(false);
    expect(isDemotingAccountStatus("suspended", "inactive")).toBe(false);
    // Client prospect / pending demotions are not the shared "active demote" gate
    expect(isDemotingAccountStatus("prospect", "inactive")).toBe(false);
    expect(isDemotingAccountStatus("pending", "inactive")).toBe(false);
    expect(isDemotingAccountStatus("pending", "suspended")).toBe(false);
    expect(isDemotingAccountStatus("invited", "inactive")).toBe(false);
    expect(isDemotingAccountStatus("", "inactive")).toBe(false);
  });
});

