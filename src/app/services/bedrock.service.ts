import { Injectable } from '@angular/core';
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
  InvokeModelWithResponseStreamCommand,
} from '@aws-sdk/client-bedrock-runtime';
import { environment } from '../../environments/environment';
import { Finding } from '../models/finding.model';

export type Role = 'system' | 'user' | 'assistant';
export type Turn = { role: Role; content: string };

@Injectable({ providedIn: 'root' })
export class BedrockService {
  private client = new BedrockRuntimeClient({
    region: environment.aws.region,
    credentials: {
      accessKeyId: environment.bedrock.accessKeyId,
      secretAccessKey: environment.bedrock.secretAccessKey,
    },
  });

  // For InvokeModel*, pass the inference profile ID/ARN as modelId
  private modelId = environment.bedrock.inferenceProfileArn;

  /** Build Anthropic-compatible body (works with Claude 3.5 Sonnet v2 via profile) */
  private toAnthropicBody(
    history: Turn[],
    opts?: { maxTokens?: number; temperature?: number; topP?: number }
  ) {
    let system = '';
    const messages: Array<{
      role: 'user' | 'assistant';
      content: { type: 'text'; text: string }[];
    }> = [];

    for (const t of history) {
      if (t.role === 'system') {
        if (t.content?.trim()) system += (system ? '\n' : '') + t.content;
      } else {
        messages.push({
          role: t.role === 'assistant' ? 'assistant' : 'user',
          content: [{ type: 'text', text: t.content }],
        });
      }
    }

    return {
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: opts?.maxTokens ?? 10000,
      temperature: opts?.temperature ?? 0.2,
      system: system || undefined,
      messages,
    };
  }

  /** Non-streaming (optional, handy for quick checks) */
  async invokeOnce(
    history: Turn[],
    opts?: { maxTokens?: number; temperature?: number }
  ): Promise<string> {
    const body = this.toAnthropicBody(history, opts);
    const cmd = new InvokeModelCommand({
      modelId: this.modelId,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify(body),
    });

    const res = await this.client.send(cmd);
    const text = new TextDecoder().decode(res.body as Uint8Array);
    try {
      const j = JSON.parse(text);
      // Anthropic returns { content: [{ text: '...' }], ... }
      return (
        (j?.content ?? []).map((c: any) => c.text).join('') ||
        j?.outputText ||
        text
      );
    } catch {
      return text;
    }
  }

  /** Streaming */
  async invokeStream(
    history: Turn[],
    onChunk: (delta: string) => void,
    opts?: {
      maxTokens?: number;
      temperature?: number;
      topP?: number;
      abortSignal?: AbortSignal;
    }
  ): Promise<string> {
    const body = this.toAnthropicBody(history, opts);
    const cmd = new InvokeModelWithResponseStreamCommand({
      modelId: this.modelId,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify(body),
    });

    const res = await this.client.send(cmd, { abortSignal: opts?.abortSignal });

    let full = '';
    for await (const evt of res.body ?? []) {
      const bytes = (evt as any)?.chunk?.bytes as Uint8Array | undefined;
      if (!bytes) continue;

      const s = new TextDecoder().decode(bytes);
      try {
        const j = JSON.parse(s);
        // deltas usually appear as delta.text; sometimes content[0].text or outputText
        const delta =
          j?.delta?.text ?? j?.content?.[0]?.text ?? j?.outputText ?? '';
        if (delta) {
          full += delta;
          onChunk(delta);
        }
      } catch {
        // tolerate partial frames
        full += s;
        onChunk(s);
      }
    }
    return full;
  }

  /** Helper: safely parse model JSON output */
  /** Helper: parse model JSON output, repairing common issues (double-encoded + truncated arrays) */
  private tryParseJSON<T = any>(text: string): T | null {
    if (!text) return null;

    // 1) Strip code fences if any (even if wrapped in quotes)
    let s = text
      .trim()
      .replace(/```[a-zA-Z]*\n?|```/g, '')
      .trim();

    // 1b) Unwrap JSON if the model returned a quoted JSON string
    const unwrapped = this.unwrapJSONString(s);
    if (unwrapped !== null) s = unwrapped as any;

    // 1c) If still wrapped in quotes, strip them and unescape
    if (typeof s === 'string') {
      const t = s.trim();
      if (t.startsWith('"') && t.endsWith('"') && /[[{]/.test(t)) {
        s = this.unescapeJsonString(t.slice(1, -1)) as any;
      }
    }

    // 2) Try to de-stringify up to 3 layers (handles "\"escaped\"" arrays)
    for (let i = 0; i < 3; i++) {
      if (typeof s === 'string') {
        try {
          const parsed = JSON.parse(s);
          s = parsed as any;
        } catch {
          break;
        }
      }
    }

    // 3) If it’s now an object/array, return it
    if (typeof s === 'object') return s as T;

    // 4) If it’s still a string, try a normal parse once more
    if (typeof s === 'string') {
      try {
        return JSON.parse(s) as T;
      } catch {
        // try unescaping a JSON-like string (e.g. {\"id\":...})
        const unescaped = this.unescapeJsonString(s);
        if (unescaped !== s) {
          try {
            return JSON.parse(unescaped) as T;
          } catch {
            // fall through to repair attempt
          }
        }
      }
    }

    // 5) Last resort: repair a likely truncated JSON array
    const repaired = this.repairLikelyJSONArray(
      typeof s === 'string' ? this.unescapeJsonString(s) : String(s)
    );
    if (repaired) {
      try {
        return JSON.parse(repaired) as T;
      } catch {
        // give up
      }
    }

    return null;
  }

  /** If the model returns a quoted JSON string, unwrap it safely */
  private unwrapJSONString(s: string): any | null {
    const t = s.trim();
    if (!(t.startsWith('"') && t.endsWith('"'))) return null;
    try {
      return JSON.parse(t);
    } catch {
      return this.unescapeJsonString(t.slice(1, -1));
    }
  }

  /** Convert common escaped sequences back to JSON characters */
  private unescapeJsonString(s: string): string {
    if (!s) return s;
    if (!/\\[nrt"\\]/.test(s)) return s;
    return s
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .replace(/\\t/g, '\t')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');
  }

  /** Attempt to repair a truncated JSON array by dropping the last incomplete element and closing brackets */
  private repairLikelyJSONArray(s: string): string | null {
    const str = s.trim();

    // Only attempt on something that looks like a JSON array
    const firstBracket = str.indexOf('[');
    if (firstBracket === -1) return null;

    // Walk and keep bracket/quote state; stop at last *balanced* position
    let depth = 0;
    let inStr = false;
    let esc = false;
    let lastBalancedIdx = -1;

    for (let i = firstBracket; i < str.length; i++) {
      const ch = str[i];

      if (inStr) {
        if (esc) {
          esc = false;
        } else if (ch === '\\') {
          esc = true;
        } else if (ch === '"') {
          inStr = false;
        }
      } else {
        if (ch === '"') inStr = true;
        else if (ch === '[' || ch === '{') depth++;
        else if (ch === ']' || ch === '}') depth = Math.max(0, depth - 1);

        if (depth === 0) lastBalancedIdx = i;
      }
    }

    // If we never reached balance, try cutting at last '}' or ']'
    let cutIdx =
      lastBalancedIdx >= 0
        ? lastBalancedIdx
        : Math.max(str.lastIndexOf(']'), str.lastIndexOf('}'));

    if (cutIdx < 0) return null;

    let candidate = str.slice(0, cutIdx + 1);

    // Ensure it ends with a closing array bracket
    // If last char is '}', we may need to add a ']'
    const trimmed = candidate.trimEnd();
    if (!trimmed.endsWith(']')) {
      // Remove trailing commas before closing
      candidate = candidate.replace(/,\s*$/, '');
      candidate += ']';
    }

    // Also ensure it *starts* at the first '['
    candidate = candidate.slice(firstBracket);

    // Quick sanity: must start with '[' and end with ']'
    const ctrim = candidate.trim();
    if (!(ctrim.startsWith('[') && ctrim.endsWith(']'))) return null;

    return ctrim;
  }

  /** Trim long fields so prompts stay small */
  private sanitizeForAI(
    findings: Finding[],
    maxSnippet = 800,
    maxMsg = 400
  ): Finding[] {
    return findings.map((f) => ({
      ...f,
      message: (f.message || '').slice(0, maxMsg),
      location: f.location
        ? {
            ...f.location,
            snippet: (f.location.snippet || '').slice(0, maxSnippet),
          }
        : undefined,
      // don’t send huge raw blobs
      raw: undefined,
    }));
  }

  /**
   * Enrich findings with AI:
   * adds aiExplanation + aiRemediation to each item and returns a new array.
   */
  async enrichFindings(findings: Finding[]): Promise<Finding[]> {
    const input = this.sanitizeForAI(findings);

    const system = `You are a senior application security analyst. Return clear, actionable guidance. Keep responses concise.`;

    const user = `Given the following findings JSON array, add three fields to each item:
- Severity = 'critical' | 'high' | 'medium' | 'low' | 'info' | 'unknown';
- aiExplanation: one short paragraph (plain text) explaining the risk in simple terms.
- aiRemediation: 2-5 specific steps or code changes to fix or mitigate.

Rules:
- Do NOT change or remove any existing properties.
- Do NOT invent file paths or lines; only use what's provided.
- If information is missing, write 'Unknown' briefly—do not guess.
- Respond with JSON ONLY (the full modified array).
- Do not wrap the response in code fences or quotes.
- Do not escape double quotes (no backslashes).

Findings:
${JSON.stringify(input, null, 2)}`;

    const text = await this.invokeOnce(
      [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      { temperature: 0.2 }
    );

    console.log(text);

    const maybe = this.tryParseJSON<Finding[]>(text);
    if (!maybe || !Array.isArray(maybe)) {
      console.warn('⚠️ AI returned non-JSON or invalid array; raw:', text);
      return findings; // fall back gracefully
    }

    // Merge AI fields back by id to avoid losing anything
    const byId = new Map(findings.map((f) => [f.id, f]));
    for (const f of maybe) {
      const base = byId.get(f.id);
      if (base) {
        byId.set(f.id, {
          ...base,
          severity: (f as any).severity ?? base.severity,
          aiExplanation: (f as any).aiExplanation ?? base.aiExplanation,
          aiRemediation: (f as any).aiRemediation ?? base.aiRemediation,
        });
      }
    }
    return [...byId.values()];
  }

  /** AI summary (about 30 words) of findings */
  async summarizeFindings(findings: Finding[]): Promise<string> {
    const input = this.sanitizeForAI(findings);

    const system =
      'You are a concise security analyst. Respond with a single sentence of about 30 words.';
    const user = `Summarize the overall risk posture and key issues in ~30 words.
Rules:
- Return plain text only.
- No bullet points, no JSON, no code fences.

Findings:
${JSON.stringify(input, null, 2)}`;

    const text = await this.invokeOnce(
      [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      { maxTokens: 200, temperature: 0.2 }
    );

    return String(text || '').trim();
  }

  /** AI safety score (0–10) based on findings */
  async getSafetyScore(findings: Finding[]): Promise<number> {
    const input = this.sanitizeForAI(findings);

    const system =
      'You are a strict security auditor. Score the overall safety of the system.';
    const user = `Given the findings array, output a single JSON object with a numeric score between 0 and 10.
Rules:
- Score 0 means critically unsafe; 10 means very safe.
- Output ONLY: {"score": <number>}
- No code fences, no extra text.

Findings:
${JSON.stringify(input, null, 2)}`;

    const text = await this.invokeOnce(
      [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      { maxTokens: 120, temperature: 0 }
    );

    const parsed = this.tryParseJSON<{ score: number }>(text);
    const rawScore =
      typeof parsed?.score === 'number'
        ? parsed.score
        : Number(String(text || '').replace(/[^\d.]/g, ''));
    const clamped = Number.isFinite(rawScore)
      ? Math.min(10, Math.max(0, rawScore))
      : 0;

    return clamped;
  }
}
