import { ChangeDetectionStrategy, ChangeDetectorRef, Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Response } from '@models/response';
import { ResponseHistoryService } from '@core/response-history.service';
import type { ResponseHistoryListItem } from '@models/electron';
import { canonicalizeIfJson, diffLines, toSideBySide, SideBySideRow, DiffOp } from '@core/diff.util';

/**
 * Diff tab: lets the user compare the current response against a previous
 * capture stored in `response_history`. Renders a JSON-aware side-by-side
 * view. We keep the diff engine in plain TS (no Monaco) so the tab opens
 * instantly even on large payloads.
 */
@Component({
  selector: 'app-response-diff',
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './response-diff.component.html',
  styleUrls: ['./response-diff.component.scss']
})
export class ResponseDiffComponent implements OnChanges {
  @Input() requestId: string | null = null;
  @Input() current: Response | null = null;

  history: ResponseHistoryListItem[] = [];
  selectedId: number | null = null;
  compareBody = '';
  rows: SideBySideRow[] = [];
  summary = { added: 0, removed: 0, equal: 0 };
  normalize = true;
  loading = false;
  error: string | null = null;

  constructor(private historyService: ResponseHistoryService, private cdr: ChangeDetectorRef) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['requestId'] && this.requestId) {
      void this.refreshList();
    }
    if (changes['current']) {
      this.recomputeDiff();
    }
  }

  async refreshList(): Promise<void> {
    if (!this.requestId) {
      this.history = [];
      this.cdr.markForCheck();
      return;
    }
    this.loading = true;
    this.cdr.markForCheck();
    this.history = await this.historyService.list(this.requestId, 25);
    if (this.history.length > 1) {
      this.selectedId = this.history[1].id;
    } else if (this.history.length === 1) {
      this.selectedId = this.history[0].id;
    } else {
      this.selectedId = null;
    }
    this.loading = false;
    await this.loadSelected();
  }

  async onSelectChange(id: number | null): Promise<void> {
    this.selectedId = id;
    await this.loadSelected();
  }

  private async loadSelected(): Promise<void> {
    if (this.selectedId == null) {
      this.compareBody = '';
      this.recomputeDiff();
      return;
    }
    const entry = await this.historyService.get(this.selectedId);
    this.compareBody = entry?.body ?? '';
    this.recomputeDiff();
  }

  onNormalizeChange(value: boolean): void {
    this.normalize = value;
    this.recomputeDiff();
  }

  private recomputeDiff(): void {
    const currentBody = this.current?.body ?? '';
    const contentType = this.current?.contentType || '';
    const left = this.normalize ? canonicalizeIfJson(this.compareBody, contentType) : this.compareBody;
    const right = this.normalize ? canonicalizeIfJson(currentBody, contentType) : currentBody;
    const ops = diffLines(left, right);
    this.rows = toSideBySide(ops);
    this.summary = {
      added: ops.filter((o: DiffOp) => o.kind === 'add').length,
      removed: ops.filter((o: DiffOp) => o.kind === 'remove').length,
      equal: ops.filter((o: DiffOp) => o.kind === 'equal').length
    };
    this.cdr.markForCheck();
  }

  formatTimestamp(ms: number | null): string {
    if (!ms) return '';
    try {
      return new Date(ms).toLocaleString();
    } catch {
      return String(ms);
    }
  }

  trackByRow = (index: number, row: SideBySideRow) =>
    `${row.left?.lineNo ?? 'x'}-${row.right?.lineNo ?? 'x'}-${index}`;

  trackByEntry = (_index: number, entry: ResponseHistoryListItem) => entry.id;
}
