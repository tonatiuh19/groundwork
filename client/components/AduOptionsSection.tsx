import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Expand } from "lucide-react";
import { useTranslation } from "react-i18next";
import ImageLightbox from "@/components/ImageLightbox";

const PLAN_OPTIONS = [1, 2, 3] as const;

/** Interactive ADU floor-plan picker — event-section layout language. */
export default function AduOptionsSection() {
  const { t } = useTranslation();
  const [activePlan, setActivePlan] =
    useState<(typeof PLAN_OPTIONS)[number]>(1);
  const [lightboxOpen, setLightboxOpen] = useState(false);

  const planSrc = `/adu/plan-${activePlan}.png`;
  const planAlt = t(`options.plan${activePlan}Alt`);

  return (
    <section
      className="adu-options-section"
      id="adu-options"
      aria-label={t("options.aria")}
    >
      <div className="adu-options-layout">
        <div className="adu-options-copy">
          <p className="eyebrow">
            <span className="eyebrow-line" /> {t("options.eyebrow")}
          </p>
          <h2>
            {t("options.titleBefore")}
            <br />
            <em>{t("options.titleEm")}</em>
          </h2>
          <p className="section-lead">{t("options.lead")}</p>
          <div
            className="adu-options-tabs"
            role="tablist"
            aria-label={t("options.aria")}
          >
            {PLAN_OPTIONS.map((n) => (
              <button
                key={n}
                type="button"
                role="tab"
                id={`adu-option-tab-${n}`}
                aria-controls="adu-option-panel"
                aria-selected={activePlan === n}
                tabIndex={activePlan === n ? 0 : -1}
                className={
                  activePlan === n
                    ? "adu-option-tab is-active"
                    : "adu-option-tab"
                }
                onClick={() => {
                  setActivePlan(n);
                  setLightboxOpen(false);
                }}
              >
                <span className="adu-option-tab-num">0{n}</span>
                <span className="adu-option-tab-label">
                  {t(`options.plan${n}Title`)}
                </span>
              </button>
            ))}
          </div>
        </div>
        <article
          className="adu-option-card"
          id="adu-option-panel"
          role="tabpanel"
          aria-labelledby={`adu-option-tab-${activePlan}`}
          aria-live="polite"
        >
          <div className="adu-option-card-top">
            <span className="adu-option-badge">0{activePlan}</span>
            <span>{t(`options.plan${activePlan}Kicker`)}</span>
          </div>
          <figure className="adu-option-figure">
            <button
              type="button"
              className="adu-option-zoom"
              onClick={() => setLightboxOpen(true)}
              aria-label={t("options.openLightbox", {
                plan: t(`options.plan${activePlan}Title`),
              })}
            >
              <img
                key={activePlan}
                src={planSrc}
                alt={planAlt}
                loading="lazy"
              />
              <span className="adu-option-zoom-hint">
                <Expand size={15} aria-hidden /> {t("options.viewLarger")}
              </span>
            </button>
          </figure>
          <div className="adu-option-card-meta">
            <strong>{t(`options.plan${activePlan}Title`)}</strong>
            <p>{t(`options.plan${activePlan}Body`)}</p>
          </div>
          <Link className="button button-ink adu-option-cta" to="/contact">
            {t("designs.cta")} <ArrowRight size={15} />
          </Link>
        </article>
      </div>

      <ImageLightbox
        open={lightboxOpen}
        src={planSrc}
        alt={planAlt}
        onClose={() => setLightboxOpen(false)}
      />
    </section>
  );
}
