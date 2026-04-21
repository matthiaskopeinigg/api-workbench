/**
 * Shared types for the API Test Suite tab. Suites live in the renderer and
 * are persisted via the SQLite store as a single JSON document keyed by
 * `testSuites`.
 */

export interface TestSuiteArtifact {
  id: string;
  title: string;
  updatedAt: number;
  description?: string;
  cases: TestCase[];
  /** Suite-scoped variables seeded into every run. */
  variables: Array<{ key: string; value: string }>;
  /**
   * When true, "Run All" only reports snapshot (regression) assertions and
   * treats everything else as informational. Useful for catching drift
   * without noise from pre-existing assertion failures.
   */
  regressionMode?: boolean;
}

export interface TestCase {
  id: string;
  /** Display label; defaults to the request title if unset. */
  name: string;
  /** Skip this case during "run all". */
  enabled: boolean;
  /** Source request (saved-request id or inline). */
  target:
    | { kind: 'saved'; requestId: string }
    | { kind: 'inline'; method: string; url: string; headers?: Array<{ key: string; value: string }>; body?: string };
  /** Assertions evaluated against the response. */
  assertions: Assertion[];
  /** Variable extractions; results are merged into suite vars for later cases. */
  extracts: Extraction[];
}

export type Assertion =
  | StatusAssertion
  | LatencyAssertion
  | HeaderAssertion
  | BodyAssertion
  | SnapshotAssertion;

export interface StatusAssertion {
  kind: 'status';
  /** Either an exact code (e.g. 200) or a range like '2xx'. */
  expected: number | '1xx' | '2xx' | '3xx' | '4xx' | '5xx';
}

export interface LatencyAssertion {
  kind: 'latency';
  /** Hard fail above this ms. */
  failAboveMs: number;
  /** Soft warn above this ms; below failAboveMs. */
  warnAboveMs?: number;
}

export interface HeaderAssertion {
  kind: 'header';
  name: string;
  /** 'exists' just checks presence. */
  op: 'equals' | 'contains' | 'regex' | 'exists';
  value?: string;
}

export interface BodyAssertion {
  kind: 'body';
  /** JSON path (e.g. `$.user.id`) or substring; behaviour depends on op. */
  path: string;
  op:
    | 'equals'
    | 'contains'
    | 'regex'
    | 'truthy'
    | 'falsy'
    | 'jsonpath-equals'
    | 'jsonpath-truthy';
  value?: string;
}

/**
 * Regression / snapshot assertion.
 *
 * First run against a given (suite, case, assertion) triple captures the
 * response as a baseline; subsequent runs diff the current response against
 * the stored baseline and report any drift. Baselines live in their own
 * `testSuiteSnapshots` store — keeping large payloads out of the suite
 * artifact itself.
 */
export interface SnapshotAssertion {
  kind: 'snapshot';
  /** Stable id used as the snapshot storage key. Generated at creation time. */
  id: string;
  /** Compare HTTP status code. Default true. */
  matchStatus?: boolean;
  /**
   * Response headers to include in the comparison (case-insensitive). Empty
   * list means "skip all headers"; undefined means a safe default
   * (content-type + cache-control).
   */
  includeHeaders?: string[];
  /**
   * JSON paths in the body to ignore when diffing, e.g. `$.timestamp`.
   * Supports simple dot paths; prefixes with `$.` are optional.
   */
  ignorePaths?: string[];
  /** If true, the next run will overwrite the stored baseline. */
  pendingAccept?: boolean;
}

export interface Extraction {
  /** Variable name to assign. */
  as: string;
  /** JSON path against the response body, or `header:<name>`. */
  source: string;
}

/**
 * Persisted baseline for a single snapshot assertion. Lives in the
 * `testSuiteSnapshots` store, addressed by `snapshotKey(suiteId, caseId,
 * assertionId)`.
 */
export interface SnapshotRecord {
  id: string;
  /** Format: `${suiteId}:${caseId}:${assertionId}`. */
  title: string;
  suiteId: string;
  caseId: string;
  assertionId: string;
  capturedAt: number;
  status: number;
  headers: Array<{ key: string; value: string }>;
  body: string;
  /** Whether the captured body looked like JSON (drives diff strategy). */
  bodyIsJson: boolean;
  /** Bumped each time a user "accepts" a new baseline. */
  updatedAt: number;
}

export function snapshotKey(suiteId: string, caseId: string, assertionId: string): string {
  return `${suiteId}:${caseId}:${assertionId}`;
}

export type SnapshotDiffKind = 'baseline-captured' | 'match' | 'drift';

export interface SnapshotFieldDiff {
  /** Dot-path within the body ("$.user.email") or "status" / "header:<name>". */
  path: string;
  /** What changed. */
  change: 'added' | 'removed' | 'changed';
  expected?: string;
  actual?: string;
}

export interface SnapshotDiffReport {
  kind: SnapshotDiffKind;
  /** Human summary (e.g. "3 fields changed, 1 added"). */
  summary: string;
  fields: SnapshotFieldDiff[];
}

export type AssertionStatus = 'pass' | 'fail' | 'warn' | 'skip';

export interface AssertionResult {
  kind: Assertion['kind'];
  label: string;
  status: AssertionStatus;
  expected?: string;
  actual?: string;
  message?: string;
  /** Populated for snapshot assertions so the UI can render a rich diff. */
  snapshotDiff?: SnapshotDiffReport;
  /** Original assertion id (snapshot assertions) — enables the "Accept baseline" action. */
  assertionId?: string;
}

export interface CaseRunResult {
  caseId: string;
  caseName: string;
  status: AssertionStatus;
  durationMs: number;
  request: {
    method: string;
    url: string;
    headers?: Array<{ key: string; value: string }>;
    body?: string;
  };
  response: {
    status: number;
    statusText?: string;
    headers?: Array<{ key: string; value: string }>;
    body?: string;
    timeMs?: number;
  };
  assertions: AssertionResult[];
  /** Variables added to the suite scope by this case. */
  extracted: Record<string, string>;
  errorMessage?: string;
}

export interface SuiteRunResult {
  runId: string;
  suiteId: string;
  startedAt: number;
  endedAt: number;
  status: AssertionStatus;
  cases: CaseRunResult[];
  /** Final state of suite-scoped variables after all cases. */
  finalVariables: Array<{ key: string; value: string }>;
}

export const NEW_TEST_SUITE = (id: string): TestSuiteArtifact => ({
  id,
  title: 'Untitled suite',
  updatedAt: Date.now(),
  description: '',
  cases: [],
  variables: [],
});
