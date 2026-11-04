import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Send } from "lucide-react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchUnsentLinks, sendAllAffiliateLinks } from "@/store/slices/affiliateLinkSlice";
import { BusyButton } from "@/components/portal/kit";
import { useAdminCan } from "@/hooks/useAdminCan";

/** Affiliates list: approved affiliates who never received their referral link, with a confirmed bulk send. */
export default function UnsentLinksBanner() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const canSend = useAdminCan("approvals");
  const { unsent, bulkSending, bulkResult } = useAppSelector((s) => s.affiliateLink);
  useEffect(() => {
    if (canSend) void dispatch(fetchUnsentLinks());
  }, [dispatch, canSend]);
  if (!canSend) return null;
  if (bulkResult) {
    return (
      <p className="gw-resign" role="status">
        {t("affLinkSend.bulkDone", { count: bulkResult.sent })}
        {bulkResult.failed ? ` ${t("affLinkSend.bulkFailed", { count: bulkResult.failed })}` : ""}
      </p>
    );
  }
  if (!unsent) return null;
  return (
    <div className="gw-resign">
      <p>{t("affLinkSend.bulkCount", { count: unsent })}</p>
      <BusyButton
        tone="gold"
        icon={Send}
        label={t("affLinkSend.bulkCta", { count: unsent })}
        busy={bulkSending}
        onClick={() => {
          if (window.confirm(t("affLinkSend.bulkConfirm", { count: unsent }))) void dispatch(sendAllAffiliateLinks());
        }}
      />
    </div>
  );
}
