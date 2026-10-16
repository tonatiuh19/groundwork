import { useTranslation } from "react-i18next";
import { ShieldCheck } from "lucide-react";
import { useAppSelector } from "@/store/hooks";
import AffiliateBillingStep from "@/components/affiliate/AffiliateBillingStep";
import { Loading } from "@/components/portal/kit";

/** Replaces every affiliate page while a failed payment is unresolved (their public link keeps working). */
export default function AffiliateBillingGate() {
  const { t } = useTranslation();
  const billing = useAppSelector((s) => s.affiliateOnboarding.status);
  return (
    <section className="pf-section gw-membership gw-membership--gate" aria-labelledby="gw-aff-gate-title">
      <div className="gw-membership__head">
        <span className="gw-membership__icon" aria-hidden>
          <ShieldCheck size={20} />
        </span>
        <div>
          <h2 id="gw-aff-gate-title" className="pf-h2">
            {t("affBilling.gateTitle")}
          </h2>
          <p className="pf-hint">{t("affBilling.gateLead")}</p>
        </div>
      </div>
      {billing ? <AffiliateBillingStep billing={billing} locked={false} mode="portal" /> : <Loading />}
    </section>
  );
}
