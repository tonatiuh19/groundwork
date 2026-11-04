import { useEffect, useState } from "react";
import { CheckCircle2, ClipboardCheck, FileCheck2, Flag, Landmark, MessageSquareText, Plus, Trash2, Undo2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  addProjectCorrection,
  addProjectPlan,
  deleteProjectCorrection,
  deleteProjectPlan,
  fetchProjectTracking,
  logScorecardActivity,
  resolveProjectCorrection,
  setProjectPlanDelivered,
  setProjectTarget,
} from "@/store/slices/scorecardsSlice";
import { BusyButton } from "@/components/portal/kit";
import { useFormatters } from "@/lib/format";
import { cn } from "@/lib/cn";

/** Today's date (YYYY-MM-DD) in the browser's zone, for date inputs. */
export const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
const TARGET_STAGES = ["financing", "contracted", "in_build", "closed"] as const;

/**
 * Project coordinator tracking for one project: plans owed (due vs delivered), city corrections
 * (received vs resolved, goal 5 working days), target date per stage, and the weekly review /
 * homeowner update. It feeds the builder's scorecard; shown on Project detail and on the
 * contractor's scorecard.
 */
export default function ProjectTrackingPanel({ publicId, title }: { publicId: string; title?: string }) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const fmt = useFormatters();
  const tr = useAppSelector((s) => s.scorecards.tracking[publicId]);
  const [planTitle, setPlanTitle] = useState("");
  const [planDue, setPlanDue] = useState("");
  const [corrOn, setCorrOn] = useState(todayKey());
  const [corrNote, setCorrNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [logged, setLogged] = useState<string | null>(null);

  useEffect(() => {
    void dispatch(fetchProjectTracking(publicId));
  }, [dispatch, publicId]);

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    await fn();
    setBusy(null);
  };
  const logWeekly = (kind: "status_review" | "homeowner_update") =>
    run(kind, async () => {
      if (!tr?.contractor_id) return;
      const r = await dispatch(logScorecardActivity({ type: "contractor", id: tr.contractor_id, body: { kind, project_public_id: publicId } }));
      if (logScorecardActivity.fulfilled.match(r)) {
        setLogged(kind);
        await dispatch(fetchProjectTracking(publicId));
      }
    });

  if (!tr) return null;
  const today = todayKey();

  return (
    <section className="pf-card sc-track">
      <div className="pf-card-top">
        <div>
          <p className="pf-kicker">{t("scorecards.trackKicker")}</p>
          <h2>{title || t("scorecards.trackTitle")}</h2>
        </div>
      </div>

      {tr.contractor_id ? (
        <div className="sc-track__weekly">
          <div className="sc-track__weekly-item">
            <ClipboardCheck size={18} aria-hidden />
            <span>
              <strong>{t("scorecards.m_status_review")}</strong>
              <small>{tr.last_status_review_at ? t("scorecards.lastAt", { when: fmt.relative(tr.last_status_review_at) }) : t("scorecards.never")}</small>
            </span>
            <BusyButton
              tone="gold"
              label={t("scorecards.logReview")}
              doneLabel={t("scorecards.logged")}
              busy={busy === "status_review"}
              done={logged === "status_review"}
              onClick={() => void logWeekly("status_review")}
            />
          </div>
          <div className="sc-track__weekly-item">
            <MessageSquareText size={18} aria-hidden />
            <span>
              <strong>{t("scorecards.m_homeowner_update")}</strong>
              <small>{tr.last_homeowner_update_at ? t("scorecards.lastAt", { when: fmt.relative(tr.last_homeowner_update_at) }) : t("scorecards.never")}</small>
            </span>
            <BusyButton
              tone="gold"
              label={t("scorecards.logUpdate")}
              doneLabel={t("scorecards.logged")}
              busy={busy === "homeowner_update"}
              done={logged === "homeowner_update"}
              onClick={() => void logWeekly("homeowner_update")}
            />
          </div>
        </div>
      ) : (
        <p className="pf-hint">{t("scorecards.noBuilder")}</p>
      )}

      <div className="sc-track__grid">
        <div className="sc-track__block">
          <h3>
            <FileCheck2 size={16} aria-hidden /> {t("scorecards.plans")}
          </h3>
          <ul className="sc-track__list">
            {tr.plans.map((p) => {
              const deliveredKey = p.delivered_at ? p.delivered_at.slice(0, 10) : null;
              const late = deliveredKey ? deliveredKey > p.due_on : p.due_on < today;
              return (
                <li key={p.id} className={cn(p.delivered_at ? (late ? "is-late" : "is-ok") : late ? "is-late" : "is-open")}>
                  <span className="sc-track__main">
                    <strong>{p.title}</strong>
                    <small>
                      {t("scorecards.dueOn", { date: fmt.date(`${p.due_on}T12:00:00`) })}
                      {p.delivered_at ? ` · ${t("scorecards.deliveredOn", { date: fmt.date(p.delivered_at) })}` : ""}
                    </small>
                  </span>
                  <span className="sc-track__acts">
                  <button
                    type="button"
                    className="pf-btn pf-btn--sm"
                    disabled={busy === `p${p.id}`}
                    onClick={() => void run(`p${p.id}`, () => dispatch(setProjectPlanDelivered({ publicId, id: p.id, delivered: !p.delivered_at })))}
                  >
                    {p.delivered_at ? <Undo2 size={14} aria-hidden /> : <CheckCircle2 size={14} aria-hidden />} {p.delivered_at ? t("scorecards.undo") : t("scorecards.markDelivered")}
                  </button>
                  <button type="button" className="pf-icon-btn" aria-label={t("scorecards.delete")} onClick={() => void run(`pd${p.id}`, () => dispatch(deleteProjectPlan({ publicId, id: p.id })))}>
                    <Trash2 size={14} />
                  </button>
                  </span>
                </li>
              );
            })}
            {!tr.plans.length ? <li className="sc-track__empty">{t("scorecards.noPlans")}</li> : null}
          </ul>
          <div className="sc-track__add">
            <input value={planTitle} maxLength={160} placeholder={t("scorecards.planTitlePh")} onChange={(e) => setPlanTitle(e.target.value)} aria-label={t("scorecards.planTitle")} />
            <input type="date" value={planDue} onChange={(e) => setPlanDue(e.target.value)} aria-label={t("scorecards.dueDate")} />
            <BusyButton
              icon={Plus}
              label={t("scorecards.add")}
              busy={busy === "plan"}
              disabled={!planTitle.trim() || !planDue}
              onClick={() =>
                void run("plan", async () => {
                  const r = await dispatch(addProjectPlan({ publicId, title: planTitle.trim(), due_on: planDue }));
                  if (addProjectPlan.fulfilled.match(r)) {
                    setPlanTitle("");
                    setPlanDue("");
                  }
                })
              }
            />
          </div>
        </div>

        <div className="sc-track__block">
          <h3>
            <Landmark size={16} aria-hidden /> {t("scorecards.corrections")}
          </h3>
          <ul className="sc-track__list">
            {tr.corrections.map((c) => {
              const days = daysBetween(c.received_on, c.resolved_on || today);
              return (
                <li key={c.id} className={cn(c.resolved_on ? (days <= 7 ? "is-ok" : "is-late") : days > 7 ? "is-late" : "is-open")}>
                  <span className="sc-track__main">
                    <strong>{c.note || t("scorecards.correction")}</strong>
                    <small>
                      {t("scorecards.receivedOn", { date: fmt.date(`${c.received_on}T12:00:00`) })}
                      {c.resolved_on ? ` · ${t("scorecards.resolvedOn", { date: fmt.date(`${c.resolved_on}T12:00:00`) })}` : ` · ${t("scorecards.daysOpen", { n: days })}`}
                    </small>
                  </span>
                  <span className="sc-track__acts">
                  <button
                    type="button"
                    className="pf-btn pf-btn--sm"
                    disabled={busy === `c${c.id}`}
                    onClick={() => void run(`c${c.id}`, () => dispatch(resolveProjectCorrection({ publicId, id: c.id, resolved_on: c.resolved_on ? null : today })))}
                  >
                    {c.resolved_on ? <Undo2 size={14} aria-hidden /> : <CheckCircle2 size={14} aria-hidden />} {c.resolved_on ? t("scorecards.undo") : t("scorecards.markResolved")}
                  </button>
                  <button type="button" className="pf-icon-btn" aria-label={t("scorecards.delete")} onClick={() => void run(`cd${c.id}`, () => dispatch(deleteProjectCorrection({ publicId, id: c.id })))}>
                    <Trash2 size={14} />
                  </button>
                  </span>
                </li>
              );
            })}
            {!tr.corrections.length ? <li className="sc-track__empty">{t("scorecards.noCorrections")}</li> : null}
          </ul>
          <div className="sc-track__add">
            <input value={corrNote} maxLength={500} placeholder={t("scorecards.correctionPh")} onChange={(e) => setCorrNote(e.target.value)} aria-label={t("scorecards.correction")} />
            <input type="date" value={corrOn} max={today} onChange={(e) => setCorrOn(e.target.value)} aria-label={t("scorecards.receivedDate")} />
            <BusyButton
              icon={Plus}
              label={t("scorecards.add")}
              busy={busy === "corr"}
              disabled={!corrOn}
              onClick={() =>
                void run("corr", async () => {
                  const r = await dispatch(addProjectCorrection({ publicId, received_on: corrOn, note: corrNote.trim() || undefined }));
                  if (addProjectCorrection.fulfilled.match(r)) setCorrNote("");
                })
              }
            />
          </div>
        </div>

        <div className="sc-track__block">
          <h3>
            <Flag size={16} aria-hidden /> {t("scorecards.stageTargets")}
          </h3>
          <ul className="sc-track__list sc-track__targets">
            {TARGET_STAGES.map((m) => {
              const tg = tr.targets.find((x) => x.milestone === m);
              const reached = tg?.reached_at ? tg.reached_at.slice(0, 10) : null;
              const tone = !tg ? "" : reached ? (reached <= tg.due_on ? "is-ok" : "is-late") : tg.due_on < today ? "is-late" : "is-open";
              return (
                <li key={m} className={tone}>
                  <span className="sc-track__main">
                    <strong>{t(`milestone.${m}`)}</strong>
                    <small>{reached ? t("scorecards.reachedOn", { date: fmt.date(tg!.reached_at) }) : tg ? t("scorecards.notReached") : t("scorecards.noTarget")}</small>
                  </span>
                  <input
                    type="date"
                    value={tg?.due_on || ""}
                    aria-label={t("scorecards.targetFor", { stage: t(`milestone.${m}`) })}
                    onChange={(e) => void run(`t${m}`, () => dispatch(setProjectTarget({ publicId, milestone: m, due_on: e.target.value || null })))}
                  />
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </section>
  );
}
