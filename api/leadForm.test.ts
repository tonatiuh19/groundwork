import { describe, expect, it } from "vitest";
import {
  tplLeadConfirmation,
  tplStaffLeadAlert,
  __test,
} from "./index";

describe("lead email templates", () => {
  it("builds a branded confirmation with Groundwork chrome", () => {
    const tpl = tplLeadConfirmation({
      fullName: "Alex Rivera",
      mode: "standard",
    });
    expect(tpl.subject).toMatch(/Groundwork Capital/i);
    expect(tpl.html).toContain("Alex");
    expect(tpl.html).toContain("You're on the list");
    expect(tpl.html).toContain(
      "https://www.groundworkcapitalgroup.com/logos/groundwork-logo.png",
    );
    expect(tpl.html).toContain("#d9a441");
  });

  it("builds Spanish confirmation when lang=es", () => {
    const tpl = tplLeadConfirmation({
      fullName: "Alex Rivera",
      mode: "standard",
      lang: "es",
    });
    expect(tpl.subject).toMatch(/Recibimos tu solicitud/i);
    expect(tpl.html).toContain("Estás en la lista");
    expect(tpl.html).toContain("Hola Alex");
  });

  it("builds event confirmation copy", () => {
    const tpl = tplLeadConfirmation({
      fullName: "Jordan Lee",
      mode: "event",
      eventCity: "Fontana",
    });
    expect(tpl.subject).toMatch(/Fontana/i);
    expect(tpl.html).toContain("Your spot is saved");
  });

  it("builds staff alert with lead details", () => {
    const tpl = tplStaffLeadAlert({
      adminFirstName: "Daniel",
      lead: {
        id: 42,
        full_name: "Alex Rivera",
        email: "alex@example.com",
        phone: "(555) 010-2030",
        property_address: "123 Oak St, Fontana, CA",
        mode: "event",
        event_city: "Fontana",
        soft_pull_consent: true,
      },
    });
    expect(tpl.subject).toContain("Alex Rivera");
    expect(tpl.html).toContain("Daniel");
    expect(tpl.html).toContain("alex@example.com");
    expect(tpl.html).toContain("123 Oak St");
  });
});

describe("parseLeadBody", () => {
  it("accepts a valid payload", () => {
    const parsed = __test.parseLeadBody({
      full_name: "Alex Rivera",
      email: "Alex@Example.com",
      phone: "5550102030",
      property_address: "123 Oak St",
      soft_pull_consent: true,
      mode: "event",
      event_id: 1,
      event_city: "Fontana",
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.data.email).toBe("alex@example.com");
      expect(parsed.data.mode).toBe("event");
      expect(parsed.data.preferred_language).toBe("en");
    }
  });

  it("accepts preferred_language es", () => {
    const parsed = __test.parseLeadBody({
      full_name: "Alex Rivera",
      email: "alex@example.com",
      phone: "5550102030",
      property_address: "123 Oak St",
      soft_pull_consent: true,
      preferred_language: "es",
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.data.preferred_language).toBe("es");
    }
  });

  it("rejects short phone numbers", () => {
    const parsed = __test.parseLeadBody({
      full_name: "Alex Rivera",
      email: "alex@example.com",
      phone: "555010",
      property_address: "123 Oak St",
      soft_pull_consent: true,
    });
    expect(parsed.ok).toBe(false);
  });

  it("rejects missing consent with i18n key", () => {
    const parsed = __test.parseLeadBody({
      full_name: "Alex Rivera",
      email: "alex@example.com",
      phone: "5550102030",
      property_address: "123 Oak St",
      soft_pull_consent: false,
    });
    expect(parsed.ok).toBe(false);
    expect(parsed).toMatchObject({ error: "validation.consent" });
  });
});
