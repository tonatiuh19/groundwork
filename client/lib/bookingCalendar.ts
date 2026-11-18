import { zonedToUtc } from "@/lib/apptTime";

/** "Add to calendar" for a just-booked time: Google Calendar link + an .ics data URL (Apple / Outlook). */
export function bookingCalendarLinks(opts: { title: string; date: string; time: string; minutes: number; timezone: string; details: string }) {
  const start = zonedToUtc(opts.date, opts.time, opts.timezone);
  const end = new Date(start.getTime() + opts.minutes * 60_000);
  const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const google = `https://calendar.google.com/calendar/render?${new URLSearchParams({
    action: "TEMPLATE",
    text: opts.title,
    dates: `${stamp(start)}/${stamp(end)}`,
    details: opts.details,
  }).toString()}`;
  const esc = (s: string) => s.replace(/[\\,;]/g, (m) => `\\${m}`).replace(/\n/g, "\\n");
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Groundwork Capital//Booking//EN",
    "BEGIN:VEVENT",
    `UID:${stamp(start)}-${Math.random().toString(36).slice(2)}@groundworkcapitalgroup.com`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(start)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:${esc(opts.title)}`,
    `DESCRIPTION:${esc(opts.details)}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  return { google, ics: `data:text/calendar;charset=utf-8,${encodeURIComponent(ics)}`, start, end };
}
