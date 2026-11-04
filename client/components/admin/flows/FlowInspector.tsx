import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Eye, Plus, Send, Trash2 } from "lucide-react";
import type { FlowEdgeType, FlowStep, FlowStepConfig, FlowStepType } from "@shared/api";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { clearFlowPreview, previewFlowStep, testFlowStep } from "@/store/slices/flowsSlice";
import { smsSegmentInfo } from "@/lib/smsSegments";
import { cn } from "@/lib/cn";
import { FLOW_VARS, STEP_TYPES_ADDABLE, stepBranches } from "./flowModel";
import { FlowStepIcon } from "./FlowStepIcon";

function VarText({ label, value, onChange, rows = 4, sms, readOnly }: { label: string; value: string; onChange: (v: string) => void; rows?: number; sms?: boolean; readOnly: boolean }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const insert = (key: string) => {
    const el = ref.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? start;
    onChange(`${value.slice(0, start)}{{${key}}}${value.slice(end)}`);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + key.length + 4, start + key.length + 4);
    });
  };
  const seg = smsSegmentInfo(value);
  return (
    <label className="pf-field gw-tpl-field">
      <span>{label}</span>
      <textarea ref={ref} rows={rows} value={value} readOnly={readOnly} onChange={(e) => onChange(e.target.value)} />
      {!readOnly ? (
        <div className="gw-tpl-vars">
          {FLOW_VARS.map((v) => (
            <button key={v} type="button" className="gw-tpl-var" onClick={() => insert(v)}>
              {`{{${v}}}`}
            </button>
          ))}
          {sms ? (
            <span className="pf-hint gw-tpl-seg">
              {seg.length} · {seg.segments} SMS
            </span>
          ) : null}
        </div>
      ) : null}
    </label>
  );
}

/** Right-hand panel: edit the selected step, preview it as a real message and send a test to yourself. */
export default function FlowInspector({
  flowId,
  step,
  checks,
  readOnly,
  dirty,
  onChange,
  onDelete,
  onAddAfter,
}: {
  flowId: number;
  step: FlowStep;
  checks: string[];
  readOnly: boolean;
  dirty: boolean;
  onChange: (s: FlowStep) => void;
  onDelete: () => void;
  onAddAfter: (type: FlowStepType, branch: FlowEdgeType) => void;
}) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const preview = useAppSelector((s) => s.flows.preview);
  const previewLoading = useAppSelector((s) => s.flows.previewLoading);
  const testSentTo = useAppSelector((s) => s.flows.testSentTo);
  const [lang, setLang] = useState<"en" | "es">("en");
  const [branch, setBranch] = useState<FlowEdgeType>("next");
  const c = step.config || {};
  const set = (patch: Partial<FlowStepConfig>) => onChange({ ...step, config: { ...c, ...patch } });
  const branches = stepBranches(step.step_type);
  const isSend = step.step_type === "send_email" || step.step_type === "send_sms";

  useEffect(() => {
    dispatch(clearFlowPreview());
    setBranch(stepBranches(step.step_type)[0] || "next");
  }, [dispatch, step.step_key, step.step_type]);

  const sfx = lang === "es" ? "_es" : "_en";
  return (
    <aside className="gw-flow-inspector" aria-label={t("flows.inspector")}>
      <div className="gw-flow-inspector__head">
        <span className={cn("gw-flow-node__icon", `is-${step.step_type}`)} aria-hidden>
          <FlowStepIcon type={step.step_type} />
        </span>
        <strong>{t(`flows.type_${step.step_type}`)}</strong>
        {!readOnly && step.step_type !== "trigger" ? (
          <button type="button" className="pf-btn pf-btn--danger gw-flow-inspector__del" onClick={onDelete}>
            <Trash2 size={14} /> {t("flows.deleteStep")}
          </button>
        ) : null}
      </div>
      <label className="pf-field">
        <span>{t("flows.stepLabel")}</span>
        <input value={step.label} readOnly={readOnly} maxLength={160} onChange={(e) => onChange({ ...step, label: e.target.value })} />
      </label>

      {step.step_type === "trigger" ? <p className="pf-muted">{t("flows.triggerHelp")}</p> : null}

      {step.step_type === "wait" || step.step_type === "wait_for_reply" ? (
        <div className="gw-flow-inspector__row">
          <label className="pf-field">
            <span>{t("flows.amount")}</span>
            <input type="number" min={0} max={365} value={c.amount ?? 1} readOnly={readOnly} onChange={(e) => set({ amount: Math.max(0, Number(e.target.value) || 0) })} />
          </label>
          <label className="pf-field">
            <span>{t("flows.unit")}</span>
            <select value={c.unit || "days"} disabled={readOnly} onChange={(e) => set({ unit: e.target.value as FlowStepConfig["unit"] })}>
              {(["minutes", "hours", "days"] as const).map((u) => (
                <option key={u} value={u}>
                  {t(`flows.unitName_${u}`)}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}
      {step.step_type === "wait_for_reply" ? <p className="pf-muted">{t("flows.waitReplyHelp")}</p> : null}

      {step.step_type === "condition" ? (
        <label className="pf-field">
          <span>{t("flows.check")}</span>
          <select value={c.check || "goal_met"} disabled={readOnly} onChange={(e) => set({ check: e.target.value })}>
            {checks.map((k) => (
              <option key={k} value={k}>
                {t(`flows.check_${k}`)}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {isSend ? (
        <>
          <div className="pf-segmented" role="tablist" aria-label={t("flows.language")}>
            {(["en", "es"] as const).map((l) => (
              <button key={l} type="button" role="tab" aria-selected={lang === l} className={cn("pf-segmented-tab", lang === l && "is-active")} onClick={() => setLang(l)}>
                {l === "en" ? "English" : "Español"}
              </button>
            ))}
          </div>
          {step.step_type === "send_email" ? (
            <label className="pf-field">
              <span>{t("flows.subject")}</span>
              <input
                value={String(c[`subject${sfx}` as keyof FlowStepConfig] ?? "")}
                readOnly={readOnly}
                onChange={(e) => set({ [`subject${sfx}`]: e.target.value } as Partial<FlowStepConfig>)}
              />
            </label>
          ) : null}
          <VarText
            label={t("flows.message")}
            rows={step.step_type === "send_email" ? 10 : 5}
            sms={step.step_type === "send_sms"}
            readOnly={readOnly}
            value={String(c[`body${sfx}` as keyof FlowStepConfig] ?? "")}
            onChange={(v) => set({ [`body${sfx}`]: v } as Partial<FlowStepConfig>)}
          />
          {step.step_type === "send_sms" ? <p className="pf-hint">{t("flows.smsRules")}</p> : null}
          <div className="gw-flow-inspector__row">
            <button type="button" className="pf-btn" disabled={dirty || previewLoading} onClick={() => void dispatch(previewFlowStep({ id: flowId, step_key: step.step_key, lang }))}>
              <Eye size={14} /> {t("flows.preview")}
            </button>
            {!readOnly ? (
              <button type="button" className="pf-btn" disabled={dirty} onClick={() => void dispatch(testFlowStep({ id: flowId, step_key: step.step_key, lang }))}>
                <Send size={14} /> {t("flows.sendTest")}
              </button>
            ) : null}
          </div>
          {dirty ? <p className="pf-hint">{t("flows.saveToPreview")}</p> : null}
          {testSentTo ? <p className="pf-hint gw-flow-ok">{t("flows.testSent", { to: testSentTo })}</p> : null}
          {preview ? (
            <div className="gw-flow-preview">
              {preview.subject ? <strong className="gw-flow-preview__subject">{preview.subject}</strong> : null}
              {preview.html ? (
                <iframe className="gw-flow-preview__frame" title={t("flows.preview")} sandbox="" srcDoc={preview.html} />
              ) : (
                <p className="gw-flow-preview__sms">{preview.body}</p>
              )}
            </div>
          ) : null}
        </>
      ) : null}

      {step.step_type === "notify_staff" ? (
        <>
          <VarText label={t("flows.staffMessage")} value={c.body_en || ""} readOnly={readOnly} onChange={(v) => set({ body_en: v })} />
          <p className="pf-hint">{t("flows.staffHelp")}</p>
        </>
      ) : null}
      {step.step_type === "close" ? <p className="pf-muted">{t("flows.closeHelp")}</p> : null}

      {!readOnly && branches.length ? (
        <div className="gw-flow-inspector__add">
          <span className="pf-kicker">{t("flows.addAfter")}</span>
          {branches.length > 1 ? (
            <div className="pf-segmented" role="tablist" aria-label={t("flows.branch")}>
              {branches.map((b) => (
                <button key={b} type="button" role="tab" aria-selected={branch === b} className={cn("pf-segmented-tab", branch === b && "is-active")} onClick={() => setBranch(b)}>
                  {t(`flows.branch_${b}`)}
                </button>
              ))}
            </div>
          ) : null}
          <div className="gw-flow-palette">
            {STEP_TYPES_ADDABLE.map((type) => (
              <button key={type} type="button" className="gw-flow-palette__btn" onClick={() => onAddAfter(type, branch)}>
                <Plus size={12} aria-hidden />
                <FlowStepIcon type={type} size={13} /> {t(`flows.type_${type}`)}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </aside>
  );
}
