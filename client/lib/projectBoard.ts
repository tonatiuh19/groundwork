import type { ProjectMilestone } from "@shared/api";
import {
  BOARD_MILESTONES,
  MILESTONE_TRANSITIONS,
  canTransitionMilestone,
  getMilestoneMoveDirection,
} from "@shared/api";

export {
  BOARD_MILESTONES,
  MILESTONE_TRANSITIONS,
  canTransitionMilestone,
  getMilestoneMoveDirection,
};

export type BoardFilters = {
  q: string;
  affiliate_id: string;
  contractor_id: string;
  assigned_admin_id: string;
  loan_status: string;
};

export const EMPTY_BOARD_FILTERS: BoardFilters = {
  q: "",
  affiliate_id: "",
  contractor_id: "",
  assigned_admin_id: "",
  loan_status: "",
};

export function countActiveBoardFilters(f: BoardFilters): number {
  return (
    [
      Boolean(f.q.trim()),
      Boolean(f.affiliate_id),
      Boolean(f.contractor_id),
      Boolean(f.assigned_admin_id),
      Boolean(f.loan_status),
    ] as boolean[]
  ).filter(Boolean).length;
}

export function boardQueryParams(f: BoardFilters, limit = 20) {
  const params: Record<string, string | number> = { limit };
  const q = f.q.trim();
  if (q) params.q = q;
  if (f.affiliate_id) params.affiliate_id = Number(f.affiliate_id);
  if (f.contractor_id) params.contractor_id = Number(f.contractor_id);
  if (f.assigned_admin_id) params.assigned_admin_id = Number(f.assigned_admin_id);
  if (f.loan_status) params.loan_status = f.loan_status;
  return params;
}

/** Whether a drop target column is legal for this card (UI pre-check). */
export function isBoardDropAllowed(
  from: ProjectMilestone,
  to: ProjectMilestone,
  hasContractor: boolean,
): boolean {
  if (!canTransitionMilestone(from, to)) return false;
  if (to === "in_build" && !hasContractor) return false;
  return true;
}

export function emptyBoardColumns() {
  return Object.fromEntries(
    BOARD_MILESTONES.map((m) => [
      m,
      { items: [], total: 0, offset: 0, limit: 20, has_more: false },
    ]),
  ) as Record<
    ProjectMilestone,
    { items: never[]; total: number; offset: number; limit: number; has_more: boolean }
  >;
}
