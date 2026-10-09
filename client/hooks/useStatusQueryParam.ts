import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

/**
 * Sync a status filter with `?status=` so dashboard deep-links and bookmarks work.
 * Unknown values are ignored (treated as “all”).
 */
export function useStatusQueryParam(allowed: readonly string[]) {
  const [searchParams, setSearchParams] = useSearchParams();
  const allowedKey = allowed.join("|");
  const allowedSet = useMemo(() => new Set(allowed), [allowedKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const fromUrl = (() => {
    const raw = searchParams.get("status") || "";
    return allowedSet.has(raw) ? raw : "";
  })();

  const [status, setStatusState] = useState(fromUrl);

  useEffect(() => {
    setStatusState(fromUrl);
  }, [fromUrl]);

  const setStatus = (next: string) => {
    const value = allowedSet.has(next) ? next : "";
    setStatusState(value);
    setSearchParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        if (value) p.set("status", value);
        else p.delete("status");
        return p;
      },
      { replace: true },
    );
  };

  return [status, setStatus] as const;
}
