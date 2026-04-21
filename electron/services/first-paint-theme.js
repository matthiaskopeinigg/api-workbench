const { nativeTheme } = require('electron');

/** Matches dominant --bg-color from [src/styles.scss] per theme id for BrowserWindow.backgroundColor */
const THEME_BG_HEX = {
  light: '#fafafa',
  dark: '#121212',
  'high-contrast-dark': '#000000',
  'high-contrast-darklight': '#1a1a1a',
  'ayu-light': '#f0f0f0',
  'ayu-dark': '#0b0e14',
  dracula: '#282a36',
  monokai: '#272822',
  'night-owl-light': '#fdf6ff',
  'night-owl-dark': '#000C1D',
  'solarized-light': '#fdf6e3',
  'solarized-dark': '#002b36',
};

const LIGHT_PALETTE_THEMES = new Set(['light', 'ayu-light', 'night-owl-light', 'solarized-light']);

/**
 * Call only after initStores(). Uses persisted settings.ui.theme.
 */
function getFirstPaintBackgroundColor() {
  try {
    const storeService = require('./store.service');
    const settings = storeService.getSettings();
    let theme = settings?.ui?.theme ?? 'ayu-dark';
    if (theme === 'system') {
      return nativeTheme.shouldUseDarkColors ? '#0b0e14' : '#fafafa';
    }
    const hex = THEME_BG_HEX[theme];
    if (hex) {
      return hex;
    }
    return LIGHT_PALETTE_THEMES.has(theme) ? '#fafafa' : '#121212';
  } catch {
    return '#1e1e1e';
  }
}

module.exports = { getFirstPaintBackgroundColor, THEME_BG_HEX, LIGHT_PALETTE_THEMES };
