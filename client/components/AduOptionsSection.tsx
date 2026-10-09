import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Expand } from "lucide-react";
import { useTranslation } from "react-i18next";
import PlanDetailLightbox from "@/components/PlanDetailLightbox";

const PLAN_OPTIONS = [1, 2, 3] as const;
const ASSET_V = "20261002i";

/** Interactive ADU floor-plan picker — 3D card preview; detail shows 3D + CAD. */
export default function AduOptionsSection() {
  const { t } = useTranslation();
  const [activePlan, setActivePlan] =
    useState<(typeof PLAN_OPTIONS)[number]>(1);
  const [lightboxOpen, setLightboxOpen] = useState(false);

  const threeDSrc = `/adu/plan-3d-${activePlan}.jpg?v=${ASSET_V}`;
  const cadSrc = `/adu/plan-cad-${activePlan}.png?v=${ASSET_V}`;
  const planTitle = t(`options.plan${activePlan}Title`);
  const threeDAlt = t(`options.plan${activePlan}Alt3d`);
  const cadAlt = t(`options.plan${activePlan}AltCad`);

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
              aria-label={t("options.openLightbox", { plan: planTitle })}
            >
              <img
                key={activePlan}
                src={threeDSrc}
                alt={threeDAlt}
                loading="lazy"
              />
              <span className="adu-option-zoom-hint">
                <Expand size={15} aria-hidden /> {t("options.viewMoreDetails")}
              </span>
            </button>
          </figure>
          <div className="adu-option-card-meta">
            <strong>{planTitle}</strong>
            <p>{t(`options.plan${activePlan}Body`)}</p>
          </div>
          <Link className="button button-ink adu-option-cta" to="/contact">
            {t("designs.cta")} <ArrowRight size={15} />
          </Link>
        </article>
      </div>

      <PlanDetailLightbox
        open={lightboxOpen}
        title={t("options.detailTitle", { plan: planTitle })}
        threeDSrc={threeDSrc}
        threeDAlt={threeDAlt}
        cadSrc={cadSrc}
        cadAlt={cadAlt}
        onClose={() => setLightboxOpen(false)}
      />
    </section>
  );
}
