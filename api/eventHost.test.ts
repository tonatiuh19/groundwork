import { describe, expect, it } from "vitest";
import { eventRsvpCreditAffiliate, tplAffiliateEventRsvp } from "./index";

describe("event RSVP credit (host affiliate)", () => {
  const host = { id: 1, status: "active" };
  const link = { id: 2, status: "active" };
  it("another affiliate's link wins; else the active host; else nobody", () => {
    expect(eventRsvpCreditAffiliate(link, host)).toBe(link);
    expect(eventRsvpCreditAffiliate(null, host)).toBe(host);
    expect(eventRsvpCreditAffiliate(null, { id: 1, status: "inactive" })).toBeNull();
    expect(eventRsvpCreditAffiliate({ id: 2, status: "inactive" }, host)).toBe(host);
    expect(eventRsvpCreditAffiliate(null, null)).toBeNull();
  });

  it("host email names the guest and event in their language, with no long dashes", () => {
    for (const lang of ["en", "es"] as const) {
      const m = tplAffiliateEventRsvp({ lang, first_name: "Brenda", guest_name: "Ana Ruiz", event_title: "ADU night", starts_at: "2026-11-19T18:00:00Z", waitlisted: false, confirmed_count: 4 });
      expect(m.subject).toContain("Ana Ruiz");
      expect(m.subject).toContain("ADU night");
      expect(m.subject + m.html).not.toContain(" — ");
      expect(m.html).toContain("/affiliate/events");
    }
    expect(tplAffiliateEventRsvp({ lang: "es", first_name: "B", guest_name: "G", event_title: "E", starts_at: null, waitlisted: true, confirmed_count: 0 }).html).toContain("Lista de espera");
  });
});
