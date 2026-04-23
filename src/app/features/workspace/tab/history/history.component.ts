import { ChangeDetectionStrategy, ChangeDetectorRef, Component, Input, OnChanges, OnInit, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AwDatePipe } from '../../shared/pipes/aw-date.pipe';
import { RequestHistoryEntry } from '@models/request-history';
import { HttpMethod } from '@models/request';
import { TabItem, TabType } from '@core/tabs/tab.service';
import { RequestHistoryService } from '@core/http/request-history.service';

interface CollapsedSections {
  request: boolean;
  headers: boolean;
  params: boolean;
  requestBody: boolean;
  response: boolean;
  responseHeaders: boolean;
  responseBody: boolean;
}

@Component({
  selector: 'app-history',
  imports: [CommonModule, AwDatePipe],
  templateUrl: './history.component.html',
  styleUrl: './history.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HistoryComponent implements OnInit, OnChanges {
  @Input() tab!: TabItem;

  requestHistoryEntry!: RequestHistoryEntry;

  collapsedSections: CollapsedSections = {
    request: false,
    headers: false,
    params: false,
    requestBody: false,
    response: false,
    responseHeaders: false,
    responseBody: false
  };

  constructor(private requestHistoryService: RequestHistoryService,
    private cdr: ChangeDetectorRef) {
  }

  ngOnInit() {
    this.loadHistoryEntry();
  }

  ngOnChanges() {
    this.loadHistoryEntry();
  }

  loadHistoryEntry() {
    const requestHistoryEntryId = this.tab.id;
    const requestHistoryEntry = this.requestHistoryService.getEntryById(requestHistoryEntryId);
    if (!requestHistoryEntry)
      return;

    this.requestHistoryEntry = requestHistoryEntry;
    this.cdr.markForCheck();
  }

  toggleCollapse(section: keyof CollapsedSections) {
    this.collapsedSections[section] = !this.collapsedSections[section];
    this.cdr.markForCheck();
  }

  trackByIndex(index: number) {
    return index;
  }

  getDuration(h: RequestHistoryEntry): number {
    return new Date(h.response.receivedAt).getTime() - new Date(h.createdAt).getTime();
  }

  getSize(body: string | undefined): string {
    if (!body) return '0 B';
    const bytes = new Blob([body]).size;
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  }

  copiedKey: string | null = null;

  async copyToClipboard(content: string | undefined, key: string) {
    if (!content) return;
    try {
      await navigator.clipboard.writeText(content);
      this.copiedKey = key;
      this.cdr.markForCheck();
      setTimeout(() => {
        if (this.copiedKey === key) {
          this.copiedKey = null;
          this.cdr.markForCheck();
        }
      }, 1500);
    } catch {
    }
  }

  statusBucket(code: number | undefined): 'ok' | 'warn' | 'err' | 'info' | 'unknown' {
    if (code === undefined || code === null) return 'unknown';
    if (code >= 200 && code < 300) return 'ok';
    if (code >= 300 && code < 400) return 'info';
    if (code >= 400 && code < 500) return 'warn';
    if (code >= 500) return 'err';
    return 'unknown';
  }

  pretty(content: string | undefined): string {
    if (!content) return '';
    try {
      return JSON.stringify(JSON.parse(content), null, 2);
    } catch {
      if (content.trim().startsWith('<')) {
        return this.formatXml(content);
      }
      return content;
    }
  }

  formatXml(xml: string): string {
    const PADDING = '  ';
    const reg = /(>)(<)(\/*)/g;
    let pad = 0;
    xml = xml.replace(reg, '$1\r\n$2$3');
    return xml.split('\r\n').map((node) => {
      let indent = 0;
      if (node.match(/.+<\/\w[^>]*>$/)) {
        indent = 0;
      } else if (node.match(/^<\/\w/)) {
        if (pad !== 0) {
          pad -= 1;
        }
      } else if (node.match(/^<\w[^>]*[^\/]>.*$/)) {
        indent = 1;
      } else {
        indent = 0;
      }
      const padding = new Array(pad + 1).join(PADDING);
      if (indent > 0) {
        pad += 1;
      }
      return padding + node;
    }).join('\r\n');
  }

  HttpMethod = HttpMethod;
}
