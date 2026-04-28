import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FlowNode } from '../../models/flow.model';

@Component({
  selector: 'app-flow-tree',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './flow-tree.component.html',
  styleUrl: './flow-tree.component.scss',
})
export class FlowTreeComponent {
  @Input() nodes: FlowNode[] = [];
  @Input() selectedNodeId: string | null = null;
  @Input() depth: number = 0;

  @Output() nodeSelected = new EventEmitter<string>();
  @Output() toggleFolder = new EventEmitter<string>();
  @Output() addToFolder = new EventEmitter<string>();
  @Output() deleteNode = new EventEmitter<string>();

  getStepTypeIcon(stepType: string): string {
    switch (stepType) {
      case 'REQUEST': return '🌐';
      case 'VALIDATION': return '⚖️';
      case 'DATABASE': return '💾';
      case 'E2E': return '🖥️';
      case 'INTERCEPT': return '🛰️';
      case 'WAIT': return '⏱️';
      case 'SECURITY': return '🛡️';
      case 'MANUAL': return '⌨️';
      default: return '●';
    }
  }

  getStepTypeClass(stepType: string): string {
    return `tree-node__icon--${stepType.toLowerCase()}`;
  }

  onSelect(nodeId: string, event: Event): void {
    event.stopPropagation();
    this.nodeSelected.emit(nodeId);
  }

  onToggle(folderId: string, event: Event): void {
    event.stopPropagation();
    this.toggleFolder.emit(folderId);
  }

  onAdd(folderId: string, event: Event): void {
    event.stopPropagation();
    this.addToFolder.emit(folderId);
  }

  onDelete(nodeId: string, event: Event): void {
    event.stopPropagation();
    this.deleteNode.emit(nodeId);
  }

  // Forward child events
  onChildNodeSelected(id: string): void { this.nodeSelected.emit(id); }
  onChildToggleFolder(id: string): void { this.toggleFolder.emit(id); }
  onChildAddToFolder(id: string): void { this.addToFolder.emit(id); }
  onChildDeleteNode(id: string): void { this.deleteNode.emit(id); }
}
