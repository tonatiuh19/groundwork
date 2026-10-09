import { describe, expect, it } from "vitest";
import { yupPhoneOptional, yupPhoneRequired } from "./validation";

describe("yupPhoneRequired", () => {
  const schema = yupPhoneRequired("min", "req");

  it("rejects empty", async () => {
    await expect(schema.validate("")).rejects.toThrow("req");
  });

  it("rejects short digit counts even with punctuation", async () => {
    await expect(schema.validate("(949) 555")).rejects.toThrow("min");
  });

  it("accepts 10+ digits with formatting", async () => {
    await expect(schema.validate("(949) 555-1234")).resolves.toBe("(949) 555-1234");
  });
});

describe("yupPhoneOptional", () => {
  const schema = yupPhoneOptional("min");

  it("allows empty", async () => {
    await expect(schema.validate("")).resolves.toBe("");
  });

  it("rejects short when provided", async () => {
    await expect(schema.validate("123")).rejects.toThrow("min");
  });
});
