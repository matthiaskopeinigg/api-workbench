import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { v4 as uuidv4 } from 'uuid';

import type {
  MockStandaloneSidebarFolderNode,
  MockStandaloneSidebarNode,
  MockStandaloneSidebarPersisted,
} from './mock-standalone-sidebar-layout.model';

const STORAGE_KEY = 'aw.mockStandaloneSidebar.layout.v1';

export interface StandaloneSidebarFlatRow {
  node: MockStandaloneSidebarNode;
  depth: number;
  /** Parent folder id when this node is inside a folder; `null` at root. */
  parentFolderId: string | null;
}

function cloneTree(tree: MockStandaloneSidebarNode[]): MockStandaloneSidebarNode[] {
  return JSON.parse(JSON.stringify(tree)) as MockStandaloneSidebarNode[];
}

function collectEndpointIds(nodes: MockStandaloneSidebarNode[], out: Set<string>): void {
  for (const n of nodes) {
    if (n.kind === 'endpoint') out.add(n.id);
    else collectEndpointIds(n.children, out);
  }
}

function pruneMissingEndpoints(nodes: MockStandaloneSidebarNode[], keep: Set<string>): void {
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i];
    if (n.kind === 'endpoint') {
      if (!keep.has(n.id)) nodes.splice(i, 1);
    } else {
      pruneMissingEndpoints(n.children, keep);
    }
  }
}

function appendMissingEndpointsInOrder(tree: MockStandaloneSidebarNode[], orderedIds: string[]): void {
  const have = new Set<string>();
  collectEndpointIds(tree, have);
  for (const id of orderedIds) {
    if (!have.has(id)) {
      tree.push({ kind: 'endpoint', id });
      have.add(id);
    }
  }
}

interface Found {
  list: MockStandaloneSidebarNode[];
  index: number;
  node: MockStandaloneSidebarNode;
}

function findNode(nodes: MockStandaloneSidebarNode[], id: string): Found | null {
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (n.id === id) return { list: nodes, index: i, node: n };
    if (n.kind === 'folder') {
      const inner = findNode(n.children, id);
      if (inner) return inner;
    }
  }
  return null;
}

function isDescendantFolder(folder: MockStandaloneSidebarFolderNode, ancestorId: string): boolean {
  for (const c of folder.children) {
    if (c.kind === 'folder') {
      if (c.id === ancestorId) return true;
      if (isDescendantFolder(c, ancestorId)) return true;
    }
  }
  return false;
}

export function flattenStandaloneSidebarTree(nodes: MockStandaloneSidebarNode[]): StandaloneSidebarFlatRow[] {
  const walk = (list: MockStandaloneSidebarNode[], depth: number, parentFolderId: string | null): StandaloneSidebarFlatRow[] => {
    const out: StandaloneSidebarFlatRow[] = [];
    for (const node of list) {
      out.push({ node, depth, parentFolderId });
      if (node.kind === 'folder' && node.expanded) {
        out.push(...walk(node.children, depth + 1, node.id));
      }
    }
    return out;
  };
  return walk(nodes, 0, null);
}

@Injectable({ providedIn: 'root' })
export class MockStandaloneSidebarLayoutService {
  private readonly tree$ = new BehaviorSubject<MockStandaloneSidebarNode[]>([]);

  readonly tree = this.tree$.asObservable();

  constructor() {
    this.loadFromStorage();
  }

  getTreeSnapshot(): MockStandaloneSidebarNode[] {
    return cloneTree(this.tree$.value);
  }

  syncWithEndpointIds(orderedEndpointIds: string[]): void {
    const keep = new Set(orderedEndpointIds);
    const tree = cloneTree(this.tree$.value);
    pruneMissingEndpoints(tree, keep);
    appendMissingEndpointsInOrder(tree, orderedEndpointIds);
    this.commit(tree);
  }

  addFolder(title: string, parentFolderId: string | null = null): string {
    const tree = cloneTree(this.tree$.value);
    const folder: MockStandaloneSidebarFolderNode = {
      kind: 'folder',
      id: uuidv4(),
      title: title.trim() || 'New folder',
      expanded: true,
      children: [],
    };
    if (parentFolderId == null) {
      tree.unshift(folder);
    } else {
      const parent = findNode(tree, parentFolderId);
      if (!parent || parent.node.kind !== 'folder') {
        tree.unshift(folder);
      } else {
        parent.node.children.unshift(folder);
        parent.node.expanded = true;
      }
    }
    this.commit(tree);
    return folder.id;
  }

  toggleFolder(folderId: string): void {
    const tree = cloneTree(this.tree$.value);
    const f = findNode(tree, folderId);
    if (!f || f.node.kind !== 'folder') return;
    f.node.expanded = !f.node.expanded;
    this.commit(tree);
  }

  renameFolder(folderId: string, title: string): void {
    const tree = cloneTree(this.tree$.value);
    const f = findNode(tree, folderId);
    if (!f || f.node.kind !== 'folder') return;
    f.node.title = title.trim() || 'Folder';
    this.commit(tree);
  }

  /** Remove folder node and all nested children. */
  deleteFolder(folderId: string): void {
    const tree = cloneTree(this.tree$.value);
    const f = findNode(tree, folderId);
    if (!f || f.node.kind !== 'folder') return;
    f.list.splice(f.index, 1);
    this.commit(tree);
  }

  /**
   * Remove `dragId` from its current location and insert into `parentFolderId` list
   * (`null` = root) before sibling `beforeSiblingId` (`null` = append at end).
   */
  moveItemToParent(
    dragKind: 'endpoint' | 'folder',
    dragId: string,
    parentFolderId: string | null,
    beforeSiblingId: string | null,
  ): void {
    if (parentFolderId === dragId) return;
    const tree = cloneTree(this.tree$.value);
    const dragRef = findNode(tree, dragId);
    if (!dragRef || dragRef.node.kind !== dragKind) return;

    let destList: MockStandaloneSidebarNode[];
    if (parentFolderId == null) {
      destList = tree;
    } else {
      const pf = findNode(tree, parentFolderId);
      if (!pf || pf.node.kind !== 'folder') return;
      destList = pf.node.children;
      if (dragKind === 'folder') {
        const draggedFolder = dragRef.node as MockStandaloneSidebarFolderNode;
        const targetFolder = pf.node;
        // Block cycles: cannot move folder into itself or any descendant.
        if (targetFolder.id === dragId || isDescendantFolder(draggedFolder, targetFolder.id)) return;
      }
    }

    const [removed] = dragRef.list.splice(dragRef.index, 1);
    let idx = beforeSiblingId == null ? destList.length : destList.findIndex((n) => n.id === beforeSiblingId);
    if (idx < 0) idx = destList.length;
    if (dragRef.list === destList && dragRef.index < idx) {
      idx -= 1;
    }
    destList.splice(idx, 0, removed);
    if (removed.kind === 'folder' && parentFolderId != null) {
      (findNode(tree, parentFolderId)!.node as MockStandaloneSidebarFolderNode).expanded = true;
    }
    this.commit(tree);
  }

  /** Append dragged node as last child of folder (or noop if invalid). */
  moveIntoFolder(dragKind: 'endpoint' | 'folder', dragId: string, folderId: string): void {
    if (dragId === folderId) return;
    const tree = cloneTree(this.tree$.value);
    const dragRef = findNode(tree, dragId);
    const folderRef = findNode(tree, folderId);
    if (!dragRef || !folderRef || folderRef.node.kind !== 'folder') return;
    const folder = folderRef.node;
    if (dragKind === 'folder') {
      const draggedFolder = dragRef.node as MockStandaloneSidebarFolderNode;
      // Block cycles: cannot move folder into itself or any descendant.
      if (folder.id === dragId || isDescendantFolder(draggedFolder, folder.id)) return;
    }
    const [removed] = dragRef.list.splice(dragRef.index, 1);
    folder.children.push(removed);
    folder.expanded = true;
    this.commit(tree);
  }

  private commit(tree: MockStandaloneSidebarNode[]): void {
    this.tree$.next(tree);
    try {
      const payload: MockStandaloneSidebarPersisted = { v: 1, tree };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      /* quota */
    }
  }

  private loadFromStorage(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        this.tree$.next([]);
        return;
      }
      const parsed = JSON.parse(raw) as MockStandaloneSidebarPersisted;
      if (parsed?.v !== 1 || !Array.isArray(parsed.tree)) {
        this.tree$.next([]);
        return;
      }
      this.tree$.next(cloneTree(parsed.tree));
    } catch {
      this.tree$.next([]);
    }
  }
}
