import {
  Component,
  ElementRef,
  ViewChild,
  inject,
  effect,
  DestroyRef,
  ViewEncapsulation,
  computed,
  signal,
} from '@angular/core';

import { BedrockService } from '../../services/bedrock.service';
import { ChatService } from '../../services/chat.service';
import { RemediationService } from '../../services/remediation.service';
import type { RemediationStatus, RemediationStep } from '../../models/remediation.model';
import { environment } from '../../../environments/environment';

type TurnRole = 'system' | 'user' | 'assistant';

@Component({
  selector: 'app-ai-chatbox',
  templateUrl: './ai-chatbox.component.html',
  styleUrls: ['./ai-chatbox.component.scss'],
  encapsulation: ViewEncapsulation.None,
})
export class AiChatboxComponent {
  private chat = inject(ChatService);
  private bedrock = inject(BedrockService);
  private remediation = inject(RemediationService);
  private destroyRef = inject(DestroyRef);

  @ViewChild('scroll') scrollRef!: ElementRef<HTMLDivElement>;

  // UI state
  draft = '';
  streaming = false;
  temperature = 0.2;
  activeTab = signal<'chat' | 'workflow'>('chat');

  private abort = new AbortController();
  private autoSwitched = false;

  // Keep the system prompt out of the visible chat history
  private systemPrompt =
    'You are an AI security analyst for Semgrep/Vanta/Harness results. Be concise and actionable.';

  // Expose messages as an Array for the template *ngFor
  get messages() {
    return this.chat.messages();
  }

  latestTask = computed(() => this.remediation.tasks()[0] ?? null);
  showWorkflow = computed(() => {
    if (environment.ui.forceWorkflowTab) return true;
    const t = this.latestTask();
    if (!t) return false;
    return t.status !== 'queued' || t.tinyfishStatus !== 'queued';
  });
  private typeNode = <T extends RemediationStep>(
    label: string,
    status: RemediationStatus,
    step: T
  ) => ({ label, status, step });

  tinyfishNodes = computed(() => {
    const t = this.latestTask();
    return [
      this.typeNode(
        'Deep Research',
        (t?.tinyfishStatus ?? 'queued') as RemediationStatus,
        'tinyfish'
      ),
    ];
  });

  codepatchNodes = computed(() => {
    const t = this.latestTask();
    const baseStatus = (t?.status ?? 'queued') as RemediationStatus;
    const downstreamStatus = this.stepStatus(baseStatus);
    return [
      this.typeNode('Code Patch', baseStatus, 'codepatch'),
      this.typeNode('Push to GitHub', downstreamStatus, 'push'),
      this.typeNode('Rescan', downstreamStatus, 'rescan'),
    ];
  });


  constructor() {
    // Auto-reply whenever the latest message is from the user (either from the input or external “Fix with AI”)
    effect(
      () => {
        const msgs = this.chat.messages();
        if (!msgs.length || this.streaming) return;

        const last = msgs[msgs.length - 1];
        if (last.role !== 'user') return;

        this.streamReply(); // will stream into a fresh assistant bubble
      },
      { allowSignalWrites: true }
    );

    this.destroyRef.onDestroy(() => this.stop());

    effect(
      () => {
        if (
          (this.showWorkflow() || environment.ui.forceWorkflowTab) &&
          !this.autoSwitched
        ) {
          this.activeTab.set('workflow');
          this.autoSwitched = true;
        }
      },
      { allowSignalWrites: true }
    );
  }

  /** Called by your form submit / send button */
  send() {
    const text = this.draft.trim();
    if (!text || this.streaming) return;
    this.chat.sendToChat(text); // auto-reply is triggered by the effect above
    this.draft = '';
    queueMicrotask(() => this.scrollToEnd());
  }

  stop() {
    if (this.streaming) this.abort.abort();
    this.streaming = false;
  }

  clear() {
    this.stop();
    this.chat.clear();
  }

  /** Core: stream an AI reply to the latest user message */
  private async streamReply() {
    if (this.streaming) return;

    // 1) Take a snapshot of current messages BEFORE creating the empty assistant
    const snapshot = this.chat
      .messages()
      .filter(
        (m) => typeof m.content === 'string' && m.content.trim().length > 0
      ); // no empties

    // 2) Build Anthropic-style history using the snapshot
    const history: {
      role: 'system' | 'user' | 'assistant';
      content: string;
    }[] = [
      { role: 'system', content: this.systemPrompt },
      ...snapshot.map((m) => ({ role: m.role, content: m.content })),
    ];

    // 3) Now create an empty assistant bubble to stream into
    this.chat.startAssistant();
    this.scrollToEnd();

    this.streaming = true;
    this.abort = new AbortController();

    try {
      await this.bedrock.invokeStream(
        history,
        (delta) => {
          this.chat.appendToAssistant(delta);
          queueMicrotask(() => this.scrollToEnd());
        },
        { temperature: this.temperature, abortSignal: this.abort.signal }
      );
    } catch (e: any) {
      this.chat.appendToAssistant(`\n[Error] ${e?.message ?? e}`);
    } finally {
      this.streaming = false;
      queueMicrotask(() => this.scrollToEnd());
    }
  }
  private scrollToEnd() {
    const el = this.scrollRef?.nativeElement;
    if (el) el.scrollTop = el.scrollHeight;
  }

  statusClass(status: RemediationStatus) {
    if (status === 'running') return 'wf-status is-running';
    if (status === 'completed') return 'wf-status is-done';
    if (status === 'error') return 'wf-status is-error';
    return 'wf-status is-pending';
  }

  statusLabel(status: RemediationStatus) {
    if (status === 'running') return 'running';
    if (status === 'completed') return 'done';
    if (status === 'error') return 'error';
    return '';
  }

  setTab(tab: 'chat' | 'workflow') {
    this.activeTab.set(tab);
  }

  private stepStatus(status: RemediationStatus): RemediationStatus {
    if (status === 'completed') return 'completed';
    return 'queued';
  }

  logsFor(step: RemediationStep) {
    const task = this.latestTask();
    return task?.logs?.[step] ?? [];
  }
}
