import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Trash2 } from "lucide-react";
import type { ErasePreview } from "@shared/api";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { clearErase, erasePerson, fetchErasePreview } from "@/store/slices/recordsSlice";
import { Modal } from "@/components/portal/Modal";
import { BusyButton, ErrorNote, Loading } from "@/components/portal/kit";
import { useAdminCan } from "@/hooks/useAdminCan";

type Entity = ErasePreview["person"]["entity"];

/**
 * "Delete" for a client / affiliate / contractor (super admin + admin). Opens a
 * warning modal that lists exactly what will be erased (and who stays, unlinked),
 * cancels any subscription, then removes everything. Cannot be undone.
 */
export default function DeletePersonButton({
  entity,
  id,
  name,
  onDeleted,
  className = "pf-btn pf-btn--danger-ghost",
}: {
  entity: Entity;
  id: number;
  name: string;
  onDeleted: () => void;
  className?: string;
}) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const canDelete = useAdminCan("approvals");
  const { preview, previewLoading, erasing, eraseError } = useAppSelector((s) => s.records);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  if (!canDelete) return null;

  const show = () => {
    dispatch(clearErase());
    setReason("");
    setOpen(true);
    void dispatch(fetchErasePreview({ entity, id }));
  };
  const p = preview && preview.person.entity === entity && preview.person.id === id ? preview : null;

  return (
    <>
      <button type="button" className={className} onClick={show}>
        <Trash2 size={14} aria-hidden /> {t("erase.button")}
      </button>
      <Modal open={open} titleKey={`erase.title.${entity}`} onClose={() => !erasing && setOpen(false)}>
        <div className="gw-erase">
          <div className="gw-erase__warn" role="alert">
            <AlertTriangle size={20} aria-hidden />
            <p>{t("erase.warn", { name })}</p>
          </div>
          {previewLoading || !p ? (
            eraseError ? <ErrorNote error={eraseError} /> : <Loading />
          ) : (
            <>
              <h4>{t("erase.removes")}</h4>
              <ul className="gw-erase__list">
                <li>{t(`erase.record.${entity}`, { name })}</li>
                {Object.entries(p.counts).map(([k, n]) => (
                  <li key={k}>{t(`erase.count.${k}`, { count: n, defaultValue: `${k}: ${n}` })}</li>
                ))}
                {p.files ? <li>{t("erase.count.files", { count: p.files })}</li> : null}
                {p.subscription ? <li className="is-money">{t("erase.subscription")}</li> : p.card_on_file ? <li>{t("erase.card")}</li> : null}
                <li>{t("erase.access")}</li>
              </ul>
              {Object.keys(p.kept).length ? (
                <>
                  <h4>{t("erase.keeps")}</h4>
                  <ul className="gw-erase__list is-kept">
                    {Object.entries(p.kept).map(([k, n]) => (
                      <li key={k}>{t(`erase.kept.${k}`, { count: n, defaultValue: `${k}: ${n}` })}</li>
                    ))}
                  </ul>
                </>
              ) : null}
              <label className="pf-field">
                <span>{t("erase.reason")}</span>
                <textarea rows={2} maxLength={500} value={reason} placeholder={t("erase.reasonHint")} onChange={(e) => setReason(e.target.value)} />
              </label>
              <ErrorNote error={eraseError} />
              <div className="pf-actions gw-erase__actions">
                <button type="button" className="pf-btn" onClick={() => setOpen(false)} disabled={erasing}>
                  {t("pf.cancel")}
                </button>
                <BusyButton
                  tone="danger"
                  icon={Trash2}
                  label={t("erase.confirm")}
                  busyLabel={t("erase.deleting")}
                  busy={erasing}
                  onClick={async () => {
                    const r = await dispatch(erasePerson({ entity, id, reason }));
                    if (erasePerson.fulfilled.match(r)) {
                      setOpen(false);
                      onDeleted();
                    }
                  }}
                />
              </div>
            </>
          )}
        </div>
      </Modal>
    </>
  );
}
