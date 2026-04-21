import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { Collection, Folder } from '@models/collection';

export interface RunnerDialogRequest {
  source: Collection | Folder;
  sourceLabel: string;
}

/**
 * Tiny pub/sub for showing the runner dialog from any component. The dialog
 * itself lives near the root of the app so commands/context menus can trigger
 * it without knowing about component trees.
 */
@Injectable({ providedIn: 'root' })
export class RunnerDialogService {
  private subject = new BehaviorSubject<RunnerDialogRequest | null>(null);

  open$(): Observable<RunnerDialogRequest | null> { return this.subject.asObservable(); }

  open(source: Collection | Folder, sourceLabel?: string) {
    this.subject.next({ source, sourceLabel: sourceLabel || source.title });
  }

  close() { this.subject.next(null); }
}
