import { Link } from "react-router-dom";
import { useAppDispatch } from "@/store/hooks";
import { markConversationTemplateUsed } from "@/store/slices/conversationsSlice";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { FileText, ImagePlus, Loader2, Send, StickyNote, X } from "lucide-react";
import type { ConversationTemplate } from "@shared/api";
import {
  applyConversationTemplate,
  applyConversationTemplateVars,
  buildConversationMergeVars,
  CONVERSATION_COMPOSER_QUICK_VARS,
  CONVERSATION_TEMPLATE_VARS,
  getOpenVariableToken,
  type ConversationMergeContext,
} from "@/lib/conversationTemplateVars";
import { SMS_MAX_BODY_CHARS, smsSegmentInfo } from "@/lib/smsSegments";

type Channel = "sms" | "internal";

export type ConversationMediaAttachment = {
  url: string;
  content_type: string;
  filename?: string;
  preview_url?: string;
};

interface Props {
  channel: Channel;
  onChannelChange: (ch: Channel) => void;
  body: string;
  onBodyChange: (v: string) => void;
  templates: ConversationTemplate[];
  mergeContext: ConversationMergeContext;
  sending?: boolean;
  sendError?: string | null;
  onSend: () => void;
  disabled?: boolean;
  /** Extra send gate (e.g. missing phone on New message) without locking templates. */
  sendDisabled?: boolean;
  footerStart?: ReactNode;
  /** Prefer Spanish template body when available. */
  templateLang?: "en" | "es";
  /** When false, hide the internal-note channel (e.g. new outbound SMS). */
  allowInternal?: boolean;
  /** Open the template picker on mount (useful for New message). */
  defaultTemplatesOpen?: boolean;
  attachment?: ConversationMediaAttachment | null;
  onAttachmentChange?: (a: ConversationMediaAttachment | null) => void;
  onPickMedia?: (file: File) => Promise<void>;
  uploadingMedia?: boolean;
}

export function ConversationMessageComposer({
  channel,
  onChannelChange,
  body,
  onBodyChange,
  templates,
  mergeContext,
  sending,
  sendError,
  onSend,
  disabled,
  sendDisabled,
  footerStart,
  templateLang = "en",
  allowInternal = true,
  defaultTemplatesOpen = false,
  attachment,
  onAttachmentChange,
  onPickMedia,
  uploadingMedia,
}: Props) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [cursor, setCursor] = useState(0);
  const [showTpl, setShowTpl] = useState(defaultTemplatesOpen);

  const vars = useMemo(
    () => buildConversationMergeVars(mergeContext),
    [mergeContext],
  );

  const openToken = getOpenVariableToken(body, cursor);
  const varSuggestions = useMemo(() => {
    if (!openToken) return [];
    const q = openToken.query.toLowerCase();
    return CONVERSATION_TEMPLATE_VARS.filter(
      (v) => !q || v.key.startsWith(q) || v.label.toLowerCase().includes(q),
    );
  }, [openToken]);

  const activeTemplates = templates.filter((tpl) => tpl.is_active);

  const insertVariable = (key: string) => {
    const el = textareaRef.current;
    const pos = el?.selectionStart ?? cursor;
    const token = getOpenVariableToken(body, pos);
    if (token) {
      const next = body.slice(0, token.start) + `{{${key}}}` + body.slice(pos);
      onBodyChange(next);
      requestAnimationFrame(() => {
        const caret = token.start + key.length + 4;
        el?.setSelectionRange(caret, caret);
        setCursor(caret);
      });
      return;
    }
    const start = el?.selectionStart ?? body.length;
    const end = el?.selectionEnd ?? start;
    const next = body.slice(0, start) + `{{${key}}}` + body.slice(end);
    onBodyChange(next);
  };

  const applyTemplate = (tpl: ConversationTemplate) => {
    void dispatch(markConversationTemplateUsed(tpl.id));
    const filled = applyConversationTemplate(tpl, vars, templateLang);
    onBodyChange(filled.body);
    setShowTpl(false);
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const previewFilled = applyConversationTemplateVars(body, vars);
  const smsInfo = useMemo(
    () => (channel === "sms" ? smsSegmentInfo(previewFilled) : null),
    [channel, previewFilled],
  );
  const smsOverLimit =
    channel === "sms" && (smsInfo?.length ?? 0) > SMS_MAX_BODY_CHARS;
  const canSend = Boolean(
    (body.trim() || attachment?.url) &&
      !smsOverLimit &&
      !sendDisabled &&
      !disabled &&
      !uploadingMedia,
  );
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (channel === "internal") {
      setShowTpl(false);
      if (attachment) {
        if (attachment.preview_url) URL.revokeObjectURL(attachment.preview_url);
        onAttachmentChange?.(null);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- clear attach when leaving SMS
  }, [channel]);

  return (
    <div className="gw-composer">
      <div className="gw-composer__channels" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={channel === "sms"}
          className={
            channel === "sms"
              ? "gw-composer__ch is-active"
              : "gw-composer__ch"
          }
          onClick={() => onChannelChange("sms")}
          disabled={disabled}
        >
          {t("conversations.channelSms")}
        </button>
        {allowInternal ? (
          <button
            type="button"
            role="tab"
            aria-selected={channel === "internal"}
            className={
              channel === "internal"
                ? "gw-composer__ch is-active"
                : "gw-composer__ch"
            }
            onClick={() => onChannelChange("internal")}
            disabled={disabled}
          >
            <StickyNote size={13} aria-hidden /> {t("conversations.internalNote")}
          </button>
        ) : null}
        <button
          type="button"
          className={
            showTpl ? "gw-composer__tpl-btn is-open" : "gw-composer__tpl-btn"
          }
          onClick={() => setShowTpl((v) => !v)}
          disabled={disabled || channel === "internal"}
          aria-expanded={showTpl}
        >
          <FileText size={14} aria-hidden /> {t("conversations.templates")}
        </button>
      </div>

      {showTpl && channel === "sms" ? (
        <div className="gw-composer__templates" role="listbox">
          <div className="gw-composer__tpl-links">
            <Link className="text-link" to="/admin/templates">{t("templates.manage")}</Link>
            {body.trim() ? (
              <Link className="text-link" to={`/admin/templates?new=1&body=${encodeURIComponent(body.slice(0, 1600))}`}>
                {t("templates.saveCurrent")}
              </Link>
            ) : null}
          </div>
          {activeTemplates.length === 0 ? (
            <p className="pf-muted">{t("conversations.templatesEmpty")}</p>
          ) : (
            activeTemplates.map((tpl) => (
              <button
                key={tpl.id}
                type="button"
                role="option"
                className="gw-composer__tpl-item"
                onClick={() => applyTemplate(tpl)}
              >
                <strong>{tpl.title}</strong>
                <span>
                  {applyConversationTemplate(tpl, vars, templateLang).body.slice(
                    0,
                    120,
                  )}
                </span>
              </button>
            ))
          )}
        </div>
      ) : null}

      {varSuggestions.length > 0 ? (
        <div className="gw-composer__var-suggest">
          {varSuggestions.map((v) => (
            <button
              key={v.key}
              type="button"
              onClick={() => insertVariable(v.key)}
            >
              {`{{${v.key}}}`}
            </button>
          ))}
        </div>
      ) : (
        <div className="gw-composer__quick-vars">
          {CONVERSATION_COMPOSER_QUICK_VARS.map((key) => (
            <button
              key={key}
              type="button"
              disabled={disabled || channel === "internal"}
              onClick={() => insertVariable(key)}
            >
              {`{{${key}}}`}
            </button>
          ))}
        </div>
      )}

      {attachment && channel === "sms" ? (
        <div className="gw-composer__attach">
          {attachment.preview_url || /\.(jpe?g|png|gif|webp)(\?|$)/i.test(attachment.url) ? (
            <img
              src={attachment.preview_url || attachment.url}
              alt=""
              className="gw-composer__attach-thumb"
            />
          ) : (
            <span className="pf-muted">{attachment.filename || t("conversations.mmsAttached")}</span>
          )}
          <button
            type="button"
            className="pf-icon-btn"
            disabled={disabled || sending}
            aria-label={t("conversations.mmsRemove")}
            onClick={() => {
              if (attachment.preview_url) {
                URL.revokeObjectURL(attachment.preview_url);
              }
              onAttachmentChange?.(null);
            }}
          >
            <X size={14} />
          </button>
        </div>
      ) : null}

      <div className="gw-composer__row">
        <textarea
          ref={textareaRef}
          className="pf-input gw-composer__input"
          rows={3}
          value={body}
          disabled={disabled || sending}
          placeholder={
            channel === "internal"
              ? t("conversations.notePlaceholder")
              : t("conversations.composerPlaceholder")
          }
          onChange={(e) => {
            onBodyChange(e.target.value);
            setCursor(e.target.selectionStart ?? e.target.value.length);
          }}
          onSelect={(e) =>
            setCursor((e.target as HTMLTextAreaElement).selectionStart ?? 0)
          }
          onKeyDown={(e) => {
            if (
              e.key === "Enter" &&
              (e.metaKey || e.ctrlKey) &&
              canSend &&
              !sending
            ) {
              e.preventDefault();
              onSend();
            }
          }}
        />
        <div className="gw-composer__actions">
          {channel === "sms" && onPickMedia ? (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/gif,image/webp,video/mp4,application/pdf"
                className="sr-only"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) void onPickMedia(file);
                }}
              />
              <button
                type="button"
                className="pf-btn gw-composer__mms"
                disabled={disabled || sending || uploadingMedia}
                onClick={() => fileInputRef.current?.click()}
                aria-label={t("conversations.mmsAttach")}
              >
                {uploadingMedia ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <ImagePlus size={16} />
                )}
              </button>
            </>
          ) : null}
          <button
            type="button"
            className="pf-btn pf-btn--gold gw-composer__send"
            disabled={sending || !canSend}
            onClick={onSend}
            aria-label={t("conversations.send")}
          >
            <Send size={16} />
            <span>{t("conversations.send")}</span>
          </button>
        </div>
      </div>

      <div className="gw-composer__footer">
        <div className="gw-composer__footer-start">{footerStart}</div>
        <div className="gw-composer__meta">
          {channel === "sms" && smsInfo ? (
            <span
              className={
                smsOverLimit ? "gw-composer__meta is-warn" : "gw-composer__meta"
              }
            >
              {t("conversations.smsMeta", {
                length: smsInfo.length,
                segments: smsInfo.segments,
                max: SMS_MAX_BODY_CHARS,
              })}
            </span>
          ) : null}
          {sendError ? (
            <span className="gw-composer__err">{sendError}</span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
