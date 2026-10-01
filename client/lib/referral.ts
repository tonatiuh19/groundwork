const KEY = "gw_ref";
const TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Persist an affiliate referral code from `?ref=` for 30 days (last touch wins). */
export function captureReferralFromUrl(search: string): void {
  try {
    const code = new URLSearchParams(search).get("ref")?.trim();
    if (!code || !/^[A-Za-z0-9_-]{3,64}$/.test(code)) return;
    window.localStorage.setItem(KEY, JSON.stringify({ code, at: Date.now() }));
  } catch {
    /* storage unavailable */
  }
}

/** Persist attribution when the visitor lands on a branded `/r/:code` page. */
export function persistReferralCode(code: string): void {
  try {
    const trimmed = code.trim();
    if (!trimmed || !/^[A-Za-z0-9_-]{3,64}$/.test(trimmed)) return;
    window.localStorage.setItem(KEY, JSON.stringify({ code: trimmed, at: Date.now() }));
  } catch {
    /* storage unavailable */
  }
}

export function getReferralCode(): string | undefined {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as { code?: string; at?: number };
    if (!parsed.code || !parsed.at || Date.now() - parsed.at > TTL_MS) {
      window.localStorage.removeItem(KEY);
      return undefined;
    }
    return parsed.code;
  } catch {
    return undefined;
  }
}

/**
 * Build the shareable tracking URL for the current browsing origin
 * (localhost in local, production host in prod). Prefer slug when set.
 */
export function buildAffiliateTrackingUrl(opts: {
  referral_code: string;
  slug?: string | null;
  landing?: string;
  origin?: string;
}): string {
  const origin = (
    opts.origin ||
    (typeof window !== "undefined" ? window.location.origin : "")
  ).replace(/\/$/, "");
  const code = String(opts.slug || opts.referral_code).trim();
  const base = `${origin}/r/${code}`;
  if (!opts.landing || opts.landing === "home") return base;
  return `${base}?to=${encodeURIComponent(opts.landing)}`;
}
