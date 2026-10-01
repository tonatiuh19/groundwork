import { describe, expect, it } from "vitest";
import { checkApiIndexInline } from "../scripts/check-api-inline";

describe("api inline gate", () => {
  it("keeps api/index.ts free of relative runtime imports", () => {
    const result = checkApiIndexInline();
    expect(result.ok, result.report).toBe(true);
  });
});
