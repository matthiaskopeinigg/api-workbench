import {
  Component,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  ViewChild,
  ElementRef,
  forwardRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ControlValueAccessor, NG_VALUE_ACCESSOR, FormsModule } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import {
  DYNAMIC_BARE_SOURCE,
  DYNAMIC_PLACEHOLDER_TOOLTIPS,
  type DynamicPlaceholderOption,
  describeDynamicToken,
  getDynamicPlaceholderCompletions,
  isKnownDynamicName,
} from '@core/placeholders/dynamic-placeholders';

/** Suggest for `$uuid` (dynamic) or `{{name}}` (env). */
type SuggestContext =
  | { kind: 'dollar'; dollarIndex: number; partial: string }
  | { kind: 'env'; openIndex: number; partial: string };

@Component({
  selector: 'app-variable-input',
  standalone: true,
  imports: [CommonModule, FormsModule],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => VariableInputComponent),
      multi: true
    }
  ],
  template: `
    <div class="variable-input-container" [class.disabled]="disabled" [class.suggest-open]="suggestOpen">
      
      <div class="variable-tooltip" [class.visible]="!!hoveredValue" [style.left.px]="tooltipX" [style.top.px]="tooltipY">
        <div class="tooltip-content" [innerHTML]="hoveredValue"></div>
      </div>

      <div class="backdrop" #backdrop *ngIf="type === 'text'"><span *ngFor="let part of parsedParts" [class.variable-highlight]="part.isVariable && !part.isPathVar" [class.path-variable]="part.isPathVar" [attr.data-tooltip]="getTooltip(part)">{{ part.text }}</span></div>
      <input
        #input
        [type]="type"
        [placeholder]="placeholder"
        [disabled]="disabled"
        [(ngModel)]="value"
        (input)="onInput($event)"
        (keydown)="onKeydown($event)"
        (keyup)="onKeyupCaret($event)"
        (scroll)="onScroll($event)"
        (mousemove)="onMouseMove($event)"
        (mouseleave)="clearHover()"
        (blur)="onInputBlur($event)"
        spellcheck="false"
        autocomplete="off"
      />
      <div
        *ngIf="suggestOpen && suggestList.length > 0"
        class="dollar-suggest-panel"
        [style.top.px]="dollarPanelTop"
        [style.left.px]="dollarPanelLeft"
        [style.minWidth.px]="dollarPanelWidth"
        role="listbox"
        (mousedown)="$event.preventDefault()"
      >
        <button
          *ngFor="let opt of suggestList; let i = index"
          type="button"
          class="dollar-suggest-item"
          [class.active]="i === suggestActiveIndex"
          role="option"
          (mousedown)="pickSuggest(opt, $event)"
        >
          <span class="dollar-suggest-label">{{ opt.label }}</span>
          <span class="dollar-suggest-desc" [title]="opt.description">{{ shortDesc(opt.description) }}</span>
        </button>
      </div>
    </div>
  `,
  styles: [`
    :host {
      display: block;
      width: 100%;
    }

    .variable-input-container {
      position: relative;
      width: 100%;
      height: 36px;
      background: var(--surface-alt);
      border: 1px solid var(--border-color);
      border-radius: 6px;
      overflow: hidden;
      box-sizing: border-box;
      transition: border-color 0.2s;
    }

    .variable-input-container.suggest-open {
      overflow: visible;
      z-index: 20;
    }

    .dollar-suggest-panel {
      position: fixed;
      z-index: 10001;
      margin-top: 4px;
      max-height: 220px;
      overflow-y: auto;
      background: var(--surface, #1e1e1e);
      border: 1px solid var(--border-color, #333);
      border-radius: 8px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.35);
      padding: 4px;
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 12rem;
    }

    .dollar-suggest-item {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      text-align: left;
      width: 100%;
      border: 0;
      border-radius: 6px;
      padding: 6px 8px;
      background: transparent;
      color: var(--text-color);
      cursor: pointer;
      font-size: 12px;
      line-height: 1.3;
    }

    .dollar-suggest-item:hover,
    .dollar-suggest-item.active {
      background: color-mix(in srgb, var(--secondary-color), transparent 80%);
    }

    .dollar-suggest-label {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-weight: 600;
      color: var(--secondary-color, #4fc3f7);
    }

    .dollar-suggest-desc {
      font-size: 10px;
      color: color-mix(in srgb, var(--text-color), transparent 40%);
      max-width: 20rem;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }

    .variable-input-container:focus-within {
      border-color: var(--secondary-color);
    }

    input, .backdrop {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      margin: 0;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
      font-size: 13px;
      line-height: 34px;
      box-sizing: border-box;
      padding: 0 12px;
      padding-right: 32px;
      white-space: pre;
      overflow-x: auto;
      overflow-y: hidden;
      border: none;
      background: transparent;
      outline: none;
      text-align: left;
      letter-spacing: normal;
      word-spacing: normal;
      font-weight: 400;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
      text-rendering: optimizeLegibility;
    }

    input {
      color: var(--text-color);
      z-index: 2;
      scrollbar-width: none;
      
      &[type="text"] {
        color: transparent !important;
        -webkit-text-fill-color: transparent;
      }
    }

    input::-webkit-scrollbar { display: none; }

    .backdrop {
      z-index: 1;
      pointer-events: none;
      color: var(--text-color);
      display: block; 
      scrollbar-width: none;
    }

    .backdrop::-webkit-scrollbar { display: none; }

    .variable-highlight {
      background-color: color-mix(in srgb, var(--secondary-color), transparent 85%);
      color: var(--secondary-color);
      border-radius: 4px;
      font-weight: 400; 
      box-shadow: 0 0 0 1px rgba(var(--secondary-color-rgb), 0.3);
      padding: 1px 0;
      transition: background-color 0.2s;
      pointer-events: auto;
    }

    .variable-highlight.hovered {
      background-color: color-mix(in srgb, var(--secondary-color), transparent 70%);
      box-shadow: 0 0 0 1px var(--secondary-color);
    }

    .path-variable {
      background-color: color-mix(in srgb, var(--secondary-color), transparent 85%);
      color: var(--secondary-color);
      border-radius: 4px;
      font-weight: 400;
      box-shadow: 0 0 0 1px color-mix(in srgb, var(--secondary-color), transparent 80%);
      padding: 1px 0;
      transition: background-color 0.2s;
      pointer-events: auto;
    }

    .path-variable.hovered {
      background-color: color-mix(in srgb, var(--secondary-color), transparent 70%);
      box-shadow: 0 0 0 1px var(--secondary-color);
    }

    .variable-tooltip {
      position: fixed;
      z-index: 1000;
      pointer-events: none;
      opacity: 0;
      transform: translateY(10px);
      transition: opacity 0.15s, transform 0.15s;
    }

    .variable-tooltip.visible {
      opacity: 1;
      transform: translateY(0);
    }

    .tooltip-content {
      background: #1e1e1e;
      color: #ffffff;
      padding: 6px 10px;
      border-radius: 4px;
      font-size: 11px;
      line-height: 1.4;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      border: 1px solid #333;
      white-space: nowrap;
      font-family: sans-serif;
    }
  `]
})
export class VariableInputComponent implements ControlValueAccessor, OnChanges, OnDestroy {
  @Input() placeholder = '';
  @Input() disabled = false;
  @Input() activeVariables: Record<string, string> = {};
  /**
   * When true, `:name` is styled as a URL path segment (e.g. `/api/:id`). Leave false
   * for query/header/body fields where `:` is common (`key: value`, `https:`, times).
   */
  @Input() enablePathParamHighlight = false;
  @Input() type: 'text' | 'password' = 'text';
  @Output() onEnter = new EventEmitter<void>();

  @ViewChild('backdrop') backdrop!: ElementRef<HTMLDivElement>;
  @ViewChild('input') inputElem!: ElementRef<HTMLInputElement>;

  public value: string = '';
  public hoveredValue: SafeHtml | null = null;
  public tooltipX: number = 0;
  public tooltipY: number = 0;
  public parsedParts: {
    text: string;
    isVariable: boolean;
    value?: string;
    isPathVar?: boolean;
    isDynamic?: boolean;
    dynamicName?: string;
  }[] = [];

  /** `$uuid` and `{{env}}` autocomplete */
  suggestOpen = false;
  suggestList: DynamicPlaceholderOption[] = [];
  suggestActiveIndex = 0;
  private suggestContext: SuggestContext | null = null;
  private suggestKey = '';
  dollarPanelTop = 0;
  dollarPanelLeft = 0;
  dollarPanelWidth = 0;
  private blurCloseTimer: ReturnType<typeof setTimeout> | null = null;

  onChange: any = () => { };
  onTouched: any = () => { };

  constructor(private sanitizer: DomSanitizer) { }

  ngOnChanges() {
    this.parseValue();
  }

  ngOnDestroy() {
    if (this.blurCloseTimer) {
      clearTimeout(this.blurCloseTimer);
    }
  }

  onInput(event: any) {
    this.clearHover();
    const el = event.target as HTMLInputElement;
    const val = el.value;
    this.value = val;
    this.parseValue();
    this.onChange(val);
    if (this.type === 'text' && !this.disabled) {
      this.updateSuggestFromInput(el, el.selectionStart ?? val.length);
    } else {
      this.closeSuggest();
    }
  }

  onInputBlur(_event: FocusEvent): void {
    if (this.blurCloseTimer) {
      clearTimeout(this.blurCloseTimer);
    }
    this.blurCloseTimer = setTimeout(() => {
      this.closeSuggest();
      this.blurCloseTimer = null;
    }, 150);
    this.onTouched();
  }

  onKeydown(event: KeyboardEvent) {
    if (this.type !== 'text' || this.disabled) {
      return;
    }
    if (!this.suggestOpen || this.suggestList.length === 0) {
      if (event.key === 'Enter') {
        this.onEnter.emit();
      }
      return;
    }
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        this.suggestActiveIndex = Math.min(
          this.suggestActiveIndex + 1,
          this.suggestList.length - 1,
        );
        break;
      case 'ArrowUp':
        event.preventDefault();
        this.suggestActiveIndex = Math.max(this.suggestActiveIndex - 1, 0);
        break;
      case 'Enter':
      case 'Tab':
        event.preventDefault();
        this.applySuggest(this.suggestList[this.suggestActiveIndex]!);
        break;
      case 'Escape':
        event.preventDefault();
        this.closeSuggest();
        break;
    }
  }

  onKeyupCaret(event: KeyboardEvent) {
    if (this.type !== 'text' || this.disabled) return;
    const t = event.target as HTMLInputElement;
    this.updateSuggestFromInput(t, t.selectionStart ?? this.value.length);
  }

  shortDesc(full: string): string {
    if (!full) return '';
    return full.length > 72 ? full.slice(0, 70) + '…' : full;
  }

  private updateSuggestFromInput(input: HTMLInputElement, cursor: number) {
    this.layoutDollarPanel(input);
    const envCtx = this.getEnvBraceContext(this.value, cursor);
    if (envCtx) {
      const list = this.getEnvCompletions(envCtx.partial);
      if (list.length > 0) {
        this.suggestContext = {
          kind: 'env',
          openIndex: envCtx.openIndex,
          partial: envCtx.partial,
        };
        const nextKey = `e|${envCtx.openIndex}|${envCtx.partial}`;
        if (nextKey !== this.suggestKey) {
          this.suggestActiveIndex = 0;
          this.suggestKey = nextKey;
        }
        this.suggestActiveIndex = Math.min(this.suggestActiveIndex, list.length - 1);
        this.suggestList = list;
        this.suggestOpen = true;
        return;
      }
    }
    const dctx = this.getDollarContextAtCursor(this.value, cursor);
    this.suggestContext = dctx
      ? { kind: 'dollar', dollarIndex: dctx.dollarIndex, partial: dctx.partial }
      : null;
    if (!dctx) {
      this.closeSuggest();
      return;
    }
    const list = getDynamicPlaceholderCompletions(dctx.partial);
    if (list.length === 0) {
      this.closeSuggest();
      return;
    }
    const nextKey = `d|${dctx.dollarIndex}|${dctx.partial}`;
    if (nextKey !== this.suggestKey) {
      this.suggestActiveIndex = 0;
      this.suggestKey = nextKey;
    }
    this.suggestActiveIndex = Math.min(this.suggestActiveIndex, list.length - 1);
    this.suggestList = list;
    this.suggestOpen = true;
  }

  /** Inside `{{name` before `}}`, excluding `{{$dynamic` (use `$` completion). */
  private getEnvBraceContext(
    value: string,
    cursor: number,
  ): { openIndex: number; partial: string } | null {
    if (cursor < 0) return null;
    const left = value.slice(0, cursor);
    const open = left.lastIndexOf('{{');
    if (open < 0) return null;
    const afterOpen = value.slice(open + 2, cursor);
    if (afterOpen.includes('}}')) return null;
    if (afterOpen.startsWith('$')) return null;
    if (!/^[\w.-]*$/.test(afterOpen)) return null;
    return { openIndex: open, partial: afterOpen };
  }

  private getEnvCompletions(partial: string): DynamicPlaceholderOption[] {
    const p = partial.toLowerCase();
    const keys = Object.keys(this.activeVariables)
      .filter(k => p === '' || k.toLowerCase().startsWith(p))
      .sort((a, b) => a.localeCompare(b));
    const out: DynamicPlaceholderOption[] = [];
    for (const name of keys) {
      const val = this.activeVariables[name] ?? '';
      out.push({
        name,
        label: `{{${name}}}`,
        description: val
          ? `Environment variable: ${val}`
          : 'Environment variable (empty)',
      });
      if (out.length >= 50) break;
    }
    return out;
  }

  private getDollarContextAtCursor(
    value: string,
    cursor: number,
  ): { dollarIndex: number; partial: string } | null {
    if (cursor < 0) return null;
    const left = value.slice(0, cursor);
    const i = left.lastIndexOf('$');
    if (i < 0) return null;
    const partial = value.slice(i + 1, cursor);
    if (!/^[a-zA-Z0-9_()]*$/.test(partial)) {
      return null;
    }
    if (isKnownDynamicName(partial)) {
      const atEnd = cursor >= value.length;
      const nextCh = atEnd ? '' : value[cursor] ?? '';
      if (atEnd || !/[a-zA-Z0-9_]/.test(nextCh)) {
        return null;
      }
    }
    return { dollarIndex: i, partial };
  }

  private layoutDollarPanel(input: HTMLInputElement) {
    if (typeof input.getBoundingClientRect !== 'function') {
      this.dollarPanelTop = 0;
      this.dollarPanelLeft = 0;
      this.dollarPanelWidth = 192;
      return;
    }
    const r = input.getBoundingClientRect();
    this.dollarPanelTop = r.bottom + 2;
    this.dollarPanelLeft = r.left;
    this.dollarPanelWidth = Math.max(r.width, 192);
  }

  private closeSuggest() {
    this.suggestOpen = false;
    this.suggestList = [];
    this.suggestContext = null;
    this.suggestKey = '';
  }

  pickSuggest(opt: DynamicPlaceholderOption, e: Event) {
    e.preventDefault();
    e.stopPropagation();
    if (this.blurCloseTimer) {
      clearTimeout(this.blurCloseTimer);
      this.blurCloseTimer = null;
    }
    this.applySuggest(opt);
    requestAnimationFrame(() => this.inputElem?.nativeElement?.focus());
  }

  private applySuggest(opt: DynamicPlaceholderOption) {
    const ctx = this.suggestContext;
    if (!ctx) {
      this.closeSuggest();
      return;
    }
    const insert = opt.label;
    if (ctx.kind === 'env') {
      const to = ctx.openIndex + 2 + ctx.partial.length;
      this.value = this.value.slice(0, ctx.openIndex) + insert + this.value.slice(to);
      const newPos = ctx.openIndex + insert.length;
      this.parseValue();
      this.onChange(this.value);
      this.closeSuggest();
      requestAnimationFrame(() => {
        this.inputElem?.nativeElement?.setSelectionRange(newPos, newPos);
      });
      return;
    }
    const to = ctx.dollarIndex + 1 + ctx.partial.length;
    this.value = this.value.slice(0, ctx.dollarIndex) + insert + this.value.slice(to);
    const newPos = ctx.dollarIndex + insert.length;
    this.parseValue();
    this.onChange(this.value);
    this.closeSuggest();
    requestAnimationFrame(() => {
      this.inputElem?.nativeElement?.setSelectionRange(newPos, newPos);
    });
  }

  onScroll(event: any) {
    if (this.backdrop) {
      this.backdrop.nativeElement.scrollLeft = event.target.scrollLeft;
    }
  }

  private lastHoveredElem: HTMLElement | null = null;

  onMouseMove(event: MouseEvent) {
    if (event.buttons !== 0) {
      this.clearHover();
      return;
    }

    if (!this.inputElem) return;
    const input = this.inputElem.nativeElement;

    const originalPE = input.style.pointerEvents;
    input.style.pointerEvents = 'none';
    const target = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement;
    input.style.pointerEvents = originalPE;

    if (target && target.classList.contains('variable-highlight')) {
      this.tooltipX = event.clientX + 10;
      this.tooltipY = event.clientY + 20;

      if (this.lastHoveredElem !== target) {
        this.clearHover();
        this.lastHoveredElem = target;
        target.classList.add('hovered');
        const tooltip = target.getAttribute('data-tooltip');
        this.hoveredValue = tooltip ? this.sanitizer.bypassSecurityTrustHtml(tooltip) : null;
      }
    } else {
      this.clearHover();
    }
  }

  public clearHover() {
    if (this.lastHoveredElem) {
      this.lastHoveredElem.classList.remove('hovered');
      this.lastHoveredElem = null;
    }
    this.hoveredValue = null;
  }

  public getTooltip(
    part: {
      text: string;
      isVariable: boolean;
      value?: string;
      isDynamic?: boolean;
      dynamicName?: string;
      isPathVar?: boolean;
    },
  ): string | null {
    if (part.isDynamic && part.dynamicName) {
      const desc =
        DYNAMIC_PLACEHOLDER_TOOLTIPS[part.dynamicName] ||
        describeDynamicToken(part.dynamicName);
      if (desc) {
        return `Dynamic: <strong>${part.text}</strong><br><span style="color:#aaa;">${desc}</span>`;
      }
    }
    if (part.isPathVar) {
      return `Path variable <strong>${part.text}</strong><br><span style="color:#aaa;">Add a path param with the same name in Params, or use in the request URL.</span>`;
    }
    if (!part.isVariable) return null;
    if (part.value === undefined) {
      return `Variable: <strong>${part.text}</strong><br>Value: <span style="color: var(--secondary-color)">undefined</span>`;
    }
    if (part.value === '') {
      return `Variable: <strong>${part.text}</strong><br>Value: <span style="color: var(--secondary-color)">(empty)</span>`;
    }
    return `Variable: <strong>${part.text}</strong><br>Value: <span style="color: var(--secondary-color)">${part.value}</span>`;
  }

  writeValue(value: any): void {
    this.value = value || '';
    this.parseValue();
  }

  registerOnChange(fn: any): void { this.onChange = fn; }
  registerOnTouched(fn: any): void { this.onTouched = fn; }
  setDisabledState(isDisabled: boolean): void { this.disabled = isDisabled; }

  private parseValue() {
    const pathAlt = this.enablePathParamHighlight ? '|(:([a-zA-Z_][a-zA-Z0-9_]*))' : '';
    const regex = new RegExp(
      '(\\{\\{[^}]+\\}\\})' + pathAlt + '|' + DYNAMIC_BARE_SOURCE,
      'g',
    );
    let match;
    let lastIdx = 0;
    this.parsedParts = [];

    while ((match = regex.exec(this.value)) !== null) {
      if (match.index > lastIdx) {
        this.parsedParts.push({ text: this.value.substring(lastIdx, match.index), isVariable: false });
      }

      if (match[1]) {
        const key = match[1].slice(2, -2).trim();
        if (key.startsWith('$') && isKnownDynamicName(key.slice(1))) {
          const dname = key.slice(1);
          this.parsedParts.push({
            text: match[1],
            isVariable: true,
            isPathVar: false,
            isDynamic: true,
            dynamicName: dname,
          });
        } else {
          const isKnown = Object.prototype.hasOwnProperty.call(this.activeVariables, key);
          this.parsedParts.push({
            text: match[1],
            isVariable: isKnown,
            value: isKnown ? this.activeVariables[key] : undefined,
            isPathVar: false,
          });
        }
      } else if (
        this.enablePathParamHighlight &&
        match[2] &&
        match[2].charAt(0) === ':'
      ) {
        this.parsedParts.push({
          text: match[2],
          isVariable: true,
          value: undefined,
          isPathVar: true,
        });
      } else if (match[0].startsWith('$')) {
        const dname = match[0].replace(/^\$/, '');
        this.parsedParts.push({
          text: match[0],
          isVariable: true,
          isPathVar: false,
          isDynamic: true,
          dynamicName: dname,
        });
      } else {
        this.parsedParts.push({ text: match[0], isVariable: false });
      }

      lastIdx = regex.lastIndex;
    }

    if (lastIdx < this.value.length) {
      this.parsedParts.push({ text: this.value.substring(lastIdx), isVariable: false });
    }
  }
}

