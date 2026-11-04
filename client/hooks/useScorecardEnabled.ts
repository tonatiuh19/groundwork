import { useAppSelector } from "@/store/hooks";

/** Scorecards are on (SCORECARD_ENABLED) and this admin can see them (super_admin / admin). */
export function useScorecardEnabled(): boolean {
  return useAppSelector((s) => !!s.portalAuth.admin.user?.scorecard_enabled);
}
