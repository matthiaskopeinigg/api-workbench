/**
 * Shared types for the Contract Test tab. The matcher runs in the
 * renderer; spec parsing lives in `src/app/core/import-pipeline/openapi-parser.ts` so the
 * import flow and contract validation share one source of truth.
 */

export interface ContractTestArtifact {
  id: string;
  title: string;
  updatedAt: number;
  /** Source of the spec — either an inline document body or a remote URL we re-fetch on refresh. */
  spec: SpecSource;
  /** Collection (or folder) under test. The matcher walks every request inside. */
  scope: ContractScope;
}

export type SpecSource =
  | { kind: 'inline'; format: 'json' | 'yaml'; body: string; updatedAt: number }
  | { kind: 'url'; url: string; lastFetchedAt: number | null; cachedBody?: string; cachedFormat?: 'json' | 'yaml' };

export interface ContractScope {
  collectionId: string;
  /** Optional folder path within the collection ("/api/v1"). Empty = whole collection. */
  folderId?: string;
}

export type ContractFindingKind = 'mismatch' | 'drift' | 'undocumented' | 'spec-only' | 'ok';
export type ContractSeverity = 'error' | 'warning' | 'info';

export interface ContractFinding {
  id: string;
  kind: ContractFindingKind;
  severity: ContractSeverity;
  /** OpenAPI path template ("/users/{id}") or the request URL when no match. */
  path: string;
  method: string;
  /** When the finding came from running a request, the actual response. */
  actual?: {
    status: number;
    statusText?: string;
    contentType?: string;
    body?: string;
    headers?: Array<{ key: string; value: string }>;
  };
  /** Spec excerpt that was checked (status code, schema fragment, etc). */
  expected?: string;
  /** Human-readable message ("Required field 'email' missing"). */
  message: string;
  /** Cross-reference back to the saved request id when one was matched. */
  requestId?: string;
}

export interface ContractRunResult {
  runId: string;
  contractId: string;
  startedAt: number;
  endedAt: number;
  /** Counts by severity. */
  totals: { error: number; warning: number; info: number; ok: number };
  findings: ContractFinding[];
}

export const NEW_CONTRACT_TEST = (id: string): ContractTestArtifact => ({
  id,
  title: 'Untitled contract',
  updatedAt: Date.now(),
  spec: { kind: 'inline', format: 'yaml', body: '', updatedAt: Date.now() },
  scope: { collectionId: '' },
});
