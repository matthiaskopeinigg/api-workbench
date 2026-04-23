import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  OnDestroy,
  OnInit,
  Output,
  NgZone,
  ChangeDetectorRef
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { SidebarItem } from './sidebar-item';
import { EnvironmentComponent } from './environment/environment.component';
import { CollectionComponent } from './collection/collection.component';
import { HistoryComponent } from './history/history.component';
import { TestsComponent } from './tests/tests.component';
import { Subject, takeUntil } from 'rxjs';
import { CollectionService } from '@core/collection/collection.service';
import { SessionService } from '@core/session/session.service';
import { SettingsService } from '@core/settings/settings.service';
import { TabService } from '@core/tabs/tab.service';
import { FormsModule } from '@angular/forms';
import { HelpDialogComponent } from './help-dialog/help-dialog.component';

@Component({
  selector: 'app-sidebar',
  imports: [CommonModule, FormsModule, HelpDialogComponent],
  templateUrl: './sidebar.component.html',
  styleUrl: './sidebar.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SidebarComponent implements OnInit, OnDestroy {
  @Output() secondaryToggled = new EventEmitter<boolean>();

  items: SidebarItem[] = [
    {
      label: 'Collections',
      icon: 'M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8z',
      component: CollectionComponent,
    },
    {
      label: 'Environments',
      icon: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 18c-1.1 0-2.13-.18-3.1-.51a14.5 14.5 0 0 0 1.41-4.49h3.38a14.5 14.5 0 0 0 1.41 4.49A8 8 0 0 1 12 20zm-3.5-7c-.07-.65-.11-1.32-.11-2s.04-1.35.11-2h7c.07.65.11 1.32.11 2s-.04 1.35-.11 2zM4 12c0-.69.07-1.36.2-2h2.34c-.06.65-.1 1.32-.1 2s.04 1.35.1 2H4.2c-.13-.64-.2-1.31-.2-2zm15.8-2c.13.64.2 1.31.2 2s-.07 1.36-.2 2h-2.34c.06-.65.1-1.32.1-2s-.04-1.35-.1-2zM12 4c1.1 0 2.13.18 3.1.51a14.5 14.5 0 0 0-1.41 4.49h-3.38a14.5 14.5 0 0 0-1.41-4.49A8 8 0 0 1 12 4z',
      component: EnvironmentComponent,
    },
    {
      label: 'Tests',
      icon: 'M9 3h6v2h-1v3.586l4.707 7.243A2 2 0 0 1 16.984 19H7.016a2 2 0 0 1-1.723-3.171L10 8.586V5H9V3z',
      component: TestsComponent,
    },
  ];

  /**
   * Entries pinned to the bottom of the activity strip, below the main list.
   * Order: Mock Server → History → Help.
   */
  toolItems: SidebarItem[] = [
    {
      label: 'Mock Server',
      icon: 'M4 4h16v3H4V4zm0 5h16v3H4V9zm0 5h16v3H4v-3z',
      component: null,
      action: () => this.tabService.openMockServerTab(),
    },
    {
      label: 'History',
      icon: 'M13 3a9 9 0 1 0 8.94 10H20a7 7 0 1 1-2.05-5.95L15 10h7V3l-2.36 2.36A9 9 0 0 0 13 3zm-1 5v5l4.28 2.54.72-1.21L13.5 12V8z',
      component: HistoryComponent,
    },
    {
      label: 'Help',
      icon:
        'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17h-2v-2h2v2zm2.07-7.75l-.9.92C13.45 12.9 13 13.5 13 15h-2v-.5c0-1.1.45-2.1 1.17-2.83l1.24-1.26c.37-.36.59-.86.59-1.41 0-1.1-.9-2-2-2s-2 .9-2 2H8c0-2.21 1.79-4 4-4s4 1.79 4 4c0 .88-.36 1.68-.93 2.25z',
      component: null,
      action: () => this.openHelp(),
    },
  ];

  collapsed = true;
  selectedItem: SidebarItem | null = null;
  showHelp = false;
  private destroy$ = new Subject<void>();

  private static readonly SIDEBAR_VIEW_KEY = 'sidebarView';
  private static readonly SIDEBAR_WIDTH_KEY = 'secondarySidebarWidth';

  get isCompact(): boolean {
    return this.settingsService.getSettings().ui?.compactMode ?? false;
  }

  private skipNextClose = false;

  /** Find a nav entry by label in the main list or the bottom tool strip. */
  private findItemByLabel(label: string): SidebarItem | undefined {
    return this.items.find((i) => i.label === label) ?? this.toolItems.find((i) => i.label === label);
  }

  /** Set which strip entry is active; `null` clears all highlights. */
  private setActiveItem(item: SidebarItem | null): void {
    this.items.forEach((i) => (i.active = item !== null && i === item));
    this.toolItems.forEach((i) => (i.active = item !== null && i === item));
  }

  secondarySidebarWidth = 300;
  isResizing = false;

  constructor(
    private elRef: ElementRef,
    private collectionService: CollectionService,
    private sessionService: SessionService,
    private zone: NgZone,
    private cdr: ChangeDetectorRef,
    private settingsService: SettingsService,
    private tabService: TabService
  ) { }

  async ngOnInit() {
    this.collectionService.getCreateNewCollectionObservable()
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        this.zone.run(() => {
          this.skipNextClose = true;
          this.openSidebarByLabel('Collections');
          this.cdr.markForCheck();
        });
      });

    await this.restoreSavedView();
    this.cdr.markForCheck();
  }

  private async restoreSavedView(): Promise<void> {
    await this.sessionService.load(SidebarComponent.SIDEBAR_WIDTH_KEY);
    await this.sessionService.load(SidebarComponent.SIDEBAR_VIEW_KEY);

    const savedWidth = this.sessionService.get<number>(SidebarComponent.SIDEBAR_WIDTH_KEY);
    if (typeof savedWidth === 'number' && savedWidth >= 240) {
      this.secondarySidebarWidth = savedWidth;
    }

    const savedView = this.sessionService.get<{ label: string | null; collapsed: boolean }>(
      SidebarComponent.SIDEBAR_VIEW_KEY,
    );
    if (!savedView || savedView.collapsed || !savedView.label) {
      this.collapsed = true;
      this.selectedItem = null;
      this.setActiveItem(null);
      return;
    }

    const item = this.findItemByLabel(savedView.label);
    if (!item) {
      this.collapsed = true;
      this.selectedItem = null;
      this.setActiveItem(null);
      return;
    }

    this.selectedItem = item;
    this.setActiveItem(item);
    this.collapsed = false;
    this.secondaryToggled.next(true);
  }

  private async persistView(): Promise<void> {
    await this.sessionService.save(SidebarComponent.SIDEBAR_VIEW_KEY, {
      label: this.selectedItem?.label ?? null,
      collapsed: this.collapsed,
    });
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  openSidebarByLabel(label: string) {
    const item = this.findItemByLabel(label);
    if (!item) return;

    this.selectedItem = item;
    this.setActiveItem(item);

    if (this.collapsed) {
      this.collapsed = false;
      this.secondaryToggled.next(true);
    }
    this.cdr.markForCheck();
    void this.persistView();
  }

  selectItemFromClick(item: SidebarItem) {
    if (item.action && !item.component) {
      try { item.action(); } catch {  }
      this.setActiveItem(null);
      item.active = true;
      setTimeout(() => { item.active = false; this.cdr.markForCheck(); }, 250);
      this.cdr.markForCheck();
      return;
    }

    if (this.selectedItem === item) {
      this.closeSecondarySidebar();
    } else {
      this.selectedItem = item;
      this.setActiveItem(item);
      if (this.collapsed) {
        this.collapsed = false;
        this.secondaryToggled.next(true);
      }
      void this.persistView();
    }
    this.cdr.markForCheck();
  }

  closeSecondarySidebar() {
    this.collapsed = true;
    this.selectedItem = null;
    this.setActiveItem(null);
    this.secondaryToggled.next(false);
    this.cdr.markForCheck();
    void this.persistView();
  }

  openHelp(): void {
    this.showHelp = true;
    this.cdr.markForCheck();
  }

  onHelpClosed(): void {
    this.showHelp = false;
    this.cdr.markForCheck();
  }

  startResizing(event: MouseEvent) {
    this.isResizing = true;
    event.preventDefault();
    event.stopPropagation();
  }

  @HostListener('document:mousemove', ['$event'])
  onMouseMove(event: MouseEvent) {
    if (this.isResizing) {
      const mainSidebarWidth = 56;
      const newWidth = event.clientX - mainSidebarWidth;

      if (newWidth < 240) {
        this.closeSecondarySidebar();
        this.isResizing = false;
        return;
      }

      if (newWidth >= 300 && newWidth < 800) {
        this.secondarySidebarWidth = newWidth;
        this.cdr.markForCheck();
      }
    }
  }

  @HostListener('document:mouseup')
  onMouseUp() {
    if (this.isResizing) {
      this.isResizing = false;
      void this.sessionService.save(SidebarComponent.SIDEBAR_WIDTH_KEY, this.secondarySidebarWidth);
    }
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) {
    if (this.isResizing) return;
    if (this.skipNextClose) {
      this.skipNextClose = false;
      return;
    }

    const clickedInside = this.elRef.nativeElement.contains(event.target);
    if (!clickedInside) {
      const settings = this.settingsService.getSettings();
      if (settings.ui?.closeSidebarOnOutsideClick !== false) {
        this.closeSecondarySidebar();
      }
    }
  }

}

