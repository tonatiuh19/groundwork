import crypto from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { __testGetMailDryRuns, __testGetSmsDryRuns, __testSetGraphApi, __testSetMailOAuth, createServer } from "./index";
import { cleanupPortalFixturesByPrefix, createIntegrationTestPool } from "./testDbCleanup";
import { makeFakeGraph } from "./testFakeGraph";

const hasDb = Boolean(process.env.DB_HOST && process.env.DB_USER && process.env.DB_NAME);

describe.runIf(hasDb)("mail + calendar sync (Microsoft 365, fake Graph)", () => {
  const app = createServer();
  const db = createIntegrationTestPool();
  const stamp = Date.now();
  const prefix = `gwmail-${stamp}-`;
  const em = (n: string) => `${prefix}${n}@example.com`;
  const boxEmail = em("box");
  const graph = makeFakeGraph([boxEmail]);
  const cookies: Record<string, string> = {};
  const adminIds: Record<string, number> = {};
  const ins = async (sql: string, p: unknown[]) => Number(((await db.execute(sql, p as any[])) as any)[0].insertId);
  const one = async (sql: string, p: unknown[]) => ((await db.query(sql, p as any[])) as any)[0][0];
  let clientId = 0;
  let mailboxId = 0;
  const prevDomains = process.env.MAIL_ALLOWED_DOMAINS;

  beforeAll(async () => {
    process.env.VITEST = "true";
    process.env.MAIL_ALLOWED_DOMAINS = "example.com";
    __testSetGraphApi(graph.fn);
    for (const role of ["admin", "agent", "other"]) {
      const id = await ins(`INSERT INTO admins (email, first_name, last_name, role, status) VALUES (?, ?, 'Mail', ?, 'active')`, [
        em(role),
        role,
        role === "admin" ? "admin" : "agent",
      ]);
      adminIds[role] = id;
      const t = crypto.randomBytes(32).toString("hex");
      await db.execute(`INSERT INTO admin_sessions (admin_id, token_hash, expires_at) VALUES (?, ?, NOW() + INTERVAL 1 HOUR)`, [
        id,
        crypto.createHash("sha256").update(t).digest("hex"),
      ]);
      cookies[role] = `gw_admin_sid=${t}`;
    }
    clientId = await ins(`INSERT INTO clients (first_name, last_name, email, status) VALUES ('Mia', 'Mailer', ?, 'active')`, [em("mia")]);
  });

  afterAll(async () => {
    __testSetGraphApi(null);
    __testSetMailOAuth(null);
    if (prevDomains === undefined) delete process.env.MAIL_ALLOWED_DOMAINS;
    else process.env.MAIL_ALLOWED_DOMAINS = prevDomains;
    try {
      await cleanupPortalFixturesByPrefix(db, prefix);
    } finally {
      await db.end();
    }
  });

  it("connect: staff-only, groundwork domains only, mailbox must exist in Microsoft 365; first sync pulls mail and matches the client", async () => {
    graph.receive(boxEmail, { from: em("mia"), fromName: "Mia Mailer", subject: `${prefix}Kitchen quote`, at: new Date(Date.now() - 3_600_000), html: "<p>Hi! <script>alert(1)</script>Can you send the quote?</p>" });
    await request(app).post("/api/admin/mail/mailboxes").set("Cookie", cookies.agent).send({ email: boxEmail }).expect(403);
    const bad = await request(app).post("/api/admin/mail/mailboxes").set("Cookie", cookies.admin).send({ email: `${prefix}x@gmail.com`, owner_admin_id: adminIds.agent });
    expect(bad.body.error).toBe("validation.mailboxDomain");
    const missing = await request(app).post("/api/admin/mail/mailboxes").set("Cookie", cookies.admin).send({ email: em("nobody"), owner_admin_id: adminIds.agent });
    expect(missing.body.error).toBe("errors.mailboxNotFound");

    const r = await request(app)
      .post("/api/admin/mail/mailboxes")
      .set("Cookie", cookies.admin)
      .send({ email: boxEmail, kind: "personal", owner_admin_id: adminIds.agent, display_name: "Agent box", signature_html: "<p>Agent · Groundwork</p>" })
      .expect(201);
    mailboxId = r.body.id;
    expect(r.body.sync.errors).toEqual([]);
    const thread = await one(`SELECT * FROM mail_threads WHERE mailbox_id = ?`, [mailboxId]);
    expect(thread).toMatchObject({ match_kind: "client", match_id: clientId, unread_count: 1 });
    const msg = await one(`SELECT body_html FROM mail_messages WHERE thread_id = ?`, [thread.id]);
    expect(msg.body_html).not.toContain("<script");
  });

  it("visibility: owner and admins see the mailbox; other staff only when given access", async () => {
    const mine = await request(app).get("/api/admin/mail/status").set("Cookie", cookies.agent).expect(200);
    expect(mine.body.mailboxes.map((m: any) => m.id)).toContain(mailboxId);
    expect(mine.body.can_manage).toBe(false);
    expect(mine.body.mailboxes.find((m: any) => m.id === mailboxId).unread).toBe(1);
    const other = await request(app).get("/api/admin/mail/status").set("Cookie", cookies.other).expect(200);
    expect(other.body.mailboxes.map((m: any) => m.id)).not.toContain(mailboxId);
    await request(app).get(`/api/admin/mail/threads?mailbox_id=${mailboxId}`).set("Cookie", cookies.other).expect(403);
    await request(app).patch(`/api/admin/mail/mailboxes/${mailboxId}`).set("Cookie", cookies.admin).send({ access: [{ admin_id: adminIds.other, can_send: false }] }).expect(200);
    const list = await request(app).get(`/api/admin/mail/threads?mailbox_id=${mailboxId}&q=${encodeURIComponent("Mia Mailer")}`).set("Cookie", cookies.other).expect(200);
    expect(list.body.threads).toHaveLength(1);
    const t = list.body.threads[0];
    await request(app).post("/api/admin/mail/send").set("Cookie", cookies.other).send({ mailbox_id: mailboxId, to: [em("mia")], subject: "x", html: "x" }).expect(403);
    expect(t.match).toMatchObject({ kind: "client", id: clientId, name: "Mia Mailer" });
  });

  it("opening a thread marks it read here and in Outlook", async () => {
    const t = await one(`SELECT id FROM mail_threads WHERE mailbox_id = ?`, [mailboxId]);
    const r = await request(app).get(`/api/admin/mail/threads/${t.id}`).set("Cookie", cookies.agent).expect(200);
    expect(r.body.messages[0].html).toContain("Can you send the quote?");
    expect(r.body.can_send).toBe(true);
    expect(graph.calls.some((c) => c.method === "PATCH" && c.path.includes("/messages/") && c.body?.isRead === true)).toBe(true);
    expect((await one(`SELECT unread_count FROM mail_threads WHERE id = ?`, [t.id])).unread_count).toBe(0);
  });

  it("reply in the sandbox: never sent, shown in the thread with the signature", async () => {
    const m = await one(`SELECT id, thread_id FROM mail_messages WHERE mailbox_id = ? AND direction = 'inbound'`, [mailboxId]);
    const before = graph.calls.length;
    const r = await request(app)
      .post("/api/admin/mail/send")
      .set("Cookie", cookies.agent)
      .send({ mailbox_id: mailboxId, to: [], cc: [], subject: "", html: "<p>Attached, thanks!</p>", reply_to_message_id: m.id })
      .expect(201);
    expect(r.body).toMatchObject({ ok: true, dry_run: true, thread_id: m.thread_id });
    expect(graph.calls.slice(before).some((c) => c.method === "POST")).toBe(false);
    const dry = __testGetMailDryRuns().slice(-1)[0];
    expect(dry.html).toContain("Agent · Groundwork");
    const t = await one(`SELECT message_count, has_outbound, last_direction FROM mail_threads WHERE id = ?`, [m.thread_id]);
    expect(t).toMatchObject({ message_count: 2, has_outbound: 1, last_direction: "outbound" });
    const last = await request(app).get(`/api/admin/mail/last-email?email=${encodeURIComponent(em("mia"))}`).set("Cookie", cookies.agent).expect(200);
    expect(last.body.last_email).toMatchObject({ direction: "outbound", thread_id: m.thread_id });
  });

  it("delta: new mail arrives, deleted mail disappears", async () => {
    const extra = graph.receive(boxEmail, { from: `${prefix}stranger@example.com`, subject: `${prefix}Hello` });
    await request(app).post(`/api/admin/mail/mailboxes/${mailboxId}/sync`).set("Cookie", cookies.agent).expect(200);
    const t = await one(`SELECT id, match_kind FROM mail_threads WHERE mailbox_id = ? AND subject = ?`, [mailboxId, `${prefix}Hello`]);
    expect(t.match_kind).toBeNull();
    graph.deleteMessage(boxEmail, extra.id);
    await request(app).post(`/api/admin/mail/mailboxes/${mailboxId}/sync`).set("Cookie", cookies.agent).expect(200);
    expect(await one(`SELECT COUNT(*) n FROM mail_threads WHERE id = ?`, [t.id])).toMatchObject({ n: 0 });
  });

  it("partial delta updates never blank an email; blank ones from before heal on the next sync", async () => {
    const sync = () => request(app).post(`/api/admin/mail/mailboxes/${mailboxId}/sync`).set("Cookie", cookies.agent).expect(200);
    const body = `<p>${prefix}Plan check comments attached</p>`;
    // 1) Stored fully, then read on a phone: the delta only carries { isRead }.
    const a = graph.receive(boxEmail, { from: "building@example.com", subject: `${prefix}Resubmittal`, html: body });
    await sync();
    graph.touchPartial(boxEmail, a.id, { isRead: true });
    await sync();
    const ra = await one(`SELECT subject, body_preview, body_html, from_email, is_read FROM mail_messages WHERE mailbox_id = ? AND graph_id = ?`, [mailboxId, a.id]);
    expect(ra).toMatchObject({ subject: `${prefix}Resubmittal`, from_email: "building@example.com", is_read: 1 });
    expect(ra.body_html).toContain("Plan check comments");
    expect(ra.body_preview).toBeTruthy();
    // 2) Brand-new message already changed before our first sync sees it: the partial item is fetched in full.
    const b = graph.receive(boxEmail, { from: "building@example.com", subject: `${prefix}Second`, html: `<p>${prefix}Second body</p>` });
    graph.touchPartial(boxEmail, b.id, { isRead: true });
    await sync();
    const rb = await one(`SELECT subject, body_html FROM mail_messages WHERE mailbox_id = ? AND graph_id = ?`, [mailboxId, b.id]);
    expect(rb.subject).toBe(`${prefix}Second`);
    expect(rb.body_html).toContain("Second body");
    // 3) A row blanked by the old bug heals on the next sync (and the thread subject comes back).
    await db.execute(`UPDATE mail_messages SET subject = NULL, body_preview = NULL, body_html = '' WHERE mailbox_id = ? AND graph_id = ?`, [mailboxId, a.id]);
    await sync();
    const healed = await one(`SELECT m.subject, m.body_html, t.subject AS thread_subject FROM mail_messages m JOIN mail_threads t ON t.id = m.thread_id WHERE m.mailbox_id = ? AND m.graph_id = ?`, [mailboxId, a.id]);
    expect(healed.subject).toBe(`${prefix}Resubmittal`);
    expect(healed.body_html).toContain("Plan check comments");
    expect(healed.thread_subject).toBe(`${prefix}Resubmittal`);
    // 4) Gone from Outlook: marked so it's never retried (no endless re-fetching).
    const c = graph.receive(boxEmail, { from: "building@example.com", subject: `${prefix}Gone` });
    await sync();
    await db.execute(`UPDATE mail_messages SET subject = NULL, body_preview = NULL, body_html = '' WHERE mailbox_id = ? AND graph_id = ?`, [mailboxId, c.id]);
    (graph.inbox(boxEmail).find((m) => m.id === c.id) as any).gone = true;
    await sync();
    expect(await one(`SELECT body_preview FROM mail_messages WHERE mailbox_id = ? AND graph_id = ?`, [mailboxId, c.id])).toMatchObject({ body_preview: "" });
    const fetches = () => graph.calls.filter((x) => x.method === "GET" && x.path.includes(`/messages/${c.id}?`)).length;
    const before = fetches();
    await sync();
    expect(fetches()).toBe(before);
  });

  it("Outlook → CRM: events become appointments (no CRM invites); Free time never blocks", async () => {
    const start = new Date(Date.now() + 3 * 86400_000);
    start.setUTCMinutes(0, 0, 0);
    const ev = graph.addEvent(boxEmail, { subject: `${prefix}Walkthrough`, start, end: new Date(start.getTime() + 3600_000), attendees: [em("mia")], teams: true });
    graph.addEvent(boxEmail, { subject: `${prefix}Focus`, start: new Date(start.getTime() + 2 * 3600_000), end: new Date(start.getTime() + 3 * 3600_000), showAs: "free" });
    const first = await request(app).post(`/api/admin/mail/mailboxes/${mailboxId}/sync`).set("Cookie", cookies.agent).expect(200);
    expect(first.body.result.errors).toEqual([]);
    const a = await one(
      `SELECT a.* FROM appointments a JOIN appointment_calendar_links l ON l.appointment_id = a.id WHERE l.graph_event_id = ?`,
      [ev.id],
    );
    expect(a).toMatchObject({ source: "outlook", client_id: clientId, owner_admin_id: adminIds.agent, location_type: "video" });
    expect(String(a.video_url)).toContain("teams.microsoft.com");

    // Sync again: nothing duplicated.
    await request(app).post(`/api/admin/mail/mailboxes/${mailboxId}/sync`).set("Cookie", cookies.agent).expect(200);
    expect(await one(`SELECT COUNT(*) n FROM appointments WHERE title = ?`, [`${prefix}Walkthrough`])).toMatchObject({ n: 1 });

    // Moved in Outlook → moved in the CRM.
    const later = new Date(start.getTime() + 86400_000);
    graph.moveEvent(boxEmail, ev.id, later, new Date(later.getTime() + 3600_000));
    await request(app).post(`/api/admin/mail/mailboxes/${mailboxId}/sync`).set("Cookie", cookies.agent).expect(200);
    expect(new Date((await one(`SELECT starts_at FROM appointments WHERE id = ?`, [a.id])).starts_at).getTime()).toBe(later.getTime());

    // Deleted in Outlook → cancelled in the CRM.
    graph.removeEvent(boxEmail, ev.id);
    await request(app).post(`/api/admin/mail/mailboxes/${mailboxId}/sync`).set("Cookie", cookies.agent).expect(200);
    expect((await one(`SELECT status FROM appointments WHERE id = ?`, [a.id])).status).toBe("cancelled");
  });

  it("CRM → Outlook: create (with Teams), edit, cancel write through to the owner's calendar without duplicates", async () => {
    const day = new Date(Date.now() + 5 * 86400_000).toISOString().slice(0, 10);
    const created = await request(app)
      .post("/api/admin/appointments")
      .set("Cookie", cookies.agent)
      .send({
        kind: "consultation",
        date: day,
        start: "10:00",
        duration_minutes: 30,
        timezone: "America/Los_Angeles",
        location_type: "video",
        title: `${prefix}Consult`,
        client_id: clientId,
        notify_homeowner: false,
        teams_meeting: true,
        attendees: [],
      })
      .expect(201);
    const id = created.body.appointment?.id ?? created.body.id;
    const link = await one(`SELECT * FROM appointment_calendar_links WHERE appointment_id = ?`, [id]);
    expect(link).toMatchObject({ origin: "crm", mailbox_id: mailboxId });
    const ev = graph.events(boxEmail).find((e) => e.id === link.graph_event_id)!;
    expect(ev.subject).toBe(`${prefix}Consult`);
    expect(ev.attendees).toEqual([]);
    expect(String((await one(`SELECT video_url FROM appointments WHERE id = ?`, [id])).video_url)).toContain("teams.microsoft.com");

    await request(app).patch(`/api/admin/appointments/${id}`).set("Cookie", cookies.agent).send({ start: "11:00" }).expect(200);
    // 11:00 Los Angeles in UTC for that day (18:00 in summer time, 19:00 in winter: never hard-code it).
    const laOffset = Number(
      /GMT([+-]\d+)/.exec(new Date(`${day}T19:00:00Z`).toLocaleString("en-US", { timeZone: "America/Los_Angeles", timeZoneName: "shortOffset" }))![1],
    );
    expect(graph.events(boxEmail).find((e) => e.id === link.graph_event_id)!.start.dateTime).toContain(`T${String(11 - laOffset).padStart(2, "0")}:00:00`);

    // Sync sees its own event: no second appointment.
    await request(app).post(`/api/admin/mail/mailboxes/${mailboxId}/sync`).set("Cookie", cookies.agent).expect(200);
    expect(await one(`SELECT COUNT(*) n FROM appointments WHERE title = ?`, [`${prefix}Consult`])).toMatchObject({ n: 1 });

    await request(app).post(`/api/admin/appointments/${id}/cancel`).set("Cookie", cookies.agent).send({ reason: "test" }).expect(200);
    expect((await one(`SELECT status FROM appointments WHERE id = ?`, [id])).status).toBe("cancelled");
    expect(graph.events(boxEmail).some((e) => e.id === link.graph_event_id)).toBe(false);
    expect(await one(`SELECT COUNT(*) n FROM appointment_calendar_links WHERE appointment_id = ?`, [id])).toMatchObject({ n: 0 });
  });

  it("Connect with Microsoft: staff link their own mailbox (any domain), tokens sealed, state bound to the session", async () => {
    const own = em("personal-outlook");
    graph.addMailbox(own);
    graph.me = { id: `${prefix}graph-user`, mail: own, displayName: "Other Agent" };
    graph.receive(own, { from: em("mia"), subject: `${prefix}From my own Outlook` });
    __testSetMailOAuth(async (p) => {
      expect(["authorization_code", "refresh_token"]).toContain(p.grant_type);
      return { access_token: `${prefix}ACCESS-PLAIN`, refresh_token: `${prefix}REFRESH-PLAIN`, expires_in: 3600 };
    });
    process.env.MAIL_ALLOWED_DOMAINS = "groundworkcapitalgroup.com"; // not required for sign-in connects
    const start = await request(app).get("/api/admin/mail/oauth/start?json=1").set("Cookie", cookies.other).expect(200);
    const url = new URL(start.body.url);
    expect(url.hostname).toBe("login.microsoftonline.com");
    expect(url.pathname).toContain("/common/");
    expect(url.searchParams.get("scope")).toContain("Mail.Send");
    const state = String(url.searchParams.get("state"));

    // Another staff member can't finish someone else's sign-in; tampered state is refused.
    const stolen = await request(app).get(`/api/mail/oauth/callback?code=x&state=${encodeURIComponent(state)}`).set("Cookie", cookies.agent).expect(302);
    expect(stolen.headers.location).toContain("connect_error=errors.mailConnectExpired");
    const bad = await request(app).get(`/api/mail/oauth/callback?code=x&state=${encodeURIComponent(state + "x")}`).set("Cookie", cookies.other).expect(302);
    expect(bad.headers.location).toContain("connect_error");
    const denied = await request(app).get(`/api/mail/oauth/callback?error=access_denied&state=${encodeURIComponent(state)}`).set("Cookie", cookies.other).expect(302);
    expect(denied.headers.location).toContain("errors.mailConnectDenied");

    const ok = await request(app).get(`/api/mail/oauth/callback?code=good&state=${encodeURIComponent(state)}`).set("Cookie", cookies.other).expect(302);
    expect(ok.headers.location).toMatch(/connected=\d+/);
    const mb = await one(`SELECT * FROM mailboxes WHERE email = ?`, [own]);
    expect(mb).toMatchObject({ auth_mode: "delegated", owner_admin_id: adminIds.other, kind: "personal" });
    expect(String(mb.oauth_access_token)).not.toContain("ACCESS-PLAIN");
    expect(String(mb.oauth_refresh_token)).not.toContain("REFRESH-PLAIN");
    expect(await one(`SELECT COUNT(*) n FROM mail_threads WHERE mailbox_id = ?`, [mb.id])).toMatchObject({ n: 1 });

    const st = await request(app).get("/api/admin/mail/status").set("Cookie", cookies.other).expect(200);
    expect(st.body.has_own_mailbox).toBe(true);
    expect(st.body.mailboxes.find((m: any) => m.id === mb.id)).toMatchObject({ auth_mode: "delegated", can_send: true });

    // Someone else can't remove it; the owner can.
    await request(app).delete(`/api/admin/mail/mailboxes/${mb.id}`).set("Cookie", cookies.agent).send({ confirm: true }).expect(403);
    await request(app).delete(`/api/admin/mail/mailboxes/${mb.id}`).set("Cookie", cookies.other).send({ confirm: true }).expect(200);
    process.env.MAIL_ALLOWED_DOMAINS = "example.com";
  });

  it("edge cases: signed-in mailbox keeps syncing on /me links, no-Teams accounts still get the event, mid-write sync never duplicates, erase cleans Outlook + mail", async () => {
    // Signed-in personal account: Graph hands back /me/… links; no Teams meetings.
    const hot = em("hotmail");
    graph.addMailbox(hot);
    graph.meLinks.add(hot);
    graph.noTeams.add(hot);
    graph.me = { id: `${prefix}hot-user`, mail: hot, displayName: "Other Hotmail" };
    graph.receive(hot, { from: em("mia"), subject: `${prefix}Hot first` });
    __testSetMailOAuth(async () => ({ access_token: "a", refresh_token: "r", expires_in: 3600 }));
    const start = await request(app).get("/api/admin/mail/oauth/start?json=1").set("Cookie", cookies.other).expect(200);
    const state = String(new URL(start.body.url).searchParams.get("state"));
    await request(app).get(`/api/mail/oauth/callback?code=c&state=${encodeURIComponent(state)}`).set("Cookie", cookies.other).expect(302);
    const hb = await one(`SELECT id FROM mailboxes WHERE email = ?`, [hot]);
    graph.receive(hot, { from: em("mia"), subject: `${prefix}Hot second` });
    const again = await request(app).post(`/api/admin/mail/mailboxes/${hb.id}/sync`).set("Cookie", cookies.other).expect(200);
    expect(again.body.result.errors).toEqual([]);
    expect(await one(`SELECT COUNT(*) n FROM mail_messages WHERE mailbox_id = ?`, [hb.id])).toMatchObject({ n: 2 });

    const day = new Date(Date.now() + 6 * 86400_000).toISOString().slice(0, 10);
    const teams = await request(app)
      .post("/api/admin/appointments")
      .set("Cookie", cookies.other)
      .send({ kind: "call", date: day, start: "09:00", duration_minutes: 30, timezone: "America/Los_Angeles", location_type: "video", title: `${prefix}NoTeams`, notify_homeowner: false, teams_meeting: true, attendees: [] })
      .expect(201);
    const teamsId = teams.body.appointment?.id ?? teams.body.id;
    const tl = await one(`SELECT graph_event_id FROM appointment_calendar_links WHERE appointment_id = ? AND mailbox_id = ?`, [teamsId, hb.id]);
    expect(tl?.graph_event_id).toBeTruthy();
    expect(graph.events(hot).some((e) => e.id === tl.graph_event_id && e.subject === `${prefix}NoTeams`)).toBe(true);

    // Sync ran before the CRM saved its link: the marker links it back instead of importing a copy.
    await db.execute(`DELETE FROM appointment_calendar_links WHERE appointment_id = ?`, [teamsId]);
    await request(app).post(`/api/admin/mail/mailboxes/${hb.id}/sync`).set("Cookie", cookies.other).expect(200);
    expect(await one(`SELECT COUNT(*) n FROM appointments WHERE title = ?`, [`${prefix}NoTeams`])).toMatchObject({ n: 1 });
    expect(await one(`SELECT origin FROM appointment_calendar_links WHERE appointment_id = ?`, [teamsId])).toMatchObject({ origin: "crm" });

    // Erase a client: their CRM email copies go and their appointments leave Outlook.
    const erinId = await ins(`INSERT INTO clients (first_name, last_name, email, status) VALUES ('Erin', 'Erase', ?, 'active')`, [em("erin")]);
    graph.receive(boxEmail, { from: em("erin"), subject: `${prefix}Erin hello` });
    await request(app).post(`/api/admin/mail/mailboxes/${mailboxId}/sync`).set("Cookie", cookies.agent).expect(200);
    expect(await one(`SELECT COUNT(*) n FROM mail_threads WHERE match_kind = 'client' AND match_id = ?`, [erinId])).toMatchObject({ n: 1 });
    const ea = await request(app)
      .post("/api/admin/appointments")
      .set("Cookie", cookies.agent)
      .send({ kind: "call", date: day, start: "13:00", duration_minutes: 30, timezone: "America/Los_Angeles", location_type: "phone", title: `${prefix}Erin call`, client_id: erinId, notify_homeowner: false, attendees: [] })
      .expect(201);
    const eaId = ea.body.appointment?.id ?? ea.body.id;
    const el = await one(`SELECT graph_event_id FROM appointment_calendar_links WHERE appointment_id = ?`, [eaId]);
    expect(graph.events(boxEmail).some((e) => e.id === el.graph_event_id)).toBe(true);
    await request(app).delete(`/api/admin/people/client/${erinId}`).set("Cookie", cookies.admin).send({ confirm: true, reason: "test" }).expect(200);
    expect(await one(`SELECT COUNT(*) n FROM mail_threads WHERE match_kind = 'client' AND match_id = ?`, [erinId])).toMatchObject({ n: 0 });
    expect(graph.events(boxEmail).some((e) => e.id === el.graph_event_id)).toBe(false);

    await request(app).delete(`/api/admin/mail/mailboxes/${hb.id}`).set("Cookie", cookies.other).send({ confirm: true }).expect(200);
    // Disconnect took the CRM-written event off that Outlook calendar too.
    expect(graph.events(hot).some((e) => e.id === tl.graph_event_id)).toBe(false);
  });

  it("alerts: bell + text for email from CRM people only, once; never for the first backfill", async () => {
    await db.execute(`UPDATE admins SET phone = ? WHERE id = ?`, [`+1555${String(stamp).slice(-7)}`, adminIds.agent]);
    await ins(
      `INSERT INTO admin_phone_numbers (e164, friendly_name, assigned_admin_id, is_active, capabilities_json) VALUES (?, 'Mail alert line', ?, 1, JSON_OBJECT('sms', TRUE))`,
      [`+1555${String(stamp + 1).slice(-7)}`, adminIds.agent],
    );
    const smsBefore = (__testGetSmsDryRuns() as any[]).length;
    const bellsBefore = (await one(`SELECT COUNT(*) n FROM admin_notifications WHERE admin_id = ? AND event_key = 'inbound_email'`, [adminIds.agent])).n;
    graph.receive(boxEmail, { from: em("mia"), fromName: "Mia Mailer", subject: `${prefix}Alert me` });
    graph.receive(boxEmail, { from: `${prefix}nobody@example.com`, subject: `${prefix}Unknown sender` });
    await request(app).post(`/api/admin/mail/mailboxes/${mailboxId}/sync`).set("Cookie", cookies.agent).expect(200);
    const bells = async () => (await one(`SELECT COUNT(*) n FROM admin_notifications WHERE admin_id = ? AND event_key = 'inbound_email'`, [adminIds.agent])).n - bellsBefore;
    expect(await bells()).toBe(1);
    const sms = (__testGetSmsDryRuns() as any[]).slice(smsBefore);
    expect(sms.filter((m) => /Email from Mia Mailer \(client\)/.test(m.body))).toHaveLength(1);
    await request(app).post(`/api/admin/mail/mailboxes/${mailboxId}/sync`).set("Cookie", cookies.agent).expect(200);
    expect(await bells()).toBe(1);
    // The first connect pulled older mail: no alert for that backfill. The kitchen quote is dated an hour
    // earlier because mail times come from another clock than the DB, so "just now" can land after connect.
    const old = await one(`SELECT alerted_at FROM mail_messages WHERE subject = ?`, [`${prefix}Kitchen quote`]);
    expect(old.alerted_at).toBeNull();
  });

  it("archiving follows Outlook both ways; deleted mail goes; CRM archive moves it in Outlook", async () => {
    const m = graph.receive(boxEmail, { from: em("mia"), subject: `${prefix}Archive me` });
    const sync = () => request(app).post(`/api/admin/mail/mailboxes/${mailboxId}/sync`).set("Cookie", cookies.agent).expect(200);
    await sync();
    const t = await one(`SELECT id FROM mail_threads WHERE subject = ?`, [`${prefix}Archive me`]);
    graph.moveMessage(boxEmail, m.id, "archive");
    await sync();
    expect(await one(`SELECT archived FROM mail_threads WHERE id = ?`, [t.id])).toMatchObject({ archived: 1 });
    expect(await one(`SELECT folder FROM mail_messages WHERE thread_id = ?`, [t.id])).toMatchObject({ folder: "archive" });
    graph.moveMessage(boxEmail, m.id, "inbox");
    await sync();
    expect(await one(`SELECT archived FROM mail_threads WHERE id = ?`, [t.id])).toMatchObject({ archived: 0 });

    // Archive from the CRM: moved to Outlook's Archive folder; unarchive moves it back.
    await request(app).patch(`/api/admin/mail/threads/${t.id}`).set("Cookie", cookies.agent).send({ archived: true }).expect(200);
    expect(graph.inbox(boxEmail).find((x) => x.id === m.id)?.parentFolderId).toBe("archive");
    const arch = await request(app).get(`/api/admin/mail/threads?mailbox_id=${mailboxId}&folder=archived`).set("Cookie", cookies.agent).expect(200);
    expect(arch.body.threads.some((x: any) => x.id === t.id)).toBe(true);
    await sync();
    expect(await one(`SELECT archived FROM mail_threads WHERE id = ?`, [t.id])).toMatchObject({ archived: 1 });
    await request(app).patch(`/api/admin/mail/threads/${t.id}`).set("Cookie", cookies.agent).send({ archived: false }).expect(200);
    expect(graph.inbox(boxEmail).find((x) => x.id === m.id)?.parentFolderId).toBe("inbox");

    // Trash in Outlook: gone from the CRM.
    graph.moveMessage(boxEmail, m.id, "deleteditems");
    await sync();
    expect(await one(`SELECT COUNT(*) n FROM mail_threads WHERE id = ?`, [t.id])).toMatchObject({ n: 0 });
  });

  it("drafts + forward: autosaved drafts mirror to Outlook Drafts; replies keep the quote; forward needs recipients", async () => {
    const src = await one(`SELECT id, thread_id FROM mail_messages WHERE subject = ? AND direction = 'inbound'`, [`${prefix}Alert me`]);
    // Sandbox: drafts stay in the CRM only.
    const d0 = await request(app).put("/api/admin/mail/drafts").set("Cookie", cookies.agent).send({ mailbox_id: mailboxId, mode: "new", to: [em("mia")], subject: "Draft 0", html: "<p>wip</p>" }).expect(200);
    expect(graph.drafts.size).toBe(0);
    await request(app).put("/api/admin/mail/drafts").set("Cookie", cookies.other).send({ id: d0.body.draft.id, mailbox_id: mailboxId, mode: "new", html: "x" }).expect(403);
    const mine = await request(app).get("/api/admin/mail/drafts").set("Cookie", cookies.agent).expect(200);
    expect(mine.body.drafts.map((d: any) => d.id)).toContain(d0.body.draft.id);
    await request(app).delete(`/api/admin/mail/drafts/${d0.body.draft.id}`).set("Cookie", cookies.agent).expect(200);

    // Live (fake Microsoft) for the Outlook-facing paths; restored right after.
    const saved = { VITEST: process.env.VITEST, NOTIFY_SANDBOX: process.env.NOTIFY_SANDBOX };
    process.env.VITEST = "false";
    delete process.env.NOTIFY_SANDBOX;
    try {
      const d1 = await request(app).put("/api/admin/mail/drafts").set("Cookie", cookies.agent).send({ mailbox_id: mailboxId, mode: "new", to: [em("mia")], subject: "Plan", html: "<p>first</p>" }).expect(200);
      expect([...graph.drafts.values()].some((d) => d.mode === "new" && d.subject === "Plan")).toBe(true);
      await request(app).put("/api/admin/mail/drafts").set("Cookie", cookies.agent).send({ id: d1.body.draft.id, mailbox_id: mailboxId, mode: "new", to: [em("mia")], subject: "Plan v2", html: "<p>second</p>" }).expect(200);
      expect([...graph.drafts.values()].filter((d) => d.mode === "new")).toHaveLength(1);
      expect([...graph.drafts.values()][0].subject).toBe("Plan v2");

      const d2 = await request(app).put("/api/admin/mail/drafts").set("Cookie", cookies.agent).send({ mailbox_id: mailboxId, mode: "reply", source_message_id: src.id, html: "<p>reply wip</p>" }).expect(200);
      expect([...graph.drafts.values()].some((d) => d.mode === "createReply" && d.comment?.includes("reply wip"))).toBe(true);
      expect(d2.body.draft.source_thread_id).toBe(src.thread_id);

      // Sending the reply draft: quoted original stays, draft (CRM + Outlook) removed.
      await request(app).post("/api/admin/mail/send").set("Cookie", cookies.agent).send({ mailbox_id: mailboxId, to: [], cc: [], subject: "", html: "<p>Here it is</p>", reply_to_message_id: src.id, draft_id: d2.body.draft.id }).expect(201);
      const reply = graph.sent(boxEmail).slice(-1)[0];
      expect(reply.body.content).toContain("Here it is");
      expect(reply.body.content).toContain("<blockquote>");
      expect([...graph.drafts.values()].some((d) => d.mode === "createReply")).toBe(false);
      expect(await one(`SELECT COUNT(*) n FROM mail_drafts WHERE id = ?`, [d2.body.draft.id])).toMatchObject({ n: 0 });

      // Forward: needs recipients; goes out with the original.
      const noTo = await request(app).post("/api/admin/mail/send").set("Cookie", cookies.agent).send({ mailbox_id: mailboxId, to: [], html: "<p>fyi</p>", forward_message_id: src.id });
      expect(noTo.body.error).toBe("validation.mailRecipients");
      await request(app).post("/api/admin/mail/send").set("Cookie", cookies.agent).send({ mailbox_id: mailboxId, to: [em("partner")], html: "<p>FYI below</p>", forward_message_id: src.id }).expect(201);
      const fw = graph.sent(boxEmail).slice(-1)[0];
      expect(fw.subject).toMatch(/^FW: /);
      expect(fw.toRecipients[0].emailAddress.address).toBe(em("partner"));
      expect(fw.body.content).toContain("<blockquote>");

      await request(app).delete(`/api/admin/mail/drafts/${d1.body.draft.id}`).set("Cookie", cookies.agent).expect(200);
      expect(graph.drafts.size).toBe(0);
    } finally {
      process.env.VITEST = saved.VITEST;
      if (saved.NOTIFY_SANDBOX !== undefined) process.env.NOTIFY_SANDBOX = saved.NOTIFY_SANDBOX;
    }
  });

  it("delete: the conversation moves to Outlook's Deleted Items and leaves the CRM; read-only access can't delete", async () => {
    const m = graph.receive(boxEmail, { from: em("mia"), subject: `${prefix}Delete me` });
    await request(app).post(`/api/admin/mail/mailboxes/${mailboxId}/sync`).set("Cookie", cookies.agent).expect(200);
    const t = await one(`SELECT id FROM mail_threads WHERE subject = ?`, [`${prefix}Delete me`]);
    await request(app).delete(`/api/admin/mail/threads/${t.id}`).set("Cookie", cookies.other).send({ confirm: true }).expect(403);
    await request(app).delete(`/api/admin/mail/threads/${t.id}`).set("Cookie", cookies.agent).send({}).expect(400);
    await request(app).delete(`/api/admin/mail/threads/${t.id}`).set("Cookie", cookies.agent).send({ confirm: true }).expect(200);
    expect(graph.inbox(boxEmail).find((x) => x.id === m.id)?.parentFolderId).toBe("deleteditems");
    expect(await one(`SELECT COUNT(*) n FROM mail_threads WHERE id = ?`, [t.id])).toMatchObject({ n: 0 });
  });

  it("cron needs the secret; disconnect removes CRM copies and Outlook-only appointments", async () => {
    await request(app).get("/api/cron/mail-sync").expect(401);
    const outlookOnly = await one(`SELECT COUNT(*) n FROM appointments WHERE title = ? AND source = 'outlook'`, [`${prefix}Focus`]);
    expect(outlookOnly.n).toBe(1);
    await request(app).delete(`/api/admin/mail/mailboxes/${mailboxId}`).set("Cookie", cookies.admin).send({}).expect(400);
    await request(app).delete(`/api/admin/mail/mailboxes/${mailboxId}`).set("Cookie", cookies.admin).send({ confirm: true }).expect(200);
    expect(await one(`SELECT COUNT(*) n FROM mail_threads WHERE mailbox_id = ?`, [mailboxId])).toMatchObject({ n: 0 });
    expect(await one(`SELECT COUNT(*) n FROM appointments WHERE title = ? AND source = 'outlook'`, [`${prefix}Focus`])).toMatchObject({ n: 0 });
  });
  // Folders and rules: api/mailFolders.integration.test.ts (own file, runs in parallel).
});
