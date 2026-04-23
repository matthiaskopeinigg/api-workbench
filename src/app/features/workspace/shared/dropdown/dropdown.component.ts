import { Component, EventEmitter, Input, Output } from '@angular/core';
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
    /** Max width for the menu panel (long labels). */
    @Input() menuMaxWidth = 'min(100%, 20rem)';
    /** Accessible name for the trigger (e.g. filter role). */
    @Input() ariaLabel = '';
    @Output() valueChange = new EventEmitter<any>();

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
