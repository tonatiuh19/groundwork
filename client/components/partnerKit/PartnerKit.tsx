/**
 * Partner portal kit: the building blocks for invite-only partner portals (City Partners first, future
 * partner roles next). Brand-styled, phone-first, no chart or animation libraries.
 */
import { useEffect, useState, type ReactNode } from "react";
import { Check, Eye, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";

/** Welcome band: greeting, one line of context, a few headline numbers, and the main action. */
export function PartnerHero({ eyebrow, title, lead, stats, action }: { eyebrow: string; title: string; lead?: string; stats: { label: string; value: ReactNode; tone?: "gold" | "green" }[]; action?: ReactNode }) {
  return (
    <section className="pk-hero">
      <div className="pk-hero__glow" aria-hidden />
      <div className="pk-hero__top">
        <div>
          <p className="pk-hero__eyebrow">{eyebrow}</p>
          <h1 className="pk-hero__title">{title}</h1>
          {lead ? <p className="pk-hero__lead">{lead}</p> : null}
        </div>
        {action ? <div className="pk-hero__action">{action}</div> : null}
      </div>
      <dl className="pk-hero__stats">
        {stats.map((s) => (
          <div key={s.label} className={cn("pk-hero__stat", s.tone && `is-${s.tone}`)}>
            <dt>{s.label}</dt>
            <dd>{s.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export type FeedEntry = { id: string; icon: LucideIcon; tone?: "gold" | "green" | "ink" | "clay"; title: ReactNode; detail?: ReactNode; meta?: ReactNode; at: string; to?: string };

/** Timeline grouped by day, newest first. */
export function ActivityFeed({ items, dayLabel, empty, renderLink }: { items: FeedEntry[]; dayLabel: (isoDay: string) => string; empty: ReactNode; renderLink?: (to: string, children: ReactNode) => ReactNode }) {
  if (!items.length) return <>{empty}</>;
  const days = new Map<string, FeedEntry[]>();
  for (const it of items) {
    const d = it.at.slice(0, 10);
    days.set(d, [...(days.get(d) || []), it]);
  }
  return (
    <div className="pk-feed">
      {[...days].map(([day, list]) => (
        <section key={day} className="pk-feed__day">
          <h3 className="pk-feed__dayLabel">{dayLabel(day)}</h3>
          <ol className="pk-feed__list">
            {list.map((it) => {
              const Icon = it.icon;
              const body = (
                <>
                  <span className={cn("pk-feed__icon", `is-${it.tone || "ink"}`)} aria-hidden>
                    <Icon size={15} />
                  </span>
                  <span className="pk-feed__body">
                    <span className="pk-feed__title">{it.title}</span>
                    {it.detail ? <span className="pk-feed__detail">{it.detail}</span> : null}
                    {it.meta ? <span className="pk-feed__meta">{it.meta}</span> : null}
                  </span>
                </>
              );
              return <li key={it.id}>{it.to && renderLink ? renderLink(it.to, body) : <div className="pk-feed__row">{body}</div>}</li>;
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}

/** Stepped journey: done / current / upcoming, with the date each step was reached. */
export function JourneyTracker({ steps, currentIndex, paused, compact }: { steps: { key: string; label: string; date?: string | null }[]; currentIndex: number; paused?: boolean; compact?: boolean }) {
  return (
    <ol className={cn("pk-journey", compact && "is-compact", paused && "is-paused")} aria-label={steps[Math.max(0, currentIndex)]?.label}>
      {steps.map((s, i) => {
        const state = i < currentIndex ? "done" : i === currentIndex ? "current" : "todo";
        return (
          <li key={s.key} className={cn("pk-journey__step", `is-${state}`)} aria-current={state === "current" ? "step" : undefined}>
            <span className="pk-journey__dot">{state === "done" ? <Check size={12} aria-hidden /> : null}</span>
            {!compact ? (
              <span className="pk-journey__text">
                <strong>{s.label}</strong>
                {s.date ? <small>{s.date}</small> : null}
              </span>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

/** Bars by month: paid (solid) stacked under coming (light). Own SVG, scales to its box. */
export function EarningsChart({ data, monthLabel, money, legend }: { data: { month: string; paid: number; coming: number }[]; monthLabel: (ym: string) => string; money: (cents: number) => string; legend: { paid: string; coming: string } }) {
  const max = Math.max(1, ...data.map((d) => d.paid + d.coming));
  const W = 360;
  const H = 150;
  const bw = W / data.length;
  return (
    <figure className="pk-chart">
      <svg viewBox={`0 0 ${W} ${H + 18}`} role="img" aria-label={`${legend.paid} / ${legend.coming}`} preserveAspectRatio="none">
        {[0.25, 0.5, 0.75].map((g) => (
          <line key={g} x1={0} x2={W} y1={H - H * g} y2={H - H * g} className="pk-chart__grid" />
        ))}
        {data.map((d, i) => {
          const paidH = (d.paid / max) * H;
          const comingH = (d.coming / max) * H;
          const x = i * bw + bw * 0.18;
          const w = bw * 0.64;
          return (
            <g key={d.month}>
              <title>{`${monthLabel(d.month)}: ${legend.paid} ${money(d.paid)} · ${legend.coming} ${money(d.coming)}`}</title>
              {comingH > 0 ? <rect x={x} y={H - paidH - comingH} width={w} height={comingH} rx={3} className="pk-chart__coming" /> : null}
              {paidH > 0 ? <rect x={x} y={H - paidH} width={w} height={paidH} rx={3} className="pk-chart__paid" /> : null}
              {i % 2 === data.length % 2 ? null : <text x={x + w / 2} y={H + 14} textAnchor="middle" className="pk-chart__label">{monthLabel(d.month)}</text>}
            </g>
          );
        })}
      </svg>
      <figcaption className="pk-chart__legend">
        <span><i className="pk-chart__paid" /> {legend.paid}</span>
        <span><i className="pk-chart__coming" /> {legend.coming}</span>
      </figcaption>
    </figure>
  );
}

/** Guided setup: numbered steps with progress; the open step holds its own content. */
export function SetupStepper({ steps, progressLabel }: { steps: { key: string; title: string; hint?: string; done: boolean; waiting?: boolean; content?: ReactNode }[]; progressLabel: (done: number, total: number) => string }) {
  const done = steps.filter((s) => s.done).length;
  const openIdx = steps.findIndex((s) => !s.done);
  return (
    <div className="pk-setup">
      <div className="pk-setup__progress">
        <span>{progressLabel(done, steps.length)}</span>
        <div className="pk-setup__bar"><i style={{ width: `${(done / steps.length) * 100}%` }} /></div>
      </div>
      <ol className="pk-setup__steps">
        {steps.map((s, i) => (
          <li key={s.key} className={cn("pk-setup__step", s.done ? "is-done" : i === openIdx ? "is-open" : "is-todo", s.waiting && "is-waiting")}>
            <div className="pk-setup__head">
              <span className="pk-setup__num">{s.done ? <Check size={14} aria-hidden /> : i + 1}</span>
              <div>
                <strong>{s.title}</strong>
                {s.hint ? <small>{s.hint}</small> : null}
              </div>
            </div>
            {i === openIdx && s.content ? <div className="pk-setup__content">{s.content}</div> : null}
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Empty state that guides: icon, one sentence, optional next action. */
export function KitEmpty({ icon: Icon, title, text, action }: { icon: LucideIcon; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="pk-empty">
      <span className="pk-empty__icon" aria-hidden><Icon size={22} /></span>
      <strong>{title}</strong>
      {text ? <p>{text}</p> : null}
      {action}
    </div>
  );
}

/**
 * One-time celebration (confetti burst) for a milestone, remembered per viewer so it shows once.
 * Static under prefers-reduced-motion.
 */
export function Celebrate({ storageKey, title, text, closeLabel }: { storageKey: string; title: string; text: string; closeLabel: string }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    try {
      if (!localStorage.getItem(storageKey)) {
        setShow(true);
        localStorage.setItem(storageKey, "1");
      }
    } catch {
      setShow(false);
    }
  }, [storageKey]);
  if (!show) return null;
  return (
    <div className="pk-celebrate" role="status">
      <div className="pk-celebrate__confetti" aria-hidden>
        {Array.from({ length: 18 }, (_, i) => <i key={i} style={{ ["--i" as string]: i }} />)}
      </div>
      <strong>{title}</strong>
      <p>{text}</p>
      <button type="button" className="pf-btn pf-btn--sm" onClick={() => setShow(false)}>{closeLabel}</button>
    </div>
  );
}

/** One shimmering line, sized like the text it stands in for. */
export function SkelLine({ w = "100%", h = "0.8rem", round = false }: { w?: string; h?: string; round?: boolean }) {
  return <span className={`pk-skel__line${round ? " is-round" : ""}`} style={{ width: w, height: h }} />;
}

/**
 * Skeletons shaped like the page that is loading: `page` (hero + feed rows), `list` (rows only), `cards` (city cards grid),
 * `detail` (header, journey, two panels) and `form` (labels + fields). Hidden from screen readers; a status
 * label is announced instead. Static under prefers-reduced-motion.
 */
export function KitSkeleton({ rows = 3, layout = "page", label }: { rows?: number; layout?: "page" | "list" | "cards" | "detail" | "form"; label?: string }) {
  const row = (i: number) => (
    <div key={i} className="pk-skel__row" style={{ animationDelay: `${i * 90}ms` }}>
      <SkelLine w="2.4rem" h="2.4rem" round />
      <span className="pk-skel__stack">
        <SkelLine w={`${62 - (i % 3) * 12}%`} />
        <SkelLine w={`${38 + (i % 2) * 14}%`} h="0.65rem" />
      </span>
      <SkelLine w="4.5rem" h="1.4rem" round />
    </div>
  );
  return (
    <div className={`pk-skel pk-skel--${layout}`} role="status" aria-busy="true">
      {label ? <span className="sr-only">{label}</span> : null}
      {layout === "page" || layout === "detail" ? (
        <div className="pk-skel__hero" aria-hidden>
          <SkelLine w="7rem" h="0.65rem" />
          <SkelLine w="55%" h="1.6rem" />
          <SkelLine w="35%" />
        </div>
      ) : null}
      {layout === "detail" ? (
        <div className="pk-skel__journey" aria-hidden>
          {Array.from({ length: 6 }, (_, i) => <SkelLine key={i} w="1.6rem" h="1.6rem" round />)}
        </div>
      ) : null}
      {layout === "cards" ? (
        <div className="pk-skel__cards" aria-hidden>
          {Array.from({ length: rows }, (_, i) => (
            <div key={i} className="pk-skel__card" style={{ animationDelay: `${i * 90}ms` }}>
              <SkelLine w="60%" h="1.1rem" />
              <SkelLine w="100%" h="0.45rem" round />
              <span className="pk-skel__chips"><SkelLine w="4rem" h="1.3rem" round /><SkelLine w="5rem" h="1.3rem" round /></span>
              <SkelLine w="80%" h="0.65rem" />
            </div>
          ))}
        </div>
      ) : layout === "form" ? (
        <div className="pk-skel__form" aria-hidden>
          {Array.from({ length: rows }, (_, i) => (
            <span key={i} className="pk-skel__stack"><SkelLine w="6rem" h="0.65rem" /><SkelLine h="2.6rem" /></span>
          ))}
        </div>
      ) : (
        <div className={layout === "detail" ? "pk-skel__split" : "pk-skel__list"} aria-hidden>
          {Array.from({ length: rows }, (_, i) => row(i))}
        </div>
      )}
    </div>
  );
}

/** Staff "View as" banner: pinned above a partner portal while a super admin looks read-only. */
export function ViewAsBanner({ text, exitLabel, onExit }: { text: string; exitLabel: string; onExit: () => void }) {
  return (
    <div className="pk-viewas" role="status">
      <Eye size={16} aria-hidden />
      <span className="pk-viewas__text">{text}</span>
      <button type="button" className="pk-viewas__exit" onClick={onExit}>
        {exitLabel}
      </button>
    </div>
  );
}
