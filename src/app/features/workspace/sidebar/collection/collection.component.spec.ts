import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CollectionComponent } from './collection.component';
import { CollectionService } from '@core/collection/collection.service';
import { CollectionWebSocketTabService } from '@core/collection/collection-websocket-tab.service';
import { SessionService } from '@core/session/session.service';
import { RequestService } from '@core/http/request.service';
import { TabService } from '@core/tabs/tab.service';
import { SettingsService } from '@core/settings/settings.service';
import { ViewStateService } from '@core/session/view-state.service';
import { ConfirmDialogService } from '@core/ui/confirm-dialog.service';
import { of } from 'rxjs';
import { CommonModule } from '@angular/common';
import { Collection } from '@models/collection';
import { TabType } from '@core/tabs/tab.service';

describe('CollectionComponent', () => {
  let component: CollectionComponent;
  let fixture: ComponentFixture<CollectionComponent>;

  let collectionServiceSpy: jasmine.SpyObj<CollectionService>;
  let sessionServiceSpy: jasmine.SpyObj<SessionService>;
  let requestServiceSpy: jasmine.SpyObj<RequestService>;
  let tabServiceSpy: jasmine.SpyObj<TabService>;
  let settingsServiceSpy: jasmine.SpyObj<SettingsService>;
  let viewStateServiceSpy: jasmine.SpyObj<ViewStateService>;
  let collectionWebSocketTabServiceSpy: jasmine.SpyObj<CollectionWebSocketTabService>;
  let confirmDialogSpy: jasmine.SpyObj<ConfirmDialogService>;

  const mockCollections: Collection[] = [
    {
      id: 'col-1',
      title: 'Test Collection',
      order: 0,
      folders: [
        { id: 'fol-1', title: 'Folder 1', folders: [], requests: [], websocketRequests: [], order: 0 }
      ],
      requests: []
    }
  ];

  beforeEach(async () => {
    collectionWebSocketTabServiceSpy = jasmine.createSpyObj('CollectionWebSocketTabService', [
      'getSelectedWebSocketTabAsObservable',
      'selectWebSocketTab',
    ]);
    collectionWebSocketTabServiceSpy.getSelectedWebSocketTabAsObservable.and.returnValue(of(null));

    collectionServiceSpy = jasmine.createSpyObj('CollectionService', [
      'getCollectionsObservable',
      'getSelectedFolderAsObservable',
      'getCreateNewCollectionObservable',
      'isCreationPending',
      'saveCollections',
      'getCollections',
      'findCollectionByCollectionId',
      'findFolderById',
      'getFolderDepth',
      'moveFolder',
      'moveWebSocketRequest',
      'moveRequestBeforeInParent',
      'moveWebSocketBeforeInParent',
      'moveRequestOrWebSocketBeforeInMixedOrder',
      'moveSidebarLeafStepInMixedOrder',
      'buildMergedRequestWebSocketLeaves',
      'updateRequest',
      'updateWebSocketRequest',
      'triggerFolderDeleted',
      'triggerRequestDeleted',
      'triggerWebSocketEntryDeleted',
    ]);
    sessionServiceSpy = jasmine.createSpyObj('SessionService', ['get', 'save']);
    requestServiceSpy = jasmine.createSpyObj('RequestService', ['getSelectedRequestAsObservable', 'selectRequest']);
    tabServiceSpy = jasmine.createSpyObj('TabService', ['getSelectedTab']);
    settingsServiceSpy = jasmine.createSpyObj('SettingsService', ['getSettings']);
    viewStateServiceSpy = jasmine.createSpyObj('ViewStateService', ['clearRequestView', 'clearFolderView']);

    confirmDialogSpy = jasmine.createSpyObj('ConfirmDialogService', ['confirm', 'alert']);
    confirmDialogSpy.confirm.and.returnValue(Promise.resolve(true));

    collectionServiceSpy.getCollectionsObservable.and.returnValue(of(mockCollections));
    collectionServiceSpy.getCollections.and.returnValue(mockCollections);
    collectionServiceSpy.moveFolder.and.returnValue(Promise.resolve());
    collectionServiceSpy.moveWebSocketRequest.and.returnValue(Promise.resolve());
    collectionServiceSpy.moveRequestBeforeInParent.and.returnValue(Promise.resolve());
    collectionServiceSpy.moveWebSocketBeforeInParent.and.returnValue(Promise.resolve());
    collectionServiceSpy.moveRequestOrWebSocketBeforeInMixedOrder.and.returnValue(Promise.resolve());
    collectionServiceSpy.moveSidebarLeafStepInMixedOrder.and.returnValue(Promise.resolve());
    collectionServiceSpy.buildMergedRequestWebSocketLeaves.and.callFake((parent: any) => [
      ...parent.requests.map((item: any) => ({ isWs: false, item })),
      ...((parent.websocketRequests || []) as any[]).map((item: any) => ({ isWs: true, item })),
    ]);
    collectionServiceSpy.getSelectedFolderAsObservable.and.returnValue(of(null as any));
    collectionServiceSpy.getCreateNewCollectionObservable.and.returnValue(of() as any);
    collectionServiceSpy.isCreationPending.and.returnValue(false);
    requestServiceSpy.getSelectedRequestAsObservable.and.returnValue(of(null));
    settingsServiceSpy.getSettings.and.returnValue({ ui: { folderClickBehavior: 'both' } } as any);

    await TestBed.configureTestingModule({
      imports: [CollectionComponent, CommonModule],
      providers: [
        { provide: CollectionService, useValue: collectionServiceSpy },
        { provide: SessionService, useValue: sessionServiceSpy },
        { provide: RequestService, useValue: requestServiceSpy },
        { provide: TabService, useValue: tabServiceSpy },
        { provide: SettingsService, useValue: settingsServiceSpy },
        { provide: ViewStateService, useValue: viewStateServiceSpy },
        { provide: CollectionWebSocketTabService, useValue: collectionWebSocketTabServiceSpy },
        { provide: ConfirmDialogService, useValue: confirmDialogSpy },
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(CollectionComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create and load collections', () => {
    expect(component).toBeTruthy();
    expect(component.collections.length).toBe(1);
    expect(component.collections[0].title).toBe('Test Collection');
  });

  it('moveRequestUpInList calls moveSidebarLeafStepInMixedOrder', async () => {
    const col: Collection = {
      id: 'col-1',
      title: 'T',
      order: 0,
      folders: [],
      requests: [
        { id: 'r1', title: 'a', httpMethod: 0, url: '', headers: [] } as any,
        { id: 'r2', title: 'b', httpMethod: 0, url: '', headers: [] } as any,
      ],
    };
    component.collections = [col];
    await component.moveRequestUpInList('r2');
    expect(collectionServiceSpy.moveSidebarLeafStepInMixedOrder).toHaveBeenCalledWith('r2', false, 'col-1', true, -1);
  });

  it('should expand folders', () => {
    const folder = mockCollections[0].folders[0];
    component.toggleFolder(folder);
    expect(component.isExpanded(folder.id, 'folder')).toBeTrue();
    expect(sessionServiceSpy.save).toHaveBeenCalled();
  });

  it('should create new folder', async () => {
    collectionServiceSpy.findCollectionByCollectionId.and.returnValue(mockCollections[0]);
    await component.createFolder(mockCollections[0].id);

    expect(mockCollections[0].folders.length).toBe(2);
    expect(component.editingFolderId).toBeDefined();
    expect(collectionServiceSpy.saveCollections).toHaveBeenCalled();
  });

  it('should select request', () => {
    const mockRequest = { id: 'req-1', title: 'Test Request' } as any;
    component.selectRequest(mockRequest);

    expect(component.selectedRequestId).toBe('req-1');
    expect(requestServiceSpy.selectRequest).toHaveBeenCalled();
  });

  it('should select websocket tab via CollectionWebSocketTabService', () => {
    const ws = { id: 'ws-1', title: 'Stream', mode: 'ws' as const, url: '' };
    component.selectWebSocket(ws as any);
    expect(component.selectedWebSocketId).toBe('ws-1');
    expect(collectionWebSocketTabServiceSpy.selectWebSocketTab).toHaveBeenCalledWith(
      jasmine.objectContaining({ id: 'ws-1', type: TabType.WEBSOCKET }),
    );
  });

  it('should create a websocket entry under a collection', async () => {
    collectionServiceSpy.findCollectionByCollectionId.and.returnValue(mockCollections[0]);
    await component.createWebSocketRequest(mockCollections[0].id);
    expect(mockCollections[0].websocketRequests?.length).toBe(1);
    expect(mockCollections[0].websocketRequests![0].title).toBe('New WebSocket');
    expect(collectionServiceSpy.saveCollections).toHaveBeenCalled();
  });

  describe('Integration: Complex Collection Operations', () => {
    it('should recursively identify all request IDs for deletion when a folder is deleted', async () => {
      const nestedFolder = {
        id: 'fol-nested',
        title: 'Nested',
        folders: [],
        requests: [{ id: 'req-nested-1' }, { id: 'req-nested-2' }],
        websocketRequests: [{ id: 'ws-nested-1', title: 'N', mode: 'ws', url: '' }],
      } as any;
      const parentFolder = {
        id: 'fol-parent',
        title: 'Parent',
        folders: [nestedFolder],
        requests: [{ id: 'req-parent-1' }],
        websocketRequests: [{ id: 'ws-parent-1', title: 'P', mode: 'sse', url: '' }],
      } as any;

      component.collections = [{
        id: 'col-1',
        folders: [parentFolder],
        requests: []
      }] as any;

      const triggerSpy = jasmine.createSpy('trigger');
      collectionServiceSpy.triggerRequestDeleted = triggerSpy;
      const triggerWsSpy = jasmine.createSpy('triggerWs');
      collectionServiceSpy.triggerWebSocketEntryDeleted = triggerWsSpy;

      await component.deleteFolder('fol-parent');

      expect(triggerSpy).toHaveBeenCalledWith('req-parent-1');
      expect(triggerSpy).toHaveBeenCalledWith('req-nested-1');
      expect(triggerSpy).toHaveBeenCalledWith('req-nested-2');
      expect(triggerWsSpy).toHaveBeenCalledWith('ws-parent-1');
      expect(triggerWsSpy).toHaveBeenCalledWith('ws-nested-1');
    });

    it('should enforce the 7-level depth constraint during drag-and-drop', () => {
      collectionServiceSpy.getFolderDepth.and.returnValue(6); 

      const draggedFolder = { id: 'dragged', title: 'Subtree', folders: [] } as any;
      component.draggedItem = { id: 'dragged', type: 'folder' };
      spyOn(component as any, 'findFolderById').and.returnValue(draggedFolder);
      spyOn(component as any, 'getFolderSubtreeDepth').and.returnValue(1); 

      const isValid = (component as any).isValidDrop('target-folder', 'folder');
      expect(isValid).toBeFalse();
    });

    it('should prevent dropping a folder into its own offspring', () => {
      const parent = { id: 'parent', folders: [{ id: 'child', folders: [] }] } as any;
      component.draggedItem = { id: 'parent', type: 'folder' };
      spyOn(component as any, 'findFolderById').and.returnValue(parent);

      const isValid = (component as any).isValidDrop('child', 'folder');
      expect(isValid).toBeFalse();
    });

    it('should reorder sibling folders when dropping with Shift on a sibling', async () => {
      const col: Collection = {
        id: 'col-1',
        title: 'Test Collection',
        order: 0,
        folders: [
          { id: 'fol-a', title: 'A', folders: [], requests: [], websocketRequests: [], order: 0 },
          { id: 'fol-b', title: 'B', folders: [], requests: [], websocketRequests: [], order: 1 },
          { id: 'fol-c', title: 'C', folders: [], requests: [], websocketRequests: [], order: 2 }
        ],
        requests: []
      };
      component.collections = [col];
      collectionServiceSpy.getCollections.and.returnValue([col]);

      component.draggedItem = { id: 'fol-c', type: 'folder', parentId: col.id };
      await component.onDrop(
        { preventDefault: () => {}, stopPropagation: () => {}, altKey: false, shiftKey: true } as DragEvent,
        'fol-a',
        'folder',
      );

      expect(col.folders.map(f => f.id)).toEqual(['fol-c', 'fol-a', 'fol-b']);
      expect(col.folders.map(f => f.order)).toEqual([0, 1, 2]);
      expect(collectionServiceSpy.saveCollections).toHaveBeenCalled();
    });

    it('should reorder sibling folders when dropping one onto another', async () => {
      const col: Collection = {
        id: 'col-1',
        title: 'Test Collection',
        order: 0,
        folders: [
          { id: 'fol-a', title: 'A', folders: [], requests: [], websocketRequests: [], order: 0 },
          { id: 'fol-b', title: 'B', folders: [], requests: [], websocketRequests: [], order: 1 },
          { id: 'fol-c', title: 'C', folders: [], requests: [], websocketRequests: [], order: 2 }
        ],
        requests: []
      };
      component.collections = [col];
      collectionServiceSpy.getCollections.and.returnValue([col]);

      component.draggedItem = { id: 'fol-c', type: 'folder', parentId: col.id };
      await component.onDrop(
        { preventDefault: () => {}, stopPropagation: () => {}, altKey: true } as DragEvent,
        'fol-a',
        'folder',
      );

      expect(col.folders.map(f => f.id)).toEqual(['fol-c', 'fol-a', 'fol-b']);
      expect(col.folders.map(f => f.order)).toEqual([0, 1, 2]);
      expect(collectionServiceSpy.saveCollections).toHaveBeenCalled();
    });

    it('should nest a folder into a sibling when dropping without Alt (not reorder)', async () => {
      const inner = { id: 'fol-inner', title: 'Inner', folders: [], requests: [], websocketRequests: [], order: 0 };
      const col: Collection = {
        id: 'col-1',
        title: 'Test Collection',
        order: 0,
        folders: [
          { id: 'fol-a', title: 'A', folders: [], requests: [], websocketRequests: [], order: 0 },
          { id: 'fol-b', title: 'B', folders: [inner], requests: [], websocketRequests: [], order: 1 },
        ],
        requests: [],
      };
      component.collections = [col];
      collectionServiceSpy.getCollections.and.returnValue([col]);
      collectionServiceSpy.findFolderById.and.callFake((id: string) => component.findFolderById(id));

      component.draggedItem = { id: 'fol-a', type: 'folder', parentId: col.id };
      await component.onDrop(
        { preventDefault: () => {}, stopPropagation: () => {}, altKey: false } as DragEvent,
        'fol-b',
        'folder',
      );

      expect(collectionServiceSpy.moveFolder).toHaveBeenCalledWith('fol-a', 'fol-b', false);
    });
  });
});
