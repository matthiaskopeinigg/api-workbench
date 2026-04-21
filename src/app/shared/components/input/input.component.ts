import { Component, EventEmitter, Input, Output, forwardRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ControlValueAccessor, NG_VALUE_ACCESSOR, FormsModule } from '@angular/forms';

@Component({
    selector: 'app-input',
    standalone: true,
    imports: [CommonModule, FormsModule],
    providers: [
        {
            provide: NG_VALUE_ACCESSOR,
            useExisting: forwardRef(() => InputComponent),
            multi: true
        }
    ],
    template: `
    <div class="input-container" [class.has-label]="label">
      <label *ngIf="label" [for]="id">{{ label }}</label>
      <div class="input-wrapper">
        <span *ngIf="icon" class="input-icon">{{ icon }}</span>
        <input
          [id]="id"
          [type]="type"
          [placeholder]="placeholder"
          [disabled]="disabled"
          [value]="value"
          (input)="onInput($event)"
          (blur)="onTouched()"
          [class.has-icon]="icon"
        />
      </div>
    </div>
  `,
    styles: [`
    .input-container {
      display: flex;
      flex-direction: column;
      gap: 4px;
      width: 100%;
      font-family: inherit;
    }

    label {
      font-size: 12px;
      font-weight: 500;
      color: var(--text-color);
      opacity: 0.8;
    }

    .input-wrapper {
      position: relative;
      display: flex;
      align-items: center;
    }

    input {
      width: 100%;
      padding: 8px 12px;
      font-size: 14px;
      background-color: var(--surface);
      border: 1px solid var(--border-color);
      border-radius: 6px;
      color: var(--text-color);
      transition: all var(--transition-fast);
      outline: none;

      &.has-icon {
        padding-left: 32px;
      }

      &:focus {
        border-color: var(--primary-color);
        box-shadow: 0 0 0 2px rgba(var(--primary-rgb), 0.2);
      }

      &:disabled {
        opacity: 0.6;
        cursor: not-allowed;
        background-color: rgba(0,0,0,0.05);
      }
    }

    .input-icon {
      position: absolute;
      left: 10px;
      pointer-events: none;
      color: var(--text-color);
      opacity: 0.5;
    }
  `]
})
export class InputComponent implements ControlValueAccessor {
    @Input() label = '';
    @Input() placeholder = '';
    @Input() type = 'text';
    @Input() id = `input-${Math.random().toString(36).substr(2, 9)}`;
    @Input() disabled = false;
    @Input() icon = '';

    value: string = '';

    onChange: any = () => { };

    onTouched: any = () => { };

    onInput(event: Event) {
        const val = (event.target as HTMLInputElement).value;
        this.value = val;
        this.onChange(val);
    }

    writeValue(value: any): void {
        this.value = value || '';
    }

    registerOnChange(fn: any): void {
        this.onChange = fn;
    }

    registerOnTouched(fn: any): void {
        this.onTouched = fn;
    }

    setDisabledState(isDisabled: boolean): void {
        this.disabled = isDisabled;
    }
}


