/**
 * Shared types for the Flow Builder tab. A flow is a directed graph of
 * typed nodes. The renderer-side `FlowExecutor` walks the graph in
 * topological order; per-node logic dispatches on `node.kind`.
 */

export interface FlowArtifact {
  id: string;
  title: string;
  updatedAt: number;
  description?: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
  /** Last-saved viewport (pan + zoom) for the canvas. */
  viewport: FlowViewport;
}

export interface FlowViewport {
  x: number;
  y: number;
  zoom: number;
}

export type FlowNodeKind =
  | 'start'
  | 'request'
  | 'transform'
  | 'branch'
  | 'delay'
  | 'set-var'
  | 'assert'
  | 'terminate'
  | 'db-query';

export interface FlowNodeBase {
  id: string;
  kind: FlowNodeKind;
  /** Display label. */
  label: string;
  /** Canvas coordinates of the node's top-left. */
  x: number;
  y: number;
}

export interface StartNode extends FlowNodeBase { kind: 'start'; }
export interface RequestNode extends FlowNodeBase {
  kind: 'request';
  /** Either reference a saved request or carry an inline one. */
  target:
    | { kind: 'saved'; requestId: string }
    | { kind: 'inline'; method: string; url: string; headers?: Array<{ key: string; value: string }>; body?: string };
}
export interface TransformNode extends FlowNodeBase {
  kind: 'transform';
  /** JS source. The expression `output` is the value passed downstream;
   * `input` and `vars` are available. */
  code: string;
}
export interface BranchNode extends FlowNodeBase {
  kind: 'branch';
  /** JS expression returning a truthy/falsy value, e.g. `vars.status === 200`. */
  expression: string;
}
export interface DelayNode extends FlowNodeBase {
  kind: 'delay';
  ms: number;
}
export interface SetVarNode extends FlowNodeBase {
  kind: 'set-var';
  varName: string;
  /** JS expression evaluated with `input`/`vars` in scope. */
  expression: string;
}
export interface AssertNode extends FlowNodeBase {
  kind: 'assert';
  /** JS expression that must be truthy; otherwise the flow halts. */
  expression: string;
  message?: string;
}
export interface TerminateNode extends FlowNodeBase {
  kind: 'terminate';
  /** Whether reaching this node marks the flow as success or failure. */
  outcome: 'success' | 'failure';
}

export interface DbQueryNode extends FlowNodeBase {
  kind: 'db-query';
  /** ID of a connection defined in settings. */
  connectionId: string;
  /** Query string (e.g. "GET user:123"). Supports placeholders. */
  query: string;
  /** Optional variable name to store the result. */
  targetVarName?: string;
}

export type FlowNode =
  | StartNode | RequestNode | TransformNode | BranchNode
  | DelayNode | SetVarNode | AssertNode | TerminateNode
  | DbQueryNode;

export interface FlowEdge {
  id: string;
  fromNodeId: string;
  /** "out" for most nodes; branch nodes use "true" / "false". */
  fromPort: 'out' | 'true' | 'false';
  toNodeId: string;
  /** Inputs land on the implicit "in" port — no need to model explicitly. */
}

export type FlowNodeStatus = 'idle' | 'running' | 'success' | 'failed' | 'skipped';

export interface FlowNodeRunResult {
  nodeId: string;
  status: FlowNodeStatus;
  startedAt: number;
  durationMs: number;
  /** What this node received as input. */
  input?: unknown;
  /** What this node forwarded downstream. */
  output?: unknown;
  message?: string;
}

export interface FlowRunResult {
  runId: string;
  flowId: string;
  startedAt: number;
  endedAt: number;
  outcome: 'success' | 'failure' | 'cancelled';
  /** Final variable bag. */
  variables: Record<string, unknown>;
  steps: FlowNodeRunResult[];
}

export const NEW_FLOW = (id: string): FlowArtifact => ({
  id,
  title: 'Untitled flow',
  updatedAt: Date.now(),
  description: '',
  nodes: [
    { id: 'start', kind: 'start', label: 'Start', x: 80, y: 80 },
  ],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
});
