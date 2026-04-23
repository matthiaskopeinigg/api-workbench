import { ChangeDetectionStrategy, Component, HostListener, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { toSignal } from '@angular/core/rxjs-interop';
import { ConfirmDialogService, type ConfirmDialogOpenState } from './confirm-dialog.service';

@Component({
  selector: 'app-confirm-dialog-host',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './confirm-dialog-host.component.html',
  styleUrl: './confirm-dialog-host.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConfirmDialogHostComponent {
  private readonly confirmDialog = inject(ConfirmDialogService);

  readonly active = toSignal(this.confirmDialog.active$, { initialValue: null });

  payload(): ConfirmDialogOpenState | null {
    const a = this.active();
    return a?.payload ?? null;
  }

  onBackdrop(event: MouseEvent): void {
    if (event.target !== event.currentTarget) {
      return;
    }
    this.confirmDialog.finish(false);
  }

  onConfirm(): void {
    this.confirmDialog.finish(true);
  }

  onCancel(): void {
    this.confirmDialog.finish(false);
  }

  @HostListener('document:keydown', ['$event'])
  onDocumentKeydown(ev: KeyboardEvent): void {
    if (!this.active()) {
      return;
    }
    if (ev.key === 'Escape') {
      ev.preventDefault();
      this.confirmDialog.finish(false);
    }
  }
}
