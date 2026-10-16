/** Appointment time helpers — everything is shown in the appointment's own timezone. */

export const DEFAULT_TZ = "America/Los_Angeles";

/** UTC ISO → { date: YYYY-MM-DD, time: HH:mm } in a timezone (for edit forms). */
export function isoToZoned(iso: string, tz: string): { date: string; time: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    })
      .formatToParts(new Date(iso))
      .map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

export function minutesBetween(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000);
}

/** "Mon, Oct 20 · 10:00–11:00 AM PDT" */
export function formatApptRange(startIso: string, endIso: string, tz: string, lang: "en" | "es"): string {
  const loc = lang === "es" ? "es-US" : "en-US";
  const day = new Intl.DateTimeFormat(loc, { timeZone: tz, weekday: "short", month: "short", day: "numeric" }).format(new Date(startIso));
  const t = (iso: string) => new Intl.DateTimeFormat(loc, { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
  const zone =
    new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short" }).formatToParts(new Date(startIso)).find((p) => p.type === "timeZoneName")?.value || "";
  return `${day} · ${t(startIso)}–${t(endIso)} ${zone}`.trim();
}

export function formatApptTime(iso: string, tz: string, lang: "en" | "es"): string {
  return new Intl.DateTimeFormat(lang === "es" ? "es-US" : "en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

/** Local YYYY-MM-DD for "today" in a timezone. */
export function todayIn(tz: string): string {
  return isoToZoned(new Date().toISOString(), tz).date;
}

/** Shift a YYYY-MM-DD by days (calendar math, timezone-free). */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 6-week month grid (Sunday first) for a YYYY-MM month. */
export function monthGrid(month: string): string[] {
  const first = new Date(`${month}-01T12:00:00Z`);
  const start = addDays(`${month}-01`, -first.getUTCDay());
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

/** 12-hour label for an HH:mm slot. */
export function slotLabel(time: string, lang: "en" | "es"): string {
  const [h, m] = time.split(":").map(Number);
  return new Intl.DateTimeFormat(lang === "es" ? "es-US" : "en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" }).format(
    new Date(Date.UTC(2000, 0, 1, h, m)),
  );
}
