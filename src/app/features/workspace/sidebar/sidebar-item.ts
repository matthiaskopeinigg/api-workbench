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
   * Optional click handler. When `component` is null, the sidebar runs the
   * action instead of toggling a secondary panel (e.g. Help). When both
   * `component` and `action` are set, the action runs (e.g. open a tab) and
   * the secondary panel shows that component (e.g. Mock Server + endpoints).
   */
  action?: () => void;
}


