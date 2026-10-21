import crypto from 'node:crypto';
import {
  ModelProvider,
  ModelMessage,
  ModelToolDefinition,
  ModelRequestOptions,
  ModelResponse,
  ModelToolCall,
  ProviderError,
  ProviderUnconfiguredError,
  ProviderTimeoutError,
  ProviderRateLimitError,
  ProviderProtocolError,
} from './types.js';

export interface GeminiProviderOptions {
  apiKey?: string;
  model?: string;
  endpointBaseUrl?: string;
  defaultTimeoutMs?: number;
  fetchFn?: typeof fetch;
  maxRetries?: number;
  retryBackoffMs?: number;
}

/**
 * Gemini Provider Adapter connecting to the Google Gemini REST API.
 * 
 * Invariants:
 * - Server-side secret isolation: API key is passed via x-goog-api-key header and never in URLs or client bundles.
 * - Key scrubbing: API key is systematically scrubbed from all error messages and logs.
 * - Fail-closed: Missing or empty API key immediately throws ProviderUnconfiguredError (HTTP 503).
 * - Resiliency: Bound by 15s default timeout and max 1 retry on 429/503.
 */
export class GeminiProviderAdapter implements ModelProvider {
  readonly name = 'gemini';

  private readonly apiKey?: string;
  private readonly model: string;
  private readonly endpointBaseUrl: string;
  private readonly defaultTimeoutMs: number;
  private readonly fetchFn: typeof fetch;
  private readonly maxRetries: number;
  private readonly retryBackoffMs: number;

  constructor(options: GeminiProviderOptions = {}) {
    this.apiKey = options.apiKey?.trim();
    this.model = options.model || 'gemini-flash-lite-latest';
    this.endpointBaseUrl = options.endpointBaseUrl || 'https://generativelanguage.googleapis.com/v1beta/models';
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 15000;
    this.fetchFn = options.fetchFn ?? globalThis.fetch;
    this.maxRetries = options.maxRetries ?? 1;
    this.retryBackoffMs = options.retryBackoffMs ?? 500;
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey && this.apiKey.length > 0);
  }

  async generateChatTurn(options: ModelRequestOptions): Promise<ModelResponse> {
    if (!this.isConfigured()) {
      throw new ProviderUnconfiguredError('Chat service unconfigured: model provider credential not configured');
    }

    const { messages, tools, signal, timeoutMs } = options;
    const effectiveTimeoutMs = timeoutMs ?? this.defaultTimeoutMs;

    // 1. Separate system instruction and convert conversation history
    let systemInstructionText: string | undefined;
    const contents: Array<{
      role: 'user' | 'model' | 'function';
      parts: Array<Record<string, unknown>>;
    }> = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        systemInstructionText = msg.content;
        continue;
      }

      if (msg.role === 'user') {
        contents.push({
          role: 'user',
          parts: [{ text: msg.content ?? '' }],
        });
        continue;
      }

      if (msg.role === 'assistant') {
        const parts: Array<Record<string, unknown>> = [];
        if (msg.content) {
          parts.push({ text: msg.content });
        }
        if (msg.toolCalls && msg.toolCalls.length > 0) {
          for (const tc of msg.toolCalls) {
            parts.push({
              functionCall: {
                name: tc.name,
                args: tc.args ?? {},
              },
            });
          }
        }
        if (parts.length > 0) {
          contents.push({ role: 'model', parts });
        }
        continue;
      }

      if (msg.role === 'tool') {
        const toolName = msg.name || msg.toolCallId || 'tool';
        let responsePayload: unknown;
        try {
          responsePayload = msg.content ? JSON.parse(msg.content) : {};
        } catch {
          responsePayload = { output: msg.content ?? '' };
        }

        contents.push({
          role: 'function',
          parts: [
            {
              functionResponse: {
                name: toolName,
                response: typeof responsePayload === 'object' && responsePayload !== null ? responsePayload : { output: responsePayload },
              },
            },
          ],
        });
      }
    }

    // 2. Format tool declarations if available
    const geminiTools: Array<{ functionDeclarations: Array<Record<string, unknown>> }> = [];
    if (tools && tools.length > 0) {
      geminiTools.push({
        functionDeclarations: tools.map((t) => ({
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        })),
      });
    }

    const requestBody: Record<string, unknown> = {
      contents,
    };

    if (systemInstructionText) {
      requestBody.systemInstruction = {
        parts: [{ text: systemInstructionText }],
      };
    }

    if (geminiTools.length > 0) {
      requestBody.tools = geminiTools;
    }

    // 3. Execute with retries, timeout, and cancellation
    const url = `${this.endpointBaseUrl}/${encodeURIComponent(this.model)}:generateContent`;
    let attempts = 0;

    while (attempts <= this.maxRetries) {
      attempts++;
      const abortController = new AbortController();

      let timeoutTimer: NodeJS.Timeout | undefined;
      if (effectiveTimeoutMs > 0) {
        timeoutTimer = setTimeout(() => {
          abortController.abort(new ProviderTimeoutError('Model provider request timed out'));
        }, effectiveTimeoutMs);
      }

      const onExternalAbort = () => {
        abortController.abort(signal?.reason);
      };

      if (signal) {
        signal.addEventListener('abort', onExternalAbort, { once: true });
      }

      try {
        const response = await this.fetchFn(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': this.apiKey!,
          },
          body: JSON.stringify(requestBody),
          signal: abortController.signal,
        });

        if (timeoutTimer) clearTimeout(timeoutTimer);
        if (signal) signal.removeEventListener('abort', onExternalAbort);

        // Handle rate limiting (429) or service unavailable (503) with retry
        if (response.status === 429 || response.status === 503) {
          if (attempts <= this.maxRetries) {
            const jitter = Math.floor(Math.random() * 200);
            await new Promise((res) => setTimeout(res, this.retryBackoffMs + jitter));
            continue;
          }

          if (response.status === 429) {
            throw new ProviderRateLimitError('Model provider rate limit exceeded (HTTP 429)');
          } else {
            throw new ProviderProtocolError('Model provider temporarily unavailable (HTTP 503)');
          }
        }

        if (!response.ok) {
          let errorText = '';
          try {
            const errJson = await response.json() as any;
            errorText = errJson?.error?.message || response.statusText;
          } catch {
            errorText = response.statusText;
          }
          throw new ProviderProtocolError(this.sanitize(`Model provider returned HTTP ${response.status}: ${errorText}`));
        }

        const data = await response.json() as any;
        return this.parseGeminiResponse(data);
      } catch (err: unknown) {
        if (timeoutTimer) clearTimeout(timeoutTimer);
        if (signal) signal.removeEventListener('abort', onExternalAbort);

        if (err instanceof ProviderError) {
          throw err;
        }

        const isAbortError = (err as Error)?.name === 'AbortError' || abortController.signal.aborted;
        if (isAbortError) {
          if (signal?.aborted) {
            throw new ProviderProtocolError('Request cancelled by client');
          }
          throw new ProviderTimeoutError('Model provider request timed out');
        }

        throw new ProviderProtocolError(this.sanitize(err instanceof Error ? err.message : String(err)));
      }
    }

    throw new ProviderProtocolError('Model provider request failed after retry exhaustion');
  }

  private parseGeminiResponse(data: any): ModelResponse {
    if (data.error) {
      throw new ProviderProtocolError(this.sanitize(data.error.message || 'Gemini error'));
    }

    const candidate = data.candidates?.[0];
    if (!candidate || !candidate.content) {
      throw new ProviderProtocolError('Model returned empty response candidates');
    }

    let textContent = '';
    const toolCalls: ModelToolCall[] = [];

    for (const part of candidate.content.parts ?? []) {
      if (part.text) {
        textContent += part.text;
      }
      if (part.functionCall) {
        toolCalls.push({
          id: crypto.randomUUID(),
          name: part.functionCall.name,
          args: (part.functionCall.args as Record<string, unknown>) ?? {},
        });
      }
    }

    let finishReason: ModelResponse['finishReason'] = 'stop';
    if (toolCalls.length > 0) {
      finishReason = 'tool_calls';
    } else if (candidate.finishReason === 'MAX_TOKENS') {
      finishReason = 'length';
    } else if (candidate.finishReason === 'SAFETY' || candidate.finishReason === 'RECITATION') {
      finishReason = 'error';
    }

    return {
      content: textContent || undefined,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      finishReason,
      usage: data.usageMetadata
        ? {
            promptTokens: data.usageMetadata.promptTokenCount,
            completionTokens: data.usageMetadata.candidatesTokenCount,
          }
        : undefined,
    };
  }

  /**
   * Scrubs API key occurrences and internal details from error messages.
   */
  private sanitize(message: string): string {
    if (!this.apiKey) return message;
    return message.split(this.apiKey).join('[REDACTED]');
  }
}
