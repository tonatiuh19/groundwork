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

import { isEventImageUrl, tplLeadConfirmation } from "./index";

describe("event image link + confirmation city", () => {
  it("only a direct https picture link is an event image (a website is not)", () => {
    expect(isEventImageUrl("https://cdn.example.com/logo.png")).toBe(true);
    expect(isEventImageUrl("https://cdn.example.com/a/photo.JPG?w=800")).toBe(true);
    expect(isEventImageUrl("https://ezfundings.com/")).toBe(false);
    expect(isEventImageUrl("http://cdn.example.com/logo.png")).toBe(false);
    expect(isEventImageUrl("not a url")).toBe(false);
  });

  it("the RSVP email never invents a city: no city means no 'in <city>'", () => {
    const base = { fullName: "Ana Ruiz", mode: "event" as const, eventTitle: "ADU Event", eventStartsAt: null, lang: "en" };
    const full = tplLeadConfirmation({ ...base, eventCity: null, eventLocation: null, registrationStatus: "waitlisted" });
    expect(full.html).not.toContain("Fontana");
    expect(full.html).toContain("event is full");
    const ok = tplLeadConfirmation({ ...base, eventCity: "Rancho Cucamonga", eventLocation: "EZ Fundings, Inc", registrationStatus: "confirmed" });
    expect(ok.html).toContain("EZ Fundings, Inc");
  });
});
