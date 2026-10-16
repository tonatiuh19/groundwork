import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { CreditCard } from "lucide-react";
import type { PlatformBilling } from "@shared/api";

/** Slim portal-wide banner when the card on file expires soon (30 / 7 days). */
export default function BillingNotice({ billing, to }: { billing: PlatformBilling | null; to: string }) {
  const { t } = useTranslation();
  if (!billing?.card_expiring || !billing.card) return null;
  return (
    <div className="gw-billing-notice" role="status">
      <CreditCard size={16} aria-hidden />
      <span>{t("billing.expiringNotice", { last4: billing.card.last4, exp: billing.card.exp || "" })}</span>
      <Link className="pf-btn pf-btn--sm pf-btn--gold" to={to}>
        {t("billing.updateCard")}
      </Link>
    </div>
  );
}
