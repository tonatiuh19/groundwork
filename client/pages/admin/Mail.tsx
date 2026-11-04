import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Archive,
  FolderCog,
  ArchiveRestore,
  ArrowLeft,
  ChevronDown,
  Download,
  FileEdit,
  Forward,
  Inbox,
  Mail as MailIcon,
  MailOpen,
  Paperclip,
  PenSquare,
  RefreshCw,
  Reply,
  ReplyAll,
  Search,
  Send,
  Settings2,
  Trash2,
  UserRound,
} from "lucide-react";
import type { MailAttachment, MailFolder, MailMessage, MailThread, MailThreadsQuery } from "@shared/api";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  fetchMailFolders,
  moveMailThread, syncVisibleMailboxes,
  closeMailThread,
  deleteMailThread,
  fetchMailAttachments,
  fetchMailDrafts,
  fetchMailStatus,
  fetchMailThread,
  fetchMailThreads,
  syncMailboxNow,
  updateMailThread,
} from "@/store/slices/mailSlice";
import { BusyButton, ErrorNote, PageHeader } from "@/components/portal/kit";
import PageMeta from "@/components/PageMeta";
import { Modal } from "@/components/portal/Modal";
import { useDebounce } from "@/hooks/useDebounce";
import EmailFrame from "@/components/mail/EmailFrame";
import MailComposer, { type ComposeMode } from "@/components/mail/MailComposer";
import MailboxesDrawer from "@/components/mail/MailboxesDrawer";
import MailOrganizeModal from "@/components/mail/MailOrganizeModal";
import { formatBytes, formatMailFull, formatMailTime, formatRelative, initialsOf } from "@/components/mail/mailFormat";
import { cn } from "@/lib/cn";
import { personRecordPath } from "@/lib/recordPath";

type PageFolder = MailFolder | "drafts";
const FOLDERS: Array<{ v: PageFolder; icon: typeof Inbox }> = [
  { v: "inbox", icon: Inbox },
  { v: "sent", icon: Send },
  { v: "drafts", icon: FileEdit },
  { v: "all", icon: MailIcon },
  { v: "archived", icon: Archive },
];

const recordPath = (m: NonNullable<MailThread["match"]>) => personRecordPath(m.kind, m.id, m.email);

/**
 * Mail: Microsoft 365 mailboxes connected to the CRM. Mailbox + folder + search on
 * top, thread list and reader side by side (one pane at a time on phones).
 */
export default function AdminMail() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const dispatch = useAppDispatch();
  const [params, setParams] = useSearchParams();
  const { status, statusLoading, statusError, threads, nextCursor, threadsLoading, threadsError, open, openLoading, openError, attachments, syncing, drafts, draftsLoading } =
    useAppSelector((s) => s.mail);

  const mailboxId = Number(params.get("mailbox")) || null;
  const customFolderId = Number(params.get("mfolder")) || null;
  const pageFolder = (params.get("folder") as PageFolder) || "inbox";
  const showDrafts = pageFolder === "drafts" && !customFolderId;
  const folder: MailFolder = showDrafts ? "all" : (pageFolder as MailFolder);
  const threadId = Number(params.get("thread")) || null;
  const openSubject = threadId && open?.thread.id === threadId ? open.thread.subject || t("mail.noSubject") : null;
  const [unread, setUnread] = useState(false);
  const [linked, setLinked] = useState(false);
  const [q, setQ] = useState("");
  const debouncedQ = useDebounce(q.trim(), 300);
  const [compose, setCompose] = useState<ComposeMode | null>(null);
  const [manage, setManage] = useState(false);
  const [organize, setOrganize] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const readerRef = useRef<HTMLDivElement>(null);

  const setParam = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(params);
      for (const [k, v] of Object.entries(patch)) v == null ? next.delete(k) : next.set(k, v);
      setParams(next, { replace: !("thread" in patch) });
    },
    [params, setParams],
  );

  const query: MailThreadsQuery = useMemo(() => ({ mailbox_id: mailboxId, folder, mail_folder_id: customFolderId, unread, linked, q: debouncedQ }), [mailboxId, folder, customFolderId, unread, linked, debouncedQ]);
  const openMailboxId = threadId && open?.thread.id === threadId ? open.thread.mailbox_id : null;
  const customFolders = useAppSelector((st) => (mailboxId ? st.mail.folders[mailboxId] : undefined));
  const openFolders = useAppSelector((st) => (openMailboxId ? st.mail.folders[openMailboxId] : undefined));
  const organizeMailbox = status?.mailboxes.find((m) => m.id === mailboxId);
  useEffect(() => {
    if (mailboxId) void dispatch(fetchMailFolders(mailboxId));
  }, [dispatch, mailboxId]);
  useEffect(() => {
    if (openMailboxId) void dispatch(fetchMailFolders(openMailboxId));
  }, [dispatch, openMailboxId]);
  const loadList = useCallback(() => void dispatch(fetchMailThreads(query)), [dispatch, query]);
  const loadListRef = useRef(loadList);
  loadListRef.current = loadList;

  useEffect(() => {
    void dispatch(fetchMailStatus());
    // The background sync is hourly: opening or refreshing Mail pulls new mail now, then reloads.
    void dispatch(syncVisibleMailboxes()).then((r) => {
      if (syncVisibleMailboxes.fulfilled.match(r) && r.payload.synced > 0) {
        void dispatch(fetchMailStatus());
        loadListRef.current();
      }
    });
  }, [dispatch]);
  useEffect(() => {
    if (status?.mailboxes.length && !showDrafts) loadList();
  }, [loadList, status?.mailboxes.length, showDrafts]);
  useEffect(() => {
    if (status?.mailboxes.length) void dispatch(fetchMailDrafts());
  }, [dispatch, status?.mailboxes.length]);
  // New mail every minute while the page is open.
  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        loadList();
        void dispatch(fetchMailStatus());
      }
    }, 60_000);
    return () => window.clearInterval(id);
  }, [loadList, dispatch]);
  useEffect(() => {
    if (threadId) void dispatch(fetchMailThread(threadId));
    else dispatch(closeMailThread());
  }, [threadId, dispatch]);
  useEffect(() => {
    readerRef.current?.scrollTo({ top: 0 });
  }, [threadId]);

  // Deep link from record pages: /admin/mail?compose=1&to=a@b.com&subject=…
  useEffect(() => {
    if (params.get("compose") !== "1" || !status) return;
    setCompose({ kind: "new", to: (params.get("to") || "").split(",").filter(Boolean), subject: params.get("subject") || "", mailboxId });
    setParam({ compose: null, to: null, subject: null });
  }, [params, status, mailboxId, setParam]);

  // Back from Microsoft sign-in.
  const [connectError, setConnectError] = useState<string | null>(null);
  useEffect(() => {
    const ok = params.get("connected");
    const err = params.get("connect_error");
    if (!ok && !err) return;
    if (ok) {
      setToast(t("mail.connected"));
      void dispatch(fetchMailStatus());
    }
    if (err) setConnectError(err);
    setParam({ connected: null, connect_error: null, mailbox: ok || params.get("mailbox") });
  }, [params, dispatch, setParam, t]);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(id);
  }, [toast]);

  const mailboxes = status?.mailboxes ?? [];
  const current = mailboxes.find((m) => m.id === mailboxId) || null;
  const totalUnread = mailboxes.reduce((n, m) => n + m.unread, 0);
  const lastSync = mailboxes
    .map((m) => m.last_mail_sync_at)
    .filter(Boolean)
    .sort()
    .pop();
  const broken = mailboxes.filter((m) => m.last_error || m.status === "error");
  const myId = useAppSelector((s) => s.portalAuth.admin.user?.id);
  const reconnectMine = broken.some((m) => m.auth_mode === "delegated" && m.owner_admin_id === myId);

  const syncNow = async () => {
    const ids = current ? [current.id] : mailboxes.filter((m) => m.status !== "paused").map((m) => m.id);
    for (const id of ids) await dispatch(syncMailboxNow(id));
    void dispatch(fetchMailStatus());
    loadList();
    if (threadId) void dispatch(fetchMailThread(threadId));
  };

  const openThread = (t: MailThread) => setParam({ thread: String(t.id) });
  const back = () => setParam({ thread: null });
  const lastMessage = open?.messages[open.messages.length - 1] ?? null;

  const connectMicrosoft = () => window.location.assign("/api/admin/mail/oauth/start");
  const connectButton = (big = false) =>
    status?.oauth_enabled && !status.has_own_mailbox ? (
      <button type="button" className={cn("pf-btn gw-ms-connect", big ? "" : "pf-btn--sm")} onClick={connectMicrosoft}>
        <span className="gw-ms-logo" aria-hidden>
          <i />
          <i />
          <i />
          <i />
        </span>
        {t("mail.connectMicrosoft")}
      </button>
    ) : null;

  if (status && !mailboxes.length) {
    return (
      <div className="pf-page gw-mail-page">
        <PageHeader titleKey="mail.title" leadKey="mail.subtitle" />
        <div className="gw-mail-empty-hero">
          <span className="gw-mail-empty-hero__icon" aria-hidden>
            <MailIcon size={28} />
          </span>
          <h2>{t("mail.noMailboxTitle")}</h2>
          <p>{status.can_manage ? t("mail.noMailboxAdmin") : status.oauth_enabled ? t("mail.noMailboxConnect") : t("mail.noMailboxStaff")}</p>
          <ErrorNote error={connectError} />
          {connectButton(true)}
          {status.oauth_enabled && !status.has_own_mailbox ? <p className="pf-hint">{t("mail.connectHint")}</p> : null}
          {status.can_manage ? (
            <button type="button" className="pf-btn pf-btn--gold" onClick={() => setManage(true)}>
              <Settings2 size={15} aria-hidden /> {t("mail.manage.title")}
            </button>
          ) : null}
        </div>
        <MailboxesDrawer open={manage} onClose={() => setManage(false)} configured={status.configured} domains={status.allowed_domains} />
      </div>
    );
  }

  return (
    <div className={cn("pf-page gw-mail-page", threadId && "has-thread")}>
      <PageMeta title={openSubject ? `${openSubject} · ${t("mail.title")}` : t("mail.title")} description={t("mail.subtitle")} noIndex />
      <div className="gw-mail-top">
        <div className="gw-mail-top__title">
          <h1>{t("mail.title")}</h1>
          <span className="gw-mail-top__sync">
            {lastSync ? t("mail.syncedAgo", { when: formatRelative(lastSync, lang) }) : t("mail.notSyncedYet")}
          </span>
        </div>
        <div className="gw-mail-top__actions">
          {connectButton()}
          <button type="button" className="pf-btn pf-btn--sm" onClick={() => void syncNow()} disabled={syncing != null} aria-label={t("mail.syncNow")}>
            <RefreshCw size={14} className={syncing != null ? "spin" : undefined} aria-hidden /> <span className="gw-hide-sm">{t("mail.syncNow")}</span>
          </button>
          {status?.can_manage ? (
            <button type="button" className="pf-btn pf-btn--sm" onClick={() => setManage(true)} aria-label={t("mail.manage.title")}>
              <Settings2 size={14} aria-hidden /> <span className="gw-hide-sm">{t("mail.mailboxes")}</span>
            </button>
          ) : null}
          <button type="button" className="pf-btn pf-btn--sm pf-btn--gold" onClick={() => setCompose({ kind: "new", mailboxId })}>
            <PenSquare size={14} aria-hidden /> {t("mail.compose")}
          </button>
        </div>
      </div>

      <ErrorNote error={statusError} />
      <ErrorNote error={connectError} />
      {broken.length ? (
        <div className="gw-mail-alert" role="status">
          <strong>{t("mail.syncProblem", { count: broken.length })}</strong> {broken.map((m) => m.email).join(", ")}
          {reconnectMine ? (
            <button type="button" className="gw-linkbtn" onClick={() => window.location.assign("/api/admin/mail/oauth/start")}>
              {t("mail.reconnect")}
            </button>
          ) : null}
          {status?.can_manage ? (
            <button type="button" className="gw-linkbtn" onClick={() => setManage(true)}>
              {t("mail.review")}
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="gw-mail-bar">
        <label className="gw-mail-select">
          <span className="sr-only">{t("mail.mailbox")}</span>
          <select value={mailboxId ?? ""} onChange={(e) => setParam({ mailbox: e.target.value || null, mfolder: null, thread: null })}>
            <option value="">{t("mail.allMailboxes", { count: totalUnread })}</option>
            {mailboxes.map((m) => (
              <option key={m.id} value={m.id}>
                {(m.display_name || m.email) + (m.unread ? ` (${m.unread})` : "")}
              </option>
            ))}
          </select>
          <ChevronDown size={14} aria-hidden />
        </label>
        <div className="gw-mail-folders" role="tablist" aria-label={t("mail.folders")}>
          {FOLDERS.map(({ v, icon: Icon }) => (
            <button key={v} type="button" role="tab" aria-selected={!customFolderId && pageFolder === v} className={cn("gw-mail-folder", !customFolderId && pageFolder === v && "is-on")} onClick={() => setParam({ folder: v === "inbox" ? null : v, mfolder: null, thread: null })}>
              <Icon size={14} aria-hidden /> {t(`mail.folder.${v}`)}
              {v === "drafts" && drafts.length ? <span className="gw-mail-folder__count">{drafts.length}</span> : null}
            </button>
          ))}
        </div>
        {mailboxId ? (
          <div className="gw-mail-custom">
            <label className="gw-mail-select">
              <span className="sr-only">{t("mail.organize.folders")}</span>
              <select value={customFolderId ?? ""} onChange={(e) => setParam({ mfolder: e.target.value || null, thread: null })}>
                <option value="">{t("mail.organize.myFolders")}</option>
                {(customFolders || []).map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name + (f.unread ? ` (${f.unread})` : "")}
                  </option>
                ))}
              </select>
              <ChevronDown size={14} aria-hidden />
            </label>
            <button type="button" className="pf-btn pf-btn--sm" onClick={() => setOrganize(true)}>
              <FolderCog size={14} aria-hidden /> {t("mail.organize.open")}
            </button>
          </div>
        ) : null}
        <div className="gw-mail-search">
          <Search size={15} aria-hidden />
          <input type="search" value={q} placeholder={t("mail.searchPlaceholder")} aria-label={t("mail.searchPlaceholder")} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="gw-mail-chips">
          <button type="button" className={cn("gw-mail-chip", unread && "is-on")} aria-pressed={unread} onClick={() => setUnread(!unread)}>
            {t("mail.unreadOnly")}
          </button>
          <button type="button" className={cn("gw-mail-chip", linked && "is-on")} aria-pressed={linked} onClick={() => setLinked(!linked)}>
            {t("mail.crmOnly")}
          </button>
        </div>
      </div>

      <div className="gw-mail">
        <section className="gw-mail-list" aria-label={t("mail.threads")}>
          {showDrafts ? (
            <>
              {!drafts.length && !draftsLoading ? (
                <div className="gw-mail-empty">
                  <FileEdit size={26} aria-hidden />
                  <p>{t("mail.empty.drafts")}</p>
                </div>
              ) : null}
              <ul className="gw-mail-threads">
                {drafts
                  .filter((d) => !mailboxId || d.mailbox_id === mailboxId)
                  .map((d) => (
                    <li key={d.id}>
                      <button
                        type="button"
                        className="gw-mail-thread"
                        onClick={() => setCompose({ kind: d.mode, draft: d, mailboxId: d.mailbox_id, subject: d.subject, sourceId: d.source_message_id })}
                      >
                        <span className="gw-mail-avatar is-draft" aria-hidden>
                          <FileEdit size={15} />
                        </span>
                        <span className="gw-mail-thread__body">
                          <span className="gw-mail-thread__row">
                            <strong className="gw-mail-thread__who">
                              <span className="gw-mail-thread__draft">{t(`mail.draftKind.${d.mode}`)}</span> {d.to.join(", ") || t("mail.noRecipients")}
                            </strong>
                            <time className="gw-mail-thread__time">{formatMailTime(d.updated_at, lang)}</time>
                          </span>
                          <span className="gw-mail-thread__subject">{d.subject || t("mail.noSubject")}</span>
                          <span className="gw-mail-thread__snippet">{d.html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").trim()}</span>
                        </span>
                      </button>
                    </li>
                  ))}
              </ul>
            </>
          ) : (
          <>
          <ErrorNote error={threadsError} />
          {!threads.length && (threadsLoading || statusLoading) ? (
            <ul className="gw-mail-skeleton" aria-hidden>
              {Array.from({ length: 6 }).map((_, i) => (
                <li key={i} />
              ))}
            </ul>
          ) : null}
          {!threads.length && !threadsLoading && status ? (
            <div className="gw-mail-empty">
              <MailOpen size={26} aria-hidden />
              <p>{debouncedQ ? t("mail.noResults") : t(`mail.empty.${pageFolder}`)}</p>
            </div>
          ) : null}
          <ul className="gw-mail-threads">
            {threads.map((th) => {
              const who = th.match?.name || th.participants[0]?.name || th.participants[0]?.email || t("mail.noRecipients");
              return (
                <li key={th.id}>
                  <button type="button" className={cn("gw-mail-thread", th.unread_count > 0 && "is-unread", th.id === threadId && "is-active")} onClick={() => openThread(th)}>
                    <span className={cn("gw-mail-avatar", th.match && `is-${th.match.kind}`)} aria-hidden>
                      {initialsOf(th.match?.name || th.participants[0]?.name, th.participants[0]?.email)}
                    </span>
                    <span className="gw-mail-thread__body">
                      <span className="gw-mail-thread__row">
                        <strong className="gw-mail-thread__who">
                          {th.last_direction === "outbound" && folder !== "inbox" ? <span className="gw-mail-thread__to">{t("mail.toShort")} </span> : null}
                          {who}
                          {th.message_count > 1 ? <span className="gw-mail-thread__count">{th.message_count}</span> : null}
                        </strong>
                        <time className="gw-mail-thread__time">{formatMailTime(th.last_message_at, lang)}</time>
                      </span>
                      <span className="gw-mail-thread__subject">{th.subject || t("mail.noSubject")}</span>
                      <span className="gw-mail-thread__snippet">{th.snippet}</span>
                      <span className="gw-mail-thread__tags">
                        {th.match ? <span className={cn("gw-mail-badge", `is-${th.match.kind}`)}>{t(`mail.kind.${th.match.kind}`)}</span> : null}
                        {!mailboxId && mailboxes.length > 1 ? <span className="gw-mail-badge is-box">{th.mailbox_email?.split("@")[0]}</span> : null}
                        {th.has_attachments ? <Paperclip size={12} aria-label={t("mail.hasAttachments")} /> : null}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {nextCursor ? (
            <button type="button" className="pf-btn pf-btn--sm gw-mail-more" disabled={threadsLoading} onClick={() => void dispatch(fetchMailThreads({ ...query, cursor: nextCursor }))}>
              {threadsLoading ? t("pf.loading") : t("mail.loadMore")}
            </button>
          ) : null}
          </>
          )}
        </section>

        <section className="gw-mail-reader" ref={readerRef} aria-label={t("mail.reader")}>
          {!threadId ? (
            <div className="gw-mail-empty gw-mail-reader__empty">
              <MailIcon size={30} aria-hidden />
              <p>{t("mail.pickThread")}</p>
            </div>
          ) : (
            <>
              <div className="gw-mail-reader__bar">
                <button type="button" className="pf-btn pf-btn--sm gw-mail-back" onClick={back}>
                  <ArrowLeft size={15} aria-hidden /> {t("mail.back")}
                </button>
                {open ? (
                  <div className="gw-mail-reader__tools">
                    <button
                      type="button"
                      className="pf-btn pf-btn--sm"
                      onClick={async () => {
                        await dispatch(updateMailThread({ id: open.thread.id, unread: true }));
                        back();
                      }}
                    >
                      <MailIcon size={14} aria-hidden /> <span className="gw-hide-sm">{t("mail.markUnread")}</span>
                    </button>
                    <button
                      type="button"
                      className="pf-btn pf-btn--sm"
                      onClick={async () => {
                        await dispatch(updateMailThread({ id: open.thread.id, archived: !open.thread.archived }));
                        setToast(open.thread.archived ? t("mail.unarchived") : t("mail.archived"));
                        back();
                      }}
                    >
                      {open.thread.archived ? <ArchiveRestore size={14} aria-hidden /> : <Archive size={14} aria-hidden />}{" "}
                      <span className="gw-hide-sm">{open.thread.archived ? t("mail.unarchive") : t("mail.archive")}</span>
                    </button>
                    {open.can_send && openFolders?.length ? (
                      <label className="gw-mail-select gw-mail-move">
                        <span className="sr-only">{t("mail.organize.moveTo")}</span>
                        <select
                          value=""
                          onChange={async (e) => {
                            const v = e.target.value;
                            const r = await dispatch(moveMailThread({ id: open.thread.id, folder_id: v === "inbox" ? null : Number(v) }));
                            setToast(t(moveMailThread.fulfilled.match(r) ? "mail.organize.moved" : "errors.mailMoveFailed"));
                            if (moveMailThread.fulfilled.match(r)) {
                              back();
                              loadList();
                            }
                          }}
                        >
                          <option value="">{t("mail.organize.moveTo")}</option>
                          <option value="inbox">{t("mail.folder.inbox")}</option>
                          {openFolders.map((f) => (
                            <option key={f.id} value={f.id}>
                              {f.name}
                            </option>
                          ))}
                        </select>
                        <ChevronDown size={14} aria-hidden />
                      </label>
                    ) : null}
                    {open.can_send ? (
                      <button type="button" className="pf-btn pf-btn--sm pf-btn--danger-ghost" onClick={() => setConfirmDelete(open.thread.id)} aria-label={t("mail.delete")}>
                        <Trash2 size={14} aria-hidden /> <span className="gw-hide-sm">{t("mail.delete")}</span>
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
              <ErrorNote error={openError} />
              {openLoading && !open ? <div className="gw-mail-reader__loading">{t("pf.loading")}</div> : null}
              {open ? (
                <article className="gw-mail-conv">
                  <header className="gw-mail-conv__head">
                    <h2>{open.thread.subject || t("mail.noSubject")}</h2>
                    <div className="gw-mail-conv__meta">
                      {open.thread.match ? (
                        <Link className={cn("gw-mail-person", `is-${open.thread.match.kind}`)} to={recordPath(open.thread.match)}>
                          <UserRound size={13} aria-hidden /> {open.thread.match.name} · {t(`mail.kind.${open.thread.match.kind}`)}
                        </Link>
                      ) : (
                        <span className="gw-mail-person is-none">{t("mail.notInCrm")}</span>
                      )}
                      <span className="gw-mail-conv__box">{open.thread.mailbox_email}</span>
                    </div>
                  </header>
                  {open.messages.map((m, i) => (
                    <MessageCard
                      key={m.id}
                      m={m}
                      lang={lang}
                      onForward={open.can_send ? () => setCompose({ kind: "forward", message: m, mailboxId: open.thread.mailbox_id, subject: open.thread.subject }) : undefined}
                      defaultOpen={i === open.messages.length - 1 || !m.is_read}
                      attachments={attachments[m.id]}
                      onLoadAttachments={() => void dispatch(fetchMailAttachments(m.id))}
                    />
                  ))}
                  {open.can_send && lastMessage ? (
                    <div className="gw-mail-conv__reply">
                      <button type="button" className="pf-btn pf-btn--gold" onClick={() => setCompose({ kind: "reply", message: lastMessage, mailboxId: open.thread.mailbox_id, subject: open.thread.subject })}>
                        <Reply size={15} aria-hidden /> {t("mail.reply")}
                      </button>
                      {lastMessage.to.length + lastMessage.cc.length > 1 ? (
                        <button type="button" className="pf-btn" onClick={() => setCompose({ kind: "replyAll", message: lastMessage, mailboxId: open.thread.mailbox_id, subject: open.thread.subject })}>
                          <ReplyAll size={15} aria-hidden /> {t("mail.replyAll")}
                        </button>
                      ) : null}
                      <button type="button" className="pf-btn" onClick={() => setCompose({ kind: "forward", message: lastMessage, mailboxId: open.thread.mailbox_id, subject: open.thread.subject })}>
                        <Forward size={15} aria-hidden /> {t("mail.forward")}
                      </button>
                    </div>
                  ) : open && !open.can_send ? (
                    <p className="pf-hint">{t("mail.readOnlyAccess")}</p>
                  ) : null}
                </article>
              ) : null}
            </>
          )}
        </section>
      </div>

      <Modal open={confirmDelete != null} titleKey="mail.deleteTitle" onClose={() => (deleting ? undefined : setConfirmDelete(null))}>
        <p>{t("mail.deleteBody")}</p>
        <ErrorNote error={deleteError} />
        <div className="pf-actions">
          <button type="button" className="pf-btn" disabled={deleting} onClick={() => setConfirmDelete(null)}>
            {t("pf.cancel")}
          </button>
          <BusyButton
            className="pf-btn--danger"
            icon={Trash2}
            label={t("mail.delete")}
            busy={deleting}
            onClick={async () => {
              if (confirmDelete == null) return;
              setDeleting(true);
              setDeleteError(null);
              const r = await dispatch(deleteMailThread(confirmDelete));
              setDeleting(false);
              if (deleteMailThread.fulfilled.match(r)) {
                setConfirmDelete(null);
                setToast(t("mail.deleted"));
                back();
                void dispatch(fetchMailStatus());
              } else setDeleteError(r.payload || "errors.server");
            }}
          />
        </div>
      </Modal>

      {toast ? (
        <div className="gw-toast" role="status">
          {toast}
        </div>
      ) : null}

      <MailComposer
        open={Boolean(compose)}
        mode={compose}
        mailboxes={mailboxes}
        onClose={() => {
          setCompose(null);
          void dispatch(fetchMailDrafts());
        }}
        onSent={(tid, dry) => {
          setCompose(null);
          setToast(dry ? t("mail.sentSandbox") : t("mail.sent"));
          loadList();
          void dispatch(fetchMailStatus());
          if (tid && tid === threadId) void dispatch(fetchMailThread(tid));
          else if (tid) setParam({ thread: String(tid) });
        }}
      />
      {status ? <MailboxesDrawer open={manage} onClose={() => setManage(false)} configured={status.configured} domains={status.allowed_domains} /> : null}
      {organize && mailboxId ? <MailOrganizeModal mailboxId={mailboxId} canEdit={Boolean(organizeMailbox?.can_send)} onClose={() => setOrganize(false)} /> : null}
    </div>
  );
}

function MessageCard({
  m,
  lang,
  defaultOpen,
  attachments,
  onLoadAttachments,
  onForward,
}: {
  m: MailMessage;
  lang: string;
  defaultOpen: boolean;
  attachments: MailAttachment[] | "loading" | "error" | undefined;
  onLoadAttachments: () => void;
  onForward?: () => void;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(defaultOpen);
  useEffect(() => {
    if (expanded && m.has_attachments && attachments === undefined) onLoadAttachments();
  }, [expanded, m.has_attachments, attachments, onLoadAttachments]);
  const from = m.from_name || m.from_email || "";
  const toLine = [...m.to, ...m.cc].map((x) => x.name || x.email).join(", ");
  return (
    <section className={cn("gw-mail-msg", m.direction === "outbound" && "is-out", expanded && "is-open")}>
      <button type="button" className="gw-mail-msg__head" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
        <span className={cn("gw-mail-avatar is-sm", m.direction === "outbound" && "is-out")} aria-hidden>
          {initialsOf(m.from_name, m.from_email)}
        </span>
        <span className="gw-mail-msg__who">
          <strong>{from}</strong>
          <small>
            {expanded ? `${t("mail.toShort")} ${toLine}` : m.preview}
            {m.sent_by_name ? ` · ${t("mail.sentBy", { name: m.sent_by_name })}` : ""}
          </small>
        </span>
        <time className="gw-mail-msg__time">{formatMailFull(m.sent_at, lang)}</time>
      </button>
      {expanded ? (
        <div className="gw-mail-msg__body">
          <EmailFrame html={m.html} title={m.subject || from} sender={m.direction === "inbound" ? m.from_email : null} />
          {onForward ? (
            <button type="button" className="gw-linkbtn gw-mail-msg__forward" onClick={onForward}>
              <Forward size={13} aria-hidden /> {t("mail.forward")}
            </button>
          ) : null}
          {m.has_attachments ? (
            <div className="gw-mail-atts">
              {attachments === "loading" ? <span className="pf-muted">{t("pf.loading")}</span> : null}
              {attachments === "error" ? <span className="pf-muted">{t("mail.attachmentsError")}</span> : null}
              {Array.isArray(attachments)
                ? attachments.map((a) => (
                    <a key={a.id} className="gw-mail-att" href={`/api/admin/mail/messages/${m.id}/attachments/${encodeURIComponent(a.id)}`} download={a.name}>
                      <Paperclip size={13} aria-hidden />
                      <span>{a.name}</span>
                      <small>{formatBytes(a.size)}</small>
                      <Download size={13} aria-hidden />
                    </a>
                  ))
                : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
