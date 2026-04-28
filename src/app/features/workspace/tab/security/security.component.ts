import { Component, inject, signal, Input, OnInit, OnChanges, SimpleChanges, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TabItem } from '@core/tabs/tab.service';
import { SecurityService } from './security.service';

@Component({
  selector: 'app-security',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './security.component.html',
  styleUrl: './security.component.scss'
})
export class SecurityComponent implements OnInit, OnChanges {
  @Input() tab?: TabItem;
  private readonly svc = inject(SecurityService);

  readonly currentTabId = signal<string | null>(null);
  readonly scans = this.svc.scans;
  readonly summary = this.svc.summary;

  readonly isReportScoped = computed(() => !!this.currentTabId()?.startsWith('sec:r:'));

  readonly selectedScan = computed(() => {
    const id = this.currentTabId()?.replace('sec:r:', '');
    if (!id) return null;
    return this.scans().find(s => s.id === id) ?? null;
  });

  ngOnInit(): void {
    this.initFromTab();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['tab'] && !changes['tab'].firstChange) {
      this.initFromTab();
    }
  }

  private initFromTab(): void {
    if (!this.tab) return;
    this.currentTabId.set(this.tab.id);
  }

  startNewScan() {
    this.svc.startScan('Manual Scan', 'target-id', 'url');
  }

  getSeverityClass(severity: string): string {
    return `sev-${severity}`;
  }
}
