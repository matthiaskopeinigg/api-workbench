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
  templateUrl: './response-search.component.html',

  styleUrl: './response-search.component.scss',
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
