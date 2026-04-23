import { Injectable } from '@angular/core';
import { RequestHistory, RequestHistoryEntry } from '@models/request-history';
import { BehaviorSubject } from 'rxjs';
import { SessionService } from '@core/session/session.service';
import { TabItem } from '@core/tabs/tab.service';

@Injectable({
  providedIn: 'root',
})
export class RequestHistoryService {

  private historySubject = new BehaviorSubject<RequestHistory>({ entries: [] });
  private selectedHistoryEntrySubject = new BehaviorSubject<TabItem | null>(null);

  constructor(private sessionService: SessionService) {
  }

  getSelectedHistoryEntryAsObservable() {
    return this.selectedHistoryEntrySubject.asObservable();
  }

  getHistoryObservable() {
    return this.historySubject.asObservable();
  }

  async selectHistoryEntry(newRequestHistoryEntryTab: TabItem) {
    this.selectedHistoryEntrySubject.next(newRequestHistoryEntryTab);
  }

  async removeSelectedHistoryEntry() {
    this.selectedHistoryEntrySubject.next(null);
  }

  getEntryById(id: string): RequestHistoryEntry | null {
    const history = this.historySubject.getValue();
    return history.entries.find((entry: RequestHistoryEntry) => entry.id === id) || null;
  }

  async loadHistory(): Promise<void> {
    await this.sessionService.load('collapsedHistory');

    const result = await window.awElectron.getSession<RequestHistory>('requestHistory');

    if (result && Array.isArray(result.entries)) {
      const history = {
        entries: (result.entries as RequestHistoryEntry[]).map((entry: RequestHistoryEntry) => ({
          ...entry,
          createdAt: new Date(entry.createdAt),
          response: {
            ...entry.response,
            receivedAt: new Date(entry.response.receivedAt)
          }
        }))
      };
      this.historySubject.next(history);
    } else {
      this.historySubject.next({ entries: [] });
    }
  }

  getHistory(): RequestHistory {
    return this.historySubject.getValue();
  }

  async saveHistory(requestHistory: RequestHistory): Promise<void> {

    const newHistory = { ...requestHistory, entries: [...requestHistory.entries] };
    this.historySubject.next(newHistory);
    await window.awElectron.saveSession('requestHistory', requestHistory);
  }
}


