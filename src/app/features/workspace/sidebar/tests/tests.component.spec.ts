import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';
import { TestsComponent } from './tests.component';
import { ConfirmDialogService } from '@core/ui/confirm-dialog.service';
import { TabService } from '@core/tabs/tab.service';
import { TestArtifactService } from '@core/testing/test-artifact.service';
import {
  DEFAULT_LOAD_CONFIG,
  ensureLoadTestProfiles,
  LOAD_TEST_PROFILE_PICKER_TEMPLATE_PREFIX,
  LOAD_TEST_PROFILE_TEMPLATES,
} from '@models/testing/load-test';
import type { LoadTestArtifact } from '@models/testing/load-test';

describe('TestsComponent (sidebar)', () => {
  let fixture: ComponentFixture<TestsComponent>;
  let component: TestsComponent;

  let loadTests$: BehaviorSubject<any[]>;

  let artifactsSpy: jasmine.SpyObj<TestArtifactService>;
  let tabSpy: jasmine.SpyObj<TabService>;
  let confirmDialogSpy: jasmine.SpyObj<ConfirmDialogService>;

  beforeEach(async () => {
    loadTests$ = new BehaviorSubject<any[]>([]);

    artifactsSpy = jasmine.createSpyObj('TestArtifactService', [
      'loadTests$',
      'create',
      'update',
      'remove',
      'duplicate',
      'getById',
    ]);
    artifactsSpy.getById.and.returnValue(undefined);
    artifactsSpy.loadTests$.and.returnValue(loadTests$);
    artifactsSpy.create.and.resolveTo();
    artifactsSpy.update.and.resolveTo();
    artifactsSpy.remove.and.resolveTo();
    artifactsSpy.duplicate.and.resolveTo(null);

    tabSpy = jasmine.createSpyObj('TabService', ['openLoadTestTab']);

    confirmDialogSpy = jasmine.createSpyObj('ConfirmDialogService', ['confirm', 'alert']);
    confirmDialogSpy.confirm.and.resolveTo(true);
    confirmDialogSpy.alert.and.resolveTo();

    await TestBed.configureTestingModule({
      imports: [TestsComponent],
      providers: [
        { provide: TestArtifactService, useValue: artifactsSpy },
        { provide: TabService, useValue: tabSpy },
        { provide: ConfirmDialogService, useValue: confirmDialogSpy },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TestsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('reflects loadTests$ updates in items', () => {
    loadTests$.next([{ id: 'lt-1', title: 'L1', updatedAt: 1 }]);
    fixture.detectChanges();
    expect(component.items.length).toBe(1);
    expect(component.items[0].id).toBe('lt-1');
  });

  it('createNewLoadTest persists the artifact, opens its tab, and enters rename mode', async () => {
    await component.createNewLoadTest();
    expect(artifactsSpy.create).toHaveBeenCalledWith('loadTests', jasmine.any(Object));
    expect(tabSpy.openLoadTestTab).toHaveBeenCalled();
    expect(component.editingId).toBeTruthy();
    expect(component.editingTitle).toBe('New load test');
  });

  it('openItem opens the load test tab', async () => {
    await component.openItem({ id: 'lt-5', title: 'T', updatedAt: 1 });
    expect(tabSpy.openLoadTestTab).toHaveBeenCalledWith('lt-5', 'T');
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
    await component.commitRename({ id: 'a', title: 'Old', updatedAt: 0 });
    expect(artifactsSpy.update).toHaveBeenCalledWith(
      'loadTests',
      jasmine.objectContaining({ id: 'a', title: 'Renamed' }),
    );
    expect(component.editingId).toBeNull();
  });

  it('commitRename exits edit mode without saving when title is unchanged', async () => {
    component.editingId = 'a';
    component.editingTitle = 'Same';
    await component.commitRename({ id: 'a', title: 'Same', updatedAt: 0 });
    expect(artifactsSpy.update).not.toHaveBeenCalled();
    expect(component.editingId).toBeNull();
  });

  it('commitRename falls back to the original title when the new one is blank', async () => {
    component.editingId = 'a';
    component.editingTitle = '   ';
    await component.commitRename({ id: 'a', title: 'Keep', updatedAt: 0 });
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
    component.openContextMenu(mockEvent, { id: 'lt-9', title: 'x', updatedAt: 0 });
    expect(component.contextMenuFor).toBe('lt-9');
    component.closeContextMenu();
    expect(component.contextMenuFor).toBeNull();
  });

  it('duplicateItem calls the service and then closes the menu', async () => {
    component.contextMenuFor = 'lt-1';
    await component.duplicateItem({ id: 'lt-1', title: 't', updatedAt: 0 });
    expect(artifactsSpy.duplicate).toHaveBeenCalledWith('loadTests', 'lt-1', jasmine.any(String));
    expect(component.contextMenuFor).toBeNull();
  });

  it('deleteItem prompts and removes only on confirmation', async () => {
    confirmDialogSpy.confirm.and.resolveTo(false);
    await component.deleteItem({ id: 'lt-1', title: 't', updatedAt: 0 });
    expect(artifactsSpy.remove).not.toHaveBeenCalled();

    confirmDialogSpy.confirm.and.resolveTo(true);
    await component.deleteItem({ id: 'lt-1', title: 't', updatedAt: 0 });
    expect(artifactsSpy.remove).toHaveBeenCalledWith('loadTests', 'lt-1');
  });

  it('loadTestTemplatesAvailable hides catalog rows already represented on the load test', () => {
    const base = ensureLoadTestProfiles({
      id: 'lt-99',
      title: 'My LT',
      updatedAt: 1,
      config: { ...DEFAULT_LOAD_CONFIG, targets: [] },
    } as LoadTestArtifact);
    const smoke = LOAD_TEST_PROFILE_TEMPLATES.find((t) => t.id === 'tpl-smoke')!;
    base.profiles!.push({
      id: 'p-smoke',
      name: smoke.name,
      description: smoke.description,
      isTemplate: true,
      templateCatalogId: smoke.id,
      config: smoke.factory(),
    });
    artifactsSpy.getById.and.returnValue(base);
    const item = { id: 'lt-99', title: 'My LT', updatedAt: 1 };
    const avail = component.loadTestTemplatesAvailable(item);
    expect(avail.some((t) => t.id === 'tpl-smoke')).toBeFalse();
    expect(avail.length).toBe(LOAD_TEST_PROFILE_TEMPLATES.length - 1);
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
  });
});
