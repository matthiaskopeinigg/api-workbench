import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  HostListener,
  Output,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { WindowService } from '@core/platform/window.service';

/**
 * In-app help: environments, variable syntax, dynamic placeholders, and mock server.
 * Opened from the activity bar via {@link SidebarComponent}.
 */
@Component({
  selector: 'app-help-dialog',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './help-dialog.component.html',

  styleUrl: './help-dialog.component.scss',
})
export class HelpDialogComponent {
  /** GitHub Wiki (enable Wiki in repo settings if the link 404s). */
  readonly wikiUrl = 'https://github.com/matthiaskopeinigg/api-workbench/wiki';

  @Output() closed = new EventEmitter<void>();

  constructor(private windowService: WindowService) {}

  /** Opens the wiki in the default browser (Electron: `shell.openExternal`, not an in-app window). */
  onWikiLinkClick(event: Event): void {
    event.preventDefault();
    this.windowService.openUrlInSystemBrowser(this.wikiUrl);
  }

  onBackdrop(_event: MouseEvent): void {
    this.close();
  }

  close(): void {
    this.closed.emit();
  }

  @HostListener('document:keydown', ['$event'])
  onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      this.close();
    }
  }
}
