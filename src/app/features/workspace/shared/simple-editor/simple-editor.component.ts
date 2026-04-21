import { ChangeDetectionStrategy, Component, ElementRef, EventEmitter, Input, OnChanges, Output, ViewChild, AfterViewInit, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

export type EditorLanguage = 'json' | 'xml' | 'javascript' | 'plain' | 'form';

@Component({
  selector: 'app-simple-editor',
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="simple-editor-container" [class.readonly]="readonly" [class.no-toolbar]="hideToolbar">
      
      <div class="editor-toolbar" *ngIf="!hideToolbar && (!readonly || title)">
        <div class="header-left">
          <span class="editor-title" *ngIf="title">{{ title }}</span>
          <div class="language-badge">{{ language.toUpperCase() }}</div>
        </div>
        <div class="actions">
          <button class="action-btn" (click)="formatCode()" title="Format Code">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 10H3M21 6H3M21 14H3M21 18H3"/>
            </svg>
            Format
          </button>
          <button class="action-btn" (click)="copyToClipboard()" title="Copy to Clipboard">
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
            [(ngModel)]="content"
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
  styles: [`
    :host {
      display: flex;
      flex-direction: column;
      flex: 1;
      height: 100%;
      min-height: 100px;
      overflow: hidden;
    }

    .simple-editor-container {
      display: flex;
      flex-direction: column;
      flex: 1;
      border: 1px solid var(--border-color);
      border-radius: 8px;
      overflow: hidden;
      background: var(--surface);

      &.readonly {
        background: var(--surface-alt);
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
      background: var(--bg-color);
      border-bottom: 1px solid var(--border-color);
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
        color: var(--text-color);
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
          color: var(--text-color);
          font-size: 11px;
          font-weight: 600;
          cursor: pointer;
          padding: 4px 8px;
          border-radius: 4px;
          opacity: 0.7;
          transition: all 0.2s;

          &:hover {
            opacity: 1;
            background: var(--surface-alt);
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
      font-family: 'Fira Code', monospace;
      font-size: 13px;
      line-height: 1.5;
    }

    .line-numbers {
      width: 40px;
      background: var(--surface-alt);
      border-right: 1px solid var(--border-color);
      color: var(--text-muted);
      text-align: right;
      padding: 10px 8px 10px 0;
      user-select: none;
      overflow: hidden;
      flex-shrink: 0;

      .line-number {
        height: 1.5em; 
        font-size: 11px;
        opacity: 0.6;
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
      caret-color: var(--text-color);
      resize: none;
      outline: none;

      &::selection {
        background: rgba(var(--secondary-color-rgb), 0.2);
        color: transparent;
      }
    }

    pre.code-output {
      z-index: 1;
      color: var(--text-color);
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
      background-color: color-mix(in srgb, var(--secondary-color), transparent 90%);
      border-radius: 2px;
      font-weight: bold;
    }
  `]
})
export class SimpleEditorComponent implements OnInit, OnChanges, AfterViewInit {

  @Input() language: EditorLanguage = 'json';
  @Input() title?: string;
  @Input() content: string = '';
  @Input() readonly: boolean = false;
  @Input() activeVariables: Record<string, string> = {};
  @Input() hideToolbar: boolean = false;

  @Output() contentChange = new EventEmitter<string>();

  @ViewChild('textarea') textarea!: ElementRef<HTMLTextAreaElement>;
  @ViewChild('preBlock') preBlock!: ElementRef<HTMLPreElement>;
  @ViewChild('lineNumbers') lineNumbers!: ElementRef<HTMLDivElement>;

  highlightedContent: string = '';
  lines: number[] = [1];

  ngOnInit() {
    this.updateHighlighting();
  }

  ngOnChanges() {
    this.updateHighlighting();
  }

  ngAfterViewInit() {
    this.syncScroll();
  }

  onContentChange(value: string) {
    this.content = value;
    this.contentChange.emit(value);
    this.updateHighlighting();
  }

  updateHighlighting() {
    if (!this.content) {
      this.highlightedContent = '';
      this.lines = [1];
      return;
    }

    const lineCount = this.content.split('\\n').length;
    if (this.lines.length !== lineCount) {
      this.lines = Array(lineCount).fill(0);
    }

    let html = this.escapeHtml(this.content);

    if (this.language === 'json') {
      html = this.highlightJson(html);
    } else if (this.language === 'xml') {
      html = this.highlightXml(html);
    } else if (this.language === 'form') {
      html = this.highlightForm(html);
    } else if (this.language === 'javascript') {
      html = this.highlightJavascript(html);
    }

    html = this.highlightVariables(html);

    if (this.content.endsWith('\\n')) {
      html += '<br>';
    }

    this.highlightedContent = html;
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  private highlightJson(html: string): string {

    return html.replace(
      /("(\\\\u[a-zA-Z0-9]{4}|\\\\[^u]|[^\\\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
      (match) => {
        let cls = 'token-number';
        if (/^"/.test(match)) {
          if (/:$/.test(match)) {
            cls = 'token-key';
          } else {
            cls = 'token-string';
          }
        } else if (/true|false/.test(match)) {
          cls = 'token-boolean';
        } else if (/null/.test(match)) {
          cls = 'token-null';
        }
        return `<span class="${cls}">${match}</span>`;
      }
    );
  }

  private highlightXml(html: string): string {
    return html.replace(
      /(&lt;\/?[a-zA-Z0-9_\-:]+(?:\s+[a-zA-Z0-9_\-:]+(?:=&quot;[^&]*&quot;)?)*\s*\/?&gt;||&lt;!\[CDATA\[[\s\S]*?\]\]&gt;)/g,
      (match) => {
        if (match.startsWith('&lt;!--')) return `<span class="token-comment">${match}</span>`;
        if (match.startsWith('&lt;![CDATA[')) return `<span class="token-string">${match}</span>`;

        return match.replace(/(&lt;\/?)?([a-zA-Z0-9_\-:]+)|(\s+[a-zA-Z0-9_\-:]+)=(&quot;[^&]*&quot;)/g, (m, tagOpened, tagName, attrName, attrValue) => {
          if (tagOpened && tagName) return `${tagOpened}<span class="token-key">${tagName}</span>`;
          if (attrName && attrValue) return `<span class="token-attribute">${attrName}</span>=<span class="token-string">${attrValue}</span>`;
          return m;
        });
      }
    );
  }

  private highlightForm(html: string): string {
    return html.replace(
      /([^&=]+)=([^&]*)(&?)/g,
      (_, key, value, separator) => {
        return `<span class="token-key">${key}</span>=<span class="token-string">${value}</span><span class="token-punctuation">${separator}</span>`;
      }
    );
  }

  private highlightJavascript(html: string): string {

    const keywords = 'break|case|catch|class|const|continue|debugger|default|delete|do|else|export|extends|false|finally|for|function|if|import|in|instanceof|new|null|return|super|switch|this|throw|true|try|typeof|var|void|while|with|let|static|yield|await|async';

    return html

      .replace(/("(\\\\u[a-zA-Z0-9]{4}|\\\\[^u]|[^\\\\"])*")/g, '<span class="token-string">$1</span>')

      .replace(/('(\\\\u[a-zA-Z0-9]{4}|\\\\[^u]|[^\\\\'])*')/g, '<span class="token-string">$1</span>')

      .replace(/(`[^`]*`)/g, '<span class="token-string">$1</span>')

      .replace(/(\/\/.*)/g, '<span class="token-comment">$1</span>')

      .replace(new RegExp(`\\b(${keywords})\\b`, 'g'), '<span class="token-keyword">$1</span>')

      .replace(/\b(\d+)\b/g, '<span class="token-number">$1</span>')

      .replace(/(\w+)(?=\()/g, '<span class="token-function">$1</span>');
  }

  private highlightVariables(html: string): string {
    return html.replace(/{{([^}]+)}}/g, (match, variableName) => {
      const isDefined = this.activeVariables.hasOwnProperty(variableName.trim());

      return `<span class="variable-highlight" title="${isDefined ? this.activeVariables[variableName.trim()] : 'Undefined'}">{{${variableName}}}</span>`;
    });
  }

  formatCode() {
    if (this.readonly) return;
    try {
      if (this.language === 'json') {
        const parsed = JSON.parse(this.content);
        this.content = JSON.stringify(parsed, null, 2);
        this.onContentChange(this.content);
      }
    } catch {

    }
  }

  copyToClipboard() {
    navigator.clipboard.writeText(this.content);
  }

  syncScroll() {
    if (!this.textarea || !this.preBlock || !this.lineNumbers) return;

    const scrollTop = this.textarea.nativeElement.scrollTop;
    const scrollLeft = this.textarea.nativeElement.scrollLeft;

    this.preBlock.nativeElement.scrollTop = scrollTop;
    this.preBlock.nativeElement.scrollLeft = scrollLeft;
    this.lineNumbers.nativeElement.scrollTop = scrollTop;
  }

  handleKeydown(event: KeyboardEvent) {
    if (this.readonly) return;

    const start = this.textarea.nativeElement.selectionStart;
    const end = this.textarea.nativeElement.selectionEnd;
    const value = this.content;

    if (event.key === 'Tab') {
      event.preventDefault();

      this.content = value.substring(0, start) + '  ' + value.substring(end);

      setTimeout(() => {
        this.textarea.nativeElement.selectionStart = this.textarea.nativeElement.selectionEnd = start + 2;
        this.onContentChange(this.content);
      }, 0);
    } else if (event.key === 'Enter') {
      this.handleEnter(event);
    } else if (event.key === 'Backspace') {

      if (start === end && start > 0) {
        const charBefore = value[start - 1];
        const charAfter = value[start];
        const pairs: Record<string, string> = { '{': '}', '[': ']', '(': ')', '"': '"', "'": "'", '`': '`' };
        if (pairs[charBefore] === charAfter) {
          event.preventDefault();
          this.content = value.substring(0, start - 1) + value.substring(start + 1);
          setTimeout(() => {
            this.textarea.nativeElement.selectionStart = this.textarea.nativeElement.selectionEnd = start - 1;
            this.onContentChange(this.content);
          }, 0);
        }
      }
    } else if (['{', '[', '(', '"', "'", '`'].includes(event.key)) {

      event.preventDefault();
      const char = event.key;
      const pairs: Record<string, string> = { '{': '}', '[': ']', '(': ')', '"': '"', "'": "'", '`': '`' };
      const closeChar = pairs[char];

      const selectedText = value.substring(start, end);
      const insertText = char + selectedText + closeChar;

      this.content = value.substring(0, start) + insertText + value.substring(end);

      setTimeout(() => {

        if (start !== end) {
          this.textarea.nativeElement.selectionStart = start + 1;
          this.textarea.nativeElement.selectionEnd = end + 1;
        } else {

          this.textarea.nativeElement.selectionStart = this.textarea.nativeElement.selectionEnd = start + 1;
        }
        this.onContentChange(this.content);
      }, 0);
    }
  }

  private handleEnter(event: KeyboardEvent) {
    event.preventDefault();
    const start = this.textarea.nativeElement.selectionStart;
    const end = this.textarea.nativeElement.selectionEnd;
    const value = this.content;

    const previousNewLine = value.lastIndexOf('\n', start - 1);
    const currentLineStart = previousNewLine === -1 ? 0 : previousNewLine + 1;

    const currentLineUpToCursor = value.substring(currentLineStart, start);

    const match = currentLineUpToCursor.match(/^(\s*)/);
    let currentIndent = match ? match[1] : '';
    let nextIndent = currentIndent;

    const charBefore = value.substring(start - 1, start);
    const charAfter = value.substring(start, start + 1);

    const isBlockOpen = ['{', '[', '('].includes(charBefore);
    if (isBlockOpen) {
      nextIndent += '  ';
    }

    let insertText = '\n' + nextIndent;
    let cursorOffset = insertText.length;

    const pairs: Record<string, string> = { '{': '}', '[': ']', '(': ')', '>': '<' };
    if (isBlockOpen && pairs[charBefore] === charAfter) {
      insertText += '\n' + currentIndent;

    }

    this.content = value.substring(0, start) + insertText + value.substring(end);

    setTimeout(() => {
      this.textarea.nativeElement.selectionStart = this.textarea.nativeElement.selectionEnd = start + cursorOffset;
      this.onContentChange(this.content);
      this.syncScroll();
    }, 0);
  }
}


