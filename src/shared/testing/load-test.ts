import { v4 as uuidv4 } from 'uuid';

/**
 * Shared types for the Load Test tab. The artifact uses {@link LoadTestConfig}
 * with {@link LoadTestTarget} entries. At `loadStart` time the renderer
 * resolves each target to a full `IpcHttpRequest` (mTLS, proxy, etc.) so the
 * main load engine can forward it to the HTTP service — see
 * `src/app/core/load-test.service.ts` and `electron/services/load.service.js`.
 */

/**
 * A named load profile: one target + load knobs. Users can keep several per tab
 * (e.g. smoke vs stress) and switch without duplicating the whole test.
 */
export interface LoadTestProfile {
  id: string;
  name: string;
  /** Shown in the profile picker / editor for context. */
  description?: string;
  /**
   * `false` = catalog / preset row (still edited in place). Omitted or `true` = user-owned.
   * New profiles are added only via “New profile from current” or the header template/empty actions.
   */
  userCustom?: boolean;
  /**
   * When true, the profile is a read-only “template” row: it cannot be removed from the
   * test (e.g. sample defaults and “Add from template” rows). Omitted = false.
   */
  isTemplate?: boolean;
  config: LoadTestConfig;
}

export interface LoadTestArtifact {
  id: string;
  title: string;
  /** ISO timestamp; for "saved/updated" UI only. */
  updatedAt: number;
  /**
   * Named profiles. When missing, the UI migrates from legacy {@link #config}
   * at load time — see {@link ensureLoadTestProfiles}.
   */
  profiles?: LoadTestProfile[];
  activeProfileId?: string;
  /**
   * Legacy mirror of the active profile’s config, kept in sync for older builds
   * and for quick reads. Prefer `profiles` + `activeProfileId` in new code.
   */
  config: LoadTestConfig;
}

/** Source request for a load test. References a saved request by id, or
 * carries an inline ad-hoc request for quick experiments. */
export type LoadTestTarget =
  | { kind: 'saved'; requestId: string; collectionId?: string }
  | { kind: 'inline'; method: string; url: string; headers?: Array<{ key: string; value: string }>; body?: string };

export interface LoadTestConfig {
  /**
   * At most one request per profile (0 = none, 1 = the load under test).
   * Kept as an array for backward compatibility; longer legacy lists are trimmed on load.
   */
  targets: LoadTestTarget[];
  /** Number of virtual users (concurrent loops). */
  vus: number;
  /** When set, the run stops after this many seconds. */
  durationSec: number | null;
  /**
   * When set, the run stops after this many **completed requests** to the target
   * (all VUs share the same count; for a single target this equals `iterations` HTTP calls).
   */
  iterations: number | null;
  /** Linear ramp-up of VUs over the first N seconds. 0 = all at once. */
  rampUpSec: number;
  /** Optional global RPS cap (token-bucket). */
  rpsCap: number | null;
  /** Wait between iterations within a single VU, in ms. */
  thinkMs: number;
  /**
   * When true, each request stores a truncated body preview and response headers
   * on the sample (higher memory use). Use to inspect individual responses after the run.
   */
  captureResponseDetails?: boolean;
}

/** A single served request observed by the engine. */
export interface LoadSample {
  iteration: number;
  vu: number;
  /** Always `0` with single-target configs; kept for sample shape / future use. */
  targetIndex: number;
  status: number;
  /** ms since UNIX epoch when the request started. */
  startedAt: number;
  durationMs: number;
  errorMessage?: string;
  responseBytes: number;
  /** HTTP status line text, when {@link LoadTestConfig.captureResponseDetails} was enabled. */
  responseStatusText?: string;
  /** Response headers, when capture was enabled. */
  responseHeaders?: Array<{ key: string; value: string }>;
  /**
   * Truncated UTF-8 text preview of the body (or a placeholder for binary), when capture was enabled.
   */
  responseBodyPreview?: string;
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
  /** Recent-window p99 (live); final run summary still uses full-sample p99. */
  p99: number;
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
  captureResponseDetails: false,
};

export function cloneConfig(c: LoadTestConfig): LoadTestConfig {
  return JSON.parse(JSON.stringify(c)) as LoadTestConfig;
}

/** Trims `targets` to at most one (first wins). Safe to call on any config. */
export function normalizeLoadTestConfigTargets(c: LoadTestConfig): void {
  if (!c.targets || !Array.isArray(c.targets)) {
    c.targets = [];
    return;
  }
  if (c.targets.length > 1) {
    c.targets = [c.targets[0]];
  }
}

/** In-memory preset row for the “add profile from template” picker. */
export interface LoadTestProfileTemplate {
  id: string;
  name: string;
  /** Shown in the template picker; explains intent and what the numbers mean. */
  description: string;
  factory: () => LoadTestConfig;
}

/** In-memory presets for "Add profile from template" (not persisted except as profile copies). */
export const LOAD_TEST_PROFILE_TEMPLATES: LoadTestProfileTemplate[] = [
  {
    id: 'tpl-smoke',
    name: 'Smoke',
    description: 'Minimal VUs, short run — quick sanity after deploy.',
    factory: () => ({
      ...cloneConfig({ ...DEFAULT_LOAD_CONFIG }),
      vus: 1,
      durationSec: 10,
      iterations: null,
      rampUpSec: 0,
      rpsCap: null,
      thinkMs: 0,
    }),
  },
  {
    id: 'tpl-standard',
    name: 'Standard',
    description: 'Typical API load: moderate concurrency, 30s, gentle ramp-up.',
    factory: () => cloneConfig({ ...DEFAULT_LOAD_CONFIG }),
  },
  {
    id: 'tpl-stress',
    name: 'Stress',
    description: 'High concurrency to find breaking points. Watch the server and network.',
    factory: () => ({
      ...cloneConfig({ ...DEFAULT_LOAD_CONFIG }),
      vus: 50,
      durationSec: 60,
      rampUpSec: 10,
      rpsCap: null,
      thinkMs: 0,
    }),
  },
  {
    id: 'tpl-spike',
    name: 'Spike',
    description: 'Many VUs immediately — no ramp. Good for cache warm / thundering herd.',
    factory: () => ({
      ...cloneConfig({ ...DEFAULT_LOAD_CONFIG }),
      vus: 40,
      durationSec: 20,
      rampUpSec: 0,
      thinkMs: 0,
    }),
  },
  {
    id: 'tpl-soak',
    name: 'Soak',
    description: 'Sustained light load to catch leaks or slow degradation.',
    factory: () => ({
      ...cloneConfig({ ...DEFAULT_LOAD_CONFIG }),
      vus: 5,
      durationSec: 300,
      rampUpSec: 30,
      rpsCap: 20,
      thinkMs: 100,
    }),
  },
  {
    id: 'tpl-iterations',
    name: 'Fixed iterations',
    description: 'Stop after a total number of request iterations (good for reproducing a bug).',
    factory: () => ({
      ...cloneConfig({ ...DEFAULT_LOAD_CONFIG }),
      vus: 5,
      durationSec: null,
      iterations: 500,
      rampUpSec: 2,
      thinkMs: 0,
    }),
  },
];

/**
 * Ensures `profiles` and `activeProfileId` exist, migrating from legacy
 * `config` if needed, and re-syncs `config` to the active profile.
 */
export function ensureLoadTestProfiles(a: LoadTestArtifact): LoadTestArtifact {
  const legacy = a.config && typeof a.config === 'object' ? a.config : { ...DEFAULT_LOAD_CONFIG };
  if (!a.profiles || a.profiles.length === 0) {
    const cfg = cloneConfig(legacy as LoadTestConfig);
    normalizeLoadTestConfigTargets(cfg);
    a.profiles = [
      {
        id: 'p-default',
        name: 'Default',
        description: 'Migrated from the previous single profile.',
        config: cfg,
      },
    ];
    a.activeProfileId = a.profiles[0].id;
  } else {
    if (!a.activeProfileId || !a.profiles.some((p) => p.id === a.activeProfileId)) {
      a.activeProfileId = a.profiles[0].id;
    }
    for (const p of a.profiles) {
      if (p.config) {
        normalizeLoadTestConfigTargets(p.config);
      }
    }
  }
  const active = a.profiles.find((p) => p.id === a.activeProfileId) ?? a.profiles[0];
  /** One writable reference: the tab’s form binds here and to the active profile. */
  a.config = active.config;
  normalizeLoadTestConfigTargets(a.config);
  return a;
}

/** Prefix for merged profile-picker values that add a row from {@link LOAD_TEST_PROFILE_TEMPLATES}. */
export const LOAD_TEST_PROFILE_PICKER_TEMPLATE_PREFIX = 'lt-tpl:';
/** Merged profile-picker value that adds a blank custom profile. */
export const LOAD_TEST_PROFILE_PICKER_EMPTY = 'lt-empty';

export function findLoadTestProfileTemplateById(
  id: string,
): LoadTestProfileTemplate | undefined {
  return LOAD_TEST_PROFILE_TEMPLATES.find((t) => t.id === id);
}

/**
 * Appends a profile copied from a catalog template; activates it. Mutates the artifact.
 */
export function appendLoadTestProfileFromTemplate(
  a: LoadTestArtifact,
  template: LoadTestProfileTemplate,
): string {
  ensureLoadTestProfiles(a);
  const id = `p-${uuidv4()}`;
  const cfg = template.factory();
  normalizeLoadTestConfigTargets(cfg);
  const prof: LoadTestProfile = {
    id,
    name: template.name,
    description: template.description,
    userCustom: false,
    isTemplate: true,
    config: cfg,
  };
  a.profiles = [...(a.profiles || []), prof];
  a.activeProfileId = id;
  a.config = prof.config;
  return id;
}

/**
 * Appends a user “empty” profile (inherits first target if any). Mutates the artifact.
 */
export function appendEmptyLoadTestProfile(a: LoadTestArtifact): string {
  ensureLoadTestProfiles(a);
  const id = `p-${uuidv4()}`;
  const t0 = a.config.targets[0];
  const emptyTargets: LoadTestTarget[] = t0
    ? [JSON.parse(JSON.stringify(t0)) as LoadTestTarget]
    : [];
  const prof: LoadTestProfile = {
    id,
    name: `Profile ${(a.profiles?.length || 0) + 1}`,
    description: '',
    userCustom: true,
    config: {
      targets: emptyTargets,
      vus: 5,
      durationSec: 15,
      iterations: null,
      rampUpSec: 0,
      rpsCap: null,
      thinkMs: 0,
      captureResponseDetails: false,
    },
  };
  normalizeLoadTestConfigTargets(prof.config);
  a.profiles = [...(a.profiles || []), prof];
  a.activeProfileId = id;
  a.config = prof.config;
  return id;
}

function uniqueNumberedName(base: string, existingNames: string[]): string {
  const set = new Set(existingNames);
  if (!set.has(base)) {
    return base;
  }
  let n = 2;
  let candidate = `${base} ${n}`;
  while (set.has(candidate)) {
    n += 1;
    candidate = `${base} ${n}`;
  }
  return candidate;
}

/**
 * Appends a new profile with a deep copy of the artifact’s current `config` and activates
 * it. Use when the user explicitly saves “current settings” as a separate preset.
 * Mutates the artifact.
 * @param nameHint Optional label; if empty/whitespace, defaults to `"From current"`.
 */
export function appendLoadTestProfileCloningFromActive(
  a: LoadTestArtifact,
  nameHint?: string | null,
): string {
  ensureLoadTestProfiles(a);
  const id = `p-${uuidv4()}`;
  const cfg = cloneConfig(a.config);
  normalizeLoadTestConfigTargets(cfg);
  const names = (a.profiles || []).map((p) => p.name);
  const trimmed = (nameHint ?? '').trim();
  const base = trimmed ? trimmed : 'From current';
  const name = uniqueNumberedName(base, names);
  const prof: LoadTestProfile = {
    id,
    name,
    description: '',
    userCustom: true,
    isTemplate: false,
    config: cfg,
  };
  a.profiles = [...(a.profiles || []), prof];
  a.activeProfileId = id;
  a.config = prof.config;
  return id;
}
