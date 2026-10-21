import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  GeminiProviderAdapter,
  DeterministicMockProviderAdapter,
  createModelProvider,
  ProviderUnconfiguredError,
  ProviderTimeoutError,
  ProviderRateLimitError,
  ProviderProtocolError,
  ModelMessage,
  ModelToolDefinition,
} from '../../src/chat/index.js';
import { AppConfig } from '../../src/config.js';

describe('Gateway Chat Provider Adapter Unit Tests (Gate P6-G2)', () => {
  describe('GeminiProviderAdapter Configuration & Key Isolation', () => {
    it('reports isConfigured === false when API key is missing or blank', () => {
      const adapterMissing = new GeminiProviderAdapter({});
      assert.equal(adapterMissing.isConfigured(), false);

      const adapterEmpty = new GeminiProviderAdapter({ apiKey: '   ' });
      assert.equal(adapterEmpty.isConfigured(), false);
    });

    it('reports isConfigured === true when API key is provided', () => {
      const adapter = new GeminiProviderAdapter({ apiKey: 'test-secret-key-123' });
      assert.equal(adapter.isConfigured(), true);
    });

    it('fails closed with ProviderUnconfiguredError when generateChatTurn is called without key', async () => {
      const adapter = new GeminiProviderAdapter({});
      await assert.rejects(
        async () => {
          await adapter.generateChatTurn({
            messages: [{ role: 'user', content: 'hello' }],
          });
        },
        (err: unknown) => {
          assert(err instanceof ProviderUnconfiguredError);
          assert.equal((err as ProviderUnconfiguredError).code, 'PROVIDER_UNCONFIGURED');
          assert.equal((err as ProviderUnconfiguredError).statusCode, 503);
          assert.match(err.message, /credential not configured/);
          return true;
        }
      );
    });
  });

  describe('GeminiProviderAdapter Request Formatting & Header Isolation', () => {
    it('sends apiKey in x-goog-api-key header and formats systemInstruction and messages correctly', async () => {
      let capturedUrl = '';
      let capturedHeaders: Record<string, string> = {};
      let capturedBody: any = null;

      const mockFetch: typeof fetch = async (input, init) => {
        capturedUrl = String(input);
        capturedHeaders = (init?.headers as Record<string, string>) ?? {};
        capturedBody = JSON.parse(String(init?.body));

        return {
          ok: true,
          status: 200,
          json: async () => ({
            candidates: [
              {
                content: {
                  parts: [{ text: 'Mocked Gemini response' }],
                },
                finishReason: 'STOP',
              },
            ],
            usageMetadata: {
              promptTokenCount: 15,
              candidatesTokenCount: 5,
            },
          }),
        } as Response;
      };

      const adapter = new GeminiProviderAdapter({
        apiKey: 'my-super-secret-gemini-key',
        model: 'gemini-1.5-flash',
        fetchFn: mockFetch,
      });

      const messages: ModelMessage[] = [
        { role: 'system', content: 'You are an AI assistant.' },
        { role: 'user', content: 'List 3 products' },
        {
          role: 'assistant',
          content: 'I will call a tool',
          toolCalls: [{ id: 'call-1', name: 'woocommerce__list_products', args: { per_page: 3 } }],
        },
        {
          role: 'tool',
          name: 'woocommerce__list_products',
          content: JSON.stringify([{ id: 10, name: 'Item 10' }]),
        },
      ];

      const tools: ModelToolDefinition[] = [
        {
          name: 'woocommerce__list_products',
          description: 'List store products',
          parameters: {
            type: 'object',
            properties: { per_page: { type: 'number' } },
          },
        },
      ];

      const response = await adapter.generateChatTurn({ messages, tools });

      // Verify URL does NOT leak key in query params
      assert.equal(capturedUrl.includes('my-super-secret-gemini-key'), false);
      assert.match(capturedUrl, /models\/gemini-1\.5-flash:generateContent/);

      // Verify header holds the key
      assert.equal(capturedHeaders['x-goog-api-key'], 'my-super-secret-gemini-key');

      // Verify body formatting
      assert.equal(capturedBody.systemInstruction.parts[0].text, 'You are an AI assistant.');
      assert.equal(capturedBody.contents.length, 3);
      assert.equal(capturedBody.contents[0].role, 'user');
      assert.equal(capturedBody.contents[0].parts[0].text, 'List 3 products');
      assert.equal(capturedBody.contents[1].role, 'model');
      assert.equal(capturedBody.contents[1].parts[0].text, 'I will call a tool');
      assert.equal(capturedBody.contents[1].parts[1].functionCall.name, 'woocommerce__list_products');
      assert.equal(capturedBody.contents[2].role, 'function');
      assert.equal(capturedBody.contents[2].parts[0].functionResponse.name, 'woocommerce__list_products');

      // Verify tools formatting
      assert.equal(capturedBody.tools[0].functionDeclarations[0].name, 'woocommerce__list_products');

      // Verify normalized ModelResponse
      assert.equal(response.content, 'Mocked Gemini response');
      assert.equal(response.finishReason, 'stop');
      assert.equal(response.usage?.promptTokens, 15);
      assert.equal(response.usage?.completionTokens, 5);
    });

    it('parses functionCall parts into ModelToolCall and sets finishReason to tool_calls', async () => {
      const mockFetch: typeof fetch = async () => {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            candidates: [
              {
                content: {
                  parts: [
                    { text: 'I am checking orders.' },
                    {
                      functionCall: {
                        name: 'woocommerce__list_orders',
                        args: { per_page: 5 },
                      },
                    },
                  ],
                },
                finishReason: 'STOP',
              },
            ],
          }),
        } as Response;
      };

      const adapter = new GeminiProviderAdapter({
        apiKey: 'secret-key',
        fetchFn: mockFetch,
      });

      const response = await adapter.generateChatTurn({
        messages: [{ role: 'user', content: 'Show me orders' }],
      });

      assert.equal(response.content, 'I am checking orders.');
      assert.equal(response.finishReason, 'tool_calls');
      assert.equal(response.toolCalls?.length, 1);
      assert.equal(response.toolCalls?.[0].name, 'woocommerce__list_orders');
      assert.deepEqual(response.toolCalls?.[0].args, { per_page: 5 });
      assert.ok(response.toolCalls?.[0].id);
    });
  });

  describe('GeminiProviderAdapter Resiliency, Rate Limiting & Scrubbing', () => {
    it('retries once on HTTP 429 and succeeds if second attempt succeeds', async () => {
      let callCount = 0;
      const mockFetch: typeof fetch = async () => {
        callCount++;
        if (callCount === 1) {
          return {
            ok: false,
            status: 429,
            statusText: 'Too Many Requests',
            json: async () => ({ error: { message: 'Quota exceeded' } }),
          } as Response;
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            candidates: [
              {
                content: { parts: [{ text: 'Recovered after retry' }] },
                finishReason: 'STOP',
              },
            ],
          }),
        } as Response;
      };

      const adapter = new GeminiProviderAdapter({
        apiKey: 'secret-key',
        fetchFn: mockFetch,
        retryBackoffMs: 10,
      });

      const response = await adapter.generateChatTurn({
        messages: [{ role: 'user', content: 'test' }],
      });

      assert.equal(callCount, 2);
      assert.equal(response.content, 'Recovered after retry');
    });

    it('throws ProviderRateLimitError (429) when HTTP 429 persists after retry', async () => {
      let callCount = 0;
      const mockFetch: typeof fetch = async () => {
        callCount++;
        return {
          ok: false,
          status: 429,
          statusText: 'Too Many Requests',
          json: async () => ({ error: { message: 'Quota exceeded' } }),
        } as Response;
      };

      const adapter = new GeminiProviderAdapter({
        apiKey: 'secret-key',
        fetchFn: mockFetch,
        retryBackoffMs: 10,
      });

      await assert.rejects(
        async () => {
          await adapter.generateChatTurn({
            messages: [{ role: 'user', content: 'test' }],
          });
        },
        (err: unknown) => {
          assert(err instanceof ProviderRateLimitError);
          assert.equal((err as ProviderRateLimitError).code, 'PROVIDER_RATE_LIMITED');
          assert.equal((err as ProviderRateLimitError).statusCode, 429);
          return true;
        }
      );
      assert.equal(callCount, 2); // 1 initial + 1 retry
    });

    it('throws ProviderTimeoutError when request times out', async () => {
      const mockFetch: typeof fetch = async (_input, init) => {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            reject(err);
          });
        });
      };

      const adapter = new GeminiProviderAdapter({
        apiKey: 'secret-key',
        fetchFn: mockFetch,
        defaultTimeoutMs: 50,
      });

      await assert.rejects(
        async () => {
          await adapter.generateChatTurn({
            messages: [{ role: 'user', content: 'test' }],
          });
        },
        (err: unknown) => {
          assert(err instanceof ProviderTimeoutError);
          assert.equal((err as ProviderTimeoutError).code, 'PROVIDER_TIMEOUT');
          assert.equal((err as ProviderTimeoutError).statusCode, 504);
          return true;
        }
      );
    });

    it('sanitizes and scrubs API key if it appears in upstream error payload', async () => {
      const mockFetch: typeof fetch = async () => {
        return {
          ok: false,
          status: 400,
          statusText: 'Bad Request',
          json: async () => ({
            error: {
              message: 'Invalid request with key leaked-gemini-key-999 in payload',
            },
          }),
        } as Response;
      };

      const adapter = new GeminiProviderAdapter({
        apiKey: 'leaked-gemini-key-999',
        fetchFn: mockFetch,
      });

      await assert.rejects(
        async () => {
          await adapter.generateChatTurn({
            messages: [{ role: 'user', content: 'test' }],
          });
        },
        (err: unknown) => {
          assert(err instanceof ProviderProtocolError);
          assert.equal(err.message.includes('leaked-gemini-key-999'), false);
          assert.match(err.message, /\[REDACTED\]/);
          return true;
        }
      );
    });
  });

  describe('DeterministicMockProviderAdapter Deterministic Behavior', () => {
    it('isConfigured returns true unconditionally', () => {
      const mock = new DeterministicMockProviderAdapter();
      assert.equal(mock.isConfigured(), true);
    });

    it('matches "create product" intent and emits woocommerce__create_product with chat-demo fixture', async () => {
      const mock = new DeterministicMockProviderAdapter();
      const response = await mock.generateChatTurn({
        messages: [{ role: 'user', content: 'Please create product for our demo' }],
      });

      assert.equal(response.finishReason, 'tool_calls');
      assert.equal(response.toolCalls?.length, 1);
      assert.equal(response.toolCalls?.[0].name, 'woocommerce__create_product');
      assert.equal(response.toolCalls?.[0].args.sku, 'chat-demo-shirt');
      assert.match(response.content ?? '', /chat-demo-shirt/);
    });

    it('matches "orders" intent and emits woocommerce__list_orders', async () => {
      const mock = new DeterministicMockProviderAdapter();
      const response = await mock.generateChatTurn({
        messages: [{ role: 'user', content: 'Show me recent orders' }],
      });

      assert.equal(response.finishReason, 'tool_calls');
      assert.equal(response.toolCalls?.length, 1);
      assert.equal(response.toolCalls?.[0].name, 'woocommerce__list_orders');
    });

    it('matches "tasks" intent and emits tasks__list_tasks', async () => {
      const mock = new DeterministicMockProviderAdapter();
      const response = await mock.generateChatTurn({
        messages: [{ role: 'user', content: 'What are my tasks today?' }],
      });

      assert.equal(response.finishReason, 'tool_calls');
      assert.equal(response.toolCalls?.length, 1);
      assert.equal(response.toolCalls?.[0].name, 'tasks__list_tasks');
    });

    it('matches "crm" intent and emits crm__search_contacts', async () => {
      const mock = new DeterministicMockProviderAdapter();
      const response = await mock.generateChatTurn({
        messages: [{ role: 'user', content: 'Search contacts in CRM' }],
      });

      assert.equal(response.finishReason, 'tool_calls');
      assert.equal(response.toolCalls?.length, 1);
      assert.equal(response.toolCalls?.[0].name, 'crm__search_contacts');
    });

    it('summarizes tool result when last message is a tool result', async () => {
      const mock = new DeterministicMockProviderAdapter();
      const response = await mock.generateChatTurn({
        messages: [
          { role: 'user', content: 'Show me orders' },
          {
            role: 'assistant',
            toolCalls: [{ id: '1', name: 'woocommerce__list_orders', args: {} }],
          },
          {
            role: 'tool',
            name: 'woocommerce__list_orders',
            content: JSON.stringify([{ id: 14, total: '45.00' }]),
          },
        ],
      });

      assert.equal(response.finishReason, 'stop');
      assert.match(response.content ?? '', /Order #14/);
    });

    it('returns friendly default greeting for general conversational query', async () => {
      const mock = new DeterministicMockProviderAdapter();
      const response = await mock.generateChatTurn({
        messages: [{ role: 'user', content: 'Who are you?' }],
      });

      assert.equal(response.finishReason, 'stop');
      assert.match(response.content ?? '', /Urumi Enterprise AI Gateway Assistant/);
    });

    it('supports controlled failure simulations for timeout, rate-limiting, and error', async () => {
      const mock = new DeterministicMockProviderAdapter();

      // Timeout simulation
      mock.setSimulateTimeout(true);
      await assert.rejects(
        async () => mock.generateChatTurn({ messages: [{ role: 'user', content: 'hi' }] }),
        ProviderTimeoutError
      );
      mock.setSimulateTimeout(false);

      // Rate limit simulation
      mock.setSimulateRateLimit(true);
      await assert.rejects(
        async () => mock.generateChatTurn({ messages: [{ role: 'user', content: 'hi' }] }),
        ProviderRateLimitError
      );
      mock.setSimulateRateLimit(false);

      // Custom error simulation
      mock.setSimulateError('Simulated internal failure');
      await assert.rejects(
        async () => mock.generateChatTurn({ messages: [{ role: 'user', content: 'hi' }] }),
        /Simulated internal failure/
      );
    });
  });

  describe('createModelProvider Factory Resolution', () => {
    it('returns DeterministicMockProviderAdapter when CHAT_PROVIDER is mock', () => {
      const config = {
        CHAT_PROVIDER: 'mock',
        NODE_ENV: 'production',
        GEMINI_API_KEY: 'some-key',
        GEMINI_MODEL: 'gemini-1.5-flash',
        PROVIDER_TIMEOUT_MS: 15000,
      } as unknown as AppConfig;

      const provider = createModelProvider(config);
      assert.equal(provider.name, 'mock');
      assert(provider instanceof DeterministicMockProviderAdapter);
    });

    it('returns DeterministicMockProviderAdapter when NODE_ENV is test regardless of CHAT_PROVIDER', () => {
      const config = {
        CHAT_PROVIDER: 'gemini',
        NODE_ENV: 'test',
        GEMINI_API_KEY: 'some-key',
        GEMINI_MODEL: 'gemini-1.5-flash',
        PROVIDER_TIMEOUT_MS: 15000,
      } as unknown as AppConfig;

      const provider = createModelProvider(config);
      assert.equal(provider.name, 'mock');
      assert(provider instanceof DeterministicMockProviderAdapter);
    });

    it('returns GeminiProviderAdapter when in production with CHAT_PROVIDER gemini', () => {
      const config = {
        CHAT_PROVIDER: 'gemini',
        NODE_ENV: 'production',
        GEMINI_API_KEY: 'prod-gemini-key',
        GEMINI_MODEL: 'gemini-1.5-flash',
        PROVIDER_TIMEOUT_MS: 15000,
      } as unknown as AppConfig;

      const provider = createModelProvider(config);
      assert.equal(provider.name, 'gemini');
      assert(provider instanceof GeminiProviderAdapter);
    });
  });
});
