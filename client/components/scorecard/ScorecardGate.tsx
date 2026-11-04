import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAppSelector } from "@/store/hooks";
import { useScorecardEnabled } from "@/hooks/useScorecardEnabled";

/** Scorecard routes only exist when SCORECARD_ENABLED is on and the admin may see them. */
export default function ScorecardGate({ children }: { children: ReactNode }) {
  const enabled = useScorecardEnabled();
  const user = useAppSelector((s) => s.portalAuth.admin.user);
  // Wait for the session (the shell handles sign-in) before deciding.
  if (!user) return null;
  return enabled ? <>{children}</> : <Navigate to="/admin" replace />;
}
