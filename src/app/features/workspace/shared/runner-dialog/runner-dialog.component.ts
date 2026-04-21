import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  HostListener,
  Input,
  OnChanges,
  OnDestroy,
  OnInit,
  SimpleChanges,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { Collection, Folder } from '@models/collection';
import { RunnerService, RunnerState } from '@core/runner.service';

type Source = Collection | Folder;

@Component({
  selector: 'app-runner-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './runner-dialog.component.html',
  styleUrl: './runner-dialog.component.scss',
})
export class RunnerDialogComponent implements OnInit, OnChanges, OnDestroy {
  @Input() source!: Source;
  @Input() sourceLabel = '';
  @Input() onClose?: () => void;

  iterations = 1;
  delayMs = 0;
  runTests = true;
  requestCount = 0;

  state: RunnerState = {
    isRunning: false, total: 0, completed: 0, results: [], startedAt: null, finishedAt: null,
  };

  private sub?: Subscription;

  constructor(private runner: RunnerService, private cdr: ChangeDetectorRef) {}

  ngOnInit(): void {
    this.sub = this.runner.state$().subscribe(state => {
      this.state = state;
      this.cdr.markForCheck();
    });
    this.recomputeRequestCount();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['source']) this.recomputeRequestCount();
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.state.isRunning) return;
    this.close();
  }

  close() {
    if (this.onClose) this.onClose();
  }

  private recomputeRequestCount(): void {
    if (!this.source) {
      this.requestCount = 0;
      return;
    }
    this.requestCount = this.runner.collectRequests(this.source).length;
  }

  async start() {
    if (this.state.isRunning) return;
    await this.runner.run(this.source, {
      iterations: this.iterations,
      delayMs: this.delayMs,
      runTests: this.runTests,
    });
  }

  cancel() {
    this.runner.cancel();
  }

  get progressPercent(): number {
    if (!this.state.total) return 0;
    return Math.round((this.state.completed / this.state.total) * 100);
  }

  statusClass(status: number): string {
    if (!status) return 'is-error';
    if (status >= 500) return 'is-error';
    if (status >= 400) return 'is-warning';
    if (status >= 200 && status < 300) return 'is-success';
    return '';
  }

  trackByResult(index: number, item: { requestId: string; iteration: number }) {
    return `${item.requestId}-${item.iteration}-${index}`;
  }

  passedCount(tests?: Array<{ passed: boolean }>): number {
    return (tests || []).filter(t => t.passed).length;
  }

  hasFailures(tests?: Array<{ passed: boolean }>): boolean {
    return (tests || []).some(t => !t.passed);
  }

  testsSummary(): { passed: number; failed: number; total: number } {
    let passed = 0, failed = 0, total = 0;
    for (const r of this.state.results) {
      if (!r.testResults) continue;
      for (const t of r.testResults) {
        total++;
        if (t.passed) passed++; else failed++;
      }
    }
    return { passed, failed, total };
  }

  requestSummary(): { ok: number; failed: number; total: number; avgMs: number } {
    let ok = 0, failed = 0, totalMs = 0;
    for (const r of this.state.results) {
      if (r.status >= 200 && r.status < 400) ok++; else failed++;
      totalMs += r.timeMs || 0;
    }
    const total = this.state.results.length;
    return { ok, failed, total, avgMs: total ? Math.round(totalMs / total) : 0 };
  }

  formatDuration(): string {
    if (!this.state.startedAt) return '';
    const end = this.state.finishedAt ?? Date.now();
    const ms = Math.max(0, end - this.state.startedAt);
    if (ms < 1000) return `${ms} ms`;
    const seconds = ms / 1000;
    if (seconds < 60) return `${seconds.toFixed(1)} s`;
    const minutes = Math.floor(seconds / 60);
    const rem = Math.round(seconds % 60);
    return `${minutes}m ${rem}s`;
  }
}
