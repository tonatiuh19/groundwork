import { useEffect, useState } from "react";
import { Landmark } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { setProjectFundsReceived } from "@/store/slices/cityPartnerSlice";
import { BusyButton, ErrorNote } from "@/components/portal/kit";
import { centsToMoney } from "@/components/city/CityBits";

/** Finance marks when the project's money landed; City Partner fees for Opened Cities follow (due in 5 days). */
export default function ProjectFundsPanel({ publicId, value }: { publicId: string; value: string | null | undefined }) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const { saving, error } = useAppSelector((s) => s.cityPartner);
  const [date, setDate] = useState(value ? String(value).slice(0, 10) : "");
  const [result, setResult] = useState<string | null>(null);
  useEffect(() => setDate(value ? String(value).slice(0, 10) : ""), [value]);
  return (
    <section className="pf-section pf-form">
      <h2 className="pf-h2">
        <Landmark size={18} aria-hidden /> {t("cityPartner.fundsTitle")}
      </h2>
      <p className="pf-hint">{t("cityPartner.fundsHint")}</p>
      <div className="gw-mail-org__add">
        <input type="date" value={date} aria-label={t("cityPartner.fundsTitle")} onChange={(e) => setDate(e.target.value)} />
        <BusyButton
          tone="gold"
          label={t("pf.save")}
          busy={saving}
          onClick={async () => {
            const r = await dispatch(setProjectFundsReceived({ publicId, date: date || null }));
            if (setProjectFundsReceived.fulfilled.match(r)) {
              const live = r.payload.fees.filter((f) => f.status !== "void");
              setResult(live.length ? t("cityPartner.fundsFees", { count: live.length, total: centsToMoney(live.reduce((n, f) => n + f.amount_cents, 0)) }) : t("cityPartner.fundsNoFees"));
            }
          }}
        />
      </div>
      {result ? <p className="pf-hint">{result}</p> : null}
      <ErrorNote error={error} />
    </section>
  );
}
