import { Injectable } from '@angular/core';
import { environment } from '../../environments/environment';

type TinyfishParams = {
  url: string;
  goal: string;
  abortSignal?: AbortSignal;
};

@Injectable({ providedIn: 'root' })
export class TinyfishService {
  async runAutomation(
    params: TinyfishParams,
    onChunk?: (chunk: string) => void
  ): Promise<string> {
    const res = await fetch(environment.mino.runSseUrl, {
      method: 'POST',
      headers: {
        'X-API-Key': environment.mino.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url: params.url, goal: params.goal }),
      signal: params.abortSignal,
    });

    if (!res.body) {
      throw new Error('Tinyfish response has no body.');
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let full = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value);
      full += chunk;
      onChunk?.(chunk);
    }

    return full;
  }
}
