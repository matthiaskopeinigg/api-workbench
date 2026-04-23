import { Component, OnInit, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CookieService } from '@core/http/cookie.service';
import { ConfirmDialogService } from '@core/ui/confirm-dialog.service';

@Component({
  selector: 'app-cookie-manager',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './cookie-manager.component.html',

  styleUrl: './cookie-manager.component.scss',
})
export class CookieManagerComponent implements OnInit {
  @Output() close = new EventEmitter<void>();

  cookies: any[] = [];
  searchTerm = '';

  constructor(
    private cookieService: CookieService,
    private confirmDialog: ConfirmDialogService,
  ) {}

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
    const ok = await this.confirmDialog.confirm({
      title: 'Clear cookies',
      message: 'Are you sure you want to clear all cookies?',
      destructive: true,
      confirmLabel: 'Clear all',
    });
    if (!ok) return;
    await this.cookieService.clearAllCookies();
    await this.loadCookies();
  }
}
