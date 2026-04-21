import { Component, OnInit, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CookieService } from '@core/cookie.service';

@Component({
  selector: 'app-cookie-manager',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="dialog-overlay" (click)="close.emit()">
      <div class="dialog-content" (click)="$event.stopPropagation()" role="dialog" aria-modal="true">
        <header class="dialog-header">
          <div class="dialog-title-group">
            <div class="dialog-icon" aria-hidden="true">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10"></circle>
                <circle cx="8" cy="10" r="1.4" fill="currentColor" stroke="none"></circle>
                <circle cx="14" cy="9" r="1.1" fill="currentColor" stroke="none"></circle>
                <path d="M8 14c1.5 2 4.5 2.5 8-1"></path>
              </svg>
            </div>
            <div class="dialog-title-text">
              <h3>Cookie Jar</h3>
              <p>Browser-style cookies stored across all requests.</p>
            </div>
          </div>
          <div class="header-actions">
            <button class="clear-btn" (click)="clearAll()" *ngIf="cookies.length > 0">
              Clear all
            </button>
            <button class="close-icon" (click)="close.emit()" aria-label="Close cookie manager">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   stroke-width="2.4" stroke-linecap="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18"></path>
              </svg>
            </button>
          </div>
        </header>

        <div class="dialog-body">
          <div class="search-bar">
            <svg class="search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
                 aria-hidden="true">
              <circle cx="11" cy="11" r="8"></circle>
              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            </svg>
            <input type="text" [(ngModel)]="searchTerm"
                   placeholder="Search by domain or cookie name…">
          </div>

          <div class="cookie-list">
            <div *ngFor="let group of filteredGroups" class="domain-group">
              <div class="domain-header">
                <span class="domain">{{ group.domain }}</span>
                <span class="count">{{ group.cookies.length }} cookie{{ group.cookies.length === 1 ? '' : 's' }}</span>
              </div>

              <div class="cookies">
                <div *ngFor="let cookie of group.cookies" class="cookie-item">
                  <div class="cookie-info">
                    <span class="name">{{ cookie.key }}</span>
                    <span class="value">{{ cookie.value }}</span>
                  </div>
                  <button class="delete-btn" (click)="deleteCookie(cookie)" aria-label="Delete cookie">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                         stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"></path>
                    </svg>
                  </button>
                </div>
              </div>
            </div>

            <div *ngIf="filteredGroups.length === 0" class="empty-state">
              <div class="empty-icon" aria-hidden="true">
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="12" r="10"></circle>
                  <circle cx="9" cy="10" r="1" fill="currentColor" stroke="none"></circle>
                  <circle cx="15" cy="10" r="1" fill="currentColor" stroke="none"></circle>
                </svg>
              </div>
              <strong>No cookies stored</strong>
              <span>Cookies received from servers will appear here.</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .dialog-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.5);
      display: grid;
      place-items: center;
      z-index: 3000;
      backdrop-filter: blur(6px);
      animation: cookie-overlay-in 0.18s ease-out;
    }
    @keyframes cookie-overlay-in {
      from { opacity: 0; }
      to   { opacity: 1; }
    }
    .dialog-content {
      background: var(--surface);
      color: var(--text-color);
      width: min(640px, calc(100vw - 64px));
      max-height: min(720px, calc(100vh - 80px));
      border-radius: var(--aw-radius-lg, 12px);
      box-shadow: var(--aw-shadow-xl);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      isolation: isolate;
      border: 1px solid color-mix(in srgb, var(--border-color), transparent 40%);
      animation: cookie-popup-in 0.22s cubic-bezier(0.16, 1, 0.3, 1);
    }
    @keyframes cookie-popup-in {
      from { transform: scale(0.95) translateY(12px); opacity: 0; }
      to   { transform: scale(1) translateY(0);     opacity: 1; }
    }
    .dialog-header {
      padding: 16px 18px;
      border-bottom: 1px solid color-mix(in srgb, var(--border-color), transparent 40%);
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
      flex-shrink: 0;
    }
    .dialog-title-group {
      display: flex;
      align-items: center;
      gap: 12px;
      min-width: 0;
    }
    .dialog-icon {
      width: 36px;
      height: 36px;
      flex-shrink: 0;
      border-radius: 10px;
      display: grid;
      place-items: center;
      background: linear-gradient(135deg,
        color-mix(in srgb, var(--secondary-color), transparent 65%),
        color-mix(in srgb, var(--secondary-color), transparent 85%));
      color: var(--secondary-color);
      box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--secondary-color), transparent 70%);
    }
    .dialog-title-text {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
    }
    .dialog-title-text h3 {
      margin: 0;
      font-size: 0.95rem;
      font-weight: 700;
      letter-spacing: -0.01em;
    }
    .dialog-title-text p {
      margin: 0;
      font-size: 0.75rem;
      opacity: 0.55;
    }
    .header-actions {
      display: flex;
      gap: 6px;
      align-items: center;
    }
    .clear-btn {
      background: transparent;
      color: var(--aw-status-error, #ef4444);
      border: 1px solid color-mix(in srgb, var(--aw-status-error, #ef4444), transparent 70%);
      padding: 5px 12px;
      border-radius: var(--aw-radius-sm, 6px);
      font-size: 0.75rem;
      font-weight: 600;
      cursor: pointer;
      transition: background-color var(--aw-duration-fast, 120ms) ease,
        color var(--aw-duration-fast, 120ms) ease;
    }
    .clear-btn:hover {
      background: var(--aw-status-error, #ef4444);
      color: #fff;
    }
    .close-icon {
      width: 28px;
      height: 28px;
      display: grid;
      place-items: center;
      background: transparent;
      border: 0;
      color: color-mix(in srgb, var(--text-color), transparent 50%);
      cursor: pointer;
      border-radius: var(--aw-radius-sm, 6px);
      transition: background-color var(--aw-duration-fast, 120ms) ease,
        color var(--aw-duration-fast, 120ms) ease;
    }
    .close-icon:hover {
      background: color-mix(in srgb, var(--text-color), transparent 92%);
      color: var(--text-color);
    }
    .dialog-body {
      padding: 14px 16px 16px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      flex: 1;
      min-height: 0;
    }
    .search-bar {
      position: relative;
    }
    .search-icon {
      position: absolute;
      top: 50%;
      left: 12px;
      transform: translateY(-50%);
      color: color-mix(in srgb, var(--text-color), transparent 50%);
      pointer-events: none;
    }
    .search-bar input {
      width: 100%;
      box-sizing: border-box;
      background: color-mix(in srgb, var(--text-color), transparent 96%);
      border: 1px solid color-mix(in srgb, var(--border-color), transparent 30%);
      padding: 9px 12px 9px 34px;
      border-radius: var(--aw-radius-md, 8px);
      color: var(--text-color);
      font-size: 0.85rem;
      outline: none;
      transition: border-color var(--aw-duration-fast, 120ms) ease,
        box-shadow var(--aw-duration-fast, 120ms) ease;
    }
    .search-bar input:focus {
      border-color: var(--secondary-color);
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--secondary-color), transparent 80%);
    }
    .cookie-list {
      flex: 1;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding-right: 2px;
    }
    .cookie-list::-webkit-scrollbar { width: 6px; }
    .cookie-list::-webkit-scrollbar-thumb {
      background: color-mix(in srgb, var(--text-color), transparent 88%);
      border-radius: 10px;
    }
    .domain-group {
      background: color-mix(in srgb, var(--text-color), transparent 97%);
      border-radius: var(--aw-radius-md, 8px);
      border: 1px solid color-mix(in srgb, var(--border-color), transparent 40%);
      overflow: hidden;
    }
    .domain-header {
      padding: 8px 12px;
      background: color-mix(in srgb, var(--text-color), transparent 95%);
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid color-mix(in srgb, var(--border-color), transparent 50%);
    }
    .domain {
      font-weight: 700;
      font-size: 0.8rem;
      color: var(--secondary-color);
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      letter-spacing: -0.01em;
    }
    .count {
      font-size: 0.7rem;
      opacity: 0.5;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      font-weight: 700;
    }
    .cookie-item {
      padding: 8px 12px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid color-mix(in srgb, var(--border-color), transparent 60%);
      gap: 10px;
      transition: background-color var(--aw-duration-fast, 120ms) ease;
    }
    .cookie-item:last-child { border-bottom: none; }
    .cookie-item:hover {
      background: color-mix(in srgb, var(--text-color), transparent 96%);
    }
    .cookie-info {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
      flex: 1;
    }
    .cookie-info .name {
      font-weight: 600;
      font-size: 0.78rem;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      color: var(--text-color);
    }
    .cookie-info .value {
      font-size: 0.72rem;
      opacity: 0.55;
      word-break: break-all;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      line-height: 1.4;
    }
    .delete-btn {
      background: transparent;
      border: 0;
      color: color-mix(in srgb, var(--text-color), transparent 55%);
      cursor: pointer;
      width: 28px;
      height: 28px;
      display: grid;
      place-items: center;
      border-radius: var(--aw-radius-sm, 6px);
      flex-shrink: 0;
      transition: background-color var(--aw-duration-fast, 120ms) ease,
        color var(--aw-duration-fast, 120ms) ease;
    }
    .delete-btn:hover {
      background: color-mix(in srgb, var(--aw-status-error, #ef4444), transparent 88%);
      color: var(--aw-status-error, #ef4444);
    }
    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 6px;
      padding: 48px 24px;
      text-align: center;
      opacity: 0.7;
    }
    .empty-state .empty-icon {
      color: color-mix(in srgb, var(--text-color), transparent 60%);
      margin-bottom: 4px;
    }
    .empty-state strong {
      font-size: 0.9rem;
      font-weight: 600;
    }
    .empty-state span {
      font-size: 0.78rem;
      opacity: 0.7;
    }
  `]
})
export class CookieManagerComponent implements OnInit {
  @Output() close = new EventEmitter<void>();

  cookies: any[] = [];
  searchTerm = '';

  constructor(private cookieService: CookieService) { }

  async ngOnInit() {
    await this.loadCookies();
  }

  async loadCookies() {
    this.cookies = await this.cookieService.getAllCookies();
  }

  get filteredGroups() {
    const term = this.searchTerm.toLowerCase();
    const groups: Record<string, any[]> = {};

    this.cookies.forEach(c => {
      const domain = c.domain || 'unknown';
      if (!groups[domain]) groups[domain] = [];
      if (domain.toLowerCase().includes(term) || c.key.toLowerCase().includes(term)) {
        groups[domain].push(c);
      }
    });

    return Object.entries(groups)
      .filter(([_, cookies]) => cookies.length > 0)
      .map(([domain, cookies]) => ({ domain, cookies }))
      .sort((a, b) => a.domain.localeCompare(b.domain));
  }

  async deleteCookie(cookie: any) {
    await this.cookieService.deleteCookie(cookie.domain, cookie.path, cookie.key);
    await this.loadCookies();
  }

  async clearAll() {
    if (confirm('Are you sure you want to clear all cookies?')) {
      await this.cookieService.clearAllCookies();
      await this.loadCookies();
    }
  }
}
