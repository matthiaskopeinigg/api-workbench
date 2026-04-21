import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root',
})
export class SessionService {

  private cache: Record<string, any> = {};

  async load<T = any>(key: string): Promise<void> {
    if (!(key in this.cache)) {
      try {
        const value = await window.awElectron.getSession(key);
        this.cache[key] = value ?? null;
      } catch (error) {
        console.error(`Failed to load session key "${key}":`, error);
        this.cache[key] = null;
      }
    }
  }

  get<T = any>(key: string): T | null {
    if (!(key in this.cache)) {
      console.log(`Session key "${key}" not loaded yet.`)
      return null;
    }
    return this.cache[key] as T;
  }


  async save<T = any>(key: string, value: T): Promise<void> {
    this.cache[key] = value;
    try {
      await window.awElectron.saveSession(key, value);
    } catch (error) {
      console.error(`Failed to save session key "${key}":`, error);
    }
  }
}


