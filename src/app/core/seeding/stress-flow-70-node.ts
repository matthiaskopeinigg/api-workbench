import type { FlowArtifact, FlowEdge, FlowNode } from '@models/testing/flow';

/**
 * Builds the same shape as the bundled default in `config/flows.json`
 * (id `a1000000-0000-4000-8000-000000000024`), imported on first DB init.
 */

const START_ID = 'stress70-start';
const END_ID = 'stress70-end';
/** Transforms between start and terminate so the chain runs quickly (no HTTP). */
const TRANSFORM_COUNT = 68;

/**
 * Linear flow: Start → 68 transform passthrough → Terminate = **70 nodes** total.
 * Laid out in a loose grid for the canvas (5 columns).
 */
export function buildSeventyNodeStressFlowArtifact(flowId: string, updatedAt: number): FlowArtifact {
  const colW = 220;
  const rowH = 90;
  const cols = 5;

  const nodes: FlowNode[] = [
    { id: START_ID, kind: 'start', label: 'Start', x: 40, y: 120 },
  ];
  const edges: FlowEdge[] = [];

  let prevId = START_ID;
  for (let i = 0; i < TRANSFORM_COUNT; i++) {
    const id = `stress70-t-${i}`;
    const slot = i + 1;
    const col = slot % cols;
    const row = Math.floor(slot / cols);
    nodes.push({
      id,
      kind: 'transform',
      label: `Pass ${i + 1}`,
      x: 40 + col * colW,
      y: 120 + row * rowH,
      code: 'const output = input;',
    });
    edges.push({
      id: `stress70-e-${i}`,
      fromNodeId: prevId,
      fromPort: 'out',
      toNodeId: id,
    });
    prevId = id;
  }

  const endSlot = TRANSFORM_COUNT + 1;
  nodes.push({
    id: END_ID,
    kind: 'terminate',
    label: 'Done',
    x: 40 + (endSlot % cols) * colW,
    y: 120 + Math.floor(endSlot / cols) * rowH,
    outcome: 'success',
  });
  edges.push({
    id: 'stress70-e-end',
    fromNodeId: prevId,
    fromPort: 'out',
    toNodeId: END_ID,
  });

  return {
    id: flowId,
    title: 'Sample: 70-node transform chain',
    updatedAt,
    description:
      'Stress-test flow: 70 nodes in one line (transform passthrough). Safe to run; no network calls.',
    nodes,
    edges,
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

/** For tests: assert shape without persisting. */
export function stressFlowNodeCount(artifact: FlowArtifact): number {
  return artifact.nodes.length;
}

export function stressFlowEdgeCount(artifact: FlowArtifact): number {
  return artifact.edges.length;
}
