import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ChevronDown, Pause, Play, Plus, SkipForward, Workflow, X } from "lucide-react";
import type { FlowRunAction, FlowSubjectKind } from "@shared/api";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { enrollInFlow, fetchPersonFlows, flowRunAction } from "@/store/slices/flowsSlice";
import { formatMailFull } from "@/components/mail/mailFormat";
import { cn } from "@/lib/cn";

/**
 * Record pages: the automations (reminder flows) this person is in, with a timeline of every
 * step (sent, skipped, clicked, replied…) and controls: pause, resume, skip a step, remove, add.
 */
export default function PersonFlowsPanel({ kind, id }: { kind: FlowSubjectKind; id: number }) {
  const { t, i18n } = useTranslation();
  const dispatch = useAppDispatch();
  const data = useAppSelector((s) => s.flows.person[`${kind}:${id}`]);
  const busyRunId = useAppSelector((s) => s.flows.busyRunId);
  const role = useAppSelector((s) => s.portalAuth.admin.user?.role);
  const canEdit = role === "super_admin" || role === "admin";
  const [open, setOpen] = useState<number | null>(null);
  const [addId, setAddId] = useState("");
  const reload = () => void dispatch(fetchPersonFlows({ kind, id }));
  useEffect(reload, [dispatch, kind, id]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (runId: number, action: FlowRunAction) => {
    if (action === "remove" && !window.confirm(t("flows.confirmRemove"))) return;
    await dispatch(flowRunAction({ runId, action }));
    reload();
  };
  const add = async () => {
    if (!addId) return;
    const r = await dispatch(enrollInFlow({ flowId: Number(addId), kind, id }));
    if (enrollInFlow.fulfilled.match(r)) setAddId("");
    reload();
  };

  const runs = data?.runs || [];
  const liveIds = new Set(runs.filter((r) => r.status === "active" || r.status === "paused").map((r) => r.flow_id));
  const addable = (data?.available_flows || []).filter((f) => !liveIds.has(f.id));

  return (
    <section className="pf-section gw-pflows">
      <h2 className="gw-auto__title">
        <Workflow size={17} aria-hidden /> {t("flows.personTitle")}
        {runs.length ? <span className="gw-auto__count">{runs.length}</span> : null}
      </h2>
      <p className="pf-muted">{t("flows.personLead")}</p>
      {data && !runs.length ? <p className="pf-muted">{t("flows.personNone")}</p> : null}
      <ul className="gw-pflows__list">
        {runs.map((r) => {
          const live = r.status === "active" || r.status === "paused";
          return (
            <li key={r.id} className={cn("gw-pflows__run", open === r.id && "is-open")}>
              <button type="button" className="gw-pflows__head" aria-expanded={open === r.id} onClick={() => setOpen(open === r.id ? null : r.id)}>
                <span className={cn("gw-flow-status", `is-${r.status}`)}>{t(`flows.status_${r.status}`)}</span>
                <span className="gw-pflows__main">
                  <strong>{r.flow_name}</strong>
                  <small>
                    {live
                      ? r.current_step_label
                        ? t("flows.nextUp", { step: r.current_step_label, when: r.next_run_at ? formatMailFull(r.next_run_at, i18n.language) : "—" })
                        : t("flows.finishing")
                      : `${r.end_reason || ""}${r.ended_at ? ` · ${formatMailFull(r.ended_at, i18n.language)}` : ""}`}
                  </small>
                </span>
                <ChevronDown size={15} className="gw-auto__chev" aria-hidden />
              </button>
              {open === r.id ? (
                <div className="gw-pflows__body">
                  {canEdit && live ? (
                    <div className="gw-pflows__actions">
                      {r.status === "active" ? (
                        <button type="button" className="pf-btn" disabled={busyRunId === r.id} onClick={() => void act(r.id, "pause")}>
                          <Pause size={14} /> {t("flows.pause")}
                        </button>
                      ) : (
                        <button type="button" className="pf-btn" disabled={busyRunId === r.id} onClick={() => void act(r.id, "resume")}>
                          <Play size={14} /> {t("flows.resume")}
                        </button>
                      )}
                      <button type="button" className="pf-btn" disabled={busyRunId === r.id} onClick={() => void act(r.id, "skip")}>
                        <SkipForward size={14} /> {t("flows.skip")}
                      </button>
                      <button type="button" className="pf-btn pf-btn--danger" disabled={busyRunId === r.id} onClick={() => void act(r.id, "remove")}>
                        <X size={14} /> {t("flows.remove")}
                      </button>
                      <Link className="text-link" to={`/admin/flows/${r.flow_id}`}>
                        {t("flows.openFlow")}
                      </Link>
                    </div>
                  ) : null}
                  <ol className="gw-pflows__timeline">
                    {(r.events || []).map((e, i) => (
                      <li key={i} className={cn("gw-pflows__event", `is-${e.event}`)}>
                        <span className="gw-pflows__dot" aria-hidden />
                        <span>
                          <strong>{t(`flows.event_${e.event}`)}</strong>
                          {e.label ? ` · ${e.label}` : ""}
                          {e.detail && typeof e.detail.reason === "string" ? ` (${e.detail.reason})` : ""}
                          <small>{e.at ? formatMailFull(e.at, i18n.language) : ""}</small>
                        </span>
                      </li>
                    ))}
                  </ol>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      {canEdit && addable.length ? (
        <div className="gw-pflows__add">
          <select value={addId} onChange={(e) => setAddId(e.target.value)} aria-label={t("flows.addToFlow")}>
            <option value="">{t("flows.addToFlow")}</option>
            {addable.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
          <button type="button" className="pf-btn" disabled={!addId} onClick={() => void add()}>
            <Plus size={14} /> {t("flows.add")}
          </button>
        </div>
      ) : null}
    </section>
  );
}
