import { useEffect, useState } from "react";
import { MessageSquare } from "lucide-react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { AdminLead } from "@shared/api";
import { useAppDispatch } from "@/store/hooks";
import { startConversationOutbound } from "@/store/slices/conversationsSlice";
import { BusyButton, ErrorNote, Modal } from "@/components/portal/kit";

const SMS_MAX = 1600;

/**
 * Text a lead without leaving the Leads page. Sends from the admin's Groundwork
 * line via `/conversations/start` (thread lands in Conversations as usual).
 */
export default function LeadQuickText({
  lead,
  onClose,
  onSent,
}: {
  lead: AdminLead | null;
  onClose: () => void;
  onSent: () => void;
}) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  useEffect(() => {
    setBody("");
    setError(null);
    setSent(null);
  }, [lead?.id]);

  const first = lead?.full_name.split(/\s+/)[0] || "";

  return (
    <Modal open={Boolean(lead)} titleKey="admin.leadTextTitle" onClose={onClose}>
      {lead ? (
        <div className="pf-form">
          <p className="pf-muted">
            {lead.full_name} · {lead.phone}
          </p>
          <ErrorNote error={error} />
          {sent ? (
            <div className="gw-lead-text-sent" role="status">
              <p>{t("admin.leadTextSent")}</p>
              <Link className="text-link" to={sent}>
                <MessageSquare size={14} aria-hidden /> {t("admin.leadOpenThread")}
              </Link>
            </div>
          ) : (
            <>
              <label className="pf-field">
                <span>{t("admin.leadTextMessage")}</span>
                <textarea
                  rows={4}
                  maxLength={SMS_MAX}
                  value={body}
                  placeholder={t("admin.leadTextPlaceholder", { name: first })}
                  onChange={(e) => setBody(e.target.value)}
                />
                <small className="pf-hint">
                  {t("admin.leadTextHint")} · {body.length}/{SMS_MAX}
                </small>
              </label>
              <div className="pf-actions">
                <button type="button" className="pf-btn" onClick={onClose} disabled={busy}>
                  {t("pf.cancel")}
                </button>
                <BusyButton
                  tone="gold"
                  className="pf-submit"
                  icon={MessageSquare}
                  label={t("conversations.send")}
                  busy={busy}
                  disabled={!body.trim()}
                  onClick={async () => {
                    setBusy(true);
                    setError(null);
                    const r = await dispatch(startConversationOutbound({ phone: lead.phone, body: body.trim() }));
                    setBusy(false);
                    if (startConversationOutbound.fulfilled.match(r)) {
                      const p = r.payload;
                      const id = p.kind === "client" ? p.client_id : p.kind === "contact" ? p.contact_id : p.unknown_contact_id;
                      setSent(id ? `/admin/conversations?${p.kind}=${id}` : "/admin/conversations");
                      onSent();
                    } else {
                      setError(r.payload || "errors.server");
                    }
                  }}
                />
              </div>
            </>
          )}
        </div>
      ) : null}
    </Modal>
  );
}
