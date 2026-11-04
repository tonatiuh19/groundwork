import type { FlowEdge, FlowEdgeType, FlowStep, FlowStepConfig, FlowStepType } from "@shared/api";

/** Pure helpers for the flow builder (canvas + list view share one draft). */

export const STEP_TYPES_ADDABLE: FlowStepType[] = ["wait", "send_sms", "send_email", "notify_staff", "condition", "wait_for_reply", "close", "end"];

/** Outgoing branches each step type has (the canvas draws one handle per branch). */
export function stepBranches(type: FlowStepType): FlowEdgeType[] {
  if (type === "condition") return ["yes", "no"];
  if (type === "wait_for_reply") return ["replied", "no_reply"];
  if (type === "close" || type === "end") return [];
  return ["next"];
}

export const FLOW_VARS = ["first_name", "last_name", "company", "link", "rep_name", "missing_items"] as const;

export function defaultConfig(type: FlowStepType): FlowStepConfig {
  if (type === "wait") return { amount: 1, unit: "days" };
  if (type === "wait_for_reply") return { amount: 2, unit: "days" };
  if (type === "send_sms") return { body_en: "", body_es: "" };
  if (type === "send_email") return { subject_en: "", subject_es: "", body_en: "", body_es: "" };
  if (type === "notify_staff") return { body_en: "" };
  if (type === "condition") return { check: "goal_met" };
  return {};
}

export function newStepKey(steps: FlowStep[], type: FlowStepType): string {
  const base = type.replace(/^send_/, "");
  let n = 1;
  const keys = new Set(steps.map((s) => s.step_key));
  while (keys.has(`${base}_${n}`)) n++;
  return `${base}_${n}`;
}

/** Steps in reading order: follow edges from the trigger (yes / replied branch first), then anything unreachable. */
export function orderedSteps(steps: FlowStep[], edges: FlowEdge[]): FlowStep[] {
  const byKey = new Map(steps.map((s) => [s.step_key, s]));
  const rank: Record<FlowEdgeType, number> = { next: 0, yes: 0, replied: 0, no: 1, no_reply: 1 };
  const out: FlowStep[] = [];
  const seen = new Set<string>();
  const visit = (key: string) => {
    if (seen.has(key) || !byKey.has(key)) return;
    seen.add(key);
    out.push(byKey.get(key)!);
    edges
      .filter((e) => e.source_key === key)
      .sort((a, b) => rank[a.edge_type] - rank[b.edge_type])
      .forEach((e) => visit(e.target_key));
  };
  const trigger = steps.find((s) => s.step_type === "trigger");
  if (trigger) visit(trigger.step_key);
  steps.forEach((s) => visit(s.step_key));
  return out;
}

/** Insert a new step after `afterKey` on its `branch`, keeping whatever followed it. */
export function insertStepAfter(
  steps: FlowStep[],
  edges: FlowEdge[],
  afterKey: string,
  type: FlowStepType,
  label: string,
  branch: FlowEdgeType = "next",
): { steps: FlowStep[]; edges: FlowEdge[]; key: string } {
  const after = steps.find((s) => s.step_key === afterKey);
  const key = newStepKey(steps, type);
  const step: FlowStep = {
    step_key: key,
    step_type: type,
    label,
    config: defaultConfig(type),
    position_x: after ? after.position_x : 260,
    position_y: after ? after.position_y + 130 : 40,
  };
  const old = edges.find((e) => e.source_key === afterKey && e.edge_type === branch);
  const nextEdges = edges.filter((e) => e !== old);
  if (after && stepBranches(after.step_type).includes(branch)) nextEdges.push({ source_key: afterKey, target_key: key, edge_type: branch });
  const outBranch = stepBranches(type)[0];
  if (old && outBranch) nextEdges.push({ source_key: key, target_key: old.target_key, edge_type: outBranch });
  // Shift everything below down so the new node doesn't sit on top of the next one.
  const shifted = steps.map((s) => (after && s.position_y > after.position_y && Math.abs(s.position_x - after.position_x) < 200 ? { ...s, position_y: s.position_y + 130 } : s));
  return { steps: [...shifted, step], edges: nextEdges, key };
}

/** Remove a step and reconnect its parent to its (first) child. The trigger can't be removed. */
export function removeStep(steps: FlowStep[], edges: FlowEdge[], key: string): { steps: FlowStep[]; edges: FlowEdge[] } {
  const step = steps.find((s) => s.step_key === key);
  if (!step || step.step_type === "trigger") return { steps, edges };
  const incoming = edges.filter((e) => e.target_key === key);
  const outgoing = edges.filter((e) => e.source_key === key);
  const child = outgoing.find((e) => e.edge_type === "next" || e.edge_type === "yes" || e.edge_type === "replied") || outgoing[0];
  const kept = edges.filter((e) => e.source_key !== key && e.target_key !== key);
  if (child) for (const e of incoming) kept.push({ ...e, target_key: child.target_key });
  return { steps: steps.filter((s) => s.step_key !== key), edges: kept };
}

/**
 * Readable layout: one row per touch (every Wait starts a new row, the steps after it go
 * left to right), branches drop to the next row. Spare (unconnected) steps go at the bottom.
 */
export const LAYOUT_COL = 270;
export const LAYOUT_ROW = 170;
export function autoLayout(steps: FlowStep[], edges: FlowEdge[]): FlowStep[] {
  const byKey = new Map(steps.map((s) => [s.step_key, s]));
  const pos = new Map<string, { row: number; col: number }>();
  const taken = new Set<string>();
  const put = (key: string, row: number, col: number) => {
    while (taken.has(`${row}:${col}`)) col++;
    taken.add(`${row}:${col}`);
    pos.set(key, { row, col });
    return { row, col };
  };
  const main = (t: FlowEdgeType) => t === "next" || t === "yes" || t === "replied";
  const place = (key: string, row: number, col: number) => {
    if (pos.has(key) || !byKey.has(key)) return;
    const at = put(key, row, col);
    const out = edges.filter((e) => e.source_key === key).sort((a, b) => Number(!main(a.edge_type)) - Number(!main(b.edge_type)));
    for (const e of out) {
      const child = byKey.get(e.target_key);
      if (!child) continue;
      if (!main(e.edge_type)) place(e.target_key, at.row + 1, at.col + 1);
      else if (child.step_type === "wait" || at.col >= 3) place(e.target_key, at.row + 1, 0);
      else place(e.target_key, at.row, at.col + 1);
    }
  };
  const trigger = steps.find((s) => s.step_type === "trigger");
  if (trigger) place(trigger.step_key, 0, 0);
  let lastRow = Math.max(0, ...[...pos.values()].map((p) => p.row));
  for (const s of steps) if (!pos.has(s.step_key)) put(s.step_key, ++lastRow, 0);
  return steps.map((s) => {
    const p = pos.get(s.step_key)!;
    return { ...s, position_x: 40 + p.col * LAYOUT_COL, position_y: 40 + p.row * LAYOUT_ROW };
  });
}

/** Short one-line summary of a step's config (canvas card + list view). */
export function stepSummary(step: FlowStep, t: (k: string, o?: Record<string, unknown>) => string): string {
  const c = step.config || {};
  if (step.step_type === "wait" || step.step_type === "wait_for_reply") return t(`flows.unit_${c.unit || "days"}`, { count: Number(c.amount || 0) });
  if (step.step_type === "send_email") return c.subject_en || t("flows.noSubject");
  if (step.step_type === "send_sms" || step.step_type === "notify_staff") return (c.body_en || "").slice(0, 70) || t("flows.noMessage");
  if (step.step_type === "condition") return t(`flows.check_${c.check || "goal_met"}`);
  return "";
}
