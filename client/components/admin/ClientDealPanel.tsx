import { useEffect, useState } from "react";
import { Eye, EyeOff, MessageSquareText, Send } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  addClientUpdate,
  fetchClientUpdates,
  fetchDealStatuses,
  setClientDealStatus,
} from "@/store/slices/dealStatusSlice";
import { BusyButton, ErrorNote, Loading } from "@/components/portal/kit";
import DealStatusBadge from "@/components/portal/DealStatusBadge";
import { useAdminCan } from "@/hooks/useAdminCan";
import { useFormatters } from "@/lib/format";

/**
 * Client → Deal status + Updates. Deal status (Credit repair, Not enough
 * equity, …) is separate from the portal account status. Notes are internal
 * by default; "Share with affiliate" posts to the affiliate's portal and sends
 * them a text + email. Status changes notify the affiliate the same way.
 */
export default function ClientDealPanel({
  clientId,
  currentStatusId,
  onChanged,
}: {
  clientId: number;
  currentStatusId: number | null;
  onChanged: () => void;
}) {
  const { t, i18n } = useTranslation();
  const dispatch = useAppDispatch();
  const fmt = useFormatters();
  const canWrite = useAdminCan("people.write");
  const { statuses, statusesLoaded, updates, updatesFor, affiliate, loading, saving, error } = useAppSelector(
    (s) => s.dealStatus,
  );
  const es = i18n.language?.startsWith("es");
  const [statusId, setStatusId] = useState<string>(currentStatusId ? String(currentStatusId) : "");
  const [statusNote, setStatusNote] = useState("");
  const [notify, setNotify] = useState(true);
  const [note, setNote] = useState("");
  const [share, setShare] = useState(false);

  useEffect(() => {
    if (!statusesLoaded) void dispatch(fetchDealStatuses());
    void dispatch(fetchClientUpdates(clientId));
  }, [dispatch, clientId, statusesLoaded]);
  useEffect(() => setStatusId(currentStatusId ? String(currentStatusId) : ""), [currentStatusId]);

  const active = statuses.filter((s) => s.is_active || s.id === currentStatusId);
  const changed = (statusId || null) !== (currentStatusId ? String(currentStatusId) : null);
  const feed = updatesFor === clientId ? updates : [];

  return (
    <section className="pf-section gw-deal-panel">
      <div className="pf-section-head">
        <h2 className="pf-h2">{t("deal.title")}</h2>
      </div>
      <ErrorNote error={error} />
      <div className="gw-deal-grid">
        <div className="pf-card">
          <label className="pf-field">
            <span>{t("deal.status")}</span>
            <select value={statusId} disabled={!canWrite} onChange={(e) => setStatusId(e.target.value)}>
              <option value="">{t("deal.none")}</option>
              {active.map((s) => (
                <option key={s.id} value={s.id}>{es ? s.label_es : s.label_en}</option>
              ))}
            </select>
            <small className="pf-hint">{t("deal.statusHint")}</small>
          </label>
          {changed && canWrite ? (
            <>
              <label className="pf-field">
                <span>{t("deal.statusNote")}</span>
                <textarea rows={2} maxLength={4000} value={statusNote} onChange={(e) => setStatusNote(e.target.value)} />
              </label>
              <label className="gw-check">
                <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} disabled={!affiliate} />
                <span>
                  {affiliate ? t("deal.notifyAffiliate", { name: affiliate.first_name }) : t("deal.noAffiliate")}
                </span>
              </label>
              <BusyButton
                tone="gold"
                label={t("deal.saveStatus")}
                busy={saving}
                onClick={async () => {
                  const r = await dispatch(
                    setClientDealStatus({
                      clientId,
                      deal_status_id: statusId ? Number(statusId) : null,
                      note: statusNote.trim() || undefined,
                      notify_affiliate: Boolean(affiliate) && notify,
                    }),
                  );
                  if (setClientDealStatus.fulfilled.match(r)) {
                    setStatusNote("");
                    onChanged();
                  }
                }}
              />
            </>
          ) : null}
        </div>

        <div className="pf-card">
          <h3 className="pf-h3"><MessageSquareText size={16} aria-hidden /> {t("deal.updates")}</h3>
          {canWrite ? (
            <div className="gw-deal-compose">
              <textarea
                rows={3}
                maxLength={4000}
                placeholder={t("deal.notePlaceholder")}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
              <label className="gw-check">
                <input type="checkbox" checked={share} disabled={!affiliate} onChange={(e) => setShare(e.target.checked)} />
                <span>{affiliate ? t("deal.shareWith", { name: affiliate.first_name }) : t("deal.noAffiliate")}</span>
              </label>
              <BusyButton
                icon={Send}
                label={t(share ? "deal.postShared" : "deal.postInternal")}
                busy={saving}
                disabled={note.trim().length < 2}
                onClick={async () => {
                  const r = await dispatch(addClientUpdate({ clientId, body: note.trim(), share_with_affiliate: share && Boolean(affiliate) }));
                  if (addClientUpdate.fulfilled.match(r)) {
                    setNote("");
                    setShare(false);
                  }
                }}
              />
            </div>
          ) : null}
          {loading && !feed.length ? <Loading /> : null}
          {!loading && !feed.length ? <p className="pf-muted">{t("deal.noUpdates")}</p> : null}
          <ul className="gw-deal-feed">
            {feed.map((u) => (
              <li key={u.id} className={u.visibility === "affiliate" ? "is-shared" : undefined}>
                <div className="gw-deal-feed__meta">
                  {u.visibility === "affiliate" ? (
                    <span className="gw-deal-vis"><Eye size={12} aria-hidden /> {t("deal.sharedTag")}</span>
                  ) : (
                    <span className="gw-deal-vis is-internal"><EyeOff size={12} aria-hidden /> {t("deal.internalTag")}</span>
                  )}
                  <span className="pf-muted">{u.author_name || "—"} · {fmt.eventDateTime(u.created_at)}</span>
                </div>
                {u.kind === "deal_status" ? (
                  <p>
                    {t("deal.statusChanged")}{" "}
                    <DealStatusBadge en={u.deal_status_label_en} es={u.deal_status_label_es} />
                  </p>
                ) : null}
                {u.body ? <p className="gw-deal-feed__body">{u.body}</p> : null}
                {u.notified_at ? (
                  <p className="pf-hint">{t("deal.notified", { name: u.notified_affiliate_name || "", date: fmt.eventDateTime(u.notified_at) })}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
