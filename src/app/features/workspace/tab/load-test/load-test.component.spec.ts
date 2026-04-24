import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BehaviorSubject, Subject, of } from 'rxjs';
import { LoadTestComponent } from './load-test.component';
import { TestArtifactService } from '@core/testing/test-artifact.service';
import { LoadTestService } from '@core/testing/load-test.service';
import { CollectionService } from '@core/collection/collection.service';
import { ConfirmDialogService } from '@core/ui/confirm-dialog.service';
import { SessionService } from '@core/session/session.service';
import { EnvironmentsService } from '@core/environments/environments.service';
import type { TabItem } from '@core/tabs/tab.service';
import { TabType } from '@core/tabs/tab.service';
import {
  DEFAULT_LOAD_CONFIG,
  LOAD_TEST_PROFILE_PICKER_TEMPLATE_PREFIX,
  LOAD_TEST_PROFILE_TEMPLATES,
  ensureLoadTestProfiles,
  loadTestTemplateProfileName,
} from '@models/testing/load-test';
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
  let sessionSpy: jasmine.SpyObj<SessionService>;
  let envSpy: jasmine.SpyObj<EnvironmentsService>;
  let confirmDialogSpy: jasmine.SpyObj<ConfirmDialogService>;

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

    sessionSpy = jasmine.createSpyObj('SessionService', ['load', 'get', 'save']);
    sessionSpy.load.and.resolveTo();
    sessionSpy.get.and.returnValue(null);
    sessionSpy.save.and.resolveTo();

    envSpy = jasmine.createSpyObj('EnvironmentsService', ['loadEnvironments', 'getEnvironmentsObservable']);
    envSpy.loadEnvironments.and.resolveTo();
    envSpy.getEnvironmentsObservable.and.returnValue(of([]));

    confirmDialogSpy = jasmine.createSpyObj('ConfirmDialogService', ['confirm', 'alert']);
    confirmDialogSpy.confirm.and.resolveTo(true);
    confirmDialogSpy.alert.and.resolveTo();

    await TestBed.configureTestingModule({
      imports: [LoadTestComponent],
      providers: [
        { provide: TestArtifactService, useValue: artifactsSpy },
        { provide: LoadTestService,     useValue: loadSpy },
        { provide: CollectionService,   useValue: collectionsSpy },
        { provide: SessionService,      useValue: sessionSpy },
        { provide: EnvironmentsService, useValue: envSpy },
        { provide: ConfirmDialogService, useValue: confirmDialogSpy },
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

  it('trims multiple legacy targets to the first on load', () => {
    const multi: LoadTestArtifact = {
      id,
      title: 'T',
      updatedAt: 0,
      config: {
        ...DEFAULT_LOAD_CONFIG,
        targets: [
          { kind: 'saved', requestId: 'a' },
          { kind: 'saved', requestId: 'b' },
        ],
      },
    };
    tests$.next([ensureLoadTestProfiles(JSON.parse(JSON.stringify(multi)) as LoadTestArtifact)]);
    fixture.detectChanges();
    expect(component.artifact!.config.targets.length).toBe(1);
    expect((component.artifact!.config.targets[0] as { requestId: string }).requestId).toBe('a');
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

  it('picking the same catalog template twice does not add a second profile', () => {
    const a = component.artifact!;
    ensureLoadTestProfiles(a);
    const tpl = LOAD_TEST_PROFILE_TEMPLATES[0];
    const prefix = LOAD_TEST_PROFILE_PICKER_TEMPLATE_PREFIX;
    component.onProfileHeaderPick(a, `${prefix}${tpl.id}`);
    const n1 = a.profiles?.length ?? 0;
    expect(n1).toBeGreaterThan(0);
    expect(component.activeProfile(a)?.name).toBe(loadTestTemplateProfileName(tpl));
    component.onProfileHeaderPick(a, `${prefix}${tpl.id}`);
    expect(a.profiles?.length).toBe(n1);
  });

  it('headerProfileOptions omits catalog entry when that template is already a profile', () => {
    const a = component.artifact!;
    ensureLoadTestProfiles(a);
    const tpl = LOAD_TEST_PROFILE_TEMPLATES[0];
    const prefix = LOAD_TEST_PROFILE_PICKER_TEMPLATE_PREFIX;
    component.onProfileHeaderPick(a, `${prefix}${tpl.id}`);
    const opts = component.headerProfileOptions(a);
    expect(opts.some((o) => o.value === `${prefix}${tpl.id}`)).toBeFalse();
    expect(opts.some((o) => o.value === a.activeProfileId)).toBeTrue();
  });

  it('does not fork a new profile when load settings change on a preset; edits the active profile', () => {
    const tpl = LOAD_TEST_PROFILE_TEMPLATES[0];
    const cfg = tpl.factory();
    const withPreset: LoadTestArtifact = {
      id,
      title: 'My Load',
      updatedAt: 0,
      activeProfileId: 'p-preset',
      profiles: [
        {
          id: 'p-preset',
          name: tpl.name,
          description: 'preset',
          userCustom: false,
          isTemplate: true,
          config: cfg,
        },
      ],
      config: cfg,
    };
    tests$.next([ensureLoadTestProfiles(JSON.parse(JSON.stringify(withPreset)) as LoadTestArtifact)]);
    fixture.detectChanges();
    expect(component.artifact?.profiles?.length).toBe(1);
    expect(component.artifact?.activeProfileId).toBe('p-preset');
    component.setStopMode('iterations');
    expect(component.artifact?.profiles?.length).toBe(1);
    expect(component.artifact?.activeProfileId).toBe('p-preset');
    expect(component.activeProfile(component.artifact ?? null)?.name).toBe(tpl.name);
    expect(component.artifact!.config.iterations).toBe(100);
  });

  it('canRemoveActiveProfile is false for template rows', () => {
    const a = component.artifact!;
    a.profiles = [
      { id: 'p1', name: 'Smoke', userCustom: false, isTemplate: true, config: { ...DEFAULT_LOAD_CONFIG, targets: [] } },
      { id: 'p2', name: 'Custom', userCustom: true, config: { ...DEFAULT_LOAD_CONFIG, targets: [] } },
    ];
    a.activeProfileId = 'p1';
    expect(component.canRemoveActiveProfile(a)).toBeFalse();
    a.activeProfileId = 'p2';
    expect(component.canRemoveActiveProfile(a)).toBeTrue();
  });

  it('addProfileCloningCurrent appends a profile from the current config', () => {
    const a = component.artifact!;
    a.config.vus = 7;
    const before = a.profiles?.length ?? 0;
    component.newProfileFromCurrentName = '';
    component.addProfileCloningCurrent(a);
    expect(a.profiles?.length).toBe(before + 1);
    expect(component.activeProfile(a)?.name).toMatch(/^From current/);
    expect(a.config.vus).toBe(7);
  });

  it('addProfileCloningCurrent uses the draft name when set', () => {
    const a = component.artifact!;
    component.newProfileFromCurrentName = 'My copy';
    component.addProfileCloningCurrent(a);
    expect(component.activeProfile(a)?.name).toBe('My copy');
    expect(component.newProfileFromCurrentName).toBe('');
  });

  it('removeActiveProfile does not remove a template row', () => {
    const a = component.artifact!;
    const cfg = { ...DEFAULT_LOAD_CONFIG, targets: [] };
    a.profiles = [
      { id: 'p1', name: 'T', userCustom: false, isTemplate: true, config: cfg },
      { id: 'p2', name: 'U', userCustom: true, config: { ...cfg } },
    ];
    a.activeProfileId = 'p1';
    a.config = a.profiles[0].config;
    const before = a.profiles.length;
    component.removeActiveProfile(a);
    expect(a.profiles.length).toBe(before);
    expect(a.activeProfileId).toBe('p1');
  });

  it('addSavedTarget sets the only saved target; a second call replaces it', () => {
    const beforeProfiles = component.artifact!.profiles?.length ?? 0;
    component.addSavedTarget('req-1');
    expect(component.artifact!.profiles?.length).toBe(beforeProfiles);
    expect(component.artifact!.config.targets.length).toBe(1);
    expect(component.artifact!.config.targets[0]).toEqual(jasmine.objectContaining({ kind: 'saved', requestId: 'req-1' }));
    component.addSavedTarget('req-2');
    expect(component.artifact!.config.targets.length).toBe(1);
    expect(component.artifact!.config.targets[0]).toEqual(jasmine.objectContaining({ kind: 'saved', requestId: 'req-2' }));
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

  it('clearTarget removes the target', () => {
    component.addSavedTarget('a');
    component.clearTarget();
    expect(component.artifact!.config.targets.length).toBe(0);
  });

  it('onRpsCapChange coerces empty string to null, numbers otherwise', () => {
    component.onRpsCapChange(component.artifact!, '');
    expect(component.artifact!.config.rpsCap).toBeNull();
    component.onRpsCapChange(component.artifact!, 50);
    expect(component.artifact!.config.rpsCap).toBe(50);
  });

  it('start() aborts when there are no targets (and alerts)', async () => {
    await component.start();
    expect(confirmDialogSpy.alert).toHaveBeenCalled();
    expect(loadSpy.start).not.toHaveBeenCalled();
  });

  it('start() forwards the config and sets running=true on success', async () => {
    component.addSavedTarget('req-1');
    await component.start();
    expect(loadSpy.start).toHaveBeenCalledWith(component.artifact!.config, undefined);
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
      point: { t: 1000, rps: 5, errors: 0, p50: 10, p95: 20, p99: 30 },
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
        { t: 100, rps: 1, errors: 0, p50: 1, p95: 1, p99: 1 },
        { t: 200, rps: 2, errors: 0, p50: 2, p95: 3, p99: 4 },
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
      point: { t: 0, rps: 0, errors: 0, p50: 0, p95: 0, p99: 0 },
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
