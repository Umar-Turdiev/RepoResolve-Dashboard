import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { interval, Subscription, firstValueFrom } from 'rxjs';
import { map, startWith, switchMap, takeWhile, tap } from 'rxjs/operators';

import { environment } from '../../environments/environment';
import type { Finding } from '../models/finding.model';
import type {
  RemediationTask,
  RemediationStep,
} from '../models/remediation.model';
import { TinyfishService } from './tinyfish.service';
import { BedrockService } from './bedrock.service';
import { ScanService } from './scan.service';

@Injectable({ providedIn: 'root' })
export class RemediationService {
  private http = inject(HttpClient);
  private tinyfish = inject(TinyfishService);
  private bedrock = inject(BedrockService);
  private scan = inject(ScanService);
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
      logs: {},
    };

    this._tasks.update((v) => [task, ...v]);
    this.runTask(task);
    return task;
  }

  private runTask(task: RemediationTask) {
    this.startTinyfish(task);
    this.appendLog(task.id, 'codepatch', 'Code patching started.');
    this.updateTask(task.id, { status: 'running' });

    const url = environment.lambdaEndpoints.startPatcherUrl;
    const logsUrl = environment.lambdaEndpoints.patcherLogsUrl;
    const finding = task.finding;
    if (!url || !logsUrl || !finding) {
      this.updateTask(task.id, {
        status: 'error',
        error: 'Patcher is not configured (missing URL/logs/finding).',
      });
      return;
    }

    const repoUrl =
      this.scan.scanSession()?.repo || environment.devConfigs.defaultRepoUrl || '';
    if (!repoUrl) {
      const msg = 'Missing repoUrl for patcher start.';
      this.appendLog(task.id, 'codepatch', msg);
      this.updateTask(task.id, { status: 'error', error: msg });
      return;
    }
    const semgrepJson = [
      {
        fingerprints: finding.fingerprints || {},
        locations: [
          {
            physicalLocation: {
              artifactLocation: {
                uri: finding.location?.file || '',
                uriBaseId: '%SRCROOT%',
              },
              region: {
                startLine: finding.location?.line || 0,
                startColumn: finding.location?.column || 0,
                endLine: finding.location?.line || 0,
                endColumn: finding.location?.column || 0,
                snippet: { text: finding.location?.snippet || '' },
              },
            },
          },
        ],
        message: { text: finding.message },
        ruleId: finding.ruleId,
      },
    ];

    console.log('[patcher] start url', url);
    this.bedrock
      .getPatcherComment(finding)
      .then((comment) => {
        this.appendLog(task.id, 'codepatch', `Comment: ${comment}`);
        const payload = {
          repoUrl,
          semgrepJson,
          comments: comment,
        };
        console.log('[patcher] start payload', payload);
        return firstValueFrom(
          this.http.post<{ taskId?: string }>(url, payload)
        );
      })
      .then((res) => {
        console.log('[patcher] start response', res);
        const taskId = (res as any)?.taskId || (res as any)?.taskArn;
        if (!taskId) {
          throw new Error('No taskId/taskArn returned from patcher start.');
        }
        this.appendLog(task.id, 'codepatch', `Patcher taskId: ${taskId}`);
        this.startPatcherLogs(task.id, taskId);
      })
      .catch((err) => {
        console.error('[patcher] start error', err);
        const msg = err?.message || String(err);
        this.appendLog(task.id, 'codepatch', `Code patching failed: ${msg}`);
        this.updateTask(task.id, { status: 'error', error: msg });
      });
  }

  private startTinyfish(task: RemediationTask) {
    const apiKey = environment.mino.apiKey;
    const runUrl = environment.mino.runSseUrl;
    const siteUrl = environment.mino.defaultUrl;
    if (!apiKey || !runUrl || !siteUrl) {
      this.updateTask(task.id, {
        tinyfishStatus: 'error',
        tinyfishError: 'Tinyfish is not configured (missing API key or URL).',
      });
      return;
    }

    this.updateTask(task.id, { tinyfishStatus: 'running', tinyfishOutput: '' });
    this.appendLog(task.id, 'tinyfish', 'Tinyfish research started.');

    const finding = task.finding;
    if (!finding) {
      this.updateTask(task.id, {
        tinyfishStatus: 'error',
        tinyfishError: 'Missing finding context for Tinyfish.',
      });
      return;
    }

    this.bedrock
      .getTinyfishGoal(finding)
      .then((goal) => {
        this.appendLog(task.id, 'tinyfish', `Goal: ${goal}`);
        return this.tinyfish.runAutomation(
          { url: siteUrl, goal },
          (chunk) => {
            this.appendTinyfishOutput(task.id, chunk);
          }
        );
      })
      .then((full) => {
        this.appendLog(task.id, 'tinyfish', 'Tinyfish research completed.');
        this.updateTask(task.id, {
          tinyfishStatus: 'completed',
          tinyfishOutput: full,
        });
      })
      .catch((err) => {
        const msg = err?.message || String(err);
        this.appendLog(task.id, 'tinyfish', `Tinyfish failed: ${msg}`);
        this.updateTask(task.id, {
          tinyfishStatus: 'error',
          tinyfishError: msg,
        });
      });
  }

  private startPatcherLogs(taskId: string, patcherTaskId: string) {
    const logsUrl = environment.lambdaEndpoints.patcherLogsUrl;
    if (!logsUrl) return;
    let cursor = '';

    const sub = interval(1200)
      .pipe(
        startWith(0),
        switchMap(() => {
          let params = new HttpParams().set('taskId', patcherTaskId);
          if (cursor) params = params.set('cursor', cursor);
          console.log('[patcher] logs poll', { taskId: patcherTaskId, cursor });
          return this.http.get<{
            lines: string[];
            end: boolean;
            cursor?: string;
          }>(logsUrl, { params });
        }),
        map((ch) => {
          cursor = ch.cursor || cursor;
          return ch;
        }),
        takeWhile((ch) => !ch.end, true),
        tap((ch) => {
          if (!ch.lines?.length) return;
          console.log('[patcher] logs chunk', ch.lines);
          ch.lines.forEach((line) => {
            console.log('[patcher]', line);
            this.appendLog(taskId, 'codepatch', line);
          });
        })
      )
      .subscribe({
        complete: () => {
          console.log('[patcher] logs complete');
          this.appendLog(taskId, 'codepatch', 'Patcher logs completed.');
          this.updateTask(taskId, { status: 'completed' });
        },
        error: (err) => {
          console.error('[patcher] logs error', err);
          const msg = err?.message || String(err);
          this.appendLog(taskId, 'codepatch', `Patcher logs error: ${msg}`);
          this.updateTask(taskId, { status: 'error', error: msg });
        },
      });

    this.trackSub(taskId, sub);
  }

  private patcherSubs = new Map<string, Subscription>();

  private trackSub(taskId: string, sub: Subscription) {
    const prev = this.patcherSubs.get(taskId);
    if (prev) prev.unsubscribe();
    this.patcherSubs.set(taskId, sub);
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

  private appendLog(id: string, step: RemediationStep, message: string) {
    const entry = `${new Date().toLocaleTimeString()} ${message}`;
    this._tasks.update((arr) =>
      arr.map((t) => {
        if (t.id !== id) return t;
        const logs = { ...(t.logs || {}) };
        const list = logs[step] ? [...logs[step]!] : [];
        list.push(entry);
        logs[step] = list;
        return { ...t, logs };
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
