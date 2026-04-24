import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  Output,
  OnInit,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MOCK_MATCH_HTTP_METHODS, type MockVariant } from '@models/request';

@Component({
  selector: 'app-mock-variant-match-section',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './mock-variant-match-section.component.html',
  styleUrl: './mock-variant-match-section.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MockVariantMatchSectionComponent implements OnInit {
  @Input({ required: true }) variant!: MockVariant;
  @Output() readonly changed = new EventEmitter<void>();

  /** When `matchOn` exists, controls visibility of the matcher form (not the whole card). */
  matchingExpanded = true;

  private get sessionKey(): string {
    return `aw.mockServer.match.${this.variant?.id}`;
  }

  ngOnInit() {
    if (typeof sessionStorage !== 'undefined' && this.variant?.id) {
      const saved = sessionStorage.getItem(this.sessionKey);
      if (saved !== null) {
        this.matchingExpanded = saved === 'true';
      }
    }
  }

  readonly httpMethods = [...MOCK_MATCH_HTTP_METHODS];

  trackByIndex = (i: number) => i;

  private emit(): void {
    this.changed.emit();
  }

  toggleMatchingPanel(): void {
    this.matchingExpanded = !this.matchingExpanded;
    if (typeof sessionStorage !== 'undefined' && this.variant?.id) {
      sessionStorage.setItem(this.sessionKey, String(this.matchingExpanded));
    }
  }

  ensureMatchOn(): void {
    if (!this.variant.matchOn) {
      this.variant.matchOn = {};
      this.matchingExpanded = true;
      if (typeof sessionStorage !== 'undefined' && this.variant?.id) {
        sessionStorage.setItem(this.sessionKey, 'true');
      }
      this.emit();
    }
  }

  onScalarChange(): void {
    this.emit();
  }

  methodChipActive(method: string): boolean {
    const on = this.variant.matchOn;
    if (!on) return false;
    const u = method.toUpperCase();
    if (on.methods?.length) {
      return on.methods.some((x) => String(x || '').trim().toUpperCase() === u);
    }
    if (on.method?.trim()) {
      return String(on.method).trim().toUpperCase() === u;
    }
    return false;
  }

  toggleMethodChip(method: string): void {
    this.ensureMatchOn();
    const on = this.variant.matchOn!;
    let list = [...(on.methods || [])];
    if (!list.length && on.method?.trim()) {
      list = [String(on.method).trim().toUpperCase()];
    }
    on.method = undefined;
    on.methodRegex = undefined;
    const u = method.toUpperCase();
    const i = list.indexOf(u);
    if (i >= 0) {
      list.splice(i, 1);
    } else {
      list.push(u);
    }
    on.methods = list.length ? list : undefined;
    this.emit();
  }

  addHeaderRule(): void {
    this.ensureMatchOn();
    const m = this.variant.matchOn!;
    const list = m.headers ? [...m.headers] : [];
    list.push({ name: '' });
    m.headers = list;
    this.emit();
  }

  removeHeaderRule(index: number): void {
    const m = this.variant.matchOn;
    if (!m?.headers) return;
    m.headers = m.headers.filter((_, i) => i !== index);
    this.emit();
  }

  addQueryRule(): void {
    this.ensureMatchOn();
    const m = this.variant.matchOn!;
    const list = m.queryParams ? [...m.queryParams] : [];
    list.push({ name: '', value: '', valueRegex: '' });
    m.queryParams = list;
    this.emit();
  }

  removeQueryRule(index: number): void {
    const m = this.variant.matchOn;
    if (!m?.queryParams) return;
    m.queryParams = m.queryParams.filter((_, i) => i !== index);
    this.emit();
  }

  clearMatchers(): void {
    this.variant.matchOn = undefined;
    this.matchingExpanded = true;
    if (typeof sessionStorage !== 'undefined' && this.variant?.id) {
      sessionStorage.removeItem(this.sessionKey);
    }
    this.emit();
  }
}
