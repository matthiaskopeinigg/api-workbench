import { Component, EventEmitter, HostBinding, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';

export interface DropdownOption {
    label: string;
    value: any;
    /** Optional native tooltip (e.g. full path for truncated labels). */
    title?: string;
    /** Optional second line in the menu (e.g. template / preset description). */
    description?: string;
}

@Component({
    selector: 'app-dropdown',
    standalone: true,
    imports: [CommonModule],
    templateUrl: './dropdown.component.html',
    styleUrl: './dropdown.component.scss'
})
export class DropdownComponent {
    @Input() options: DropdownOption[] = [];
    @Input() value: any;
    @Input() placeholder: string = '';
    @Input() align: 'left' | 'right' = 'left';
    /**
     * Max width for the menu panel. Must not use `100%` of the trigger — that caps the menu
     * to the button width and truncates long options (e.g. WebSocket mode selector).
     */
    @Input() menuMaxWidth = 'min(100vw - 24px, 24rem)';
    /** Accessible name for the trigger (e.g. filter role). */
    @Input() ariaLabel = '';
    /** Stretch trigger to parent width (e.g. form fields). */
    @Input() fullWidth = false;
    @Output() valueChange = new EventEmitter<any>();

    @HostBinding('class.full-width')
    get hostFullWidth(): boolean {
        return this.fullWidth;
    }

    isOpen = false;

    toggle() {
        this.isOpen = !this.isOpen;
    }

    select(option: DropdownOption) {
        this.value = option.value;
        this.valueChange.emit(this.value);
        this.isOpen = false;
    }

    get selectedLabel(): string {
        const selected = this.options.find(o => o.value === this.value);
        return selected ? selected.label : this.placeholder;
    }

    close() {
        this.isOpen = false;
    }
}
