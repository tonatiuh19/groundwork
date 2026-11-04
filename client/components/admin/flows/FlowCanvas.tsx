import { memo, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { FlowEdge, FlowEdgeType, FlowStep } from "@shared/api";
import { cn } from "@/lib/cn";
import { stepBranches, stepSummary } from "./flowModel";
import { FlowStepIcon } from "./FlowStepIcon";

type StepNodeData = { step: FlowStep; selected: boolean; t: (k: string, o?: Record<string, unknown>) => string };
type StepNode = Node<StepNodeData, "step">;

const BRANCH_X: Record<FlowEdgeType, string> = { next: "50%", yes: "30%", replied: "30%", no: "70%", no_reply: "70%" };

const StepCard = memo(function StepCard({ data }: NodeProps<StepNode>) {
  const { step, t } = data;
  const branches = stepBranches(step.step_type);
  const sent = step.stats?.sent || 0;
  const skipped = step.stats?.skipped || 0;
  const clicked = step.stats?.clicked || 0;
  return (
    <div className={cn("gw-flow-node", `is-${step.step_type}`, data.selected && "is-selected")}>
      {step.step_type !== "trigger" ? <Handle type="target" position={Position.Top} /> : null}
      <div className="gw-flow-node__head">
        <span className="gw-flow-node__icon" aria-hidden>
          <FlowStepIcon type={step.step_type} />
        </span>
        <span className="gw-flow-node__type">{t(`flows.type_${step.step_type}`)}</span>
      </div>
      <strong className="gw-flow-node__label">{step.label}</strong>
      <span className="gw-flow-node__summary">{stepSummary(step, t)}</span>
      {sent || skipped || clicked ? (
        <span className="gw-flow-node__stats">
          {sent ? <span>{t("flows.statSentN", { count: sent })}</span> : null}
          {clicked ? <span>{t("flows.statClickedN", { count: clicked })}</span> : null}
          {skipped ? <span>{t("flows.statSkippedN", { count: skipped })}</span> : null}
        </span>
      ) : null}
      {branches.map((b) => (
        <Handle key={b} id={b} type="source" position={Position.Bottom} style={{ left: BRANCH_X[b] }} className={cn("gw-flow-handle", `is-${b}`)}>
          {b !== "next" ? <span className="gw-flow-handle__label">{t(`flows.branch_${b}`)}</span> : null}
        </Handle>
      ))}
    </div>
  );
});

const nodeTypes = { step: StepCard };

/** Visual flow editor: drag steps, connect handles (branches for conditions / wait for reply), select to edit. */
export default function FlowCanvas({
  steps,
  edges,
  selectedKey,
  readOnly,
  onSelect,
  onChange,
}: {
  steps: FlowStep[];
  edges: FlowEdge[];
  selectedKey: string | null;
  readOnly: boolean;
  onSelect: (key: string | null) => void;
  onChange: (next: { steps: FlowStep[]; edges: FlowEdge[] }) => void;
}) {
  const { t } = useTranslation();
  const nodes: StepNode[] = useMemo(
    () =>
      steps.map((s) => ({
        id: s.step_key,
        type: "step",
        position: { x: s.position_x, y: s.position_y },
        data: { step: s, selected: s.step_key === selectedKey, t },
        deletable: !readOnly && s.step_type !== "trigger",
      })),
    [steps, selectedKey, readOnly, t],
  );
  const rfEdges: Edge[] = useMemo(
    () =>
      edges.map((e) => ({
        id: `${e.source_key}:${e.edge_type}:${e.target_key}`,
        source: e.source_key,
        target: e.target_key,
        sourceHandle: e.edge_type,
        label: e.edge_type === "next" ? undefined : t(`flows.branch_${e.edge_type}`),
        className: `gw-flow-edge is-${e.edge_type}`,
        markerEnd: { type: MarkerType.ArrowClosed },
        deletable: !readOnly,
      })),
    [edges, readOnly, t],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange<StepNode>[]) => {
      if (readOnly) return;
      let next = steps;
      let nextEdges = edges;
      let changed = false;
      for (const c of changes) {
        if (c.type === "position" && c.position) {
          next = next.map((s) => (s.step_key === c.id ? { ...s, position_x: Math.round(c.position!.x), position_y: Math.round(c.position!.y) } : s));
          changed = true;
        } else if (c.type === "remove") {
          next = next.filter((s) => s.step_key !== c.id || s.step_type === "trigger");
          nextEdges = nextEdges.filter((e) => e.source_key !== c.id && e.target_key !== c.id);
          changed = true;
        }
      }
      if (changed) onChange({ steps: next, edges: nextEdges });
    },
    [steps, edges, readOnly, onChange],
  );
  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      if (readOnly) return;
      const removed = new Set(changes.filter((c) => c.type === "remove").map((c) => c.id));
      if (removed.size) onChange({ steps, edges: edges.filter((e) => !removed.has(`${e.source_key}:${e.edge_type}:${e.target_key}`)) });
    },
    [steps, edges, readOnly, onChange],
  );
  const onConnect = useCallback(
    (c: Connection) => {
      if (readOnly || !c.source || !c.target || c.source === c.target) return;
      const type = (c.sourceHandle || "next") as FlowEdgeType;
      // One edge per branch: a new connection replaces the old one.
      const kept = edges.filter((e) => !(e.source_key === c.source && e.edge_type === type));
      onChange({ steps, edges: [...kept, { source_key: c.source, target_key: c.target, edge_type: type }] });
    },
    [steps, edges, readOnly, onChange],
  );

  return (
    <div className="gw-flow-canvas">
      <ReactFlow
        nodes={nodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={(_, n) => onSelect(n.id)}
        onPaneClick={() => onSelect(null)}
        nodesDraggable={!readOnly}
        nodesConnectable={!readOnly}
        deleteKeyCode={readOnly ? null : ["Backspace", "Delete"]}
        fitView
        fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
        minZoom={0.2}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={20} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
