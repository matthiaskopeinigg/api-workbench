import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  OnInit,
  Output,
  ViewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

export type EditorLanguage =
  | 'json'
  | 'xml'
  | 'javascript'
  | 'plain'
  | 'html'
  | 'graphql'
  | 'python';

@Component({
  selector: 'app-code-editor',
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="code-editor-container" [class.readonly]="readonly" [class.no-toolbar]="hideToolbar">
      <div class="editor-toolbar" *ngIf="!hideToolbar && (!readonly || title)">
        <div class="header-left">
          <span class="editor-title" *ngIf="title">{{ title }}</span>
          <div class="language-badge">{{ language.toUpperCase() }}</div>
        </div>
        <div class="actions">
          <button type="button" class="action-btn" (click)="formatCode()" title="Format">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 10H3M21 6H3M21 14H3M21 18H3"/>
            </svg>
            Format
          </button>
          <button type="button" class="action-btn" (click)="copyToClipboard()" title="Copy">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
            Copy
          </button>
        </div>
      </div>
      <div class="editor-wrapper">
        <div class="line-numbers" #lineNumbers>
          <div class="line-number" *ngFor="let _ of lines; let i = index">{{ i + 1 }}</div>
        </div>
        <div class="code-container">
          <textarea
            #textarea
            [class.readonly]="readonly"
            [readonly]="readonly"
            [(ngModel)]="innerContent"
            (ngModelChange)="onContentChange($event)"
            (scroll)="syncScroll()"
            (keydown)="handleKeydown($event)"
            spellcheck="false"
            autocomplete="off"
            autocorrect="off"
            class="code-input"
          ></textarea>
          <pre #preBlock class="code-output" aria-hidden="true"><code [innerHTML]="highlightedContent"></code></pre>
        </div>
      </div>
    </div>
  `,
  styles: [
    `
    :host {
      display: flex;
      flex-direction: column;
      flex: 1;
      height: 100%;
      width: 100%;
      min-height: 100px;
      overflow: hidden;
    }

    .code-editor-container {
      display: flex;
      flex-direction: column;
      flex: 1;
      border: 1px solid var(--aw-border, var(--border-color));
      border-radius: var(--aw-radius-md, 8px);
      overflow: hidden;
      background: var(--aw-surface, var(--surface));

      &.readonly {
        background: var(--aw-surface-muted, var(--surface-alt));
      }

      &.no-toolbar {
        border: none;
        border-radius: 0;
        background: transparent;
      }
    }

    .editor-toolbar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 4px 12px;
      background: var(--aw-bg, var(--bg-color));
      border-bottom: 1px solid var(--aw-border, var(--border-color));
      user-select: none;
      flex-shrink: 0;

      .header-left {
        display: flex;
        align-items: center;
        gap: 12px;
      }

      .editor-title {
        font-size: 11px;
        font-weight: 700;
        color: var(--aw-text, var(--text-color));
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }

      .language-badge {
        font-size: 9px;
        font-weight: 800;
        color: var(--secondary-color);
        opacity: 0.5;
        background: color-mix(in srgb, var(--secondary-color), transparent 90%);
        padding: 2px 6px;
        border-radius: 4px;
        letter-spacing: 0.5px;
      }

      .actions {
        display: flex;
        gap: 8px;

        .action-btn {
          display: flex;
          align-items: center;
          gap: 4px;
          background: transparent;
          border: none;
          color: var(--aw-text, var(--text-color));
          font-size: 11px;
          font-weight: 600;
          cursor: pointer;
          padding: 4px 8px;
          border-radius: 4px;
          opacity: 0.7;
          transition: opacity 0.15s ease, background 0.15s ease, color 0.15s ease;

          &:hover {
            opacity: 1;
            background: var(--aw-surface-muted, var(--surface-alt));
            color: var(--secondary-color);
          }
        }
      }
    }

    .editor-wrapper {
      position: relative;
      flex: 1;
      display: flex;
      overflow: hidden;
      font-family: var(--aw-font-mono, 'Cascadia Code', 'Fira Code', Consolas, monospace);
      font-size: 13px;
      line-height: 1.5;
    }

    .line-numbers {
      width: 44px;
      background: var(--aw-surface-muted, var(--surface-alt));
      border-right: 1px solid var(--aw-border, var(--border-color));
      color: var(--secondary-color);
      text-align: right;
      padding: 10px 8px 10px 0;
      user-select: none;
      overflow: hidden;
      flex-shrink: 0;

      .line-number {
        height: 1.5em;
        font-size: 11px;
        opacity: 0.55;
      }
    }

    .code-container {
      position: relative;
      flex: 1;
      overflow: hidden;
    }

    textarea.code-input,
    pre.code-output {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      margin: 0;
      padding: 10px;
      border: none;
      font-family: inherit;
      font-size: inherit;
      line-height: inherit;
      white-space: pre;
      overflow: auto;
      box-sizing: border-box;
      tab-size: 2;
    }

    textarea.code-input {
      z-index: 2;
      color: transparent;
      background: transparent;
      caret-color: var(--aw-text, var(--text-color));
      resize: none;
      outline: none;
    }

    textarea.code-input:focus-visible {
      box-shadow: inset 0 0 0 1px var(--aw-focus, color-mix(in srgb, var(--primary-color), transparent 40%));
    }

    pre.code-output {
      z-index: 1;
      color: var(--aw-text, var(--text-color));
      pointer-events: none;

      code {
        font-family: inherit;
      }
    }

    ::ng-deep .token-string { color: #ce9178; }
    ::ng-deep .token-number { color: #b5cea8; }
    ::ng-deep .token-boolean { color: #569cd6; }
    ::ng-deep .token-null { color: #569cd6; }
    ::ng-deep .token-key { color: #9cdcfe; }
    ::ng-deep .token-punctuation { color: #d4d4d4; }
    ::ng-deep .token-keyword { color: #c586c0; }
    ::ng-deep .token-function { color: #dcdcaa; }
    ::ng-deep .token-comment { color: #6a9955; }
    ::ng-deep .token-attribute { color: #9cdcfe; }

    ::ng-deep .variable-highlight {
      color: var(--secondary-color) !important;
      background-color: color-mix(in srgb, var(--secondary-color), transparent 88%);
      border-radius: 3px;
      font-weight: 600;
    }

    ::ng-deep .variable-highlight-error {
      color: #f85149 !important;
      background-color: color-mix(in srgb, #f85149, transparent 88%);
      border-radius: 3px;
    }
    `,
  ],
})
export class CodeEditorComponent implements OnInit, OnChanges, AfterViewInit, OnDestroy {
  @ViewChild('textarea') textarea!: ElementRef<HTMLTextAreaElement>;
  @ViewChild('preBlock') preBlock!: ElementRef<HTMLPreElement>;
  @ViewChild('lineNumbers') lineNumbers!: ElementRef<HTMLDivElement>;

  @Input() language: EditorLanguage = 'json';
  @Input() title?: string;
  @Input() content = '';
  @Input() readonly = false;
  @Input() activeVariables: Record<string, string> = {};
  @Input() hideToolbar = false;
  /** When true (default), JSON/XML bodies are pretty-printed after a short pause while typing. Set false for bulk plain fields. */
  @Input() autoFormat = true;

  @Output() contentChange = new EventEmitter<string>();

  innerContent = '';
  highlightedContent = '';
  lines: number[] = [1];

  private readonly autoFormatDebounceMs = 420;
  private autoFormatTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private cdr: ChangeDetectorRef) {}

  ngOnDestroy(): void {
    this.clearAutoFormatTimer();
  }

  ngOnInit(): void {
    this.innerContent = this.content ?? '';
    this.updateHighlighting();
  }

  ngOnChanges(): void {
    if (this.content !== this.innerContent && document.activeElement !== this.textarea?.nativeElement) {
      this.innerContent = this.content ?? '';
    }
    this.updateHighlighting();
    this.cdr.markForCheck();
  }

  ngAfterViewInit(): void {
    this.syncScroll();
  }

  onContentChange(value: string): void {
    this.innerContent = value;
    this.contentChange.emit(value);
    this.updateHighlighting();
    this.scheduleAutoFormat();
  }

  private clearAutoFormatTimer(): void {
    if (this.autoFormatTimer !== null) {
      clearTimeout(this.autoFormatTimer);
      this.autoFormatTimer = null;
    }
  }

  private supportsStructuredAutoFormat(): boolean {
    return this.language === 'json' || this.language === 'xml';
  }

  private scheduleAutoFormat(): void {
    if (this.readonly || !this.autoFormat || !this.supportsStructuredAutoFormat()) {
      this.clearAutoFormatTimer();
      return;
    }
    this.clearAutoFormatTimer();
    this.autoFormatTimer = setTimeout(() => {
      this.autoFormatTimer = null;
      this.applyAutoFormat();
    }, this.autoFormatDebounceMs);
  }

  private applyAutoFormat(): void {
    if (this.readonly || !this.autoFormat || !this.supportsStructuredAutoFormat()) {
      return;
    }
    const ta = this.textarea?.nativeElement;
    const before = this.innerContent ?? '';
    const formatted = this.tryFormatContent(before);
    if (formatted === null || formatted === before) {
      return;
    }
    if (this.isTextareaFocused()) {
      if (this.stripWhitespace(formatted) !== this.stripWhitespace(before)) {
        return;
      }
      if (this.countNewlines(formatted) < this.countNewlines(before)) {
        return;
      }
    }
    const start = ta?.selectionStart ?? before.length;
    const end = ta?.selectionEnd ?? start;
    this.innerContent = formatted;
    this.contentChange.emit(formatted);
    this.updateHighlighting();
    this.cdr.markForCheck();
    if (ta) {
      const nextStart = this.mapCaretBySignificantChars(before, formatted, start);
      const nextEnd = this.mapCaretBySignificantChars(before, formatted, end);
      const clampedStart = Math.min(nextStart, formatted.length);
      const clampedEnd = Math.min(Math.max(nextEnd, clampedStart), formatted.length);
      requestAnimationFrame(() => {
        ta.selectionStart = clampedStart;
        ta.selectionEnd = clampedEnd;
        this.syncScroll();
      });
    }
  }

  private isTextareaFocused(): boolean {
    return !!this.textarea?.nativeElement && document.activeElement === this.textarea.nativeElement;
  }

  private countNewlines(text: string): number {
    let count = 0;
    for (let i = 0; i < text.length; i++) {
      if (text.charCodeAt(i) === 10) count++;
    }
    return count;
  }

  private stripWhitespace(text: string): string {
    return text.replace(/\s+/g, '');
  }

  /** Maps a caret index from `oldText` into `newText` after pretty-printing (whitespace may change). */
  private mapCaretBySignificantChars(oldText: string, newText: string, pos: number): number {
    const bounded = Math.max(0, Math.min(pos, oldText.length));
    let sig = 0;
    for (let i = 0; i < bounded; i++) {
      if (!/\s/.test(oldText[i])) {
        sig++;
      }
    }
    if (sig === 0) {
      return 0;
    }
    let count = 0;
    for (let j = 0; j < newText.length; j++) {
      if (!/\s/.test(newText[j])) {
        count++;
        if (count === sig) {
          return j + 1;
        }
      }
    }
    return newText.length;
  }

  private effectiveHighlightLanguage(): EditorLanguage {
    if (this.language === 'graphql' || this.language === 'python' || this.language === 'html') {
      return this.language === 'html' ? 'xml' : 'javascript';
    }
    return this.language;
  }

  updateHighlighting(): void {
    const text = this.innerContent ?? '';
    if (!text) {
      this.highlightedContent = '';
      this.lines = [1];
      return;
    }

    const lineCount = text.split('\n').length;
    this.lines = Array.from({ length: Math.max(1, lineCount) }, () => 0);

    let html = this.escapeHtml(text);
    const hl = this.effectiveHighlightLanguage();
    if (hl === 'json') {
      html = this.highlightJson(html);
    } else if (hl === 'xml') {
      html = this.highlightXml(html);
    } else if (hl === 'javascript') {
      html = this.highlightJavascript(html);
    }
    html = this.highlightBraceVariables(html);
    if (text.endsWith('\n')) {
      html += '<br>';
    }
    this.highlightedContent = html;
  }

  private escapeHtml(t: string): string {
    return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  private highlightJson(html: string): string {
    return html.replace(
      /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
      (match) => {
        let cls = 'token-number';
        if (/^"/.test(match)) {
          cls = /:$/.test(match) ? 'token-key' : 'token-string';
        } else if (/true|false/.test(match)) {
          cls = 'token-boolean';
        } else if (/null/.test(match)) {
          cls = 'token-null';
        }
        return `<span class="${cls}">${match}</span>`;
      },
    );
  }

  private highlightXml(html: string): string {
    return html.replace(
      /(&lt;\/?[a-zA-Z0-9_\-:]+(?:\s+[a-zA-Z0-9_\-:]+(?:=&quot;[^&]*&quot;)?)*\s*\/?&gt;|&lt;!--[\s\S]*?--&gt;)/g,
      (match) => {
        if (match.startsWith('&lt;!--')) {
          return `<span class="token-comment">${match}</span>`;
        }
        return `<span class="token-key">${match}</span>`;
      },
    );
  }

  private highlightJavascript(html: string): string {
    const keywords =
      'break|case|catch|class|const|continue|debugger|default|delete|do|else|export|extends|false|finally|for|function|if|import|in|instanceof|new|null|return|super|switch|this|throw|true|try|typeof|var|void|while|let|static|yield|await|async';
    return html
      .replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*")/g, '<span class="token-string">$1</span>')
      .replace(/('(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\'])*')/g, '<span class="token-string">$1</span>')
      .replace(/(`[^`]*`)/g, '<span class="token-string">$1</span>')
      .replace(/(\/\/.*)/g, '<span class="token-comment">$1</span>')
      .replace(new RegExp(`\\b(${keywords})\\b`, 'g'), '<span class="token-keyword">$1</span>')
      .replace(/\b(\d+)\b/g, '<span class="token-number">$1</span>')
      .replace(/(\w+)(?=\()/g, '<span class="token-function">$1</span>');
  }

  /** Postman-style {varName} (runs after syntax spans are applied). */
  private highlightBraceVariables(html: string): string {
    return html.replace(/\{([a-zA-Z0-9_.-]+)\}/g, (_m, key: string) => {
      const defined = Object.prototype.hasOwnProperty.call(this.activeVariables, key);
      const val = this.activeVariables[key];
      const title = defined ? this.escapeHtml(String(val)) : 'Undefined';
      const cls = defined ? 'variable-highlight' : 'variable-highlight-error';
      return `<span class="${cls}" title="${title}">{${key}}</span>`;
    });
  }

  formatCode(): void {
    if (this.readonly) {
      return;
    }
    const ta = this.textarea?.nativeElement;
    const before = this.innerContent ?? '';
    const formatted = this.tryFormatContent(before);
    if (formatted === null || formatted === before) {
      return;
    }
    const start = ta?.selectionStart ?? before.length;
    const end = ta?.selectionEnd ?? start;
    this.innerContent = formatted;
    this.contentChange.emit(formatted);
    this.updateHighlighting();
    this.cdr.markForCheck();
    if (ta) {
      const nextStart = this.mapCaretBySignificantChars(before, formatted, start);
      const nextEnd = this.mapCaretBySignificantChars(before, formatted, end);
      requestAnimationFrame(() => {
        ta.selectionStart = Math.min(nextStart, formatted.length);
        ta.selectionEnd = Math.min(Math.max(nextEnd, ta.selectionStart), formatted.length);
        this.syncScroll();
      });
    }
  }

  /** Returns pretty-printed body or null if the language is unsupported or the content is not yet valid. */
  private tryFormatContent(raw: string): string | null {
    const trimmed = raw.trim();
    if (!trimmed) {
      return null;
    }
    if (this.language === 'json') {
      try {
        return JSON.stringify(JSON.parse(trimmed), null, 2);
      } catch {
        return null;
      }
    }
    if (this.language === 'xml') {
      return this.tryFormatXml(trimmed);
    }
    return null;
  }

  private tryFormatXml(trimmed: string): string | null {
    const parser = new DOMParser();
    const doc = parser.parseFromString(trimmed, 'application/xml');
    if (doc.querySelector('parsererror')) {
      return null;
    }
    const declMatch = trimmed.match(/^<\?xml[\s\S]*?\?>\s*/);
    const decl = declMatch ? declMatch[0].replace(/\s+$/, '') + '\n' : '';
    const root = doc.documentElement;
    if (!root) {
      return null;
    }
    const body = this.formatXmlElement(root, 0).replace(/\s+$/, '');
    return decl ? decl + body : body;
  }

  private escapeXmlAttr(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }

  private escapeXmlText(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  private formatXmlElement(el: Element, depth: number): string {
    const pad = '  '.repeat(depth);
    const name = el.tagName;
    let attrStr = '';
    for (let i = 0; i < el.attributes.length; i++) {
      const a = el.attributes[i];
      attrStr += ` ${a.name}="${this.escapeXmlAttr(a.value)}"`;
    }
    const childNodes = Array.from(el.childNodes);
    const hasChildElements = childNodes.some((c) => c.nodeType === Node.ELEMENT_NODE);

    if (childNodes.length === 0) {
      return `${pad}<${name}${attrStr}/>\n`;
    }

    if (!hasChildElements) {
      const inner = el.textContent ?? '';
      return `${pad}<${name}${attrStr}>${this.escapeXmlText(inner)}</${name}>\n`;
    }

    let out = `${pad}<${name}${attrStr}>\n`;
    const innerPad = '  '.repeat(depth + 1);
    for (const c of childNodes) {
      if (c.nodeType === Node.ELEMENT_NODE) {
        out += this.formatXmlElement(c as Element, depth + 1);
      } else if (c.nodeType === Node.TEXT_NODE) {
        const t = c.textContent || '';
        if (t.trim()) {
          out += `${innerPad}${this.escapeXmlText(t)}\n`;
        }
      } else if (c.nodeType === Node.COMMENT_NODE) {
        out += `${innerPad}<!--${(c as Comment).data}-->\n`;
      } else if (c.nodeType === Node.CDATA_SECTION_NODE) {
        out += `${innerPad}<![CDATA[${(c as CDATASection).data}]]>\n`;
      }
    }
    out += `${pad}</${name}>\n`;
    return out;
  }

  copyToClipboard(): void {
    void navigator.clipboard.writeText(this.innerContent);
  }

  syncScroll(): void {
    if (!this.textarea || !this.preBlock || !this.lineNumbers) {
      return;
    }
    const el = this.textarea.nativeElement;
    this.preBlock.nativeElement.scrollTop = el.scrollTop;
    this.preBlock.nativeElement.scrollLeft = el.scrollLeft;
    this.lineNumbers.nativeElement.scrollTop = el.scrollTop;
  }

  handleKeydown(event: KeyboardEvent): void {
    if (this.readonly) {
      return;
    }
    const ta = this.textarea.nativeElement;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const value = this.innerContent;

    if (event.key === 'Tab') {
      event.preventDefault();
      this.insertAtCaret(ta, start, end, '  ');
      return;
    }

    if (event.key === 'Enter' && start === end) {
      if (this.handleEnter(event, ta, start, end, value)) return;
    }

    if (event.key === 'Backspace' && start === end) {
      if (this.handleBackspacePair(event, ta, start, value)) return;
    }

    if (event.key === '>' && start === end && this.isXmlLike()) {
      if (this.handleXmlTagClose(event, ta, start, value)) return;
    }

    if (this.isAutoClosable(event)) {
      if (this.handleAutoClose(event, ta, start, end, value)) return;
    }
  }

  private isXmlLike(): boolean {
    return this.language === 'xml' || this.language === 'html';
  }

  /** True when the caret sits exactly between `<tag …>` and a matching `</tag>`. */
  private isBetweenMatchingXmlTags(value: string, caret: number): boolean {
    if (value[caret - 1] !== '>' || value[caret] !== '<') return false;

    const openEnd = caret - 1;
    const openStart = value.lastIndexOf('<', openEnd - 1);
    if (openStart === -1) return false;
    const openInner = value.substring(openStart + 1, openEnd);
    if (
      !openInner ||
      openInner.startsWith('/') ||
      openInner.startsWith('!') ||
      openInner.startsWith('?') ||
      openInner.endsWith('/') ||
      openInner.includes('<') ||
      openInner.includes('>')
    ) {
      return false;
    }
    const openName = openInner.match(/^([A-Za-z_][A-Za-z0-9_:.-]*)/)?.[1];
    if (!openName) return false;

    const closeStart = caret;
    const closeEnd = value.indexOf('>', closeStart + 1);
    if (closeEnd === -1) return false;
    const closeInner = value.substring(closeStart + 1, closeEnd);
    if (!closeInner.startsWith('/')) return false;
    const closeName = closeInner.substring(1).match(/^([A-Za-z_][A-Za-z0-9_:.-]*)/)?.[1];
    return closeName === openName;
  }

  private handleEnter(
    event: KeyboardEvent,
    ta: HTMLTextAreaElement,
    start: number,
    end: number,
    value: string,
  ): boolean {
    const lineStart = value.lastIndexOf('\n', start - 1) + 1;
    const currentLine = value.substring(lineStart, start);
    const currentIndent = currentLine.match(/^[ \t]*/)?.[0] ?? '';
    const prevChar = value[start - 1];
    const nextChar = value[start];

    const opensBlock = prevChar === '{' || prevChar === '[' || prevChar === '(';
    const closesBlock =
      (prevChar === '{' && nextChar === '}') ||
      (prevChar === '[' && nextChar === ']') ||
      (prevChar === '(' && nextChar === ')');

    if (opensBlock) {
      event.preventDefault();
      const innerIndent = currentIndent + '  ';
      if (closesBlock) {
        const insert = '\n' + innerIndent + '\n' + currentIndent;
        const caret = start + 1 + innerIndent.length;
        this.innerContent = value.substring(0, start) + insert + value.substring(end);
        this.queueCaret(ta, caret);
        this.onContentChange(this.innerContent);
      } else {
        const insert = '\n' + innerIndent;
        this.innerContent = value.substring(0, start) + insert + value.substring(end);
        this.queueCaret(ta, start + insert.length);
        this.onContentChange(this.innerContent);
      }
      return true;
    }

    if (this.isXmlLike() && this.isBetweenMatchingXmlTags(value, start)) {
      event.preventDefault();
      const innerIndent = currentIndent + '  ';
      const insert = '\n' + innerIndent + '\n' + currentIndent;
      const caret = start + 1 + innerIndent.length;
      this.innerContent = value.substring(0, start) + insert + value.substring(end);
      this.queueCaret(ta, caret);
      this.onContentChange(this.innerContent);
      return true;
    }

    if (currentIndent.length > 0) {
      event.preventDefault();
      const insert = '\n' + currentIndent;
      this.innerContent = value.substring(0, start) + insert + value.substring(end);
      this.queueCaret(ta, start + insert.length);
      this.onContentChange(this.innerContent);
      return true;
    }
    return false;
  }

  /** Pairs inserted when the opener is typed. */
  private readonly autoClosePairs: Record<string, string> = {
    '{': '}',
    '[': ']',
    '(': ')',
    '"': '"',
    "'": "'",
    '`': '`',
  };

  private isAutoClosable(event: KeyboardEvent): boolean {
    if (event.ctrlKey || event.metaKey || event.altKey) return false;
    if (event.key.length !== 1) return false;
    const key = event.key;
    return (
      key in this.autoClosePairs ||
      key === '}' ||
      key === ']' ||
      key === ')'
    );
  }

  /**
   * - Typing an opener with a selection wraps the selection (`"foo"` → `"\"foo\""`).
   * - Typing an opener with no selection inserts the matching closer and leaves the caret in between.
   * - Typing a closer while the caret already sits on that same closer steps over it instead of duplicating.
   * - Inside XML/HTML, quote auto-closing is skipped to avoid interfering with `attr="..."` typing.
   */
  private handleAutoClose(
    event: KeyboardEvent,
    ta: HTMLTextAreaElement,
    start: number,
    end: number,
    value: string,
  ): boolean {
    const key = event.key;
    const closer = this.autoClosePairs[key];

    if (closer) {
      if (this.isQuote(key) && !this.shouldAutoCloseQuote(key, start, end, value)) {
        return false;
      }

      if (start !== end) {
        event.preventDefault();
        const selected = value.substring(start, end);
        const insert = key + selected + closer;
        this.innerContent = value.substring(0, start) + insert + value.substring(end);
        this.onContentChange(this.innerContent);
        this.queueSelection(ta, start + 1, start + 1 + selected.length);
        return true;
      }

      event.preventDefault();
      const insert = key + closer;
      this.innerContent = value.substring(0, start) + insert + value.substring(end);
      this.onContentChange(this.innerContent);
      this.queueCaret(ta, start + 1);
      return true;
    }

    if ((key === '}' || key === ']' || key === ')') && start === end && value[start] === key) {
      event.preventDefault();
      this.queueCaret(ta, start + 1);
      return true;
    }
    return false;
  }

  private isQuote(key: string): boolean {
    return key === '"' || key === "'" || key === '`';
  }

  /** Avoid doubling up when the caret already sits on a quote and avoid pairing inside identifiers (e.g. `isn't`). */
  private shouldAutoCloseQuote(key: string, start: number, end: number, value: string): boolean {
    if (start === end && value[start] === key) return false;
    const prev = value[start - 1];
    if (prev && /[A-Za-z0-9_]/.test(prev)) return false;
    return true;
  }

  /**
   * When the user finishes typing an opening tag (`<foo>` or `<foo attr="bar">`), insert the
   * matching `</foo>` after the caret so the structure is balanced. Skipped for self-closing
   * tags (`<br/>`), comments (`<!-- -->`), processing instructions (`<?xml ?>`), and closers (`</foo>`).
   */
  private handleXmlTagClose(
    event: KeyboardEvent,
    ta: HTMLTextAreaElement,
    start: number,
    value: string,
  ): boolean {
    const lt = value.lastIndexOf('<', start - 1);
    if (lt === -1) return false;
    const tagBody = value.substring(lt + 1, start);
    if (!tagBody || tagBody.includes('<') || tagBody.includes('>')) return false;
    if (tagBody.startsWith('/') || tagBody.startsWith('!') || tagBody.startsWith('?')) return false;
    if (tagBody.endsWith('/')) return false;

    const nameMatch = tagBody.match(/^([A-Za-z_][A-Za-z0-9_:.-]*)/);
    if (!nameMatch) return false;
    const tagName = nameMatch[1];

    event.preventDefault();
    const insert = '>' + '</' + tagName + '>';
    this.innerContent = value.substring(0, start) + insert + value.substring(start);
    this.onContentChange(this.innerContent);
    this.queueCaret(ta, start + 1);
    return true;
  }

  /** Deletes the empty pair if Backspace is pressed between a just-opened pair. */
  private handleBackspacePair(
    event: KeyboardEvent,
    ta: HTMLTextAreaElement,
    start: number,
    value: string,
  ): boolean {
    const prev = value[start - 1];
    const next = value[start];
    if (!prev || !next) return false;
    const expected = this.autoClosePairs[prev];
    if (!expected || expected !== next) return false;

    event.preventDefault();
    this.innerContent = value.substring(0, start - 1) + value.substring(start + 1);
    this.onContentChange(this.innerContent);
    this.queueCaret(ta, start - 1);
    return true;
  }

  private insertAtCaret(ta: HTMLTextAreaElement, start: number, end: number, text: string): void {
    const value = this.innerContent;
    this.innerContent = value.substring(0, start) + text + value.substring(end);
    this.queueCaret(ta, start + text.length);
    this.onContentChange(this.innerContent);
  }

  private queueCaret(ta: HTMLTextAreaElement, pos: number): void {
    setTimeout(() => {
      ta.selectionStart = ta.selectionEnd = pos;
    }, 0);
  }

  private queueSelection(ta: HTMLTextAreaElement, start: number, end: number): void {
    setTimeout(() => {
      ta.selectionStart = start;
      ta.selectionEnd = end;
    }, 0);
  }
}
