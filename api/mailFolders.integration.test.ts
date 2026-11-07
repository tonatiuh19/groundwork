import crypto from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { __testSetGraphApi, createServer } from "./index";
import { cleanupPortalFixturesByPrefix, createIntegrationTestPool } from "./testDbCleanup";
import { makeFakeGraph } from "./testFakeGraph";

const hasDb = Boolean(process.env.DB_HOST && process.env.DB_USER && process.env.DB_NAME);

/** Mail folders and rules (split from mailSync so the two run in parallel). Fake Graph, never Microsoft. */
describe.runIf(hasDb)("mail folders and rules (Microsoft 365, fake Graph)", () => {
  const app = createServer();
  const db = createIntegrationTestPool();
  const stamp = Date.now();
  const prefix = `gwmailf-${stamp}-`;
  const em = (n: string) => `${prefix}${n}@example.com`;
  const graph = makeFakeGraph([]);
  const cookies: Record<string, string> = {};
  const adminIds: Record<string, number> = {};
  const ins = async (sql: string, p: unknown[]) => Number(((await db.execute(sql, p as any[])) as any)[0].insertId);
  const one = async (sql: string, p: unknown[]) => ((await db.query(sql, p as any[])) as any)[0][0];
  const prevDomains = process.env.MAIL_ALLOWED_DOMAINS;

  beforeAll(async () => {
    process.env.VITEST = "true";
    process.env.MAIL_ALLOWED_DOMAINS = "example.com";
    __testSetGraphApi(graph.fn);
    for (const role of ["admin", "other"]) {
      const id = await ins(`INSERT INTO admins (email, first_name, last_name, role, status) VALUES (?, ?, 'Mail', ?, 'active')`, [em(role), role, role === "admin" ? "admin" : "agent"]);
      adminIds[role] = id;
      const t = crypto.randomBytes(32).toString("hex");
      await db.execute(`INSERT INTO admin_sessions (admin_id, token_hash, expires_at) VALUES (?, ?, NOW() + INTERVAL 1 HOUR)`, [id, crypto.createHash("sha256").update(t).digest("hex")]);
      cookies[role] = `gw_admin_sid=${t}`;
    }
  });

  afterAll(async () => {
    __testSetGraphApi(null);
    if (prevDomains === undefined) delete process.env.MAIL_ALLOWED_DOMAINS;
    else process.env.MAIL_ALLOWED_DOMAINS = prevDomains;
    try {
      await cleanupPortalFixturesByPrefix(db, prefix);
    } finally {
      await db.end();
    }
  });

  const as = () => cookies.admin;
  const threadBySubject = async (subject: string) => one(`SELECT id, archived, filed FROM mail_threads WHERE mailbox_id = ? AND subject = ?`, [folderMailboxId, subject]);
  const sync = () => request(app).post(`/api/admin/mail/mailboxes/${folderMailboxId}/sync`).set("Cookie", as()).expect(200);
  let folderId = 0;

  const folderBox = em("folders");
  let folderMailboxId = 0;
  beforeAll(async () => {
    graph.addMailbox(folderBox);
    folderMailboxId = await ins(`INSERT INTO mailboxes (email, kind, created_by_admin_id) VALUES (?, 'shared', ?)`, [folderBox, adminIds.admin]);
  });

  it("creates a real Outlook folder and refuses duplicates and blanks", async () => {
    const r = await request(app).post("/api/admin/mail/folders").set("Cookie", as()).send({ mailbox_id: folderMailboxId, name: "Permits" }).expect(201);
    folderId = r.body.folders.find((f: { name: string }) => f.name === "Permits").id;
    expect(graph.customFolders(folderBox).map((f) => f.displayName)).toContain("Permits");
    expect((await request(app).post("/api/admin/mail/folders").set("Cookie", as()).send({ mailbox_id: folderMailboxId, name: "Permits" })).status).toBe(409);
    expect((await request(app).post("/api/admin/mail/folders").set("Cookie", as()).send({ mailbox_id: folderMailboxId, name: " " })).status).toBe(400);
  });

  it("files a thread, leaves Inbox, comes back; a filed folder can't be deleted", async () => {
    graph.receive(folderBox, { from: "city@example.com", subject: `${prefix}permit one` });
    await sync();
    const t = await threadBySubject(`${prefix}permit one`);
    await request(app).post(`/api/admin/mail/threads/${t.id}/move`).set("Cookie", as()).send({ folder_id: folderId }).expect(200);
    await sync();
    expect(await threadBySubject(`${prefix}permit one`)).toMatchObject({ filed: 1, archived: 0 });
    const inFolder = await request(app).get("/api/admin/mail/threads").query({ mailbox_id: folderMailboxId, mail_folder_id: folderId }).set("Cookie", as()).expect(200);
    expect(inFolder.body.threads.map((x: { id: number }) => x.id)).toContain(t.id);
    const inbox = await request(app).get("/api/admin/mail/threads").query({ mailbox_id: folderMailboxId, folder: "inbox" }).set("Cookie", as()).expect(200);
    expect(inbox.body.threads.map((x: { id: number }) => x.id)).not.toContain(t.id);
    expect((await request(app).delete(`/api/admin/mail/folders/${folderId}`).query({ mailbox_id: folderMailboxId }).set("Cookie", as())).status).toBe(409);
    await request(app).post(`/api/admin/mail/threads/${t.id}/move`).set("Cookie", as()).send({ folder_id: null }).expect(200);
    await sync();
    expect(await threadBySubject(`${prefix}permit one`)).toMatchObject({ filed: 0, archived: 0 });
  });

  it("a folder already in Outlook shows up, and a person without send rights can't change anything", async () => {
    graph.customFolders(folderBox).push({ id: `folder-outlook-${stamp}`, displayName: "From Outlook", parentFolderId: "root", childFolderCount: 0, messages: [] });
    await db.execute(`UPDATE mailboxes SET mail_folders_synced_at = NULL WHERE id = ?`, [folderMailboxId]);
    await sync();
    const r = await request(app).get("/api/admin/mail/folders").query({ mailbox_id: folderMailboxId }).set("Cookie", as()).expect(200);
    expect(r.body.folders.map((f: { name: string }) => f.name)).toContain("From Outlook");
    expect((await request(app).post("/api/admin/mail/folders").set("Cookie", cookies.other).send({ mailbox_id: folderMailboxId, name: "Nope" })).status).toBe(403);
  });

  it("CRM rule files new matching mail; other mail stays", async () => {
    await request(app).post("/api/admin/mail/rules").set("Cookie", as()).send({ mailbox_id: folderMailboxId, engine: "crm", name: "Permits", subject: "permit two", folder_id: folderId, mark_read: true }).expect(201);
    graph.receive(folderBox, { from: "city@example.com", subject: `${prefix}permit two` });
    graph.receive(folderBox, { from: "city@example.com", subject: `${prefix}unrelated` });
    await sync();
    expect(await threadBySubject(`${prefix}permit two`)).toMatchObject({ filed: 1 });
    expect(await threadBySubject(`${prefix}unrelated`)).toMatchObject({ filed: 0 });
    expect((await request(app).post("/api/admin/mail/rules").set("Cookie", as()).send({ mailbox_id: folderMailboxId, engine: "crm", name: "Empty", folder_id: folderId })).status).toBe(400);
  });

  it("Outlook rule is created in Outlook; missing permission gets a clear answer, not a crash", async () => {
    await request(app).post("/api/admin/mail/rules").set("Cookie", as()).send({ mailbox_id: folderMailboxId, engine: "outlook", name: "City", from: "city@", folder_id: folderId }).expect(201);
    const rule = graph.rulesOf(folderBox)[0];
    expect(rule.conditions.senderContains).toEqual(["city@"]);
    const list = await request(app).get("/api/admin/mail/rules").query({ mailbox_id: folderMailboxId }).set("Cookie", as()).expect(200);
    expect(list.body.rules.find((r: { engine: string }) => r.engine === "outlook")).toMatchObject({ name: "City", folder_id: folderId, active: true });
    await request(app).delete(`/api/admin/mail/rules/outlook/${rule.id}`).query({ mailbox_id: folderMailboxId }).set("Cookie", as()).expect(200);
    expect(graph.rulesOf(folderBox)).toEqual([]);
    graph.noRulesPermission = true;
    const denied = await request(app).get("/api/admin/mail/rules").query({ mailbox_id: folderMailboxId }).set("Cookie", as()).expect(200);
    expect(denied.body.outlook_error).toBe("errors.mailRulesPermission");
    expect((await request(app).post("/api/admin/mail/rules").set("Cookie", as()).send({ mailbox_id: folderMailboxId, engine: "outlook", name: "x", from: "a", folder_id: folderId })).body.error).toBe("errors.mailRulesPermission");
    graph.noRulesPermission = false;
  });
});
