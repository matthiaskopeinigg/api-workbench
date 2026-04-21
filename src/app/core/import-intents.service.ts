import { Injectable } from '@angular/core';
import { Observable, Subject } from 'rxjs';

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

  triggerPostmanImport() { this.postmanSubject.next(); }
  triggerOpenApiImport() { this.openApiSubject.next(); }
  triggerCurlImport() { this.curlSubject.next(); }

  postman$(): Observable<void> { return this.postmanSubject.asObservable(); }
  openApi$(): Observable<void> { return this.openApiSubject.asObservable(); }
  curl$(): Observable<void> { return this.curlSubject.asObservable(); }
}
