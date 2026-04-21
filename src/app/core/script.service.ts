import { Injectable } from '@angular/core';

@Injectable({
    providedIn: 'root'
})
export class ScriptService {
    async runScript(code: string, context: unknown = {}): Promise<unknown> {
        return window.awElectron.runScript(code, context);
    }
}
