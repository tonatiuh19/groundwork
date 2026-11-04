import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Forward, Paperclip, Reply, ReplyAll, Send, Trash2, X } from "lucide-react";
import type { Mailbox, MailDraft, MailDraftMode, MailMessage, MailSendBody } from "@shared/api";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { clearMailErrors, discardMailDraft, saveMailDraft, sendMail } from "@/store/slices/mailSlice";
import { BusyButton, ErrorNote } from "@/components/portal/kit";
import { SideDrawer } from "@/components/portal/SideDrawer";
import RichEditor from "./RichEditor";
import RecipientInput from "./RecipientInput";
import { formatBytes } from "./mailFormat";
import TemplatePicker from "./TemplatePicker";

/** What the composer is doing; `draft` resumes a saved draft. */
export type ComposeMode = {
  kind: MailDraftMode;
  mailboxId?: number | null;
  to?: string[];
  subject?: string | null;
  /** The message replied to / forwarded (for default recipients). */
  message?: MailMessage | null;
  sourceId?: number | null;
  draft?: MailDraft | null;
};

const MAX_BYTES = 3 * 1024 * 1024;
const AUTOSAVE_MS = 2500;
type FileItem = { name: string; content_type: string; base64: string; size: number };
const sizeOf = (b64: string) => Math.floor((b64.length * 3) / 4);
const plainText = (h: string) => h.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim();
const prefixed = (prefix: "RE" | "FW", s: string) => (new RegExp(`^${prefix}:`, "i").test(s) ? s : `${prefix}: ${s}`);

/**
 * Compose / reply / forward panel: from, to, cc, subject, rich body, attachments,
 * signature preview. Autosaves a draft (CRM + Outlook Drafts) while typing; Discard removes it.
 */
export default function MailComposer({
  open,
  mode,
  mailboxes,
  onClose,
  onSent,
}: {
  open: boolean;
  mode: ComposeMode | null;
  mailboxes: Mailbox[];
  onClose: () => void;
  onSent: (threadId: number | null, dryRun: boolean) => void;
}) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const { sending, sendError } = useAppSelector((s) => s.mail);
  const senders = useMemo(() => mailboxes.filter((m) => m.can_send && m.mail_sync_enabled), [mailboxes]);
  const kind: MailDraftMode = mode?.kind ?? "new";
  const isReply = kind === "reply" || kind === "replyAll";
  const sourceId = mode?.draft?.source_message_id ?? mode?.message?.id ?? mode?.sourceId ?? null;
  const [from, setFrom] = useState<number>(0);
  const [to, setTo] = useState<string[]>([]);
  const [cc, setCc] = useState<string[]>([]);
  const [showCc, setShowCc] = useState(false);
  const [subject, setSubject] = useState("");
  const [html, setHtml] = useState("");
  const [initialHtml, setInitialHtml] = useState("");
  const [files, setFiles] = useState<FileItem[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const [draftId, setDraftId] = useState<number | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [dirty, setDirty] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  /** Default recipients for a reply (sent as "reply to sender" when unchanged). */
  const defaultTo = useRef<string[]>([]);

  useEffect(() => {
    if (!open || !mode) return;
    dispatch(clearMailErrors());
    setFileError(null);
    setDirty(false);
    setSaveState(mode.draft ? "saved" : "idle");
    setResetKey((k) => k + 1);
    const d = mode.draft;
    const own = mailboxes.find((m) => m.id === (d?.mailbox_id ?? mode.mailboxId))?.email.toLowerCase();
    const m = mode.message;
    const back = m ? (m.direction === "inbound" ? [m.from_email || ""] : m.to.map((x) => x.email)).filter(Boolean) : [];
    defaultTo.current = mode.kind === "reply" || mode.kind === "replyAll" ? back : [];
    setDraftId(d?.id ?? null);
    setFrom(
      d?.mailbox_id ?? (mode.mailboxId && senders.some((x) => x.id === mode.mailboxId) ? mode.mailboxId : senders[0]?.id || 0),
    );
    if (d) {
      setTo(d.to);
      setCc(d.cc);
      setShowCc(d.cc.length > 0);
      setSubject(d.subject);
      setInitialHtml(d.html);
      setHtml(d.html);
      setFiles(d.attachments.map((a) => ({ ...a, size: sizeOf(a.base64) })));
      return;
    }
    setInitialHtml("");
    setHtml("");
    setFiles([]);
    const base = mode.subject || "";
    if (mode.kind === "new") {
      setTo(mode.to ?? []);
      setCc([]);
      setShowCc(false);
      setSubject(base);
    } else if (mode.kind === "forward") {
      setTo([]);
      setCc([]);
      setShowCc(false);
      setSubject(prefixed("FW", base));
    } else {
      setTo(back);
      const others = mode.kind === "replyAll" && m ? [...m.to, ...m.cc].map((x) => x.email).filter((e) => e && e !== own && !back.includes(e)) : [];
      setCc(others);
      setShowCc(others.length > 0);
      setSubject(prefixed("RE", base));
    }
  }, [open, mode, dispatch, senders, mailboxes]);

  const box = mailboxes.find((m) => m.id === from);
  /** For {{first_name}} in templates: who the email is going to. */
  const recipientName = String(mode?.message?.direction === "inbound" ? mode?.message?.from_name || "" : "").trim();
  const total = files.reduce((n, f) => n + f.size, 0);
  const empty = !plainText(html);
  const hasContent = !empty || to.length > 0 || (kind === "new" && subject.trim().length > 0) || files.length > 0;

  const persist = useCallback(async () => {
    if (!box || !hasContent) return null;
    setSaveState("saving");
    const r = await dispatch(
      saveMailDraft({
        id: draftId,
        mailbox_id: box.id,
        mode: kind,
        source_message_id: kind === "new" ? null : sourceId,
        to,
        cc: showCc ? cc : [],
        subject,
        html,
        attachments: files.map(({ name, content_type, base64 }) => ({ name, content_type, base64 })),
      }),
    );
    if (saveMailDraft.fulfilled.match(r)) {
      setDraftId(r.payload.draft.id);
      setSaveState("saved");
      setDirty(false);
      return r.payload.draft.id;
    }
    setSaveState("idle");
    return null;
  }, [box, hasContent, dispatch, draftId, kind, sourceId, to, cc, showCc, subject, html, files]);

  // Autosave a moment after the last change.
  useEffect(() => {
    if (!open || !dirty || sending) return;
    const id = window.setTimeout(() => void persist(), AUTOSAVE_MS);
    return () => window.clearTimeout(id);
  }, [open, dirty, sending, persist]);
  const touch = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setDirty(true);
    setSaveState("idle");
  };

  const close = async () => {
    if (dirty && hasContent && !sending) await persist();
    onClose();
  };
  const discard = async () => {
    if (draftId) await dispatch(discardMailDraft(draftId));
    setDirty(false);
    onClose();
  };

  const addFiles = async (list: FileList | null) => {
    if (!list) return;
    setFileError(null);
    const next = [...files];
    for (const f of Array.from(list)) {
      if (next.reduce((n, x) => n + x.size, 0) + f.size > MAX_BYTES) {
        setFileError(t("mail.attachTooBig"));
        break;
      }
      const base64 = await new Promise<string>((ok, fail) => {
        const r = new FileReader();
        r.onload = () => ok(String(r.result).replace(/^data:[^,]*,/, ""));
        r.onerror = () => fail(r.error);
        r.readAsDataURL(f);
      });
      next.push({ name: f.name, content_type: f.type || "application/octet-stream", base64, size: f.size });
    }
    setFiles(next);
    setDirty(true);
    if (fileRef.current) fileRef.current.value = "";
  };

  const send = async () => {
    if (!box) return;
    const body: MailSendBody = {
      mailbox_id: box.id,
      to,
      cc: showCc ? cc : [],
      subject: kind === "new" ? subject.trim() : "",
      html,
      reply_to_message_id: isReply ? sourceId : null,
      reply_all: kind === "replyAll",
      forward_message_id: kind === "forward" ? sourceId : null,
      draft_id: draftId,
      attachments: files.map(({ name, content_type, base64 }) => ({ name, content_type, base64 })),
    };
    // A reply goes back to the sender unless staff changed the recipients.
    if (isReply && JSON.stringify(to) === JSON.stringify(defaultTo.current) && !(showCc && cc.length)) body.to = [];
    const r = await dispatch(sendMail(body));
    if (sendMail.fulfilled.match(r)) {
      setDirty(false);
      onSent(r.payload.thread_id, r.payload.dry_run);
    }
  };

  const titleKey = { new: "mail.newMessage", reply: "mail.reply", replyAll: "mail.replyAll", forward: "mail.forward" }[kind];
  const TitleIcon = { new: Send, reply: Reply, replyAll: ReplyAll, forward: Forward }[kind];
  const needsTo = kind === "new" || kind === "forward";
  return (
    <SideDrawer
      open={open}
      onClose={() => void close()}
      busy={sending}
      icon={<TitleIcon size={18} />}
      title={t(titleKey)}
      subtitle={box ? t("mail.fromLine", { email: box.email }) : undefined}
      footer={
        <div className="gw-mail-compose__foot">
          <div className="gw-mail-compose__attach">
            <input ref={fileRef} type="file" multiple hidden onChange={(e) => void addFiles(e.target.files)} />
            <button type="button" className="pf-btn pf-btn--sm" onClick={() => fileRef.current?.click()} disabled={sending}>
              <Paperclip size={14} aria-hidden /> {t("mail.attach")}
            </button>
            <TemplatePicker
              firstName={recipientName.split(" ")[0] || null}
              lastName={recipientName.split(" ").slice(1).join(" ") || null}
              onPick={(tpl) => {
                if (kind === "new" && tpl.subject && !subject.trim()) setSubject(tpl.subject);
                const next = empty ? tpl.html : `${html}${tpl.html}`;
                setInitialHtml(next);
                setHtml(next);
                setResetKey((k) => k + 1);
                setDirty(true);
              }}
            />
            {draftId || hasContent ? (
              <button type="button" className="pf-btn pf-btn--sm gw-mail-compose__discard" onClick={() => void discard()} disabled={sending}>
                <Trash2 size={14} aria-hidden /> {t("mail.discardDraft")}
              </button>
            ) : null}
            <span className="gw-mail-compose__saved" aria-live="polite">
              {saveState === "saving" ? t("mail.draftSaving") : saveState === "saved" ? (
                <>
                  <Check size={12} aria-hidden /> {t("mail.draftSaved")}
                </>
              ) : null}
            </span>
          </div>
          <div className="pf-actions">
            <button type="button" className="pf-btn" onClick={() => void close()} disabled={sending}>
              {t("pf.close")}
            </button>
            <BusyButton
              tone="gold"
              icon={Send}
              label={t("mail.send")}
              busyLabel={t("mail.sending")}
              busy={sending}
              disabled={!box || empty || (needsTo && !to.length) || (kind === "new" && !subject.trim())}
              onClick={() => void send()}
            />
          </div>
        </div>
      }
    >
      <div className="gw-mail-compose">
        <ErrorNote error={sendError} />
        {!senders.length ? <p className="gw-onboard-note">{t("mail.noSender")}</p> : null}
        {kind === "new" && senders.length > 1 ? (
          <label className="pf-field">
            <span>{t("mail.from")}</span>
            <select value={from} onChange={(e) => touch(setFrom)(Number(e.target.value))}>
              {senders.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.display_name ? `${m.display_name} <${m.email}>` : m.email}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <RecipientInput label={t("mail.to")} value={to} onChange={touch(setTo)} autoFocus={needsTo && !to.length} />
        {showCc ? (
          <RecipientInput label={t("mail.cc")} value={cc} onChange={touch(setCc)} />
        ) : (
          <button type="button" className="gw-linkbtn gw-mail-compose__cc" onClick={() => setShowCc(true)}>
            {t("mail.addCc")}
          </button>
        )}
        {kind === "new" ? (
          <label className="pf-field">
            <span>{t("mail.subject")}</span>
            <input value={subject} maxLength={400} onChange={(e) => touch(setSubject)(e.target.value)} />
          </label>
        ) : (
          <p className="gw-mail-compose__subject">{subject}</p>
        )}
        {kind === "forward" ? <p className="pf-hint">{t("mail.forwardHint")}</p> : null}
        {isReply ? <p className="pf-hint">{t("mail.replyHint")}</p> : null}
        <RichEditor resetKey={resetKey} initialHtml={initialHtml} onChange={touch(setHtml)} ariaLabel={t("mail.body")} placeholder={t("mail.bodyPlaceholder")} minHeight={220} />
        {files.length ? (
          <ul className="gw-mail-files">
            {files.map((f, i) => (
              <li key={`${f.name}-${i}`}>
                <Paperclip size={13} aria-hidden /> <span>{f.name}</span> <small>{formatBytes(f.size)}</small>
                <button
                  type="button"
                  aria-label={t("picker.remove", { name: f.name })}
                  onClick={() => {
                    setFiles(files.filter((_, j) => j !== i));
                    setDirty(true);
                  }}
                >
                  <X size={13} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {total > 0 ? <p className="pf-hint">{t("mail.attachTotal", { size: formatBytes(total) })}</p> : null}
        <ErrorNote error={fileError} />
        {box?.signature_html ? (
          <div className="gw-mail-sig">
            <span>{t("mail.signatureAdded")}</span>
            <div dangerouslySetInnerHTML={{ __html: box.signature_html }} />
          </div>
        ) : null}
      </div>
    </SideDrawer>
  );
}
