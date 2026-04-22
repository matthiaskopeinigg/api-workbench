import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import {
  BatchImportDialogService,
  BatchImportDialogState,
} from '@core/batch-import-dialog.service';
import {
  buildPreviewRows,
  formatBatchImportSummary,
} from '@core/import-batch.service';
import type { BatchMergeMode } from '@core/import-batch.service';

@Component({
  selector: 'app-batch-import-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './batch-import-dialog.component.html',
  styleUrl: './batch-import-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BatchImportDialogComponent implements OnInit, OnDestroy {
  state: BatchImportDialogState | null = null;
  mergeModes: { id: BatchMergeMode; label: string; hint: string }[] = [
    { id: 'flat', label: 'Flat into root', hint: 'Requests and folders merge into the sidebar root' },
    {
      id: 'folderPerFile',
      label: 'One folder per file',
      hint: 'Each file becomes a folder under root (cleaner for many imports)',
    },
    {
      id: 'flatWithPrefix',
      label: 'Flat with title prefix',
      hint: 'Merge flat; prefix every imported request title',
    },
  ];

  private sub?: Subscription;

  constructor(
    private dialog: BatchImportDialogService,
    private cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.sub = this.dialog.state.subscribe((s) => {
      this.state = s.phase === 'idle' ? null : s;
      this.cdr.markForCheck();
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  get rows() {
    return this.state?.files?.length ? buildPreviewRows(this.state.files) : [];
  }

  isSelected(path: string): boolean {
    return this.state ? this.state.selectedPaths.has(path) : false;
  }

  toggle(path: string) {
    this.dialog.togglePath(path);
  }

  selectAll(on: boolean) {
    this.dialog.selectAll(on);
  }

  setMergeMode(m: BatchMergeMode) {
    this.dialog.setMergeMode(m);
  }

  setPrefix(v: string) {
    this.dialog.setRequestTitlePrefix(v);
  }

  cancel() {
    this.dialog.cancelPreview();
  }

  async importSelected() {
    await this.dialog.confirmImport();
  }

  cancelRun() {
    this.dialog.requestCancelRun();
  }

  formatKind(k: string): string {
    switch (k) {
      case 'workbench':
        return 'API Workbench';
      case 'postman':
        return 'Postman';
      case 'openapi':
        return 'OpenAPI';
      case 'har':
        return 'HAR';
      case 'insomnia':
        return 'Insomnia';
      case 'unknown':
        return 'Unknown';
      default:
        return k;
    }
  }

  summaryLine = formatBatchImportSummary;
}
