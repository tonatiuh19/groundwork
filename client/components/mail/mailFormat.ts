/** Date helpers for the Mail section (list times, relative sync times, file sizes). */

const loc = (lang: string) => (lang.startsWith("es") ? "es-US" : "en-US");

/** List time: today → 3:05 PM, this year → Oct 12, older → 10/12/25. */
export function formatMailTime(iso: string | null, lang: string, now = new Date()): string {
  if (!iso) return "";
  const d = new Date(iso);
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return new Intl.DateTimeFormat(loc(lang), { hour: "numeric", minute: "2-digit" }).format(d);
  if (d.getFullYear() === now.getFullYear()) return new Intl.DateTimeFormat(loc(lang), { month: "short", day: "numeric" }).format(d);
  return new Intl.DateTimeFormat(loc(lang), { year: "2-digit", month: "numeric", day: "numeric" }).format(d);
}

/** Reader header: Tue, Oct 14, 3:05 PM. */
export function formatMailFull(iso: string | null, lang: string): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat(loc(lang), { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

/** "5 min ago" style for sync status. */
export function formatRelative(iso: string, lang: string, now = Date.now()): string {
  const diff = Math.round((new Date(iso).getTime() - now) / 1000);
  const rtf = new Intl.RelativeTimeFormat(loc(lang), { numeric: "auto" });
  const abs = Math.abs(diff);
  if (abs < 60) return rtf.format(diff, "second");
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
  return rtf.format(Math.round(diff / 86400), "day");
}

export function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}

/** Initials for an avatar from a name or email. */
export function initialsOf(name: string | null | undefined, email?: string | null): string {
  const src = String(name || email || "?").trim();
  const parts = src.replace(/@.*/, "").split(/[\s._-]+/).filter(Boolean);
  return ((parts[0]?.[0] || "?") + (parts[1]?.[0] || "")).toUpperCase();
}
