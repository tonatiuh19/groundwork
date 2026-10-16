import { useEffect, useState } from "react";

/** Live CSS media query match (e.g. "(max-width: 640px)") — for layouts that change structure on phones. */
export function useMediaQuery(query: string): boolean {
  const get = () => (typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(query).matches : false);
  const [matches, setMatches] = useState(get);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(query);
    const on = () => setMatches(mql.matches);
    on();
    mql.addEventListener("change", on);
    return () => mql.removeEventListener("change", on);
  }, [query]);
  return matches;
}

/** Phones (same breakpoint the portal shell uses for the bottom tab bar is 900px; content layouts switch at 640px). */
export const PHONE_QUERY = "(max-width: 640px)";
