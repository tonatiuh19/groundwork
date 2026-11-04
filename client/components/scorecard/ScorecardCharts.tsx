import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ScorecardColor, ScorecardMetric, ScorecardWeekPoint } from "@shared/api";
import { cn } from "@/lib/cn";

/** Status colors shared by every scorecard visual (also used as CSS classes `is-<color>`). */
export const SC_COLORS: Record<ScorecardColor, string> = {
  green: "#1f9d6b",
  yellow: "#e0b23a",
  orange: "#e07a2e",
  red: "#d0453a",
  none: "#c3c8d0",
};

/** "Oct 26" from a YYYY-MM-DD week key, in the viewer's language (no timezone shift). */
export function weekLabel(key: string, lang: string, withYear = false): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Intl.DateTimeFormat(lang, { month: "short", day: "numeric", ...(withYear ? { year: "numeric" } : {}), timeZone: "UTC" }).format(
    new Date(Date.UTC(y, m - 1, d)),
  );
}

/** Animated radial gauge: score arc in the status color, grade letter in the middle. */
export function ScoreRing({
  score,
  grade,
  color,
  size = 120,
  stroke = 10,
  label,
}: {
  score: number | null;
  grade: string | null;
  color: ScorecardColor;
  size?: number;
  stroke?: number;
  label?: string;
}) {
  const gid = useId().replace(/:/g, "");
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = score == null ? 0 : Math.max(0, Math.min(100, score)) / 100;
  const hue = SC_COLORS[color];
  return (
    <div className="sc-ring" style={{ width: size, height: size }} role="img" aria-label={label || (grade ? `${grade} ${score}` : "-")}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <defs>
          <linearGradient id={`g${gid}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={hue} stopOpacity="0.75" />
            <stop offset="100%" stopColor={hue} />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(14,42,74,0.08)" strokeWidth={stroke} />
        <circle
          className="sc-ring__arc"
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={`url(#g${gid})`}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div className="sc-ring__center">
        <strong style={{ color: grade ? hue : undefined, fontSize: size * 0.3 }}>{grade || "-"}</strong>
        {size >= 80 ? <span>{score == null ? "" : Math.round(score)}</span> : null}
      </div>
    </div>
  );
}

/** Tiny inline trend of the last weeks (dots colored by status). */
export function Sparkline({ points, width = 120, height = 32 }: { points: ScorecardWeekPoint[]; width?: number; height?: number }) {
  const pts = points.map((p, i) => ({ ...p, x: points.length < 2 ? width / 2 : 4 + (i * (width - 8)) / (points.length - 1) }));
  const y = (s: number) => height - 4 - (Math.max(40, Math.min(100, s)) - 40) * ((height - 8) / 60);
  const graded = pts.filter((p) => p.score != null);
  const d = graded.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)},${y(p.score as number).toFixed(1)}`).join(" ");
  return (
    <svg className="sc-spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden>
      <line x1="0" x2={width} y1={y(90)} y2={y(90)} stroke="rgba(31,157,107,0.25)" strokeDasharray="2 3" />
      <line x1="0" x2={width} y1={y(70)} y2={y(70)} stroke="rgba(224,122,46,0.25)" strokeDasharray="2 3" />
      {d ? <path d={d} fill="none" stroke="#0e2a4a" strokeOpacity="0.55" strokeWidth="1.6" strokeLinejoin="round" /> : null}
      {graded.map((p) => (
        <circle key={p.week_start} cx={p.x} cy={y(p.score as number)} r="2.6" fill={SC_COLORS[p.color]} />
      ))}
    </svg>
  );
}

/** One square per week, colored by status: the streak at a glance. */
export function StreakStrip({ points, lang }: { points: ScorecardWeekPoint[]; lang: string }) {
  return (
    <div className="sc-streak" aria-hidden>
      {points.map((p) => (
        <span key={p.week_start} className={cn("sc-streak__cell", `is-${p.color}`, p.termination_review && "is-term")} title={`${weekLabel(p.week_start, lang)} · ${p.grade || "-"}`}>
          {p.grade || ""}
        </span>
      ))}
    </div>
  );
}

const BANDS: { from: number; to: number; grade: string; fill: string }[] = [
  { from: 90, to: 100, grade: "A", fill: "rgba(31,157,107,0.10)" },
  { from: 80, to: 90, grade: "B", fill: "rgba(31,157,107,0.05)" },
  { from: 70, to: 80, grade: "C", fill: "rgba(224,178,58,0.09)" },
  { from: 60, to: 70, grade: "D", fill: "rgba(224,122,46,0.09)" },
  { from: 0, to: 60, grade: "F", fill: "rgba(208,69,58,0.08)" },
];

/**
 * Weekly score over time on top of the A-F bands. Points take the week's status color; a ring
 * marks the selected week, and hovering shows the week's score.
 */
export function TrendChart({
  points,
  selected,
  onSelect,
  height = 220,
}: {
  points: ScorecardWeekPoint[];
  selected?: string;
  onSelect?: (week: string) => void;
  height?: number;
}) {
  const { i18n, t } = useTranslation();
  const gid = useId().replace(/:/g, "");
  const [hover, setHover] = useState<string | null>(null);
  // Real pixel width (no SVG stretching, so labels stay crisp at any size).
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(640);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(240, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const H = height;
  const L = 28;
  const R = 12;
  const T = 12;
  const B = 28;
  const minY = 30;
  const x = (i: number) => (points.length < 2 ? (L + W - R) / 2 : L + (i * (W - L - R)) / (points.length - 1));
  const y = (s: number) => T + (100 - Math.max(minY, Math.min(100, s))) * ((H - T - B) / (100 - minY));
  const graded = points.map((p, i) => ({ ...p, i })).filter((p) => p.score != null);
  const line = graded.map((p, k) => `${k ? "L" : "M"}${x(p.i).toFixed(1)},${y(p.score as number).toFixed(1)}`).join(" ");
  const area = graded.length > 1 ? `${line} L${x(graded[graded.length - 1].i).toFixed(1)},${H - B} L${x(graded[0].i).toFixed(1)},${H - B} Z` : "";
  const hp = points.find((p) => p.week_start === hover);
  const hi = hp ? points.indexOf(hp) : -1;
  return (
    <div className="sc-trend" ref={box}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t("scorecards.trendAria")}>
        <defs>
          <linearGradient id={`a${gid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#d9a441" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#d9a441" stopOpacity="0" />
          </linearGradient>
        </defs>
        {BANDS.map((b) => (
          <g key={b.grade}>
            <rect x={L} width={W - L - R} y={y(b.to)} height={Math.max(0, y(Math.max(b.from, minY)) - y(b.to))} fill={b.fill} />
            <text x={L - 8} y={(y(b.to) + y(Math.max(b.from, minY))) / 2 + 4} textAnchor="end" className="sc-trend__band">
              {b.grade}
            </text>
          </g>
        ))}
        {area ? <path d={area} fill={`url(#a${gid})`} /> : null}
        {line ? <path className="sc-trend__line" d={line} fill="none" stroke="#0e2a4a" strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round" /> : null}
        {points.map((p, i) => (
          <g key={p.week_start}>
            <rect
              x={x(i) - (W - L - R) / Math.max(1, points.length - 1) / 2}
              width={(W - L - R) / Math.max(1, points.length - 1)}
              y={T}
              height={H - T - B}
              fill="transparent"
              style={{ cursor: onSelect ? "pointer" : undefined }}
              onMouseEnter={() => setHover(p.week_start)}
              onMouseLeave={() => setHover(null)}
              onClick={() => onSelect?.(p.week_start)}
            />
            {i % Math.ceil(points.length / Math.max(2, Math.floor(W / 90))) === 0 || i === points.length - 1 ? (
              <text x={x(i)} y={H - 8} textAnchor="middle" className="sc-trend__tick">
                {weekLabel(p.week_start, i18n.language)}
              </text>
            ) : null}
          </g>
        ))}
        {graded.map((p) => (
          <g key={`d${p.week_start}`} pointerEvents="none">
            {p.week_start === selected ? <circle cx={x(p.i)} cy={y(p.score as number)} r="9" fill="none" stroke={SC_COLORS[p.color]} strokeWidth="2" /> : null}
            <circle cx={x(p.i)} cy={y(p.score as number)} r={p.week_start === hover ? 6 : 4.5} fill={SC_COLORS[p.color]} stroke="#fff" strokeWidth="1.5" />
          </g>
        ))}
      </svg>
      {hp ? (
        <div className="sc-trend__tip" style={{ left: `${(x(hi) / W) * 100}%`, top: `${((hp.score == null ? H - B : y(hp.score)) / H) * 100}%` }}>
          <strong>{hp.grade || "-"}</strong> {hp.score == null ? t("scorecards.notGraded") : Math.round(hp.score)}
          <span>{weekLabel(hp.week_start, i18n.language, true)}</span>
        </div>
      ) : null}
    </div>
  );
}

/** Metric row: actual vs goal bar with the goal marker, weight and points earned. */
export function MetricBar({ metric, active, onClick }: { metric: ScorecardMetric; active?: boolean; onClick?: () => void }) {
  const { t } = useTranslation();
  const isCount = metric.unit === "count";
  const goal = isCount ? metric.goal ?? metric.target : metric.target;
  const scale = isCount ? Math.max(goal * 1.5, metric.met, 1) : 100;
  const val = metric.value ?? 0;
  const fillPct = Math.min(100, (val / scale) * 100);
  const goalPct = Math.min(100, (goal / scale) * 100);
  const tone = metric.score == null ? "none" : metric.score >= 90 ? "green" : metric.score >= 70 ? "yellow" : metric.score >= 60 ? "orange" : "red";
  const Tag = onClick ? "button" : "div";
  return (
    <Tag type={onClick ? "button" : undefined} className={cn("sc-metric", `is-${tone}`, active && "is-active")} onClick={onClick}>
      <div className="sc-metric__top">
        <span className="sc-metric__name">{t(`scorecards.m_${metric.key}`)}</span>
        <span className="sc-metric__weight">{t("scorecards.weightPts", { n: metric.weight })}</span>
      </div>
      <div className="sc-metric__bar">
        <span className="sc-metric__fill" style={{ width: `${metric.value == null ? 0 : fillPct}%` }} />
        <span className="sc-metric__goal" style={{ left: `${goalPct}%` }} title={t("scorecards.goal")} />
      </div>
      <div className="sc-metric__foot">
        <span>
          {metric.value == null
            ? t("scorecards.notGraded")
            : isCount
              ? t("scorecards.countOf", { n: metric.met, goal: goal })
              : t("scorecards.pctOf", { pct: Math.round(val), met: metric.met, total: metric.total, goal })}
        </span>
        <strong>{metric.score == null ? "-" : Math.round(metric.score)}</strong>
      </div>
    </Tag>
  );
}

/** Donut of how many people are green / yellow / orange / red this week. */
export function ColorDonut({ counts, size = 132 }: { counts: Record<ScorecardColor, number>; size?: number }) {
  const { t } = useTranslation();
  const order: ScorecardColor[] = ["green", "yellow", "orange", "red", "none"];
  const total = order.reduce((n, k) => n + counts[k], 0);
  const stroke = 16;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const segs = useMemo(() => {
    let acc = 0;
    return order
      .filter((k) => counts[k] > 0)
      .map((k) => {
        const len = (counts[k] / Math.max(1, total)) * c;
        const s = { k, len, off: acc };
        acc += len;
        return s;
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [counts, total, c]);
  return (
    <div className="sc-donut">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={t("scorecards.distributionAria")}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(14,42,74,0.07)" strokeWidth={stroke} />
        {segs.map((s) => (
          <circle
            key={s.k}
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={SC_COLORS[s.k]}
            strokeWidth={stroke}
            strokeDasharray={`${Math.max(0, s.len - 2)} ${c}`}
            strokeDashoffset={-s.off}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        ))}
        <text x="50%" y="48%" textAnchor="middle" className="sc-donut__n">
          {total}
        </text>
        <text x="50%" y="64%" textAnchor="middle" className="sc-donut__l">
          {t("scorecards.people")}
        </text>
      </svg>
      <ul className="sc-donut__legend">
        {order
          .filter((k) => k !== "none" || counts.none > 0)
          .map((k) => (
            <li key={k}>
              <i style={{ background: SC_COLORS[k] }} /> {t(`scorecards.color_${k}`)} <b>{counts[k]}</b>
            </li>
          ))}
      </ul>
    </div>
  );
}

/** Average score per week across everyone shown (bars colored by grade band). */
export function TeamBars({ weeks, avg }: { weeks: string[]; avg: (number | null)[] }) {
  const { i18n } = useTranslation();
  const max = 100;
  return (
    <div className="sc-bars" role="img" aria-hidden>
      {weeks.map((w, i) => {
        const v = avg[i];
        const tone = v == null ? "none" : v >= 80 ? "green" : v >= 70 ? "yellow" : v >= 60 ? "orange" : "red";
        return (
          <div key={w} className="sc-bars__col" title={v == null ? "-" : String(Math.round(v))}>
            <span className={cn("sc-bars__bar", `is-${tone}`)} style={{ height: `${v == null ? 4 : Math.max(6, (v / max) * 100)}%` }}>
              {v == null ? null : <em>{Math.round(v)}</em>}
            </span>
            <small>{weekLabel(w, i18n.language)}</small>
          </div>
        );
      })}
    </div>
  );
}
