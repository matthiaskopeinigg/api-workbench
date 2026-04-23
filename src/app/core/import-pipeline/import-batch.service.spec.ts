import { TestBed } from '@angular/core/testing';
import {
  detectImportFormat,
  formatBatchImportSummary,
  ImportBatchService,
} from './import-batch.service';
import { CollectionService } from '@core/collection/collection.service';
import { ImportService } from './import.service';

describe('import-batch helpers', () => {
  it('detectImportFormat: workbench export', () => {
    const json = JSON.stringify({ collections: [{ id: 'c1', title: 'A', order: 0, requests: [], folders: [] }] });
    expect(detectImportFormat('x.json', json, JSON.parse(json))).toBe('workbench');
  });

  it('detectImportFormat: postman v2.1', () => {
    const raw = JSON.stringify({ info: { name: 'P', schema: 'x' }, item: [] });
    expect(detectImportFormat('p.json', raw, JSON.parse(raw))).toBe('postman');
  });

  it('detectImportFormat: openapi 3', () => {
    const raw = JSON.stringify({ openapi: '3.0.0', info: { title: 'A' }, paths: {} });
    expect(detectImportFormat('a.json', raw, JSON.parse(raw))).toBe('openapi');
  });

  it('detectImportFormat: HAR', () => {
    const raw = JSON.stringify({ log: { version: '1.2', entries: [] } });
    expect(detectImportFormat('a.har', raw, JSON.parse(raw))).toBe('har');
  });

  it('detectImportFormat: Insomnia v4', () => {
    const raw = JSON.stringify({ __export_format: 4, resources: [] });
    expect(detectImportFormat('a.json', raw, JSON.parse(raw))).toBe('insomnia');
  });

  it('formatBatchImportSummary', () => {
    expect(formatBatchImportSummary({ ok: 0, failed: 0, errors: [] })).toContain('No files');
    expect(formatBatchImportSummary({ ok: 2, failed: 0, errors: [] })).toContain('2 file');
    const s = formatBatchImportSummary({ ok: 1, failed: 1, errors: [{ path: '/a', message: 'bad' }] });
    expect(s).toContain('1 failed');
    expect(s).toContain('bad');
  });
});

describe('ImportBatchService', () => {
  let service: ImportBatchService;
  let importSpy: jasmine.SpyObj<ImportService>;
  let collectionSpy: jasmine.SpyObj<CollectionService>;

  beforeEach(() => {
    importSpy = jasmine.createSpyObj('ImportService', [
      'importOpenApi',
      'importPostmanCollection',
      'importHar',
      'importInsomniaExport',
    ]);
    collectionSpy = jasmine.createSpyObj('CollectionService', ['getCollections', 'saveCollections']);
    importSpy.importPostmanCollection.and.callFake((arg: any) => ({
      id: 'col',
      order: 0,
      title: 'Imported',
      requests: [],
      folders: [],
    }));
    importSpy.importOpenApi.and.returnValue({
      id: 'o1',
      order: 0,
      title: 'O',
      requests: [],
      folders: [],
    });
    importSpy.importHar.and.returnValue({
      id: 'h1',
      order: 0,
      title: 'HAR',
      requests: [],
      folders: [],
    });
    importSpy.importInsomniaExport.and.returnValue({
      id: 'i1',
      order: 0,
      title: 'In',
      requests: [],
      folders: [],
    });
    collectionSpy.getCollections.and.returnValue([
      { id: 'root', order: 0, title: 'Root', requests: [], folders: [] },
    ]);
    collectionSpy.saveCollections.and.resolveTo();
    TestBed.configureTestingModule({
      providers: [
        ImportBatchService,
        { provide: CollectionService, useValue: collectionSpy },
        { provide: ImportService, useValue: importSpy },
      ],
    });
    service = TestBed.inject(ImportBatchService);
  });

  it('runBatch returns empty for no files', async () => {
    const r = await service.runBatch([]);
    expect(r.ok).toBe(0);
    expect(r.failed).toBe(0);
  });

  it('runBatch imports postman and merges', async () => {
    const raw = JSON.stringify({ info: { name: 'P', schema: 'x' }, item: [] });
    const r = await service.runBatch([{ path: 'p.json', rawText: raw, content: JSON.parse(raw) }]);
    expect(r.ok).toBe(1);
    expect(r.failed).toBe(0);
    expect(collectionSpy.saveCollections).toHaveBeenCalled();
  });

  it('runBatch imports HAR and merges', async () => {
    const raw = JSON.stringify({ log: { version: '1.2', entries: [] } });
    const obj = JSON.parse(raw);
    const r = await service.runBatch([{ path: 'a.har', rawText: raw, content: obj }]);
    expect(r.ok).toBe(1);
    expect(r.failed).toBe(0);
    expect(importSpy.importHar).toHaveBeenCalled();
  });
});
