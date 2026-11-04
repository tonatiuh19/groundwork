import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Plus, Workflow } from "lucide-react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { createFlow, fetchFlows, saveFlowsSettings, setFlowActive } from "@/store/slices/flowsSlice";
import { EmptyState, ErrorNote, Loading, PageHeader } from "@/components/portal/kit";
import { Modal } from "@/components/portal/Modal";
import { cn } from "@/lib/cn";

/**
 * Automations: reminder flows that follow up with people on their own (texts + emails,
 * waits, conditions, staff alerts) and stop as soon as the goal is met.
 */
export default function AdminFlows() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const list = useAppSelector((s) => s.flows.list);
  const loading = useAppSelector((s) => s.flows.listLoading);
  const error = useAppSelector((s) => s.flows.error);
  const saving = useAppSelector((s) => s.flows.saving);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [trigger, setTrigger] = useState("");
  const [repName, setRepName] = useState<string | null>(null);
  const [repSaved, setRepSaved] = useState(false);

  useEffect(() => {
    void dispatch(fetchFlows());
  }, [dispatch]);

  const create = async () => {
    const r = await dispatch(createFlow({ name: name.trim(), trigger_event: trigger || list?.triggers[0] || "homeowner_lead" }));
    if (createFlow.fulfilled.match(r)) navigate(`/admin/flows/${r.payload.flow.id}`);
  };

  const flows = list?.flows || [];
  return (
    <div className="portal-page">
      <PageHeader
        titleKey="flows.title"
        leadKey="flows.lead"
        actions={
          list?.can_edit ? (
            <button type="button" className="button button-gold" onClick={() => setCreating(true)}>
              <Plus size={16} /> {t("flows.new")}
            </button>
          ) : undefined
        }
      />
      <ErrorNote error={error} />
      {loading && !list ? <Loading /> : null}
      {list && !flows.length ? <EmptyState messageKey="flows.empty" /> : null}
      <div className="gw-flows-grid">
        {flows.map((f) => {
          const rate = f.stats.entered ? Math.round((f.stats.goal_met / f.stats.entered) * 100) : null;
          return (
            <article key={f.id} className={cn("gw-flow-card", f.is_active && "is-active")}>
              <div className="gw-flow-card__top">
                <span className="gw-flow-card__icon" aria-hidden>
                  <Workflow size={18} />
                </span>
                <div className="gw-flow-card__title">
                  <Link to={`/admin/flows/${f.id}`} className="gw-flow-card__name">
                    {f.name}
                  </Link>
                  <span className="pf-muted">
                    {t(`flows.trigger_${f.trigger_event}`)}
                    {f.goal_key ? ` · ${t(`flows.goal_${f.goal_key}`)}` : ""}
                  </span>
                </div>
                <label className={cn("gw-switch", !list?.can_edit && "is-disabled")}>
                  <input
                    type="checkbox"
                    checked={f.is_active}
                    disabled={!list?.can_edit || saving}
                    onChange={(e) => void dispatch(setFlowActive({ id: f.id, active: e.target.checked }))}
                  />
                  <span>{f.is_active ? t("flows.on") : t("flows.off")}</span>
                </label>
              </div>
              {f.description ? <p className="gw-flow-card__desc">{f.description}</p> : null}
              <dl className="gw-flow-card__stats">
                <div>
                  <dt>{t("flows.statActive")}</dt>
                  <dd>{f.stats.active}</dd>
                </div>
                <div>
                  <dt>{t("flows.statEntered")}</dt>
                  <dd>{f.stats.entered}</dd>
                </div>
                <div>
                  <dt>{t("flows.statGoal")}</dt>
                  <dd>{rate == null ? "—" : `${rate}%`}</dd>
                </div>
                <div>
                  <dt>{t("flows.statClosed")}</dt>
                  <dd>{f.stats.closed}</dd>
                </div>
              </dl>
              {!f.is_active && f.system_key && !f.stats.entered ? <p className="pf-hint">{t("flows.reviewHint")}</p> : null}
            </article>
          );
        })}
      </div>

      {list?.can_edit ? (
        <section className="pf-section gw-flow-rep">
          <label className="pf-field">
            <span>{t("flows.repName")}</span>
            <input
              value={repName ?? list.default_rep_name}
              maxLength={80}
              placeholder={t("flows.repNamePlaceholder")}
              onChange={(e) => {
                setRepName(e.target.value);
                setRepSaved(false);
              }}
            />
          </label>
          <button
            type="button"
            className="pf-btn"
            disabled={repName == null || repName === list.default_rep_name}
            onClick={async () => {
              const r = await dispatch(saveFlowsSettings({ default_rep_name: repName || "" }));
              if (saveFlowsSettings.fulfilled.match(r)) setRepSaved(true);
            }}
          >
            {t("flows.save")}
          </button>
          <p className="pf-hint">{repSaved ? t("flows.repSaved") : t("flows.repNameHelp")}</p>
        </section>
      ) : null}

      <Modal open={creating} titleKey="flows.new" onClose={() => setCreating(false)}>
        <div className="pf-form">
          <label className="pf-field">
            <span>{t("flows.name")}</span>
            <input value={name} maxLength={160} onChange={(e) => setName(e.target.value)} autoFocus />
          </label>
          <label className="pf-field">
            <span>{t("flows.trigger")}</span>
            <select value={trigger} onChange={(e) => setTrigger(e.target.value)}>
              {(list?.triggers || []).map((k) => (
                <option key={k} value={k}>
                  {t(`flows.trigger_${k}`)}
                </option>
              ))}
            </select>
          </label>
          <ErrorNote error={error} />
          <div className="pf-actions">
            <button type="button" className="button button-gold" disabled={name.trim().length < 2 || saving} onClick={() => void create()}>
              {t("flows.create")}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
