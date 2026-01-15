// services/chat.service.ts
import { Injectable, signal } from '@angular/core';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

@Injectable({ providedIn: 'root' })
export class ChatService {
  readonly messages = signal<ChatMessage[]>([]);

  sendToChat(content: string) {
    // user message
    if (!content?.trim()) return;
    this.messages.update((m) => [
      ...m,
      { role: 'user', content: content.trim() },
    ]);
  }

  startAssistant() {
    // create empty assistant bubble
    this.messages.update((m) => [...m, { role: 'assistant', content: '' }]);
  }

  appendToAssistant(delta: string) {
    // stream into the last assistant
    this.messages.update((m) => {
      if (!m.length) return m;
      const last = m[m.length - 1];
      if (last.role !== 'assistant') return m;
      const copy = m.slice();
      copy[copy.length - 1] = {
        ...last,
        content: last.content + (delta ?? ''),
      };
      return copy;
    });
  }

  receiveFromAI(full: string) {
    // (optional) non-streaming
    this.messages.update((m) => [...m, { role: 'assistant', content: full }]);
  }

  clear() {
    this.messages.set([]);
  }
}
