import { Link } from "react-router-dom";
import {
  ArrowRight,
  FileText,
  Handshake,
  HardHat,
  Home,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import PageMeta, { breadcrumbSchema } from "@/components/PageMeta";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";

const OPTIONS = [
  {
    key: "credit",
    to: "/get-credit-report#free-report",
    icon: FileText,
    tone: "accent",
  },
  {
    key: "homeowner",
    to: "/client/signup",
    icon: Home,
    tone: "light",
  },
  {
    key: "affiliate",
    to: "/affiliate/signup",
    icon: Handshake,
    tone: "light",
  },
  {
    key: "contractor",
    to: "/contractor/signup",
    icon: HardHat,
    tone: "light",
  },
] as const;

export default function Join() {
  const { t } = useTranslation();

  return (
    <div className="groundwork-page">
      <PageMeta
        title={t("join.metaTitle")}
        description={t("join.metaDescription")}
        canonical="/join"
        jsonLd={[
          breadcrumbSchema([
            { name: t("brand.name"), path: "/" },
            { name: t("join.heading"), path: "/join" },
          ]),
        ]}
      />
      <SiteHeader />
      <main id="top">
        <section className="interior-hero section-shell">
          <p className="eyebrow">
            <span className="eyebrow-line" /> {t("join.eyebrow")}
          </p>
          <h1>{t("join.heading")}</h1>
          <p className="section-lead">{t("join.lead")}</p>
        </section>

        <section
          className="section-shell join-options"
          aria-label={t("join.optionsAria")}
        >
          <div className="join-grid">
            {OPTIONS.map((opt) => {
              const Icon = opt.icon;
              return (
                <Link
                  key={opt.key}
                  to={opt.to}
                  className={`join-card join-card--${opt.tone}`}
                >
                  <span className="join-card-kicker">
                    <Icon size={18} strokeWidth={1.6} aria-hidden />
                    {t(`join.${opt.key}.kicker`)}
                  </span>
                  <h2>{t(`join.${opt.key}.title`)}</h2>
                  <p>{t(`join.${opt.key}.body`)}</p>
                  <span className="join-card-cta">
                    {t(`join.${opt.key}.cta`)} <ArrowRight size={15} />
                  </span>
                </Link>
              );
            })}
          </div>
        </section>

        <section className="section-shell join-signin">
          <p className="join-signin-lead">{t("join.alreadyAccount")}</p>
          <div className="join-signin-links">
            <Link className="text-link" to="/client/login">
              {t("join.signInHomeowner")}
            </Link>
            <Link className="text-link" to="/affiliate/login">
              {t("join.signInAffiliate")}
            </Link>
            <Link className="text-link" to="/contractor/login">
              {t("join.signInContractor")}
            </Link>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
