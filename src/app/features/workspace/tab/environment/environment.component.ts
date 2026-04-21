import { ChangeDetectionStrategy, ChangeDetectorRef, Component, Input, OnChanges, OnInit, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { EnvironmentsService } from '@core/environments.service';
import { TabItem } from '@core/tab.service';
import { Environment } from '@models/environment';

export interface EnvironmentVariable {
  key: string;
  value: string;
  description?: string;
  visible?: boolean; 
}

@Component({
  selector: 'app-environment',
  imports: [CommonModule],
  templateUrl: './environment.component.html',
  styleUrl: './environment.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class EnvironmentComponent implements OnInit, OnChanges {
  @Input() tab!: TabItem;

  environment!: Environment;
  variables: EnvironmentVariable[] = [];

  constructor(private environmentsService: EnvironmentsService,
    private cdr: ChangeDetectorRef) { }

  ngOnInit(): void {
    this.loadVariables();
  }

  ngOnChanges(changes: SimpleChanges) {
    this.loadVariables();
  }

  loadVariables(): void {
    const environmentId = this.tab.id;
    const environment = this.environmentsService.getEnvironmentById(environmentId);
    if (!environment)
      return;

    this.environment = environment;

    if (this.environment?.variables) {

      this.variables = this.environment.variables.map(v => ({
        key: v.key,
        value: v.value,
        description: v.description || '',
        visible: false
      }));
    } else {
      this.variables = [];
    }
    this.cdr.markForCheck();
  }

  saveVariables(): void {
    if (!this.environment) return;

    this.environment.variables = this.variables
      .filter(v => v.key?.trim() !== '')
      .map(v => ({
        key: v.key,
        value: v.value,
        description: v.description
      }));

    this.environmentsService.saveEnvironment(this.environment);
  }

  getValues(): EnvironmentVariable[] {
    return this.variables;
  }

  updateValue(event: Event, index: number, type: 'key' | 'value' | 'description'): void {
    const input = event.target as HTMLInputElement;
    const newValue = input.value;

    if (type === 'key') {
      this.variables[index].key = newValue;
    } else if (type === 'value') {
      this.variables[index].value = newValue;
    } else if (type === 'description') {
      this.variables[index].description = newValue;
    }
    this.cdr.markForCheck();
  }

  toggleVisibility(index: number): void {
    this.variables[index].visible = !this.variables[index].visible;
    this.cdr.markForCheck();
  }

  onBlur(index: number): void {
    const selectedVar = this.variables[index];
    if (selectedVar.key !== '') {
      this.saveOnChange();
    }
  }

  addValueEntry(): void {
    this.variables.push({ key: '', value: '', description: '', visible: false });
    this.cdr.markForCheck();
  }

  removeValueEntry(index: number): void {
    this.variables.splice(index, 1);
    this.saveOnChange();
    this.cdr.markForCheck();
  }

  saveOnChange(): void {
    this.saveVariables();
    this.cdr.markForCheck();
  }

  trackByIndex(index: number) {
    return index;
  }

}

