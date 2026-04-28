import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FlowListItem, FlowGroup, FlowListEntry } from '../../models/flow.model';

@Component({
  selector: 'app-flow-browser',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './flow-browser.component.html',
  styleUrl: './flow-browser.component.scss',
})
export class FlowBrowserComponent {
  @Input() items: FlowListItem[] = [];
  @Input() depth: number = 0;

  @Output() selectFlow = new EventEmitter<string>();
  @Output() deleteFlow = new EventEmitter<string>();
  @Output() toggleGroup = new EventEmitter<string>();
  @Output() deleteGroup = new EventEmitter<string>();
  @Output() addFlowToGroup = new EventEmitter<string>();
  @Output() addGroupToGroup = new EventEmitter<string>();

  isGroup(item: FlowListItem): item is FlowGroup {
    return item.type === 'group';
  }

  asGroup(item: FlowListItem): FlowGroup {
    return item as FlowGroup;
  }

  asFlowEntry(item: FlowListItem): FlowListEntry {
    return item as FlowListEntry;
  }

  onSelectFlow(flowId: string, event: Event): void {
    event.stopPropagation();
    this.selectFlow.emit(flowId);
  }

  onDeleteFlow(flowId: string, event: Event): void {
    event.stopPropagation();
    this.deleteFlow.emit(flowId);
  }

  onToggleGroup(groupId: string, event: Event): void {
    event.stopPropagation();
    this.toggleGroup.emit(groupId);
  }

  onDeleteGroup(groupId: string, event: Event): void {
    event.stopPropagation();
    this.deleteGroup.emit(groupId);
  }

  onAddFlow(groupId: string, event: Event): void {
    event.stopPropagation();
    this.addFlowToGroup.emit(groupId);
  }

  onAddGroup(groupId: string, event: Event): void {
    event.stopPropagation();
    this.addGroupToGroup.emit(groupId);
  }

  countFlowsInGroup(group: FlowGroup): number {
    let count = 0;
    for (const child of group.children) {
      if (child.type === 'flow') count++;
      else if (child.type === 'group') count += this.countFlowsInGroup(child);
    }
    return count;
  }

  getStatusClass(status: string): string {
    switch (status) {
      case 'passed': return 'status--passed';
      case 'failed': return 'status--failed';
      case 'running': return 'status--running';
      default: return 'status--neutral';
    }
  }

  // Forward events from child
  onChildSelectFlow(id: string): void { this.selectFlow.emit(id); }
  onChildDeleteFlow(id: string): void { this.deleteFlow.emit(id); }
  onChildToggleGroup(id: string): void { this.toggleGroup.emit(id); }
  onChildDeleteGroup(id: string): void { this.deleteGroup.emit(id); }
  onChildAddFlowToGroup(id: string): void { this.addFlowToGroup.emit(id); }
  onChildAddGroupToGroup(id: string): void { this.addGroupToGroup.emit(id); }
}
