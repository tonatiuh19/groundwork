import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AlertTriangle, CheckCircle2, Handshake, MinusCircle } from "lucide-react";
import type { ClientRevertBlocker } from "@shared/api";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchMoveToAffiliatePreview, moveClientToAffiliate, resetClientRevert } from "@/store/slices/clientRevertSlice";
import { Modal } from "@/components/portal/Modal";
import { BusyButton, ErrorNote, Loading } from "@/components/portal/kit";

/**
 * "Move to affiliate": someone signed up as a homeowner but is a realtor / partner.
 * They become a pending affiliate on the inviter's team (Sponsor) and get the affiliate
 * welcome; the client record goes (same rules as Move back to Leads).
 */
export default function MoveToAffiliateModal({ clientId, open, onClose }: { clientId: number; open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { plan, inviter, loading, error, busy, actionError, actionBlockers } = useAppSelector((s) => s.clientRevert);
  useEffect(() => {
    if (!open) return;
    void dispatch(fetchMoveToAffiliatePreview(clientId));
    return () => {
      dispatch(resetClientRevert());
    };
  }, [open, clientId, dispatch]);

  const blockers: ClientRevertBlocker[] = actionBlockers.length ? actionBlockers : plan?.blockers || [];
  const name = plan?.client_name || "";
  const submit = async () => {
    const r = await dispatch(moveClientToAffiliate({ id: clientId }));
    if (moveClientToAffiliate.fulfilled.match(r)) {
      onClose();
      navigate(r.payload.affiliate_id ? `/admin/affiliates/${r.payload.affiliate_id}` : "/admin/affiliates");
    } else if (r.payload?.lead_id) {
      // Already back in Leads: finish the conversion there.
      onClose();
      navigate(`/admin/leads?q=${encodeURIComponent(name)}`);
    }
  };

  return (
    <Modal open={open} titleKey="moveToAffiliate.title" onClose={() => (busy ? undefined : onClose())}>
      <div className="pf-form gw-revert">
        {loading ? <Loading /> : null}
        <ErrorNote error={error} />
        {plan ? (
          <>
            <p className="gw-revert__where">
              <Handshake size={16} aria-hidden />{" "}
              {inviter ? t("moveToAffiliate.whereSponsor", { name, sponsor: inviter.name }) : t("moveToAffiliate.where", { name })}
            </p>
            {blockers.length ? (
              <div className="gw-revert__blocked" role="alert">
                <strong>
                  <AlertTriangle size={15} aria-hidden /> {t("moveToAffiliate.blockedTitle")}
                </strong>
                <ul>
                  {blockers.map((b) => (
                    <li key={b}>{t(`clientRevert.blocker.${b}`)}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="gw-revert__lists">
                <div>
                  <span className="gw-revert__label">{t("clientRevert.kept")}</span>
                  <ul>
                    <li>
                      <CheckCircle2 size={14} aria-hidden /> {t("moveToAffiliate.keepContact")}
                    </li>
                    {plan.counts.conversations > 0 ? (
                      <li>
                        <CheckCircle2 size={14} aria-hidden /> {t("clientRevert.keepThreads", { count: plan.counts.conversations })}
                      </li>
                    ) : null}
                    {inviter ? (
                      <li>
                        <CheckCircle2 size={14} aria-hidden /> {t("moveToAffiliate.keepSponsor", { sponsor: inviter.name })}
                      </li>
                    ) : null}
                    <li>
                      <CheckCircle2 size={14} aria-hidden /> {t("moveToAffiliate.welcome")}
                    </li>
                  </ul>
                </div>
                <div>
                  <span className="gw-revert__label">{t("clientRevert.removed")}</span>
                  <ul>
                    <li className="is-removed">
                      <MinusCircle size={14} aria-hidden /> {t("clientRevert.removeClient")}
                    </li>
                    {plan.counts.projects > 0 ? (
                      <li className="is-removed">
                        <MinusCircle size={14} aria-hidden /> {t("clientRevert.removeProjects", { count: plan.counts.projects })}
                      </li>
                    ) : null}
                  </ul>
                </div>
              </div>
            )}
            <ErrorNote error={actionError} />
            <div className="pf-actions gw-revert__actions">
              <button type="button" className="pf-btn" disabled={busy} onClick={onClose}>
                {t(blockers.length ? "pf.close" : "pf.cancel")}
              </button>
              {blockers.length ? null : (
                <BusyButton tone="gold" icon={Handshake} label={t("moveToAffiliate.confirm")} busyLabel={t("clientRevert.busy")} busy={busy} onClick={() => void submit()} />
              )}
            </div>
          </>
        ) : null}
      </div>
    </Modal>
  );
}
