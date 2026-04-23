import { ChangeDetectionStrategy, Component, ElementRef, EventEmitter, Input, OnChanges, Output, ViewChild, AfterViewInit, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

export type EditorLanguage = 'json' | 'xml' | 'javascript' | 'plain' | 'form';

@Component({
  selector: 'app-simple-editor',
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './simple-editor.component.html',

  styleUrl: './simple-editor.component.scss',
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


