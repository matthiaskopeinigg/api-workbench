import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AwDatePipe } from '../../shared/pipes/aw-date.pipe';
import { RequestHistory, RequestHistoryEntry } from '@models/request-history';
import { HttpMethod } from '@models/request';
import { RequestHistoryService } from '@core/http/request-history.service';
import { SessionService } from '@core/session/session.service';
import { TabItem, TabService, TabType } from '@core/tabs/tab.service';
import { Subject, takeUntil } from 'rxjs';

interface HistoryGroup {
  
  dateKey: string;

  
  entries: RequestHistoryEntry[];

  
  collapsed: boolean;

  
  displayLabel: string;
}

@Component({
  selector: 'app-history',
  standalone: true,
  imports: [CommonModule, AwDatePipe],
  templateUrl: './history.component.html',
  styleUrls: ['./history.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class HistoryComponent implements OnInit, OnDestroy {

  history: RequestHistory | null = null;
  groupedHistory: HistoryGroup[] = [];
  selected: RequestHistoryEntry | null = null;
  HttpMethod = HttpMethod;

  private destroy$ = new Subject<void>();

  constructor(private requestHistoryService: RequestHistoryService,
    private sessionService: SessionService,
    private tabService: TabService,
    private cdr: ChangeDetectorRef) { }

  async ngOnInit() {
    await this.loadHistory();
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private async loadHistory() {
    this.requestHistoryService.getHistoryObservable()
      .pipe(takeUntil(this.destroy$))
      .subscribe(history => {
        this.history = history;
        this.groupHistory();
        this.loadStates();
        this.cdr.markForCheck();
      });

    await this.loadSelectedHistoryEntry();
    await this.loadListeners();
  }

  private loadStates() {
    const collapsedState = this.sessionService.get<Record<string, boolean>>('collapsedHistory');
    if (collapsedState) {
      this.groupedHistory.forEach(g => {
        g.collapsed = collapsedState[g.dateKey] ?? false;
      });
    }
  }

  private async loadSelectedHistoryEntry() {
    const selectedTab = this.tabService.getSelectedTab();
    if (!selectedTab || !this.tabService.isRequestHistoryEntryTab(selectedTab)) {
      return;
    }

    const selectedEnvironment = this.requestHistoryService.getEntryById(selectedTab.id);
    if (selectedEnvironment) {
      await this.select(selectedEnvironment);
    }
  }

  private async loadListeners() {
    this.requestHistoryService.getSelectedHistoryEntryAsObservable()
      .pipe(takeUntil(this.destroy$))
      .subscribe(selectedTab => {
        if (!selectedTab) {
          this.selected = null;
          this.cdr.markForCheck();
          return;;
        }

        const selectedRequestHistoryEntryId = selectedTab.id;
        const selectedRequestHistoryEntry = this.requestHistoryService.getEntryById(selectedRequestHistoryEntryId);
        if (!selectedRequestHistoryEntry) {
          return;
        }

        this.selected = selectedRequestHistoryEntry;
        this.cdr.markForCheck();
      });
  }

  trackById(index: number, item: any): string {
    return item.id || index.toString();
  }

  getElapsedTime(entry: RequestHistoryEntry): string {
    const diff = entry.response.receivedAt.getTime() - entry.createdAt.getTime();
    if (diff < 1000) return `${diff} ms`;
    return `${(diff / 1000).toFixed(2)} s`;
  }

  allCollapsed(): boolean {
    return this.groupedHistory.every(g => g.collapsed);
  }

  async collapseAll() {
    const anyExpanded = this.groupedHistory.some(g => !g.collapsed);
    this.groupedHistory.forEach(g => g.collapsed = anyExpanded);

    const state: Record<string, boolean> = {};
    this.groupedHistory.forEach(g => state[g.dateKey] = g.collapsed);
    await this.sessionService.save('collapsedHistory', state);
  }

  groupHistory() {
    const groups: { [key: string]: RequestHistoryEntry[] } = {};
    const entries: RequestHistoryEntry[] = this.history?.entries || [];

    entries.forEach(entry => {
      const date = new Date(entry.createdAt);
      const dateKey = date.toISOString().split('T')[0]; 

      if (!groups[dateKey]) groups[dateKey] = [];
      groups[dateKey].push(entry);
    });

    const now = new Date();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    Object.values(groups).forEach(list => {
      list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    });

    this.groupedHistory = Object.keys(groups)
      .sort((a, b) => new Date(groups[b][0].createdAt).getTime() - new Date(groups[a][0].createdAt).getTime())
      .map(dateKey => {
        const date = new Date(dateKey);
        let displayLabel: string;

        if (date.toDateString() === now.toDateString()) displayLabel = 'Today';
        else if (date.toDateString() === yesterday.toDateString()) displayLabel = 'Yesterday';
        else displayLabel = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

        return {
          dateKey,
          entries: groups[dateKey],
          collapsed: false,
          displayLabel
        };
      });
  }

  async toggleGroup(group: HistoryGroup) {
    group.collapsed = !group.collapsed;

    const state: Record<string, boolean> = {};
    this.groupedHistory.forEach(g => state[g.dateKey] = g.collapsed);
    await this.sessionService.save('collapsedHistory', state);
  }

  async select(historyEntry: RequestHistoryEntry) {
    this.selected = historyEntry;

    const tabItem: TabItem = {
      id: historyEntry.id,
      title: this.createTitle(historyEntry),
      type: TabType.REQUEST_HISTORY_ENTRY
    };
    await this.requestHistoryService.selectHistoryEntry(tabItem);
  }

  createTitle(requestHistoryEntry: RequestHistoryEntry) {
    const date = requestHistoryEntry.createdAt;
    const now = new Date();

    const isToday =
      date.toDateString() === now.toDateString();

    const yesterday = new Date();
    yesterday.setDate(now.getDate() - 1);

    const isYesterday =
      date.toDateString() === yesterday.toDateString();

    const time = date.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit'
    });

    let dayLabel: string;

    if (isToday) dayLabel = "Today";
    else if (isYesterday) dayLabel = "Yesterday";
    else {
      dayLabel = date.toLocaleDateString([], {
        month: 'short',
        day: 'numeric'
      });
    }

    return `${HttpMethod[requestHistoryEntry.request.httpMethod]} • ${requestHistoryEntry.request.url} • ${dayLabel} • ${time}`;
  }

  async clearHistory() {
    this.history = null;
    this.groupedHistory = [];
    await this.requestHistoryService.saveHistory({ entries: [] });
    await this.sessionService.save('collapsedHistory', {});
    this.cdr.markForCheck();
  }

  getMethodColor(method: HttpMethod) {
    switch (method) {
      case HttpMethod.GET: return '#4CAF50';
      case HttpMethod.POST: return '#2196F3';
      case HttpMethod.PUT: return '#FFC107';
      case HttpMethod.DELETE: return '#F44336';
      default: return '#aaa';
    }
  }

}

