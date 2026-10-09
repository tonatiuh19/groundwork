import { Link } from "react-router-dom";
import {
  ArrowRight,
  Check,
  Clock3,
  HandHelping,
  Home,
  PiggyBank,
  ShieldAlert,
  Target,
  Users,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import AduDesignsStage from "@/components/AduDesignsStage";

const BENEFIT_ICONS = [HandHelping, PiggyBank, Clock3, Home] as const;

/** Education / proof / partner teaser — styled to match existing Groundwork sections. */
export default function HomeMarketingSections() {
  const { t } = useTranslation();

  return (
    <>
      <section
        className="benefits-section section-shell"
        id="benefits"
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

      <section className="edu-what section-shell" id="what-is-adu">
        <div className="section-heading">
          <p className="eyebrow">
            <span className="eyebrow-line" /> {t("edu.whatEyebrow")}
          </p>
          <h2>{t("edu.whatTitle")}</h2>
          <p className="section-lead">{t("edu.whatBody")}</p>
        </div>
      </section>

      <section className="why-adu-band" id="why-adu">
        <div className="why-adu-inner">
          <p className="eyebrow why-adu-eyebrow">
            <span className="eyebrow-line" /> {t("edu.whyEyebrow")}
          </p>
          <h2>{t("edu.whyTitle")}</h2>
          <div className="why-adu-cards">
            <article className="why-adu-card">
              <span className="why-adu-badge why-adu-badge-gold" aria-hidden>
                <Target size={28} strokeWidth={1.6} />
              </span>
              <h3>{t("edu.challengesTitle")}</h3>
              <ul className="why-adu-list why-adu-list-challenges">
                {[1, 2, 3].map((n) => (
                  <li key={n}>
                    <Target size={16} strokeWidth={1.8} aria-hidden />
                    <span>{t(`edu.challenge${n}`)}</span>
                  </li>
                ))}
              </ul>
            </article>
            <article className="why-adu-card">
              <span className="why-adu-badge why-adu-badge-ink" aria-hidden>
                <Users size={26} strokeWidth={1.6} />
              </span>
              <h3>{t("edu.solutionsTitle")}</h3>
              <ul className="why-adu-list why-adu-list-solutions">
                {[1, 2, 3, 4].map((n) => (
                  <li key={n}>
                    <Check size={16} strokeWidth={2.2} aria-hidden />
                    <span>{t(`edu.solution${n}`)}</span>
                  </li>
                ))}
              </ul>
            </article>
          </div>
        </div>
      </section>

      <section className="process-section section-shell" id="full-process">
        <div className="section-heading">
          <p className="eyebrow">
            <span className="eyebrow-line" /> {t("process.eyebrow")}
          </p>
          <h2>
            {t("process.titleBefore")}
            <br />
            <em>{t("process.titleEm")}</em>
          </h2>
          <p className="section-lead">{t("process.lead")}</p>
        </div>
        <div className="process-steps">
          {[1, 2, 3, 4].map((n) => (
            <article key={n} className="process-step">
              <span className="financing-step-number">0{n}</span>
              <div>
                <h3>{t(`process.step${n}Title`)}</h3>
                <p>{t(`process.step${n}Body`)}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="risk-band" id="risks">
        <div className="risk-layout">
          <div className="risk-inner">
            <p className="eyebrow">
              <span className="eyebrow-line" /> {t("risks.eyebrow")}
            </p>
            <h2>{t("risks.title")}</h2>
            <p className="risk-lead">{t("risks.lead")}</p>
            <ul className="risk-grid">
              {[1, 2, 3, 4, 5].map((n) => (
                <li key={n}>
                  <ShieldAlert size={18} strokeWidth={1.5} aria-hidden />
                  <span>{t(`risks.item${n}`)}</span>
                </li>
              ))}
            </ul>
          </div>
          <figure className="risk-media">
            <img
              src="/adu/risk-scaffold.jpg"
              alt={t("risks.imageAlt")}
              loading="lazy"
            />
          </figure>
        </div>
      </section>

      <section className="numbers-band" id="numbers">
        <div className="numbers-inner">
          <p className="eyebrow">
            <span className="eyebrow-line" /> {t("numbers.eyebrow")}
          </p>
          <h2>{t("numbers.title")}</h2>
          <div className="numbers-grid">
            {[1, 2, 3, 4].map((n) => (
              <p key={n} className="number-tile">
                {t(`numbers.item${n}`)}
              </p>
            ))}
          </div>
        </div>
      </section>

      <section
        className="designs-section section-shell"
        id="designs"
        aria-label={t("designs.aria")}
      >
        <div className="designs-header">
          <p className="eyebrow">
            <span className="eyebrow-line" /> {t("designs.eyebrow")}
          </p>
          <h2>{t("designs.title")}</h2>
          <p className="section-lead">{t("designs.lead")}</p>
        </div>
        <AduDesignsStage />
        <div className="designs-cta-wrap">
          <Link className="button button-gold designs-cta" to="/contact">
            {t("designs.cta")} <ArrowRight size={15} />
          </Link>
        </div>
      </section>

      <section className="partner-band" id="partner-teaser">
        <div className="partner-band-inner">
          <p className="eyebrow">
            <span className="eyebrow-line" /> {t("partnerTeaser.eyebrow")}
          </p>
          <h2>{t("partnerTeaser.title")}</h2>
          <p>{t("partnerTeaser.body")}</p>
          <Link className="button button-ink" to="/partners">
            {t("partnerTeaser.cta")} <ArrowRight size={15} />
          </Link>
        </div>
      </section>
    </>
  );
}
