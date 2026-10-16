import { useTranslation } from "react-i18next";

export function formatCents(
  cents: number | null | undefined,
  locale = "en-US",
): string {
  if (cents == null) return "—";
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(Number(cents) / 100);
}

export function formatDate(
  value: string | Date | null | undefined,
  locale = "en-US",
): string {
  if (!value) return "—";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(d);
}

/** Dollars typed by a user ("1,250.50") → integer cents; empty → null. */
export function dollarsToCents(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined || String(input).trim() === "") return null;
  const n = Number(String(input).replace(/[$,\s]/g, ""));
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

export function centsToDollars(cents: number | null | undefined): string {
  return cents == null ? "" : (Number(cents) / 100).toFixed(2);
}

/** API datetime → `YYYY-MM-DD` for `<input type="date">`; empty when unset/invalid. */
export function toDateInputValue(value: string | null | undefined): string {
  if (!value) return "";
  const iso = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  if (iso) return iso[1];
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

// ── Event datetimes ──────────────────────────────────────────────────────────
// `marketing_events` datetimes are UTC instants (ISO `Z` from the API). Groundwork
// events are in California, so everything is shown and edited in Pacific time —
// the same zone the RSVP confirmation email uses.

export const EVENT_TIME_ZONE = "America/Los_Angeles";

/** Parse an API datetime (ISO with `Z`, or naive `YYYY-MM-DD HH:mm:ss` treated as UTC). */
export function parseEventDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const raw = String(value).trim().replace(" ", "T");
  const withTime = raw.includes("T") ? raw : `${raw}T00:00:00`;
  const hasZone = /(Z|[+-]\d{2}:?\d{2})$/i.test(withTime);
  const d = new Date(hasZone ? withTime : `${withTime}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

type WallParts = { y: number; mo: number; d: number; h: number; mi: number };

/** Wall-clock parts of an instant in the event time zone. */
function eventWallParts(d: Date): WallParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: EVENT_TIME_ZONE,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(d);
  const n = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { y: n("year"), mo: n("month"), d: n("day"), h: n("hour"), mi: n("minute") };
}

const wallAsUtcMs = (w: WallParts) => Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi);

/** "October 6" / "6 de octubre" — used in the ribbon and meta blocks. */
export function formatEventDay(
  value: string | Date | null | undefined,
  locale = "en-US",
): string {
  const d = parseEventDate(value);
  if (!d) return "—";
  return new Intl.DateTimeFormat(locale, {
    month: "long",
    day: "numeric",
    timeZone: EVENT_TIME_ZONE,
  }).format(d);
}

/** "Tue, Oct 6, 2026, 6:00 PM PDT" — full event date + time. */
export function formatEventDateTime(
  value: string | Date | null | undefined,
  locale = "en-US",
): string {
  const d = parseEventDate(value);
  if (!d) return "—";
  return new Intl.DateTimeFormat(locale, {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
    timeZone: EVENT_TIME_ZONE,
  }).format(d);
}

/** Two-digit day-of-month (Pacific) for the calendar badge. */
export function eventDayOfMonth(value: string | Date | null | undefined): string {
  const d = parseEventDate(value);
  return d ? String(eventWallParts(d).d).padStart(2, "0") : "";
}

/** API instant → Pacific `YYYY-MM-DDTHH:mm` for `<input type="datetime-local">`. */
export function toDateTimeLocalValue(value: string | null | undefined): string {
  const d = parseEventDate(value);
  if (!d) return "";
  const w = eventWallParts(d);
  const p = (n: number, len = 2) => String(n).padStart(len, "0");
  return `${p(w.y, 4)}-${p(w.mo)}-${p(w.d)}T${p(w.h)}:${p(w.mi)}`;
}

/** Pacific `datetime-local` value → UTC ISO instant for the API; empty/invalid → null. */
export function fromDateTimeLocalValue(value: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec((value || "").trim());
  if (!m) return null;
  const wall: WallParts = { y: +m[1], mo: +m[2], d: +m[3], h: +m[4], mi: +m[5] };
  const target = wallAsUtcMs(wall);
  // Two passes settle the UTC offset even when the wall time is near a DST change.
  let utc = target;
  for (let i = 0; i < 2; i++) {
    utc = target - (wallAsUtcMs(eventWallParts(new Date(utc))) - utc);
  }
  const out = new Date(utc);
  return Number.isNaN(out.getTime()) ? null : out.toISOString();
}

/** "5 min ago" / "hace 3 días" — falls back to a date after ~30 days. */
export function formatRelative(v: string | Date | null | undefined, locale = "en-US", now = Date.now()): string {
  if (!v) return "—";
  const d = v instanceof Date ? v : new Date(v);
  const ms = d.getTime();
  if (Number.isNaN(ms)) return "—";
  const sec = Math.round((ms - now) / 1000);
  const abs = Math.abs(sec);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (abs < 60) return rtf.format(sec, "second");
  if (abs < 3600) return rtf.format(Math.round(sec / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(sec / 3600), "hour");
  if (abs < 30 * 86400) return rtf.format(Math.round(sec / 86400), "day");
  return formatDate(d, locale);
}

export function useFormatters() {
  const { i18n } = useTranslation();
  const locale = i18n.language?.startsWith("es") ? "es-US" : "en-US";
  return {
    money: (c: number | null | undefined) => formatCents(c, locale),
    date: (v: string | Date | null | undefined) => formatDate(v, locale),
    eventDay: (v: string | Date | null | undefined) => formatEventDay(v, locale),
    eventDateTime: (v: string | Date | null | undefined) => formatEventDateTime(v, locale),
    relative: (v: string | Date | null | undefined) => formatRelative(v, locale),
  };
}
