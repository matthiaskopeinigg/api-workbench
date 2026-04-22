import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BehaviorSubject, Subject, of } from 'rxjs';
import { TestSuiteComponent } from './test-suite.component';
import { TestArtifactService } from '@core/test-artifact.service';
import { TestSuiteRunnerService } from '@core/test-suite-runner.service';
import { CollectionService } from '@core/collection.service';
import { EnvironmentsService } from '@core/environments.service';
import type { TabItem } from '@core/tab.service';
import { TabType } from '@core/tab.service';
import { NEW_TEST_SUITE } from '@models/testing/test-suite';
import type { TestSuiteArtifact, CaseRunResult, SuiteRunResult, SnapshotAssertion } from '@models/testing/test-suite';
import type { Folder } from '@models/collection';

describe('TestSuiteComponent', () => {
  let fixture: ComponentFixture<TestSuiteComponent>;
  let component: TestSuiteComponent;

  let suites$: BehaviorSubject<TestSuiteArtifact[]>;
  let snapshots$: BehaviorSubject<any[]>;
  let caseResult$: Subject<{ suiteId: string; caseResult: CaseRunResult }>;
  let finished$: Subject<SuiteRunResult>;

  let artifactsSpy: jasmine.SpyObj<TestArtifactService>;
  let runnerSpy: jasmine.SpyObj<TestSuiteRunnerService>;
  let collectionsSpy: jasmine.SpyObj<CollectionService>;
  let envSpy: jasmine.SpyObj<EnvironmentsService>;

  const suiteId = 'suite-1';
  const mockTab: TabItem = { id: `ts:${suiteId}`, title: 'Suite', type: TabType.TEST_SUITE };

  beforeEach(async () => {
    const seed = NEW_TEST_SUITE(suiteId);
    seed.title = 'My Suite';
    suites$ = new BehaviorSubject<TestSuiteArtifact[]>([seed]);
    snapshots$ = new BehaviorSubject<any[]>([]);
    caseResult$ = new Subject();
    finished$ = new Subject();

    artifactsSpy = jasmine.createSpyObj('TestArtifactService',
      ['testSuites$', 'testSuiteSnapshots', 'testSuiteSnapshots$', 'update', 'bulkReplace']);
    artifactsSpy.testSuites$.and.returnValue(suites$);
    artifactsSpy.testSuiteSnapshots$.and.returnValue(snapshots$);
    artifactsSpy.testSuiteSnapshots.and.callFake(() => snapshots$.value);
    artifactsSpy.update.and.resolveTo();
    artifactsSpy.bulkReplace.and.resolveTo();

    runnerSpy = jasmine.createSpyObj('TestSuiteRunnerService', ['onCaseResult', 'onFinished', 'run']);
    runnerSpy.onCaseResult.and.returnValue(caseResult$.asObservable());
    runnerSpy.onFinished.and.returnValue(finished$.asObservable());
    runnerSpy.run.and.resolveTo({} as any);

    collectionsSpy = jasmine.createSpyObj('CollectionService',
      ['getCollectionsObservable', 'getCollections', 'findRequestById', 'findFolderById', 'findCollectionByCollectionId']);
    collectionsSpy.getCollectionsObservable.and.returnValue(of([]));
    collectionsSpy.getCollections.and.returnValue([]);
    collectionsSpy.findRequestById.and.returnValue({
      id: 'req-1', title: 'Sample', url: 'https://x', httpMethod: 0,
    } as any);
    collectionsSpy.findFolderById.and.returnValue(null);
    collectionsSpy.findCollectionByCollectionId.and.callFake((id: string) => {
      const col = (collectionsSpy.getCollections() as any[] | undefined)?.find((c) => c.id === id);
      return col ?? null;
    });

    envSpy = jasmine.createSpyObj('EnvironmentsService', ['loadEnvironments', 'getEnvironmentsObservable']);
    envSpy.loadEnvironments.and.resolveTo();
    envSpy.getEnvironmentsObservable.and.returnValue(of([]));

    await TestBed.configureTestingModule({
      imports: [TestSuiteComponent],
      providers: [
        { provide: TestArtifactService,     useValue: artifactsSpy },
        { provide: TestSuiteRunnerService,  useValue: runnerSpy },
        { provide: CollectionService,       useValue: collectionsSpy },
        { provide: EnvironmentsService,     useValue: envSpy },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TestSuiteComponent);
    component = fixture.componentInstance;
    component.tab = mockTab;
    fixture.detectChanges();
  });

  it('hydrates the active suite from the stream, keyed by tab id', () => {
    expect(component.artifact?.id).toBe(suiteId);
    expect(component.artifact?.title).toBe('My Suite');
  });

  it('adds a saved case and selects it', () => {
    component.addSavedCase('req-1');
    expect(component.artifact!.cases.length).toBe(1);
    expect(component.selectedCaseId).toBe(component.artifact!.cases[0].id);
    expect(artifactsSpy.update).toHaveBeenCalledWith('testSuites', jasmine.any(Object));
  });

  it('addFromFolderList (entire collection) adds root and nested folder requests', () => {
    const col: any = {
      id: 'root',
      order: 0,
      title: 'Root',
      requests: [{ id: 'r0', title: 'root req', httpMethod: 0, url: 'u' } as any],
      folders: [
        { id: 'f1', order: 0, title: 'A', requests: [{ id: 'r1', title: 'a1', httpMethod: 0, url: 'u' } as any], folders: [] },
      ],
    };
    collectionsSpy.getCollections.and.returnValue([col]);
    collectionsSpy.findRequestById.and.callFake((id: string) => {
      if (id === 'r0') return { id: 'r0', title: 'root req', httpMethod: 0, url: 'u' } as any;
      if (id === 'r1') return { id: 'r1', title: 'a1', httpMethod: 0, url: 'u' } as any;
      return null;
    });
    component.addFromFolderList('col:root');
    expect(component.artifact!.cases.length).toBe(2);
  });

  it('addCasesFromFolder adds a case for each request in the folder tree', () => {
    const folder: Folder = {
      id: 'f1',
      order: 0,
      title: 'API',
      requests: [
        { id: 'r1', title: 'A', url: 'https://a', httpMethod: 0 } as any,
        { id: 'r2', title: 'B', url: 'https://b', httpMethod: 0 } as any,
      ],
      folders: [
        { id: 'f2', order: 0, title: 'Sub', requests: [{ id: 'r3', title: 'C', url: 'https://c', httpMethod: 0 } as any], folders: [] },
      ],
    };
    collectionsSpy.findFolderById.and.returnValue(folder);
    collectionsSpy.findRequestById.and.callFake((id: string) => {
      if (id === 'r1') return { id: 'r1', title: 'A', url: 'https://a', httpMethod: 0 } as any;
      if (id === 'r2') return { id: 'r2', title: 'B', url: 'https://b', httpMethod: 0 } as any;
      if (id === 'r3') return { id: 'r3', title: 'C', url: 'https://c', httpMethod: 0 } as any;
      return null;
    });
    component.addCasesFromFolder('f1');
    expect(component.artifact!.cases.length).toBe(3);
    expect(component.selectedCaseId).toBe(component.artifact!.cases[2].id);
  });

  it('addCasesFromFolder alerts when the folder is empty and when all requests are already in the suite', () => {
    spyOn(window, 'alert');
    const empty: Folder = { id: 'fe', order: 0, title: 'Empty', requests: [], folders: [] };
    collectionsSpy.findFolderById.and.returnValue(empty);
    component.addCasesFromFolder('fe');
    expect(window.alert).toHaveBeenCalledWith('No requests in that folder (including subfolders).');

    collectionsSpy.findFolderById.and.returnValue({
      id: 'f1', order: 0, title: 'API', requests: [{ id: 'req-1', title: 'Sample', httpMethod: 0, url: 'https://x' } as any], folders: [],
    });
    (window.alert as jasmine.Spy).calls.reset();
    component.addSavedCase('req-1');
    component.addCasesFromFolder('f1');
    expect(window.alert).toHaveBeenCalledWith('All requests in that folder are already in the suite.');
  });

  it('adds an inline case when the draft has a URL, and resets the draft afterwards', () => {
    component.showAddInline = true;
    component.inlineDraft = { method: 'POST', url: 'https://api.example.com/thing' };
    component.addInlineCase();
    expect(component.artifact!.cases.length).toBe(1);
    expect(component.artifact!.cases[0].target).toEqual(jasmine.objectContaining({ kind: 'inline' }));
    expect(component.showAddInline).toBeFalse();
    expect(component.inlineDraft).toEqual({ method: 'GET', url: '' });
  });

  it('inline case is skipped when the URL is blank', () => {
    component.inlineDraft = { method: 'GET', url: '   ' };
    component.addInlineCase();
    expect(component.artifact!.cases.length).toBe(0);
  });

  it('removeCase deletes the matching case and shifts selection', () => {
    spyOn(window, 'confirm').and.returnValue(true);
    component.addSavedCase('req-1');
    component.addSavedCase('req-1');
    const doomed = component.artifact!.cases[0].id;
    component.selectedCaseId = doomed;
    component.removeCase(doomed);
    expect(component.artifact!.cases.length).toBe(1);
    expect(component.selectedCaseId).toBe(component.artifact!.cases[0].id);
  });

  it('removeCase is cancelled when the user rejects the confirm', () => {
    spyOn(window, 'confirm').and.returnValue(false);
    component.addSavedCase('req-1');
    const id = component.artifact!.cases[0].id;
    component.removeCase(id);
    expect(component.artifact!.cases.length).toBe(1);
  });

  it('duplicateCase clones and inserts directly after the source', () => {
    component.addSavedCase('req-1');
    const sourceId = component.artifact!.cases[0].id;
    component.duplicateCase(sourceId);
    expect(component.artifact!.cases.length).toBe(2);
    expect(component.artifact!.cases[1].name).toContain('(copy)');
    expect(component.artifact!.cases[1].id).not.toBe(sourceId);
  });

  it('toggleCaseEnabled flips the enabled flag', () => {
    component.addSavedCase('req-1');
    const id = component.artifact!.cases[0].id;
    expect(component.artifact!.cases[0].enabled).toBeTrue();
    component.toggleCaseEnabled(id);
    expect(component.artifact!.cases[0].enabled).toBeFalse();
  });

  it('addAssertion appends an assertion of the requested kind to the selected case', () => {
    component.addSavedCase('req-1');
    const initial = component.selectedCase!.assertions.length;
    component.addAssertion('latency');
    component.addAssertion('header');
    component.addAssertion('snapshot');
    expect(component.selectedCase!.assertions.length).toBe(initial + 3);
    const kinds = component.selectedCase!.assertions.map((a) => a.kind);
    expect(kinds).toContain('latency');
    expect(kinds).toContain('header');
    expect(kinds).toContain('snapshot');
  });

  it('removeAssertion drops the assertion at the given index', () => {
    component.addSavedCase('req-1');
    component.addAssertion('latency');
    expect(component.selectedCase!.assertions.length).toBe(2);
    component.removeAssertion(0);
    expect(component.selectedCase!.assertions.length).toBe(1);
    expect(component.selectedCase!.assertions[0].kind).toBe('latency');
  });

  it('snapshotIgnorePathsText / setSnapshotIgnorePaths round-trip through a CSV string', () => {
    const a: SnapshotAssertion = {
      kind: 'snapshot', id: 'a1', matchStatus: true, includeHeaders: [], ignorePaths: ['$.a', '$.b'],
    };
    expect(component.snapshotIgnorePathsText(a)).toBe('$.a, $.b');
    component.addSavedCase('req-1');
    component.setSnapshotIgnorePaths(a, '$.x, , $.y');
    expect(a.ignorePaths).toEqual(['$.x', '$.y']);
  });

  it('setSnapshotIncludeHeaders lowercases and trims entries', () => {
    const a: SnapshotAssertion = {
      kind: 'snapshot', id: 'a1', matchStatus: true, includeHeaders: [], ignorePaths: [],
    };
    component.addSavedCase('req-1');
    component.setSnapshotIncludeHeaders(a, ' Content-Type , X-Req ');
    expect(a.includeHeaders).toEqual(['content-type', 'x-req']);
  });

  it('runAll delegates to the runner and flips `running` during the call', async () => {
    await component.runAll();
    expect(runnerSpy.run).toHaveBeenCalledWith(component.artifact!, {});
  });

  it('runFromHere passes the selected case id to the runner', async () => {
    component.addSavedCase('req-1');
    const id = component.selectedCaseId!;
    await component.runFromHere();
    expect(runnerSpy.run).toHaveBeenCalledWith(jasmine.any(Object), { fromCaseId: id });
  });

  it('runFromHere is a no-op when no case is selected', async () => {
    component.selectedCaseId = null;
    await component.runFromHere();
    expect(runnerSpy.run).not.toHaveBeenCalled();
  });

  it('case-result events populate the results map', () => {
    component.addSavedCase('req-1');
    const id = component.artifact!.cases[0].id;
    const cr: CaseRunResult = { caseId: id, status: 'pass', assertions: [], extracts: [], timings: {} as any } as any;
    caseResult$.next({ suiteId, caseResult: cr });
    expect(component.results.get(id)?.status).toBe('pass');
  });

  it('finished events set finalResult and clear the running flag', () => {
    component.running = true;
    finished$.next({ suiteId, status: 'pass' } as any);
    expect(component.running).toBeFalse();
    expect(component.finalResult).toBeTruthy();
  });

  it('totals aggregates case statuses from the results map', () => {
    component.addSavedCase('req-1');
    component.addSavedCase('req-1');
    const ids = component.artifact!.cases.map((c) => c.id);
    const baseResult = (caseId: string, status: string) => ({
      caseId, status, assertions: [], extracts: [], durationMs: 0,
    } as any);
    caseResult$.next({ suiteId, caseResult: baseResult(ids[0], 'pass') });
    caseResult$.next({ suiteId, caseResult: baseResult(ids[1], 'fail') });
    const t = component.totals();
    expect(t).toEqual(jasmine.objectContaining({ pass: 1, fail: 1, total: 2 }));
  });

  it('toggleRegressionMode flips the flag on the artifact and persists', () => {
    component.toggleRegressionMode();
    expect(component.artifact!.regressionMode).toBeTrue();
    component.toggleRegressionMode();
    expect(component.artifact!.regressionMode).toBeFalse();
  });

  it('addVariable / removeVariable manage the suite variables list', () => {
    component.addVariable();
    expect(component.artifact!.variables.length).toBe(1);
    component.removeVariable(0);
    expect(component.artifact!.variables.length).toBe(0);
  });

  it('addExtraction / removeExtraction manage the selected case extracts', () => {
    component.addSavedCase('req-1');
    component.addExtraction();
    expect(component.selectedCase!.extracts!.length).toBe(1);
    component.removeExtraction(0);
    expect(component.selectedCase!.extracts!.length).toBe(0);
  });
});
