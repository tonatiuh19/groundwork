/**
 * Secure welcome-link token (affiliate onboarding without a login). Kept in
 * sessionStorage for this tab only and sent as `x-onboarding-token` on
 * `/affiliate/*` API calls. Storage can be unavailable (private mode) — then
 * it lives in memory for the page's lifetime.
 */
const KEY = "gw.affOnboardingToken";
let memory: string | null = null;

export function setOnboardingToken(token: string | null): void {
  memory = token;
  try {
    if (token) sessionStorage.setItem(KEY, token);
    else sessionStorage.removeItem(KEY);
  } catch {
    /* storage unavailable — memory only */
  }
}

export function getOnboardingToken(): string | null {
  if (memory) return memory;
  try {
    memory = sessionStorage.getItem(KEY);
  } catch {
    memory = null;
  }
  return memory;
}

/** Append the token to a GET link (signed-PDF downloads can't send headers). */
export function withOnboardingToken(url: string): string {
  const t = getOnboardingToken();
  return t ? `${url}${url.includes("?") ? "&" : "?"}ot=${encodeURIComponent(t)}` : url;
}
