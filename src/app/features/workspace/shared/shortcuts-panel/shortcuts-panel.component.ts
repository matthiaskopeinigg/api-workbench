import { ChangeDetectionStrategy, ChangeDetectorRef, Component, HostListener, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';
import { APP_SHORTCUTS, ShortcutEntry, ShortcutsPanelService } from '@core/commands/shortcuts-panel.service';

/**
 * Modal popover that lists application keyboard shortcuts. Opened via command
 * palette or Ctrl/Cmd+/ and dismissed with Escape / backdrop click.
 */
@Component({
  selector: 'app-shortcuts-panel',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './shortcuts-panel.component.html',
  styleUrls: ['./shortcuts-panel.component.scss'],
})
export class ShortcutsPanelComponent implements OnInit, OnDestroy {
  isOpen = false;
  groups: Array<{ category: string; entries: ShortcutEntry[] }> = [];
  private sub?: Subscription;

  constructor(private panelService: ShortcutsPanelService, private cdr: ChangeDetectorRef) {}

  ngOnInit(): void {
    const grouped = new Map<string, ShortcutEntry[]>();
    for (const entry of APP_SHORTCUTS) {
      const list = grouped.get(entry.category) || [];
      list.push(entry);
      grouped.set(entry.category, list);
    }
    this.groups = Array.from(grouped.entries()).map(([category, entries]) => ({ category, entries }));

    this.sub = this.panelService.isOpen().subscribe((open) => {
      this.isOpen = open;
      this.cdr.markForCheck();
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  @HostListener('document:keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    if ((event.ctrlKey || event.metaKey) && event.key === '/') {
      event.preventDefault();
      this.panelService.toggle();
      return;
    }
    if (this.isOpen && event.key === 'Escape') {
      event.preventDefault();
      this.panelService.close();
    }
  }

  close(): void {
    this.panelService.close();
  }

  trackByCategory = (_i: number, g: { category: string }) => g.category;
  trackByEntry = (_i: number, e: ShortcutEntry) => `${e.category}-${e.keys}`;
}
