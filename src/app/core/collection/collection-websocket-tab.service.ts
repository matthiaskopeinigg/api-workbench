import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import type { TabItem } from '@core/tabs/tab.service';

/**
 * Selection channel for opening a saved WebSocket/SSE row from the collection sidebar.
 * Mirrors {@link RequestService} selection so {@link TabComponent} can open/focus tabs the same way.
 */
@Injectable({ providedIn: 'root' })
export class CollectionWebSocketTabService {
  private readonly selectedSubject = new BehaviorSubject<TabItem | null>(null);

  getSelectedWebSocketTabAsObservable() {
    return this.selectedSubject.asObservable();
  }

  selectWebSocketTab(tab: TabItem): void {
    this.selectedSubject.next(tab);
  }

  clearSelectedWebSocketTab(): void {
    this.selectedSubject.next(null);
  }
}
