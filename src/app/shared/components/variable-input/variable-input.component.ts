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
  templateUrl: './variable-input.component.html',

  styleUrl: './variable-input.component.scss',
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

