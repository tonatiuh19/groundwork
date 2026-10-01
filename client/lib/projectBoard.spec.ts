import { describe, expect, it } from "vitest";
import {
  BOARD_MILESTONES,
  canTransitionMilestone,
  getMilestoneMoveDirection,
} from "@shared/api";
import {
  boardQueryParams,
  countActiveBoardFilters,
  EMPTY_BOARD_FILTERS,
  isBoardDropAllowed,
} from "@/lib/projectBoard";

describe("projectBoard helpers", () => {
  it("builds query params only for active filters", () => {
    expect(boardQueryParams(EMPTY_BOARD_FILTERS, 20)).toEqual({ limit: 20 });
    expect(
      boardQueryParams(
        {
          q: "  villa ",
          affiliate_id: "3",
          contractor_id: "",
          assigned_admin_id: "9",
          loan_status: "finalized",
        },
        15,
      ),
    ).toEqual({
      limit: 15,
      q: "villa",
      affiliate_id: 3,
      assigned_admin_id: 9,
      loan_status: "finalized",
    });
  });

  it("counts active filters", () => {
    expect(countActiveBoardFilters(EMPTY_BOARD_FILTERS)).toBe(0);
    expect(
      countActiveBoardFilters({
        ...EMPTY_BOARD_FILTERS,
        q: "x",
        loan_status: "approved",
      }),
    ).toBe(2);
  });

  it("blocks illegal drops and in_build without contractor", () => {
    expect(isBoardDropAllowed("lead", "financing", false)).toBe(true);
    expect(isBoardDropAllowed("lead", "closed", false)).toBe(false);
    expect(isBoardDropAllowed("contracted", "in_build", false)).toBe(false);
    expect(isBoardDropAllowed("contracted", "in_build", true)).toBe(true);
    expect(canTransitionMilestone("closed", "lead")).toBe(false);
  });

  it("classifies move directions for confirm copy", () => {
    expect(getMilestoneMoveDirection("lead", "financing")).toBe("forward");
    expect(getMilestoneMoveDirection("financing", "lead")).toBe("back");
    expect(getMilestoneMoveDirection("lead", "contracted")).toBe("jump-forward");
    expect(getMilestoneMoveDirection("in_build", "financing")).toBe("jump-back");
    expect(getMilestoneMoveDirection("lead", "cancelled")).toBe("cancel");
    expect(getMilestoneMoveDirection("cancelled", "lead")).toBe("restore");
    expect(BOARD_MILESTONES).toHaveLength(6);
  });
});
