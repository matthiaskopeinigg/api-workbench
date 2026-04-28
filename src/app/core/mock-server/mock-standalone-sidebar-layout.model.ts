/** Standalone mock entries in the secondary sidebar tree (folders + ordering only; server state unchanged). */

export type MockStandaloneSidebarNode =
  | MockStandaloneSidebarFolderNode
  | MockStandaloneSidebarEndpointNode;

export interface MockStandaloneSidebarFolderNode {
  kind: 'folder';
  id: string;
  title: string;
  /** UI: children visible under this folder. */
  expanded: boolean;
  children: MockStandaloneSidebarNode[];
}

export interface MockStandaloneSidebarEndpointNode {
  kind: 'endpoint';
  id: string;
}

export interface MockStandaloneSidebarPersisted {
  v: 1;
  tree: MockStandaloneSidebarNode[];
}
