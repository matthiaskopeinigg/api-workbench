import { ChangeDetectionStrategy, ChangeDetectorRef, Component, HostListener, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';
import { ShortcutEntry, ShortcutsPanelService } from '@core/commands/shortcuts-panel.service';
import { KeyboardShortcutsService } from '@core/keyboard/keyboard-shortcuts.service';
import { KEYBOARD_SHORTCUT_CATALOG } from '@core/keyboard/keyboard-shortcut-catalog';

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
  private unregisterShortcutsToggle?: () => void;

  constructor(
    private panelService: ShortcutsPanelService,
    private cdr: ChangeDetectorRef,
    private keyboardShortcuts: KeyboardShortcutsService,
  ) {}

  ngOnInit(): void {
    this.unregisterShortcutsToggle = this.keyboardShortcuts.register('global.shortcutsPanelToggle', () => {
      this.panelService.toggle();
      return true;
    });

    const catalogEntries: ShortcutEntry[] = KEYBOARD_SHORTCUT_CATALOG.map((d) => ({
      keys: this.formatChordForDisplay(this.keyboardShortcuts.effectiveChord(d.id)),
      description: d.label,
      category: d.category,
    }));
    const extra: ShortcutEntry[] = [
      { keys: 'Esc', description: 'Close dialog / palette / overlay', category: 'Global' },
      { keys: 'Enter', description: 'Run highlighted command / send request', category: 'General' },
      { keys: '↑ / ↓', description: 'Navigate lists in palette & dropdowns', category: 'Navigation' },
    ];
    const grouped = new Map<string, ShortcutEntry[]>();
    for (const entry of [...catalogEntries, ...extra]) {
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
    this.unregisterShortcutsToggle?.();
  }

  @HostListener('document:keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    if (this.isOpen && event.key === 'Escape') {
      event.preventDefault();
      this.panelService.close();
    }
  }

  /** Turn Mod+KeyK into Ctrl+KeyK / ⌘+KeyK style for the reference panel. */
  private formatChordForDisplay(chord: string): string {
    if (typeof navigator !== 'undefined' && /Mac|iPhone|iPod|iPad/i.test(navigator.platform)) {
      return chord.replace(/Mod\+/g, '⌘').replace(/Alt\+/g, '⌥').replace(/Shift\+/g, '⇧');
    }
    return chord.replace(/Mod\+/g, 'Ctrl+');
  }

  close(): void {
    this.panelService.close();
  }

  trackByCategory = (_i: number, g: { category: string }) => g.category;
  trackByEntry = (_i: number, e: ShortcutEntry) => `${e.category}-${e.keys}`;
}
