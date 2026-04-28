import { generateId } from './flow.model';

export type RunStatus = 'passed' | 'failed' | 'partial' | 'running' | 'queued';

export interface FlowRunResult {
  flowId: string;
  flowName: string;
  status: 'passed' | 'failed' | 'skipped';
  durationMs: number;
  error?: string;
}

export interface ExecutionSettings {
  headless: boolean;
  stopOnFailure: boolean;
  parallel: boolean;
}

export interface ReleaseRun {
  id: string;
  versionTag: string;
  description: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  status: RunStatus;
  flowIds: string[];
  results: FlowRunResult[];
  settings?: ExecutionSettings;
}

export function createNewRun(versionTag: string, flowIds: string[], description = ''): ReleaseRun {
  return {
    id: generateId(),
    versionTag,
    description,
    createdAt: new Date().toISOString(),
    status: 'queued',
    flowIds,
    results: [],
  };
}
