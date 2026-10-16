import { useId } from "react";

/** Lightweight SVG charts for the staff dashboard (no chart library; scale to their container). */

export function WeeklyBars({
  weeks,
  series,
  label,
}: {
  weeks: { start: string }[];
  series: { key: string; values: number[]; color: string; label: string }[];
  label: string;
}) {
  const W = 320;
  const H = 120;
  const n = weeks.length;
  const max = Math.max(1, ...series.flatMap((s) => s.values));
  const group = W / n;
  const bar = Math.max(3, (group - 6) / series.length);
  return (
    <figure className="gw-chart">
      <svg viewBox={`0 0 ${W} ${H + 18}`} role="img" aria-label={label} preserveAspectRatio="none">
        {[0.5, 1].map((f) => (
          <line key={f} x1={0} x2={W} y1={H - H * f} y2={H - H * f} className="gw-chart__grid" />
        ))}
        {weeks.map((w, i) =>
          series.map((s, j) => {
            const v = s.values[i] || 0;
            const h = (v / max) * (H - 6);
            return (
              <rect key={`${w.start}-${s.key}`} x={i * group + 3 + j * bar} y={H - h} width={bar - 1} height={Math.max(h, v ? 2 : 0)} rx={1.5} fill={s.color}>
                <title>{`${s.label} · ${w.start}: ${v}`}</title>
              </rect>
            );
          }),
        )}
        {weeks.map((w, i) =>
          i % 3 === 0 ? (
            <text key={w.start} x={i * group + 2} y={H + 14} className="gw-chart__tick">
              {w.start.slice(5)}
            </text>
          ) : null,
        )}
      </svg>
      <figcaption className="gw-chart__legend">
        {series.map((s) => (
          <span key={s.key}>
            <i style={{ background: s.color }} aria-hidden /> {s.label} <b>{s.values.reduce((a, b) => a + b, 0)}</b>
          </span>
        ))}
      </figcaption>
    </figure>
  );
}

/** Horizontal bars (funnel / sources / pipeline). */
export function HBars({ rows, format = (v) => String(v), tone = "navy" }: { rows: { label: string; value: number; hint?: string }[]; format?: (v: number) => string; tone?: "navy" | "gold" }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className={`gw-hbars gw-hbars--${tone}`}>
      {rows.map((r) => (
        <li key={r.label}>
          <div className="gw-hbars__top">
            <span>{r.label}</span>
            <b>{format(r.value)}</b>
          </div>
          <div className="gw-hbars__track" aria-hidden>
            <div className="gw-hbars__fill" style={{ width: `${Math.max(2, (r.value / max) * 100)}%` }} />
          </div>
          {r.hint ? <small>{r.hint}</small> : null}
        </li>
      ))}
    </ul>
  );
}

/** Tiny trend line for stat tiles. */
export function Sparkline({ values, label }: { values: number[]; label: string }) {
  const id = useId();
  const W = 100;
  const H = 28;
  const max = Math.max(1, ...values);
  const pts = values.map((v, i) => `${(i / Math.max(1, values.length - 1)) * W},${H - (v / max) * (H - 3) - 1.5}`).join(" ");
  return (
    <svg className="gw-spark" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} preserveAspectRatio="none">
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.25" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`0,${H} ${pts} ${W},${H}`} fill={`url(#${id})`} />
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
