import { Injectable } from '@angular/core';

@Injectable({
    providedIn: 'root'
})
export class CookieService {
    async getAllCookies(): Promise<any[]> {
        return window.awElectron.getAllCookies();
    }

    async deleteCookie(domain: string, path: string, name: string): Promise<void> {
        return window.awElectron.deleteCookie(domain, path, name);
    }

    async clearAllCookies(): Promise<void> {
        return window.awElectron.clearAllCookies();
    }
}
