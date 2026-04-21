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
        httpRequest: () => Promise.resolve(null),
        getAllCookies: () => Promise.resolve([]),
        deleteCookie: () => Promise.resolve(),
        clearAllCookies: () => Promise.resolve(),
        runScript: () => Promise.resolve(undefined),
        appReady: () => undefined,
        getOAuth2Token: () => Promise.resolve(null),
        exchangeOAuth2Code: () => Promise.resolve({}),
        getOAuth2ClientCredentials: () => Promise.resolve({}),
    };
}

const context = (require as any).context('./', true, /\.spec\.ts$/);

context.keys().forEach(context);


