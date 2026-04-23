import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
  ViewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { TabItem, TabService, TabType } from '@core/tabs/tab.service';
import type { SplitOrientation, WorkspacePaneId } from '@core/tabs/workspace-tabs.model';
import { WORKBENCH_TAB_DND_MIME } from '@core/tabs/workbench-tab-dnd.mime';
import { EnvironmentComponent } from '../environment/environment.component';
import { HistoryComponent } from '../history/history.component';
import { RequestComponent } from '../request/request.component';
import { FolderComponent } from '../folder/folder.component';
import { WebSocketComponent } from '../websocket/websocket.component';
import { MockServerComponent } from '../mock-server/mock-server.component';
import { LoadTestComponent } from '../load-test/load-test.component';
import { TestSuiteComponent } from '../test-suite/test-suite.component';
import { ContractTestComponent } from '../contract-test/contract-test.component';
import { FlowComponent } from '../flow/flow.component';

@Component({
  selector: 'app-tab-pane',
  imports: [
    CommonModule,
    EnvironmentComponent,
    HistoryComponent,
    RequestComponent,
    FolderComponent,
    WebSocketComponent,
    MockServerComponent,
    LoadTestComponent,
    TestSuiteComponent,
    ContractTestComponent,
    FlowComponent,
  ],
  templateUrl: './tab-pane.component.html',
  styleUrls: ['./tab-pane.component.scss'],
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TabPaneComponent implements OnDestroy, OnChanges {
  @ViewChild('tabsContainer') tabsContainer!: ElementRef<HTMLDivElement>;

  @Input({ required: true }) paneId!: WorkspacePaneId;
  @Input() tabs: TabItem[] = [];
  @Input() selectedTabIndex = 0;
  /** When true, this pane received the last workspace focus (outline). */
  @Input() isFocused = false;
  @Input() splitMode = false;
  @Input() splitOrientation: SplitOrientation = 'horizontal';
  /** Null = use global active environment (request editor). */
  @Input() paneEnvironmentOverrideId: string | null = null;

  @Output() paneMouseDown = new EventEmitter<WorkspacePaneId>();
  @Output() selectTabIndex = new EventEmitter<number>();
  @Output() tabClose = new EventEmitter<number>();
  @Output() tabsReorder = new EventEmitter<{ tabs: TabItem[]; selectedTabIndex: number }>();
  @Output() persistReorder = new EventEmitter<void>();
  @Output() closeOtherTabs = new EventEmitter<number>();
  @Output() closeTabsToRight = new EventEmitter<number>();
  @Output() closeAllTabsInPane = new EventEmitter<void>();
  @Output() splitRight = new EventEmitter<number>();
  @Output() splitLeft = new EventEmitter<number>();
  @Output() mergeSplit = new EventEmitter<void>();
  @Output() crossPaneTabMove = new EventEmitter<{
    fromPane: WorkspacePaneId;
    fromIndex: number;
    toPane: WorkspacePaneId;
  }>();
  @Output() paneEnvironmentOverrideChange = new EventEmitter<{
    paneId: WorkspacePaneId;
    environmentId: string | null;
  }>();
  @Output() tabDirtyChange = new EventEmitter<{ tabId: string; dirty: boolean }>();
  @Output() duplicateRequestTab = new EventEmitter<number>();
  @Output() pinToggleTab = new EventEmitter<number>();
  @Output() toggleSplitOrientation = new EventEmitter<void>();

  draggedIndex: number | null = null;
  /** Drag preview node for setDragImage; removed on drag end (see clearDragState). */
  private tabDragGhostEl: HTMLElement | null = null;

  contextMenuVisible = false;
  contextMenuIndex = -1;
  menuX = 0;
  menuY = 0;

  canScrollLeft = false;
  canScrollRight = false;

  constructor(
    private tabService: TabService,
    private cdr: ChangeDetectorRef,
  ) {}

  ngOnChanges(_changes: SimpleChanges) {
    setTimeout(() => {
      this.updateScrollButtons();
      this.autoScrollToSelected();
    }, 0);
  }

  @HostListener('window:resize')
  onResize() {
    this.updateScrollButtons();
  }

  ngOnDestroy() {
    this.closeContextMenu();
    this.clearDragState();
  }

  /**
   * If the draggable node is recreated during reorder, `dragend` may not run; clear on any
   * primary-button release while this pane still thinks a tab drag is active.
   */
  @HostListener('window:mouseup', ['$event'])
  onWindowMouseUp(event: MouseEvent): void {
    if (event.button !== 0) return;
    if (this.draggedIndex === null && !this.tabDragGhostEl) return;
    this.clearDragState();
    this.persistReorder.emit();
  }

  onPaneSurfaceMouseDown() {
    this.paneMouseDown.emit(this.paneId);
  }

  selectTab(index: number) {
    this.closeContextMenu();
    this.selectTabIndex.emit(index);
    setTimeout(() => {
      this.updateScrollButtons();
      this.autoScrollToSelected();
    }, 0);
    this.cdr.markForCheck();
  }

  scrollLeft() {
    if (!this.tabsContainer) return;
    this.tabsContainer.nativeElement.scrollBy({ left: -200, behavior: 'smooth' });
    setTimeout(() => this.updateScrollButtons(), 300);
  }

  scrollRight() {
    if (!this.tabsContainer) return;
    this.tabsContainer.nativeElement.scrollBy({ left: 200, behavior: 'smooth' });
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

  requestCloseTab(index: number, event?: MouseEvent) {
    if (event) event.stopPropagation();
    this.closeContextMenu();
    this.tabClose.emit(index);
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

  emitCloseOtherTabs() {
    const i = this.contextMenuIndex;
    this.closeContextMenu();
    if (i >= 0) this.closeOtherTabs.emit(i);
  }

  emitCloseTabsToRight() {
    const i = this.contextMenuIndex;
    this.closeContextMenu();
    if (i >= 0) this.closeTabsToRight.emit(i);
  }

  emitCloseAllTabs() {
    this.closeContextMenu();
    this.closeAllTabsInPane.emit();
  }

  emitSplitRight() {
    const i = this.contextMenuIndex;
    this.closeContextMenu();
    if (i >= 0) this.splitRight.emit(i);
  }

  emitSplitLeft() {
    const i = this.contextMenuIndex;
    this.closeContextMenu();
    if (i >= 0) this.splitLeft.emit(i);
  }

  emitMergeSplit() {
    this.closeContextMenu();
    this.mergeSplit.emit();
  }

  onDragStart(event: DragEvent, index: number) {
    this.disposeTabDragGhost();
    if (!event.dataTransfer) return;
    this.draggedIndex = index;
    document.body.classList.add('aw-dragging');
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', `${this.paneId}:${index}`);
    try {
      event.dataTransfer.setData(
        WORKBENCH_TAB_DND_MIME,
        JSON.stringify({ paneId: this.paneId, index }),
      );
    } catch {
      /* setData may throw for custom MIME in some browsers */
      this.clearDragState();
      return;
    }
    const tab = this.tabs[index];
    const label = tab?.title ?? 'Tab';
    const ghost = document.createElement('div');
    this.tabDragGhostEl = ghost;
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
    this.draggedIndex = index;
    let nextSelected = this.selectedTabIndex;
    if (selectedTabId) {
      const newSelectedIndex = list.findIndex(t => t.id === selectedTabId);
      if (newSelectedIndex !== -1) {
        nextSelected = newSelectedIndex;
      }
    }
    this.tabsReorder.emit({ tabs: list, selectedTabIndex: nextSelected });
    this.cdr.markForCheck();
    requestAnimationFrame(() => this.animateTabsFromPositions(firstPositions));
  }

  onDrop(event: DragEvent) {
    event.preventDefault();
    const raw = event.dataTransfer?.getData(WORKBENCH_TAB_DND_MIME);
    if (raw && this.splitMode) {
      try {
        const data = JSON.parse(raw) as { paneId: WorkspacePaneId; index: number };
        if (data.paneId !== this.paneId) {
          this.crossPaneTabMove.emit({
            fromPane: data.paneId,
            fromIndex: data.index,
            toPane: this.paneId,
          });
          this.clearDragState();
          this.persistReorder.emit();
          return;
        }
      } catch {
        /* same-pane reorder */
      }
    }
    this.clearDragState();
    this.persistReorder.emit();
  }

  onTabsStripDragOver(event: DragEvent) {
    const types = event.dataTransfer?.types;
    if (!types || !Array.from(types).includes(WORKBENCH_TAB_DND_MIME)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  }

  onTabsStripDrop(event: DragEvent) {
    const raw = event.dataTransfer?.getData(WORKBENCH_TAB_DND_MIME);
    if (!raw) {
      this.clearDragState();
      return;
    }
    let data: { paneId: WorkspacePaneId; index: number };
    try {
      data = JSON.parse(raw) as { paneId: WorkspacePaneId; index: number };
    } catch {
      this.clearDragState();
      return;
    }

    if (this.splitMode && data.paneId !== this.paneId) {
      event.preventDefault();
      this.crossPaneTabMove.emit({
        fromPane: data.paneId,
        fromIndex: data.index,
        toPane: this.paneId,
      });
      this.clearDragState();
      this.persistReorder.emit();
      return;
    }

    /** Unsplit: drop on tab strip opens a split (left / right third), same as context menu. */
    if (!this.splitMode && data.paneId === this.paneId) {
      const strip = this.tabsContainer?.nativeElement;
      const rect = strip?.getBoundingClientRect();
      if (!strip || !rect || rect.width < 24) {
        this.clearDragState();
        this.persistReorder.emit();
        return;
      }
      const x = event.clientX - rect.left;
      const w3 = rect.width / 3;
      event.preventDefault();
      if (x < w3) {
        this.splitLeft.emit(data.index);
      } else {
        this.splitRight.emit(data.index);
      }
      this.clearDragState();
      this.persistReorder.emit();
      return;
    }

    if (this.splitMode && data.paneId === this.paneId) {
      event.preventDefault();
      this.clearDragState();
      this.persistReorder.emit();
    }
  }

  emitPaneEnvOverride(environmentId: string | null) {
    this.paneEnvironmentOverrideChange.emit({ paneId: this.paneId, environmentId });
  }

  emitTabDirty(tabId: string, dirty: boolean) {
    this.tabDirtyChange.emit({ tabId, dirty });
  }

  emitDuplicateRequest() {
    const i = this.contextMenuIndex;
    this.closeContextMenu();
    if (i >= 0) this.duplicateRequestTab.emit(i);
  }

  emitPinToggle() {
    const i = this.contextMenuIndex;
    this.closeContextMenu();
    if (i >= 0) this.pinToggleTab.emit(i);
  }

  emitToggleSplitOrientation() {
    this.closeContextMenu();
    this.toggleSplitOrientation.emit();
  }

  contextMenuTabPinned(): boolean {
    const t = this.tabs[this.contextMenuIndex];
    return !!t?.pinned;
  }

  contextMenuTabIsRequest(): boolean {
    const t = this.tabs[this.contextMenuIndex];
    return !!t && this.tabService.isRequestTab(t);
  }

  onDragEnd() {
    this.clearDragState();
    this.persistReorder.emit();
  }

  private clearDragState() {
    const ownedChrome = this.draggedIndex !== null || this.tabDragGhostEl !== null;
    this.draggedIndex = null;
    this.disposeTabDragGhost();
    if (ownedChrome) {
      document.body.classList.remove('aw-dragging');
    }
    this.cdr.markForCheck();
  }

  private disposeTabDragGhost(): void {
    const g = this.tabDragGhostEl;
    this.tabDragGhostEl = null;
    if (g?.parentNode) {
      g.parentNode.removeChild(g);
    }
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
        [{ transform: `translateX(${delta}px)` }, { transform: 'translateX(0)' }],
        { duration: 220, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'none' },
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

  trackByTabId(_index: number, tab: TabItem) {
    return tab.id;
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

  protected readonly TabType = TabType;
}
