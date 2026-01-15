import {
  AfterViewInit,
  Component,
  DestroyRef,
  ElementRef,
  ViewChild,
  effect,
  inject,
  signal,
} from '@angular/core';
import { FormBuilder, Validators } from '@angular/forms';
import { ScanService } from '../../services/scan.service';
import type { SarifLog, SarifResult } from '../../models/sarif.model';
import { ToolKind } from '../../models/finding.model';

type Phase = 'idle' | 'starting' | 'scanning' | 'completed' | 'error';

function canon(input: string): string {
  let v = (input || '').trim();
  if (!v) return v;
  // owner/repo → https://github.com/owner/repo
  if (!/^https?:\/\//i.test(v)) v = `https://github.com/${v}`;
  // drop trailing slash and .git
  v = v.replace(/\.git$/i, '').replace(/\/+$/g, '');
  return v;
}

@Component({
  selector: 'app-start-screen',
  templateUrl: './start-screen.component.html',
  styleUrls: ['./start-screen.component.scss'],
})
export class StartScreenComponent implements AfterViewInit {
  private fb = inject(FormBuilder);
  private scan = inject(ScanService);
  private destroyRef = inject(DestroyRef);
  private gotAnyLogs = false;
  @ViewChild('interactiveBubble', { static: true })
  private interactiveBubble?: ElementRef<HTMLDivElement>;

  private curX = 0;
  private curY = 0;
  private tgX = 0;
  private tgY = 0;
  private rafId: number | null = null;
  private onMouseMove = (event: MouseEvent) => {
    this.tgX = event.clientX;
    this.tgY = event.clientY;
  };

  phase = signal<Phase>('idle');
  taskId = signal<string | null>(null);
  logs = signal<string[]>([]);
  findings = signal<SarifResult[]>([]);
  toolName = signal<string>('Semgrep');
  errorText = signal<string>('');

  form = this.fb.group({
    repoUrl: [
      'https://github.com/TransformerOptimus/SuperAGI',
      [Validators.required],
    ], // no format validator
  });

  rotatingWord = 'VULNERABILITY PATCHING';

  private rotatingWords = [
    'VULNERABILITY PATCHING',
    'SECURITY DEEP-RESEARCH',
    'VULNERABILITY SCANS',
  ];

  ngOnInit() {
    let index = 0;
    setInterval(() => {
      index = (index + 1) % this.rotatingWords.length;
      this.rotatingWord = this.rotatingWords[index];
    }, 3000); // change every 3s
  }

  constructor() {
    // React to detected result file
    effect(() => {
      const file = this.scan.resultFile();
      if (file) {
        console.log('📦 Result file detected in StartScreen:', file);
      }
    });
  }

  ngAfterViewInit() {
    const bubble = this.interactiveBubble?.nativeElement;
    if (!bubble) return;

    const move = () => {
      this.curX += (this.tgX - this.curX) / 20;
      this.curY += (this.tgY - this.curY) / 20;
      bubble.style.transform = `translate(${Math.round(
        this.curX
      )}px, ${Math.round(this.curY)}px)`;
      this.rafId = requestAnimationFrame(move);
    };

    window.addEventListener('mousemove', this.onMouseMove, { passive: true });
    this.destroyRef.onDestroy(() => {
      window.removeEventListener('mousemove', this.onMouseMove);
      if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    });

    move();
  }

  start(): void {
    if (this.phase() === 'starting' || this.phase() === 'scanning') return;

    this.phase.set('starting');
    this.logs.set(['Initializing scans...']);
    this.errorText.set('');
    this.findings.set([]);
    this.taskId.set(null);
    this.gotAnyLogs = false;

    const raw = String(this.form.value.repoUrl || '');
    const normalized = raw.startsWith('http')
      ? raw.replace(/\.git$/i, '').replace(/\/+$/, '')
      : `https://github.com/${raw.replace(/\.git$/i, '').replace(/\/+$/, '')}`;

    // Run both Semgrep and Harness in parallel
    const tools: ToolKind[] = ['semgrep', 'harness'];

    this.phase.set('scanning');
    this.logs.set(['🚀 Starting all scans...']);

    tools.forEach((tool) => {
      this.logs.update((v) => [...v, `--- Starting ${tool.toUpperCase()} ---`]);

      this.scan.startScan(normalized, tool).subscribe({
        next: (res) => {
          // Some start lambdas wrap JSON inside res.body (string)
          const body =
            typeof (res as any)?.body === 'string'
              ? JSON.parse((res as any).body)
              : res;

          let taskId = body?.taskId || res?.taskId;
          const repo = body?.repo || res?.repo || normalized;

          if (!taskId) {
            this.logs.update((v) => [...v, `[${tool}] ❌ No taskId returned.`]);
            return;
          }

          this.logs.update((v) => [
            ...v,
            `[${tool}] ✅ Started with taskId=${taskId}`,
          ]);

          this.scan.markStarted(
            { taskId, startedAt: new Date().toISOString(), repo },
            tool
          );
          this.scan.startLogPolling(taskId, tool);
        },
        error: (e) => {
          const msg = (
            e?.error?.message ||
            e?.message ||
            'Start failed'
          ).toString();
          this.logs.update((v) => [...v, `[${tool}] ❌ Start failed: ${msg}`]);
        },
      });
    });
  }

  private streamLogsAndFinish(taskId: string) {
    const sub = this.scan.streamLogs(taskId, 'semgrep').subscribe({
      next: (lines) => {
        if (!lines || lines.length === 0) {
          if (!this.gotAnyLogs) this.logs.set(['(no logs yet)']); // show once
          return; // keep existing content
        }
        if (!this.gotAnyLogs) {
          this.gotAnyLogs = true;
          // drop placeholder if present
          const cur = this.logs();
          if (cur.length === 1 && cur[0].includes('no log')) this.logs.set([]);
        }
        // append new chunk (don’t replace)
        this.logs.update((v) => v.concat(lines));
      },
      complete: () => {
        this.phase.set('completed');
        this.logs.update((v) => [...v, 'Done.']);
        // optional: collapse placeholder-only state
        if (!this.gotAnyLogs) this.logs.set(['(no logs emitted)']);
      },
      error: (e) => {
        this.phase.set('error');
        const msg = (
          e?.error?.message ||
          e?.message ||
          'Log stream error'
        ).toString();
        this.errorText.set(msg);
        this.logs.update((v) => [...v, `Log stream error: ${msg}`]);
      },
    });
    this.destroyRef.onDestroy(() => sub.unsubscribe());
  }

  severityBadge(level?: string): string {
    switch (level) {
      case 'error':
        return 'badge badge--error';
      case 'warning':
        return 'badge badge--warn';
      default:
        return 'badge';
    }
  }

  artifactLoc(r?: SarifResult): string {
    const loc = r?.locations?.[0]?.physicalLocation;
    const file = loc?.artifactLocation?.uri ?? '';
    const line = loc?.region?.startLine ?? 0;
    return file ? `${file}:${line}` : '';
  }
}
