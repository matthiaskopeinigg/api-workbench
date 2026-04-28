import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  Input,
  OnInit,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { WindowService } from '@core/platform/window.service';
import type { StorageInfo } from '@models/electron';
import { GITHUB_ISSUES_URL, GITHUB_NEW_ISSUE_URL } from '@core/bug-report.constants';

@Component({
  selector: 'app-bug-report-hint',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './bug-report-hint.component.html',
  styleUrl: './bug-report-hint.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BugReportHintComponent implements OnInit {
  private readonly windowService = inject(WindowService);
  private readonly cdr = inject(ChangeDetectorRef);

  /** Short error text to suggest including in the GitHub issue (optional). */
  @Input() errorSummary: string | null = null;

  /** Larger type and spacing (e.g. boot error screen). */
  @Input() prominent = false;

  storage: StorageInfo | null = null;
  appVersion = '';
  copyDone = false;
  private copyTimer: ReturnType<typeof setTimeout> | null = null;

  ngOnInit(): void {
    const api = typeof window !== 'undefined' ? window.awElectron : undefined;
    this.appVersion = (api?.appVersion && String(api.appVersion).trim()) || '';

    if (!api?.getStorageInfo) {
      this.cdr.markForCheck();
      return;
    }
    void api
      .getStorageInfo()
      .then((info) => {
        this.storage = info;
        this.cdr.markForCheck();
      })
      .catch(() => {
        this.storage = null;
        this.cdr.markForCheck();
      });
  }

  get canOpenLogs(): boolean {
    return typeof window !== 'undefined' && typeof window.awElectron?.openLogsDirectory === 'function';
  }

  openIssues(): void {
    this.windowService.openUrlInSystemBrowser(GITHUB_ISSUES_URL);
  }

  openNewIssue(): void {
    this.windowService.openUrlInSystemBrowser(GITHUB_NEW_ISSUE_URL);
  }

  async openLogsFolder(): Promise<void> {
    const api = window.awElectron;
    if (!api?.openLogsDirectory) return;
    await api.openLogsDirectory();
  }

  async copyReportPreamble(): Promise<void> {
    const lines: string[] = [];
    lines.push('### api-workbench');
    if (this.appVersion) {
      lines.push(`- Version: ${this.appVersion}`);
    }
    lines.push(`- OS: <!-- e.g. Windows 11, macOS 14, Ubuntu 22.04 -->`);
    if (this.storage?.userData) {
      lines.push(`- Data directory: \`${this.storage.userData}\``);
    }
    if (this.storage?.logsDir) {
      lines.push(`- Log folder: \`${this.storage.logsDir}\``);
    }
    lines.push('');
    lines.push('### What happened');
    const err = (this.errorSummary || '').trim();
    if (err) {
      lines.push('```');
      lines.push(err.length > 4000 ? `${err.slice(0, 3997)}…` : err);
      lines.push('```');
    } else {
      lines.push('<!-- Describe the steps and what you expected -->');
    }
    lines.push('');
    lines.push('### Logs');
    lines.push(
      '<!-- Enable Settings → Logging → “Write application logs to a file”, reproduce, then attach or paste relevant lines (remove secrets). -->',
    );

    const text = lines.join('\n');
    try {
      await navigator.clipboard.writeText(text);
      this.copyDone = true;
      if (this.copyTimer) clearTimeout(this.copyTimer);
      this.copyTimer = setTimeout(() => {
        this.copyDone = false;
        this.cdr.markForCheck();
      }, 2200);
      this.cdr.markForCheck();
    } catch {
      /* clipboard may be denied without user gesture; ignore */
    }
  }
}
