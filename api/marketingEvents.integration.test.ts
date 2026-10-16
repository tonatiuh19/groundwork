import "dotenv/config";
import crypto from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import {
  __test,
  __testClearEmailDryRuns,
  __testGetEmailDryRuns,
  createServer,
} from "./index";
import {
  cleanupPortalFixturesByPrefix,
  createIntegrationTestPool,
} from "./testDbCleanup";

const hasDb =
  Boolean(process.env.DB_HOST) &&
  Boolean(process.env.DB_USER) &&
  Boolean(process.env.DB_PASSWORD) &&
  Boolean(process.env.DB_NAME);

const DAY = 86_400_000;

describe("marketing events (pure)", () => {
  const base = {
    status: "published",
    starts_at: new Date(Date.now() + 2 * DAY),
    registration_opens_at: new Date(Date.now() - DAY),
    registration_closes_at: null,
    created_at: new Date(Date.now() - 3 * DAY),
  };

  it("opens registration only for published events inside the window", () => {
    expect(__test.eventRegistrationOpen(base)).toBe(true);
    expect(__test.eventRegistrationOpen({ ...base, status: "draft" })).toBe(false);
    expect(__test.eventRegistrationOpen({ ...base, status: "archived" })).toBe(false);
    // not yet open
    expect(
      __test.eventRegistrationOpen({
        ...base,
        registration_opens_at: new Date(Date.now() + DAY),
      }),
    ).toBe(false);
    // closes_at in the past
    expect(
      __test.eventRegistrationOpen({
        ...base,
        registration_closes_at: new Date(Date.now() - 1000),
      }),
    ).toBe(false);
    // falls back to starts_at when no explicit close, and created_at for open
    expect(
      __test.eventRegistrationOpen({
        ...base,
        registration_opens_at: null,
        starts_at: new Date(Date.now() - 1000),
      }),
    ).toBe(false);
    expect(
      __test.eventRegistrationOpen({ ...base, registration_opens_at: null }),
    ).toBe(true);
  });

  const lead = {
    full_name: "Event Person",
    email: "event.person@example.com",
    phone: "5550102030",
    property_address: "123 Oak St, Fontana, CA",
  };

  it("event mode needs event_id but not soft-pull consent", () => {
    const ok = __test.parseLeadBody({ ...lead, mode: "event", event_id: 7 });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.data.event_id).toBe(7);
      expect(ok.data.soft_pull_consent).toBe(false);
    }
    const missing = __test.parseLeadBody({ ...lead, mode: "event" });
    expect(missing.ok).toBe(false);
  });

  it("standard mode still requires consent and ignores event_id", () => {
    const noConsent = __test.parseLeadBody({ ...lead, mode: "standard", event_id: 7 });
    expect(noConsent).toEqual({ ok: false, error: "validation.consent" });
    const ok = __test.parseLeadBody({
      ...lead,
      mode: "standard",
      event_id: 7,
      soft_pull_consent: true,
    });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.data.event_id ?? null).toBeNull();
  });
});

describe.runIf(hasDb)("marketing events API (integration)", () => {
  const app = createServer();
  const db = createIntegrationTestPool();
  const prefix = `gwev-${Date.now()}-`;
  const em = (name: string) => `${prefix}${name}@example.com`;

  let superCookie = "";
  let contentCookie = "";
  let agentCookie = "";
  let financeCookie = "";

  const cookies = new Map<string, string>();
  const asCookie = (c: string) => ({
    get: (u: string) => request(app).get(u).set("Cookie", c),
    post: (u: string) => request(app).post(u).set("Cookie", c),
    patch: (u: string) => request(app).patch(u).set("Cookie", c),
    delete: (u: string) => request(app).delete(u).set("Cookie", c),
  });

  async function mkAdmin(name: string, role: string): Promise<string> {
    const [r] = await db.execute(
      `INSERT INTO admins (email, first_name, last_name, role, status) VALUES (?, ?, 'Test', ?, 'active')`,
      [em(name), name, role],
    );
    const id = Number((r as { insertId: number }).insertId);
    const token = crypto.randomBytes(32).toString("hex");
    await db.execute(
      `INSERT INTO admin_sessions (admin_id, token_hash, expires_at) VALUES (?, ?, ?)`,
      [
        id,
        crypto.createHash("sha256").update(token).digest("hex"),
        new Date(Date.now() + DAY),
      ],
    );
    const cookie = `gw_admin_sid=${token}`;
    cookies.set(name, cookie);
    return cookie;
  }

  const eventBody = (slugSuffix: string, extra: Record<string, unknown> = {}) => ({
    slug: `${prefix}${slugSuffix}`,
    status: "published",
    starts_at: new Date(Date.now() + 2 * DAY).toISOString(),
    registration_opens_at: new Date(Date.now() - DAY).toISOString(),
    city: "Fontana",
    title_en: `Test event ${slugSuffix}`,
    title_es: `Evento de prueba ${slugSuffix}`,
    capacity: 1,
    waitlist_enabled: true,
    ...extra,
  });

  const rsvp = (eventId: number, name: string, extra: Record<string, unknown> = {}) =>
    request(app)
      .post("/api/public/leads")
      .send({
        full_name: `Guest ${name}`,
        email: em(name),
        phone: "5550101234",
        property_address: "1 Test Way, Fontana, CA",
        mode: "event",
        event_id: eventId,
        source: "vitest",
        ...extra,
      });

  beforeAll(async () => {
    process.env.VITEST = "true";
    __testClearEmailDryRuns();
    superCookie = await mkAdmin("super", "super_admin");
    contentCookie = await mkAdmin("content", "content");
    agentCookie = await mkAdmin("agent", "agent");
    financeCookie = await mkAdmin("finance", "finance");
  });

  afterAll(async () => {
    try {
      await cleanupPortalFixturesByPrefix(db, prefix);
    } finally {
      await db.end();
      __testClearEmailDryRuns();
    }
  });

  it("GET /api/public/events/live returns an open event (seeded/featured first)", async () => {
    const res = await request(app).get("/api/public/events/live?lang=es").expect(200);
    expect(res.body.ok).toBe(true);
    // Fontana seed (or a later open event) — never a closed/draft one.
    if (res.body.event) {
      expect(res.body.event.registration_open).toBe(true);
      expect(typeof res.body.event.title).toBe("string");
      expect(res.body.event).not.toHaveProperty("title_en");
    }
  });

  it("enforces event permissions: content creates, finance/agent cannot", async () => {
    await asCookie(financeCookie)
      .post("/api/admin/events")
      .send(eventBody("finance-denied"))
      .expect(403);
    await asCookie(agentCookie)
      .post("/api/admin/events")
      .send(eventBody("agent-denied"))
      .expect(403);
    await request(app).post("/api/admin/events").send(eventBody("anon")).expect(401);

    const created = await asCookie(contentCookie)
      .post("/api/admin/events")
      .send(eventBody("draft-by-content", { status: "draft" }))
      .expect(201);
    expect(created.body.event.slug).toBe(`${prefix}draft-by-content`);
    expect(created.body.event.status).toBe("draft");

    // duplicate slug
    await asCookie(contentCookie)
      .post("/api/admin/events")
      .send(eventBody("draft-by-content", { status: "draft" }))
      .expect(409);
    // missing required fields
    await asCookie(contentCookie)
      .post("/api/admin/events")
      .send({ slug: `${prefix}bad` })
      .expect(400);

    // draft is invisible publicly, and closed for RSVP
    await request(app)
      .get(`/api/public/events/${prefix}draft-by-content`)
      .expect(404);
    const closed = await rsvp(created.body.event.id, "draft-rsvp").expect(409);
    expect(closed.body.error).toBe("errors.eventClosed");

    // finance cannot read events/attendees; draft with no leads can be deleted
    await asCookie(financeCookie).get("/api/admin/events").expect(403);
    await asCookie(agentCookie)
      .delete(`/api/admin/events/${created.body.event.id}`)
      .expect(403);
    await asCookie(contentCookie)
      .delete(`/api/admin/events/${created.body.event.id}`)
      .expect(200);
  });

  it("QR scans count, attribute RSVPs, and forward past events; past tab + media", async () => {
    const ev = await asCookie(superCookie)
      .post("/api/admin/events")
      .send(eventBody("qr", { capacity: 50 }))
      .expect(201);
    const eventId: number = ev.body.event.id;

    const scan = await request(app).post(`/api/public/events/${prefix}qr/qr-scan`).expect(200);
    expect(scan.body).toMatchObject({ ok: true, slug: `${prefix}qr`, register: true, event_id: eventId });

    await rsvp(eventId, "qrguest", { source: "qr", phone: "5550107788" }).expect(201);
    const adminView = await asCookie(superCookie).get(`/api/admin/events/${eventId}`).expect(200);
    expect(adminView.body.event.qr_scan_count).toBe(1);
    expect(adminView.body.event.qr_rsvp_count).toBe(1);
    expect(adminView.body.event.qr_last_scanned_at).toBeTruthy();

    // Past event: never live, shows in the past tab, scan forwards (never to itself with register).
    const past = await asCookie(superCookie)
      .post("/api/admin/events")
      .send(
        eventBody("past", {
          starts_at: new Date(Date.now() - 3 * DAY).toISOString(),
          registration_opens_at: new Date(Date.now() - 10 * DAY).toISOString(),
        }),
      )
      .expect(201);
    // Late registration_closes_at must not reopen RSVPs on a past event.
    await asCookie(superCookie)
      .patch(`/api/admin/events/${past.body.event.id}`)
      .send({ registration_closes_at: new Date(Date.now() + DAY).toISOString() })
      .expect(200);
    await rsvp(past.body.event.id, "late", { phone: "5550107799" }).expect(409);
    const pastScan = await request(app).post(`/api/public/events/${prefix}past/qr-scan`).expect(200);
    if (pastScan.body.register) expect(pastScan.body.slug).not.toBe(`${prefix}past`);
    else expect(pastScan.body.slug).toBe(`${prefix}past`);

    const pastTab = await request(app).get("/api/public/events?tab=past").expect(200);
    const listed = pastTab.body.events.find((e: { id: number }) => e.id === past.body.event.id);
    expect(listed).toMatchObject({ is_past: true, media_count: 0 });
    const upcoming = await request(app).get("/api/public/events?tab=upcoming").expect(200);
    expect(upcoming.body.events.some((e: { id: number }) => e.id === past.body.event.id)).toBe(false);

    // Media: admins only; embeds normalized and shown on the public detail.
    await asCookie(contentCookie)
      .post(`/api/admin/events/${past.body.event.id}/media`)
      .send({ embed_url: "https://youtu.be/dQw4w9WgXcQ" })
      .expect(403);
    await asCookie(superCookie)
      .post(`/api/admin/events/${past.body.event.id}/media`)
      .send({ embed_url: "https://evil.example.com/x" })
      .expect(400);
    const added = await asCookie(superCookie)
      .post(`/api/admin/events/${past.body.event.id}/media`)
      .send({ embed_url: "https://youtu.be/dQw4w9WgXcQ", caption_en: "Recap" })
      .expect(201);
    const mediaId = added.body.media[0].id;

    // Upcoming events never expose their gallery publicly.
    await asCookie(superCookie)
      .post(`/api/admin/events/${eventId}/media`)
      .send({ embed_url: "https://youtu.be/dQw4w9WgXcQ" })
      .expect(201);
    const upcomingDetail = await request(app).get(`/api/public/events/${prefix}qr`).expect(200);
    expect(upcomingDetail.body.event.media).toEqual([]);
    expect(upcomingDetail.body.event.media_count).toBe(1);
    await asCookie(superCookie)
      .patch(`/api/admin/events/${past.body.event.id}/media/${mediaId}`)
      .send({ is_highlight: true })
      .expect(200);
    const pub = await request(app).get(`/api/public/events/${prefix}past?lang=es`).expect(200);
    expect(pub.body.event.is_past).toBe(true);
    expect(pub.body.event.media[0]).toMatchObject({
      kind: "embed",
      embed_provider: "youtube",
      is_highlight: true,
      caption: "Recap",
    });
    await asCookie(superCookie)
      .delete(`/api/admin/events/${past.body.event.id}/media/${mediaId}`)
      .expect(200);
  });

  it("RSVP without soft pull succeeds, then waitlists at capacity, with agents viewing attendees", async () => {
    const ev = await asCookie(contentCookie)
      .post("/api/admin/events")
      .send(eventBody("capacity"))
      .expect(201);
    const eventId: number = ev.body.event.id;

    // public detail for published event
    const detail = await request(app)
      .get(`/api/public/events/${prefix}capacity?lang=es`)
      .expect(200);
    expect(detail.body.event.title).toContain("Evento de prueba");
    expect(detail.body.event.registration_open).toBe(true);
    expect(detail.body.event.spots_remaining).toBe(1);

    __testClearEmailDryRuns();
    const first = await rsvp(eventId, "first", { soft_pull_consent: false }).expect(201);
    expect(first.body.event_registration_status).toBe("confirmed");
    expect(first.body.credit_cta_url).toMatch(/\/get-credit-report$/);

    const dry = __testGetEmailDryRuns();
    const guestMail = dry.find((d) => String(d.to).includes(em("first")));
    expect(guestMail?.html).toContain("/get-credit-report");
    expect(guestMail?.html).toContain("Your spot is saved");
    expect(dry.some((d) => d.html.includes("Test event capacity"))).toBe(true);

    // capacity reached → waitlisted
    __testClearEmailDryRuns();
    const second = await rsvp(eventId, "second").expect(201);
    expect(second.body.event_registration_status).toBe("waitlisted");
    const waitMail = __testGetEmailDryRuns().find((d) =>
      String(d.to).includes(em("second")),
    );
    expect(waitMail?.html).toContain("You're on the waitlist");
    expect(waitMail?.html).toContain("/get-credit-report");

    // duplicate email + event
    const dupe = await rsvp(eventId, "first").expect(409);
    expect(dupe.body.error).toBe("errors.duplicate");

    // validation: event mode needs event_id; standard still needs consent
    await request(app)
      .post("/api/public/leads")
      .send({
        full_name: "No Event",
        email: em("noevent"),
        phone: "5550101234",
        property_address: "1 Test Way, Fontana, CA",
        mode: "event",
      })
      .expect(400);
    const std = await request(app)
      .post("/api/public/leads")
      .send({
        full_name: "Std Lead",
        email: em("std"),
        phone: "5550101234",
        property_address: "1 Test Way, Fontana, CA",
        mode: "standard",
      })
      .expect(400);
    expect(std.body.error).toBe("validation.consent");

    // unknown event
    const nf = await rsvp(2_000_000_000, "ghost").expect(404);
    expect(nf.body.error).toBe("errors.eventNotFound");

    // rows persisted with event attribution
    const [rows] = await db.query(
      `SELECT event_id, event_city, event_registration_status, soft_pull_consent
       FROM leads WHERE email = ?`,
      [em("second")],
    );
    expect((rows as any[])[0]).toMatchObject({
      event_id: eventId,
      event_city: "Fontana",
      event_registration_status: "waitlisted",
      soft_pull_consent: 0,
    });

    // agent can read attendees (leads perm) but not mutate the event
    const att = await asCookie(agentCookie)
      .get(`/api/admin/events/${eventId}/attendees`)
      .expect(200);
    expect(att.body.total).toBe(2);
    expect(att.body.event.confirmed_count).toBe(1);
    expect(att.body.event.waitlisted_count).toBe(1);
    const onlyWait = await asCookie(agentCookie)
      .get(`/api/admin/events/${eventId}/attendees?registration_status=waitlisted`)
      .expect(200);
    expect(onlyWait.body.attendees.map((a: any) => a.email)).toEqual([em("second")]);
    const csv = await asCookie(agentCookie)
      .get(`/api/admin/events/${eventId}/attendees?format=csv`)
      .expect(200);
    expect(csv.headers["content-type"]).toContain("text/csv");
    expect(csv.text).toContain(em("first"));
    await asCookie(agentCookie)
      .patch(`/api/admin/events/${eventId}`)
      .send({ capacity: 5 })
      .expect(403);
    await asCookie(financeCookie)
      .get(`/api/admin/events/${eventId}/attendees`)
      .expect(403);

    // admin leads list shows event data + filters
    const leads = await asCookie(agentCookie)
      .get(`/api/admin/leads?event_id=${eventId}&event_registration_status=waitlisted&mode=event`)
      .expect(200);
    expect(leads.body.leads).toHaveLength(1);
    expect(leads.body.leads[0]).toMatchObject({
      event_id: eventId,
      event_registration_status: "waitlisted",
      event_title: "Test event capacity",
    });

    // events with RSVPs cannot be deleted; archive instead
    await asCookie(superCookie).delete(`/api/admin/events/${eventId}`).expect(409);
    const archived = await asCookie(contentCookie)
      .patch(`/api/admin/events/${eventId}`)
      .send({ status: "archived" })
      .expect(200);
    expect(archived.body.event.status).toBe("archived");
    expect(archived.body.event.registration_open).toBe(false);
    await request(app).get(`/api/public/events/${prefix}capacity`).expect(404);
    const afterClose = await rsvp(eventId, "late").expect(409);
    expect(afterClose.body.error).toBe("errors.eventClosed");
  });

  it("returns 409 eventFull when full and waitlist is disabled", async () => {
    const ev = await asCookie(contentCookie)
      .post("/api/admin/events")
      .send(eventBody("nowait", { waitlist_enabled: false }))
      .expect(201);
    const id: number = ev.body.event.id;
    await rsvp(id, "nowait-a").expect(201);
    const full = await rsvp(id, "nowait-b").expect(409);
    expect(full.body.error).toBe("errors.eventFull");
    const [rows] = await db.query(`SELECT id FROM leads WHERE email = ?`, [
      em("nowait-b"),
    ]);
    expect((rows as any[]).length).toBe(0);
  });
});
