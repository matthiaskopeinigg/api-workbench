import { getTestBed } from '@angular/core/testing';
import {
    BrowserDynamicTestingModule,
    platformBrowserDynamicTesting
} from '@angular/platform-browser-dynamic/testing';

getTestBed().initTestEnvironment(
    BrowserDynamicTestingModule,
    platformBrowserDynamicTesting()
);

if (typeof window !== 'undefined' && !(window as any).awElectron) {
    (window as any).awElectron = {
        isPackaged: false,
        appVersion: '0.0.0-test',
        getSettings: () => Promise.resolve(undefined),
        saveSettings: () => Promise.resolve(),
        getCollections: () => Promise.resolve([]),
        saveCollections: () => Promise.resolve(),
        getEnvironments: () => Promise.resolve([]),
        saveEnvironments: () => Promise.resolve(),
        getSession: () => Promise.resolve(undefined),
        saveSession: () => Promise.resolve(),
        openFileDialog: () => Promise.resolve(null),
        saveFileDialog: () => Promise.resolve(null),
        minimizeWindow: () => undefined,
        maximizeWindow: () => undefined,
        closeWindow: () => undefined,
        openExternalUrl: () => Promise.resolve({ ok: true }),
        httpRequest: () => Promise.resolve(null),
        getAllCookies: () => Promise.resolve([]),
        deleteCookie: () => Promise.resolve(),
        clearAllCookies: () => Promise.resolve(),
        runScript: () => Promise.resolve(undefined),
        appReady: () => undefined,
        getOAuth2Token: () => Promise.resolve(null),
        exchangeOAuth2Code: () => Promise.resolve({}),
        getOAuth2ClientCredentials: () => Promise.resolve({}),
        getStorageInfo: () =>
            Promise.resolve({
                userData: '',
                databasePath: '',
                appConfigDir: '',
                logsDir: '',
                markerFile: '',
                markerDir: '',
                overrideSource: null,
                overrideTarget: null,
                env: null,
            }),
        openUserDataDirectory: () => Promise.resolve({ ok: true }),
        openLogsDirectory: () => Promise.resolve({ ok: true }),
        openConfigMarkerDirectory: () => Promise.resolve({ ok: true }),
        chooseDataDirectory: () => Promise.resolve({ ok: false, cancelled: true }),
        resetDataDirectoryOverride: () => Promise.resolve({ ok: true, relaunching: true }),
    };
}

const context = (require as any).context('./', true, /\.spec\.ts$/);

context.keys().forEach(context);


