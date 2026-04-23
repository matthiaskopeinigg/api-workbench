import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  OnInit,
  ViewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import {
  Command,
  CommandRegistryService,
  searchCommands,
  CommandSearchResult,
} from '@core/commands/command-registry.service';
import { KeyboardShortcutsService } from '@core/keyboard/keyboard-shortcuts.service';

/**
 * Global command palette. Opens with Ctrl/Cmd+K, closes with Escape. All
 * commands are sourced from `CommandRegistryService`; filtering uses the
 * subsequence-based fuzzy scorer. Up/Down navigates, Enter runs.
 */
@Component({
  selector: 'app-command-palette',
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './command-palette.component.html',
  styleUrl: './command-palette.component.scss',
})
export class CommandPaletteComponent implements OnInit, OnDestroy {
  isOpen = false;
  query = '';
  results: CommandSearchResult[] = [];
  activeIndex = 0;

  private commands: Command[] = [];
  private sub?: Subscription;
  private unregisterPaletteShortcut?: () => void;

  @ViewChild('paletteInput') paletteInput?: ElementRef<HTMLInputElement>;

  constructor(
    private registry: CommandRegistryService,
    private cdr: ChangeDetectorRef,
    private keyboard: KeyboardShortcutsService,
  ) {}

  ngOnInit(): void {
    this.unregisterPaletteShortcut = this.keyboard.register('global.commandPaletteToggle', () => {
      this.isOpen ? this.close() : this.open();
      return true;
    });
    this.sub = this.registry.commands$.subscribe(cmds => {
      this.commands = cmds;
      if (this.isOpen) {
        this.updateResults();
      }
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
    this.unregisterPaletteShortcut?.();
  }

  open() {
    this.isOpen = true;
    this.query = '';
    this.activeIndex = 0;
    this.updateResults();
    this.cdr.markForCheck();
    setTimeout(() => this.paletteInput?.nativeElement.focus(), 0);
  }

  close() {
    this.isOpen = false;
    this.cdr.markForCheck();
  }

  onQueryChange() {
    this.activeIndex = 0;
    this.updateResults();
  }

  setActive(i: number) {
    this.activeIndex = i;
    this.cdr.markForCheck();
  }

  async runActive() {
    const picked = this.results[this.activeIndex];
    if (!picked) return;
    this.close();
    try {
      await picked.command.run();
    } catch (err) {
      console.error('Command failed:', picked.command.id, err);
    }
  }

  async runAt(index: number) {
    this.activeIndex = index;
    await this.runActive();
  }

  @HostListener('document:keydown', ['$event'])
  onDocumentKeydown(event: KeyboardEvent) {
    if (!this.isOpen) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      this.close();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (this.results.length > 0) {
        this.activeIndex = (this.activeIndex + 1) % this.results.length;
        this.cdr.markForCheck();
      }
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (this.results.length > 0) {
        this.activeIndex = (this.activeIndex - 1 + this.results.length) % this.results.length;
        this.cdr.markForCheck();
      }
    } else if (event.key === 'Enter') {
      event.preventDefault();
      void this.runActive();
    }
  }

  private updateResults() {
    this.results = searchCommands(this.query, this.commands).slice(0, 50);
    this.cdr.markForCheck();
  }
}
