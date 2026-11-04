import { useTranslation } from "react-i18next";
import type { CityPipelineCity } from "@shared/api";
import { cn } from "@/lib/cn";

export const CITY_STAGES = ["target", "official_contacted", "meeting_scheduled", "official_support", "referred_to_staff", "staff_meeting", "plans_submitted", "in_review", "comments_received", "resubmitted", "preapproved", "on_hold"] as const;
export const CITY_LEVELS = ["high", "medium", "low", "unknown"] as const;
export const ACTIVITY_TYPES = ["call", "email", "meeting", "presentation", "follow_up", "plan_submission", "other"] as const;

/** Spreadsheet-style follow-up badge: overdue / due today / upcoming. */
export function FollowUpBadge({ city }: { city: Pick<CityPipelineCity, "follow_up" | "next_action_on"> }) {
  const { t } = useTranslation();
  if (city.follow_up === "none") return null;
  return <span className={cn("gw-city-badge", `is-${city.follow_up}`)}>{t(`cityPartner.followUp.${city.follow_up}`)}</span>;
}

/** Where a city is on the road to pre-approval, as a slim progress bar. */
export function StageProgress({ stage }: { stage: CityPipelineCity["pipeline_stage"] }) {
  const { t } = useTranslation();
  const idx = stage && stage !== "on_hold" ? CITY_STAGES.indexOf(stage) : -1;
  const pct = stage === "preapproved" ? 100 : idx < 0 ? 0 : Math.round(((idx + 1) / 11) * 100);
  return (
    <div className="gw-city-stage">
      <span>{stage ? t(`cityPartner.stage.${stage}`) : t("cityPartner.stage.none")}</span>
      <div className="gw-city-stage__bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <i style={{ width: `${pct}%` }} className={cn(stage === "on_hold" && "is-hold")} />
      </div>
    </div>
  );
}

export const centsToMoney = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Short month label ("Nov") in the viewer's language, for charts. */
export const monthShort = (ym: string, lang: string) => new Date(`${ym}-15T12:00:00`).toLocaleDateString(lang.startsWith("es") ? "es-MX" : "en-US", { month: "short" });

/** The road to an Opened City, as journey steps (on hold keeps the last real step). */
export const JOURNEY: { key: string; stages: string[] }[] = [
  { key: "introduced", stages: ["target", "official_contacted"] },
  { key: "meeting", stages: ["meeting_scheduled", "official_support"] },
  { key: "staff", stages: ["referred_to_staff", "staff_meeting"] },
  { key: "plans", stages: ["plans_submitted", "in_review", "comments_received", "resubmitted"] },
  { key: "opened", stages: ["preapproved"] },
];
export const journeyIndex = (stage: string | null) => (stage ? JOURNEY.findIndex((j) => j.stages.includes(stage)) : -1);
