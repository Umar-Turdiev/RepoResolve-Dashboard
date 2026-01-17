import { Injectable, inject, signal } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import {
  Observable,
  Subscription,
  interval,
  map,
  of,
  startWith,
  switchMap,
  takeWhile,
  tap,
} from 'rxjs';

import { environment } from '../../environments/environment';
import {
  isSarif,
  mapSemgrepSarifToFindings,
} from '../models/semgrep.sarif.mapper';
import type { Finding, ToolKind } from '../models/finding.model';
import { FindingsService } from './findings.service';
import { BedrockService } from './bedrock.service';

/* -----------------------------
   Scanner Adapter Abstraction
--------------------------------*/
interface ScannerAdapter {
  tool: ToolKind;

  // endpoints (can read from environment or be hardcoded per tool)
  startUrl: string;
  logsUrl: string;
  resultUrl: string;

  // how to detect the result filename from logs
  resultFilePattern: RegExp;

  // optional: convert the tool’s raw result JSON into your Finding[]
  mapResultToFindings(payload: unknown, ctx: { repo?: string }): Finding[];
}

/* -----------------------------
   Semgrep Adapter (uses existing env)
--------------------------------*/
const SemgrepAdapter: ScannerAdapter = {
  tool: 'semgrep',
  startUrl: environment.lambdaEndpoints.startSemgrepScanUrl,
  logsUrl: environment.lambdaEndpoints.semgrepScannerLogsUrl,
  resultUrl: environment.lambdaEndpoints.fetchResultUrl,
  resultFilePattern:
    /semgrep-results-[a-zA-Z0-9._-]+-[a-zA-Z0-9._-]+-\d{8}T\d{6}Z\.json/i,

  mapResultToFindings(payload: any, ctx): Finding[] {
    // If it looks like SARIF, map it deterministically
    if (isSarif(payload)) {
      return mapSemgrepSarifToFindings(payload, ctx);
    }

    // Else, try to coerce a flattened array you may already return
    if (Array.isArray(payload)) {
      return payload.map((r: any, i: number) => ({
        id: r.id ?? `semgrep-${i}`,
        tool: 'semgrep',
        ruleId: r.ruleId ?? 'rule',
        message: r.message?.text ?? r.message ?? '',
        severity: (r.severity as any) ?? 'unknown',
        location: {
          file:
            r.location?.file ??
            r.locations?.[0]?.physicalLocation?.artifactLocation?.uri,
          line:
            r.location?.line ??
            r.locations?.[0]?.physicalLocation?.region?.startLine,
          snippet:
            r.location?.snippet ??
            r.locations?.[0]?.physicalLocation?.region?.snippet?.text,
        },
        fingerprints: r.fingerprints,
        raw: r,
      })) as Finding[];
    }

    return [];
  },
};

/* -----------------------------
   Harness Adapter
--------------------------------*/
const HarnessAdapter: ScannerAdapter = {
  tool: 'harness',
  startUrl: environment.lambdaEndpoints.startHarnessPipelineURL,
  // Reuse shared log/result endpoints if your infra is shared:
  logsUrl:
    // environment.lambdaEndpoints.harnessScannerLogsUrl ||
    environment.lambdaEndpoints.harnessLogsURL,
  resultUrl: environment.lambdaEndpoints.fetchResultUrl,

  // expect lines like:
  // Done. Results saved to /out/harness-results-owner-repo-20251009T054832Z.json
  resultFilePattern:
    /harness-results-[a-zA-Z0-9._-]+-[a-zA-Z0-9._-]+-\d{8}T\d{6}Z\.json/i,

  /** Minimal example: promote a couple of CI smells to Finding[] */
  mapResultToFindings(payload: any, ctx): Finding[] {
    const out: Finding[] = [];
    const createdAt = new Date().toISOString();

    const summary = payload?.data?.pipelineExecutionSummary;
    if (!summary) return out; // nothing we understand

    // 1) Image tags: flag ":latest"
    const imageDetails: Array<{ imageName?: string; imageTag?: string }> =
      summary?.moduleInfo?.ci?.imageDetailsList || [];
    for (const img of imageDetails) {
      if (!img?.imageName) continue;
      const tag = (img.imageTag || '').trim();
      if (tag.toLowerCase() === 'latest') {
        out.push({
          id: `harness-img-${img.imageName}-latest`,
          tool: 'harness',
          ruleId: 'HARNESS-CI-IMAGE-TAG-LATEST',
          title: 'Mutable image tag in pipeline',
          message:
            'Pipeline uses :latest image tag, which is not immutable. Pin to a digest or version tag.',
          severity: 'medium',
          location: {
            file: 'pipelines/build.yaml', // best-effort placeholder
            line: undefined,
            snippet: `${img.imageName}:${img.imageTag}`,
          },
          createdAt,
          raw: img,
        });
      }
    }

    // 2) Overall stage status heuristic (optional)
    const stageMap = summary?.layoutNodeMap || {};
    Object.values(stageMap as any).forEach((node: any) => {
      // Example: surface "IgnoreFailed" as a low-sev note
      const status = (node?.status || '').toString();
      if (status === 'IgnoreFailed') {
        out.push({
          id: `harness-stage-ignore-${
            node?.nodeUuid || node?.nodeIdentifier || 'stage'
          }`,
          tool: 'harness',
          ruleId: 'HARNESS-CI-STAGE-IGNOREFAILED',
          title: 'Stage configured to IgnoreFailed',
          message:
            'Stage executed with status IgnoreFailed. Consider failing fast to avoid promoting broken artifacts.',
          severity: 'low',
          location: {
            file: 'pipelines/build.yaml',
            snippet: `${node?.name || 'Stage'}: ${status}`,
          },
          createdAt,
          raw: node,
        });
      }
    });

    // You can add more rules later: cache disabling, mutable base images, etc.
    return out;
  },
};
/* -----------------------------
   Adapter registry
--------------------------------*/
const ADAPTERS: Record<ToolKind, ScannerAdapter> = {
  semgrep: SemgrepAdapter,
  vanta: {
    tool: 'vanta',
    startUrl: '', // TODO: wire when ready
    logsUrl: '',
    resultUrl: '',
    resultFilePattern: /vanta-results-.*\.json/i,
    mapResultToFindings: () => [],
  },
  harness: HarnessAdapter,
};

/* -----------------------------
   Service
--------------------------------*/
export type ScanPhase =
  | 'idle'
  | 'starting'
  | 'scanning'
  | 'completed'
  | 'error';

export interface StartScanResponse {
  taskId: string;
  startedAt: string;
  repo: string;
  branch?: string;
}

export interface LogChunk {
  lines: string[];
  end: boolean;
  cursor?: string;
}

@Injectable({ providedIn: 'root' })
export class ScanService {
  private http = inject(HttpClient);
  constructor(
    private findingsStore: FindingsService,
    private bedrock: BedrockService
  ) {}

  readonly scanSession = signal<{
    taskId: string;
    repo: string;
    tool: ToolKind;
    branch?: string;
  } | null>(null);
  readonly scanPhase = signal<ScanPhase>('idle');
  readonly resultFile = signal<string | null>(null);

  // ✅ central log buffer for UI to read
  readonly logs = signal<string[]>([]);

  // ✅ the live polling subscription lives here (not in a component)
  private logSub?: Subscription;
  private prevFindingsByTask = new Map<string, Finding[]>();

  /** Start a scan for a tool (works for both semgrep and harness) */
  startScan(
    input: string,
    tool: ToolKind,
    opts?: { branch?: string; previousFindings?: Finding[] }
  ): Observable<StartScanResponse> {
    const a = ADAPTERS[tool];
    let v = String(input || '').trim();

    // Normalize repo URL like your working curl example
    if (!/^https?:\/\//i.test(v)) v = `https://github.com/${v}`;
    v = v.replace(/\.git$/i, '').replace(/\/+$/g, '');

    this.scanPhase.set('starting');

    const body: Record<string, unknown> = { repoUrl: v };
    if (opts?.branch) body['TARGET_BRANCH'] = opts.branch;

    return this.http
      .post<any>(a.startUrl, body, {
        headers: {
          'Content-Type': 'application/json',
          'X-Target-Repo': v, // exactly like your curl -H "X-Target-Repo"
        },
      })
      .pipe(
        map((res: any) => {
          const body =
            typeof res?.body === 'string' ? JSON.parse(res.body) : res;
          const rawTaskId = body?.taskId ?? res?.taskId; // ARN or short from lambda
          if (!rawTaskId) throw new Error(`No taskId returned for ${tool}`);

          // derive short form for convenience
          const shortTaskId = rawTaskId.includes('/')
            ? rawTaskId.split('/').pop()!
            : rawTaskId;

          // return ARN by default (works for semgrep; harness logs also want ARN in your setup)
          const out: StartScanResponse = {
            taskId: rawTaskId, // <-- keep ARN
            startedAt: body?.startedAt ?? res?.startedAt,
            repo: body?.repo ?? v,
            branch: body?.branch ?? opts?.branch,
          } as StartScanResponse;

          if (opts?.previousFindings?.length) {
            this.prevFindingsByTask.set(rawTaskId, opts.previousFindings);
          }

          // store both variants on the session so we can retry if needed
          (this as any).__lastIds = { rawTaskId, shortTaskId, tool };

          console.log(`[${tool}] ✅ startScan success`, out);
          return out;
        })
      );
  }

  /** Mark started so the shell can switch */
  markStarted(res: StartScanResponse, tool: ToolKind) {
    this.scanSession.set({
      taskId: res.taskId,
      repo: res.repo,
      tool,
      branch: res.branch,
    });
    this.scanPhase.set('scanning');
  }

  clearSession() {
    this.scanSession.set(null);
    this.scanPhase.set('idle');
    this.resultFile.set(null);
  }

  /** Poll logs for a given taskId and tool, detect result file, then fetch it */
  streamLogs(taskId: string, tool: ToolKind) {
    const a = ADAPTERS[tool];
    let cursor = '';

    return interval(1200).pipe(
      startWith(0),
      switchMap(() => {
        // console.log(taskId, cursor);

        let params = new HttpParams().set('taskId', taskId);
        if (cursor) params = params.set('cursor', cursor);
        return this.http.get<LogChunk>(a.logsUrl, { params });
      }),
      map((ch) => {
        cursor = ch.cursor || cursor;
        return ch;
      }),
      takeWhile((ch) => !ch.end, true),
      map((ch) => ch.lines),
      tap((lines) => {
        for (const line of lines) {
          const match = line.match(a.resultFilePattern);
          if (match) {
            const filename = match[0];
            console.log(`[${tool}] 🟡 Detected result file:`, filename);
            this.resultFile.set(filename);

            // fetch results (console log only as requested)
            const params = new HttpParams().set('name', filename);
            this.http.get(a.resultUrl, { params }).subscribe({
              next: async (res) => {
                console.log(`[${tool}] ✅ Result Lambda response:`, res);

                // 1) Normalize to Finding[]
                const ctx = {
                  repo: this.scanSession()?.repo,
                  createdAt: new Date().toISOString(),
                };
                let normalized: Finding[] = [];
                if (tool === 'semgrep') {
                  normalized = isSarif(res)
                    ? mapSemgrepSarifToFindings(res, ctx)
                    : a.mapResultToFindings(res, ctx);
                } else {
                  normalized = a.mapResultToFindings(res, ctx);
                }

                if (!normalized.length) {
                  console.warn(`[${tool}] ℹ️ No findings after normalization.`);
                } else {
                  const previous =
                    tool === 'semgrep'
                      ? this.prevFindingsByTask.get(taskId) ?? []
                      : [];
                  if (tool === 'semgrep' && previous.length) {
                    const refined = await this.bedrock.filterRescanFindings(
                      previous,
                      normalized
                    );
                    normalized = refined;
                    this.prevFindingsByTask.delete(taskId);
                  }
                  console.table(
                    normalized.map((n) => ({
                      tool: n.tool,
                      sev: n.severity,
                      rule: n.ruleId,
                      file: n.location?.file,
                      line: n.location?.line,
                    }))
                  );
                  this.findingsStore.add(normalized);
                }

                // 2) Enrich with AI (explanations + remediation)
                console.log(tool, 'enrichment starting', normalized);

                this.bedrock
                  .enrichFindings(normalized)
                  .then((enriched) => {
                    console.log('🤖 Enriched findings:', enriched);
                    // optional: persist enriched back to the store
                    this.findingsStore.add(enriched);

                    this.bedrock
                      .summarizeFindings(enriched)
                      .then((summary) => {
                        this.findingsStore.setAiSummary(summary);
                      })
                      .catch((e) => {
                        console.error('❌ AI summary failed:', e);
                      });

                    this.bedrock
                      .getSafetyScore(enriched)
                      .then((score) => {
                        this.findingsStore.setSafetyScore(score);
                      })
                      .catch((e) => {
                        console.error('❌ AI safety score failed:', e);
                      });

                    console.log(this.findingsStore.all());
                  })
                  .catch((e) => {
                    console.error('❌ AI enrichment failed:', e);
                  });

                this.scanPhase.set('completed');
              },
              error: (err) =>
                console.error(`[${tool}] ❌ Failed to fetch result:`, err),
            });
          }
        }
      })
    );
  }

  /** Start/replace polling and keep it alive even if components unmount */
  // Add a map of subscriptions instead of a single one
  private logSubs: Record<ToolKind, Subscription | undefined> = {
    semgrep: undefined,
    harness: undefined,
    vanta: undefined,
  };

  // Start log polling per tool (no longer overwrite each other)
  startLogPolling(taskId: string, tool: ToolKind) {
    // cancel only that tool’s old sub
    this.logSubs[tool]?.unsubscribe();
    this.logs.update((v) => [...v, `Streaming ${tool} logs...`]);

    const sub = this.streamLogs(taskId, tool).subscribe({
      next: (lines) => {
        if (!lines?.length) return;
        this.logs.update((v) => v.concat(lines.map((ln) => `[${tool}] ${ln}`)));
      },
      complete: () => {
        this.logs.update((v) => [...v, `[${tool}] ✅ Completed.`]);
      },
      error: (e) => {
        const msg = e?.error?.message || e?.message || 'Log stream error';
        this.logs.update((v) => [...v, `[${tool}] ❌ ${msg}`]);
      },
    });

    // store separate sub
    this.logSubs[tool] = sub;
  }

  // Optional: stop polling for one or all
  stopLogPolling(tool?: ToolKind) {
    if (tool) {
      this.logSubs[tool]?.unsubscribe();
      this.logSubs[tool] = undefined;
    } else {
      Object.keys(this.logSubs).forEach((t) => {
        this.logSubs[t as ToolKind]?.unsubscribe();
        this.logSubs[t as ToolKind] = undefined;
      });
    }
  }

  /** Direct fetch if you already know the file name */
  fetchResult(name: string, tool: ToolKind): Observable<any> {
    const a = ADAPTERS[tool];
    const params = new HttpParams().set('name', name);
    return this.http.get(a.resultUrl, { params });
  }
}
