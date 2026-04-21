import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  ViewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

/** A single match's half-open byte range inside the searched string. */
export interface ResponseSearchMatch {
  start: number;
  end: number;
}

/** Text segment produced while rendering search-highlighted output. */
export interface ResponseSearchSegment {
  text: string;
  matchIndex: number | null;
}

export interface ResponseSearchOptions {
  caseSensitive: boolean;
  regex: boolean;
}

/**
 * Search-and-highlight overlay for the response body. The parent owns the
 * raw text; we emit matches, segments and the active index so the parent can
 * render the response pane however it likes.
 *
 * UX matches editor conventions: Enter = next, Shift+Enter = prev, Escape
 * closes. Case-sensitive and regex toggles are sticky per session.
 */
@Component({
  selector: 'app-response-search',
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="response-search" *ngIf="isOpen" role="search">
      <input #searchInput class="rs-input" type="text"
             [(ngModel)]="query"
             (ngModelChange)="onQueryChange()"
             (keydown.enter)="navigate($event, 1)"
             (keydown.shift.enter)="navigate($event, -1)"
             (keydown.escape)="close.emit()"
             placeholder="Find in response…"
             aria-label="Find in response" />
      <span class="rs-count" [class.rs-count-none]="matches.length === 0">
        <ng-container *ngIf="matches.length === 0">{{ query ? '0 results' : '' }}</ng-container>
        <ng-container *ngIf="matches.length > 0">{{ activeIndex + 1 }} / {{ matches.length }}</ng-container>
      </span>
      <button type="button" class="rs-btn" (click)="toggleCase()"
              [class.rs-btn-on]="options.caseSensitive"
              title="Match case">Aa</button>
      <button type="button" class="rs-btn" (click)="toggleRegex()"
              [class.rs-btn-on]="options.regex"
              title="Regular expression">.*</button>
      <button type="button" class="rs-btn" (click)="navigate($event, -1)"
              [disabled]="matches.length === 0" title="Previous">↑</button>
      <button type="button" class="rs-btn" (click)="navigate($event, 1)"
              [disabled]="matches.length === 0" title="Next">↓</button>
      <button type="button" class="rs-btn" (click)="close.emit()" title="Close">×</button>
    </div>
  `,
  styles: [`
    :host { display: contents; }
    .response-search {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 6px;
      background: color-mix(in srgb, var(--surface, var(--aw-bg)), #000 4%);
      border: 1px solid color-mix(in srgb, var(--border-color), transparent 40%);
      border-radius: var(--aw-radius-sm, 6px);
      font-size: 12px;
    }
    .rs-input {
      flex: 1;
      min-width: 140px;
      border: 0;
      background: transparent;
      color: var(--text-color);
      font: inherit;
      outline: none;
      padding: 4px 2px;
    }
    .rs-count {
      font-size: 11px;
      color: color-mix(in srgb, var(--text-color), transparent 40%);
      min-width: 56px;
      text-align: right;
      font-variant-numeric: tabular-nums;
      &.rs-count-none { color: color-mix(in srgb, #c33, transparent 40%); }
    }
    .rs-btn {
      appearance: none;
      border: 1px solid transparent;
      background: transparent;
      color: color-mix(in srgb, var(--text-color), transparent 25%);
      padding: 3px 7px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
      font-weight: 600;
      &:hover:not([disabled]) {
        background: color-mix(in srgb, var(--text-color), transparent 90%);
        color: var(--text-color);
      }
      &[disabled] { opacity: 0.4; cursor: default; }
      &.rs-btn-on {
        background: color-mix(in srgb, var(--primary-color, #49f), transparent 75%);
        color: var(--primary-color, #49f);
        border-color: color-mix(in srgb, var(--primary-color, #49f), transparent 60%);
      }
    }
  `]
})
export class ResponseSearchComponent implements OnChanges {
  @Input() isOpen = false;
  @Input() text = '';

  @Output() close = new EventEmitter<void>();
  @Output() segmentsChange = new EventEmitter<ResponseSearchSegment[]>();
  @Output() matchesChange = new EventEmitter<ResponseSearchMatch[]>();
  @Output() activeIndexChange = new EventEmitter<number>();

  @ViewChild('searchInput') searchInput?: ElementRef<HTMLInputElement>;

  query = '';
  matches: ResponseSearchMatch[] = [];
  activeIndex = 0;
  options: ResponseSearchOptions = { caseSensitive: false, regex: false };

  ngOnChanges(changes: SimpleChanges): void {
    if ((changes['isOpen'] && this.isOpen) || (changes['text'] && this.isOpen)) {
      this.recompute();
      setTimeout(() => this.searchInput?.nativeElement.focus(), 0);
    }
  }

  onQueryChange() {
    this.recompute();
  }

  toggleCase() {
    this.options = { ...this.options, caseSensitive: !this.options.caseSensitive };
    this.recompute();
  }

  toggleRegex() {
    this.options = { ...this.options, regex: !this.options.regex };
    this.recompute();
  }

  navigate(event: Event | undefined, direction: 1 | -1) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    if (this.matches.length === 0) return;
    this.activeIndex = (this.activeIndex + direction + this.matches.length) % this.matches.length;
    this.activeIndexChange.emit(this.activeIndex);
    this.emitSegments();
  }

  /** Recompute matches from current text + query + options. */
  private recompute() {
    this.matches = computeMatches(this.text, this.query, this.options);
    this.activeIndex = this.matches.length > 0 ? Math.min(this.activeIndex, this.matches.length - 1) : 0;
    this.matchesChange.emit(this.matches);
    this.activeIndexChange.emit(this.activeIndex);
    this.emitSegments();
  }

  private emitSegments() {
    this.segmentsChange.emit(buildSegments(this.text, this.matches));
  }
}

/** Compile the user-supplied query into a global RegExp. */
export function compileQuery(
  query: string,
  options: ResponseSearchOptions
): RegExp | null {
  if (!query) return null;
  try {
    const flags = 'g' + (options.caseSensitive ? '' : 'i');
    const source = options.regex ? query : escapeRegex(query);
    return new RegExp(source, flags);
  } catch {
    return null;
  }
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Collect all non-overlapping match ranges for `query` within `text`. */
export function computeMatches(
  text: string,
  query: string,
  options: ResponseSearchOptions
): ResponseSearchMatch[] {
  const re = compileQuery(query, options);
  if (!re || !text) return [];
  const out: ResponseSearchMatch[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m[0].length === 0) {
      re.lastIndex++;
      continue;
    }
    out.push({ start: m.index, end: m.index + m[0].length });
  }
  return out;
}

/**
 * Slice the original text into alternating plain / matched segments for
 * rendering. `matchIndex` on a match segment points into the `matches` array.
 */
export function buildSegments(
  text: string,
  matches: ResponseSearchMatch[]
): ResponseSearchSegment[] {
  if (!text) return [];
  if (matches.length === 0) return [{ text, matchIndex: null }];
  const segments: ResponseSearchSegment[] = [];
  let cursor = 0;
  matches.forEach((m, i) => {
    if (m.start > cursor) {
      segments.push({ text: text.slice(cursor, m.start), matchIndex: null });
    }
    segments.push({ text: text.slice(m.start, m.end), matchIndex: i });
    cursor = m.end;
  });
  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), matchIndex: null });
  }
  return segments;
}
