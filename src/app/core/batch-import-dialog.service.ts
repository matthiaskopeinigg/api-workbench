import { Injectable } from '@angular/core';
import { BehaviorSubject, Subject } from 'rxjs';
import { FileDialogResult } from '@models/file-dialog';
import {
  BatchImportResult,
  BatchMergeMode,
  buildPreviewRows,
  ImportBatchService,
} from './import-batch.service';

export type BatchImportDialogPhase = 'idle' | 'preview' | 'running' | 'done';

export interface BatchImportDialogState {
  phase: BatchImportDialogPhase;
  files: FileDialogResult[];
  selectedPaths: Set<string>;
  mergeMode: BatchMergeMode;
  requestTitlePrefix: string;
  runningIndex: number;
  runningTotal: number;
  result: BatchImportResult | null;
  cancelInFlight: { current: boolean };
}

@Injectable({ providedIn: 'root' })
export class BatchImportDialogService {
  private state$ = new BehaviorSubject<BatchImportDialogState>(this.idleState());
  /** Emits when a run finished (ok to show a toast in parent). */
  readonly finished$ = new Subject<BatchImportResult | null>();

  get state() {
    return this.state$.asObservable();
  }

  get snapshot(): BatchImportDialogState {
    return this.state$.getValue();
  }

  constructor(private importBatch: ImportBatchService) {}

  private idleState(): BatchImportDialogState {
    return {
      phase: 'idle',
      files: [],
      selectedPaths: new Set(),
      mergeMode: 'flat',
      requestTitlePrefix: '',
      runningIndex: 0,
      runningTotal: 0,
      result: null,
      cancelInFlight: { current: false },
    };
  }

  startPreview(files: FileDialogResult[]): void {
    if (!files.length) {
      this.finished$.next(null);
      return;
    }
    const rows = buildPreviewRows(files);
    const selectedPaths = new Set(
      rows.filter((r) => r.kind !== 'unknown').map((r) => r.path),
    );
    this.state$.next({
      phase: 'preview',
      files,
      selectedPaths,
      mergeMode: 'flat',
      requestTitlePrefix: '',
      runningIndex: 0,
      runningTotal: 0,
      result: null,
      cancelInFlight: { current: false },
    });
  }

  setMergeMode(mode: BatchMergeMode): void {
    const s = this.snapshot;
    if (s.phase !== 'preview') return;
    this.state$.next({ ...s, mergeMode: mode });
  }

  setRequestTitlePrefix(p: string): void {
    const s = this.snapshot;
    if (s.phase !== 'preview') return;
    this.state$.next({ ...s, requestTitlePrefix: p });
  }

  togglePath(path: string): void {
    const s = this.snapshot;
    if (s.phase !== 'preview') return;
    const next = new Set(s.selectedPaths);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    this.state$.next({ ...s, selectedPaths: next });
  }

  selectAll(selected: boolean): void {
    const s = this.snapshot;
    if (s.phase !== 'preview') return;
    const rows = buildPreviewRows(s.files);
    const next = new Set<string>();
    if (selected) {
      for (const r of rows) {
        if (r.kind !== 'unknown') {
          next.add(r.path);
        }
      }
    }
    this.state$.next({ ...s, selectedPaths: next });
  }

  cancelPreview(): void {
    this.state$.next(this.idleState());
  }

  async confirmImport(): Promise<void> {
    const s = this.snapshot;
    if (s.phase !== 'preview') {
      return;
    }
    const list = s.files.filter((f) => f.path && s.selectedPaths.has(f.path));
    if (!list.length) {
      this.state$.next({ ...s, phase: 'done', result: { ok: 0, failed: 0, errors: [] } });
      this.finished$.next({ ok: 0, failed: 0, errors: [] });
      this.endDone();
      return;
    }
    const cancel = { current: false };
    this.state$.next({
      ...s,
      phase: 'running',
      runningIndex: 0,
      runningTotal: list.length,
      cancelInFlight: cancel,
    });
    const result = await this.importBatch.runBatch(list, {
      cancel,
      mergeMode: s.mergeMode,
      requestTitlePrefix: s.requestTitlePrefix.trim() || undefined,
      onProgress: (idx, total) => {
        const cur = this.state$.getValue();
        this.state$.next({
          ...cur,
          runningIndex: idx,
          runningTotal: total,
        });
      },
    });
    this.state$.next({
      ...this.snapshot,
      phase: 'done',
      result,
    });
    this.finished$.next(result);
    this.endDone();
  }

  private endDone(): void {
    setTimeout(() => {
      this.state$.next(this.idleState());
    }, 1800);
  }

  requestCancelRun(): void {
    const s = this.snapshot;
    if (s.phase === 'running') {
      s.cancelInFlight.current = true;
    }
  }

  close(): void {
    this.state$.next(this.idleState());
  }
}
