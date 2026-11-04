import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { CreditCard } from "lucide-react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchBillingOverview, fetchCardLinkEligible, sendAllCardLinks } from "@/store/slices/billingAdminSlice";
import { BusyButton } from "@/components/portal/kit";
import { useAdminCan } from "@/hooks/useAdminCan";

/**
 * Admin → Billing: approved affiliates / contractors with no membership running yet,
 * with a confirmed bulk "add your card" email + text (skips waived, no price, sent < 3 days).
 */
export default function BulkCardLinksBanner() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const canSend = useAdminCan("finance.write");
  const { cardLinkEligible: e, cardLinkSending, cardLinkResult } = useAppSelector((s) => s.billingAdmin);
  useEffect(() => {
    if (canSend) void dispatch(fetchCardLinkEligible());
  }, [dispatch, canSend]);
  if (!canSend) return null;
  if (cardLinkResult) {
    return (
      <p className="gw-resign" role="status">
        {t("billAdmin.bulkDone", { count: cardLinkResult.sent })}
        {cardLinkResult.failed ? ` ${t("affLinkSend.bulkFailed", { count: cardLinkResult.failed })}` : ""}
      </p>
    );
  }
  if (!e?.count) return null;
  return (
    <div className="gw-resign">
      <p>{t("billAdmin.bulkCount", { count: e.count, affiliates: e.affiliates, contractors: e.contractors })}</p>
      <BusyButton
        tone="gold"
        icon={CreditCard}
        label={t("billAdmin.bulkCta", { count: e.count })}
        busy={cardLinkSending}
        onClick={() => {
          if (!window.confirm(t("billAdmin.bulkConfirm", { count: e.count }))) return;
          void dispatch(sendAllCardLinks()).then(() => dispatch(fetchBillingOverview()));
        }}
      />
    </div>
  );
}
