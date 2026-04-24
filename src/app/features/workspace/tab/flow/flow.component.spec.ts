import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BehaviorSubject, Subject, of } from 'rxjs';
import { FlowComponent } from './flow.component';
import { TestArtifactService } from '@core/testing/test-artifact.service';
import { FlowExecutorService } from '@core/testing/flow-executor.service';
import { CollectionService } from '@core/collection/collection.service';
import { EnvironmentsService } from '@core/environments/environments.service';
import type { TabItem } from '@core/tabs/tab.service';
import { TabType } from '@core/tabs/tab.service';
import { NEW_FLOW } from '@models/testing/flow';
import type { FlowArtifact, FlowNodeRunResult, FlowRunResult, RequestNode } from '@models/testing/flow';

describe('FlowComponent', () => {
  let fixture: ComponentFixture<FlowComponent>;
  let component: FlowComponent;

  let flows$: BehaviorSubject<FlowArtifact[]>;
  let step$: Subject<{ flowId: string; step: FlowNodeRunResult }>;
  let done$: Subject<FlowRunResult>;

  let artifactsSpy: jasmine.SpyObj<TestArtifactService>;
  let execSpy: jasmine.SpyObj<FlowExecutorService>;
  let collectionsSpy: jasmine.SpyObj<CollectionService>;
  let envSpy: jasmine.SpyObj<EnvironmentsService>;

  const id = 'fl-1';
  const tab: TabItem = { id: `fl:${id}`, title: 'Flow', type: TabType.FLOW };

  beforeEach(async () => {
    const seed = NEW_FLOW(id);
    seed.title = 'My Flow';
    flows$ = new BehaviorSubject([seed]);
    step$ = new Subject();
    done$ = new Subject();

    artifactsSpy = jasmine.createSpyObj('TestArtifactService', ['flows$', 'flows', 'update']);
    artifactsSpy.flows$.and.returnValue(flows$);
    artifactsSpy.flows.and.callFake(() => flows$.value);
    artifactsSpy.update.and.resolveTo();

    execSpy = jasmine.createSpyObj('FlowExecutorService', ['onStep', 'onDone', 'run', 'cancel']);
    execSpy.onStep.and.returnValue(step$.asObservable());
    execSpy.onDone.and.returnValue(done$.asObservable());
    execSpy.run.and.resolveTo();

    collectionsSpy = jasmine.createSpyObj('CollectionService',
      ['getCollectionsObservable', 'getCollections', 'findRequestById']);
    collectionsSpy.getCollectionsObservable.and.returnValue(of([]));
    collectionsSpy.getCollections.and.returnValue([]);

    envSpy = jasmine.createSpyObj('EnvironmentsService', ['loadEnvironments', 'getEnvironmentsObservable']);
    envSpy.loadEnvironments.and.resolveTo();
    envSpy.getEnvironmentsObservable.and.returnValue(of([]));

    await TestBed.configureTestingModule({
      imports: [FlowComponent],
      providers: [
        { provide: TestArtifactService, useValue: artifactsSpy },
        { provide: FlowExecutorService, useValue: execSpy },
        { provide: CollectionService,   useValue: collectionsSpy },
        { provide: EnvironmentsService, useValue: envSpy },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(FlowComponent);
    component = fixture.componentInstance;
    component.tab = tab;
    fixture.detectChanges();
  });

  it('hydrates the flow artifact with an initial Start node', () => {
    expect(component.artifact?.id).toBe(id);
    expect(component.artifact!.nodes.length).toBe(1);
    expect(component.artifact!.nodes[0].id).toBe('start');
  });

  it('reloads the canvas when the tab input switches to another flow', () => {
    const idB = 'flow-bbb';
    const flowB = NEW_FLOW(idB);
    flowB.title = 'Other';
    flows$.next([flows$.value[0]!, flowB]);
    fixture.componentRef.setInput('tab', { id: `fl:${idB}`, title: 'Other', type: TabType.FLOW });
    fixture.detectChanges();
    expect(component.artifact?.id).toBe(idB);
    expect(component.artifact?.title).toBe('Other');
  });

  it('preserves node selection when the same flow is re-synced from the store', () => {
    component.addNode('request');
    const nodeId = component.selectedNodeId!;
    const synced = JSON.parse(JSON.stringify(component.artifact!)) as FlowArtifact;
    synced.title = 'Renamed in store';
    flows$.next([synced]);
    fixture.detectChanges();
    expect(component.artifact?.title).toBe('Renamed in store');
    expect(component.selectedNodeId).toBe(nodeId);
  });

  it('preserves last run result when the same flow is re-synced from the store', () => {
    const fake: FlowRunResult = {
      runId: 'run-1',
      flowId: id,
      startedAt: 1,
      endedAt: 2,
      outcome: 'success',
      variables: {},
      steps: [{ nodeId: 'start', status: 'success', startedAt: 1, durationMs: 5 }],
    };
    component.runResult = fake;
    const synced = JSON.parse(JSON.stringify(component.artifact!)) as FlowArtifact;
    synced.title = 'After run';
    flows$.next([synced]);
    fixture.detectChanges();
    expect(component.runResult).toBe(fake);
    expect(component.nodeStatus.get('start')).toBe('success');
  });

  it('addNode appends a node of the requested kind and selects it', () => {
    component.addNode('request');
    expect(component.artifact!.nodes.length).toBe(2);
    const added = component.artifact!.nodes[1];
    expect(added.kind).toBe('request');
    expect(component.selectedNodeId).toBe(added.id);
  });

  it('addNode can add every palette kind without throwing', () => {
    const kinds = component.palette.map((p) => p.kind);
    for (const k of kinds) component.addNode(k);
    expect(component.artifact!.nodes.length).toBe(kinds.length + 1);
  });

  it('removeNode deletes nodes and any attached edges', () => {
    component.addNode('request');
    const reqId = component.selectedNodeId!;
    component.artifact!.edges.push({ id: 'e1', fromNodeId: 'start', fromPort: 'next' as any, toNodeId: reqId });
    component.removeNode(reqId);
    expect(component.artifact!.nodes.find((n) => n.id === reqId)).toBeUndefined();
    expect(component.artifact!.edges.length).toBe(0);
    expect(component.selectedNodeId).toBeNull();
  });

  it('removeNode refuses to remove the Start node', () => {
    component.removeNode('start');
    expect(component.artifact!.nodes.some((n) => n.id === 'start')).toBeTrue();
  });

  it('onCanvasClick clears the selection when target is not inside a node', () => {
    component.addNode('assert');
    expect(component.selectedNodeId).not.toBeNull();
    const ev = new MouseEvent('click');
    Object.defineProperty(ev, 'target', { value: document.createElement('div') });
    component.onCanvasClick(ev);
    expect(component.selectedNodeId).toBeNull();
  });

  it('onCanvasClick does not clear when click target is inside a node', () => {
    component.addNode('assert');
    const id = component.selectedNodeId!;
    const nodeG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    nodeG.setAttribute('class', 'node');
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    nodeG.appendChild(rect);
    const ev = new MouseEvent('click');
    Object.defineProperty(ev, 'target', { value: rect });
    component.onCanvasClick(ev);
    expect(component.selectedNodeId).toBe(id);
  });

  it('selectedNode returns the node matching selectedNodeId', () => {
    component.addNode('request');
    const id = component.selectedNodeId!;
    expect(component.selectedNode!.id).toBe(id);
  });

  it('setRequestTargetKind swaps between saved/inline defaults', () => {
    component.addNode('request');
    const node = component.selectedNode as RequestNode;
    component.setRequestTargetKind(node, 'saved');
    expect(node.target).toEqual({ kind: 'saved', requestId: '' });
    component.setRequestTargetKind(node, 'inline');
    expect(node.target).toEqual({ kind: 'inline', method: 'GET', url: '' });
  });

  it('runFlow delegates to the executor and flips the running flag', async () => {
    await component.runFlow();
    expect(execSpy.run).toHaveBeenCalledWith(component.artifact!, undefined);
    expect(component.running).toBeFalse();
  });

  it('cancelFlow proxies to the executor with the artifact id', () => {
    component.cancelFlow();
    expect(execSpy.cancel).toHaveBeenCalledWith(id);
  });

  it('step events update per-node status and message maps', () => {
    step$.next({ flowId: id, step: { nodeId: 'start', status: 'running' } as any });
    step$.next({ flowId: id, step: { nodeId: 'start', status: 'success', message: 'ok' } as any });
    expect(component.nodeStatus.get('start')).toBe('success');
    expect(component.nodeMessages.get('start')).toBe('ok');
    expect(component.nodeStatusClass('start')).toBe('status-success');
  });

  it('step events for a different flow are ignored', () => {
    step$.next({ flowId: 'other', step: { nodeId: 'start', status: 'failed' } as any });
    expect(component.nodeStatus.has('start')).toBeFalse();
  });

  it('done event stores the result and clears the running flag', () => {
    component.running = true;
    done$.next({ flowId: id, outcome: 'success', steps: [] } as any);
    expect(component.running).toBeFalse();
    expect(component.runResult?.outcome).toBe('success');
  });

  it('resetView frames all nodes with padding when nodes exist', () => {
    component.addNode('request');
    component.artifact!.nodes[1].x = 500;
    component.artifact!.nodes[1].y = 400;
    component.resetView();
    expect(component.viewport.w).toBeGreaterThan(0);
    expect(component.viewport.x).toBeLessThanOrEqual(80);
  });

  it('resetView falls back to the default viewport when there are no nodes', () => {
    component.artifact!.nodes = [];
    component.resetView();
    expect(component.viewport).toEqual({ x: 0, y: 0, w: 2000, h: 1500 });
  });

  it('viewBox getter formats the viewport as an SVG attribute string', () => {
    component.viewport = { x: 10, y: 20, w: 1000, h: 500 };
    expect(component.viewBox).toBe('10 20 1000 500');
  });

  it('zoomPercent reflects the zoom scale', () => {
    component.zoom = 1;
    expect(component.zoomPercent).toBe(100);
    component.zoom = 2;
    expect(component.zoomPercent).toBe(200);
  });

  it('nodeLabel prefers the node label; falls back to palette label', () => {
    component.addNode('delay');
    const n = component.selectedNode!;
    expect(component.nodeLabel(n)).toBe(n.label || 'Delay');
    (n as any).label = '';
    expect(component.nodeLabel(n)).toBe('Delay');
  });

  it('nodeSubtitle renders kind-specific summary text', () => {
    component.addNode('delay');
    const delayNode = component.selectedNode as any;
    delayNode.ms = 1500;
    expect(component.nodeSubtitle(delayNode)).toBe('1500 ms');

    component.addNode('request');
    const reqNode = component.selectedNode as any;
    reqNode.target = { kind: 'inline', method: 'POST', url: 'https://example.com/thing' };
    expect(component.nodeSubtitle(reqNode)).toContain('POST');
  });

  it('nodeColor falls back to grey for unknown kinds', () => {
    expect(component.nodeColor({ kind: 'start' } as any)).toBe('#16a34a');
    expect(component.nodeColor({ kind: 'request' } as any)).toBe('#2563eb');
  });

  it('edgePath returns "" when endpoints are missing', () => {
    expect(component.edgePath({ id: 'x', fromNodeId: 'a', fromPort: 'next', toNodeId: 'b' } as any)).toBe('');
  });

  it('edgePath treats string coordinates as numbers (avoids "80"+180 string concat)', () => {
    component.artifact = {
      id: 'f1',
      title: 't',
      updatedAt: 0,
      description: '',
      nodes: [
        { id: 'start', kind: 'start', label: 'Start', x: 80 as any, y: 80 as any },
        { id: 'r1', kind: 'request', label: 'R', x: 320, y: 80, target: { kind: 'inline', method: 'GET', url: '/' } },
      ],
      edges: [{ id: 'e1', fromNodeId: 'start', fromPort: 'out', toNodeId: 'r1' }],
      viewport: { x: 0, y: 0, zoom: 1 },
    } as unknown as FlowArtifact;
    (component.artifact.nodes[0] as { x: unknown; y: unknown }).x = '80';
    (component.artifact.nodes[0] as { x: unknown; y: unknown }).y = '80';
    expect(component.edgePath({ id: 'e1', fromNodeId: 'start', fromPort: 'out', toNodeId: 'r1' })).toBe(
      'M 260 110 C 290 110, 290 110, 320 110',
    );
  });
});
