import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root',
})
export class SessionService {

  private cache: Record<string, any> = {};

  private get bridge() {
    return typeof window !== 'undefined' ? window.awElectron : undefined;
  }

  async load<T = any>(key: string): Promise<void> {
    if (key in this.cache) return;
    const bridge = this.bridge;
    if (!bridge?.getSession) {
      this.cache[key] = null;
      return;
    }
    try {
      const value = await bridge.getSession(key);
      this.cache[key] = value ?? null;
    } catch (error) {
      console.error(`Failed to load session key "${key}":`, error);
      this.cache[key] = null;
    }
  }

  get<T = any>(key: string): T | null {
    if (!(key in this.cache)) {
      return null;
    }
    return this.cache[key] as T;
  }


  async save<T = any>(key: string, value: T): Promise<void> {
    this.cache[key] = value;
    const bridge = this.bridge;
    if (!bridge?.saveSession) return;
    try {
      await bridge.saveSession(key, value);
    } catch (error) {
      console.error(`Failed to save session key "${key}":`, error);
    }
  }
}
