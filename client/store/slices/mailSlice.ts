import { createSlice, isAnyOf } from "@reduxjs/toolkit";
import type {
  LastEmail,
  MailAttachment,
  Mailbox,
  MailboxSaveBody,
  ConversationTemplate,
  MailDraft,
  MailDraftSaveBody,
  MailMessage,
  MailSendBody,
  MailCustomFolder,
  MailRule,
  MailRuleEngine,
  MailStatus,
  MailThread,
  MailThreadsQuery,
} from "@shared/api";
import { api } from "@/lib/api";
import { createApiThunk } from "@/lib/portalThunk";

/** Mail section: Microsoft 365 mailboxes connected to the CRM (threads, reading, sending, mailbox admin). */

export const fetchMailStatus = createApiThunk<MailStatus, void>(
  "mail/status",
  "admin",
  async () => (await api.get("/admin/mail/status")).data,
);

export const fetchMailThreads = createApiThunk<{ threads: MailThread[]; next_cursor: string | null }, MailThreadsQuery>(
  "mail/threads",
  "admin",
  async (q) =>
    (
      await api.get("/admin/mail/threads", {
        params: {
          mailbox_id: q.mailbox_id || undefined,
          folder: q.folder,
          mail_folder_id: q.mail_folder_id || undefined,
          unread: q.unread ? "1" : undefined,
          linked: q.linked ? "1" : undefined,
          q: q.q || undefined,
          cursor: q.cursor || undefined,
          match_kind: q.match_kind,
          match_id: q.match_id,
        },
      })
    ).data,
);

export const fetchMailThread = createApiThunk<{ thread: MailThread; messages: MailMessage[]; can_send: boolean }, number>(
  "mail/thread",
  "admin",
  async (id) => (await api.get(`/admin/mail/threads/${id}`)).data,
);

export const updateMailThread = createApiThunk<{ thread: MailThread }, { id: number; archived?: boolean; unread?: boolean }>(
  "mail/updateThread",
  "admin",
  async ({ id, ...body }) => (await api.patch(`/admin/mail/threads/${id}`, body)).data,
);

type FoldersPayload = { folders: MailCustomFolder[] };
export const fetchMailFolders = createApiThunk<FoldersPayload, number>("mail/folders", "admin", async (mailbox_id) => (await api.get("/admin/mail/folders", { params: { mailbox_id } })).data);
export const createMailFolder = createApiThunk<FoldersPayload, { mailbox_id: number; name: string }>("mail/folderCreate", "admin", async (body) => (await api.post("/admin/mail/folders", body)).data);
export const renameMailFolder = createApiThunk<FoldersPayload, { id: number; mailbox_id: number; name: string }>("mail/folderRename", "admin", async ({ id, ...body }) => (await api.patch(`/admin/mail/folders/${id}`, body)).data);
export const deleteMailFolder = createApiThunk<FoldersPayload, { id: number; mailbox_id: number }>("mail/folderDelete", "admin", async ({ id, mailbox_id }) => (await api.delete(`/admin/mail/folders/${id}`, { params: { mailbox_id } })).data);
export const moveMailThread = createApiThunk<{ thread: MailThread }, { id: number; folder_id: number | null }>("mail/moveThread", "admin", async ({ id, folder_id }) => (await api.post(`/admin/mail/threads/${id}/move`, { folder_id })).data);
export const fetchMailRules = createApiThunk<{ rules: MailRule[]; outlook_error: string | null }, number>("mail/rules", "admin", async (mailbox_id) => (await api.get("/admin/mail/rules", { params: { mailbox_id } })).data);
export const createMailRule = createApiThunk<{ ok: true }, { mailbox_id: number; engine: MailRuleEngine; name: string; from?: string; subject?: string; person_kind?: string; folder_id: number; mark_read: boolean }>(
  "mail/ruleCreate",
  "admin",
  async (body) => (await api.post("/admin/mail/rules", body)).data,
);
export const toggleMailRule = createApiThunk<{ ok: true }, { engine: MailRuleEngine; id: string; mailbox_id: number; active: boolean }>("mail/ruleToggle", "admin", async ({ engine, id, ...body }) => (await api.patch(`/admin/mail/rules/${engine}/${encodeURIComponent(id)}`, body)).data);
export const deleteMailRule = createApiThunk<{ ok: true }, { engine: MailRuleEngine; id: string; mailbox_id: number }>("mail/ruleDelete", "admin", async ({ engine, id, mailbox_id }) => (await api.delete(`/admin/mail/rules/${engine}/${encodeURIComponent(id)}`, { params: { mailbox_id } })).data);

export const sendMail = createApiThunk<{ ok: true; dry_run: boolean; thread_id: number | null }, MailSendBody>(
  "mail/send",
  "admin",
  async (body) => (await api.post("/admin/mail/send", body)).data,
);

/** Opening / refreshing Mail: sync my mailboxes now (skips ones synced in the last 2 minutes). */
export const syncVisibleMailboxes = createApiThunk<{ ok: true; synced: number }, void>(
  "mail/syncVisible",
  "admin",
  async () => (await api.post("/admin/mail/sync-visible")).data,
);

export const syncMailboxNow = createApiThunk<{ result: { errors?: string[] } }, number>(
  "mail/sync",
  "admin",
  async (id) => (await api.post(`/admin/mail/mailboxes/${id}/sync`)).data,
);

export const fetchMailAttachments = createApiThunk<{ attachments: MailAttachment[] }, number>(
  "mail/attachments",
  "admin",
  async (messageId) => (await api.get(`/admin/mail/messages/${messageId}/attachments`)).data,
);

export const fetchManagedMailboxes = createApiThunk<{ mailboxes: Mailbox[] }, void>(
  "mail/manageList",
  "admin",
  async () => (await api.get("/admin/mail/mailboxes")).data,
);

export const saveMailbox = createApiThunk<{ mailboxes: Mailbox[] }, { id: number | null; body: MailboxSaveBody }>(
  "mail/saveMailbox",
  "admin",
  async ({ id, body }) => (id ? await api.patch(`/admin/mail/mailboxes/${id}`, body) : await api.post("/admin/mail/mailboxes", body)).data,
);

export const deleteMailbox = createApiThunk<{ mailboxes: Mailbox[] }, number>(
  "mail/deleteMailbox",
  "admin",
  async (id) => (await api.delete(`/admin/mail/mailboxes/${id}`, { data: { confirm: true } })).data,
);

export const fetchMailDrafts = createApiThunk<{ drafts: MailDraft[] }, void>(
  "mail/drafts",
  "admin",
  async () => (await api.get("/admin/mail/drafts")).data,
);

/** Autosave (silent: no global busy state). */
export const saveMailDraft = createApiThunk<{ draft: MailDraft }, MailDraftSaveBody>(
  "mail/saveDraft",
  "admin",
  async (body) => (await api.put("/admin/mail/drafts", body)).data,
);

export const discardMailDraft = createApiThunk<{ ok: true }, number>(
  "mail/discardDraft",
  "admin",
  async (id) => (await api.delete(`/admin/mail/drafts/${id}`)).data,
);

/** Email templates (Templates page → Email) for the composer. */
export const fetchMailTemplates = createApiThunk<{ templates: ConversationTemplate[] }, void>(
  "mail/templates",
  "admin",
  async () => (await api.get("/admin/conversation-templates", { params: { channel: "email" } })).data,
);

/** Delete a thread: moved to Outlook's Deleted Items and removed from the CRM. */
export const deleteMailThread = createApiThunk<{ ok: true }, number>(
  "mail/deleteThread",
  "admin",
  async (id) => (await api.delete(`/admin/mail/threads/${id}`, { data: { confirm: true } })).data,
);

/** Record pages: latest email with one address. */
export const fetchLastEmail = createApiThunk<{ last_email: LastEmail | null }, string>(
  "mail/lastEmail",
  "admin",
  async (email) => (await api.get("/admin/mail/last-email", { params: { email } })).data,
);

type State = {
  status: MailStatus | null;
  statusLoading: boolean;
  statusError: string | null;
  threads: MailThread[];
  nextCursor: string | null;
  threadsLoading: boolean;
  threadsError: string | null;
  /** Key of the query the list belongs to (late responses for an old query are dropped). */
  queryKey: string;
  open: { thread: MailThread; messages: MailMessage[]; can_send: boolean } | null;
  openLoading: boolean;
  openError: string | null;
  attachments: Record<number, MailAttachment[] | "loading" | "error">;
  sending: boolean;
  sendError: string | null;
  syncing: number | null;
  managed: Mailbox[];
  managedLoading: boolean;
  savingMailbox: boolean;
  mailboxError: string | null;
  lastEmail: Record<string, LastEmail | null>;
  drafts: MailDraft[];
  draftsLoading: boolean;
  templates: ConversationTemplate[];
  folders: Record<number, MailCustomFolder[]>;
  rules: MailRule[];
  rulesOutlookError: string | null;
  organizeBusy: boolean;
  organizeError: string | null;
};

const initialState: State = {
  status: null,
  statusLoading: false,
  statusError: null,
  threads: [],
  nextCursor: null,
  threadsLoading: false,
  threadsError: null,
  queryKey: "",
  open: null,
  openLoading: false,
  openError: null,
  attachments: {},
  sending: false,
  sendError: null,
  syncing: null,
  managed: [],
  managedLoading: false,
  savingMailbox: false,
  mailboxError: null,
  lastEmail: {},
  drafts: [],
  draftsLoading: false,
  templates: [],
  folders: {},
  rules: [],
  rulesOutlookError: null,
  organizeBusy: false,
  organizeError: null,
};

export const mailQueryKey = (q: MailThreadsQuery) =>
  JSON.stringify([q.mailbox_id || 0, q.folder, q.mail_folder_id || 0, Boolean(q.unread), Boolean(q.linked), q.q || "", q.match_kind || "", q.match_id || 0]);

const patchThread = (s: State, t: MailThread) => {
  const i = s.threads.findIndex((x) => x.id === t.id);
  if (i >= 0) s.threads[i] = t;
  if (s.open?.thread.id === t.id) s.open.thread = t;
};

const slice = createSlice({
  name: "mail",
  initialState,
  reducers: {
    closeMailThread(s) {
      s.open = null;
      s.openError = null;
    },
    clearMailErrors(s) {
      s.sendError = null;
      s.mailboxError = null;
    },
  },
  extraReducers: (b) => {
    b.addCase(fetchMailRules.fulfilled, (s, a) => {
      s.rules = a.payload.rules;
      s.rulesOutlookError = a.payload.outlook_error;
    }).addCase(moveMailThread.fulfilled, (s, a) => {
      patchThread(s, a.payload.thread);
    });
    b.addCase(fetchMailStatus.pending, (s) => {
      s.statusLoading = true;
      s.statusError = null;
    })
      .addCase(fetchMailStatus.fulfilled, (s, a) => {
        s.statusLoading = false;
        s.status = a.payload;
      })
      .addCase(fetchMailStatus.rejected, (s, a) => {
        s.statusLoading = false;
        s.statusError = a.payload || "errors.server";
      })
      .addCase(fetchMailThreads.pending, (s, a) => {
        const key = mailQueryKey(a.meta.arg);
        if (!a.meta.arg.cursor && key !== s.queryKey) s.threads = [];
        s.queryKey = key;
        s.threadsLoading = true;
        s.threadsError = null;
      })
      .addCase(fetchMailThreads.fulfilled, (s, a) => {
        if (mailQueryKey(a.meta.arg) !== s.queryKey) return;
        s.threadsLoading = false;
        s.threads = a.meta.arg.cursor ? [...s.threads, ...a.payload.threads.filter((t) => !s.threads.some((x) => x.id === t.id))] : a.payload.threads;
        s.nextCursor = a.payload.next_cursor;
      })
      .addCase(fetchMailThreads.rejected, (s, a) => {
        if (mailQueryKey(a.meta.arg) !== s.queryKey) return;
        s.threadsLoading = false;
        s.threadsError = a.payload || "errors.server";
      })
      .addCase(fetchMailThread.pending, (s, a) => {
        s.openLoading = true;
        s.openError = null;
        if (s.open?.thread.id !== a.meta.arg) s.open = null;
      })
      .addCase(fetchMailThread.fulfilled, (s, a) => {
        s.openLoading = false;
        s.open = a.payload;
        // Opening reads it: drop the unread badge locally too.
        const before = s.threads.find((t) => t.id === a.meta.arg)?.unread_count ?? 0;
        patchThread(s, a.payload.thread);
        if (before && s.status) {
          const mb = s.status.mailboxes.find((m) => m.id === a.payload.thread.mailbox_id);
          if (mb) mb.unread = Math.max(0, mb.unread - before);
        }
      })
      .addCase(fetchMailThread.rejected, (s, a) => {
        s.openLoading = false;
        s.openError = a.payload || "errors.server";
      })
      .addCase(updateMailThread.fulfilled, (s, a) => {
        if (a.meta.arg.archived !== undefined) {
          s.threads = s.threads.filter((t) => t.id !== a.payload.thread.id);
          if (s.open?.thread.id === a.payload.thread.id) s.open.thread = a.payload.thread;
        } else patchThread(s, a.payload.thread);
      })
      .addCase(fetchMailAttachments.pending, (s, a) => {
        s.attachments[a.meta.arg] = "loading";
      })
      .addCase(fetchMailAttachments.fulfilled, (s, a) => {
        s.attachments[a.meta.arg] = a.payload.attachments;
      })
      .addCase(fetchMailAttachments.rejected, (s, a) => {
        s.attachments[a.meta.arg] = "error";
      })
      .addCase(sendMail.pending, (s) => {
        s.sending = true;
        s.sendError = null;
      })
      .addCase(sendMail.fulfilled, (s, a) => {
        s.sending = false;
        if (a.meta.arg.draft_id) s.drafts = s.drafts.filter((d) => d.id !== a.meta.arg.draft_id);
      })
      .addCase(sendMail.rejected, (s, a) => {
        s.sending = false;
        s.sendError = a.payload || "errors.server";
      })
      .addCase(syncMailboxNow.pending, (s, a) => {
        s.syncing = a.meta.arg;
      })
      .addCase(syncMailboxNow.fulfilled, (s) => {
        s.syncing = null;
      })
      .addCase(syncMailboxNow.rejected, (s) => {
        s.syncing = null;
      })
      .addCase(fetchManagedMailboxes.pending, (s) => {
        s.managedLoading = true;
      })
      .addCase(fetchManagedMailboxes.fulfilled, (s, a) => {
        s.managedLoading = false;
        s.managed = a.payload.mailboxes;
      })
      .addCase(fetchManagedMailboxes.rejected, (s, a) => {
        s.managedLoading = false;
        s.mailboxError = a.payload || "errors.server";
      })
      .addCase(saveMailbox.pending, (s) => {
        s.savingMailbox = true;
        s.mailboxError = null;
      })
      .addCase(saveMailbox.fulfilled, (s, a) => {
        s.savingMailbox = false;
        s.managed = a.payload.mailboxes;
      })
      .addCase(saveMailbox.rejected, (s, a) => {
        s.savingMailbox = false;
        s.mailboxError = a.payload || "errors.server";
      })
      .addCase(deleteMailbox.pending, (s) => {
        s.savingMailbox = true;
        s.mailboxError = null;
      })
      .addCase(deleteMailbox.fulfilled, (s, a) => {
        s.savingMailbox = false;
        s.managed = a.payload.mailboxes;
      })
      .addCase(deleteMailbox.rejected, (s, a) => {
        s.savingMailbox = false;
        s.mailboxError = a.payload || "errors.server";
      })
      .addCase(fetchMailTemplates.fulfilled, (s, a) => {
        s.templates = a.payload.templates;
      })
      .addCase(deleteMailThread.fulfilled, (s, a) => {
        s.threads = s.threads.filter((t) => t.id !== a.meta.arg);
        if (s.open?.thread.id === a.meta.arg) s.open = null;
      })
      .addCase(fetchMailDrafts.pending, (s) => {
        s.draftsLoading = true;
      })
      .addCase(fetchMailDrafts.fulfilled, (s, a) => {
        s.draftsLoading = false;
        s.drafts = a.payload.drafts;
      })
      .addCase(fetchMailDrafts.rejected, (s) => {
        s.draftsLoading = false;
      })
      .addCase(saveMailDraft.fulfilled, (s, a) => {
        s.drafts = [a.payload.draft, ...s.drafts.filter((d) => d.id !== a.payload.draft.id)];
      })
      .addCase(discardMailDraft.fulfilled, (s, a) => {
        s.drafts = s.drafts.filter((d) => d.id !== a.meta.arg);
      })
      .addCase(fetchLastEmail.fulfilled, (s, a) => {
        s.lastEmail[a.meta.arg] = a.payload.last_email;
      });
    const organizeWrites = [createMailFolder, renameMailFolder, deleteMailFolder, createMailRule, toggleMailRule, deleteMailRule] as const;
    b.addMatcher(isAnyOf(fetchMailFolders.fulfilled, createMailFolder.fulfilled, renameMailFolder.fulfilled, deleteMailFolder.fulfilled), (s, a) => {
      const arg = a.meta.arg as number | { mailbox_id: number };
      s.folders[typeof arg === "number" ? arg : arg.mailbox_id] = a.payload.folders;
    })
      .addMatcher(isAnyOf(...organizeWrites.map((th) => th.pending)), (s) => {
        s.organizeBusy = true;
        s.organizeError = null;
      })
      .addMatcher(isAnyOf(...organizeWrites.map((th) => th.fulfilled)), (s) => {
        s.organizeBusy = false;
      })
      .addMatcher(isAnyOf(...organizeWrites.map((th) => th.rejected)), (s, a) => {
        s.organizeBusy = false;
        s.organizeError = (a.payload as string) || "errors.server";
      });
  },
});

export const { closeMailThread, clearMailErrors } = slice.actions;
export default slice.reducer;
