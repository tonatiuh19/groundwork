/**
 * In-memory Microsoft Graph for tests (mail delta, send/reply, calendarView, events).
 * Inject with `__testSetGraphApi(fake.fn)`; tests never reach Microsoft.
 */
type Addr = { emailAddress: { address: string; name?: string } };
type FakeMessage = {
  id: string;
  conversationId: string;
  subject: string;
  bodyPreview: string;
  body: { contentType: "html"; content: string };
  from: Addr;
  toRecipients: Addr[];
  ccRecipients: Addr[];
  receivedDateTime: string;
  isRead: boolean;
  isDraft: false;
  hasAttachments: boolean;
  ver: number;
  removed?: boolean;
  /** inbox | sentitems | archive | deleteditems | a subfolder id */
  parentFolderId?: string;
  gone?: boolean;
  /** Next delta returns only these fields (Graph partial update). */
  partial?: Record<string, unknown>;
};
type FakeEvent = {
  id: string;
  iCalUId: string;
  changeKey: string;
  subject: string;
  body?: { contentType: string; content: string };
  start: { dateTime: string; timeZone: "UTC" };
  end: { dateTime: string; timeZone: "UTC" };
  location?: { displayName: string };
  showAs: string;
  isCancelled: boolean;
  isOnlineMeeting: boolean;
  onlineMeeting?: { joinUrl: string } | null;
  organizer: Addr;
  attendees: Array<Addr & { type?: string }>;
};

export function makeFakeGraph(mailboxes: string[]) {
  let ver = 1;
  let seq = 1;
  const known = new Set(mailboxes.map((m) => m.toLowerCase()));
  const folders = new Map<string, FakeMessage[]>(); // `${mb}|inbox` / `${mb}|sent`
  const events = new Map<string, FakeEvent[]>();
  const customFolders = new Map<string, Array<{ id: string; displayName: string; parentFolderId: string; childFolderCount: number; messages: FakeMessage[] }>>();
  const rules = new Map<string, any[]>();
  const customOf = (mb: string) => {
    const k = mb.toLowerCase();
    if (!customFolders.has(k)) customFolders.set(k, []);
    return customFolders.get(k)!;
  };
  const calls: Array<{ method: string; path: string; body?: any }> = [];
  const box = (mb: string, folder: "inbox" | "sent") => {
    const k = `${mb.toLowerCase()}|${folder}`;
    if (!folders.has(k)) folders.set(k, []);
    return folders.get(k)!;
  };
  const cal = (mb: string) => {
    const k = mb.toLowerCase();
    if (!events.has(k)) events.set(k, []);
    return events.get(k)!;
  };
  const addr = (address: string, name?: string): Addr => ({ emailAddress: { address, name } });

  const api = {
    calls,
    /** Tenant hasn't granted MailboxSettings.ReadWrite: rule calls answer 403. */
    noRulesPermission: false,
    customFolders: customOf,
    rulesOf: (mb: string) => rules.get(mb.toLowerCase()) || [],
    /** Mailboxes whose links come back as /me/… (signed-in accounts). */
    meLinks: new Set<string>(),
    /** Accounts that can't host Teams meetings (personal Microsoft accounts). */
    noTeams: new Set<string>(),
    /** Who /me is during a "Connect with Microsoft" sign-in. */
    me: { id: "", mail: "", displayName: "" },
    addMailbox(email: string) {
      known.add(email.toLowerCase());
    },
    /** Someone emails the mailbox. */
    receive(mb: string, m: { from: string; fromName?: string; subject: string; html?: string; conversationId?: string; at?: Date }) {
      const msg: FakeMessage = {
        id: `msg-${seq++}`,
        conversationId: m.conversationId || `conv-${seq++}`,
        subject: m.subject,
        bodyPreview: (m.html || m.subject).replace(/<[^>]+>/g, " ").slice(0, 200),
        body: { contentType: "html", content: m.html || `<p>${m.subject}</p>` },
        from: addr(m.from, m.fromName),
        toRecipients: [addr(mb)],
        ccRecipients: [],
        receivedDateTime: (m.at || new Date()).toISOString(),
        isRead: false,
        isDraft: false,
        hasAttachments: false,
        ver: ++ver,
      };
      box(mb, "inbox").push(msg);
      return msg;
    },
    /** Outlook changes a message and the next delta only carries the changed fields (e.g. { isRead }). */
    touchPartial(mb: string, id: string, fields: Record<string, unknown>) {
      const m = box(mb, "inbox").find((x) => x.id === id)!;
      Object.assign(m, fields);
      m.partial = fields;
      m.ver = ++ver;
    },
    deleteMessage(mb: string, id: string) {
      const m = box(mb, "inbox").find((x) => x.id === id);
      if (m) {
        m.removed = true;
        m.gone = true;
        m.ver = ++ver;
      }
    },
    /** Someone moves a message in Outlook (archive, a subfolder, the trash, or back to the inbox). */
    moveMessage(mb: string, id: string, folder: string) {
      const m = box(mb, "inbox").find((x) => x.id === id)!;
      m.parentFolderId = folder;
      for (const f of customOf(mb)) {
        for (const c of f.messages) if (c.id === id && !c.removed) Object.assign(c, { removed: true, ver: ++ver });
        if (f.id === folder) {
          f.messages = f.messages.filter((c) => c.id !== id);
          f.messages.push({ ...m, parentFolderId: folder, removed: false, gone: false, partial: undefined, ver: ++ver });
        }
      }
      m.removed = folder !== "inbox";
      m.ver = ++ver;
    },
    drafts: new Map<string, { mb: string; mode: string; source?: string; subject?: string; comment?: string; body?: string }>(),
    addEvent(mb: string, e: { subject: string; start: Date; end: Date; attendees?: string[]; showAs?: string; iCalUId?: string; teams?: boolean; organizer?: string }) {
      const ev: FakeEvent = {
        id: `evt-${seq++}`,
        iCalUId: e.iCalUId || `ical-${seq++}`,
        changeKey: `ck-${seq++}`,
        subject: e.subject,
        body: { contentType: "text", content: "Agenda" },
        start: { dateTime: e.start.toISOString().replace(/\.\d{3}Z$/, ""), timeZone: "UTC" },
        end: { dateTime: e.end.toISOString().replace(/\.\d{3}Z$/, ""), timeZone: "UTC" },
        location: { displayName: "Office" },
        showAs: e.showAs || "busy",
        isCancelled: false,
        isOnlineMeeting: Boolean(e.teams),
        onlineMeeting: e.teams ? { joinUrl: "https://teams.microsoft.com/l/meetup-join/fake" } : null,
        organizer: addr(e.organizer || mb),
        attendees: (e.attendees || []).map((a) => ({ ...addr(a), type: "required" })),
      };
      cal(mb).push(ev);
      return ev;
    },
    moveEvent(mb: string, id: string, start: Date, end: Date) {
      const ev = cal(mb).find((x) => x.id === id)!;
      ev.start = { dateTime: start.toISOString().replace(/\.\d{3}Z$/, ""), timeZone: "UTC" };
      ev.end = { dateTime: end.toISOString().replace(/\.\d{3}Z$/, ""), timeZone: "UTC" };
      ev.changeKey = `ck-${seq++}`;
    },
    removeEvent(mb: string, id: string) {
      events.set(mb.toLowerCase(), cal(mb).filter((x) => x.id !== id));
    },
    events: (mb: string) => cal(mb),
    sent: (mb: string) => box(mb, "sent"),
    inbox: (mb: string) => box(mb, "inbox"),

    fn: async (method: string, path: string, body?: any): Promise<any> => {
      calls.push({ method, path, body });
      const url = new URL(path.startsWith("https://") ? path : `https://graph.fake/v1.0${path}`);
      const parts = url.pathname.replace(/^\/v1\.0/, "").split("/").filter(Boolean).map(decodeURIComponent);
      if (parts[0] === "me" && parts.length === 1) return { ...api.me };
      // /users/{mb}/...
      if (parts[0] !== "users") throw Object.assign(new Error("bad path"), { status: 400 });
      const mb = parts[1].toLowerCase();
      if (!known.has(mb)) throw graphError(404, "ErrorInvalidUser", "The requested user is invalid.");
      const rest = parts.slice(2);
      // Custom folders
      if (rest[0] === "mailFolders" && rest.length === 1 && method === "GET") return { value: customOf(mb).map(({ messages: _m, ...f }) => f) };
      if (rest[0] === "mailFolders" && rest[2] === "childFolders") return { value: [] };
      if (rest[0] === "mailFolders" && rest.length === 1 && method === "POST") {
        if (customOf(mb).some((f) => f.displayName === body.displayName)) throw graphError(409, "ErrorFolderExists", "exists");
        const f = { id: `folder-${seq++}`, displayName: body.displayName, parentFolderId: "root", childFolderCount: 0, messages: [] as FakeMessage[] };
        customOf(mb).push(f);
        return { id: f.id, displayName: f.displayName, parentFolderId: f.parentFolderId };
      }
      if (rest[0] === "mailFolders" && rest.length === 2 && method === "PATCH") {
        const f = customOf(mb).find((x) => x.id === rest[1]);
        if (!f) throw graphError(404, "ErrorItemNotFound", "not found");
        f.displayName = body.displayName;
        return { id: f.id };
      }
      if (rest[0] === "mailFolders" && rest.length === 2 && method === "DELETE") {
        customFolders.set(mb, customOf(mb).filter((x) => x.id !== rest[1]));
        return {};
      }
      // Outlook rules
      if (rest[0] === "mailFolders" && rest[2] === "messageRules") {
        if (api.noRulesPermission) throw graphError(403, "ErrorAccessDenied", "Access is denied");
        const list = rules.get(mb) || [];
        rules.set(mb, list);
        if (method === "GET") return { value: list };
        if (method === "POST") {
          const r = { id: `rule-${seq++}`, ...body };
          list.push(r);
          return r;
        }
        const r = list.find((x) => x.id === rest[3]);
        if (!r) throw graphError(404, "ErrorItemNotFound", "not found");
        if (method === "PATCH") return Object.assign(r, body);
        rules.set(mb, list.filter((x) => x.id !== rest[3]));
        return {};
      }
      if (method === "GET" && rest[0] === "mailFolders" && rest[2] === "messages" && rest[3] === "delta" && customOf(mb).some((f) => f.id === rest[1])) {
        const f = customOf(mb).find((x) => x.id === rest[1])!;
        const since = Number(url.searchParams.get("token") || 0);
        return {
          value: f.messages.filter((m) => m.ver > since).map((m) => (m.removed ? { id: m.id, "@removed": { reason: "deleted" } } : { ...m })),
          "@odata.deltaLink": `https://graph.fake/v1.0/users/${encodeURIComponent(mb)}/mailFolders/${rest[1]}/messages/delta?token=${ver}`,
        };
      }
      // Probes
      if (method === "GET" && rest[0] === "mailFolders" && rest.length === 2) return { id: rest[1] };
      if (method === "GET" && rest[0] === "calendar" && rest.length === 1) return { id: "cal" };
      // Delta
      if (method === "GET" && rest[0] === "mailFolders" && rest[2] === "messages" && rest[3] === "delta") {
        const folder = rest[1] === "inbox" ? "inbox" : "sent";
        const since = Number(url.searchParams.get("token") || 0);
        const list = box(mb, folder).filter((m) => m.ver > since);
        return {
          value: list.map((m) =>
            m.removed ? { id: m.id, "@removed": { reason: "deleted" } } : m.partial ? { id: m.id, ...m.partial } : { ...m },
          ),
          "@odata.deltaLink": api.meLinks.has(mb)
            ? `https://graph.fake/v1.0/me/mailFolders/${rest[1]}/messages/delta?token=${ver}`
            : `https://graph.fake/v1.0/users/${encodeURIComponent(mb)}/mailFolders/${rest[1]}/messages/delta?token=${ver}`,
        };
      }
      // Drafts
      if (method === "POST" && rest[0] === "messages" && rest.length === 1) {
        const id = `draft-${seq++}`;
        api.drafts.set(id, { mb, mode: "new", subject: body.subject, body: body.body?.content });
        return { id };
      }
      if (method === "POST" && rest[0] === "messages" && /^create(Reply|ReplyAll|Forward)$/.test(rest[2] || "")) {
        const id = `draft-${seq++}`;
        api.drafts.set(id, { mb, mode: rest[2], source: rest[1], comment: body.comment });
        return { id };
      }
      if (rest[0] === "messages" && rest[1] && api.drafts.has(rest[1])) {
        if (method === "DELETE") api.drafts.delete(rest[1]);
        if (method === "PATCH") Object.assign(api.drafts.get(rest[1])!, { subject: body.subject, body: body.body?.content });
        return method === "DELETE" ? {} : { id: rest[1] };
      }
      if (method === "GET" && rest[0] === "messages" && rest[1] && !rest[2]) {
        const m = box(mb, "inbox").find((x) => x.id === rest[1]);
        if (!m || m.gone) throw graphError(404, "ErrorItemNotFound", "not found");
        // Full message when the caller selects content (re-fetch after a partial delta item).
        if (/\bbody\b/.test(url.searchParams.get("$select") || "")) {
          const { ver: _v, removed: _r, gone: _g, partial: _p, ...full } = m as any;
          return { ...full, parentFolderId: m.parentFolderId || "inbox" };
        }
        return { id: m.id, parentFolderId: m.parentFolderId || "inbox" };
      }
      if (method === "POST" && rest[0] === "messages" && rest[2] === "move") {
        const m = box(mb, "inbox").find((x) => x.id === rest[1]);
        if (!m) throw graphError(404, "ErrorItemNotFound", "not found");
        api.moveMessage(mb, m.id, body.destinationId);
        return { ...m };
      }
      if (method === "PATCH" && rest[0] === "messages") {
        const m = [...box(mb, "inbox"), ...box(mb, "sent")].find((x) => x.id === rest[1]);
        if (!m) throw graphError(404, "ErrorItemNotFound", "not found");
        Object.assign(m, body, { ver: ++ver });
        return { ...m };
      }
      if (method === "POST" && (rest[0] === "sendMail" || (rest[0] === "messages" && /^(reply|replyAll|forward)$/.test(rest[2] || "")))) {
        const orig = rest[0] === "messages" ? box(mb, "inbox").find((x) => x.id === rest[1]) : null;
        const msg = body.message || {};
        const content = body.comment ?? msg.body?.content ?? "";
        const fw = rest[2] === "forward";
        if (fw && !msg.toRecipients?.length) throw graphError(400, "ErrorInvalidRecipients", "forward needs recipients");
        const sent: FakeMessage = {
          id: `msg-${seq++}`,
          conversationId: orig?.conversationId || `conv-${seq++}`,
          subject: msg.subject || `${fw ? "FW" : "RE"}: ${orig?.subject || ""}`,
          bodyPreview: String(content).replace(/<[^>]+>/g, " ").slice(0, 200),
          body: { contentType: "html", content: orig ? `${content}<hr><blockquote>${orig.body.content}</blockquote>` : content },
          from: addr(mb),
          toRecipients: msg.toRecipients || (orig ? [orig.from] : []),
          ccRecipients: msg.ccRecipients || [],
          receivedDateTime: new Date().toISOString(),
          isRead: true,
          isDraft: false,
          hasAttachments: Boolean(msg.attachments?.length),
          ver: ++ver,
        };
        box(mb, "sent").push(sent);
        return {};
      }
      if (method === "GET" && rest[0] === "messages" && rest[2] === "attachments") return { value: [] };
      // Calendar
      if (method === "GET" && rest[0] === "calendarView") {
        const from = new Date(String(url.searchParams.get("startDateTime")));
        const to = new Date(String(url.searchParams.get("endDateTime")));
        return { value: cal(mb).filter((e) => new Date(`${e.start.dateTime}Z`) < to && new Date(`${e.end.dateTime}Z`) > from).map((e) => ({ ...e })) };
      }
      if (method === "POST" && rest[0] === "events" && rest.length === 1) {
        if (body.isOnlineMeeting && api.noTeams.has(mb)) throw graphError(400, "ErrorInvalidRequest", "Online meetings are not supported for this account");
        const ev: FakeEvent = {
          id: `evt-${seq++}`,
          iCalUId: `ical-${seq++}`,
          changeKey: `ck-${seq++}`,
          subject: body.subject,
          body: body.body,
          start: body.start,
          end: body.end,
          location: body.location,
          showAs: body.showAs || "busy",
          isCancelled: false,
          isOnlineMeeting: Boolean(body.isOnlineMeeting),
          onlineMeeting: body.isOnlineMeeting ? { joinUrl: `https://teams.microsoft.com/l/meetup-join/${seq++}` } : null,
          organizer: addr(mb),
          attendees: body.attendees || [],
        };
        cal(mb).push(ev);
        return { ...ev };
      }
      if (rest[0] === "events" && rest[1]) {
        const ev = cal(mb).find((x) => x.id === rest[1]);
        if (!ev) throw graphError(404, "ErrorItemNotFound", "not found");
        if (method === "PATCH") {
          Object.assign(ev, body, { changeKey: `ck-${seq++}` });
          return { ...ev };
        }
        if (method === "DELETE" || (method === "POST" && rest[2] === "cancel")) {
          events.set(mb, cal(mb).filter((x) => x.id !== ev.id));
          return {};
        }
      }
      throw graphError(400, "BadRequest", `fake graph: unhandled ${method} ${url.pathname}`);
    },
  };
  return api;
}

/** status + code: the API turns these into its GraphError. */
function graphError(status: number, code: string, message: string) {
  return Object.assign(new Error(message), { status, code, __graph: true });
}
