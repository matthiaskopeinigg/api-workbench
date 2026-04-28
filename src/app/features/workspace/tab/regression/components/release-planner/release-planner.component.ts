import { Component, EventEmitter, Input, Output, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Project, Flow, FlowListItem, FlowGroup } from '../../models/flow.model';
import { ExecutionSettings } from '../../models/regression-run.model';

@Component({
  selector: 'app-release-planner',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './release-planner.component.html',
  styleUrl: './release-planner.component.scss'
})
export class ReleasePlannerComponent {
  @Input({ required: true }) projects: Project[] = [];
  @Output() cancel = new EventEmitter<void>();
  @Output() plan = new EventEmitter<{ versionTag: string, description: string, flowIds: string[], settings: ExecutionSettings }>();

  readonly step = signal<1 | 2 | 3>(1);
  readonly versionTag = signal('');
  readonly description = signal('');
  
  // Selection
  readonly selectedFlowIds = signal<Set<string>>(new Set());
  
  // Settings
  readonly settings = signal<ExecutionSettings>({
    headless: true,
    stopOnFailure: true,
    parallel: false
  });

  readonly totalSelected = computed(() => this.selectedFlowIds().size);

  nextStep() {
    if (this.step() < 3) this.step.update(s => (s + 1) as any);
  }

  prevStep() {
    if (this.step() > 1) this.step.update(s => (s - 1) as any);
  }

  toggleFlow(flowId: string) {
    const next = new Set(this.selectedFlowIds());
    if (next.has(flowId)) next.delete(flowId);
    else next.add(flowId);
    this.selectedFlowIds.set(next);
  }

  toggleFolder(items: FlowListItem[], checked: boolean) {
    const next = new Set(this.selectedFlowIds());
    this.deepToggle(items, checked, next);
    this.selectedFlowIds.set(next);
  }

  private deepToggle(items: FlowListItem[], checked: boolean, set: Set<string>) {
    for (const item of items) {
      if (item.type === 'flow') {
        if (checked) set.add(item.flow.id);
        else set.delete(item.flow.id);
      } else {
        this.deepToggle(item.children, checked, set);
      }
    }
  }

  isFolderSelected(items: FlowListItem[]): boolean {
    const flows = this.getFlowsInFolder(items);
    if (flows.length === 0) return false;
    return flows.every(f => this.selectedFlowIds().has(f.id));
  }

  isFolderIndeterminate(items: FlowListItem[]): boolean {
    const flows = this.getFlowsInFolder(items);
    if (flows.length === 0) return false;
    const selectedCount = flows.filter(f => this.selectedFlowIds().has(f.id)).length;
    return selectedCount > 0 && selectedCount < flows.length;
  }

  private getFlowsInFolder(items: FlowListItem[]): Flow[] {
    const flows: Flow[] = [];
    const collect = (list: FlowListItem[]) => {
      for (const item of list) {
        if (item.type === 'flow') flows.push(item.flow);
        else collect(item.children);
      }
    };
    collect(items);
    return flows;
  }

  finish() {
    this.plan.emit({
      versionTag: this.versionTag(),
      description: this.description(),
      flowIds: Array.from(this.selectedFlowIds()),
      settings: this.settings()
    });
  }

  asGroup(item: FlowListItem): FlowGroup { return item as FlowGroup; }
}
