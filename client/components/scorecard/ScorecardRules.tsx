import { useTranslation } from "react-i18next";
import type { ScorecardKind } from "@shared/api";
import { SC_COLORS } from "@/components/scorecard/ScorecardCharts";

/** Client copy of api/index.ts SCORECARD_METRICS (goal + weight), for the "how it works" panel. */
export const SCORECARD_GOALS: Record<ScorecardKind, { key: string; weight: number }[]> = {
  lead_rep: [
    { key: "call_15m", weight: 25 },
    { key: "contact_48h", weight: 20 },
    { key: "consult_rate", weight: 20 },
    { key: "sign_rate", weight: 20 },
    { key: "next_step", weight: 15 },
  ],
  coordinator: [
    { key: "plans_on_time", weight: 25 },
    { key: "status_review", weight: 20 },
    { key: "city_5d", weight: 20 },
    { key: "homeowner_update", weight: 20 },
    { key: "milestones_on_time", weight: 15 },
  ],
  affiliate: [
    { key: "qualified_leads", weight: 40 },
    { key: "aff_consult_rate", weight: 30 },
    { key: "events", weight: 30 },
  ],
};

/** Goals, grades, counting rules and the escalation ladder, in plain words. */
export function ScorecardRules({ only }: { only?: ScorecardKind[] }) {
  const { t } = useTranslation();
  const cards = (only?.length ? only : (Object.keys(SCORECARD_GOALS) as ScorecardKind[])) as ScorecardKind[];
  return (
    <div className="sc-rules">
      <div className="sc-rules__cards">
        {cards.map((c) => (
          <div key={c} className="sc-rules__card">
            <h3>{t(`scorecards.card_${c}`)}</h3>
            <ul>
              {SCORECARD_GOALS[c].map((m) => (
                <li key={m.key}>
                  <span>{t(`scorecards.goal_${m.key}`)}</span>
                  <b>{m.weight}</b>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="sc-rules__grades">
        {[
          ["A", "90+", "green"],
          ["B", "80-89", "green"],
          ["C", "70-79", "yellow"],
          ["D", "60-69", "orange"],
          ["F", "<60", "red"],
        ].map(([g, r, c]) => (
          <span key={g} style={{ ["--tone" as string]: SC_COLORS[c as "green"] }}>
            <b>{g}</b> {r}
          </span>
        ))}
      </div>
      <ul className="sc-rules__list">
        <li>{t("scorecards.rule_scale")}</li>
        <li>{t("scorecards.rule_own")}</li>
        <li>{t("scorecards.rule_hours")}</li>
        <li>{t("scorecards.rule_off")}</li>
        <li>{t("scorecards.rule_attempts")}</li>
        <li>{t("scorecards.rule_nothing")}</li>
        <li>{t("scorecards.rule_new")}</li>
        <li>{t("scorecards.rule_frozen")}</li>
      </ul>
      <ol className="sc-ladder">
        {(["green", "yellow", "orange", "red", "term"] as const).map((k) => (
          <li key={k} className={`is-${k === "term" ? "red" : k}`}>
            <strong>{t(`scorecards.ladder_${k}_t`)}</strong>
            <span>{t(`scorecards.ladder_${k}`)}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
