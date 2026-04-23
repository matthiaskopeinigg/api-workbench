import type { LoadRunResult } from '@models/testing/load-test';

/**
 * Session KV key: maps load-test artifact id → last completed run (survives app restart).
 */
export const LOAD_TEST_SESSION_RUNS_KEY = 'loadTestLastRunsV1';

export type LoadTestSessionRunsMap = Record<string, { result: LoadRunResult; savedAt: number }>;
