import { describe, expect, it } from "vitest";
import {
  SCORECARD_METRICS,
  pacificDayStartUtc,
  scAddDays,
  scWeekStart,
  scWorkingMs,
  scoreScMetric,
  scorecardColor,
  scorecardEnabled,
  scorecardGrade,
  scorecardTotal,
  scorecardWeeks,
} from "./index";

const HOUR = 3_600_000;

describe("scorecard math", () => {
  it("weights add up to 100 on every scorecard", () => {
    for (const defs of Object.values(SCORECARD_METRICS)) expect(defs.reduce((n, m) => n + m.weight, 0)).toBe(100);
  });

  it("grades A 90+, B 80-89, C 70-79, D 60-69, F below 60", () => {
    expect([100, 90, 89.9, 80, 79.9, 70, 69.9, 60, 59.9, 0].map(scorecardGrade)).toEqual(["A", "A", "B", "B", "C", "C", "D", "D", "F", "F"]);
    expect(scorecardGrade(null)).toBeNull();
  });

  it("scores a % metric against its goal and caps at 100", () => {
    const contact = SCORECARD_METRICS.lead_rep[1]; // goal 80%
    expect(scoreScMetric(contact, 8, 10).score).toBe(100);
    expect(scoreScMetric(contact, 10, 10).score).toBe(100);
    expect(scoreScMetric(contact, 4, 10).score).toBe(50);
    // Nothing due -> not graded.
    expect(scoreScMetric(contact, 0, 0).score).toBeNull();
  });

  it("scores count goals, shrinking the goal for days off", () => {
    const q = SCORECARD_METRICS.affiliate[0]; // 4 a month
    expect(scoreScMetric(q, 2, 2).score).toBe(50);
    expect(scoreScMetric(q, 2, 2, [], 2).score).toBe(100);
    expect(scoreScMetric(q, 0, 0, [], 0).score).toBeNull();
  });

  it("re-weights the total across graded metrics only", () => {
    const [a, b] = SCORECARD_METRICS.lead_rep; // 25 and 20
    expect(scorecardTotal([scoreScMetric(a, 1, 1), scoreScMetric(b, 0, 0)])).toBe(100);
    expect(scorecardTotal([scoreScMetric(a, 0, 1), scoreScMetric(b, 4, 5)])).toBeCloseTo((0 * 25 + 100 * 20) / 45, 1);
    expect(scorecardTotal([scoreScMetric(a, 0, 0)])).toBeNull();
  });

  it("follows the color ladder and two-week escalations", () => {
    expect(scorecardColor("A", null).color).toBe("green");
    expect(scorecardColor("B", null).color).toBe("green");
    expect(scorecardColor("C", null).color).toBe("yellow");
    expect(scorecardColor("C", { grade: "C", color: "yellow" }).color).toBe("orange");
    expect(scorecardColor("D", null).color).toBe("orange");
    expect(scorecardColor("D", { grade: "D", color: "orange" }).color).toBe("red");
    expect(scorecardColor("C", { grade: "C", color: "orange" }).color).toBe("red");
    expect(scorecardColor("F", null)).toEqual({ color: "red", termination_review: false });
    expect(scorecardColor("F", { grade: "F", color: "red" })).toEqual({ color: "red", termination_review: true });
    // An ungraded week breaks the streak.
    expect(scorecardColor("C", { grade: null, color: "none" }).color).toBe("yellow");
    expect(scorecardColor(null, { grade: "F", color: "red" }).color).toBe("none");
  });

  it("weeks start Monday, Pacific time, across DST", () => {
    // Sunday 11pm Pacific is still the previous week.
    expect(scWeekStart(new Date("2026-11-02T07:30:00Z"))).toBe("2026-10-26");
    expect(scWeekStart(new Date("2026-11-02T08:30:00Z"))).toBe("2026-11-02");
    expect(pacificDayStartUtc("2026-07-06").toISOString()).toBe("2026-07-06T07:00:00.000Z");
    expect(pacificDayStartUtc("2026-12-07").toISOString()).toBe("2026-12-07T08:00:00.000Z");
    expect(scAddDays("2026-12-28", 7)).toBe("2027-01-04");
    const weeks = scorecardWeeks(new Date("2026-10-28T18:00:00Z"));
    expect(weeks).toHaveLength(9);
    expect(weeks[8]).toBe("2026-10-26");
    expect(weeks[0]).toBe("2026-08-31");
  });

  it("clocks run 8am-7pm Pacific, Mon-Sat, and skip days off", () => {
    const a = new Date("2026-10-27T23:00:00Z"); // Tue 4pm Pacific
    const b = new Date(a.getTime() + 48 * HOUR); // Thu 4pm Pacific
    // Tue 4-7pm (3h) + Wed 8am-7pm (11h) + Thu 8am-4pm (8h).
    expect(scWorkingMs(a, b, new Set())).toBe(22 * HOUR);
    expect(scWorkingMs(a, b, new Set(["2026-10-28"]))).toBe(11 * HOUR);
    expect(scWorkingMs(b, a, new Set())).toBe(0);
    // A 9pm lead called at 8:10am next day = 10 business minutes (not a miss).
    expect(scWorkingMs(new Date("2026-10-28T04:00:00Z"), new Date("2026-10-28T15:10:00Z"), new Set())).toBe(10 * 60_000);
    // Saturday counts, Sunday doesn't: Sat 6pm -> Mon 8:30am = 1h + 30m.
    expect(scWorkingMs(new Date("2026-11-01T01:00:00Z"), new Date("2026-11-02T16:30:00Z"), new Set())).toBe(90 * 60_000);
  });

  it("is off unless SCORECARD_ENABLED is set", () => {
    const prev = process.env.SCORECARD_ENABLED;
    try {
      delete process.env.SCORECARD_ENABLED;
      expect(scorecardEnabled()).toBe(false);
      process.env.SCORECARD_ENABLED = "false";
      expect(scorecardEnabled()).toBe(false);
      process.env.SCORECARD_ENABLED = "true";
      expect(scorecardEnabled()).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.SCORECARD_ENABLED;
      else process.env.SCORECARD_ENABLED = prev;
    }
  });
});
