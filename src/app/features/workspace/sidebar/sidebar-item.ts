import { Type } from '@angular/core';

/**
 * Activity-bar entry for the primary sidebar.
 *
 * `icon` may be either:
 *   - a single SVG `<path d="...">` string (preferred — renders crisp at any size), or
 *   - a legacy emoji / single character (rendered as text).
 */
export abstract class SidebarItem {
  abstract label: string;

  abstract icon: string;

  abstract active?: boolean;

  abstract component: Type<any> | null;

  /**
   * Optional click handler. When provided, the sidebar runs the action
   * instead of toggling a secondary panel — used for entries that open a
   * full workspace tab (e.g. Mock Server) rather than a side-panel.
   */
  action?: () => void;
}


