// ── Step type definitions ──

export type StepType = 'REQUEST' | 'VALIDATION' | 'DATABASE' | 'E2E' | 'INTERCEPT' | 'WAIT' | 'SECURITY' | 'MANUAL';
export type StepStatus = 'never' | 'running' | 'passed' | 'failed' | 'skipped' | 'waiting';
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';
export type E2eAction = 'OPEN_PAGE' | 'NAVIGATE_TO' | 'CLICK' | 'TYPE_TEXT' | 'WAIT' | 'SCREENSHOT' | 'ASSERT_ELEMENT' | 'ASSERT_URL' | 'WAIT_FOR_URL';

export interface KeyValuePair {
  key: string;
  value: string;
  enabled: boolean;
}

// ── Step configs ──

export interface RequestStepConfig {
  method: HttpMethod;
  url: string;
  headers: KeyValuePair[];
  queryParams: KeyValuePair[];
  body: string;
  bodyType: 'json' | 'form' | 'raw' | 'none';
}

export interface ValidationStepConfig {
  source: 'response_body' | 'response_status' | 'response_header' | 'request_body' | 'request_header' | 'request_param' | 'cached_value';
  expression: string; // JSONPath / header name / cache key
  operator: 'equals' | 'not_equals' | 'contains' | 'matches_regex' | 'greater_than' | 'less_than' | 'is_null' | 'is_not_null' | 'exists' | 'not_exists' | 'is_empty' | 'is_not_empty';
  expected: string;
}

export interface DatabaseStepConfig {
  dbType: 'postgresql' | 'mysql' | 'mongodb' | 'mssql';
  connectionRef: string;
  query: string;
  cacheAs: string; // variable name to store result
}

export interface E2eStepConfig {
  action: E2eAction;
  selector: string;
  value: string;
  timeout: number;
}

export interface ManualStepConfig {
  prompt: string;
  variableName: string;
  timeout: number;
}

// ── Node types ──

export type FlowNodeType = 'folder' | 'step';

export interface FlowFolder {
  id: string;
  type: 'folder';
  name: string;
  parentId: string | null;
  children: FlowNode[];
  expanded: boolean;
}

export interface InterceptStepConfig {
  urlPattern: string;
  method: string;
  timeout: number;
  triggerAction?: E2eAction;
  selector?: string;
  value?: string;
  variableName?: string; 
}

export interface WaitStepConfig {
  durationMs: number;
}

export interface SecurityStepConfig {
  scanType: 'dast' | 'sast' | 'audit';
  targetStepId?: string; // id of request step to audit
}

export interface FlowStep {
  id: string;
  type: 'step';
  name: string;
  parentId: string | null;
  stepType: StepType;
  config: RequestStepConfig | ValidationStepConfig | DatabaseStepConfig | E2eStepConfig | InterceptStepConfig | WaitStepConfig | SecurityStepConfig | ManualStepConfig;
  enabled: boolean;
  lastRunStatus?: StepStatus;
  error?: string;
  errorDetails?: any;
}

export type FlowNode = FlowFolder | FlowStep;

// ── Flow ──

export interface Flow {
  id: string;
  name: string;
  description: string;
  lastRunStatus: StepStatus;
  lastRunAt: string | null;
  owner: string;
  createdAt: string;
  nodes: FlowNode[];
  tags: string[];
}

// ── Project ──

export interface Project {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  flows: FlowListItem[];
  lastRunStatus: StepStatus;
  lastRunAt: string | null;
}

// ── Flow Groups (folders that organize flows) ──

export interface FlowGroup {
  id: string;
  type: 'group';
  name: string;
  expanded: boolean;
  children: FlowListItem[];
}

export interface FlowListEntry {
  type: 'flow';
  flow: Flow;
}

export type FlowListItem = FlowGroup | FlowListEntry;

// ── Helpers ──

export function createDefaultRequestConfig(): RequestStepConfig {
  return {
    method: 'GET',
    url: '',
    headers: [],
    queryParams: [],
    body: '',
    bodyType: 'none',
  };
}

export function createDefaultValidationConfig(): ValidationStepConfig {
  return {
    source: 'response_body',
    expression: '',
    operator: 'equals',
    expected: '',
  };
}

export function createDefaultDatabaseConfig(): DatabaseStepConfig {
  return {
    dbType: 'postgresql',
    connectionRef: '',
    query: '',
    cacheAs: '',
  };
}

export function createDefaultE2eConfig(): E2eStepConfig {
  return {
    action: 'OPEN_PAGE',
    selector: '',
    value: '',
    timeout: 5000,
  };
}

export function createDefaultInterceptConfig(): InterceptStepConfig {
  return {
    urlPattern: '',
    method: 'POST',
    timeout: 10000,
    triggerAction: 'CLICK'
  };
}

export function createDefaultWaitConfig(): WaitStepConfig {
  return {
    durationMs: 2000
  };
}

export function createDefaultSecurityConfig(): SecurityStepConfig {
  return {
    scanType: 'dast'
  };
}

export function createDefaultManualConfig(): ManualStepConfig {
  return {
    prompt: 'Please enter value:',
    variableName: 'userInput',
    timeout: 60000,
  };
}

let _idCounter = 1000;
export function generateId(): string {
  return `node_${Date.now()}_${_idCounter++}`;
}
