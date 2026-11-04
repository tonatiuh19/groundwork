import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ChevronRight, Gauge, Info, ShieldAlert, Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ScorecardAction, ScorecardBoardRow, ScorecardColor } from "@shared/api";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchScorecardBoard } from "@/store/slices/scorecardsSlice";
import { EmptyState, ErrorNote, PageHeader, SegmentedTabs } from "@/components/portal/kit";
import { ScorecardBoardSkeleton } from "@/components/scorecard/ScorecardSkeleton";
import { ColorDonut, SC_COLORS, ScoreRing, Sparkline, StreakStrip, TeamBars, weekLabel } from "@/components/scorecard/ScorecardCharts";
import { ScorecardRules } from "@/components/scorecard/ScorecardRules";
import { cn } from "@/lib/cn";

type Filter = "all" | "contractor" | "affiliate" | "attention";

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("") || "?";

/** Follow-up chip (coaching note, meeting, warning, termination review). */
export function ActionKindBadge({ kind }: { kind: ScorecardAction["kind"] }) {
  const { t } = useTranslation();
  return <span className={cn("sc-kind", `sc-kind--${kind}`)}>{t(`scorecards.kind_${kind}`)}</span>;
}

function BoardRow({ row, rank }: { row: ScorecardBoardRow; rank: number }) {
  const { t, i18n } = useTranslation();
  return (
    <Link className={cn("sc-row", `is-${row.color}`)} to={`/admin/scorecards/${row.subject_type}/${row.subject_id}`}>
      <span className="sc-row__rank">{rank}</span>
      <span className="sc-row__avatar" aria-hidden>
        {row.avatar_url ? <img src={row.avatar_url} alt="" /> : initials(row.name)}
      </span>
      <span className="sc-row__who">
        <strong>{row.name}</strong>
        <span>
          <span className={cn("sc-card-chip", `sc-card-chip--${row.scorecard}`)}>{t(`scorecards.card_${row.scorecard}`)}</span>
          {row.company ? <span className="sc-row__company">{row.company}</span> : null}
        </span>
      </span>
      <span className="sc-row__metrics" aria-hidden>
        {row.metrics.map((m) => (
          <span
            key={m.key}
            className="sc-row__metric"
            title={`${t(`scorecards.m_${m.key}`)}: ${m.score == null ? t("scorecards.notGraded") : Math.round(m.score)}`}
            style={{ ["--fill" as string]: `${m.score ?? 0}%`, ["--tone" as string]: m.score == null ? SC_COLORS.none : m.score >= 90 ? SC_COLORS.green : m.score >= 70 ? SC_COLORS.yellow : m.score >= 60 ? SC_COLORS.orange : SC_COLORS.red }}
          />
        ))}
      </span>
      <span className="sc-row__trend">
        <Sparkline points={row.trend} />
        <StreakStrip points={row.trend.slice(-6)} lang={i18n.language} />
      </span>
      <span className="sc-row__score">
        <ScoreRing score={row.score} grade={row.grade} color={row.color} size={56} stroke={6} />
        {row.termination_review ? <ShieldAlert className="sc-row__term" size={16} aria-label={t("scorecards.kind_termination_review")} /> : null}
      </span>
      <ChevronRight className="sc-row__go" size={18} aria-hidden />
    </Link>
  );
}

/**
 * Admin -> Scorecards: every scored affiliate and contractor this week, ranked, with the team
 * trend, the color mix, and the follow-ups that still need someone.
 */
export default function Scorecards() {
  const { t, i18n } = useTranslation();
  const dispatch = useAppDispatch();
  const { board, boardLoading, error } = useAppSelector((s) => s.scorecards);
  const [week, setWeek] = useState<string | undefined>(undefined);
  const [filter, setFilter] = useState<Filter>("all");

  useEffect(() => {
    void dispatch(fetchScorecardBoard(week ? { week } : undefined));
  }, [dispatch, week]);

  const rows = useMemo(() => {
    const all = board?.items || [];
    const list = all.filter((r) =>
      filter === "all" ? true : filter === "attention" ? ["orange", "red"].includes(r.color) || r.termination_review : r.subject_type === filter,
    );
    // Graded first, best score on top; ungraded weeks go last.
    return [...list].sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || a.name.localeCompare(b.name));
  }, [board, filter]);

  const stats = useMemo(() => {
    const items = board?.items || [];
    const counts: Record<ScorecardColor, number> = { green: 0, yellow: 0, orange: 0, red: 0, none: 0 };
    for (const r of items) counts[r.color]++;
    const graded = items.filter((r) => r.score != null);
    const avg = graded.length ? graded.reduce((n, r) => n + (r.score as number), 0) / graded.length : null;
    const weeks = board?.weeks || [];
    const perWeek = weeks.map((w) => {
      const pts = items.map((r) => r.trend.find((p) => p.week_start === w)?.score).filter((s): s is number => s != null);
      return pts.length ? pts.reduce((a, b) => a + b, 0) / pts.length : null;
    });
    const grade = avg == null ? null : avg >= 90 ? "A" : avg >= 80 ? "B" : avg >= 70 ? "C" : avg >= 60 ? "D" : "F";
    const color: ScorecardColor = !grade ? "none" : grade <= "B" ? "green" : grade === "C" ? "yellow" : grade === "D" ? "orange" : "red";
    return { counts, avg, perWeek, grade, color, attention: counts.orange + counts.red };
  }, [board]);

  // One line per person + scorecard: the most serious open item (the server sends them by severity).
  const attention = useMemo(() => {
    const by = new Map<string, { top: ScorecardAction; count: number }>();
    for (const a of board?.open_actions || []) {
      const k = `${a.subject_type}:${a.subject_id}:${a.scorecard}`;
      const cur = by.get(k);
      if (cur) cur.count++;
      else by.set(k, { top: a, count: 1 });
    }
    return [...by.values()];
  }, [board]);

  const weeks = board?.weeks || [];
  const current = weeks[weeks.length - 1];

  return (
    <div className="portal-page sc-page">
      <PageHeader
        titleKey="scorecards.title"
        leadKey="scorecards.lead"
        actions={
          weeks.length ? (
            <label className="sc-week-pick">
              <span>{t("scorecards.week")}</span>
              <select value={board?.week_start || current} onChange={(e) => setWeek(e.target.value)}>
                {[...weeks].reverse().map((w) => (
                  <option key={w} value={w}>
                    {w === current ? t("scorecards.thisWeek", { date: weekLabel(w, i18n.language) }) : t("scorecards.weekOf", { date: weekLabel(w, i18n.language, true) })}
                  </option>
                ))}
              </select>
            </label>
          ) : null
        }
      />
      <ErrorNote error={error} />
      {boardLoading && !board ? <ScorecardBoardSkeleton /> : null}

      {board ? (
        <>
          <section className="sc-hero">
            <div className="sc-hero__avg pf-card">
              <ScoreRing score={stats.avg} grade={stats.grade} color={stats.color} size={132} stroke={12} />
              <div>
                <p className="pf-kicker">
                  <Gauge size={14} aria-hidden /> {t("scorecards.teamAverage")}
                </p>
                <strong className="sc-hero__big">{stats.avg == null ? "-" : Math.round(stats.avg)}</strong>
                <p className="pf-muted">{board.week_start === current ? t("scorecards.liveHint") : t("scorecards.frozenHint")}</p>
              </div>
            </div>
            <div className="sc-hero__trend pf-card">
              <p className="pf-kicker">{t("scorecards.teamTrend")}</p>
              <TeamBars weeks={weeks} avg={stats.perWeek} />
            </div>
            <div className="sc-hero__mix pf-card">
              <p className="pf-kicker">
                <Users size={14} aria-hidden /> {t("scorecards.colorMix")}
              </p>
              <ColorDonut counts={stats.counts} />
            </div>
          </section>

          {board.open_actions.length ? (
            <section className="pf-card sc-attn">
              <div className="pf-card-top">
                <h2>
                  <AlertTriangle size={18} aria-hidden /> {t("scorecards.needsAction", { count: attention.length })}
                </h2>
              </div>
              <ul className="sc-attn__list">
                {attention.slice(0, 8).map(({ top: a, count }) => (
                  <li key={a.id}>
                    <Link to={`/admin/scorecards/${a.subject_type}/${a.subject_id}`}>
                      <ActionKindBadge kind={a.kind} />
                      <strong>{a.subject_name || `#${a.subject_id}`}</strong>
                      <span className="pf-muted">
                        {t(`scorecards.card_${a.scorecard}`)} · {t("scorecards.weekOf", { date: weekLabel(a.week_start, i18n.language) })}
                      </span>
                      {count > 1 ? <span className="sc-attn__more">{t("scorecards.moreOpen", { n: count - 1 })}</span> : null}
                      <ChevronRight size={16} aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <div className="sc-toolbar">
            <SegmentedTabs<Filter>
              value={filter}
              onChange={setFilter}
              ariaLabel={t("scorecards.filterAria")}
              options={[
                { value: "all", labelKey: "scorecards.f_all", count: board.items.length },
                { value: "contractor", labelKey: "scorecards.f_contractor", count: board.items.filter((r) => r.subject_type === "contractor").length },
                { value: "affiliate", labelKey: "scorecards.f_affiliate", count: board.items.filter((r) => r.subject_type === "affiliate").length },
                { value: "attention", labelKey: "scorecards.f_attention", count: stats.attention },
              ]}
            />
          </div>

          {!rows.length ? <EmptyState messageKey={board.items.length ? "scorecards.emptyFilter" : "scorecards.empty"} /> : null}
          <div className="sc-board">
            {rows.map((r, i) => (
              <BoardRow key={`${r.subject_type}:${r.subject_id}:${r.scorecard}`} row={r} rank={i + 1} />
            ))}
          </div>

          <details className="pf-card sc-rules-card">
            <summary>
              <Info size={16} aria-hidden /> {t("scorecards.howTitle")}
            </summary>
            <ScorecardRules />
          </details>
        </>
      ) : null}
    </div>
  );
}
