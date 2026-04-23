import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { SettingsService } from './settings.service';
import { Theme } from '@models/settings';

@Injectable({
  providedIn: 'root',
})
export class ThemeService {
  private themeSubject = new BehaviorSubject<Theme>(Theme.LIGHT);

  constructor(private settingsService: SettingsService) {
    if (typeof window !== 'undefined') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      mq.addEventListener('change', () => {
        if (this.themeSubject.value === Theme.SYSTEM) {
          this.applyTheme(Theme.SYSTEM);
        }
      });
    }
  }

  async loadTheme() {
    try {
      await this.settingsService.loadSettings();
      const settings = this.settingsService.getSettings();
      const savedTheme = settings?.ui?.theme;
      await this.setTheme(savedTheme || Theme.LIGHT, false);
    } catch {
      await this.setTheme(Theme.LIGHT, false);
    }
  }

  getTheme(): Theme {
    return this.themeSubject.value;
  }

  getThemeSubject() {
    return this.themeSubject;
  }

  async setTheme(theme: Theme, persist: boolean = true) {
    this.applyTheme(theme);
    this.themeSubject.next(theme);

    if (persist) {
      const settings = this.settingsService.getSettings();
      if (!settings.ui) {
        settings.ui = { theme: Theme.LIGHT } as any;
      }
      settings.ui.theme = theme;
      await this.settingsService.saveSettings(settings);
    }
  }

  /** Palette applied to DOM (follows OS when theme is SYSTEM). */
  private resolvePaletteTheme(theme: Theme): Theme {
    if (theme !== Theme.SYSTEM) {
      return theme;
    }
    if (typeof window === 'undefined') {
      return Theme.AYU_DARK;
    }
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? Theme.AYU_DARK : Theme.AYU_LIGHT;
  }

  applyTheme(theme: Theme) {
    const paletteTheme = this.resolvePaletteTheme(theme);
    const themeClass = `theme-${paletteTheme.replace(/_/g, '-').toLowerCase()}`;
    this.applyThemeToElement(document.body, themeClass);
    this.applyThemeToElement(document.documentElement, themeClass);

    if (theme === Theme.SYSTEM) {
      document.documentElement.setAttribute('data-theme', 'system');
    } else {
      const lightThemes = new Set<Theme>([
        Theme.LIGHT,
        Theme.AYU_LIGHT,
        Theme.NIGHT_OWL_LIGHT,
        Theme.SOLARIZED_LIGHT,
      ]);
      const mode: 'light' | 'dark' = lightThemes.has(theme) ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', mode);
    }

    const compact = this.settingsService.getSettings()?.ui?.compactMode === true;
    document.documentElement.setAttribute('data-density', compact ? 'compact' : 'comfortable');
  }

  private applyThemeToElement(el: HTMLElement, themeClass: string) {
    Array.from(el.classList)
      .filter((cls) => cls.startsWith('theme-'))
      .forEach((cls) => el.classList.remove(cls));

    el.classList.add(themeClass);
  }
}
