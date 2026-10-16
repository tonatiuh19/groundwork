/** Admin event lifecycle + RSVP option lists shared by the Events/Leads screens. */
export const EVENT_STATUSES = ["draft", "published", "archived"] as const;
export const REGISTRATION_STATUSES = ["confirmed", "waitlisted"] as const;
export const LEAD_MODES = ["event", "standard"] as const;

const pacificDay = (d: Date) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);

/** Mirrors the API rule: past once the Pacific day of (ends_at || starts_at) is over. */
export function isEventPast(ev: { starts_at: string; ends_at: string | null }, now = new Date()): boolean {
  const last = new Date(ev.ends_at || ev.starts_at);
  if (Number.isNaN(last.getTime())) return false;
  return pacificDay(last) < pacificDay(now);
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** URL-safe slug: accents stripped, lowercase, dashed, ≤ 80 chars (mirrors the API). */
export function slugifyEvent(raw: string): string {
  return String(raw || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/, "");
}

/**
 * Suggested event slug: `<city>-<mon>-<year>` from a datetime-local value
 * (e.g. "fontana-oct-2026"); falls back to the English title when city/date are missing.
 */
export function suggestEventSlug(v: { city?: string; starts_at?: string; title_en?: string }): string {
  const m = /^(\d{4})-(\d{2})/.exec(v.starts_at || "");
  const city = slugifyEvent(v.city || "");
  // Form validation caps slugs at 64 chars — trim the city/title part, keep the date.
  const date = m ? `-${MONTHS[Number(m[2]) - 1] || ""}-${m[1]}` : "";
  const head = slugifyEvent(city || v.title_en || "").slice(0, 64 - date.length).replace(/-+$/, "");
  return head ? `${head}${date}` : "";
}
