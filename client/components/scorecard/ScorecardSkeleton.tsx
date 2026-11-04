import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";

/** Shimmer block; `w`/`h` are any CSS length. */
function Bone({ w, h, round, className }: { w?: string; h?: string; round?: boolean; className?: string }) {
  return <span className={cn("sc-bone", round && "is-round", className)} style={{ width: w, height: h }} aria-hidden />;
}

/** Gauge placeholder: a soft track with a sweeping gold arc. */
function RingBone({ size }: { size: number }) {
  return (
    <span className="sc-ring-bone" style={{ width: size, height: size }} aria-hidden>
      <span className="sc-ring-bone__core" />
    </span>
  );
}

const BAR_HEIGHTS = [52, 64, 58, 72, 66, 80, 70, 86, 76];

/**
 * Loading state for Admin -> Scorecards: same grid as the real board (hero, follow-ups,
 * ranked rows), so nothing jumps when the data lands.
 */
export function ScorecardBoardSkeleton() {
  const { t } = useTranslation();
  return (
    <div className="sc-skel" role="status" aria-live="polite" aria-label={t("scorecards.loading")}>
      <section className="sc-hero">
        <div className="sc-hero__avg pf-card">
          <RingBone size={132} />
          <div className="sc-skel__stack">
            <Bone w="7rem" h="0.8rem" />
            <Bone w="4.5rem" h="2.4rem" />
            <Bone w="11rem" h="0.75rem" />
            <Bone w="8rem" h="0.75rem" />
          </div>
        </div>
        <div className="sc-hero__trend pf-card">
          <Bone w="10rem" h="0.8rem" />
          <div className="sc-bars sc-skel__bars">
            {BAR_HEIGHTS.map((h, i) => (
              <div key={i} className="sc-bars__col">
                <span className="sc-skel__bar" style={{ height: `${h}%`, animationDelay: `${i * 70}ms` }} />
                <Bone w="2rem" h="0.55rem" />
              </div>
            ))}
          </div>
        </div>
        <div className="sc-hero__mix pf-card">
          <Bone w="7rem" h="0.8rem" />
          <div className="sc-donut">
            <RingBone size={132} />
            <div className="sc-skel__stack">
              {[0, 1, 2, 3].map((i) => (
                <Bone key={i} w="6.5rem" h="0.8rem" />
              ))}
            </div>
          </div>
        </div>
      </section>
      <div className="sc-toolbar">
        <Bone w="min(100%, 26rem)" h="2.4rem" className="is-pill" />
      </div>
      <div className="sc-board">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="sc-row sc-skel__row" style={{ animationDelay: `${i * 80}ms` }}>
            <Bone w="1rem" h="0.9rem" />
            <Bone w="2.6rem" h="2.6rem" round />
            <span className="sc-row__who">
              <Bone w={`${60 + ((i * 13) % 30)}%`} h="0.95rem" />
              <Bone w="5.5rem" h="0.75rem" className="is-pill" />
            </span>
            <span className="sc-row__metrics">
              {[0, 1, 2, 3, 4].map((k) => (
                <span key={k} className="sc-skel__metric" style={{ height: `${40 + ((i + k * 7) % 6) * 10}%` }} />
              ))}
            </span>
            <span className="sc-row__trend">
              <Bone w="7.5rem" h="1.6rem" />
              <Bone w="6.5rem" h="1rem" />
            </span>
            <RingBone size={56} />
            <span />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Loading state for one person's scorecard (identity card, tabs, ring + trend + metrics). */
export function ScorecardDetailSkeleton() {
  const { t } = useTranslation();
  return (
    <div className="sc-skel" role="status" aria-live="polite" aria-label={t("scorecards.loading")}>
      <section className="pf-card sc-person">
        <Bone w="3.6rem" h="3.6rem" round />
        <div className="sc-person__who sc-skel__stack">
          <Bone w="5rem" h="0.7rem" />
          <Bone w="12rem" h="1.3rem" />
          <Bone w="min(100%, 20rem)" h="0.8rem" />
        </div>
        <div className="sc-person__roles">
          <Bone w="7rem" h="2.2rem" className="is-pill" />
          <Bone w="11rem" h="2.2rem" className="is-pill" />
        </div>
      </section>
      <Bone w="min(100%, 24rem)" h="2.4rem" className="is-pill" />
      <div className="sc-cards">
        <section className="pf-card sc-cardpanel sc-skel__panel">
          <div className="sc-cardpanel__head">
            <RingBone size={148} />
            <div className="sc-cardpanel__summary">
              <Bone w="5rem" h="0.7rem" />
              <Bone w="10rem" h="1.6rem" />
              <Bone w="12rem" h="0.8rem" />
              <Bone w="5rem" h="1.5rem" className="is-pill" />
              <span className="sc-streak">
                {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
                  <Bone key={i} w="1.15rem" h="1.15rem" />
                ))}
              </span>
            </div>
          </div>
          <div className="sc-skel__chart" aria-hidden>
            <svg viewBox="0 0 640 180" preserveAspectRatio="none">
              <path className="sc-skel__line" d="M0,110 C80,90 120,130 200,100 S330,60 400,85 S520,120 640,70" />
            </svg>
          </div>
          <div className="sc-metrics">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="sc-metric sc-skel__mcard">
                <div className="sc-metric__top">
                  <Bone w="60%" h="0.85rem" />
                  <Bone w="2.5rem" h="0.7rem" />
                </div>
                <span className="sc-skel__track">
                  <span style={{ width: `${45 + i * 11}%`, animationDelay: `${i * 90}ms` }} />
                </span>
                <div className="sc-metric__foot">
                  <Bone w="55%" h="0.7rem" />
                  <Bone w="1.8rem" h="1.1rem" />
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
