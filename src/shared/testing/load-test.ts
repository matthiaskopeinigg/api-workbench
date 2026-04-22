/**
 * Shared types for the Load Test tab. The artifact uses {@link LoadTestConfig}
 * with {@link LoadTestTarget} entries. At `loadStart` time the renderer
 * resolves each target to a full `IpcHttpRequest` (mTLS, proxy, etc.) so the
 * main load engine can forward it to the HTTP service — see
 * `src/app/core/load-test.service.ts` and `electron/services/load.service.js`.
 */

export interface LoadTestArtifact {
  id: string;
  title: string;
  /** ISO timestamp; for "saved/updated" UI only. */
  updatedAt: number;
  config: LoadTestConfig;
}

/** Source request for a load test. References a saved request by id, or
 * carries an inline ad-hoc request for quick experiments. */
export type LoadTestTarget =
  | { kind: 'saved'; requestId: string; collectionId?: string }
  | { kind: 'inline'; method: string; url: string; headers?: Array<{ key: string; value: string }>; body?: string };

export interface LoadTestConfig {
  /** One or more requests to drive in sequence per VU iteration. */
  targets: LoadTestTarget[];
  /** Number of virtual users (concurrent loops). */
  vus: number;
  /** When set, the run stops after this many seconds. */
  durationSec: number | null;
  /** When set, the run stops after this many total iterations across all VUs. */
  iterations: number | null;
  /** Linear ramp-up of VUs over the first N seconds. 0 = all at once. */
  rampUpSec: number;
  /** Optional global RPS cap (token-bucket). */
  rpsCap: number | null;
  /** Wait between iterations within a single VU, in ms. */
  thinkMs: number;
}

/** A single served request observed by the engine. */
export interface LoadSample {
  iteration: number;
  vu: number;
  /** Index into config.targets — useful when sequencing multiple requests. */
  targetIndex: number;
  status: number;
  /** ms since UNIX epoch when the request started. */
  startedAt: number;
  durationMs: number;
  errorMessage?: string;
  responseBytes: number;
}

export type LoadRunStatus = 'idle' | 'running' | 'finished' | 'cancelled' | 'error';

export interface LoadRunSummary {
  total: number;
  successful: number;
  failed: number;
  /** Status code → count. */
  statusBuckets: Record<string, number>;
  /** Latency percentiles in ms. */
  p50: number;
  p90: number;
  p95: number;
  p99: number;
  meanMs: number;
  rps: number;
  /** Wall-clock seconds since the run started. */
  elapsedSec: number;
}

/** A single point in the time-series chart. The renderer keeps a sliding
 * window of these. */
export interface LoadProgressPoint {
  /** Window end timestamp (ms). */
  t: number;
  rps: number;
  errors: number;
  p50: number;
  p95: number;
}

/** Live progress payload broadcast from the engine on a fixed cadence. */
export interface LoadProgressEvent {
  runId: string;
  status: LoadRunStatus;
  startedAt: number;
  /** Current cumulative summary. */
  summary: LoadRunSummary;
  /** Latest tick added to the time-series. */
  point: LoadProgressPoint;
  /** Currently active VU count (during ramp-up). */
  activeVus: number;
}

/** Final result snapshot returned when a run finishes / is cancelled. */
export interface LoadRunResult {
  runId: string;
  status: LoadRunStatus;
  startedAt: number;
  endedAt: number;
  config: LoadTestConfig;
  summary: LoadRunSummary;
  /** Sliding-window time-series across the run. */
  series: LoadProgressPoint[];
  /** Slowest 10 samples (descending durationMs). */
  slowest: LoadSample[];
  /** Up to 10 distinct error messages with their occurrence count. */
  errors: Array<{ message: string; count: number; sample: LoadSample }>;
}

export const DEFAULT_LOAD_CONFIG: LoadTestConfig = {
  targets: [],
  vus: 10,
  durationSec: 30,
  iterations: null,
  rampUpSec: 5,
  rpsCap: null,
  thinkMs: 0,
};
