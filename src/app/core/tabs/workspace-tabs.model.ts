import type { TabItem } from './tab.service';

/** One editor pane in a horizontal split workspace. */
export interface WorkspacePaneState {
  tabs: TabItem[];
  /** Stable id of the selected tab, or null if the pane has no tabs. */
  selectedTabId: string | null;
}

export type SplitOrientation = 'horizontal' | 'vertical';

/** Persisted workspace tab layout (split + optional second pane). */
export interface WorkspaceTabsState {
  split: boolean;
  /** Primary pane share: horizontal = width fraction, vertical = height fraction. */
  ratio: number;
  orientation?: SplitOrientation;
  /** Per-pane environment selection; null entry uses global active environment. */
  paneEnvironmentIds?: { primary: string | null; secondary: string | null };
  primary: WorkspacePaneState;
  secondary: WorkspacePaneState;
}

export type WorkspacePaneId = 'primary' | 'secondary';

export function emptyPaneState(): WorkspacePaneState {
  return { tabs: [], selectedTabId: null };
}

export function defaultWorkspaceTabsState(): WorkspaceTabsState {
  return {
    split: false,
    ratio: 0.5,
    orientation: 'horizontal',
    paneEnvironmentIds: { primary: null, secondary: null },
    primary: emptyPaneState(),
    secondary: emptyPaneState(),
  };
}

/** Index of selected tab in `pane.tabs`, or 0 if empty / id not found. */
export function selectedIndexForPane(pane: WorkspacePaneState): number {
  if (pane.tabs.length === 0) return 0;
  if (!pane.selectedTabId) return 0;
  const i = pane.tabs.findIndex(t => t.id === pane.selectedTabId);
  return i === -1 ? 0 : i;
}
