import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';

export interface ShortcutEntry {
  keys: string;
  description: string;
  category: string;
}

@Injectable({ providedIn: 'root' })
export class ShortcutsPanelService {
  private readonly open$ = new BehaviorSubject<boolean>(false);

  isOpen(): Observable<boolean> {
    return this.open$.asObservable();
  }

  getSnapshot(): boolean {
    return this.open$.value;
  }

  open(): void {
    this.open$.next(true);
  }

  close(): void {
    this.open$.next(false);
  }

  toggle(): void {
    this.open$.next(!this.open$.value);
  }
}
