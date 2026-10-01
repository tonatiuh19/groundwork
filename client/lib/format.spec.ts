import { describe, expect, it } from "vitest";
import {
  centsToDollars,
  dollarsToCents,
  eventDayOfMonth,
  formatCents,
  formatDate,
  formatEventDay,
  formatEventDateTime,
  fromDateTimeLocalValue,
  parseEventDate,
  toDateTimeLocalValue,
} from "./format";

describe("dollarsToCents", () => {
  it.each([
    ["1,250.50", 125050],
    ["$99", 9900],
    [" 0.10 ", 10],
    ["0.005", 1],
    [12.34, 1234],
    ["1 000", 100000],
  ])("%s → %s", (input, cents) => {
    expect(dollarsToCents(input)).toBe(cents);
  });

  it.each([[""], ["   "], [null], [undefined], ["abc"], ["-5"], ["NaN"], ["Infinity"]])(
    "%j → null (never NaN / negative cents)",
    (input) => {
      expect(dollarsToCents(input as any)).toBeNull();
    },
  );

  it("round-trips with centsToDollars", () => {
    for (const c of [0, 1, 99, 100, 123456, 999999999]) {
      expect(dollarsToCents(centsToDollars(c))).toBe(c);
    }
    expect(centsToDollars(null)).toBe("");
  });
});

describe("formatCents / formatDate", () => {
  it("formats money per locale and dashes out nulls", () => {
    expect(formatCents(123456)).toBe("$1,234.56");
    expect(formatCents(0)).toBe("$0.00");
    expect(formatCents(null)).toBe("—");
    expect(formatCents(undefined)).toBe("—");
  });

  it("formats dates in UTC (no off-by-one in US timezones) and rejects junk", () => {
    expect(formatDate("2026-09-30T00:00:00.000Z")).toBe("Sep 30, 2026");
    expect(formatDate("2026-09-30T23:59:59.000Z")).toBe("Sep 30, 2026");
    expect(formatDate(new Date("2026-01-01T00:00:00Z"), "es-US")).toMatch(/2026/);
    expect(formatDate("not a date")).toBe("—");
    expect(formatDate(null)).toBe("—");
    expect(formatDate("")).toBe("—");
  });
});

describe("event datetimes (Pacific time, UTC instants)", () => {
  it("parses ISO, naive and Z strings as UTC instants", () => {
    for (const v of ["2026-10-06 18:00:00", "2026-10-06T18:00:00", "2026-10-06T18:00:00.000Z"]) {
      expect(parseEventDate(v)?.toISOString()).toBe("2026-10-06T18:00:00.000Z");
    }
    expect(parseEventDate("2026-10-06")?.toISOString()).toBe("2026-10-06T00:00:00.000Z");
    expect(parseEventDate("nope")).toBeNull();
    expect(parseEventDate(null)).toBeNull();
  });

  it("formats day, calendar badge and date/time in Pacific", () => {
    expect(formatEventDay("2026-10-06T18:00:00.000Z")).toBe("October 6");
    expect(formatEventDay("2026-10-06T18:00:00.000Z", "es-US")).toMatch(/6 de octubre/);
    // 03:00Z on the 7th is still the evening of the 6th in California.
    expect(eventDayOfMonth("2026-10-07T03:00:00.000Z")).toBe("06");
    expect(eventDayOfMonth(null)).toBe("");
    expect(formatEventDateTime("2026-10-06T18:00:00.000Z")).toMatch(/Oct 6, 2026.*11:00\s?AM PDT/);
    expect(formatEventDay(undefined)).toBe("—");
  });

  it("round-trips datetime-local inputs through Pacific, DST-aware", () => {
    expect(toDateTimeLocalValue("2026-10-06T18:00:00.000Z")).toBe("2026-10-06T11:00");
    expect(fromDateTimeLocalValue("2026-10-06T11:00")).toBe("2026-10-06T18:00:00.000Z");
    // Winter (PST, UTC-8)
    expect(fromDateTimeLocalValue("2026-12-06T11:00")).toBe("2026-12-06T19:00:00.000Z");
    expect(toDateTimeLocalValue("2026-12-06T19:00:00.000Z")).toBe("2026-12-06T11:00");
    expect(fromDateTimeLocalValue("")).toBeNull();
    expect(fromDateTimeLocalValue("junk")).toBeNull();
    expect(toDateTimeLocalValue(null)).toBe("");
  });
});
