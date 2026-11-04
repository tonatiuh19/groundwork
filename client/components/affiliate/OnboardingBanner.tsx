import { useEffect } from "react";
import { Link } from "react-router-dom";
import { FileSignature } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchAffiliateOnboarding } from "@/store/slices/affiliateOnboardingSlice";

/**
 * "Action needed" banner on the affiliate dashboard / commissions until the
 * agreement is signed, a W-9 is on file and the membership card is active
 * (payouts are held until then). Names the step that is actually missing.
 */
export default function OnboardingBanner() {
  const { t, i18n } = useTranslation();
  const dispatch = useAppDispatch();
  const portal = useAppSelector((s) => s.affiliateOnboarding.portal);

  useEffect(() => {
    if (!portal) void dispatch(fetchAffiliateOnboarding(i18n.language?.startsWith("es") ? "es" : "en"));
  }, [dispatch, portal, i18n.language]);

  if (!portal || portal.affiliate.status !== "active") return null;
  const { state } = portal;
  // Ready for payouts, unless a newer agreement is waiting for their signature.
  if (state.payout_ready && !state.agreement_outdated) return null;
  const key =
    state.subscription_price_cents == null
      ? "affAgreement.bannerPending"
      : state.agreement_outdated
        ? "affAgreement.bannerResign"
        : !state.agreement_signed
        ? "affAgreement.bannerSign"
        : state.w9_status === "rejected"
          ? "affAgreement.bannerW9Fix"
          : state.w9_status === "missing"
            ? "affAgreement.bannerW9"
            : // Agreement + W-9 done: the only thing left is the membership card.
              portal.billing.status === "past_due"
              ? "affAgreement.bannerCardFix"
              : "affAgreement.bannerCard";
  return (
    <section className="gw-onboard-banner" role="status">
      <FileSignature size={20} aria-hidden />
      <div>
        <p className="gw-onboard-banner__title">{t("affAgreement.bannerTitle")}</p>
        <p>{t(key)}</p>
      </div>
      {state.subscription_price_cents != null ? (
        <Link className="button button-gold" to="/affiliate/agreement">
          {t("affAgreement.bannerCta")}
        </Link>
      ) : null}
    </section>
  );
}
