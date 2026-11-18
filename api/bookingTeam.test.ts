import { describe, expect, it } from "vitest";
import { pickTeamHolder, swapOwnerAttendees } from "./index";

/** Company booking page rules (pure): who holds a new booking, and how a reassign swaps the owner. */
describe("pickTeamHolder", () => {
  it("prefers the default member when free", () => {
    expect(pickTeamHolder([5, 9], [9, 5], 5)).toBe(5);
  });
  it("falls back to the first free member in member order when the default is busy or unset", () => {
    expect(pickTeamHolder([9, 7], [7, 9, 5], 5)).toBe(7);
    expect(pickTeamHolder([9], [7, 9], null)).toBe(9);
  });
  it("nobody free: null (the slot is taken)", () => {
    expect(pickTeamHolder([], [7, 9], 7)).toBeNull();
  });
});

describe("swapOwnerAttendees", () => {
  const rows = [
    { kind: "admin", admin_id: 1 },
    { kind: "admin", admin_id: 3 },
    { kind: "homeowner", name: "H", email: "h@example.com" },
    { kind: "contractor", contractor_id: 8 },
    { kind: "guest", name: "G", email: "g@example.com", phone: null, preferred_language: "es" },
  ];
  it("replaces the old owner with the new one first, keeps everyone else, never the homeowner row", () => {
    expect(swapOwnerAttendees(rows, 1, 2)).toEqual([
      { kind: "admin", admin_id: 2 },
      { kind: "admin", admin_id: 3 },
      { kind: "contractor", contractor_id: 8 },
      { kind: "guest", name: "G", email: "g@example.com", phone: null, preferred_language: "es" },
    ]);
  });
  it("new owner already tagged: no duplicate", () => {
    expect(swapOwnerAttendees(rows, 1, 3).filter((x) => x.kind === "admin")).toEqual([{ kind: "admin", admin_id: 3 }]);
  });
  it("cleared owner: just drops the old one", () => {
    expect(swapOwnerAttendees(rows, 1, null).filter((x) => x.kind === "admin")).toEqual([{ kind: "admin", admin_id: 3 }]);
  });
});
