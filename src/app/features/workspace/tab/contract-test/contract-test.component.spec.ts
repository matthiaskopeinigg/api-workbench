import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BehaviorSubject, Subject, of } from 'rxjs';
import { ContractTestComponent } from './contract-test.component';
import { TestArtifactService } from '@core/testing/test-artifact.service';
import { ContractValidatorService } from '@core/testing/contract-validator.service';
import { CollectionService } from '@core/collection/collection.service';
import { EnvironmentsService } from '@core/environments/environments.service';
import { ConfirmDialogService } from '@core/ui/confirm-dialog.service';
import { SettingsService } from '@core/settings/settings.service';
import type { TabItem } from '@core/tabs/tab.service';
import { TabType } from '@core/tabs/tab.service';
import { NEW_CONTRACT_TEST } from '@models/testing/contract-test';
import type { ContractTestArtifact, ContractFinding, ContractRunResult } from '@models/testing/contract-test';

describe('ContractTestComponent', () => {
  let fixture: ComponentFixture<ContractTestComponent>;
  let component: ContractTestComponent;

  let contracts$: BehaviorSubject<ContractTestArtifact[]>;
  let finding$: Subject<{ contractId: string; finding: ContractFinding }>;
  let finished$: Subject<ContractRunResult>;

  let artifactsSpy: jasmine.SpyObj<TestArtifactService>;
  let validatorSpy: jasmine.SpyObj<ContractValidatorService>;
  let collectionsSpy: jasmine.SpyObj<CollectionService>;
  let settingsSpy: jasmine.SpyObj<SettingsService>;
  let envSpy: jasmine.SpyObj<EnvironmentsService>;
  let confirmDialogSpy: jasmine.SpyObj<ConfirmDialogService>;

  const contractId = 'ct-1';
  const tab: TabItem = { id: `ct:${contractId}`, title: 'Contract', type: TabType.CONTRACT_TEST };

  const finding = (over: Partial<ContractFinding> = {}): ContractFinding => ({
    id: Math.random().toString(36).slice(2),
    kind: 'undocumented_request',
    severity: 'error',
    method: 'GET',
    path: '/widgets',
    message: 'No matching path in spec',
    ...over,
  } as ContractFinding);

  beforeEach(async () => {
    const seed = NEW_CONTRACT_TEST(contractId);
    seed.title = 'My Contract';
    contracts$ = new BehaviorSubject([seed]);
    finding$ = new Subject();
    finished$ = new Subject();

    artifactsSpy = jasmine.createSpyObj('TestArtifactService', ['contractTests$', 'update']);
    artifactsSpy.contractTests$.and.returnValue(contracts$);
    artifactsSpy.update.and.resolveTo();

    validatorSpy = jasmine.createSpyObj('ContractValidatorService', ['onFinding', 'onFinished', 'run']);
    validatorSpy.onFinding.and.returnValue(finding$.asObservable());
    validatorSpy.onFinished.and.returnValue(finished$.asObservable());
    validatorSpy.run.and.resolveTo();

    collectionsSpy = jasmine.createSpyObj('CollectionService',
      ['getCollectionsObservable', 'getCollections']);
    collectionsSpy.getCollectionsObservable.and.returnValue(of([]));
    collectionsSpy.getCollections.and.returnValue([]);

    settingsSpy = jasmine.createSpyObj('SettingsService', ['loadSettings']);
    settingsSpy.loadSettings.and.resolveTo();

    envSpy = jasmine.createSpyObj('EnvironmentsService', ['loadEnvironments', 'getEnvironmentsObservable']);
    envSpy.loadEnvironments.and.resolveTo();
    envSpy.getEnvironmentsObservable.and.returnValue(of([]));

    confirmDialogSpy = jasmine.createSpyObj('ConfirmDialogService', ['confirm', 'alert']);
    confirmDialogSpy.confirm.and.resolveTo(true);
    confirmDialogSpy.alert.and.resolveTo();

    await TestBed.configureTestingModule({
      imports: [ContractTestComponent],
      providers: [
        { provide: TestArtifactService,      useValue: artifactsSpy },
        { provide: ContractValidatorService, useValue: validatorSpy },
        { provide: CollectionService,        useValue: collectionsSpy },
        { provide: SettingsService,          useValue: settingsSpy },
        { provide: EnvironmentsService,      useValue: envSpy },
        { provide: ConfirmDialogService,     useValue: confirmDialogSpy },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ContractTestComponent);
    component = fixture.componentInstance;
    component.tab = tab;
    fixture.detectChanges();
  });

  it('hydrates the artifact from the stream', () => {
    expect(component.artifact?.id).toBe(contractId);
  });

  it('setSpecKind switches inline<->url and resets the spec shell', () => {
    component.setSpecKind('url');
    expect(component.artifact!.spec.kind).toBe('url');
    expect(component.urlSpec?.url).toBe('');

    component.setSpecKind('inline');
    expect(component.artifact!.spec.kind).toBe('inline');
    expect(component.inlineSpec?.format).toBe('yaml');
  });

  it('setSpecKind is a no-op when the kind is unchanged', () => {
    const before = component.artifact!.spec;
    component.setSpecKind('inline');
    expect(component.artifact!.spec).toBe(before);
  });

  it('parses an inline OpenAPI spec and populates parsedSpec', () => {
    component.artifact!.spec = {
      kind: 'inline', format: 'yaml', updatedAt: 0,
      body: [
        'openapi: 3.0.0',
        'info:',
        '  title: t',
        '  version: 1',
        'paths:',
        '  /ping:',
        '    get:',
        '      responses:',
        '        "200":',
        '          description: ok',
      ].join('\n'),
    };
    component.onSpecBodyChange();
    expect(component.parsedSpec).toBeTruthy();
    expect(component.specError).toBeNull();
  });

  it('invalid inline spec exposes a non-null specError', () => {
    component.artifact!.spec = {
      kind: 'inline', format: 'yaml', updatedAt: 0, body: ': not: valid: yaml:::',
    };
    component.onSpecBodyChange();
    expect(component.specError || component.parsedSpec?.errors.length).toBeTruthy();
  });

  it('onSpecFormatChange toggles inline format and re-parses', () => {
    component.artifact!.spec = { kind: 'inline', format: 'yaml', updatedAt: 0, body: '{}' };
    component.onSpecFormatChange('json');
    expect(component.inlineSpec?.format).toBe('json');
  });

  it('runAll is blocked when no collection is scoped (alerts the user)', async () => {
    await component.runAll();
    expect(confirmDialogSpy.alert).toHaveBeenCalled();
    expect(validatorSpy.run).not.toHaveBeenCalled();
  });

  it('runAll delegates to the validator with staticOnly=false', async () => {
    component.artifact!.scope.collectionId = 'col-1';
    await component.runAll();
    expect(validatorSpy.run).toHaveBeenCalledWith(component.artifact!, { staticOnly: false });
  });

  it('runStaticOnly delegates to the validator with staticOnly=true', async () => {
    component.artifact!.scope.collectionId = 'col-1';
    await component.runStaticOnly();
    expect(validatorSpy.run).toHaveBeenCalledWith(component.artifact!, { staticOnly: true });
  });

  it('collects findings from the stream into the local list', () => {
    finding$.next({ contractId, finding: finding({ severity: 'error' }) });
    finding$.next({ contractId, finding: finding({ severity: 'warning' }) });
    expect(component.findings.length).toBe(2);
  });

  it('ignores findings that target a different contract id', () => {
    finding$.next({ contractId: 'other', finding: finding() });
    expect(component.findings.length).toBe(0);
  });

  it('finished event applies the result and clears the running flag', () => {
    component.running = true;
    const res: ContractRunResult = {
      contractId, status: 'fail',
      totals: { error: 2, warning: 1, info: 0, ok: 0 },
      findings: [],
    } as any;
    finished$.next(res);
    expect(component.result).toEqual(res);
    expect(component.running).toBeFalse();
  });

  it('totals aggregates from findings while running', () => {
    finding$.next({ contractId, finding: finding({ severity: 'error' }) });
    finding$.next({ contractId, finding: finding({ severity: 'warning' }) });
    finding$.next({ contractId, finding: finding({ kind: 'ok', severity: 'info' } as any) });
    expect(component.totals()).toEqual({ error: 1, warning: 1, info: 0, ok: 1 });
  });

  it('totals prefers result.totals once the run is finished', () => {
    component.result = {
      contractId, status: 'fail',
      totals: { error: 7, warning: 0, info: 0, ok: 0 }, findings: [],
    } as any;
    expect(component.totals().error).toBe(7);
  });

  it('setFilter changes severityFilter and rebuilds the tree', () => {
    finding$.next({ contractId, finding: finding({ severity: 'error' }) });
    finding$.next({ contractId, finding: finding({ severity: 'warning', method: 'POST', path: '/x' }) });
    component.setFilter('error');
    expect(component.severityFilter).toBe('error');
    expect(component.treeNodes.length).toBe(1);
  });

  it('onTreeClick selects the matching finding', () => {
    const f = finding({ id: 'pick-me' });
    finding$.next({ contractId, finding: f });
    component.onTreeClick({ id: 'pick-me', label: '', status: 'fail' });
    expect(component.selectedFinding?.id).toBe('pick-me');
  });

  it('onTitleChange persists via the service', () => {
    component.artifact!.title = 'Renamed';
    component.onTitleChange();
    expect(artifactsSpy.update).toHaveBeenCalledWith('contractTests',
      jasmine.objectContaining({ id: contractId, title: 'Renamed' }));
  });

  it('folderPicks returns an empty list when no collection is scoped', () => {
    expect(component.folderPicks).toEqual([]);
  });
});
