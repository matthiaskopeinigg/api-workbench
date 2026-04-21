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
  template: `
    <ul class="tree" *ngIf="nodes?.length; else empty">
      <ng-container *ngFor="let n of nodes; trackBy: trackById">
        <ng-container *ngTemplateOutlet="branch; context: { node: n, depth: 0 }"></ng-container>
      </ng-container>
    </ul>

    <ng-template #branch let-node="node" let-depth="depth">
      <li class="row" [class]="'status-' + node.status" [style.paddingLeft.px]="depth * 14 + 6">
        <button
          type="button"
          class="row-btn"
          [class.has-children]="(node.children?.length ?? 0) > 0"
          (click)="onClick(node)">
          <span class="caret" *ngIf="(node.children?.length ?? 0) > 0">{{ isOpen(node.id) ? '▾' : '▸' }}</span>
          <span class="caret-spacer" *ngIf="!(node.children?.length ?? 0)"></span>
          <span class="status-pill" [class]="'pill-' + node.status" [attr.title]="node.status"></span>
          <span class="label">{{ node.label }}</span>
          <span class="meta" *ngIf="node.meta">{{ node.meta }}</span>
        </button>
      </li>
      <ng-container *ngIf="(node.children?.length ?? 0) > 0 && isOpen(node.id)">
        <ng-container *ngFor="let child of node.children; trackBy: trackById">
          <ng-container *ngTemplateOutlet="branch; context: { node: child, depth: depth + 1 }"></ng-container>
        </ng-container>
      </ng-container>
    </ng-template>

    <ng-template #empty>
      <div class="tree-empty">No results yet.</div>
    </ng-template>
  `,
  styles: [`
    :host { display: block; }
    .tree { list-style: none; margin: 0; padding: 0; font-size: 12.5px; }
    .row { padding: 0; }
    .row-btn {
      display: flex; align-items: center; gap: 8px;
      width: 100%; background: transparent; border: 0; padding: 4px 6px;
      border-radius: 4px; cursor: pointer; color: var(--text-color);
      text-align: left;
    }
    .row-btn:hover { background: color-mix(in srgb, var(--text-color), transparent 92%); }
    .caret { width: 12px; color: color-mix(in srgb, var(--text-color), transparent 45%); font-size: 10px; }
    .caret-spacer { width: 12px; display: inline-block; }
    .status-pill {
      width: 10px; height: 10px; border-radius: 999px; display: inline-block;
      background: color-mix(in srgb, var(--text-color), transparent 45%);
    }
    .pill-pass    { background: var(--aw-status-success); }
    .pill-fail    { background: var(--aw-status-error); }
    .pill-warn    { background: var(--aw-status-warning); }
    .pill-skip    { background: color-mix(in srgb, var(--text-color), transparent 45%); opacity: 0.6; }
    .pill-info    { background: var(--primary-color); }
    .pill-running {
      background: var(--primary-color);
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--primary-color) 30%, transparent);
      animation: pulse 1.4s infinite;
    }
    .pill-idle    { background: color-mix(in srgb, var(--text-color), transparent 45%); opacity: 0.4; }
    .label { flex: 1; }
    .meta { font-size: 11px; color: color-mix(in srgb, var(--text-color), transparent 45%); margin-left: 8px; }
    .tree-empty {
      color: color-mix(in srgb, var(--text-color), transparent 45%);
      font-size: 12px; padding: 24px 12px; text-align: center;
    }
    @keyframes pulse {
      0% { opacity: 1; } 50% { opacity: 0.55; } 100% { opacity: 1; }
    }
  `],
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
