import { Injectable } from '@angular/core';
import { Environment } from '@models/environment';
import { BehaviorSubject } from 'rxjs';
import { TabItem } from './tab.service';
import { SessionService } from './session.service';
import { pruneEmptyKv } from './kv-utils';

@Injectable({
  providedIn: 'root',
})
export class EnvironmentsService {

  private environmentsSubject = new BehaviorSubject<Environment[]>([]);
  private environmentMap = new Map<string, Environment>();

  private selectedEnvSubject = new BehaviorSubject<TabItem | null>(null);
  private activeContextSubject = new BehaviorSubject<Environment | null>(null);

  constructor(private sessionService: SessionService) { }

  getSelectedEnvironmentAsObservable() {
    return this.selectedEnvSubject.asObservable();
  }

  getActiveContextAsObservable() {
    return this.activeContextSubject.asObservable();
  }

  getActiveContext() {
    return this.activeContextSubject.getValue();
  }

  getEnvironmentsObservable() {
    return this.environmentsSubject.asObservable();
  }

  async selectEnvironment(environmentTab: TabItem) {
    this.selectedEnvSubject.next(environmentTab);
  }

  async setActiveContext(environment: Environment | null) {
    this.activeContextSubject.next(environment);
    if (environment) {
      this.sessionService.save('activeEnvironmentId', environment.id);
    } else {
      this.sessionService.save('activeEnvironmentId', null);
    }
  }

  async removeSelectedEnvironment() {
    this.selectedEnvSubject.next(null);
  }

  async loadEnvironments(): Promise<void> {
    const current = this.environmentsSubject.getValue();
    if (current.length === 0) {
      const result = await window.awElectron.getEnvironments();
      const environments = Array.isArray(result) ? result : [];
      this.environmentsSubject.next(environments);
      this.rebuildIndex();

      await this.sessionService.load('activeEnvironmentId');
      const savedId = this.sessionService.get<string>('activeEnvironmentId');
      if (savedId) {
        const env = this.getEnvironmentById(savedId);
        if (env) this.activeContextSubject.next(env);
      }
    }
  }

  private rebuildIndex() {
    this.environmentMap.clear();
    const environments = this.environmentsSubject.getValue();
    for (const env of environments) {
      this.environmentMap.set(env.id, env);
    }
  }

  getEnvironments(): Environment[] {
    return this.environmentsSubject.getValue();
  }

  async saveEnvironments(environments: Environment[]): Promise<void> {
    this.environmentsSubject.next(environments);
    this.rebuildIndex();
    this.scheduleDebouncedDiskWrite();
  }

  private static readonly SAVE_DEBOUNCE_MS = 300;
  private pendingSaveTimer: ReturnType<typeof setTimeout> | null = null;
  private inFlightSavePromise: Promise<void> | null = null;

  private scheduleDebouncedDiskWrite() {
    if (this.pendingSaveTimer !== null) {
      clearTimeout(this.pendingSaveTimer);
    }
    this.pendingSaveTimer = setTimeout(() => {
      this.pendingSaveTimer = null;
      void this.runDiskWrite();
    }, EnvironmentsService.SAVE_DEBOUNCE_MS);
  }

  private async runDiskWrite(): Promise<void> {
    if (this.inFlightSavePromise) {
      await this.inFlightSavePromise;
    }
    const snapshot = this.environmentsSubject.getValue().map(env => ({
      ...env,
      variables: pruneEmptyKv(env.variables)
    }));
    this.inFlightSavePromise = window.awElectron.saveEnvironments(snapshot)
      .catch(err => {
        console.error('Failed to persist environments', err);
      });
    try {
      await this.inFlightSavePromise;
    } finally {
      this.inFlightSavePromise = null;
    }
  }

  /** Flush any pending debounced writes immediately. Safe when nothing pending. */
  async flushPendingSaves(): Promise<void> {
    if (this.pendingSaveTimer !== null) {
      clearTimeout(this.pendingSaveTimer);
      this.pendingSaveTimer = null;
      await this.runDiskWrite();
    } else if (this.inFlightSavePromise) {
      await this.inFlightSavePromise;
    }
  }

  async saveEnvironment(environment: Environment): Promise<void> {
    const environments = this.getEnvironments();
    const index = environments.findIndex((env: Environment) => env.id === environment.id);

    if (index > -1) {
      environments[index] = environment;
    } else {
      environments.push(environment);
    }

    await this.saveEnvironments([...environments]);
  }

  getEnvironmentById(id: string): Environment | null {
    return this.environmentMap.get(id) || null;
  }

  getEnvironmentByTitle(title: string): Environment | undefined {
    return this.getEnvironments().find(
      (env: Environment) => env.title.toLowerCase() === title.toLowerCase()
    );
  }
}

