import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BehaviorSubject, Subject, of } from 'rxjs';
import { LoadTestComponent } from './load-test.component';
import { TestArtifactService } from '@core/test-artifact.service';
import { LoadTestService } from '@core/load-test.service';
import { CollectionService } from '@core/collection.service';
import type { TabItem } from '@core/tab.service';
import { TabType } from '@core/tab.service';
import { DEFAULT_LOAD_CONFIG } from '@models/testing/load-test';
import type { LoadTestArtifact, LoadProgressEvent, LoadRunResult } from '@models/testing/load-test';

describe('LoadTestComponent', () => {
  let fixture: ComponentFixture<LoadTestComponent>;
  let component: LoadTestComponent;

  let tests$: BehaviorSubject<LoadTestArtifact[]>;
  let progress$: Subject<LoadProgressEvent>;
  let done$: Subject<LoadRunResult>;

  let artifactsSpy: jasmine.SpyObj<TestArtifactService>;
  let loadSpy: jasmine.SpyObj<LoadTestService>;
  let collectionsSpy: jasmine.SpyObj<CollectionService>;

  const id = 'lt-1';
  const tab: TabItem = { id: `lt:${id}`, title: 'Load', type: TabType.LOAD_TEST };

  beforeEach(async () => {
    const seed: LoadTestArtifact = {
      id, title: 'My Load', updatedAt: 0,
      config: { ...DEFAULT_LOAD_CONFIG, targets: [] },
    };
    tests$ = new BehaviorSubject([seed]);
    progress$ = new Subject();
    done$ = new Subject();

    artifactsSpy = jasmine.createSpyObj('TestArtifactService', ['loadTests$', 'update']);
    artifactsSpy.loadTests$.and.returnValue(tests$);
    artifactsSpy.update.and.resolveTo();

    loadSpy = jasmine.createSpyObj('LoadTestService', ['onProgress', 'onDone', 'start', 'cancel']);
    loadSpy.onProgress.and.returnValue(progress$.asObservable());
    loadSpy.onDone.and.returnValue(done$.asObservable());
    loadSpy.start.and.resolveTo('run-1');
    loadSpy.cancel.and.resolveTo();

    collectionsSpy = jasmine.createSpyObj('CollectionService',
      ['getCollectionsObservable', 'getCollections', 'findRequestById']);
    collectionsSpy.getCollectionsObservable.and.returnValue(of([]));
    collectionsSpy.getCollections.and.returnValue([]);

    await TestBed.configureTestingModule({
      imports: [LoadTestComponent],
      providers: [
        { provide: TestArtifactService, useValue: artifactsSpy },
        { provide: LoadTestService,     useValue: loadSpy },
        { provide: CollectionService,   useValue: collectionsSpy },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(LoadTestComponent);
    component = fixture.componentInstance;
    component.tab = tab;
    fixture.detectChanges();
  });

  it('hydrates the active load test from the stream', () => {
    expect(component.artifact?.id).toBe(id);
    expect(component.artifact?.title).toBe('My Load');
  });

  it('stopMode getter reflects the active config', () => {
    expect(component.stopMode).toBe('duration');
    component.artifact!.config.durationSec = null;
    component.artifact!.config.iterations = 100;
    expect(component.stopMode).toBe('iterations');
  });

  it('setStopMode flips config fields and persists', () => {
    component.setStopMode('iterations');
    expect(component.artifact!.config.durationSec).toBeNull();
    expect(component.artifact!.config.iterations).toBe(100);
    component.setStopMode('duration');
    expect(component.artifact!.config.iterations).toBeNull();
    expect(component.artifact!.config.durationSec).toBe(30);
  });

  it('addSavedTarget appends a saved target to config', () => {
    component.addSavedTarget('req-1');
    expect(component.artifact!.config.targets.length).toBe(1);
    expect(component.artifact!.config.targets[0]).toEqual(jasmine.objectContaining({ kind: 'saved', requestId: 'req-1' }));
  });

  it('addSavedTarget is a no-op on empty input', () => {
    component.addSavedTarget('');
    expect(component.artifact!.config.targets.length).toBe(0);
  });

  it('addInlineTarget requires a URL', () => {
    component.inlineDraft = { method: 'GET', url: '   ', body: '' };
    component.addInlineTarget();
    expect(component.artifact!.config.targets.length).toBe(0);
  });

  it('addInlineTarget pushes inline target and resets the draft', () => {
    component.showInlineEditor = true;
    component.inlineDraft = { method: 'POST', url: 'https://x', body: '{"a":1}' };
    component.addInlineTarget();
    expect(component.artifact!.config.targets.length).toBe(1);
    expect(component.inlineDraft).toEqual({ method: 'GET', url: '', body: '' });
    expect(component.showInlineEditor).toBeFalse();
  });

  it('removeTarget splices by index', () => {
    component.addSavedTarget('a');
    component.addSavedTarget('b');
    component.removeTarget(0);
    expect(component.artifact!.config.targets.length).toBe(1);
    expect((component.artifact!.config.targets[0] as any).requestId).toBe('b');
  });

  it('onRpsCapChange coerces empty string to null, numbers otherwise', () => {
    component.onRpsCapChange(component.artifact!, '');
    expect(component.artifact!.config.rpsCap).toBeNull();
    component.onRpsCapChange(component.artifact!, 50);
    expect(component.artifact!.config.rpsCap).toBe(50);
  });

  it('start() aborts when there are no targets (and alerts)', async () => {
    const alertSpy = spyOn(window, 'alert');
    await component.start();
    expect(alertSpy).toHaveBeenCalled();
    expect(loadSpy.start).not.toHaveBeenCalled();
  });

  it('start() forwards the config and sets running=true on success', async () => {
    component.addSavedTarget('req-1');
    await component.start();
    expect(loadSpy.start).toHaveBeenCalledWith(component.artifact!.config);
    expect(component.running).toBeTrue();
    expect(component.runId).toBe('run-1');
  });

  it('cancel() marks cancelling and calls the service', async () => {
    component.runId = 'run-1';
    component.running = true;
    await component.cancel();
    expect(component.cancelling).toBeTrue();
    expect(loadSpy.cancel).toHaveBeenCalledWith('run-1');
  });

  it('cancel() is a no-op when not running', async () => {
    component.runId = null;
    component.running = false;
    await component.cancel();
    expect(loadSpy.cancel).not.toHaveBeenCalled();
  });

  it('appends progress points only when the runId matches the active run', () => {
    component.runId = 'run-1';
    const event: LoadProgressEvent = {
      runId: 'run-1', status: 'running', startedAt: 0, activeVus: 5,
      summary: { total: 1, successful: 1, failed: 0, statusBuckets: {}, p50: 10, p90: 20, p95: 20, p99: 30, meanMs: 10, rps: 1, elapsedSec: 1 },
      point: { t: 1000, rps: 5, errors: 0, p50: 10, p95: 20 },
    };
    progress$.next(event);
    expect(component.chartXs.length).toBe(1);
    expect(component.rpsSeries.values).toEqual([5]);

    progress$.next({ ...event, runId: 'other' });
    expect(component.chartXs.length).toBe(1);
  });

  it('done event sets result, clears the running flag, and populates chart series', () => {
    component.runId = 'run-1';
    component.running = true;
    const result: LoadRunResult = {
      runId: 'run-1', status: 'finished', startedAt: 0, endedAt: 1000,
      config: component.artifact!.config,
      summary: { total: 1, successful: 1, failed: 0, statusBuckets: {}, p50: 1, p90: 1, p95: 1, p99: 1, meanMs: 1, rps: 1, elapsedSec: 1 },
      series: [
        { t: 100, rps: 1, errors: 0, p50: 1, p95: 1 },
        { t: 200, rps: 2, errors: 0, p50: 2, p95: 3 },
      ],
      slowest: [], errors: [], errorMessage: undefined,
    } as any;
    done$.next(result);
    expect(component.result).toBe(result);
    expect(component.running).toBeFalse();
    expect(component.chartXs).toEqual([100, 200]);
    expect(component.rpsSeries.values).toEqual([1, 2]);
  });

  it('bucketTone maps status codes to semantic tones', () => {
    expect(component.bucketTone('error')).toBe('error');
    expect(component.bucketTone('201')).toBe('success');
    expect(component.bucketTone('302')).toBe('default');
    expect(component.bucketTone('404')).toBe('warn');
    expect(component.bucketTone('500')).toBe('error');
    expect(component.bucketTone('xxx')).toBe('default');
  });

  it('formatDuration renders ms under 1s and seconds above', () => {
    expect(component.formatDuration(null)).toBe('0 ms');
    expect(component.formatDuration(500)).toBe('500 ms');
    expect(component.formatDuration(1500)).toBe('1.50 s');
  });

  it('bucketPct divides by the total across all buckets', () => {
    component.progress = {
      runId: 'run-1', status: 'running', startedAt: 0, activeVus: 0,
      summary: { total: 4, successful: 3, failed: 1, statusBuckets: { '200': 3, '500': 1 }, p50: 0, p90: 0, p95: 0, p99: 0, meanMs: 0, rps: 0, elapsedSec: 0 },
      point: { t: 0, rps: 0, errors: 0, p50: 0, p95: 0 },
    } as any;
    expect(component.bucketPct('200', 3)).toBe(75);
    expect(component.bucketPct('500', 1)).toBe(25);
  });

  it('targetLabel resolves inline vs saved labels', () => {
    collectionsSpy.findRequestById.and.returnValue({
      id: 'r1', title: 'R1', url: 'https://x', httpMethod: 0,
    } as any);
    expect(component.targetLabel({ kind: 'inline', method: 'POST', url: 'https://x' } as any))
      .toBe('POST https://x');
    expect(component.targetLabel({ kind: 'saved', requestId: 'r1' } as any))
      .toContain('R1');
  });
});
