import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { BadgeCheck, ExternalLink, LockKeyhole, PlayCircle, ShieldCheck } from "lucide-react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchAffiliateOnboarding } from "@/store/slices/affiliateOnboardingSlice";
import { getOnboardingToken, setOnboardingToken } from "@/lib/onboardingToken";
import { AffiliateOnboardingFlow } from "@/pages/affiliate/Agreement";
import AffiliateHelpPanel from "@/components/affiliate/AffiliateHelpPanel";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import PageMeta from "@/components/PageMeta";
import { Loading } from "@/components/portal/kit";

/**
 * /affiliate/welcome/:token — opened from the welcome email / text. No login:
 * the token (moved out of the URL right away) authorizes only onboarding
 * (presentation → agreement → W-9 → card) and help, even while pending.
 */
export default function AffiliateWelcome() {
  const { t, i18n } = useTranslation();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { token = "" } = useParams();
  const lang = i18n.language?.startsWith("es") ? "es" : "en";
  const { portal, portalLoading, portalError } = useAppSelector((s) => s.affiliateOnboarding);
  const [ready, setReady] = useState(false);

  // Keep the token out of the address bar / history / referrers.
  useEffect(() => {
    if (/^[a-f0-9]{64}$/.test(token)) {
      setOnboardingToken(token);
      navigate("/affiliate/welcome", { replace: true });
    }
    setReady(Boolean(getOnboardingToken()));
  }, [token, navigate]);

  useEffect(() => {
    if (ready) void dispatch(fetchAffiliateOnboarding(lang));
  }, [ready, lang, dispatch]);

  const done = portal ? portal.state.agreement_signed && ["submitted", "accepted"].includes(portal.state.w9_status) && portal.state.billing_ready && portal.billing.status !== "none" : false;
  const invalid = (ready && !portalLoading && !portal && portalError) || (!ready && !token);

  return (
    <div className="gw-welcome">
      <PageMeta title={t("affWelcome.metaTitle")} description={t("affWelcome.lead")} noIndex />
      <header className="gw-welcome__top">
        <Link to="/" aria-label="Groundwork Capital">
          <img src="/logos/groundwork-logo.png" alt="Groundwork Capital" className="gw-welcome__logo" />
        </Link>
        <div className="gw-welcome__top-right">
          <span className="gw-welcome__secure">
            <LockKeyhole size={14} aria-hidden /> {t("affWelcome.secure")}
          </span>
          <LanguageSwitcher />
        </div>
      </header>

      <main className="gw-welcome__main">
        {invalid ? (
          <section className="gw-welcome__card gw-welcome__expired">
            <ShieldCheck size={28} aria-hidden />
            <h1>{t("affWelcome.expiredTitle")}</h1>
            <p>{t("affWelcome.expiredLead")}</p>
            <Link className="button button-gold" to="/affiliate/login">
              {t("affWelcome.signIn")}
            </Link>
          </section>
        ) : !portal ? (
          <Loading />
        ) : (
          <>
            <section className="gw-welcome__hero">
              <span className="gw-welcome__eyebrow">{t("affWelcome.eyebrow")}</span>
              <h1>{t("affWelcome.title", { name: portal.affiliate.first_name })}</h1>
              <p>{t("affWelcome.lead")}</p>
              {portal.affiliate.status === "pending" ? (
                <p className="gw-welcome__pending">
                  <BadgeCheck size={15} aria-hidden /> {t("affWelcome.pendingNote")}
                </p>
              ) : null}
            </section>

            {portal.presentation_url ? (
              <a className="gw-welcome__deck" href={portal.presentation_url} target="_blank" rel="noreferrer noopener">
                <span className="gw-welcome__deck-play" aria-hidden>
                  <PlayCircle size={30} />
                </span>
                <span className="gw-welcome__deck-text">
                  <strong>{t("affWelcome.deckTitle")}</strong>
                  <span>{t("affWelcome.deckLead")}</span>
                </span>
                <ExternalLink size={16} aria-hidden />
              </a>
            ) : null}

            {done ? (
              <section className="gw-welcome__card gw-welcome__done" role="status">
                <BadgeCheck size={28} aria-hidden />
                <h2>{t("affWelcome.doneTitle")}</h2>
                <p>{portal.affiliate.status === "active" ? t("affWelcome.doneActive") : t("affWelcome.donePending")}</p>
                {portal.affiliate.status === "active" ? (
                  <Link className="button button-gold" to="/affiliate/login">
                    {t("affWelcome.signIn")}
                  </Link>
                ) : null}
              </section>
            ) : null}

            <AffiliateOnboardingFlow mode="welcome" />
            <AffiliateHelpPanel compact />
          </>
        )}
      </main>
    </div>
  );
}
