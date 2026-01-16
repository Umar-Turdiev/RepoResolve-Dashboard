import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';

import { environment } from '../../environments/environment';
import type { Finding } from '../models/finding.model';
import type {
  RemediationResult,
  RemediationTask,
  RemediationStatus,
} from '../models/remediation.model';

@Injectable({ providedIn: 'root' })
export class RemediationService {
  private http = inject(HttpClient);
  private readonly _tasks = signal<RemediationTask[]>([]);

  readonly tasks = computed(() => this._tasks());
  readonly queue = computed(() =>
    this._tasks().filter((t) => t.status === 'queued' || t.status === 'running')
  );
  readonly completed = computed(() =>
    this._tasks().filter((t) => t.status === 'completed')
  );
  readonly failed = computed(() =>
    this._tasks().filter((t) => t.status === 'error')
  );

  enqueue(finding: Finding): RemediationTask {
    const task: RemediationTask = {
      id: `remed-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      findingId: finding.id,
      ruleId: finding.ruleId,
      severity: finding.severity,
      file: finding.location?.file,
      line: finding.location?.line,
      message: finding.message,
      createdAt: new Date().toISOString(),
      status: 'queued',
      finding,
    };

    this._tasks.update((v) => [task, ...v]);
    this.runTask(task);
    return task;
  }

  private runTask(task: RemediationTask) {
    this.updateTask(task.id, { status: 'running' });

    const url = environment.lambdaEndpoints.remediationTaskUrl;
    if (!url) {
      this.mockComplete(task.id);
      return;
    }

    const payload = {
      taskId: task.id,
      finding: {
        id: task.findingId,
        ruleId: task.ruleId,
        severity: task.severity,
        message: task.message,
        location: {
          file: task.file,
          line: task.line,
        },
        snippet: task.finding?.location?.snippet,
      },
    };

    this.http.post<RemediationResult>(url, payload).subscribe({
      next: (res) => {
        this.updateTask(task.id, { status: 'completed', result: res });
      },
      error: (err) => {
        const msg =
          err?.error?.message || err?.message || 'Remediation failed';
        this.updateTask(task.id, { status: 'error', error: String(msg) });
      },
    });
  }

  private mockComplete(taskId: string) {
    setTimeout(() => {
      this.updateTask(taskId, {
        status: 'completed',
        result: {
          summary: 'Mock remediation task completed.',
          patch: '// TODO: apply suggested fix',
        },
      });
    }, 900);
  }

  private updateTask(
    id: string,
    patch: Partial<Omit<RemediationTask, 'id' | 'createdAt'>>
  ) {
    const updatedAt = new Date().toISOString();
    this._tasks.update((arr) =>
      arr.map((t) =>
        t.id === id ? { ...t, ...patch, updatedAt } : t
      )
    );
  }
}
