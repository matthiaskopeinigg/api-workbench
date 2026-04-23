import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';
import { RunnerDialogComponent } from './runner-dialog.component';
import { RunnerService, RunnerState } from '@core/testing/runner.service';
import { Collection } from '@models/collection';

describe('RunnerDialogComponent', () => {
  let fixture: ComponentFixture<RunnerDialogComponent>;
  let component: RunnerDialogComponent;
  let state$: BehaviorSubject<RunnerState>;
  let runnerSpy: jasmine.SpyObj<RunnerService>;

  const idle: RunnerState = {
    isRunning: false, total: 0, completed: 0, results: [], startedAt: null, finishedAt: null,
  };

  const collection: Collection = {
    id: 'col-1',
    title: 'My Collection',
    order: 0,
    requests: [{ id: 'r1' } as any, { id: 'r2' } as any],
    folders: [],
  } as Collection;

  beforeEach(async () => {
    state$ = new BehaviorSubject<RunnerState>(idle);
    runnerSpy = jasmine.createSpyObj('RunnerService', ['state$', 'run', 'cancel', 'collectRequests']);
    runnerSpy.state$.and.returnValue(state$.asObservable());
    runnerSpy.collectRequests.and.returnValue(collection.requests! as any);
    runnerSpy.run.and.resolveTo(idle);

    await TestBed.configureTestingModule({
      imports: [RunnerDialogComponent],
      providers: [{ provide: RunnerService, useValue: runnerSpy }],
    }).compileComponents();

    fixture = TestBed.createComponent(RunnerDialogComponent);
    component = fixture.componentInstance;
    component.source = collection;
  });

  it('computes the request count from the source on init', () => {
    fixture.detectChanges();
    expect(component.requestCount).toBe(2);
  });

  it('re-computes requestCount when the source input changes', () => {
    fixture.detectChanges();
    const biggerCollection = { ...collection, requests: [1, 2, 3].map((id) => ({ id: `r${id}` } as any)) };
    runnerSpy.collectRequests.and.returnValue(biggerCollection.requests as any);
    component.source = biggerCollection as any;
    component.ngOnChanges({ source: { currentValue: biggerCollection, previousValue: collection, firstChange: false, isFirstChange: () => false } });
    expect(component.requestCount).toBe(3);
  });

  it('mirrors the RunnerService state stream', () => {
    fixture.detectChanges();
    const running: RunnerState = { ...idle, isRunning: true, total: 2, completed: 1 };
    state$.next(running);
    expect(component.state.isRunning).toBeTrue();
    expect(component.state.completed).toBe(1);
  });

  it('start() forwards the dialog inputs to runner.run()', async () => {
    fixture.detectChanges();
    component.iterations = 3;
    component.delayMs = 100;
    component.runTests = false;

    await component.start();
    expect(runnerSpy.run).toHaveBeenCalledWith(collection, { iterations: 3, delayMs: 100, runTests: false });
  });

  it('start() is a no-op while a run is already in flight', async () => {
    state$.next({ ...idle, isRunning: true });
    fixture.detectChanges();
    await component.start();
    expect(runnerSpy.run).not.toHaveBeenCalled();
  });

  it('cancel() proxies to the service', () => {
    fixture.detectChanges();
    component.cancel();
    expect(runnerSpy.cancel).toHaveBeenCalled();
  });

  it('progressPercent rounds completed/total ratio; returns 0 when total=0', () => {
    fixture.detectChanges();
    expect(component.progressPercent).toBe(0);
    state$.next({ ...idle, total: 3, completed: 1 });
    expect(component.progressPercent).toBe(33);
    state$.next({ ...idle, total: 4, completed: 4 });
    expect(component.progressPercent).toBe(100);
  });

  it('statusClass maps HTTP codes to tone classes', () => {
    expect(component.statusClass(0)).toBe('is-error');
    expect(component.statusClass(500)).toBe('is-error');
    expect(component.statusClass(404)).toBe('is-warning');
    expect(component.statusClass(201)).toBe('is-success');
    expect(component.statusClass(302)).toBe('');
  });

  it('testsSummary aggregates passed/failed/total across all results', () => {
    state$.next({
      ...idle,
      results: [
        { testResults: [{ passed: true }, { passed: false }] },
        { testResults: [{ passed: true }] },
        {}, // no testResults
      ] as any,
    });
    fixture.detectChanges();
    expect(component.testsSummary()).toEqual({ passed: 2, failed: 1, total: 3 });
  });

  it('requestSummary averages time and bucketises ok / failed', () => {
    state$.next({
      ...idle,
      results: [
        { status: 200, timeMs: 100 },
        { status: 500, timeMs: 200 },
      ] as any,
    });
    fixture.detectChanges();
    const summary = component.requestSummary();
    expect(summary).toEqual({ ok: 1, failed: 1, total: 2, avgMs: 150 });
  });

  it('formatDuration returns "" before the run starts and a human string while running', () => {
    expect(component.formatDuration()).toBe('');
    state$.next({ ...idle, isRunning: true, startedAt: Date.now() - 5500, finishedAt: null });
    fixture.detectChanges();
    expect(component.formatDuration()).toMatch(/s$/);
  });

  it('close() invokes the onClose callback when provided', () => {
    const spy = jasmine.createSpy('onClose');
    component.onClose = spy;
    component.close();
    expect(spy).toHaveBeenCalled();
  });

  it('Escape is swallowed while the runner is busy', () => {
    state$.next({ ...idle, isRunning: true });
    fixture.detectChanges();
    const onClose = jasmine.createSpy('onClose');
    component.onClose = onClose;
    component.onEscape();
    expect(onClose).not.toHaveBeenCalled();
  });
});
