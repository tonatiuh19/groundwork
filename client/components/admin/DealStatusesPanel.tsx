import { useEffect, useState } from "react";
import { Plus, Tags } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { DealStatus, DealStatusTone } from "@shared/api";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { createDealStatus, fetchDealStatuses, updateDealStatus } from "@/store/slices/dealStatusSlice";
import { BusyButton, ErrorNote } from "@/components/portal/kit";
import DealStatusBadge from "@/components/portal/DealStatusBadge";
import { cn } from "@/lib/cn";

const TONES: DealStatusTone[] = ["warn", "bad", "neutral", "good"];

function Row({ s }: { s: DealStatus }) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const [en, setEn] = useState(s.label_en);
  const [es, setEs] = useState(s.label_es);
  useEffect(() => {
    setEn(s.label_en);
    setEs(s.label_es);
  }, [s.label_en, s.label_es]);
  const dirty = en.trim() !== s.label_en || es.trim() !== s.label_es;
  return (
    <li className={cn("gw-deal-row", !s.is_active && "is-off")}>
      <DealStatusBadge en={en} es={es} tone={s.tone} />
      <input aria-label={t("deal.labelEn")} value={en} maxLength={80} onChange={(e) => setEn(e.target.value)} />
      <input aria-label={t("deal.labelEs")} value={es} maxLength={80} onChange={(e) => setEs(e.target.value)} />
      <select
        aria-label={t("deal.tone")}
        value={s.tone}
        onChange={(e) => void dispatch(updateDealStatus({ id: s.id, patch: { tone: e.target.value as DealStatusTone } }))}
      >
        {TONES.map((tone) => (
          <option key={tone} value={tone}>{t(`deal.toneOpt.${tone}`)}</option>
        ))}
      </select>
      <div className="gw-deal-row__actions">
        {dirty ? (
          <button
            type="button"
            className="pf-btn pf-btn--sm"
            disabled={!en.trim() || !es.trim()}
            onClick={() => void dispatch(updateDealStatus({ id: s.id, patch: { label_en: en.trim(), label_es: es.trim() } }))}
          >
            {t("pf.save")}
          </button>
        ) : null}
        <button
          type="button"
          className="pf-btn pf-btn--sm"
          onClick={() => void dispatch(updateDealStatus({ id: s.id, patch: { is_active: !s.is_active } }))}
        >
          {t(s.is_active ? "deal.deactivate" : "deal.activate")}
        </button>
      </div>
    </li>
  );
}

/** Settings → Deal statuses: the editable list behind the client "Deal status" field. */
export default function DealStatusesPanel({ className }: { className?: string }) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const { statuses, saving, error } = useAppSelector((s) => s.dealStatus);
  const [en, setEn] = useState("");
  const [es, setEs] = useState("");
  const [tone, setTone] = useState<DealStatusTone>("warn");

  useEffect(() => {
    void dispatch(fetchDealStatuses());
  }, [dispatch]);

  return (
    <section className={cn("gw-deal-settings", className)}>
      <div className="pf-section-head">
        <h2 className="pf-h2"><Tags size={18} aria-hidden /> {t("deal.settingsTitle")}</h2>
      </div>
      <p className="pf-hint">{t("deal.settingsHint")}</p>
      <ErrorNote error={error} />
      <ul className="gw-deal-list">
        {statuses.map((s) => (
          <Row key={s.id} s={s} />
        ))}
      </ul>
      <div className="gw-deal-row gw-deal-row--new">
        <input placeholder={t("deal.labelEn")} value={en} maxLength={80} onChange={(e) => setEn(e.target.value)} />
        <input placeholder={t("deal.labelEs")} value={es} maxLength={80} onChange={(e) => setEs(e.target.value)} />
        <select aria-label={t("deal.tone")} value={tone} onChange={(e) => setTone(e.target.value as DealStatusTone)}>
          {TONES.map((x) => (
            <option key={x} value={x}>{t(`deal.toneOpt.${x}`)}</option>
          ))}
        </select>
        <BusyButton
          icon={Plus}
          label={t("deal.add")}
          busy={saving}
          disabled={!en.trim()}
          onClick={async () => {
            const r = await dispatch(
              createDealStatus({
                label_en: en.trim(),
                label_es: es.trim() || en.trim(),
                tone,
                sort_order: (statuses[statuses.length - 1]?.sort_order ?? 0) + 10,
              }),
            );
            if (createDealStatus.fulfilled.match(r)) {
              setEn("");
              setEs("");
            }
          }}
        />
      </div>
    </section>
  );
}
