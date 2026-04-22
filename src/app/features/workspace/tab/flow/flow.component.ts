import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  Input,
  OnDestroy,
  OnInit,
  ViewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, takeUntil } from 'rxjs';
import { v4 as uuidv4 } from 'uuid';

import type { TabItem } from '@core/tab.service';
import { TestArtifactService } from '@core/test-artifact.service';
import { FlowExecutorService } from '@core/flow-executor.service';
import { CollectionService } from '@core/collection.service';
import type {
  BranchNode,
  FlowArtifact,
  FlowEdge,
  FlowNode,
  FlowNodeKind,
  FlowNodeRunResult,
  FlowNodeStatus,
  FlowRunResult,
  RequestNode,
  SetVarNode,
  TransformNode,
  AssertNode,
  DelayNode,
  TerminateNode,
} from '@models/testing/flow';
import type { Collection, Folder } from '@models/collection';
import { HttpMethod, type Request as RequestModel } from '@models/request';

import { StatCardComponent } from '../../shared/testing-ui/stat-card.component';
import { RunEnvironmentSelectComponent } from '../../shared/testing-ui/run-environment-select.component';

interface RequestPick { id: string; label: string; method: string; }

interface PaletteItem {
  kind: FlowNodeKind;
  label: string;
  color: string;
}

const PALETTE: PaletteItem[] = [
  { kind: 'request',   label: 'Request',   color: '#2563eb' },
  { kind: 'transform', label: 'Transform', color: '#6366f1' },
  { kind: 'set-var',   label: 'Set Var',   color: '#8b5cf6' },
  { kind: 'branch',    label: 'Branch',    color: '#d97706' },
  { kind: 'assert',    label: 'Assert',    color: '#dc2626' },
  { kind: 'delay',     label: 'Delay',     color: '#6b7280' },
  { kind: 'terminate', label: 'Terminate', color: '#16a34a' },
];

const HTTP_METHOD_LABELS: Record<number, string> = {
  [HttpMethod.GET]: 'GET',
  [HttpMethod.POST]: 'POST',
  [HttpMethod.PUT]: 'PUT',
  [HttpMethod.DELETE]: 'DELETE',
  [HttpMethod.PATCH]: 'PATCH',
  [HttpMethod.HEAD]: 'HEAD',
  [HttpMethod.OPTIONS]: 'OPTIONS',
};

const NODE_W = 180;
const NODE_H = 60;

const VIEW_MIN = 400;
const VIEW_MAX = 6000;
const VIEW_DEFAULT_W = 2000;
const VIEW_DEFAULT_H = 1500;

@Component({
  selector: 'app-flow',
  standalone: true,
  imports: [CommonModule, FormsModule, StatCardComponent, RunEnvironmentSelectComponent],
  templateUrl: './flow.component.html',
  styleUrls: ['./flow.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FlowComponent implements OnInit, OnDestroy {
  @Input() tab!: TabItem;

  @ViewChild('canvas', { static: false }) canvasEl?: ElementRef<SVGSVGElement>;

  artifact: FlowArtifact | null = null;
  palette = PALETTE;

  selectedNodeId: string | null = null;
  hoveringNodeId: string | null = null;

  running = false;
  runId: string | null = null;
  runResult: FlowRunResult | null = null;
  /** Live per-node status for lighting up the canvas. */
  nodeStatus = new Map<string, FlowNodeStatus>();
  nodeMessages = new Map<string, string>();

  requestPicks: RequestPick[] = [];

  /** `null` = workspace default; seeds flow `{{var}}` from the chosen env. */
  runEnvironmentId: string | null = null;

  private dragNodeId: string | null = null;
  private dragOffset = { x: 0, y: 0 };

  private edgeDraft: { fromNodeId: string; fromPort: FlowEdge['fromPort']; x: number; y: number } | null = null;

  viewport = { x: 0, y: 0, w: VIEW_DEFAULT_W, h: VIEW_DEFAULT_H };
  private panStart: { screenX: number; screenY: number; vx: number; vy: number } | null = null;

  private destroy$ = new Subject<void>();

  constructor(
    private artifacts: TestArtifactService,
    private executor: FlowExecutorService,
    private collections: CollectionService,
    private cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    const id = stripPrefix(this.tab.id);
    this.artifacts.flows$().pipe(takeUntil(this.destroy$)).subscribe((all) => {
      const found = all.find((a) => a.id === id);
      if (!found) return;
      this.artifact = JSON.parse(JSON.stringify(found));
      this.cdr.markForCheck();
    });

    this.collections.getCollectionsObservable().pipe(takeUntil(this.destroy$)).subscribe((cols) => {
      this.requestPicks = flattenRequests(cols);
      this.cdr.markForCheck();
    });
    this.requestPicks = flattenRequests(this.collections.getCollections() || []);

    this.executor.onStep().pipe(takeUntil(this.destroy$)).subscribe(({ flowId, step }) => {
      if (!this.artifact || flowId !== this.artifact.id) return;
      this.nodeStatus.set(step.nodeId, step.status);
      if (step.message) this.nodeMessages.set(step.nodeId, step.message);
      this.cdr.markForCheck();
    });

    this.executor.onDone().pipe(takeUntil(this.destroy$)).subscribe((res) => {
      if (!this.artifact || res.flowId !== this.artifact.id) return;
      this.runResult = res;
      this.running = false;
      this.cdr.markForCheck();
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  addNode(kind: FlowNodeKind): void {
    if (!this.artifact) return;
    const x = 160 + (this.artifact.nodes.length % 5) * 40;
    const y = 200 + Math.floor(this.artifact.nodes.length / 5) * 20;
    const node = createNode(kind, x, y);
    this.artifact.nodes = [...this.artifact.nodes, node];
    this.selectedNodeId = node.id;
    this.persist();
  }

  removeNode(nodeId: string): void {
    if (!this.artifact) return;
    if (nodeId === 'start') return;
    this.artifact.nodes = this.artifact.nodes.filter((n) => n.id !== nodeId);
    this.artifact.edges = this.artifact.edges.filter((e) => e.fromNodeId !== nodeId && e.toNodeId !== nodeId);
    if (this.selectedNodeId === nodeId) this.selectedNodeId = null;
    this.persist();
  }

  onNodeMouseDown(event: MouseEvent, nodeId: string): void {
    event.stopPropagation();
    event.preventDefault();
    if (!this.artifact) return;
    const node = this.artifact.nodes.find((n) => n.id === nodeId);
    if (!node) return;
    this.selectedNodeId = nodeId;
    this.dragNodeId = nodeId;
    const pt = this.toSvgPoint(event);
    this.dragOffset = { x: pt.x - node.x, y: pt.y - node.y };
  }

  onCanvasMouseMove(event: MouseEvent): void {
    if (this.panStart) {
      const svg = this.canvasEl?.nativeElement;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const unitsPerPxX = this.viewport.w / Math.max(1, rect.width);
      const unitsPerPxY = this.viewport.h / Math.max(1, rect.height);
      const dx = (event.clientX - this.panStart.screenX) * unitsPerPxX;
      const dy = (event.clientY - this.panStart.screenY) * unitsPerPxY;
      this.viewport = {
        ...this.viewport,
        x: this.panStart.vx - dx,
        y: this.panStart.vy - dy,
      };
      this.cdr.markForCheck();
      return;
    }
    const pt = this.toSvgPoint(event);
    if (this.dragNodeId && this.artifact) {
      const node = this.artifact.nodes.find((n) => n.id === this.dragNodeId);
      if (node) {
        node.x = Math.max(0, pt.x - this.dragOffset.x);
        node.y = Math.max(0, pt.y - this.dragOffset.y);
        this.cdr.markForCheck();
      }
    }
    if (this.edgeDraft) {
      this.edgeDraft.x = pt.x;
      this.edgeDraft.y = pt.y;
      this.cdr.markForCheck();
    }
  }

  onCanvasMouseUp(event: MouseEvent): void {
    if (this.panStart) {
      this.panStart = null;
      this.cdr.markForCheck();
      return;
    }
    if (this.dragNodeId) {
      this.dragNodeId = null;
      this.persist();
    }
    if (this.edgeDraft) {
      const target = this.hitTestNode(this.toSvgPoint(event));
      if (target && target.id !== this.edgeDraft.fromNodeId) {
        this.connect(this.edgeDraft.fromNodeId, this.edgeDraft.fromPort, target.id);
      }
      this.edgeDraft = null;
      this.cdr.markForCheck();
    }
  }

  /**
   * Wheel-zoom anchored at the cursor position. The invariant: the SVG
   * coordinate under the cursor must stay put while the viewport scales.
   *
   *   svgPt = viewport.x + (screenPt / canvasSize) * viewport.w
   *
   * Solving for the new viewport.x after scaling viewport.w by `factor` gives
   * the formula below. Trackpad pinches arrive as wheel events with
   * `ctrlKey=true`; either path funnels through this method.
   */
  onCanvasWheel(event: WheelEvent): void {
    const svg = this.canvasEl?.nativeElement;
    if (!svg) return;
    event.preventDefault();
    const rect = svg.getBoundingClientRect();
    const relX = (event.clientX - rect.left) / Math.max(1, rect.width);
    const relY = (event.clientY - rect.top) / Math.max(1, rect.height);
    const svgX = this.viewport.x + relX * this.viewport.w;
    const svgY = this.viewport.y + relY * this.viewport.h;

    const intensity = Math.min(Math.abs(event.deltaY), 50);
    const zoomStep = 1 + intensity * 0.01;
    const factor = event.deltaY > 0 ? zoomStep : 1 / zoomStep;

    const aspect = this.viewport.h / this.viewport.w;
    let newW = this.viewport.w * factor;
    newW = Math.max(VIEW_MIN, Math.min(VIEW_MAX, newW));
    const newH = newW * aspect;
    const newX = svgX - relX * newW;
    const newY = svgY - relY * newH;

    this.viewport = { x: newX, y: newY, w: newW, h: newH };
    this.cdr.markForCheck();
  }

  /**
   * Middle-mouse or Alt+left-drag pans the canvas. We deliberately keep the
   * left-button alone unbound so clicks on empty canvas still clear the
   * selection (a frequent action when users are editing node properties).
   */
  onCanvasMouseDown(event: MouseEvent): void {
    const isPanButton = event.button === 1 || (event.button === 0 && event.altKey);
    if (!isPanButton) return;
    event.preventDefault();
    this.panStart = {
      screenX: event.clientX,
      screenY: event.clientY,
      vx: this.viewport.x,
      vy: this.viewport.y,
    };
  }

  /** "Fit view" — frames all nodes with a modest margin. */
  resetView(): void {
    if (!this.artifact || this.artifact.nodes.length === 0) {
      this.viewport = { x: 0, y: 0, w: VIEW_DEFAULT_W, h: VIEW_DEFAULT_H };
      this.cdr.markForCheck();
      return;
    }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of this.artifact.nodes) {
      if (n.x < minX) minX = n.x;
      if (n.y < minY) minY = n.y;
      if (n.x + NODE_W > maxX) maxX = n.x + NODE_W;
      if (n.y + NODE_H > maxY) maxY = n.y + NODE_H;
    }
    const pad = 120;
    const w = Math.max(VIEW_MIN, maxX - minX + pad * 2);
    const h = Math.max(VIEW_MIN, maxY - minY + pad * 2);
    this.viewport = { x: minX - pad, y: minY - pad, w, h };
    this.cdr.markForCheck();
  }

  get viewBox(): string {
    const v = this.viewport;
    return `${v.x} ${v.y} ${v.w} ${v.h}`;
  }

  get zoomPercent(): number {
    return Math.round((VIEW_DEFAULT_W / this.viewport.w) * 100);
  }

  onCanvasClick(): void {
    this.selectedNodeId = null;
  }

  onPortMouseDown(event: MouseEvent, nodeId: string, port: FlowEdge['fromPort']): void {
    event.stopPropagation();
    const pt = this.toSvgPoint(event);
    this.edgeDraft = { fromNodeId: nodeId, fromPort: port, x: pt.x, y: pt.y };
  }

  private connect(fromNodeId: string, fromPort: FlowEdge['fromPort'], toNodeId: string): void {
    if (!this.artifact) return;
    if (this.artifact.edges.some((e) => e.fromNodeId === fromNodeId && e.fromPort === fromPort && e.toNodeId === toNodeId)) return;
    this.artifact.edges = [...this.artifact.edges, { id: uuidv4(), fromNodeId, fromPort, toNodeId }];
    this.persist();
  }

  removeEdge(edgeId: string): void {
    if (!this.artifact) return;
    this.artifact.edges = this.artifact.edges.filter((e) => e.id !== edgeId);
    this.persist();
  }

  get selectedNode(): FlowNode | null {
    if (!this.artifact || !this.selectedNodeId) return null;
    return this.artifact.nodes.find((n) => n.id === this.selectedNodeId) || null;
  }

  get selectedNodeStep(): FlowNodeRunResult | null {
    if (!this.runResult || !this.selectedNodeId) return null;
    return this.runResult.steps.find((s) => s.nodeId === this.selectedNodeId) || null;
  }

  asRequest(n: FlowNode): RequestNode { return n as RequestNode; }
  asTransform(n: FlowNode): TransformNode { return n as TransformNode; }
  asBranch(n: FlowNode): BranchNode { return n as BranchNode; }
  asDelay(n: FlowNode): DelayNode { return n as DelayNode; }
  asSetVar(n: FlowNode): SetVarNode { return n as SetVarNode; }
  asAssert(n: FlowNode): AssertNode { return n as AssertNode; }
  asTerminate(n: FlowNode): TerminateNode { return n as TerminateNode; }

  onInspectorChange(): void { this.persist(); }

  onRunEnvironmentChange(id: string | null): void {
    this.runEnvironmentId = id;
    this.cdr.markForCheck();
  }

  setRequestTargetKind(n: RequestNode, kind: 'saved' | 'inline'): void {
    n.target = kind === 'saved'
      ? { kind: 'saved', requestId: '' }
      : { kind: 'inline', method: 'GET', url: '' };
    this.persist();
  }

  async runFlow(): Promise<void> {
    if (!this.artifact || this.running) return;
    this.runResult = null;
    this.nodeStatus.clear();
    this.nodeMessages.clear();
    this.running = true;
    this.runId = uuidv4();
    this.cdr.markForCheck();
    try {
      await this.executor.run(
        this.artifact,
        this.runEnvironmentId != null ? { environmentId: this.runEnvironmentId } : undefined,
      );
    } finally {
      this.running = false;
      this.cdr.markForCheck();
    }
  }

  cancelFlow(): void {
    if (!this.artifact) return;
    this.executor.cancel(this.artifact.id);
  }

  private toSvgPoint(event: MouseEvent): { x: number; y: number } {
    const svg = this.canvasEl?.nativeElement;
    if (!svg) return { x: 0, y: 0 };
    const p = svg.createSVGPoint();
    p.x = event.clientX;
    p.y = event.clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: event.clientX, y: event.clientY };
    const t = p.matrixTransform(ctm.inverse());
    return { x: t.x, y: t.y };
  }

  private hitTestNode(pt: { x: number; y: number }): FlowNode | null {
    if (!this.artifact) return null;
    for (const n of this.artifact.nodes) {
      if (pt.x >= n.x && pt.x <= n.x + NODE_W && pt.y >= n.y && pt.y <= n.y + NODE_H) return n;
    }
    return null;
  }

  edgePath(edge: FlowEdge): string {
    if (!this.artifact) return '';
    const from = this.artifact.nodes.find((n) => n.id === edge.fromNodeId);
    const to = this.artifact.nodes.find((n) => n.id === edge.toNodeId);
    if (!from || !to) return '';
    const offset = portOffset(from, edge.fromPort);
    const x1 = from.x + NODE_W;
    const y1 = from.y + offset;
    const x2 = to.x;
    const y2 = to.y + NODE_H / 2;
    const midX = (x1 + x2) / 2;
    return `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`;
  }

  draftPath(): string {
    if (!this.artifact || !this.edgeDraft) return '';
    const from = this.artifact.nodes.find((n) => n.id === this.edgeDraft!.fromNodeId);
    if (!from) return '';
    const offset = portOffset(from, this.edgeDraft.fromPort);
    const x1 = from.x + NODE_W;
    const y1 = from.y + offset;
    const x2 = this.edgeDraft.x;
    const y2 = this.edgeDraft.y;
    const midX = (x1 + x2) / 2;
    return `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`;
  }

  nodeColor(node: FlowNode): string {
    const match = PALETTE.find((p) => p.kind === node.kind);
    if (node.kind === 'start') return '#16a34a';
    return match ? match.color : '#6b7280';
  }

  nodeStatusClass(nodeId: string): string {
    const s = this.nodeStatus.get(nodeId);
    return s ? `status-${s}` : '';
  }

  nodeLabel(node: FlowNode): string {
    if (node.label) return node.label;
    return PALETTE.find((p) => p.kind === node.kind)?.label || node.kind;
  }

  nodeSubtitle(node: FlowNode): string {
    switch (node.kind) {
      case 'request':
        if (node.target.kind === 'inline') return `${node.target.method} ${truncate(node.target.url, 26)}`;
        {
          const req = this.collections.findRequestById(node.target.requestId);
          return req ? `${HTTP_METHOD_LABELS[req.httpMethod] || 'GET'} ${truncate(req.title || req.url, 26)}` : '(no request)';
        }
      case 'branch': return truncate(node.expression || 'true', 26);
      case 'assert': return truncate(node.expression || '', 26);
      case 'set-var': return `${node.varName || 'var'} = …`;
      case 'delay': return `${node.ms} ms`;
      case 'terminate': return node.outcome;
      case 'transform': return 'return output';
      case 'start': return '';
    }
  }

  onTitleChange(): void { this.persist(); }

  trackByNode = (_: number, n: FlowNode) => n.id;
  trackByEdge = (_: number, e: FlowEdge) => e.id;

  private persist(): void {
    if (!this.artifact) return;
    void this.artifacts.update('flows', { ...this.artifact, updatedAt: Date.now() });
  }
}

function stripPrefix(tabId: string): string {
  return tabId.startsWith('fl:') ? tabId.slice(3) : tabId;
}

function portOffset(node: FlowNode, port: FlowEdge['fromPort']): number {
  if (node.kind === 'branch') {
    return port === 'true' ? NODE_H * 0.3 : NODE_H * 0.7;
  }
  return NODE_H / 2;
}

function createNode(kind: FlowNodeKind, x: number, y: number): FlowNode {
  const id = uuidv4();
  switch (kind) {
    case 'start': return { id, kind, label: 'Start', x, y };
    case 'request': return { id, kind, label: 'Request', x, y, target: { kind: 'inline', method: 'GET', url: '' } };
    case 'transform': return { id, kind, label: 'Transform', x, y, code: 'const output = input;' };
    case 'branch': return { id, kind, label: 'Branch', x, y, expression: 'input.status === 200' };
    case 'delay': return { id, kind, label: 'Delay', x, y, ms: 1000 };
    case 'set-var': return { id, kind, label: 'Set Var', x, y, varName: 'token', expression: 'input.body.token' };
    case 'assert': return { id, kind, label: 'Assert', x, y, expression: 'input.status < 300' };
    case 'terminate': return { id, kind, label: 'Terminate', x, y, outcome: 'success' };
  }
}

function flattenRequests(cols: Collection[]): RequestPick[] {
  const out: RequestPick[] = [];
  const walk = (folders: Folder[] = [], parentLabel: string) => {
    for (const f of folders) {
      const label = parentLabel ? `${parentLabel} / ${f.title}` : f.title;
      for (const req of f.requests || []) out.push(toPick(req, label));
      if (f.folders?.length) walk(f.folders, label);
    }
  };
  for (const c of cols) {
    for (const req of c.requests || []) out.push(toPick(req, c.title));
    walk(c.folders || [], c.title);
  }
  return out;
}

function toPick(req: RequestModel, parentLabel: string): RequestPick {
  return {
    id: req.id,
    label: `${parentLabel} / ${req.title || req.url || '(untitled)'}`,
    method: HTTP_METHOD_LABELS[req.httpMethod] || 'GET',
  };
}

function truncate(s: string | undefined, n: number): string {
  if (!s) return '';
  return s.length > n ? `${s.slice(0, n)}…` : s;
}
