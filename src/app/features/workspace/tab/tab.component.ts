import {
  Component,
  Output,
  EventEmitter,
  ElementRef,
  ViewChild,
  OnInit,
  OnDestroy,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  HostListener
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { TabItem, tabIdForTestArtifact, TabService, TabType } from '@core/tabs/tab.service';
import { TestArtifactService } from '@core/testing/test-artifact.service';
import { ViewStateService } from '@core/session/view-state.service';
import { EnvironmentComponent } from './environment/environment.component';
import { HistoryComponent } from './history/history.component';
import { RequestComponent } from './request/request.component';
import { FolderComponent } from './folder/folder.component';
import { WebSocketComponent } from './websocket/websocket.component';
import { MockServerComponent } from './mock-server/mock-server.component';
import { LoadTestComponent } from './load-test/load-test.component';
import { TestSuiteComponent } from './test-suite/test-suite.component';
import { ContractTestComponent } from './contract-test/contract-test.component';
import { FlowComponent } from './flow/flow.component';
import { EnvironmentsService } from '@core/environments/environments.service';
import { RequestHistoryService } from '@core/http/request-history.service';
import { RequestService } from '@core/http/request.service';
import { CollectionService } from '@core/collection/collection.service';

@Component({
  selector: 'app-tab',
  imports: [
    CommonModule,
    EnvironmentComponent, HistoryComponent, RequestComponent, FolderComponent,
    WebSocketComponent, MockServerComponent,
    LoadTestComponent, TestSuiteComponent, ContractTestComponent, FlowComponent,
  ],
  templateUrl: './tab.component.html',
  styleUrls: ['./tab.component.scss'],
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host {
      display: flex;
      flex-direction: column;
      flex: 1 1 auto;
      min-height: 0;
      min-width: 0;
      overflow: hidden;
      height: 100%;
    }
  `]
})
export class TabComponent implements OnInit, OnDestroy {

  @ViewChild('tabsContainer') tabsContainer!: ElementRef<HTMLDivElement>;

  @Output() tabSizeChange = new EventEmitter<number>();

  tabs: TabItem[] = [];
  selectedTabIndex = 0;

  draggedIndex: number | null = null;
  overIndex: number | null = null;

  contextMenuVisible = false;
  contextMenuIndex = -1;
  menuX = 0;
  menuY = 0;

  canScrollLeft = false;
  canScrollRight = false;

  constructor(
    private environmentsService: EnvironmentsService,
    private tabService: TabService,
    private requestHistoryService: RequestHistoryService,
    private requestService: RequestService,
    private collectionService: CollectionService,
    private testArtifacts: TestArtifactService,
    private viewState: ViewStateService,
    private cdr: ChangeDetectorRef,
  ) {}

  async ngOnInit() {
    await this.viewState.load();
    await this.loadSavedTabs();
    this.viewState.retainOnly(this.tabs.map(t => t.id));
    await this.loadSelectedTab();
    await this.startListeners();
    setTimeout(() => {
      this.updateScrollButtons();
      this.autoScrollToSelected();
    }, 0);
    this.cdr.markForCheck();
  }

  @HostListener('window:resize')
  onResize() {
    this.updateScrollButtons();
  }

  async loadSavedTabs() {
    const savedTabs: TabItem[] = this.tabService.getActiveTabs() || [];
    for (const savedTab of savedTabs) {
      await this.addNewTab(savedTab);
    }
  }

  private async loadSelectedTab() {
    const selectedSavedTab = this.tabService.getSelectedTab();
    if (!selectedSavedTab) return;

    const selectedIndex = this.tabs.findIndex(tab => tab.id === selectedSavedTab.id);
    if (selectedIndex !== -1) {
      this.selectTab(selectedIndex);
    } else if (this.tabs.length > 0) {
      this.selectTab(0);
    }
  }

  async startListeners() {
    this.environmentsService.getSelectedEnvironmentAsObservable().subscribe(newEnvironmentTab => {
      if (!newEnvironmentTab)
        return;

      this.addNewTab(newEnvironmentTab);
      this.cdr.markForCheck();
    });

    this.requestHistoryService.getSelectedHistoryEntryAsObservable().subscribe(newRequestHistoryEntryTab => {
      if (!newRequestHistoryEntryTab)
        return;

      this.addNewTab(newRequestHistoryEntryTab);
      this.cdr.markForCheck();
    });

    this.requestService.getSelectedRequestAsObservable().subscribe(newRequestTab => {
      if (!newRequestTab)
        return;

      this.addNewTab(newRequestTab);
      this.cdr.markForCheck();
    });

    this.collectionService.getSelectedFolderAsObservable().subscribe(newFolderTab => {
      if (!newFolderTab)
        return;

      this.addNewTab(newFolderTab);
      this.cdr.markForCheck();
    });

    this.tabService.getOpenTabAsObservable().subscribe(newTab => {
      if (!newTab) return;
      this.addNewTab(newTab);
      this.cdr.markForCheck();
    });

    this.collectionService.getRequestDeletedObservable().subscribe(async (deletedRequestId) => {
      const index = this.tabs.findIndex(t => t.id === deletedRequestId);
      if (index !== -1) {
        await this.closeTab(index);
        this.cdr.markForCheck();
      }
    });

    this.collectionService.getRequestUpdatedObservable().subscribe(async (updatedRequest) => {
      const index = this.tabs.findIndex(t => t.id === updatedRequest.id);
      if (index !== -1 && this.tabs[index].title !== updatedRequest.title) {
        this.tabs[index] = { ...this.tabs[index], title: updatedRequest.title };
        this.tabs = [...this.tabs];
        await this.saveTabs();
        this.cdr.markForCheck();
      }
    });

    this.collectionService.getFolderDeletedObservable().subscribe(async (deletedFolderId) => {
      const index = this.tabs.findIndex(t => t.id === deletedFolderId);
      if (index !== -1) {
        await this.closeTab(index);
        this.cdr.markForCheck();
      }
    });

    this.collectionService.getFolderUpdatedObservable().subscribe(async (updatedFolder) => {
      const index = this.tabs.findIndex(t => t.id === updatedFolder.id);
      if (index !== -1 && this.tabs[index].title !== updatedFolder.title) {
        this.tabs[index] = { ...this.tabs[index], title: updatedFolder.title };
        this.tabs = [...this.tabs];
        await this.saveTabs();
        this.cdr.markForCheck();
      }
    });

    this.testArtifacts.getTestArtifactDeletedObservable().subscribe(async (ev) => {
      const tabId = tabIdForTestArtifact(ev.kind, ev.id);
      if (!tabId) {
        return;
      }
      const index = this.tabs.findIndex(t => t.id === tabId);
      if (index !== -1) {
        await this.closeTab(index);
        this.cdr.markForCheck();
      }
    });

    this.environmentsService.getEnvironmentDeletedObservable().subscribe(async (environmentId: string) => {
      const index = this.tabs.findIndex(t => t.id === environmentId);
      if (index !== -1) {
        await this.closeTab(index);
        this.cdr.markForCheck();
      }
    });
  }

  ngOnDestroy() {
    this.closeContextMenu();
  }

  async addNewTab(newTab: TabItem) {
    const tabIndex = this.tabs.findIndex(tab => tab.id === newTab.id);

    if (tabIndex !== -1) {
      this.selectedTabIndex = tabIndex;
      this.cdr.markForCheck();
      return;
    }

    this.tabs = [...this.tabs, newTab];
    this.selectedTabIndex = this.tabs.length - 1;
    await this.handleTabChange(newTab);
    await this.saveTabs();
    setTimeout(() => {
      this.updateScrollButtons();
      this.autoScrollToSelected();
    }, 0);
    this.cdr.markForCheck();
  }

  async saveTabs() {
    await this.tabService.saveActiveTabs(this.tabs);
  }

  private async handleTabChange(newSelectedTab: TabItem | null) {
    this.tabSizeChange.emit(this.tabs.length);
    if (!newSelectedTab) {
      await this.tabService.saveUnselectTab();
      await this.requestService.removeSelectedRequest();
      await this.environmentsService.removeSelectedEnvironment();
      await this.requestHistoryService.removeSelectedHistoryEntry();
      this.collectionService.selectFolder(null as any);
      return;
    }

    const isEnvironmentTab = this.isEnvironmentTab(newSelectedTab);
    const isHistoryEntryTab = this.isRequestHistoryEntryTab(newSelectedTab);
    const isRequestTab = this.isRequestTab(newSelectedTab);
    if (isEnvironmentTab) {
      this.environmentsService.selectEnvironment(newSelectedTab);
    } else {
      this.environmentsService.removeSelectedEnvironment();
    }

    if (isHistoryEntryTab) {
      this.requestHistoryService.selectHistoryEntry(newSelectedTab);
    } else {
      this.requestHistoryService.removeSelectedHistoryEntry();
    }

    if (isRequestTab) {
      this.requestService.selectRequest(newSelectedTab);
    } else {
      this.requestService.removeSelectedRequest();
    }

    if (this.tabService.isFolderTab(newSelectedTab)) {
      this.collectionService.selectFolder(newSelectedTab);
    } else {
      this.collectionService.selectFolder(null as any);
    }

    await this.tabService.saveSelectTab(newSelectedTab!);
  }

  isEnvironmentTab(tab: TabItem): boolean {
    return this.tabService.isEnvironmentTab(tab);
  }

  isRequestHistoryEntryTab(tab: TabItem): boolean {
    return this.tabService.isRequestHistoryEntryTab(tab);
  }

  isRequestTab(tab: TabItem): boolean {
    return this.tabService.isRequestTab(tab);
  }

  isFolderTab(tab: TabItem): boolean {
    return this.tabService.isFolderTab(tab);
  }

  isWebSocketTab(tab: TabItem): boolean {
    return this.tabService.isWebSocketTab(tab);
  }

  isMockServerTab(tab: TabItem): boolean {
    return this.tabService.isMockServerTab(tab);
  }

  isLoadTestTab(tab: TabItem): boolean {
    return this.tabService.isLoadTestTab(tab);
  }

  isTestSuiteTab(tab: TabItem): boolean {
    return this.tabService.isTestSuiteTab(tab);
  }

  isContractTestTab(tab: TabItem): boolean {
    return this.tabService.isContractTestTab(tab);
  }

  isFlowTab(tab: TabItem): boolean {
    return this.tabService.isFlowTab(tab);
  }

  selectTab(index: number) {
    this.closeContextMenu();
    this.selectedTabIndex = index;
    this.handleTabChange(this.tabs[index]);
    this.autoScrollToSelected();
    this.cdr.markForCheck();
  }

  scrollLeft() {
    if (!this.tabsContainer) return;
    const container = this.tabsContainer.nativeElement;
    container.scrollBy({ left: -200, behavior: 'smooth' });
    setTimeout(() => this.updateScrollButtons(), 300);
  }

  scrollRight() {
    if (!this.tabsContainer) return;
    const container = this.tabsContainer.nativeElement;
    container.scrollBy({ left: 200, behavior: 'smooth' });
    setTimeout(() => this.updateScrollButtons(), 300);
  }

  updateScrollButtons() {
    if (!this.tabsContainer) return;
    const container = this.tabsContainer.nativeElement;
    this.canScrollLeft = container.scrollLeft > 0;
    this.canScrollRight = container.scrollLeft < (container.scrollWidth - container.clientWidth - 1);
    this.cdr.markForCheck();
  }

  autoScrollToSelected() {
    if (!this.tabsContainer) return;

    setTimeout(() => {
      const container = this.tabsContainer.nativeElement;
      const activeTab = container.querySelector('.tab.active') as HTMLElement;

      if (activeTab) {
        const containerRect = container.getBoundingClientRect();
        const tabRect = activeTab.getBoundingClientRect();

        if (tabRect.left < containerRect.left || tabRect.right > containerRect.right) {
          activeTab.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
        }
      }
      this.updateScrollButtons();
    }, 0);
  }

  async closeTab(index: number, event?: MouseEvent) {
    if (event) event.stopPropagation();
    this.closeContextMenu();
    const tab = this.tabs[index];
    if (!tab) return;

    this.viewState.clear(tab.id);
    const newTabs = [...this.tabs];
    newTabs.splice(index, 1);
    this.tabs = [...newTabs];

    if (this.tabs.length === 0) {
      this.selectedTabIndex = 0;
      await this.handleTabChange(null);
      await this.saveTabs();
      this.cdr.markForCheck();
      return;
    }

    if (this.selectedTabIndex > index) {
      this.selectedTabIndex--;
    } else if (this.selectedTabIndex === index) {
      this.selectedTabIndex = Math.max(0, index - 1);
    }

    const newSelectedTab = this.tabs[this.selectedTabIndex];
    await this.handleTabChange(newSelectedTab).then(() => {
      this.saveTabs();
    });
    this.cdr.markForCheck();
  }

  openContextMenu(event: MouseEvent, index: number) {
    event.preventDefault();
    event.stopPropagation();
    this.contextMenuVisible = true;
    this.contextMenuIndex = index;
    this.menuX = event.clientX;
    this.menuY = event.clientY;
    this.cdr.markForCheck();
  }

  closeContextMenu() {
    this.contextMenuVisible = false;
    this.contextMenuIndex = -1;
    this.cdr.markForCheck();
  }

  async closeOtherTabs(index: number) {
    this.closeContextMenu();
    const tabToKeep = this.tabs[index];
    this.tabs = [tabToKeep];
    this.viewState.retainOnly([tabToKeep.id]);
    this.selectedTabIndex = 0;
    await this.handleTabChange(tabToKeep);
    await this.saveTabs();
    this.cdr.markForCheck();
  }

  async closeAllTabs() {
    this.closeContextMenu();
    this.tabs = [];
    this.viewState.retainOnly([]);
    this.selectedTabIndex = 0;
    await this.handleTabChange(null);
    await this.saveTabs();
    this.cdr.markForCheck();
  }

  async closeTabsToRight(index: number) {
    this.closeContextMenu();
    const wasSelectedIndex = this.selectedTabIndex;
    this.tabs = this.tabs.slice(0, index + 1);
    this.viewState.retainOnly(this.tabs.map(t => t.id));

    if (wasSelectedIndex > index) {
      this.selectedTabIndex = index;
      await this.handleTabChange(this.tabs[index]);
    }

    await this.saveTabs();
    this.cdr.markForCheck();
  }

  onDragStart(event: DragEvent, index: number) {
    this.draggedIndex = index;
    document.body.classList.add('aw-dragging');

    if (!event.dataTransfer) return;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', index.toString());

    const tab = this.tabs[index];
    const label = tab?.title ?? 'Tab';
    const ghost = document.createElement('div');
    ghost.classList.add('aw-drag-ghost', 'is-tab');
    ghost.innerHTML = `
      <span class="aw-drag-icon">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
          <polyline points="14 2 14 8 20 8"></polyline>
        </svg>
      </span>
      <span class="aw-drag-label">${this.escapeHtml(label)}</span>
    `;
    document.body.appendChild(ghost);
    event.dataTransfer.setDragImage(ghost, 18, 14);
    setTimeout(() => { if (ghost.parentNode) ghost.parentNode.removeChild(ghost); }, 0);
  }

  onDragOver(event: DragEvent, index: number) {
    event.preventDefault();
    if (this.draggedIndex === null || index === this.draggedIndex) return;
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';

    const tabEl = event.currentTarget as HTMLElement | null;
    if (!tabEl) return;
    const rect = tabEl.getBoundingClientRect();
    const midpoint = rect.left + rect.width / 2;
    const movingRight = this.draggedIndex < index;
    const crossed = movingRight ? event.clientX >= midpoint : event.clientX <= midpoint;
    if (!crossed) return;

    const firstPositions = this.captureTabPositions();

    const selectedTabId = this.tabs[this.selectedTabIndex]?.id;

    const list = [...this.tabs];
    const [moved] = list.splice(this.draggedIndex, 1);
    list.splice(index, 0, moved);
    this.tabs = list;
    this.draggedIndex = index;

    if (selectedTabId) {
      const newSelectedIndex = this.tabs.findIndex(t => t.id === selectedTabId);
      if (newSelectedIndex !== -1) {
        this.selectedTabIndex = newSelectedIndex;
      }
    }

    this.cdr.markForCheck();

    requestAnimationFrame(() => this.animateTabsFromPositions(firstPositions));
  }

  onDrop(event: DragEvent) {
    event.preventDefault();
    this.clearDragState();
    void this.persistAfterReorder();
  }

  onDragEnd() {
    this.clearDragState();
    void this.persistAfterReorder();
  }

  private async persistAfterReorder() {
    await this.saveTabs();
    const active = this.tabs[this.selectedTabIndex];
    if (active) {
      await this.tabService.saveSelectTab(active);
    }
  }

  private clearDragState() {
    this.draggedIndex = null;
    this.overIndex = null;
    document.body.classList.remove('aw-dragging');
  }

  private captureTabPositions(): Map<string, number> {
    const positions = new Map<string, number>();
    const container = this.tabsContainer?.nativeElement;
    if (!container) return positions;
    const nodes = container.querySelectorAll<HTMLElement>('.tab');
    nodes.forEach(node => {
      const id = node.getAttribute('data-tab-id');
      if (id) positions.set(id, node.getBoundingClientRect().left);
    });
    return positions;
  }

  private animateTabsFromPositions(oldPositions: Map<string, number>) {
    const container = this.tabsContainer?.nativeElement;
    if (!container) return;
    const nodes = container.querySelectorAll<HTMLElement>('.tab');
    nodes.forEach(node => {
      if (node.classList.contains('dragging')) return;
      const id = node.getAttribute('data-tab-id');
      if (!id) return;
      const previousLeft = oldPositions.get(id);
      if (previousLeft === undefined) return;
      const currentLeft = node.getBoundingClientRect().left;
      const delta = previousLeft - currentLeft;
      if (Math.abs(delta) < 1) return;
      node.animate(
        [
          { transform: `translateX(${delta}px)` },
          { transform: 'translateX(0)' }
        ],
        { duration: 220, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'none' }
      );
    });
  }

  private escapeHtml(input: string): string {
    return input
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  trackByTabId(index: number, tab: TabItem) {
    return tab.id;
  }

  protected readonly TabType = TabType;
}

