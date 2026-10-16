import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AlertTriangle, ArchiveRestore, CheckCircle2, MinusCircle } from "lucide-react";
import { LEAD_STATUSES, type ClientRevertBlocker, type LeadStatus } from "@shared/api";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  fetchClientRevertPreview,
  resetClientRevert,
  revertClientToLead,
} from "@/store/slices/clientRevertSlice";
import { Modal } from "@/components/portal/Modal";
import { BusyButton, ErrorNote, Loading } from "@/components/portal/kit";

const REVERT_STATUSES = LEAD_STATUSES.filter((s) => s !== "spam") as Exclude<LeadStatus, "spam">[];

/**
 * "Move back to Leads" — undo a client conversion made by mistake. Shows where
 * the person goes back to (lead / contact / Conversations unknown / new lead),
 * what is kept vs removed, and why it's blocked once real work exists.
 */
export default function RevertClientModal({
  clientId,
  open,
  onClose,
}: {
  clientId: number;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { plan, loading, error, busy, actionError, actionBlockers } = useAppSelector((s) => s.clientRevert);
  const [leadStatus, setLeadStatus] = useState<"" | Exclude<LeadStatus, "spam">>("");
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (!open) return;
    setLeadStatus("");
    setReason("");
    void dispatch(fetchClientRevertPreview(clientId));
    return () => {
      dispatch(resetClientRevert());
    };
  }, [open, clientId, dispatch]);

  const blockers: ClientRevertBlocker[] = actionBlockers.length ? actionBlockers : plan?.blockers || [];
  const name = plan?.client_name || "";
  const where = plan
    ? plan.origin === "lead"
      ? plan.leads.every((l) => l.full_name.trim().toLowerCase() === name.toLowerCase())
        ? t("clientRevert.toLeadSame", { name })
        : t("clientRevert.toLead", { name, lead: plan.leads.map((l) => l.full_name).join(", ") })
      : t(`clientRevert.to.${plan.origin}`, { name })
    : "";

  const submit = async () => {
    const r = await dispatch(
      revertClientToLead({ id: clientId, lead_status: leadStatus || null, reason }),
    );
    if (!revertClientToLead.fulfilled.match(r)) return;
    const res = r.payload.result;
    onClose();
    if (res?.lead_id) navigate(`/admin/leads?q=${encodeURIComponent(name)}`);
    else if (res?.contact_id) navigate(`/admin/conversations?contact=${res.contact_id}`);
    else if (res?.unknown_contact_id) navigate(`/admin/conversations?unknown=${res.unknown_contact_id}`);
    else navigate("/admin/clients");
  };

  const c = plan?.counts;
  const keeps = plan
    ? [
        c && c.conversations > 0 ? t("clientRevert.keepThreads", { count: c.conversations }) : null,
        c && c.notes > 0 ? t(`clientRevert.keepNotes.${plan.origin}`, { count: c.notes }) : null,
        plan.affiliate_id && (plan.origin === "lead" || plan.origin === "new_lead") ? t("clientRevert.keepAffiliate") : null,
      ].filter(Boolean)
    : [];
  const removes = plan
    ? [
        t("clientRevert.removeClient"),
        c && c.projects > 0 ? t("clientRevert.removeProjects", { count: c.projects }) : null,
        c && c.invites > 0 ? t("clientRevert.removeInvite") : null,
      ].filter(Boolean)
    : [];

  return (
    <Modal open={open} titleKey="clientRevert.title" onClose={() => (busy ? undefined : onClose())}>
      <div className="pf-form gw-revert">
        {loading ? <Loading /> : null}
        <ErrorNote error={error} />
        {plan ? (
          <>
            <p className="gw-revert__where">
              <ArchiveRestore size={16} aria-hidden /> {where}
            </p>

            {blockers.length ? (
              <div className="gw-revert__blocked" role="alert">
                <strong>
                  <AlertTriangle size={15} aria-hidden /> {t("clientRevert.blockedTitle")}
                </strong>
                <ul>
                  {blockers.map((b) => (
                    <li key={b}>{t(`clientRevert.blocker.${b}`)}</li>
                  ))}
                </ul>
                <p className="pf-hint">{t("clientRevert.blockedHint")}</p>
              </div>
            ) : (
              <>
                <div className="gw-revert__lists">
                  <div>
                    <span className="gw-revert__label">{t("clientRevert.kept")}</span>
                    <ul>
                      {keeps.map((k) => (
                        <li key={k}>
                          <CheckCircle2 size={14} aria-hidden /> {k}
                        </li>
                      ))}
                      <li>
                        <CheckCircle2 size={14} aria-hidden /> {t("clientRevert.keepAudit")}
                      </li>
                    </ul>
                  </div>
                  <div>
                    <span className="gw-revert__label">{t("clientRevert.removed")}</span>
                    <ul>
                      {removes.map((k) => (
                        <li key={k} className="is-removed">
                          <MinusCircle size={14} aria-hidden /> {k}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
                <p className="pf-hint">{t("clientRevert.noMessages")}</p>

                {plan.origin === "lead" || plan.origin === "new_lead" ? (
                  <label className="pf-field">
                    <span>{t("clientRevert.leadStatus")}</span>
                    <select value={leadStatus} onChange={(e) => setLeadStatus(e.target.value as typeof leadStatus)}>
                      <option value="">
                        {plan.origin === "lead" ? t("clientRevert.keepStatus") : t("leadStatus.contacted")}
                      </option>
                      {REVERT_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {t(`leadStatus.${s}`)}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                <label className="pf-field">
                  <span>{t("clientRevert.reason")}</span>
                  <textarea
                    rows={2}
                    maxLength={500}
                    value={reason}
                    placeholder={t("clientRevert.reasonPlaceholder")}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </label>
                <ErrorNote error={actionError} />
              </>
            )}

            <div className="pf-actions gw-revert__actions">
              <button type="button" className="pf-btn" disabled={busy} onClick={onClose}>
                {t(blockers.length ? "pf.close" : "pf.cancel")}
              </button>
              {blockers.length ? null : (
                <BusyButton
                  tone="gold"
                  icon={ArchiveRestore}
                  label={t(`clientRevert.confirm.${plan.origin}`)}
                  busyLabel={t("clientRevert.busy")}
                  busy={busy}
                  onClick={() => void submit()}
                />
              )}
            </div>
          </>
        ) : null}
      </div>
    </Modal>
  );
}
