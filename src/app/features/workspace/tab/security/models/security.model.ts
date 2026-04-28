import { generateId } from '@features/workspace/tab/regression/models/flow.model';

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';
export type ScanStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface Vulnerability {
  id: string;
  title: string;
  description: string;
  severity: Severity;
  category: string;
  recommendation: string;
  requestId?: string;
  url?: string;
  evidence?: {
    request?: string;
    response?: string;
    match?: string;
  };
  detectedAt: string;
}

export interface SecurityScan {
  id: string;
  name: string;
  targetId: string; // Collection or Request ID
  targetType: 'collection' | 'request' | 'url';
  status: ScanStatus;
  progress: number;
  vulnerabilities: Vulnerability[];
  startedAt?: string;
  completedAt?: string;
  score: number; // 0-100
}

export interface SecuritySummary {
  totalScans: number;
  criticalIssues: number;
  highIssues: number;
  mediumIssues: number;
  lowIssues: number;
  avgScore: number;
}
