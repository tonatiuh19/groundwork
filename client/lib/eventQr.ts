/** Flyer QR short link for an event: `/e/<slug>` (counted + redirected by the SPA). */
export function eventQrUrl(slug: string, origin = typeof window !== "undefined" ? window.location.origin : ""): string {
  return `${origin}/e/${encodeURIComponent(slug)}`;
}

const KEY = "gw_qr_event_id";

/** Remember that this visitor arrived by scanning a QR for `eventId` (tab-scoped). */
export function rememberQrScan(eventId: number): void {
  try {
    window.sessionStorage.setItem(KEY, String(eventId));
  } catch {
    /* storage blocked — attribution is best-effort */
  }
}

/** True when the RSVP for `eventId` should be attributed to a QR scan. */
export function cameFromQr(eventId: number): boolean {
  try {
    return window.sessionStorage.getItem(KEY) === String(eventId);
  } catch {
    return false;
  }
}
