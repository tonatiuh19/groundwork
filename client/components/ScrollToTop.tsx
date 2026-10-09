import { useEffect } from "react";
import { useLocation } from "react-router-dom";

/**
 * Reset window scroll on route changes. Hash targets (e.g. #free-report)
 * are left to page-level scroll handlers after content loads.
 */
export default function ScrollToTop() {
  const { pathname, hash } = useLocation();

  useEffect(() => {
    if (hash) return;
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [pathname, hash]);

  return null;
}
