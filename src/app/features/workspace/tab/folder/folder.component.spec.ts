import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Subject, of } from 'rxjs';
import { FolderComponent } from './folder.component';
import { CollectionService } from '@core/collection/collection.service';
import { EnvironmentsService } from '@core/environments/environments.service';
import { ViewStateService } from '@core/session/view-state.service';
import { TabItem, TabType } from '@core/tabs/tab.service';
import { AuthType } from '@models/request';
import { Folder } from '@models/collection';

describe('FolderComponent', () => {
  let component: FolderComponent;
  let fixture: ComponentFixture<FolderComponent>;

  let collectionServiceSpy: jasmine.SpyObj<CollectionService>;
  let environmentsServiceSpy: jasmine.SpyObj<EnvironmentsService>;
  let viewStateSpy: jasmine.SpyObj<ViewStateService>;
  let folderUpdated$: Subject<Folder>;

  const mockTab: TabItem = {
    id: 'folder-1',
    title: 'My Folder',
    type: TabType.FOLDER
  };

  const mockFolder: Folder = {
    id: 'folder-1',
    title: 'My Folder',
    order: 0,
    requests: [],
    folders: [],
    variables: [{ key: 'env', value: 'stage' }],
    httpHeaders: [{ key: 'X-Trace', value: '1', description: '' }]
  } as Folder;

  beforeEach(async () => {
    folderUpdated$ = new Subject<Folder>();

    collectionServiceSpy = jasmine.createSpyObj('CollectionService', [
      'findFolderById',
      'updateFolder',
      'getFolderUpdatedObservable',
      'getParentFolders'
    ]);
    environmentsServiceSpy = jasmine.createSpyObj('EnvironmentsService', [
      'getActiveContextAsObservable',
      'getActiveContext'
    ]);

    collectionServiceSpy.findFolderById.and.returnValue(JSON.parse(JSON.stringify(mockFolder)));
    collectionServiceSpy.getFolderUpdatedObservable.and.returnValue(folderUpdated$.asObservable());
    collectionServiceSpy.getParentFolders.and.returnValue([]);
    environmentsServiceSpy.getActiveContextAsObservable.and.returnValue(of(null));
    environmentsServiceSpy.getActiveContext.and.returnValue(null as any);

    viewStateSpy = jasmine.createSpyObj('ViewStateService', [
      'get',
      'patch',
      'getFolderView',
      'patchFolderView'
    ]);
    viewStateSpy.get.and.returnValue(undefined);
    viewStateSpy.getFolderView.and.returnValue(undefined);

    await TestBed.configureTestingModule({
      imports: [FolderComponent],
      providers: [
        { provide: CollectionService, useValue: collectionServiceSpy },
        { provide: EnvironmentsService, useValue: environmentsServiceSpy },
        { provide: ViewStateService, useValue: viewStateSpy }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(FolderComponent);
    component = fixture.componentInstance;
    component.tab = mockTab;
    fixture.detectChanges();
  });

  it('should create and load the folder on init', () => {
    expect(component).toBeTruthy();
    expect(component.folder?.id).toBe('folder-1');
    expect(component.variables.length).toBe(1);
    expect(component.variables[0].key).toBe('env');
    expect(component.headers.length).toBe(1);
  });

  it('setActiveFolderTab should persist active section to tab and folder view state', () => {
    viewStateSpy.patch.calls.reset();
    viewStateSpy.patchFolderView.calls.reset();
    component.setActiveFolderTab('headers');
    expect(component.activeTab).toBe('headers');
    expect(viewStateSpy.patch).toHaveBeenCalledWith('folder-1', { activeFolderTab: 'headers' });
    expect(viewStateSpy.patchFolderView).toHaveBeenCalledWith('folder-1', { activeFolderTab: 'headers' });
  });

  it('should restore the last folder editor section from session', () => {
    viewStateSpy.getFolderView.and.returnValue({ activeFolderTab: 'scripts' });
    fixture = TestBed.createComponent(FolderComponent);
    component = fixture.componentInstance;
    component.tab = mockTab;
    fixture.detectChanges();
    expect(component.activeTab).toBe('scripts');
  });

  it('should default to variables when saved section is invalid', () => {
    viewStateSpy.get.and.returnValue({ activeFolderTab: 'nope' as any });
    fixture = TestBed.createComponent(FolderComponent);
    component = fixture.componentInstance;
    component.tab = mockTab;
    fixture.detectChanges();
    expect(component.activeTab).toBe('variables');
  });

  it('should default script/auth/settings objects when missing on the stored folder', () => {
    expect(component.folder.script).toEqual({ preRequest: '', postRequest: '' });
    expect(component.folder.auth?.type).toBe(AuthType.INHERIT);
    expect(component.folder.settings?.followRedirects).toBeTrue();
  });

  it('addVariable should append a blank row and persist a sanitized clone', () => {
    const before = component.variables.length;
    component.addVariable();
    expect(component.variables.length).toBe(before + 1);

    expect(collectionServiceSpy.updateFolder).toHaveBeenCalled();
    const savedFolder: Folder = collectionServiceSpy.updateFolder.calls.mostRecent().args[0] as Folder;
    expect(savedFolder.variables!.length).toBe(1);
    expect(savedFolder.variables![0].key).toBe('env');
  });

  it('removeVariable should drop the row and save', () => {
    component.removeVariable(0);
    expect(component.variables.length).toBe(0);
    expect(collectionServiceSpy.updateFolder).toHaveBeenCalled();
  });

  it('addHeader/removeHeader should manage the local headers list', () => {
    component.addHeader();
    expect(component.headers.length).toBe(2);
    component.removeHeader(1);
    expect(component.headers.length).toBe(1);
  });

  it('toggleVisibility should flip the visible flag without saving', () => {
    collectionServiceSpy.updateFolder.calls.reset();
    component.toggleVisibility(0);
    expect(component.variables[0].visible).toBeTrue();
    expect(collectionServiceSpy.updateFolder).not.toHaveBeenCalled();
  });

  it('updatePreRequest/updatePostRequest should write to the script object', () => {
    component.updatePreRequest('pm.environment.set("a", 1)');
    expect(component.folder.script!.preRequest).toContain('pm.environment.set');

    component.updatePostRequest('console.log(pm.response)');
    expect(component.folder.script!.postRequest).toContain('console.log');
  });

  it('onAuthTypeChange should populate default sub-config for the chosen type', () => {
    component.folder.auth!.type = AuthType.BEARER;
    component.onAuthTypeChange();
    expect(component.folder.auth!.bearer?.token).toBe('');

    component.folder.auth!.type = AuthType.BASIC;
    delete (component.folder.auth as any).basic;
    component.onAuthTypeChange();
    expect(component.folder.auth!.basic?.username).toBe('');
    expect(component.folder.auth!.basic?.password).toBe('');

    component.folder.auth!.type = AuthType.API_KEY;
    delete (component.folder.auth as any).apiKey;
    component.onAuthTypeChange();
    expect(component.folder.auth!.apiKey?.addTo).toBe('header');

    component.folder.auth!.type = AuthType.OAUTH2;
    delete (component.folder.auth as any).oauth2;
    component.onAuthTypeChange();
    expect(component.folder.auth!.oauth2?.grantType).toBe('authorization_code');
  });

  it('should ignore its own folder-updated emissions (suppressNextReload)', () => {
    component.addVariable(); 
    const before = component.variables.length;

    folderUpdated$.next(mockFolder);

    expect(component.variables.length).toBe(before);
  });

  it('should reload when a sibling save emits for this folder id (no suppression)', () => {
    const updated: Folder = {
      ...mockFolder,
      variables: [{ key: 'env', value: 'prod' }]
    } as Folder;
    collectionServiceSpy.findFolderById.and.returnValue(JSON.parse(JSON.stringify(updated)));

    folderUpdated$.next(updated);

    expect(component.variables[0].value).toBe('prod');
  });

  it('should ignore folder-updated emissions for other folder ids', () => {
    const otherFolder: Folder = { ...mockFolder, id: 'folder-2' } as Folder;
    const beforeCalls = collectionServiceSpy.findFolderById.calls.count();

    folderUpdated$.next(otherFolder);

    expect(collectionServiceSpy.findFolderById.calls.count()).toBe(beforeCalls);
  });
});
