import { Link } from "react-router-dom";
import {
  ArrowRight,
  Clock3,
  HandHelping,
  Home,
  PiggyBank,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import PageMeta from "@/components/PageMeta";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";

const BENEFIT_ICONS = [HandHelping, PiggyBank, Clock3, Home] as const;

export default function About() {
  const { t } = useTranslation();
  return (
    <div className="groundwork-page">
      <PageMeta
        title={t("about.metaTitle")}
        description={t("about.metaDescription")}
        canonical="/about"
      />
      <SiteHeader />
      <main id="top">
        <section className="interior-hero section-shell">
          <p className="eyebrow">
            <span className="eyebrow-line" /> {t("about.eyebrow")}
          </p>
          <h1>{t("about.heading")}</h1>
          <p className="section-lead">{t("about.lead")}</p>
        </section>

        <section
          className="benefits-section section-shell"
          aria-label={t("benefits.aria")}
        >
          <div className="benefits-grid">
            {BENEFIT_ICONS.map((Icon, i) => {
              const n = i + 1;
              return (
                <article key={n} className="benefit-step">
                  <span className="step-number">0{n}</span>
                  <Icon size={28} strokeWidth={1.4} aria-hidden />
                  <h3>{t(`benefits.item${n}Title`)}</h3>
                  <p>{t(`benefits.item${n}Body`)}</p>
                </article>
              );
            })}
          </div>
        </section>

        <section className="opportunity-band">
          <div className="opportunity-inner about-who-layout">
            <div className="opportunity-intro">
              <p className="eyebrow">
                <span className="eyebrow-line" /> {t("about.whoEyebrow")}
              </p>
              <h2>{t("about.whoTitle")}</h2>
            </div>
            <p className="about-who-copy">{t("about.whoBody")}</p>
          </div>
        </section>

        <section className="statement-section" id="mission">
          <div className="statement-rule" aria-hidden />
          <p className="eyebrow">{t("about.missionEyebrow")}</p>
          <h2>
            {t("about.missionTitleBefore")}{" "}
            <em>{t("about.missionTitleEm")}</em>
          </h2>
          <p className="statement-copy">{t("about.missionBody")}</p>
        </section>

        <section className="financing-explainer about-why-band">
          <div className="financing-intro">
            <p className="eyebrow">
              <span className="eyebrow-line" /> {t("about.eyebrow")}
            </p>
            <h2>{t("about.whyTitle")}</h2>
            <Link className="button button-gold financing-cta" to="/contact">
              {t("about.cta")} <ArrowRight size={15} />
            </Link>
          </div>
          <ul className="rule-list">
            {[1, 2, 3, 4].map((n) => (
              <li key={n}>{t(`about.why${n}`)}</li>
            ))}
          </ul>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
