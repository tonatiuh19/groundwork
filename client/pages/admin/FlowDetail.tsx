import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { LayoutList, Pause, Play, Save, Share2, SkipForward, Trash2, X } from "lucide-react";
import type { FlowEdge, FlowEdgeType, FlowRunAction, FlowStep, FlowStepType, ReminderFlowSaveBody } from "@shared/api";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { deleteFlow, fetchFlow, fetchFlowRuns, fetchFlows, flowRunAction, saveFlow, setFlowActive } from "@/store/slices/flowsSlice";
import { BackLink, ErrorNote, Loading, PageHeader, SegmentedTabs, StatCard } from "@/components/portal/kit";
import FlowCanvas from "@/components/admin/flows/FlowCanvas";
import FlowInspector from "@/components/admin/flows/FlowInspector";
import { FlowStepIcon } from "@/components/admin/flows/FlowStepIcon";
import { autoLayout, insertStepAfter, orderedSteps, removeStep, stepSummary } from "@/components/admin/flows/flowModel";
import { formatMailFull } from "@/components/mail/mailFormat";
import { personRecordPath } from "@/lib/recordPath";
import { cn } from "@/lib/cn";

type Tab = "builder" | "people" | "settings";
type Draft = { settings: Omit<ReminderFlowSaveBody, "steps" | "edges">; steps: FlowStep[]; edges: FlowEdge[] };

/** One automation: visual builder (or list view), the people in it, and its settings + stats. */
export default function AdminFlowDetail() {
  const { t, i18n } = useTranslation();
  const { id: idParam } = useParams();
  const id = Number(idParam);
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const detail = useAppSelector((s) => s.flows.detail);
  const list = useAppSelector((s) => s.flows.list);
  const loading = useAppSelector((s) => s.flows.detailLoading);
  const saving = useAppSelector((s) => s.flows.saving);
  const error = useAppSelector((s) => s.flows.error);
  const runs = useAppSelector((s) => s.flows.runs);
  const runsLoading = useAppSelector((s) => s.flows.runsLoading);
  const busyRunId = useAppSelector((s) => s.flows.busyRunId);
  const [tab, setTab] = useState<Tab>("builder");
  const [view, setView] = useState<"canvas" | "list">(() => (typeof window !== "undefined" && window.innerWidth < 720 ? "list" : "canvas"));
  const [draft, setDraft] = useState<Draft | null>(null);
  const [dirty, setDirty] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [runStatus, setRunStatus] = useState("live");
  const canEdit = Boolean(list?.can_edit);
  const readOnly = !canEdit;

  useEffect(() => {
    if (!list) void dispatch(fetchFlows());
    void dispatch(fetchFlow(id));
  }, [dispatch, id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load the server copy into the draft (on open and after each save).
  useEffect(() => {
    if (!detail || detail.flow.id !== id) return;
    const f = detail.flow;
    setDraft({
      settings: {
        name: f.name,
        description: f.description,
        trigger_event: f.trigger_event,
        goal_key: f.goal_key,
        stop_on_reply: f.stop_on_reply,
        quiet_start_hour: f.quiet_start_hour,
        quiet_end_hour: f.quiet_end_hour,
      },
      steps: detail.steps,
      edges: detail.edges,
    });
    setDirty(false);
  }, [detail, id]);

  useEffect(() => {
    if (tab === "people") void dispatch(fetchFlowRuns({ id, status: runStatus }));
  }, [dispatch, id, tab, runStatus]);

  // Warn before leaving with unsaved changes.
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  const update = useCallback((next: Partial<Draft>) => {
    setDraft((d) => (d ? { ...d, ...next } : d));
    setDirty(true);
  }, []);
  const onGraph = useCallback((g: { steps: FlowStep[]; edges: FlowEdge[] }) => update(g), [update]);

  const save = async () => {
    if (!draft) return;
    await dispatch(saveFlow({ id, body: { ...draft.settings, steps: draft.steps, edges: draft.edges } }));
  };
  const addAfter = (afterKey: string, type: FlowStepType, branch: FlowEdgeType) => {
    if (!draft) return;
    const r = insertStepAfter(draft.steps, draft.edges, afterKey, type, t(`flows.type_${type}`), branch);
    update({ steps: r.steps, edges: r.edges });
    setSelected(r.key);
  };
  const remove = (key: string) => {
    if (!draft) return;
    update(removeStep(draft.steps, draft.edges, key));
    setSelected(null);
  };
  const runAct = async (runId: number, action: FlowRunAction) => {
    if (action === "remove" && !window.confirm(t("flows.confirmRemove"))) return;
    await dispatch(flowRunAction({ runId, action }));
    void dispatch(fetchFlowRuns({ id, status: runStatus }));
  };

  const ordered = useMemo(() => (draft ? orderedSteps(draft.steps, draft.edges) : []), [draft]);
  const selectedStep = draft?.steps.find((s) => s.step_key === selected) || null;

  if (loading && !detail) return <Loading />;
  if (!detail || !draft) return <ErrorNote error={error || "errors.notFound"} />;
  const f = detail.flow;
  const goalRate = f.stats.entered ? `${Math.round((f.stats.goal_met / f.stats.entered) * 100)}%` : "—";

  return (
    <div className="portal-page gw-flow-page">
      <BackLink to="/admin/flows" labelKey="flows.back" />
      <PageHeader
        titleKey="flows.title"
        title={f.name}
        lead={`${t(`flows.trigger_${f.trigger_event}`)}${f.goal_key ? ` · ${t(`flows.goal_${f.goal_key}`)}` : ""}`}
        actions={
          canEdit ? (
            <div className="gw-flow-actions">
              <button type="button" className={cn("pf-btn", f.is_active ? "" : "pf-btn--gold")} disabled={saving || dirty} onClick={() => void dispatch(setFlowActive({ id, active: !f.is_active }))}>
                {f.is_active ? <Pause size={14} /> : <Play size={14} />} {f.is_active ? t("flows.turnOff") : t("flows.turnOn")}
              </button>
              <button type="button" className="button button-gold" disabled={!dirty || saving} onClick={() => void save()}>
                <Save size={15} /> {saving ? t("flows.saving") : t("flows.save")}
              </button>
            </div>
          ) : undefined
        }
      />
      {dirty ? <p className="pf-hint gw-flow-dirty">{t("flows.unsaved")}</p> : null}
      {!f.is_active ? <p className="pf-hint">{t("flows.offHint")}</p> : null}
      <ErrorNote error={error} />

      <div className="pf-stats gw-flow-stats">
        <StatCard labelKey="flows.statActive" value={f.stats.active} tone="gold" />
        <StatCard labelKey="flows.statEntered" value={f.stats.entered} />
        <StatCard labelKey="flows.statGoal" value={goalRate} hint={t("flows.statGoalHint", { count: f.stats.goal_met })} />
        <StatCard labelKey="flows.statClicked" value={detail.engagement.clicked} />
        <StatCard labelKey="flows.statReplied" value={detail.engagement.replied} />
        <StatCard labelKey="flows.statClosed" value={f.stats.closed} hint={t("flows.statStoppedHint", { count: f.stats.stopped, optouts: detail.engagement.opted_out })} />
      </div>

      <SegmentedTabs
        value={tab}
        onChange={(v) => setTab(v as Tab)}
        ariaLabel={t("flows.title")}
        options={[
          { value: "builder", labelKey: "flows.tabBuilder" },
          { value: "people", labelKey: "flows.tabPeople", count: f.stats.active },
          { value: "settings", labelKey: "flows.tabSettings" },
        ]}
      />

      {tab === "builder" ? (
        <>
          <div className="gw-flow-toolbar">
            <div className="pf-segmented" role="tablist" aria-label={t("flows.view")}>
              <button type="button" role="tab" aria-selected={view === "canvas"} className={cn("pf-segmented-tab", view === "canvas" && "is-active")} onClick={() => setView("canvas")}>
                <Share2 size={13} /> {t("flows.viewCanvas")}
              </button>
              <button type="button" role="tab" aria-selected={view === "list"} className={cn("pf-segmented-tab", view === "list" && "is-active")} onClick={() => setView("list")}>
                <LayoutList size={13} /> {t("flows.viewList")}
              </button>
            </div>
            {canEdit && view === "canvas" ? (
              <button type="button" className="pf-btn" onClick={() => update({ steps: autoLayout(draft.steps, draft.edges) })}>
                {t("flows.tidy")}
              </button>
            ) : null}
            <span className="pf-hint">{view === "canvas" ? t("flows.canvasHint") : t("flows.listHint")}</span>
          </div>
          <div className={cn("gw-flow-builder", selectedStep && "has-inspector")}>
            {view === "canvas" ? (
              <FlowCanvas steps={draft.steps} edges={draft.edges} selectedKey={selected} readOnly={readOnly} onSelect={setSelected} onChange={onGraph} />
            ) : (
              <ol className="gw-flow-list">
                {ordered.map((s, i) => {
                  const incoming = draft.edges.find((e) => e.target_key === s.step_key);
                  return (
                    <li key={s.step_key} className={cn("gw-flow-list__item", selected === s.step_key && "is-selected", incoming && incoming.edge_type !== "next" && "is-branch")}>
                      <button type="button" className="gw-flow-list__btn" onClick={() => setSelected(s.step_key)}>
                        <span className="gw-flow-list__n">{i + 1}</span>
                        <span className={cn("gw-flow-node__icon", `is-${s.step_type}`)} aria-hidden>
                          <FlowStepIcon type={s.step_type} />
                        </span>
                        <span className="gw-flow-list__main">
                          <strong>
                            {incoming && incoming.edge_type !== "next" ? <em className="gw-flow-list__branch">{t(`flows.branch_${incoming.edge_type}`)}</em> : null}
                            {s.label}
                          </strong>
                          <small>{stepSummary(s, t)}</small>
                        </span>
                        {s.stats?.sent ? <span className="gw-flow-list__stat">{t("flows.statSentN", { count: s.stats.sent })}</span> : null}
                      </button>
                    </li>
                  );
                })}
              </ol>
            )}
            {selectedStep ? (
              <div className="gw-flow-builder__side">
                <button type="button" className="gw-flow-builder__close" aria-label={t("flows.closeInspector")} onClick={() => setSelected(null)}>
                  <X size={16} />
                </button>
                <FlowInspector
                  flowId={id}
                  step={selectedStep}
                  checks={list?.checks || []}
                  readOnly={readOnly}
                  dirty={dirty}
                  onChange={(s) => update({ steps: draft.steps.map((x) => (x.step_key === s.step_key ? s : x)) })}
                  onDelete={() => remove(selectedStep.step_key)}
                  onAddAfter={(type, branch) => addAfter(selectedStep.step_key, type, branch)}
                />
              </div>
            ) : null}
          </div>
        </>
      ) : null}

      {tab === "people" ? (
        <section className="pf-section">
          <div className="gw-flow-toolbar">
            <select value={runStatus} onChange={(e) => setRunStatus(e.target.value)} aria-label={t("flows.filterStatus")}>
              {["live", "goal_met", "closed", "stopped", "completed", "all"].map((s) => (
                <option key={s} value={s}>
                  {t(`flows.filter_${s}`)}
                </option>
              ))}
            </select>
            <span className="pf-hint">{t("flows.peopleHint")}</span>
          </div>
          {runsLoading ? <Loading /> : null}
          {!runsLoading && !runs.length ? <p className="pf-muted">{t("flows.noPeople")}</p> : null}
          <div className="gw-flow-runs">
            {runs.map((r) => {
              const live = r.status === "active" || r.status === "paused";
              const to = r.subject_kind === "project" || r.subject_kind === "appointment" ? null : personRecordPath(r.subject_kind, r.subject_id, r.subject_name);
              return (
                <div key={r.id} className="gw-flow-run">
                  <div className="gw-flow-run__main">
                    {to ? (
                      <a className="text-link" href={to} onClick={(e) => (e.preventDefault(), navigate(to))}>
                        {r.subject_name || `#${r.subject_id}`}
                      </a>
                    ) : (
                      <strong>{r.subject_name || `#${r.subject_id}`}</strong>
                    )}
                    <small className="pf-muted">
                      {t(`flows.kind_${r.subject_kind}`)} · {t("flows.entered", { when: r.entered_at ? formatMailFull(r.entered_at, i18n.language) : "—" })}
                    </small>
                  </div>
                  <span className={cn("gw-flow-status", `is-${r.status}`)}>{t(`flows.status_${r.status}`)}</span>
                  <span className="gw-flow-run__step">
                    {live ? (r.current_step_label ? t("flows.nextUp", { step: r.current_step_label, when: r.next_run_at ? formatMailFull(r.next_run_at, i18n.language) : "—" }) : t("flows.finishing")) : r.end_reason}
                  </span>
                  {canEdit && live ? (
                    <span className="gw-flow-run__actions">
                      <button type="button" className="pf-btn" disabled={busyRunId === r.id} onClick={() => void runAct(r.id, r.status === "active" ? "pause" : "resume")} aria-label={r.status === "active" ? t("flows.pause") : t("flows.resume")}>
                        {r.status === "active" ? <Pause size={14} /> : <Play size={14} />}
                      </button>
                      <button type="button" className="pf-btn" disabled={busyRunId === r.id} onClick={() => void runAct(r.id, "skip")} aria-label={t("flows.skip")}>
                        <SkipForward size={14} />
                      </button>
                      <button type="button" className="pf-btn pf-btn--danger" disabled={busyRunId === r.id} onClick={() => void runAct(r.id, "remove")} aria-label={t("flows.remove")}>
                        <X size={14} />
                      </button>
                    </span>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {tab === "settings" ? (
        <section className="pf-section pf-form gw-flow-settings">
          <label className="pf-field">
            <span>{t("flows.name")}</span>
            <input value={draft.settings.name} readOnly={readOnly} maxLength={160} onChange={(e) => update({ settings: { ...draft.settings, name: e.target.value } })} />
          </label>
          <label className="pf-field">
            <span>{t("flows.description")}</span>
            <textarea rows={3} value={draft.settings.description || ""} readOnly={readOnly} onChange={(e) => update({ settings: { ...draft.settings, description: e.target.value } })} />
          </label>
          <div className="gw-flow-inspector__row">
            <label className="pf-field">
              <span>{t("flows.trigger")}</span>
              <select value={draft.settings.trigger_event} disabled={readOnly} onChange={(e) => update({ settings: { ...draft.settings, trigger_event: e.target.value } })}>
                {(list?.triggers || [draft.settings.trigger_event]).map((k) => (
                  <option key={k} value={k}>
                    {t(`flows.trigger_${k}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="pf-field">
              <span>{t("flows.goal")}</span>
              <select value={draft.settings.goal_key || ""} disabled={readOnly} onChange={(e) => update({ settings: { ...draft.settings, goal_key: e.target.value || null } })}>
                <option value="">{t("flows.noGoal")}</option>
                {(list?.goals || []).map((k) => (
                  <option key={k} value={k}>
                    {t(`flows.goal_${k}`)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="pf-hint">{t("flows.goalHelp")}</p>
          <label className="consent">
            <input type="checkbox" checked={draft.settings.stop_on_reply !== false} disabled={readOnly} onChange={(e) => update({ settings: { ...draft.settings, stop_on_reply: e.target.checked } })} />
            <span>{t("flows.stopOnReply")}</span>
          </label>
          <div className="gw-flow-inspector__row">
            <label className="pf-field">
              <span>{t("flows.quietStart")}</span>
              <select value={draft.settings.quiet_start_hour ?? 9} disabled={readOnly} onChange={(e) => update({ settings: { ...draft.settings, quiet_start_hour: Number(e.target.value) } })}>
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>
                    {`${h}:00`}
                  </option>
                ))}
              </select>
            </label>
            <label className="pf-field">
              <span>{t("flows.quietEnd")}</span>
              <select value={draft.settings.quiet_end_hour ?? 19} disabled={readOnly} onChange={(e) => update({ settings: { ...draft.settings, quiet_end_hour: Number(e.target.value) } })}>
                {Array.from({ length: 24 }, (_, h) => h + 1).map((h) => (
                  <option key={h} value={h}>
                    {`${h}:00`}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="pf-hint">{t("flows.quietHelp")}</p>
          {canEdit && !f.system_key ? (
            <button
              type="button"
              className="pf-btn pf-btn--danger"
              onClick={async () => {
                if (!window.confirm(t("flows.confirmDelete"))) return;
                const r = await dispatch(deleteFlow(id));
                if (deleteFlow.fulfilled.match(r)) navigate("/admin/flows");
              }}
            >
              <Trash2 size={14} /> {t("flows.delete")}
            </button>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
