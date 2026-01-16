import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';

import { environment } from '../../environments/environment';
import type { Finding } from '../models/finding.model';
import type {
  RemediationResult,
  RemediationTask,
  RemediationStatus,
} from '../models/remediation.model';
import { TinyfishService } from './tinyfish.service';

@Injectable({ providedIn: 'root' })
export class RemediationService {
  private http = inject(HttpClient);
  private tinyfish = inject(TinyfishService);
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
      tinyfishStatus: 'queued',
    };

    this._tasks.update((v) => [task, ...v]);
    this.runTask(task);
    return task;
  }

  private runTask(task: RemediationTask) {
    this.startTinyfish(task);
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

  private startTinyfish(task: RemediationTask) {
    const apiKey = environment.mino.apiKey;
    const runUrl = environment.mino.runSseUrl;
    const siteUrl = environment.mino.defaultUrl;
    if (!apiKey || !runUrl || !siteUrl) {
      this.mockTinyfish(task.id);
      return;
    }

    this.updateTask(task.id, { tinyfishStatus: 'running', tinyfishOutput: '' });

    const goal = this.buildTinyfishGoal(task);
    this.tinyfish
      .runAutomation({ url: siteUrl, goal }, (chunk) => {
        this.appendTinyfishOutput(task.id, chunk);
      })
      .then((full) => {
        this.updateTask(task.id, {
          tinyfishStatus: 'completed',
          tinyfishOutput: full,
        });
      })
      .catch((err) => {
        const msg = err?.message || String(err);
        this.updateTask(task.id, {
          tinyfishStatus: 'error',
          tinyfishError: msg,
        });
      });
  }

  private buildTinyfishGoal(task: RemediationTask): string {
    const file = task.file
      ? `${task.file}${task.line ? ':' + task.line : ''}`
      : 'unknown file';
    return `Research remediation guidance for rule ${task.ruleId || 'unknown'} (${task.severity || 'unknown'}) in ${file}. Provide actionable fix steps in JSON.`;
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

  private mockTinyfish(taskId: string) {
    setTimeout(() => {
      this.updateTask(taskId, {
        tinyfishStatus: 'completed',
        tinyfishOutput: '{"summary":"Mock Tinyfish research complete.","sources":[]}',
      });
    }, 700);
  }

  private appendTinyfishOutput(id: string, chunk: string) {
    this._tasks.update((arr) =>
      arr.map((t) => {
        if (t.id !== id) return t;
        const next = (t.tinyfishOutput || '') + chunk;
        return { ...t, tinyfishOutput: next };
      })
    );
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
