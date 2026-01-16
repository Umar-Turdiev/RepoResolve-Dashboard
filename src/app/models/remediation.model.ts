import type { Finding } from './finding.model';

export type RemediationStatus = 'queued' | 'running' | 'completed' | 'error';
export type RemediationStep = 'codepatch' | 'push' | 'rescan' | 'tinyfish';

export interface RemediationResult {
  summary?: string;
  patch?: string;
  details?: string;
}

export interface RemediationTask {
  id: string;
  findingId: string;
  ruleId?: string;
  severity?: string;
  file?: string;
  line?: number;
  message?: string;
  createdAt: string;
  updatedAt?: string;
  status: RemediationStatus;
  error?: string;
  result?: RemediationResult;
  finding?: Finding;
  patcherBranch?: string;
  tinyfishStatus?: RemediationStatus;
  tinyfishOutput?: string;
  tinyfishError?: string;
  logs?: Partial<Record<RemediationStep, string[]>>;
}
