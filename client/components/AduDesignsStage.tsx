import { useEffect, useId, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Expand } from "lucide-react";
import { useTranslation } from "react-i18next";
import ImageLightbox from "@/components/ImageLightbox";

const DESIGN_IDS = [1, 2, 3] as const;

function relativeSlot(index: number, active: number) {
  let delta = index - active;
  if (delta > 1) delta -= DESIGN_IDS.length;
  if (delta < -1) delta += DESIGN_IDS.length;
  return delta as -1 | 0 | 1;
}

/**
 * Three-card focus stage for ADU design sheets — center hero with angled peeks.
 * Not a carousel: click a side card or label to bring it forward; center opens lightbox.
 */
export default function AduDesignsStage() {
  const { t } = useTranslation();
  const stageId = useId();
  const [active, setActive] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);

  const activeId = DESIGN_IDS[active];
  const activeSrc = `/adu/design-viz-${activeId}.jpg?v=20261002g`;
  const activeAlt = t(`designs.alt${activeId}`);

  useEffect(() => {
    const root = stageRef.current;
    if (!root) return;

    const onKey = (e: KeyboardEvent) => {
      if (!root.contains(document.activeElement) && document.activeElement !== root) {
        return;
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        setActive((i) => (i + DESIGN_IDS.length - 1) % DESIGN_IDS.length);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        setActive((i) => (i + 1) % DESIGN_IDS.length);
      } else if (e.key === "Enter" || e.key === " ") {
        if (document.activeElement === root) {
          e.preventDefault();
          setLightboxOpen(true);
        }
      }
    };
    root.addEventListener("keydown", onKey);
    return () => root.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="designs-stage-wrap">
      <div
        ref={stageRef}
        className="designs-stage"
        role="group"
        aria-roledescription={t("designs.stageRole")}
        aria-label={t("designs.aria")}
        tabIndex={0}
      >
        <div className="designs-stage-deck" aria-live="polite">
          {DESIGN_IDS.map((id, index) => {
            const slot = relativeSlot(index, active);
            const slotClass =
              slot === 0
                ? "is-center"
                : slot === -1
                  ? "is-left"
                  : "is-right";
            const src = `/adu/design-viz-${id}.jpg?v=20261002g`;
            const alt = t(`designs.alt${id}`);
            const label = t(`designs.plan${id}Label`);

            if (slot === 0) {
              return (
                <button
                  key={id}
                  type="button"
                  className={`designs-stage-card ${slotClass}`}
                  onClick={() => setLightboxOpen(true)}
                  aria-label={t("designs.openLarger", { plan: label })}
                  aria-current="true"
                >
                  <img src={src} alt={alt} loading="lazy" draggable={false} />
                  <span className="designs-stage-zoom">
                    <Expand size={15} aria-hidden /> {t("designs.viewLarger")}
                  </span>
                </button>
              );
            }

            return (
              <button
                key={id}
                type="button"
                className={`designs-stage-card ${slotClass}`}
                onClick={() => setActive(index)}
                aria-label={t("designs.showPlan", { plan: label })}
                tabIndex={-1}
              >
                <img src={src} alt="" loading="lazy" draggable={false} />
              </button>
            );
          })}
        </div>

        <div className="designs-stage-controls">
          <button
            type="button"
            className="designs-stage-nav"
            onClick={() =>
              setActive((i) => (i + DESIGN_IDS.length - 1) % DESIGN_IDS.length)
            }
            aria-label={t("designs.prev")}
          >
            <ChevronLeft size={18} aria-hidden />
          </button>
          <div
            className="designs-stage-tabs"
            role="tablist"
            aria-label={t("designs.aria")}
          >
            {DESIGN_IDS.map((id, index) => (
              <button
                key={id}
                type="button"
                role="tab"
                id={`${stageId}-tab-${id}`}
                aria-selected={index === active}
                className={
                  index === active
                    ? "designs-stage-tab is-active"
                    : "designs-stage-tab"
                }
                onClick={() => setActive(index)}
              >
                <span className="designs-stage-tab-kicker">
                  {t(`designs.plan${id}Kicker`)}
                </span>
                <span className="designs-stage-tab-label">
                  {t(`designs.plan${id}Label`)}
                </span>
              </button>
            ))}
          </div>
          <button
            type="button"
            className="designs-stage-nav"
            onClick={() => setActive((i) => (i + 1) % DESIGN_IDS.length)}
            aria-label={t("designs.next")}
          >
            <ChevronRight size={18} aria-hidden />
          </button>
        </div>
      </div>

      <ImageLightbox
        open={lightboxOpen}
        src={activeSrc}
        alt={activeAlt}
        onClose={() => setLightboxOpen(false)}
      />
    </div>
  );
}
