import { Injectable, NgZone } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import type { TestingArtifactKind } from '@models/electron';
import type { LoadTestArtifact } from '@models/testing/load-test';
import type { TestSuiteArtifact, SnapshotRecord } from '@models/testing/test-suite';
import type { ContractTestArtifact } from '@models/testing/contract-test';
import type { FlowArtifact } from '@models/testing/flow';

interface ArtifactBase {
  id: string;
  title: string;
  updatedAt: number;
}

/**
 * Generic CRUD facade over the four test-tab artifact kinds. Each kind has
 * its own in-memory cache + observable so the sidebar list and any open
 * editor tabs stay in sync without separate plumbing.
 *
 * Saves are debounced + serialized: while a save is in flight, additional
 * edits buffer; on completion the latest snapshot is flushed.
 */
@Injectable({ providedIn: 'root' })
export class TestArtifactService {
  private streams: Record<TestingArtifactKind, BehaviorSubject<ArtifactBase[]>> = {
    loadTests: new BehaviorSubject<ArtifactBase[]>([]),
    testSuites: new BehaviorSubject<ArtifactBase[]>([]),
    contractTests: new BehaviorSubject<ArtifactBase[]>([]),
    flows: new BehaviorSubject<ArtifactBase[]>([]),
    testSuiteSnapshots: new BehaviorSubject<ArtifactBase[]>([]),
  };

  private saveInFlight: Partial<Record<TestingArtifactKind, boolean>> = {};
  private saveQueued: Partial<Record<TestingArtifactKind, boolean>> = {};

  constructor(private zone: NgZone) {}

  loadTests$(): Observable<LoadTestArtifact[]> {
    return this.streams.loadTests.asObservable() as unknown as Observable<LoadTestArtifact[]>;
  }
  testSuites$(): Observable<TestSuiteArtifact[]> {
    return this.streams.testSuites.asObservable() as unknown as Observable<TestSuiteArtifact[]>;
  }
  contractTests$(): Observable<ContractTestArtifact[]> {
    return this.streams.contractTests.asObservable() as unknown as Observable<ContractTestArtifact[]>;
  }
  flows$(): Observable<FlowArtifact[]> {
    return this.streams.flows.asObservable() as unknown as Observable<FlowArtifact[]>;
  }
  testSuiteSnapshots$(): Observable<SnapshotRecord[]> {
    return this.streams.testSuiteSnapshots.asObservable() as unknown as Observable<SnapshotRecord[]>;
  }

  loadTests(): LoadTestArtifact[] { return this.streams.loadTests.value as LoadTestArtifact[]; }
  testSuites(): TestSuiteArtifact[] { return this.streams.testSuites.value as TestSuiteArtifact[]; }
  contractTests(): ContractTestArtifact[] { return this.streams.contractTests.value as ContractTestArtifact[]; }
  flows(): FlowArtifact[] { return this.streams.flows.value as FlowArtifact[]; }
  testSuiteSnapshots(): SnapshotRecord[] { return this.streams.testSuiteSnapshots.value as SnapshotRecord[]; }

  /**
   * Hydrate from disk. Safe to call once at startup; will silently no-op if
   * the Electron bridge isn't available (e.g. during tests).
   */
  async loadAll(): Promise<void> {
    if (!window.awElectron?.testingList) return;
    await Promise.all(
      (Object.keys(this.streams) as TestingArtifactKind[]).map((kind) => this.refresh(kind)),
    );
  }

  async refresh(kind: TestingArtifactKind): Promise<void> {
    if (!window.awElectron?.testingList) return;
    const items = await window.awElectron.testingList<ArtifactBase>(kind);
    this.zoneEmit(kind, Array.isArray(items) ? items : []);
  }

  getById<T extends ArtifactBase>(kind: TestingArtifactKind, id: string): T | undefined {
    return this.streams[kind].value.find((a) => a.id === id) as T | undefined;
  }

  /** Insert a new artifact and persist. */
  async create<T extends ArtifactBase>(kind: TestingArtifactKind, artifact: T): Promise<void> {
    const list = [...this.streams[kind].value, artifact];
    this.zoneEmit(kind, list);
    await this.flush(kind);
  }

  /** Replace an existing artifact (by id) and persist. */
  async update<T extends ArtifactBase>(kind: TestingArtifactKind, artifact: T): Promise<void> {
    const list = this.streams[kind].value.map((a) =>
      a.id === artifact.id ? { ...artifact, updatedAt: Date.now() } : a,
    );
    this.zoneEmit(kind, list);
    await this.flush(kind);
  }

  async remove(kind: TestingArtifactKind, id: string): Promise<void> {
    const list = this.streams[kind].value.filter((a) => a.id !== id);
    this.zoneEmit(kind, list);
    await this.flush(kind);
  }

  /**
   * Replace the full list for a kind. Used by the regression runner to
   * apply many snapshot mutations in one IPC round-trip, instead of N.
   */
  async bulkReplace<T extends ArtifactBase>(kind: TestingArtifactKind, items: T[]): Promise<void> {
    this.zoneEmit(kind, items);
    await this.flush(kind);
  }

  async duplicate<T extends ArtifactBase>(
    kind: TestingArtifactKind,
    id: string,
    newId: string,
  ): Promise<T | null> {
    const src = this.getById<T>(kind, id);
    if (!src) return null;
    const copy = { ...(src as object), id: newId, title: `${src.title} (copy)`, updatedAt: Date.now() } as T;
    await this.create(kind, copy);
    return copy;
  }

  private zoneEmit(kind: TestingArtifactKind, list: ArtifactBase[]): void {
    if (NgZone.isInAngularZone()) this.streams[kind].next(list);
    else this.zone.run(() => this.streams[kind].next(list));
  }

  /**
   * Coalesce concurrent writes for one kind. If a save is already in flight
   * we just remember that another flush is needed and let the running one
   * pick up the latest list when it finishes.
   */
  private async flush(kind: TestingArtifactKind): Promise<void> {
    if (!window.awElectron?.testingSave) return;
    if (this.saveInFlight[kind]) {
      this.saveQueued[kind] = true;
      return;
    }
    this.saveInFlight[kind] = true;
    try {
      while (true) {
        this.saveQueued[kind] = false;
        const snapshot = this.streams[kind].value;
        await window.awElectron.testingSave(kind, snapshot);
        if (!this.saveQueued[kind]) break;
      }
    } finally {
      this.saveInFlight[kind] = false;
    }
  }
}
