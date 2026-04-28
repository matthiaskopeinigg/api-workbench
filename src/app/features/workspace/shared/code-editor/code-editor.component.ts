import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  OnChanges,
  OnDestroy,
  OnInit,
  Output,
  ViewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { KeyboardShortcutsService } from '@core/keyboard/keyboard-shortcuts.service';
import { DYNAMIC_BARE_RE, DYNAMIC_BRACED_RE, DYNAMIC_PLACEHOLDER_TOOLTIPS } from '@core/placeholders/dynamic-placeholders';
import { CodeJsHighlightMirrorComponent } from './code-js-highlight-mirror.component';
import { SafeHtmlPipe } from '@shared-app/pipes/safe-html.pipe';

export type EditorLanguage =
  | 'json'
  | 'xml'
  | 'javascript'
  | 'plain'
  | 'html'
  | 'graphql'
  | 'python';

/** Suggestions for pre/post request scripts (Ctrl+Space). */
export interface ScriptCompletionItem {
  label: string;
  insert: string;
  detail?: string;
}

const PM_SCRIPT_COMPLETIONS: ScriptCompletionItem[] = [
  { label: 'console.log()', insert: 'console.log()', detail: 'Log to the script console' },
  { label: 'console.info()', insert: 'console.info()', detail: 'Info log' },
  { label: 'console.warn()', insert: 'console.warn()', detail: 'Warning log' },
  { label: 'console.error()', insert: 'console.error()', detail: 'Error log' },
  { label: 'pm.environment.get()', insert: 'pm.environment.get("")', detail: 'Read environment variable' },
  { label: 'pm.environment.set()', insert: 'pm.environment.set("", "")', detail: 'Set environment variable' },
  { label: 'pm.environment.unset()', insert: 'pm.environment.unset("")', detail: 'Remove environment variable' },
  { label: 'pm.environment.has()', insert: 'pm.environment.has("")', detail: 'True if key exists' },
  { label: 'pm.environment.toObject()', insert: 'pm.environment.toObject()', detail: 'Copy of environment' },
  { label: 'pm.globals.get()', insert: 'pm.globals.get("")', detail: 'Read global variable' },
  { label: 'pm.globals.set()', insert: 'pm.globals.set("", "")', detail: 'Set global variable' },
  { label: 'pm.globals.unset()', insert: 'pm.globals.unset("")', detail: 'Remove global variable' },
  { label: 'pm.globals.has()', insert: 'pm.globals.has("")', detail: 'True if key exists' },
  { label: 'pm.globals.toObject()', insert: 'pm.globals.toObject()', detail: 'Copy of globals' },
  { label: 'pm.variables.get()', insert: 'pm.variables.get("")', detail: 'Collection variable' },
  { label: 'pm.variables.set()', insert: 'pm.variables.set("", "")', detail: 'Set collection variable' },
  { label: 'pm.variables.unset()', insert: 'pm.variables.unset("")', detail: 'Unset collection variable' },
  { label: 'pm.variables.has()', insert: 'pm.variables.has("")', detail: 'True if key exists' },
  { label: 'pm.variables.toObject()', insert: 'pm.variables.toObject()', detail: 'Copy of collection vars' },
  { label: 'pm.collectionVariables.get()', insert: 'pm.collectionVariables.get("")', detail: 'Alias of pm.variables' },
  { label: 'pm.collectionVariables.set()', insert: 'pm.collectionVariables.set("", "")', detail: 'Alias of pm.variables' },
  { label: 'pm.session.get()', insert: 'pm.session.get("")', detail: 'App session / login token store' },
  { label: 'pm.session.set()', insert: 'pm.session.set("", "")', detail: 'Set session value' },
  { label: 'pm.session.unset()', insert: 'pm.session.unset("")', detail: 'Remove session key' },
  { label: 'pm.session.has()', insert: 'pm.session.has("")', detail: 'True if key exists' },
  { label: 'pm.session.toObject()', insert: 'pm.session.toObject()', detail: 'Copy of session' },
  { label: 'pm.request.method', insert: 'pm.request.method', detail: 'HTTP method' },
  { label: 'pm.request.url', insert: 'pm.request.url', detail: 'Request URL object' },
  { label: 'pm.request.url.raw', insert: 'pm.request.url.raw', detail: 'URL string' },
  { label: 'pm.request.url.toString()', insert: 'pm.request.url.toString()', detail: 'URL string' },
  { label: 'pm.request.headers.get()', insert: 'pm.request.headers.get("")', detail: 'Request header value' },
  { label: 'pm.request.headers.all()', insert: 'pm.request.headers.all()', detail: 'All request headers' },
  { label: 'pm.request.body', insert: 'pm.request.body', detail: 'Request body' },
  { label: 'pm.response', insert: 'pm.response', detail: 'Response (post-request only)' },
  { label: 'pm.response.code', insert: 'pm.response.code', detail: 'HTTP status code' },
  { label: 'pm.response.status', insert: 'pm.response.status', detail: 'Status text' },
  { label: 'pm.response.responseTime', insert: 'pm.response.responseTime', detail: 'Elapsed ms' },
  { label: 'pm.response.responseSize', insert: 'pm.response.responseSize', detail: 'Body size' },
  { label: 'pm.response.text()', insert: 'pm.response.text()', detail: 'Body as string' },
  { label: 'pm.response.json()', insert: 'pm.response.json()', detail: 'Parse body as JSON' },
  { label: 'pm.response.headers.get()', insert: 'pm.response.headers.get("")', detail: 'Response header' },
  { label: 'pm.response.headers.has()', insert: 'pm.response.headers.has("")', detail: 'True if header present' },
  { label: 'pm.response.headers.all()', insert: 'pm.response.headers.all()', detail: 'All response headers' },
  { label: 'pm.response.to.have.status()', insert: 'pm.response.to.have.status(200)', detail: 'Assert status code' },
  { label: 'pm.response.to.have.header()', insert: 'pm.response.to.have.header("")', detail: 'Assert header exists' },
  { label: 'pm.response.to.have.body()', insert: 'pm.response.to.have.body("")', detail: 'Assert body contains' },
  { label: 'pm.response.to.be.ok()', insert: 'pm.response.to.be.ok()', detail: 'Assert 2xx status' },
  { label: 'pm.test()', insert: "pm.test('name', () => {\n  \n});", detail: 'Named test block' },
  { label: 'pm.expect()', insert: 'pm.expect()', detail: 'Assertion chain' },
  { label: 'expect()', insert: 'expect()', detail: 'Top-level assertion (same as pm.expect)' },
  { label: 'pm.sendRequest()', insert: "pm.sendRequest('', (err, res) => {\n  \n});", detail: 'Fire nested HTTP request' },
  { label: 'JSON.parse()', insert: 'JSON.parse()', detail: 'Parse JSON string' },
  { label: 'JSON.stringify()', insert: 'JSON.stringify(, null, 2)', detail: 'Serialize to JSON' },
  { label: 'url.parse()', insert: 'url.parse()', detail: 'Node url module' },
  { label: 'crypto.randomUUID()', insert: 'crypto.randomUUID()', detail: 'Random UUID' },
  { label: 'Buffer.from()', insert: 'Buffer.from("")', detail: 'Create buffer' },
];

@Component({
  selector: 'app-code-editor',
  standalone: true,
  imports: [CommonModule, FormsModule, CodeJsHighlightMirrorComponent, SafeHtmlPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './code-editor.component.html',
  styleUrl: './code-editor.component.scss',
})
export class CodeEditorComponent implements OnInit, OnChanges, AfterViewInit, OnDestroy {
  @ViewChild('textarea') textarea!: ElementRef<HTMLTextAreaElement>;
  @ViewChild('preBlock') preBlock?: ElementRef<HTMLPreElement>;
  @ViewChild(CodeJsHighlightMirrorComponent) jsMirror?: CodeJsHighlightMirrorComponent;
  @ViewChild('lineNumbers') lineNumbers!: ElementRef<HTMLDivElement>;

  @Input() language: EditorLanguage = 'json';
  @Input() title?: string;
  @Input() content = '';
  @Input() readonly = false;
  @Input() activeVariables: Record<string, string> = {};
  @Input() hideToolbar = false;
  /** When true (default), JSON/XML bodies are pretty-printed after a short pause while typing. Set false for bulk plain fields. */
  @Input() autoFormat = true;
  /** When true, Ctrl+Space / typing `pm.` opens `pm.*` completions for JavaScript scripts. */
  @Input() scriptAutocomplete = false;
  /** When true, Ctrl+Space / typing `{{` / `$` opens placeholder suggestions. */
  @Input() placeholderAutocomplete = false;
  /** Placeholder completion items inserted into the editor as-is. */
  @Input() placeholderCompletions: ScriptCompletionItem[] = [];

  @Output() contentChange = new EventEmitter<string>();

  innerContent = '';
  highlightedContent = '';
  lines: number[] = [1];

  completionVisible = false;
  completionFiltered: ScriptCompletionItem[] = [];
  completionActiveIndex = 0;
  private completionMode: 'script' | 'placeholder' = 'script';

  private readonly autoFormatDebounceMs = 420;
  private autoFormatTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private cdr: ChangeDetectorRef,
    private hostRef: ElementRef<HTMLElement>,
    private keyboardShortcuts: KeyboardShortcutsService,
  ) {}

  @HostListener('document:mousedown', ['$event'])
  onDocumentMouseDown(ev: MouseEvent): void {
    if (!this.completionVisible) {
      return;
    }
    const t = ev.target as Node | null;
    if (t && this.hostRef.nativeElement.contains(t)) {
      return;
    }
    this.closeCompletion();
  }

  ngOnDestroy(): void {
    this.clearAutoFormatTimer();
  }

  ngOnInit(): void {
    this.applyJavascriptSanitizeFromParent(this.content ?? '', true);
    this.updateHighlighting();
  }

  ngOnChanges(): void {
    const raw = this.content ?? '';
    const taFocused = this.isTextareaFocused();
    if (this.language === 'javascript') {
      const leakRaw = this.jsContentLikelyContainsHighlighterLeak(raw);
      const leakInner = this.jsContentLikelyContainsHighlighterLeak(this.innerContent ?? '');
      /** Never skip when the model still contains overlay markup — user often stays focused here. */
      if (leakRaw || leakInner) {
        const baseline = leakRaw ? raw : (this.innerContent ?? '');
        const next = this.stripPastedSyntaxHighlightMarkup(baseline);
        this.innerContent = next;
        if (!this.readonly && next !== raw) {
          queueMicrotask(() => this.contentChange.emit(next));
        }
      } else if (raw !== this.innerContent && !taFocused) {
        this.innerContent = raw;
      }
    } else if (raw !== this.innerContent && !taFocused) {
      this.innerContent = raw;
    }
    this.updateHighlighting();
    this.cdr.markForCheck();
  }

  /**
   * Highlighter leak cleanup used to run only on keystrokes; saved scripts then kept garbage like
   * `class="token-string">` forever. Normalize when binding loads or parent replaces `content`.
   */
  private applyJavascriptSanitizeFromParent(raw: string, emitIfChanged: boolean): void {
    const next =
      this.language === 'javascript' ? this.stripPastedSyntaxHighlightMarkup(raw) : raw;
    this.innerContent = next;
    if (
      emitIfChanged &&
      !this.readonly &&
      this.language === 'javascript' &&
      next !== raw
    ) {
      queueMicrotask(() => this.contentChange.emit(next));
    }
  }

  ngAfterViewInit(): void {
    this.syncScroll();
  }

  /** Clipboard `text/html` from the highlight layer (or the web) must never become textarea text. */
  /** Last chance to strip highlighter HTML if it ever landed in the model while the field had focus. */
  onTextareaBlur(): void {
    if (this.readonly || this.language !== 'javascript') {
      return;
    }
    if (this.stripJavascriptHighlighterLeakFromModel(true)) {
      this.updateHighlighting();
      this.cdr.markForCheck();
    }
  }

  /**
   * If `innerContent` contains highlighter HTML meant for the mirror only, strip it and optionally
   * notify the parent. Returns true when `innerContent` was changed.
   */
  private stripJavascriptHighlighterLeakFromModel(emitSync: boolean): boolean {
    if (this.language !== 'javascript') {
      return false;
    }
    const v = this.innerContent ?? '';
    if (!this.jsContentLikelyContainsHighlighterLeak(v)) {
      return false;
    }
    const cleaned = this.stripPastedSyntaxHighlightMarkup(v);
    if (cleaned === v) {
      return false;
    }
    this.innerContent = cleaned;
    if (!this.readonly) {
      if (emitSync) {
        this.contentChange.emit(cleaned);
      } else {
        queueMicrotask(() => this.contentChange.emit(cleaned));
      }
    }
    this.reconcileCaretAfterLengthChange(cleaned.length);
    return true;
  }

  onPaste(ev: ClipboardEvent): void {
    if (this.readonly) {
      return;
    }
    const dt = ev.clipboardData;
    if (!dt || !dt.types.includes('text/plain')) {
      return;
    }
    ev.preventDefault();
    const plain = dt.getData('text/plain');
    const ta = this.textarea?.nativeElement;
    if (!ta) {
      return;
    }
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const value = this.innerContent ?? '';
    this.innerContent = value.slice(0, start) + plain + value.slice(end);
    this.queueCaret(ta, start + plain.length);
    this.onContentChange(this.innerContent);
  }

  onContentChange(value: string): void {
    let v = value;
    if (this.language === 'javascript') {
      const cleaned = this.stripPastedSyntaxHighlightMarkup(v);
      if (cleaned !== v) {
        v = cleaned;
        this.innerContent = v;
        this.contentChange.emit(v);
        this.updateHighlighting();
        this.scheduleAutoFormat();
        this.reconcileCaretAfterLengthChange(v.length);
        if (this.completionVisible) {
          this.refreshCompletionFilter();
        }
        this.maybeOpenCompletionAfterPmDot();
        this.maybeOpenPlaceholderCompletionAfterTrigger();
        return;
      }
    }
    this.innerContent = v;
    this.contentChange.emit(v);
    this.updateHighlighting();
    this.scheduleAutoFormat();
    if (this.completionVisible) {
      this.refreshCompletionFilter();
    }
    this.maybeOpenCompletionAfterPmDot();
    this.maybeOpenPlaceholderCompletionAfterTrigger();
  }

  /**
   * When someone copies the highlighted `pre>code` layer (e.g. from DevTools) and pastes into the
   * textarea, our span wrappers can end up in the saved script and break the script.
   * Partial tags (e.g. `n-string">`) must be removed too — they do not contain `<span`.
   */
  private jsContentLikelyContainsHighlighterLeak(text: string): boolean {
    return (
      /<span/i.test(text) ||
      /<\/span/i.test(text) ||
      /data-tok=/i.test(text) ||
      /class="token-/i.test(text) ||
      /-string">/i.test(text) ||
      /-keyword">/i.test(text) ||
      /-number">/i.test(text) ||
      /-function">/i.test(text) ||
      /-comment">/i.test(text) ||
      /-key">/i.test(text) ||
      /variable-highlight/i.test(text)
    );
  }

  private stripPastedSyntaxHighlightMarkup(text: string): string {
    if (!text || !this.jsContentLikelyContainsHighlighterLeak(text)) {
      return text;
    }
    const tokenTail = '(?:string|keyword|number|boolean|null|function|comment|key|punctuation|attribute)';
    const mangledClose = new RegExp(
      `(?:^|([^A-Za-z0-9_.-]))([\\w-]{0,20}-${tokenTail})">`,
      'gi',
    );
    let s = text;
    let prev = '';
    let guard = 0;
    while (s !== prev && guard++ < 48) {
      prev = s;
      s = s
        .replace(/<span[^>]*>/gi, '')
        .replace(/<\/span>/gi, '')
        .replace(/data-tok="[^"]*">?/gi, '')
        .replace(/class="token-[a-z-]+">?/gi, '')
        .replace(/class="variable-highlight(-error)?">?/gi, '')
        // Half-pasted fragments like `)n-string">` (broken `token-string">`)
        .replace(mangledClose, (_, delim: string | undefined) => (delim ?? ''));
    }
    return s;
  }

  private reconcileCaretAfterLengthChange(newLength: number): void {
    const ta = this.textarea?.nativeElement;
    if (!ta) {
      return;
    }
    const start = Math.min(ta.selectionStart, newLength);
    const end = Math.min(ta.selectionEnd, newLength);
    requestAnimationFrame(() => {
      ta.setSelectionRange(start, end);
    });
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
    this.stripJavascriptHighlighterLeakFromModel(false);
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
    html = this.highlightBracedDynamicInHtml(html);
    html = this.highlightDynamicPlaceholdersInHtml(html);
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
    /** Use `data-tok` (not `class="token-…"`) so later `\bclass\b` etc. never match inside our own markup. */
    return html
      .replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*)"/g, (m) => `<span data-tok="s">${m}</span>`)
      .replace(/('(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\'])*')/g, (m) => `<span data-tok="s">${m}</span>`)
      .replace(/(`[^`]*`)/g, (m) => `<span data-tok="s">${m}</span>`)
      .replace(/(\/\/.*)/g, (m) => `<span data-tok="c">${m}</span>`)
      .replace(new RegExp(`\\b(${keywords})\\b`, 'g'), (m) => `<span data-tok="k">${m}</span>`)
      .replace(/\b(\d+)\b/g, (m) => `<span data-tok="n">${m}</span>`)
      .replace(/(\w+)(?=\()/g, (m) => `<span data-tok="f">${m}</span>`);
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

  private highlightBracedDynamicInHtml(html: string): string {
    const re = new RegExp(DYNAMIC_BRACED_RE.source, DYNAMIC_BRACED_RE.flags);
    return html.replace(re, (full, name: string) => {
      const tip = DYNAMIC_PLACEHOLDER_TOOLTIPS[name] ?? 'Value generated when the request is sent';
      return `<span class="variable-highlight" title="${this.escapeTitleAttr(tip)}">${full}</span>`;
    });
  }

  /** e.g. `trace-$uuid` in JSON bodies — same class as `{{name}}` in variable inputs. */
  private highlightDynamicPlaceholdersInHtml(html: string): string {
    const re = new RegExp(DYNAMIC_BARE_RE.source, DYNAMIC_BARE_RE.flags);
    return html.replace(re, (full, name: string) => {
      const tip = DYNAMIC_PLACEHOLDER_TOOLTIPS[name] ?? 'Value generated when the request is sent';
      return `<span class="variable-highlight" title="${this.escapeTitleAttr(tip)}">${full}</span>`;
    });
  }

  private escapeTitleAttr(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
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
    if (!this.textarea || !this.lineNumbers) {
      return;
    }
    const el = this.textarea.nativeElement;
    const top = el.scrollTop;
    const left = el.scrollLeft;
    if (this.language === 'javascript' && this.jsMirror) {
      this.jsMirror.syncFromTextarea(top, left);
    } else if (this.preBlock) {
      this.preBlock.nativeElement.scrollTop = top;
      this.preBlock.nativeElement.scrollLeft = left;
    }
    this.lineNumbers.nativeElement.scrollTop = top;
  }

  /** Copy/cut/paste/select-all and undo/redo stay native on the textarea. */
  private passthroughNativeModTextareaShortcut(ev: KeyboardEvent): boolean {
    const mod = ev.ctrlKey || ev.metaKey;
    if (!mod || ev.altKey) {
      return false;
    }
    switch (ev.code) {
      case 'KeyC':
      case 'KeyV':
      case 'KeyX':
      case 'KeyA':
      case 'KeyZ':
      case 'KeyY':
        return true;
      default:
        return false;
    }
  }

  private lineBlockBounds(
    value: string,
    start: number,
    end: number,
  ): { lineStart: number; lineEndExclusive: number } {
    const a = Math.min(start, end);
    const b = Math.max(start, end);
    const lineStart = value.lastIndexOf('\n', a - 1) + 1;
    const nl = value.indexOf('\n', b);
    const lineEndExclusive = nl === -1 ? value.length : nl + 1;
    return { lineStart, lineEndExclusive };
  }

  private duplicateLineBlock(ta: HTMLTextAreaElement, value: string, start: number, end: number): void {
    const { lineStart, lineEndExclusive } = this.lineBlockBounds(value, start, end);
    const segment = value.substring(lineStart, lineEndExclusive);
    this.innerContent = value.substring(0, lineEndExclusive) + segment + value.substring(lineEndExclusive);
    const newPos = lineEndExclusive + (start - lineStart);
    this.onContentChange(this.innerContent);
    this.queueCaret(ta, newPos);
  }

  /** `//` for JS-like languages, `#` for Python; no-op for JSON/XML. */
  private editorLineCommentToken(): string | null {
    if (this.language === 'json' || this.language === 'xml') {
      return null;
    }
    if (this.language === 'python') {
      return '# ';
    }
    return '// ';
  }

  private toggleLineCommentBlock(ta: HTMLTextAreaElement, value: string, start: number, end: number): boolean {
    const token = this.editorLineCommentToken();
    if (!token) {
      return false;
    }
    const { lineStart, lineEndExclusive } = this.lineBlockBounds(value, start, end);
    const block = value.substring(lineStart, lineEndExclusive);
    const lines = block.split('\n');
    const isHash = token.startsWith('#');
    const outLines = lines.map((line) => {
      const m = line.match(/^(\s*)(.*)$/);
      const ind = m?.[1] ?? '';
      const rest = m?.[2] ?? '';
      if (isHash) {
        if (/^#\s?/.test(rest)) {
          return ind + rest.replace(/^#\s?/, '');
        }
        return ind + '# ' + rest;
      }
      if (/^\/\/\s?/.test(rest)) {
        return ind + rest.replace(/^\/\/\s?/, '');
      }
      return ind + '// ' + rest;
    });
    const nextBlock = outLines.join('\n');
    const delta = nextBlock.length - block.length;
    this.innerContent = value.substring(0, lineStart) + nextBlock + value.substring(lineEndExclusive);
    this.onContentChange(this.innerContent);
    const na = Math.min(start, end);
    const nb = Math.max(start, end);
    this.queueSelection(ta, na, nb + delta);
    return true;
  }

  private moveLineBlock(
    ta: HTMLTextAreaElement,
    value: string,
    start: number,
    end: number,
    dir: 'up' | 'down',
  ): boolean {
    const { lineStart, lineEndExclusive } = this.lineBlockBounds(value, start, end);
    const currLen = lineEndExclusive - lineStart;
    if (dir === 'up') {
      if (lineStart === 0) {
        return false;
      }
      const prevNl = value.lastIndexOf('\n', lineStart - 2);
      const prevLineStart = prevNl + 1;
      const prevBlock = value.substring(prevLineStart, lineStart);
      const currBlock = value.substring(lineStart, lineEndExclusive);
      const next =
        value.substring(0, prevLineStart) + currBlock + prevBlock + value.substring(lineEndExclusive);
      const map = (p: number): number => {
        if (p >= lineStart && p < lineEndExclusive) {
          return prevLineStart + (p - lineStart);
        }
        if (p >= prevLineStart && p < lineStart) {
          return prevLineStart + currLen + (p - prevLineStart);
        }
        return p;
      };
      this.innerContent = next;
      this.onContentChange(this.innerContent);
      this.queueSelection(ta, map(start), map(end));
      return true;
    }
    if (lineEndExclusive >= value.length) {
      return false;
    }
    const nextLineStart = lineEndExclusive;
    let nextLineEnd = value.indexOf('\n', nextLineStart);
    if (nextLineEnd === -1) {
      nextLineEnd = value.length;
    } else {
      nextLineEnd += 1;
    }
    const afterBlock = value.substring(nextLineStart, nextLineEnd);
    const currBlock = value.substring(lineStart, lineEndExclusive);
    const join = afterBlock.length > 0 && !afterBlock.endsWith('\n') ? '\n' : '';
    const middle = afterBlock + join + currBlock;
    const next = value.substring(0, lineStart) + middle + value.substring(nextLineEnd);
    const gap = afterBlock.length + join.length;
    const map = (p: number): number => {
      if (p >= lineStart && p < lineEndExclusive) {
        return lineStart + gap + (p - lineStart);
      }
      if (p >= nextLineStart && p < nextLineEnd) {
        return lineStart + (p - nextLineStart);
      }
      return p;
    };
    this.innerContent = next;
    this.onContentChange(this.innerContent);
    this.queueSelection(ta, map(start), map(end));
    return true;
  }

  handleKeydown(event: KeyboardEvent): void {
    if (this.readonly) {
      return;
    }
    const ta = this.textarea.nativeElement;
    this.reconcileTextareaDomWithModelForKeydown(ta);
    const start = Math.min(ta.selectionStart, (this.innerContent ?? '').length);
    const end = Math.min(Math.max(ta.selectionEnd, start), (this.innerContent ?? '').length);
    const value = this.innerContent;

    if (this.passthroughNativeModTextareaShortcut(event)) {
      return;
    }

    if (this.completionVisible && this.handleCompletionKeydown(event, ta)) {
      return;
    }
    if (this.scriptAutocomplete && this.language === 'javascript') {
      if (event.ctrlKey && !event.metaKey && event.code === 'Space') {
        event.preventDefault();
        this.openCompletion(ta, 'script');
        return;
      }
    }
    if (this.placeholderAutocomplete) {
      if (event.ctrlKey && !event.metaKey && event.code === 'Space') {
        event.preventDefault();
        this.openCompletion(ta, 'placeholder');
        return;
      }
    }

    if (this.keyboardShortcuts.matchesEditorAction('editor.duplicateLine', event)) {
      event.preventDefault();
      this.duplicateLineBlock(ta, value, start, end);
      return;
    }
    if (this.keyboardShortcuts.matchesEditorAction('editor.toggleLineComment', event)) {
      if (this.toggleLineCommentBlock(ta, value, start, end)) {
        event.preventDefault();
        return;
      }
    }
    if (this.keyboardShortcuts.matchesEditorAction('editor.moveLineUp', event)) {
      if (this.moveLineBlock(ta, value, start, end, 'up')) {
        event.preventDefault();
        return;
      }
    }
    if (this.keyboardShortcuts.matchesEditorAction('editor.moveLineDown', event)) {
      if (this.moveLineBlock(ta, value, start, end, 'down')) {
        event.preventDefault();
        return;
      }
    }

    if (event.key === 'Tab' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      this.insertAtCaret(ta, start, end, '  ');
      return;
    }

    if (
      event.key === 'Enter' &&
      start === end &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
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
  /**
   * Caret offsets come from the textarea DOM; edits use `innerContent`. If those strings differ
   * (e.g. leaked highlight markup in `.value`), splicing at `start` corrupts the script. Prefer DOM
   * text for JS, strip leaks, then force `.value` and `innerContent` to match before key handling.
   */
  private reconcileTextareaDomWithModelForKeydown(ta: HTMLTextAreaElement): void {
    const fromDom = ta.value;
    const model = this.innerContent ?? '';
    if (fromDom === model) {
      return;
    }
    let next: string;
    if (this.language === 'javascript') {
      next = this.jsContentLikelyContainsHighlighterLeak(fromDom)
        ? this.stripPastedSyntaxHighlightMarkup(fromDom)
        : fromDom;
    } else {
      next = fromDom;
    }
    if (next !== model) {
      this.innerContent = next;
      ta.value = next;
      if (!this.readonly) {
        this.contentChange.emit(next);
      }
    } else {
      ta.value = model;
    }
    const len = (this.innerContent ?? '').length;
    ta.setSelectionRange(Math.min(ta.selectionStart, len), Math.min(ta.selectionEnd, len));
  }

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
    if (this.language === 'javascript' && prev && ';)]},'.includes(prev)) {
      return false;
    }
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

  private maybeOpenCompletionAfterPmDot(): void {
    if (!this.scriptAutocomplete || this.language !== 'javascript' || this.readonly) {
      return;
    }
    const ta = this.textarea?.nativeElement;
    if (!ta) {
      return;
    }
    requestAnimationFrame(() => {
      if (!this.textarea || document.activeElement !== this.textarea.nativeElement) {
        return;
      }
      const t = this.textarea.nativeElement;
      const v = this.innerContent ?? '';
      const c = Math.max(0, Math.min(t.selectionStart, v.length));
      if (c >= 3 && v.substring(c - 3, c) === 'pm.') {
        this.openCompletion(t, 'script');
      }
    });
  }

  private maybeOpenPlaceholderCompletionAfterTrigger(): void {
    if (!this.placeholderAutocomplete || this.readonly) {
      return;
    }
    const ta = this.textarea?.nativeElement;
    if (!ta) return;
    requestAnimationFrame(() => {
      if (!this.textarea || document.activeElement !== this.textarea.nativeElement) {
        return;
      }
      const t = this.textarea.nativeElement;
      const v = this.innerContent ?? '';
      const c = Math.max(0, Math.min(t.selectionStart, v.length));
      const before = v.substring(0, c);
      const tail = v.substring(Math.max(0, c - 4), c);
      if (tail.endsWith('{{') || tail.endsWith('{{ ') || /\$[A-Za-z0-9_]*$/.test(before)) {
        this.openCompletion(t, 'placeholder');
      }
    });
  }

  private openCompletion(ta: HTMLTextAreaElement, mode: 'script' | 'placeholder'): void {
    this.completionMode = mode;
    this.completionVisible = true;
    this.completionActiveIndex = 0;
    this.refreshCompletionFilter(ta);
    this.cdr.markForCheck();
    requestAnimationFrame(() => ta.focus());
  }

  private closeCompletion(): void {
    this.completionVisible = false;
    this.completionFiltered = [];
    this.completionActiveIndex = 0;
    this.cdr.markForCheck();
  }

  private lineBeforeCaretIsWhitespaceOnly(value: string, caret: number): boolean {
    const lineStart = value.lastIndexOf('\n', caret - 1) + 1;
    return value.substring(lineStart, caret).trim() === '';
  }

  private canApplyScriptCompletion(value: string, caret: number): boolean {
    const { prefix } = this.getScriptPrefixBeforeCaret(value, caret);
    if (prefix.length > 0) {
      return true;
    }
    return this.lineBeforeCaretIsWhitespaceOnly(value, caret);
  }

  private getScriptPrefixBeforeCaret(value: string, caret: number): { start: number; prefix: string } {
    const c = Math.max(0, Math.min(caret, value.length));
    let i = c - 1;
    while (i >= 0 && /[\w.]/.test(value[i])) {
      i--;
    }
    const start = i + 1;
    return { start, prefix: value.substring(start, c) };
  }

  private getPlaceholderPrefixBeforeCaret(value: string, caret: number): { start: number; prefix: string } {
    const c = Math.max(0, Math.min(caret, value.length));
    const before = value.substring(0, c);
    const braceMatch = /\{\{\s*([A-Za-z0-9._$-]*)$/.exec(before);
    if (braceMatch) {
      const prefix = braceMatch[1] ?? '';
      return { start: c - prefix.length, prefix };
    }
    const dollarMatch = /\$([A-Za-z0-9_]*)$/.exec(before);
    if (dollarMatch) {
      const prefix = dollarMatch[1] ?? '';
      return { start: c - prefix.length - 1, prefix: `$${prefix}` };
    }
    return { start: c, prefix: '' };
  }

  private refreshCompletionFilter(ta?: HTMLTextAreaElement): void {
    if (this.completionMode === 'placeholder') {
      this.refreshPlaceholderCompletionFilter(ta);
      return;
    }
    const el = ta ?? this.textarea?.nativeElement;
    const v = this.innerContent ?? '';
    const caret = el ? Math.min(el.selectionStart, v.length) : v.length;
    const { prefix } = this.getScriptPrefixBeforeCaret(v, caret);
    const pl = prefix.toLowerCase();
    const matches = PM_SCRIPT_COMPLETIONS.filter(
      (item) =>
        !pl ||
        item.label.toLowerCase().includes(pl) ||
        item.insert.toLowerCase().includes(pl) ||
        (item.detail && item.detail.toLowerCase().includes(pl)),
    );
    const ranked = this.rankCompletions(pl, matches);
    this.completionFiltered = ranked.slice(0, 50);
    this.completionActiveIndex = Math.min(
      this.completionActiveIndex,
      Math.max(0, this.completionFiltered.length - 1),
    );
    this.cdr.markForCheck();
  }

  private refreshPlaceholderCompletionFilter(ta?: HTMLTextAreaElement): void {
    const el = ta ?? this.textarea?.nativeElement;
    const v = this.innerContent ?? '';
    const caret = el ? Math.min(el.selectionStart, v.length) : v.length;
    const { prefix } = this.getPlaceholderPrefixBeforeCaret(v, caret);
    const pl = prefix.toLowerCase();
    const items = this.placeholderCompletions || [];
    const matches = items.filter(
      (item) =>
        !pl ||
        item.label.toLowerCase().includes(pl) ||
        item.insert.toLowerCase().includes(pl) ||
        (item.detail && item.detail.toLowerCase().includes(pl)),
    );
    this.completionFiltered = this.rankCompletions(pl, matches).slice(0, 50);
    this.completionActiveIndex = Math.min(
      this.completionActiveIndex,
      Math.max(0, this.completionFiltered.length - 1),
    );
    this.cdr.markForCheck();
  }

  private rankCompletions(prefixLower: string, items: ScriptCompletionItem[]): ScriptCompletionItem[] {
    if (!prefixLower) {
      return [...items].sort((a, b) => a.label.localeCompare(b.label));
    }
    return [...items].sort((a, b) => {
      const al = a.label.toLowerCase();
      const bl = b.label.toLowerCase();
      const aStarts = al.startsWith(prefixLower) ? 0 : 1;
      const bStarts = bl.startsWith(prefixLower) ? 0 : 1;
      if (aStarts !== bStarts) {
        return aStarts - bStarts;
      }
      return al.localeCompare(bl);
    });
  }

  private handleCompletionKeydown(event: KeyboardEvent, ta: HTMLTextAreaElement): boolean {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.closeCompletion();
      return true;
    }
    if (event.altKey && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      return false;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (this.completionFiltered.length) {
        this.completionActiveIndex = (this.completionActiveIndex + 1) % this.completionFiltered.length;
        this.cdr.markForCheck();
      }
      return true;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (this.completionFiltered.length) {
        this.completionActiveIndex =
          (this.completionActiveIndex - 1 + this.completionFiltered.length) % this.completionFiltered.length;
        this.cdr.markForCheck();
      }
      return true;
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      if (this.completionFiltered.length) {
        const v = this.innerContent ?? '';
        const caret = Math.min(ta.selectionStart, v.length);
        if (this.completionMode === 'script' && !this.canApplyScriptCompletion(v, caret)) {
          this.closeCompletion();
          return false;
        }
        event.preventDefault();
        this.applyCompletion(this.completionFiltered[this.completionActiveIndex], ta);
        return true;
      }
    }
    return false;
  }

  applyCompletion(item: ScriptCompletionItem, ta?: HTMLTextAreaElement): void {
    const textarea = ta ?? this.textarea?.nativeElement;
    if (!textarea) {
      return;
    }
    const v = this.innerContent ?? '';
    const caret = Math.min(textarea.selectionStart, v.length);
    const selEnd = Math.max(caret, textarea.selectionEnd);
    if (this.completionMode === 'script' && !this.canApplyScriptCompletion(v, caret)) {
      this.closeCompletion();
      this.cdr.markForCheck();
      return;
    }
    const { start } =
      this.completionMode === 'script'
        ? this.getScriptPrefixBeforeCaret(v, caret)
        : this.getPlaceholderPrefixBeforeCaret(v, caret);
    const before = v.substring(0, start);
    const after = v.substring(selEnd);
    this.innerContent = before + item.insert + after;
    this.closeCompletion();
    const newPos = start + item.insert.length;
    this.contentChange.emit(this.innerContent);
    this.updateHighlighting();
    this.queueCaret(textarea, newPos);
    this.cdr.markForCheck();
    requestAnimationFrame(() => {
      textarea.focus();
      this.syncScroll();
    });
  }
}
