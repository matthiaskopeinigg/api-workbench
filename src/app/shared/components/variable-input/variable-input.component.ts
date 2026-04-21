import { Component, EventEmitter, Input, Output, ViewChild, ElementRef, forwardRef, OnChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ControlValueAccessor, NG_VALUE_ACCESSOR, FormsModule } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

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
    <div class="variable-input-container" [class.disabled]="disabled">
      
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
        (scroll)="onScroll($event)"
        (mousemove)="onMouseMove($event)"
        (mouseleave)="clearHover()"
        (blur)="onTouched()"
        (keydown.enter)="onEnter.emit()"
        spellcheck="false"
        autocomplete="off"
      />
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
export class VariableInputComponent implements ControlValueAccessor, OnChanges {
  @Input() placeholder = '';
  @Input() disabled = false;
  @Input() activeVariables: Record<string, string> = {};
  @Input() type: 'text' | 'password' = 'text';
  @Output() onEnter = new EventEmitter<void>();

  @ViewChild('backdrop') backdrop!: ElementRef<HTMLDivElement>;
  @ViewChild('input') inputElem!: ElementRef<HTMLInputElement>;

  public value: string = '';
  public hoveredValue: SafeHtml | null = null;
  public tooltipX: number = 0;
  public tooltipY: number = 0;
  public parsedParts: { text: string; isVariable: boolean; value?: string; isPathVar?: boolean }[] = [];

  onChange: any = () => { };
  onTouched: any = () => { };

  constructor(private sanitizer: DomSanitizer) { }

  ngOnChanges() {
    this.parseValue();
  }

  onInput(event: any) {
    this.clearHover();
    const val = event.target.value;
    this.value = val;
    this.parseValue();
    this.onChange(val);
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

  public getTooltip(part: { text: string; isVariable: boolean; value?: string }): string | null {
    if (!part.isVariable) return null;
    const val = part.value !== undefined ? part.value : 'undefined';
    return `Variable: <strong>${part.text}</strong><br>Value: <span style="color: var(--secondary-color)">${val}</span>`;
  }

  writeValue(value: any): void {
    this.value = value || '';
    this.parseValue();
  }

  registerOnChange(fn: any): void { this.onChange = fn; }
  registerOnTouched(fn: any): void { this.onTouched = fn; }
  setDisabledState(isDisabled: boolean): void { this.disabled = isDisabled; }

  private parseValue() {

    const regex = /(\{\{[^}]+\}\})|(:([a-zA-Z_][a-zA-Z0-9_]*))/g;
    let match;
    let lastIdx = 0;
    this.parsedParts = [];

    while ((match = regex.exec(this.value)) !== null) {
      if (match.index > lastIdx) {
        this.parsedParts.push({ text: this.value.substring(lastIdx, match.index), isVariable: false });
      }

      if (match[1]) {

        const key = match[1].slice(2, -2); 
        const envValue = this.activeVariables[key];
        this.parsedParts.push({
          text: match[1],
          isVariable: envValue !== undefined,
          value: envValue,
          isPathVar: false
        });
      } else if (match[2]) {

        const key = match[3];
        this.parsedParts.push({
          text: match[2],
          isVariable: true, // Always highlight path vars
          value: undefined,
          isPathVar: true
        });
      }

      lastIdx = regex.lastIndex;
    }

    if (lastIdx < this.value.length) {
      this.parsedParts.push({ text: this.value.substring(lastIdx), isVariable: false });
    }
  }
}

