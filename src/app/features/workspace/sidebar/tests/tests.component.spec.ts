import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';
import { TestsComponent } from './tests.component';
import { TabService } from '@core/tabs/tab.service';
import { TestArtifactService } from '@core/testing/test-artifact.service';
import { DEFAULT_LOAD_CONFIG, ensureLoadTestProfiles, LOAD_TEST_PROFILE_PICKER_TEMPLATE_PREFIX } from '@models/testing/load-test';
import type { LoadTestArtifact } from '@models/testing/load-test';

describe('TestsComponent (sidebar)', () => {
  let fixture: ComponentFixture<TestsComponent>;
  let component: TestsComponent;

  let loadTests$: BehaviorSubject<any[]>;
  let testSuites$: BehaviorSubject<any[]>;
  let contractTests$: BehaviorSubject<any[]>;
  let flows$: BehaviorSubject<any[]>;

  let artifactsSpy: jasmine.SpyObj<TestArtifactService>;
  let tabSpy: jasmine.SpyObj<TabService>;

  beforeEach(async () => {
    loadTests$     = new BehaviorSubject<any[]>([]);
    testSuites$    = new BehaviorSubject<any[]>([]);
    contractTests$ = new BehaviorSubject<any[]>([]);
    flows$         = new BehaviorSubject<any[]>([]);

    artifactsSpy = jasmine.createSpyObj('TestArtifactService', [
      'loadTests$', 'testSuites$', 'contractTests$', 'flows$',
      'create', 'update', 'remove', 'duplicate', 'getById',
    ]);
    artifactsSpy.getById.and.returnValue(undefined);
    artifactsSpy.loadTests$.and.returnValue(loadTests$);
    artifactsSpy.testSuites$.and.returnValue(testSuites$);
    artifactsSpy.contractTests$.and.returnValue(contractTests$);
    artifactsSpy.flows$.and.returnValue(flows$);
    artifactsSpy.create.and.resolveTo();
    artifactsSpy.update.and.resolveTo();
    artifactsSpy.remove.and.resolveTo();
    artifactsSpy.duplicate.and.resolveTo(null);

    tabSpy = jasmine.createSpyObj('TabService', [
      'openLoadTestTab', 'openTestSuiteTab', 'openContractTestTab', 'openFlowTab',
    ]);

    await TestBed.configureTestingModule({
      imports: [TestsComponent],
      providers: [
        { provide: TestArtifactService, useValue: artifactsSpy },
        { provide: TabService,          useValue: tabSpy },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TestsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('creates four sections in a stable order', () => {
    expect(component.sections.map((s) => s.key))
      .toEqual(['loadTests', 'testSuites', 'contractTests', 'flows']);
  });

  it('reflects stream updates in the matching section', () => {
    loadTests$.next([{ id: 'lt-1', title: 'L1', updatedAt: 1 }]);
    testSuites$.next([{ id: 'ts-1', title: 'S1', updatedAt: 1 }]);
    flows$.next([{ id: 'f-1', title: 'F1', updatedAt: 1 }, { id: 'f-2', title: 'F2', updatedAt: 1 }]);

    fixture.detectChanges();
    expect(component.sections[0].items.length).toBe(1);
    expect(component.sections[1].items[0].id).toBe('ts-1');
    expect(component.sections[3].items.length).toBe(2);
  });

  it('toggle() flips the collapsed flag for a section', () => {
    const first = component.sections[0];
    expect(first.collapsed).toBeFalse();
    component.toggle(first);
    expect(first.collapsed).toBeTrue();
  });

  it('createNew persists the artifact, opens its tab, and enters rename mode', async () => {
    const section = component.sections[0];
    await component.createNew(section);
    expect(artifactsSpy.create).toHaveBeenCalledWith('loadTests', jasmine.any(Object));
    expect(tabSpy.openLoadTestTab).toHaveBeenCalled();
    expect(component.editingId).toBeTruthy();
    expect(component.editingTitle).toBe('New load test');
  });

  it('openItem dispatches to the section-specific tab opener', async () => {
    const item = { id: 'ct-5', title: 'Contract', updatedAt: 1 };
    await component.openItem(component.sections[2], item);
    expect(tabSpy.openContractTestTab).toHaveBeenCalledWith('ct-5', 'Contract');
  });

  it('beginRename seeds edit state and closes any open context menu', () => {
    component.contextMenuFor = 'other';
    component.beginRename({ id: 'x', title: 'Title', updatedAt: 0 });
    expect(component.editingId).toBe('x');
    expect(component.editingTitle).toBe('Title');
    expect(component.contextMenuFor).toBeNull();
  });

  it('commitRename persists a trimmed new title', async () => {
    component.editingId = 'a';
    component.editingTitle = '  Renamed  ';
    await component.commitRename(component.sections[0], { id: 'a', title: 'Old', updatedAt: 0 });
    expect(artifactsSpy.update).toHaveBeenCalledWith('loadTests',
      jasmine.objectContaining({ id: 'a', title: 'Renamed' }));
    expect(component.editingId).toBeNull();
  });

  it('commitRename exits edit mode without saving when title is unchanged', async () => {
    component.editingId = 'a';
    component.editingTitle = 'Same';
    await component.commitRename(component.sections[0], { id: 'a', title: 'Same', updatedAt: 0 });
    expect(artifactsSpy.update).not.toHaveBeenCalled();
    expect(component.editingId).toBeNull();
  });

  it('commitRename falls back to the original title when the new one is blank', async () => {
    component.editingId = 'a';
    component.editingTitle = '   ';
    await component.commitRename(component.sections[0], { id: 'a', title: 'Keep', updatedAt: 0 });
    expect(artifactsSpy.update).not.toHaveBeenCalled();
  });

  it('cancelRename clears edit state without persisting', () => {
    component.editingId = 'z';
    component.editingTitle = 'pending';
    component.cancelRename();
    expect(component.editingId).toBeNull();
  });

  it('context menu is scoped to the clicked item', () => {
    const mockEvent = { preventDefault: jasmine.createSpy(), stopPropagation: jasmine.createSpy() } as any;
    component.openContextMenu(mockEvent, component.sections[1], { id: 'ts-9', title: 'x', updatedAt: 0 });
    expect(component.contextMenuFor).toBe('ts-9');
    expect(component.contextMenuKind).toBe('testSuites');
    component.closeContextMenu();
    expect(component.contextMenuFor).toBeNull();
    expect(component.contextMenuKind).toBeNull();
  });

  it('duplicateItem calls the service and then closes the menu', async () => {
    await component.duplicateItem(component.sections[0], { id: 'lt-1', title: 't', updatedAt: 0 });
    expect(artifactsSpy.duplicate).toHaveBeenCalledWith('loadTests', 'lt-1', jasmine.any(String));
    expect(component.contextMenuFor).toBeNull();
  });

  it('deleteItem prompts and removes only on confirmation', async () => {
    spyOn(window, 'confirm').and.returnValue(false);
    await component.deleteItem(component.sections[0], { id: 'lt-1', title: 't', updatedAt: 0 });
    expect(artifactsSpy.remove).not.toHaveBeenCalled();

    (window.confirm as jasmine.Spy).and.returnValue(true);
    await component.deleteItem(component.sections[0], { id: 'lt-1', title: 't', updatedAt: 0 });
    expect(artifactsSpy.remove).toHaveBeenCalledWith('loadTests', 'lt-1');
  });

  it('onAddLoadTestProfile appends a template and opens the load test tab', async () => {
    const base = ensureLoadTestProfiles({
      id: 'lt-99',
      title: 'My LT',
      updatedAt: 1,
      config: { ...DEFAULT_LOAD_CONFIG, targets: [] },
    } as LoadTestArtifact);
    artifactsSpy.getById.and.callFake(
      (k: string, id: string) => (k === 'loadTests' && id === 'lt-99' ? base : undefined) as any,
    );
    const el = document.createElement('select');
    el.add(new Option('…', ''));
    el.add(new Option('Smoke', `${LOAD_TEST_PROFILE_PICKER_TEMPLATE_PREFIX}tpl-smoke`));
    el.selectedIndex = 1;
    const ev = { target: el } as unknown as Event;
    await component.onAddLoadTestProfile(ev, { id: 'lt-99', title: 'My LT', updatedAt: 1 });
    expect(artifactsSpy.update).toHaveBeenCalled();
    const updated = artifactsSpy.update.calls.mostRecent().args[1] as LoadTestArtifact;
    expect(updated.profiles?.length).toBeGreaterThan(1);
    expect(tabSpy.openLoadTestTab).toHaveBeenCalledWith('lt-99', 'My LT');
  });

  it('unsubscribes from artifact streams on destroy', () => {
    fixture.destroy();
    expect(loadTests$.observed).toBeFalse();
    expect(flows$.observed).toBeFalse();
  });
});
