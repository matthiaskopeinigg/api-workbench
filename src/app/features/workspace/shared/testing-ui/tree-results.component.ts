import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';

export type TreeStatus = 'pass' | 'fail' | 'warn' | 'skip' | 'info' | 'running' | 'idle';

export interface TreeNode {
  id: string;
  label: string;
  status: TreeStatus;
  /** Right-aligned secondary text (timing, count, etc). */
  meta?: string;
  /** Subtree. Leaf when undefined / empty. */
  children?: TreeNode[];
}

/**
 * Generic collapsible pass/fail tree. Used by Test Suite, Contract Test
 * and the Flow Builder's run inspector.
 */
@Component({
  selector: 'aw-tree-results',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './tree-results.component.html',

  styleUrl: './tree-results.component.scss',
})
export class TreeResultsComponent {
  @Input() nodes: TreeNode[] = [];
  @Output() nodeClick = new EventEmitter<TreeNode>();
  /** Start with everything expanded one level deep. */
  @Input() defaultExpand = true;

  private collapsed = new Set<string>();
  private touched = new Set<string>();

  trackById = (_: number, n: TreeNode) => n.id;

  isOpen(id: string): boolean {
    if (!this.touched.has(id)) return this.defaultExpand;
    return !this.collapsed.has(id);
  }

  onClick(n: TreeNode): void {
    if (n.children?.length) {
      this.touched.add(n.id);
      if (this.collapsed.has(n.id)) this.collapsed.delete(n.id);
      else this.collapsed.add(n.id);
    }
    this.nodeClick.emit(n);
  }
}
