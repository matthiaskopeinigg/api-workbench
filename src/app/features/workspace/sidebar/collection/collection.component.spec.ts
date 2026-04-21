import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CollectionComponent } from './collection.component';
import { CollectionService } from '@core/collection.service';
import { SessionService } from '@core/session.service';
import { RequestService } from '@core/request.service';
import { TabService } from '@core/tab.service';
import { SettingsService } from '@core/settings.service';
import { of } from 'rxjs';
import { CommonModule } from '@angular/common';
import { Collection } from '@models/collection';

describe('CollectionComponent', () => {
  let component: CollectionComponent;
  let fixture: ComponentFixture<CollectionComponent>;

  let collectionServiceSpy: jasmine.SpyObj<CollectionService>;
  let sessionServiceSpy: jasmine.SpyObj<SessionService>;
  let requestServiceSpy: jasmine.SpyObj<RequestService>;
  let tabServiceSpy: jasmine.SpyObj<TabService>;
  let settingsServiceSpy: jasmine.SpyObj<SettingsService>;

  const mockCollections: Collection[] = [
    {
      id: 'col-1',
      title: 'Test Collection',
      order: 0,
      folders: [
        { id: 'fol-1', title: 'Folder 1', folders: [], requests: [], order: 0 }
      ],
      requests: []
    }
  ];

  beforeEach(async () => {
    collectionServiceSpy = jasmine.createSpyObj('CollectionService', [
      'getCollectionsObservable',
      'getSelectedFolderAsObservable',
      'getCreateNewCollectionObservable',
      'isCreationPending',
      'saveCollections',
      'findCollectionByCollectionId',
      'findFolderById',
      'getFolderDepth',
      'updateRequest',
      'triggerFolderDeleted',
      'triggerRequestDeleted'
    ]);
    sessionServiceSpy = jasmine.createSpyObj('SessionService', ['get', 'save']);
    requestServiceSpy = jasmine.createSpyObj('RequestService', ['getSelectedRequestAsObservable', 'selectRequest']);
    tabServiceSpy = jasmine.createSpyObj('TabService', ['getSelectedTab']);
    settingsServiceSpy = jasmine.createSpyObj('SettingsService', ['getSettings']);

    collectionServiceSpy.getCollectionsObservable.and.returnValue(of(mockCollections));
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
        { provide: SettingsService, useValue: settingsServiceSpy }
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

  describe('Integration: Complex Collection Operations', () => {
    it('should recursively identify all request IDs for deletion when a folder is deleted', async () => {
      const nestedFolder = {
        id: 'fol-nested',
        title: 'Nested',
        folders: [],
        requests: [{ id: 'req-nested-1' }, { id: 'req-nested-2' }]
      } as any;
      const parentFolder = {
        id: 'fol-parent',
        title: 'Parent',
        folders: [nestedFolder],
        requests: [{ id: 'req-parent-1' }]
      } as any;

      component.collections = [{
        id: 'col-1',
        folders: [parentFolder],
        requests: []
      }] as any;

      const triggerSpy = jasmine.createSpy('trigger');
      collectionServiceSpy.triggerRequestDeleted = triggerSpy;

      await component.deleteFolder('fol-parent');

      expect(triggerSpy).toHaveBeenCalledWith('req-parent-1');
      expect(triggerSpy).toHaveBeenCalledWith('req-nested-1');
      expect(triggerSpy).toHaveBeenCalledWith('req-nested-2');
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
  });
});
