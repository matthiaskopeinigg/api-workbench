import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { of } from 'rxjs';
import { HomeComponent } from './home.component';
import { CollectionService } from '@core/collection/collection.service';
import { ImportService } from '@core/import-pipeline/import.service';
import { FileDialogService } from '@core/platform/file-dialog.service';
import { ImportIntentsService } from '@core/import-pipeline/import-intents.service';
import { ImportBatchService } from '@core/import-pipeline/import-batch.service';
import { Collection } from '@models/collection';

describe('HomeComponent', () => {
  let component: HomeComponent;
  let fixture: ComponentFixture<HomeComponent>;
  let collectionServiceSpy: jasmine.SpyObj<CollectionService>;
  let importServiceSpy: jasmine.SpyObj<ImportService>;
  let fileDialogServiceSpy: jasmine.SpyObj<FileDialogService>;
  let importIntentsServiceSpy: jasmine.SpyObj<ImportIntentsService>;
  let importBatchServiceSpy: jasmine.SpyObj<ImportBatchService>;

  const makeCollection = (title: string): Collection => ({
    id: 'imported-' + title,
    order: 0,
    title,
    requests: [],
    folders: [],
  });

  beforeEach(async () => {
    collectionServiceSpy = jasmine.createSpyObj('CollectionService', [
      'triggerCreateNewCollection',
      'getCollections',
      'saveCollections',
      'getCreateNewCollectionObservable',
    ]);
    collectionServiceSpy.getCreateNewCollectionObservable.and.returnValue(of() as any);
    importServiceSpy = jasmine.createSpyObj('ImportService', [
      'importPostmanCollection',
      'importOpenApi',
    ]);
    fileDialogServiceSpy = jasmine.createSpyObj('FileDialogService', [
      'openFile',
      'openFiles',
      'readImportFolder',
    ]);
    importBatchServiceSpy = jasmine.createSpyObj('ImportBatchService', ['runBatch']);
    importBatchServiceSpy.runBatch.and.returnValue(
      Promise.resolve({ ok: 0, failed: 0, errors: [] }),
    );
    importIntentsServiceSpy = jasmine.createSpyObj('ImportIntentsService', [
      'triggerPostmanImport',
      'triggerOpenApiImport',
      'triggerCurlImport',
      'postman$',
      'openApi$',
      'curl$',
      'importBatchFiles$',
      'importFromFolder$',
    ]);
    importIntentsServiceSpy.postman$.and.returnValue(of<void>());
    importIntentsServiceSpy.openApi$.and.returnValue(of<void>());
    importIntentsServiceSpy.curl$.and.returnValue(of<void>());
    importIntentsServiceSpy.importBatchFiles$.and.returnValue(of<void>());
    importIntentsServiceSpy.importFromFolder$.and.returnValue(of(undefined));

    collectionServiceSpy.getCollections.and.returnValue([]);
    collectionServiceSpy.saveCollections.and.returnValue(Promise.resolve());

    await TestBed.configureTestingModule({
      imports: [HomeComponent],
      providers: [
        { provide: CollectionService, useValue: collectionServiceSpy },
        { provide: ImportService, useValue: importServiceSpy },
        { provide: FileDialogService, useValue: fileDialogServiceSpy },
        { provide: ImportIntentsService, useValue: importIntentsServiceSpy },
        { provide: ImportBatchService, useValue: importBatchServiceSpy },
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(HomeComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create with default state', () => {
    expect(component).toBeTruthy();
    expect(component.secondaryToggled).toBeFalse();
    expect(component.tabSize).toBe(0);
    expect(component.isImporting).toBeFalse();
    expect(component.toast).toBeNull();
  });

  it('createCollection should delegate to CollectionService', () => {
    component.createCollection();
    expect(collectionServiceSpy.triggerCreateNewCollection).toHaveBeenCalledTimes(1);
  });

  it('importPostman should parse the file and persist the collection', async () => {
    const parsedJson = { info: { name: 'My Postman Collection' } };
    fileDialogServiceSpy.openFile.and.returnValue(
      Promise.resolve({ content: parsedJson, rawText: JSON.stringify(parsedJson), path: 'c.json' }) as any
    );
    importServiceSpy.importPostmanCollection.and.returnValue(makeCollection('Postman Collection'));

    await component.importPostman();

    expect(importServiceSpy.importPostmanCollection).toHaveBeenCalledWith(parsedJson as any);
    expect(collectionServiceSpy.saveCollections).toHaveBeenCalled();
    expect(component.toast?.tone).toBe('success');
    expect(component.toast?.message).toContain('Postman Collection');
    expect(component.isImporting).toBeFalse();
  });

  it('importOpenApi should forward to ImportService', async () => {
    const parsedJson = { openapi: '3.0.0', info: { title: 'Pet Store' } };
    fileDialogServiceSpy.openFile.and.returnValue(
      Promise.resolve({ content: parsedJson, rawText: JSON.stringify(parsedJson), path: 'api.json' }) as any
    );
    importServiceSpy.importOpenApi.and.returnValue(makeCollection('Pet Store'));

    await component.importOpenApi();

    expect(importServiceSpy.importOpenApi).toHaveBeenCalledWith(parsedJson as any);
    expect(collectionServiceSpy.saveCollections).toHaveBeenCalled();
    expect(component.toast?.tone).toBe('success');
  });

  it('importPostman should surface an error toast when import throws', async () => {
    fileDialogServiceSpy.openFile.and.returnValue(
      Promise.resolve({ content: { info: {} }, rawText: '{}', path: 'c.json' }) as any
    );
    importServiceSpy.importPostmanCollection.and.throwError(new Error('bad schema'));

    await component.importPostman();

    expect(component.toast?.tone).toBe('error');
    expect(collectionServiceSpy.saveCollections).not.toHaveBeenCalled();
    expect(component.isImporting).toBeFalse();
  });

  it('import should be a no-op when the user cancels the file picker', async () => {
    fileDialogServiceSpy.openFile.and.returnValue(Promise.resolve(null));

    await component.importPostman();

    expect(importServiceSpy.importPostmanCollection).not.toHaveBeenCalled();
    expect(collectionServiceSpy.saveCollections).not.toHaveBeenCalled();
    expect(component.toast).toBeNull();
  });

  it('toast should auto-dismiss after its timer fires', fakeAsync(() => {
    fileDialogServiceSpy.openFile.and.returnValue(
      Promise.resolve({ content: {}, rawText: '{}', path: 'c.json' }) as any
    );
    importServiceSpy.importPostmanCollection.and.returnValue(makeCollection('X'));

    component.importPostman();
    tick();

    expect(component.toast).not.toBeNull();
    tick(3200);
    expect(component.toast).toBeNull();
  }));
});
