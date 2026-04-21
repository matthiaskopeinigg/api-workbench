import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'icon';
export type ButtonSize = 'sm' | 'md' | 'lg';

@Component({
    selector: 'app-button',
    standalone: true,
    imports: [CommonModule],
    template: `
    <button
      [type]="type"
      [class]="'btn ' + variant + ' ' + size"
      [disabled]="disabled || loading"
      (click)="onClick.emit($event)">
      
      <span *ngIf="loading" class="spinner"></span>
      <span *ngIf="icon && !loading" class="btn-icon">{{ icon }}</span>
      <ng-content *ngIf="!icon || (icon && (variant !== 'icon'))"></ng-content>
    </button>
  `,
    styles: [`
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      border: 1px solid transparent;
      border-radius: 6px;
      font-weight: 500;
      cursor: pointer;
      transition: all var(--transition-fast);
      outline: none;
      font-family: inherit;
      user-select: none;

      &.sm { padding: 4px 8px; font-size: 12px; height: 28px; }
      &.md { padding: 8px 16px; font-size: 14px; height: 36px; }
      &.lg { padding: 12px 24px; font-size: 16px; height: 44px; }

      &:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }
    }

    
    .primary {
      background-color: var(--primary-color);
      color: #fff;
      &:hover:not(:disabled) { filter: brightness(1.1); }
      &:active:not(:disabled) { filter: brightness(0.95); }
    }

    .secondary {
      background-color: var(--secondary-color);
      color: #fff;
      &:hover:not(:disabled) { filter: brightness(1.1); }
    }

    .danger {
      background-color: #ef4444;
      color: white;
      &:hover:not(:disabled) { background-color: #dc2626; }
    }

    .ghost {
      background-color: transparent;
      color: var(--text-color);
      &:hover:not(:disabled) { background-color: rgba(var(--text-rgb), 0.05); }
    }

    .icon {
      padding: 4px;
      background: transparent;
      color: var(--text-color);
      border-radius: 4px;
      aspect-ratio: 1;
      justify-content: center;
      
      &:hover:not(:disabled) {
        background-color: rgba(var(--text-rgb), 0.1);
      }
    }

    .spinner {
      width: 12px;
      height: 12px;
      border: 2px solid currentColor;
      border-right-color: transparent;
      border-radius: 50%;
      animation: spin 0.75s linear infinite;
    }

    @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
  `]
})
export class ButtonComponent {
    @Input() variant: ButtonVariant = 'primary';
    @Input() size: ButtonSize = 'md';
    @Input() type: 'button' | 'submit' | 'reset' = 'button';
    @Input() disabled = false;
    @Input() loading = false;
    @Input() icon: string = '';

    @Output() onClick = new EventEmitter<MouseEvent>();
}


