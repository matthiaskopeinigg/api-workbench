import { Injectable } from '@angular/core';
import { Observable, Subject } from 'rxjs';
import type { ReadImportFolderOptions } from '@models/file-dialog';

/**
 * Decouples "I want to start an import" commands from the component that owns
 * the file-picker wiring. The command palette (and anyone else) fires one of
 * these subjects; `HomeComponent` subscribes and drives the actual flow.
 */
@Injectable({ providedIn: 'root' })
export class ImportIntentsService {
  private postmanSubject = new Subject<void>();
  private openApiSubject = new Subject<void>();
  private curlSubject = new Subject<void>();
  private importBatchFilesSubject = new Subject<void>();
  private importFromFolderSubject = new Subject<ReadImportFolderOptions | undefined>();

  triggerPostmanImport() { this.postmanSubject.next(); }
  triggerOpenApiImport() { this.openApiSubject.next(); }
  triggerCurlImport() { this.curlSubject.next(); }
  /** Open multi-select file dialog for Postman, OpenAPI, and Workbench JSON. */
  triggerImportBatchFiles() { this.importBatchFilesSubject.next(); }
  /**
   * Open folder import. Pass options for recursive scan, max depth, etc.
   * `undefined` uses defaults (this folder only, up to 500 files).
   */
  triggerImportFromFolder(options?: ReadImportFolderOptions) {
    this.importFromFolderSubject.next(options);
  }

  postman$(): Observable<void> { return this.postmanSubject.asObservable(); }
  openApi$(): Observable<void> { return this.openApiSubject.asObservable(); }
  curl$(): Observable<void> { return this.curlSubject.asObservable(); }
  importBatchFiles$(): Observable<void> { return this.importBatchFilesSubject.asObservable(); }
  importFromFolder$(): Observable<ReadImportFolderOptions | undefined> {
    return this.importFromFolderSubject.asObservable();
  }
}
