import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  HostBinding,
  HostListener,
  Input,
  AfterViewInit,
  OnChanges,
  OnDestroy,
  OnInit,
  SimpleChanges,
  ViewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, takeUntil } from 'rxjs';
import { v4 as uuidv4 } from 'uuid';

import type { TabItem } from '@core/tabs/tab.service';
import { TestArtifactService } from '@core/testing/test-artifact.service';
import { FlowExecutorService } from '@core/testing/flow-executor.service';
import { CollectionService } from '@core/collection/collection.service';
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
import { AwDatePipe } from '../../shared/pipes/aw-date.pipe';

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

/** Keep canvas labels left of the output port (≈x 174); 12px text ≈6px/char at this size. */
const NODE_LABEL_MAX_CHARS = 18;
/** Monospace subtitle; same horizontal budget. */
const NODE_SUB_MAX_CHARS = 20;

const VIEW_MIN = 400;
const VIEW_MAX = 6000;
const VIEW_DEFAULT_W = 2000;
const VIEW_DEFAULT_H = 1500;

const FLOW_CLIPBOARD_KIND = 'api-workbench-flow-fragment' as const;
const PASTE_OFFSET_X = 32;
const PASTE_OFFSET_Y = 32;

@Component({
  selector: 'app-flow',
  standalone: true,
  imports: [CommonModule, FormsModule, StatCardComponent, RunEnvironmentSelectComponent, AwDatePipe],
  templateUrl: './flow.component.html',
  styleUrls: ['./flow.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FlowComponent implements OnInit, OnChanges, AfterViewInit, OnDestroy {
  /** Lets Ctrl/Cmd+C / V work after clicking the flow without focus jumping to the URL bar. */
  @HostBinding('attr.tabindex') readonly flowHostTabindex = -1;

  @Input() tab!: TabItem;

  @ViewChild('canvas', { static: false }) canvasEl?: ElementRef<SVGSVGElement>;
  @ViewChild('canvasWrap', { read: ElementRef, static: false })
  private canvasWrapEl?: ElementRef<HTMLElement>;

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
  zoom = 1;
  private panStart: { screenX: number; screenY: number; vx: number; vy: number } | null = null;

  isNarrow = false;
  paletteCollapsed = false;
  inspectorCollapsed = false;

  private destroy$ = new Subject<void>();
  private canvasResizeObserver?: ResizeObserver;
  private canvasResizeDebounce?: ReturnType<typeof setTimeout>;
  private lastCanvasBox = { w: 0, h: 0 };

  constructor(
    private artifacts: TestArtifactService,
    private executor: FlowExecutorService,
    private collections: CollectionService,
    private cdr: ChangeDetectorRef,
    private hostRef: ElementRef<HTMLElement>,
  ) {}

  /**
   * Load the flow matching the **current** tab from the artifact store.
   * The tab host reuses one `app-flow` instance when switching between open flow tabs.
   */
  private applyFlowFromStore(): void {
    if (this.dragNodeId || this.edgeDraft) {
      return;
    }
    const flowId = stripPrefix(this.tab.id);
    const found = this.artifacts.flows().find((a) => a.id === flowId);
    const prevArtifactId = this.artifact?.id ?? null;
    const prevSelectedNodeId = this.selectedNodeId;
    const prevRunResult = this.runResult;
    const prevRunId = this.runId;
    const prevRunning = this.running;
    if (!found) {
      this.artifact = null;
      this.selectedNodeId = null;
      this.runResult = null;
      this.runId = null;
      this.running = false;
      this.nodeStatus.clear();
      this.nodeMessages.clear();
      this.cdr.markForCheck();
      queueMicrotask(() => this.bindCanvasResizeObserver());
      return;
    }
    this.artifact = JSON.parse(JSON.stringify(found)) as FlowArtifact;
    normalizeFlowArtifactCoords(this.artifact);
    // Same document re-synced from store (e.g. after persist on mouseup). Do not wipe
    // selection — otherwise a click-drag-release clears the node we just selected.
    const sameDocument =
      prevArtifactId !== null && prevArtifactId === this.artifact.id;
    const keepSelection =
      sameDocument &&
      !!prevSelectedNodeId &&
      this.artifact.nodes.some((n) => n.id === prevSelectedNodeId);
    this.selectedNodeId = keepSelection ? prevSelectedNodeId : null;

    const keepRunUi =
      sameDocument &&
      prevRunResult &&
      prevRunResult.flowId === this.artifact.id;
    if (keepRunUi) {
      this.runResult = prevRunResult;
      this.runId = prevRunId ?? prevRunResult.runId;
      this.running = prevRunning;
      this.nodeStatus.clear();
      this.nodeMessages.clear();
      for (const st of prevRunResult.steps) {
        this.nodeStatus.set(st.nodeId, st.status);
        if (st.message) this.nodeMessages.set(st.nodeId, st.message);
      }
    } else {
      this.runResult = null;
      this.runId = null;
      this.running = false;
      this.nodeStatus.clear();
      this.nodeMessages.clear();
    }

    if (!sameDocument) {
      if (this.artifact.viewport) {
        this.viewport.x = this.artifact.viewport.x;
        this.viewport.y = this.artifact.viewport.y;
        this.zoom = this.artifact.viewport.zoom || 1;
        // The w/h will be computed on the next resize observer tick (queueMicrotask below)
      } else {
        this.resetView();
      }
    }
    this.cdr.markForCheck();
    queueMicrotask(() => this.bindCanvasResizeObserver());
  }

  ngOnInit(): void {
    // One <app-flow> is reused for whichever flow tab is active; always read `this.tab.id`
    // when the store emits. `ngOnChanges` handles tab switches when flows$ does not emit.
    this.artifacts.flows$().pipe(takeUntil(this.destroy$)).subscribe(() => {
      this.applyFlowFromStore();
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

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes['tab']?.currentValue) return;
    const cur = changes['tab'].currentValue as TabItem;
    const prev = changes['tab'].previousValue as TabItem | undefined;
    if (prev && cur.id === prev.id) return;
    this.applyFlowFromStore();
  }

  ngAfterViewInit(): void {
    queueMicrotask(() => this.bindCanvasResizeObserver());
  }

  /** Canvas host lives under `*ngIf="artifact"`; re-bind whenever the view appears. */
  private bindCanvasResizeObserver(): void {
    if (typeof ResizeObserver === 'undefined') {
      return;
    }
    const el = this.canvasWrapEl?.nativeElement;
    this.canvasResizeObserver?.disconnect();
    this.canvasResizeObserver = undefined;
    if (!el) {
      return;
    }
    this.canvasResizeObserver = new ResizeObserver((entries) => {
      for (const e of entries) {
        this.scheduleFlowCanvasSizeReact(e.contentRect);
      }
    });
    this.canvasResizeObserver.observe(el);
    this.lastCanvasBox = { w: 0, h: 0 };
  }

  /**
   * Split-pane and sash moves do not fire `window.resize`; the SVG `viewBox` is otherwise
   * frozen while the on-screen size changes, so nodes look tiny.
   */
  private scheduleFlowCanvasSizeReact(contentRect: DOMRectReadOnly): void {
    const w = Math.round(contentRect.width);
    const h = Math.round(contentRect.height);

    const hostW = this.hostRef.nativeElement.clientWidth;
    const wasNarrow = this.isNarrow;
    this.isNarrow = hostW < 650;
    if (this.isNarrow && !wasNarrow) {
      // Auto-collapse sidebars when entering narrow mode to maximize canvas space
      this.paletteCollapsed = true;
      this.inspectorCollapsed = true;
      this.cdr.markForCheck();
    }

    if (w < 8 || h < 8) {
      this.lastCanvasBox = { w, h };
      return;
    }

    const prevW = this.lastCanvasBox.w;
    this.lastCanvasBox = { w, h };

    // Maintain zoom level on resize
    const zoom = this.zoom || 1;
    this.viewport.w = w / zoom;
    this.viewport.h = h / zoom;

    // If this is the first real size we've seen, or if the view is currently
    // microscopic, do a one-time fit-view.
    const isFirstSize = prevW < 8;
    const isMicroscopic = this.zoom < 0.4;
    if (isFirstSize || isMicroscopic) {
      this.resetView();
    }

    this.cdr.markForCheck();
  }

  ngOnDestroy(): void {
    if (this.canvasResizeDebounce) {
      clearTimeout(this.canvasResizeDebounce);
    }
    this.canvasResizeObserver?.disconnect();
    this.canvasResizeObserver = undefined;
    this.destroy$.next();
    this.destroy$.complete();
  }

  /** Picked up on document so drags/edge drafts work when the pointer leaves the canvas SVG. */
  @HostListener('document:mousemove', ['$event'])
  onDocumentMouseMove(event: MouseEvent): void {
    if (!this.panStart && !this.dragNodeId && !this.edgeDraft) return;
    this.onCanvasMouseMove(event);
  }

  @HostListener('document:mouseup', ['$event'])
  onDocumentMouseUp(event: MouseEvent): void {
    if (!this.panStart && !this.dragNodeId && !this.edgeDraft) return;
    this.onCanvasMouseUp(event);
  }

  @HostListener('document:keydown', ['$event'])
  onDocumentKeydown(event: KeyboardEvent): void {
    if (!this.artifact) return;
    if (!(event.ctrlKey || event.metaKey)) return;
    const k = event.key.toLowerCase();
    if (k !== 'c' && k !== 'v') return;
    if (this.isEditableKeyTarget(event.target)) return;
    if (!this.isFlowHotkeyContext()) return;
    if (k === 'c') {
      event.preventDefault();
      this.copySelectionToClipboard();
    } else {
      if (this.running) return;
      event.preventDefault();
      void this.pasteFromClipboard();
    }
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
    // Do not call preventDefault(): it suppresses the synthetic click on some engines,
    // so (click) never runs on the node and the bubble hits canvas-wrap → selection clears.
    if (!this.artifact) return;
    const node = this.artifact.nodes.find((n) => n.id === nodeId);
    if (!node) return;
    this.selectedNodeId = nodeId;
    this.dragNodeId = nodeId;
    const pt = this.toSvgPoint(event);
    const px = toNodeCoord(node.x);
    const py = toNodeCoord(node.y);
    this.dragOffset = { x: pt.x - px, y: pt.y - py };
    this.cdr.markForCheck();
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
    if (this.panStart) {
      this.panStart = null;
      this.persistViewport();
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
    this.zoom = rect.width / newW;
    this.persistViewport();
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
      this.zoom = 1;
      this.cdr.markForCheck();
      return;
    }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of this.artifact.nodes) {
      const nx = toNodeCoord(n.x);
      const ny = toNodeCoord(n.y);
      if (nx < minX) minX = nx;
      if (ny < minY) minY = ny;
      if (nx + NODE_W > maxX) maxX = nx + NODE_W;
      if (ny + NODE_H > maxY) maxY = ny + NODE_H;
    }
    const pad = 120;
    const nodesW = maxX - minX + pad * 2;
    const nodesH = maxY - minY + pad * 2;

    const canvasW = this.lastCanvasBox.w || 800;
    const canvasH = this.lastCanvasBox.h || 600;

    // Calculate zoom needed to fit all nodes, but keep a floor for readability.
    // If they don't fit at 45%, the user can pan.
    const zoomW = canvasW / nodesW;
    const zoomH = canvasH / nodesH;
    this.zoom = Math.max(0.45, Math.min(zoomW, zoomH, 1.5));

    this.viewport.w = canvasW / this.zoom;
    this.viewport.h = canvasH / this.zoom;
    this.viewport.x = minX - pad - (this.viewport.w - nodesW) / 2;
    this.viewport.y = minY - pad - (this.viewport.h - nodesH) / 2;

    this.persistViewport();
    this.cdr.markForCheck();
  }

  get viewBox(): string {
    const v = this.viewport;
    return `${v.x} ${v.y} ${v.w} ${v.h}`;
  }

  get zoomPercent(): number {
    return Math.round(this.zoom * 100);
  }

  get copyPasteHint(): string {
    if (typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
      return '⌘C / ⌘V copy & paste';
    }
    return 'Ctrl+C / Ctrl+V copy & paste';
  }

  onCanvasClick(event: MouseEvent): void {
    const t = event.target as Element | null;
    if (t?.closest?.('.node')) {
      return;
    }
    this.focusFlowHost();
    this.selectedNodeId = null;
  }

  onFlowShellMouseDown(event: MouseEvent): void {
    if (this.isEditableKeyTarget(event.target)) return;
    this.focusFlowHost();
  }

  onPortMouseDown(event: MouseEvent, nodeId: string, port: FlowEdge['fromPort']): void {
    event.stopPropagation();
    this.focusFlowHost();
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
    try {
      const ctm = svg.getScreenCTM();
      if (ctm) {
        const t = p.matrixTransform(ctm.inverse());
        if (Number.isFinite(t.x) && Number.isFinite(t.y)) {
          return { x: t.x, y: t.y };
        }
      }
    } catch {
      /* singular matrix or unsupported */
    }
    return this.clientPointToSvgUser(svg, event.clientX, event.clientY);
  }

  /** Map screen coordinates into the same user space as `[attr.viewBox]` / `edgePath`. */
  private clientPointToSvgUser(svg: SVGSVGElement, clientX: number, clientY: number): { x: number; y: number } {
    const rect = svg.getBoundingClientRect();
    const vb = svg.viewBox?.baseVal;
    if (!vb || rect.width <= 0 || rect.height <= 0) {
      return { x: 0, y: 0 };
    }
    const relX = (clientX - rect.left) / rect.width;
    const relY = (clientY - rect.top) / rect.height;
    return {
      x: vb.x + relX * vb.width,
      y: vb.y + relY * vb.height,
    };
  }

  /** Keep `translate` in the same numeric space as `edgePath` / `draftPath`. */
  nodeTransform(n: FlowNode): string {
    return `translate(${toNodeCoord(n.x)},${toNodeCoord(n.y)})`;
  }

  private hitTestNode(pt: { x: number; y: number }): FlowNode | null {
    if (!this.artifact) return null;
    for (const n of this.artifact.nodes) {
      const nx = toNodeCoord(n.x);
      const ny = toNodeCoord(n.y);
      if (pt.x >= nx && pt.x <= nx + NODE_W && pt.y >= ny && pt.y <= ny + NODE_H) return n;
    }
    return null;
  }

  edgePath(edge: FlowEdge): string {
    if (!this.artifact) return '';
    const from = this.artifact.nodes.find((n) => n.id === edge.fromNodeId);
    const to = this.artifact.nodes.find((n) => n.id === edge.toNodeId);
    if (!from || !to) return '';
    const offset = portOffset(from, edge.fromPort);
    const x1 = toNodeCoord(from.x) + NODE_W;
    const y1 = toNodeCoord(from.y) + offset;
    const x2 = toNodeCoord(to.x);
    const y2 = toNodeCoord(to.y) + NODE_H / 2;
    const midX = (x1 + x2) / 2;
    if (![x1, y1, x2, y2, midX].every(Number.isFinite)) {
      return '';
    }
    return `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`;
  }

  draftPath(): string {
    if (!this.artifact || !this.edgeDraft) return '';
    const from = this.artifact.nodes.find((n) => n.id === this.edgeDraft!.fromNodeId);
    if (!from) return '';
    const offset = portOffset(from, this.edgeDraft.fromPort);
    const x1 = toNodeCoord(from.x) + NODE_W;
    const y1 = toNodeCoord(from.y) + offset;
    const x2 = this.edgeDraft.x;
    const y2 = this.edgeDraft.y;
    const midX = (x1 + x2) / 2;
    if (![x1, y1, x2, y2, midX].every(Number.isFinite)) {
      return '';
    }
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

  /**
   * Animate the wire *into* the step that is working (or from Start on the first step).
   * Outgoing-only highlighting hid the “power cord” to the request node.
   */
  isEdgeRunAnimated(e: FlowEdge): boolean {
    if (!this.running) return false;
    if (this.nodeStatus.get(e.toNodeId) === 'running') return true;
    if (e.fromNodeId === 'start' && this.nodeStatus.get('start') === 'running') return true;
    return false;
  }

  /** Built in TS so the template can use a dynamic `port-*` class (parser disallows computed keys in literals). */
  edgePathNgClass(e: FlowEdge): Record<string, boolean> {
    return {
      edge: true,
      [`port-${e.fromPort}`]: true,
      'edge-flowing': this.isEdgeRunAnimated(e),
    };
  }

  nodeLabel(node: FlowNode): string {
    const raw = node.label
      ? node.label
      : PALETTE.find((p) => p.kind === node.kind)?.label || node.kind;
    return truncate(raw, NODE_LABEL_MAX_CHARS);
  }

  nodeSubtitle(node: FlowNode): string {
    switch (node.kind) {
      case 'request':
        if (node.target.kind === 'inline') {
          return truncate(`${node.target.method} ${node.target.url}`, NODE_SUB_MAX_CHARS);
        }
        {
          const req = this.collections.findRequestById(node.target.requestId);
          return req
            ? truncate(`${HTTP_METHOD_LABELS[req.httpMethod] || 'GET'} ${req.title || req.url}`, NODE_SUB_MAX_CHARS)
            : '(no request)';
        }
      case 'branch':
        return truncate(node.expression || 'true', NODE_SUB_MAX_CHARS);
      case 'assert':
        return truncate(node.expression || '', NODE_SUB_MAX_CHARS);
      case 'set-var':
        return truncate(`${node.varName || 'var'} = …`, NODE_SUB_MAX_CHARS);
      case 'delay':
        return truncate(`${node.ms} ms`, NODE_SUB_MAX_CHARS);
      case 'terminate':
        return truncate(node.outcome, NODE_SUB_MAX_CHARS);
      case 'transform':
        return 'return output';
      case 'start':
        return '';
    }
  }

  onTitleChange(): void { this.persist(); }

  private focusFlowHost(): void {
    this.hostRef.nativeElement?.focus({ preventScroll: true });
  }

  private isEditableKeyTarget(target: EventTarget | null): boolean {
    if (!target || !(target instanceof Node)) return false;
    return !!(target as Element).closest?.('input, textarea, select, [contenteditable="true"]');
  }

  /** Hotkeys work when the flow host or any non-editable child has focus. */
  private isFlowHotkeyContext(): boolean {
    const h = this.hostRef.nativeElement;
    const ae = document.activeElement;
    if (!ae) return false;
    return h === ae || h.contains(ae);
  }

  /**
   * Copy the selected node and every node reachable from it by following outgoing
   * edges. The start node is never copied; if you select Start, this copies the
   * downstream graph without the Start node (reconnect the first pasted nodes manually).
   */
  private buildDownstreamCopyFragment(rootId: string): { nodes: FlowNode[]; edges: FlowEdge[] } | null {
    if (!this.artifact) return null;
    const ids = new Set<string>([rootId]);
    const q: string[] = [rootId];
    while (q.length) {
      const id = q.shift()!;
      for (const e of this.artifact.edges) {
        if (e.fromNodeId === id && !ids.has(e.toNodeId)) {
          ids.add(e.toNodeId);
          q.push(e.toNodeId);
        }
      }
    }
    ids.delete('start');
    if (ids.size === 0) return null;
    const nodes: FlowNode[] = [];
    for (const n of this.artifact.nodes) {
      if (!ids.has(n.id) || n.kind === 'start') continue;
      nodes.push(JSON.parse(JSON.stringify(n)) as FlowNode);
    }
    if (nodes.length === 0) return null;
    const idSet = new Set(nodes.map((n) => n.id));
    const edges: FlowEdge[] = this.artifact.edges
      .filter((e) => idSet.has(e.fromNodeId) && idSet.has(e.toNodeId))
      .map((e) => JSON.parse(JSON.stringify(e)) as FlowEdge);
    return { nodes, edges };
  }

  private copySelectionToClipboard(): void {
    if (!this.artifact || !this.selectedNodeId) return;
    const fragment = this.buildDownstreamCopyFragment(this.selectedNodeId);
    if (!fragment) return;
    const payload = { v: 1 as const, kind: FLOW_CLIPBOARD_KIND, ...fragment };
    void navigator.clipboard.writeText(JSON.stringify(payload));
  }

  private async pasteFromClipboard(): Promise<void> {
    if (!this.artifact) return;
    let text: string;
    try {
      text = await navigator.clipboard.readText();
    } catch {
      return;
    }
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      return;
    }
    if (!isFlowClipboardPayload(data)) return;
    const idMap = new Map<string, string>();
    const newNodes: FlowNode[] = [];
    for (const n of data.nodes) {
      if (n.kind === 'start') continue;
      const newId = uuidv4();
      idMap.set(n.id, newId);
      const clone = JSON.parse(JSON.stringify(n)) as FlowNode;
      clone.id = newId;
      clone.x = toNodeCoord(n.x) + PASTE_OFFSET_X;
      clone.y = toNodeCoord(n.y) + PASTE_OFFSET_Y;
      newNodes.push(clone);
    }
    if (newNodes.length === 0) return;
    const newEdges: FlowEdge[] = [];
    for (const e of data.edges) {
      const from = idMap.get(e.fromNodeId);
      const to = idMap.get(e.toNodeId);
      if (!from || !to) continue;
      newEdges.push({ ...e, id: uuidv4(), fromNodeId: from, toNodeId: to });
    }
    this.artifact.nodes = [...this.artifact.nodes, ...newNodes];
    this.artifact.edges = [...this.artifact.edges, ...newEdges];
    this.selectedNodeId = newNodes[newNodes.length - 1]!.id;
    this.cdr.markForCheck();
    this.persist();
  }

  trackByNode = (_: number, n: FlowNode) => n.id;
  trackByEdge = (_: number, e: FlowEdge) => e.id;

  private persist(): void {
    if (!this.artifact) return;
    void this.artifacts.update('flows', {
      ...this.artifact,
      updatedAt: Date.now(),
      viewport: { x: this.viewport.x, y: this.viewport.y, zoom: this.zoom },
    });
  }

  private viewportPersistTimeout?: ReturnType<typeof setTimeout>;
  private persistViewport(): void {
    if (this.viewportPersistTimeout) clearTimeout(this.viewportPersistTimeout);
    this.viewportPersistTimeout = setTimeout(() => this.persist(), 1000);
  }
}

/**
 * If node positions come from storage as strings, `+` in edge math was doing string
 * concatenation (e.g. "80" + 180 -> "80180") while `translate(n.x, n.y)` still
 * cast to numbers — edges detached from the nodes until coords were re-saved.
 */
function toNodeCoord(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function normalizeFlowArtifactCoords(a: FlowArtifact | null | undefined): void {
  if (!a?.nodes?.length) return;
  for (const n of a.nodes) {
    n.x = toNodeCoord(n.x);
    n.y = toNodeCoord(n.y);
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

function isFlowClipboardPayload(
  d: unknown,
): d is { v: 1; kind: typeof FLOW_CLIPBOARD_KIND; nodes: FlowNode[]; edges: FlowEdge[] } {
  if (!d || typeof d !== 'object') return false;
  const o = d as Record<string, unknown>;
  return (
    o['v'] === 1 &&
    o['kind'] === FLOW_CLIPBOARD_KIND &&
    Array.isArray(o['nodes']) &&
    Array.isArray(o['edges'])
  );
}
