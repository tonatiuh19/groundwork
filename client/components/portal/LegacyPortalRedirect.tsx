import { Navigate, useLocation, useParams } from "react-router-dom";

/** Legacy `/portal/*` → `/client/*` (keeps sub-path, query and hash). */
export default function LegacyPortalRedirect() {
  const { "*": rest = "" } = useParams();
  const { search, hash } = useLocation();
  const suffix = rest ? `/${rest}` : "";
  return <Navigate to={`/client${suffix}${search}${hash}`} replace />;
}
