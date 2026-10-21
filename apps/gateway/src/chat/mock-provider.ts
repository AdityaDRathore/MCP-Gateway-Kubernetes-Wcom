import crypto from 'node:crypto';
import {
  ModelProvider,
  ModelRequestOptions,
  ModelResponse,
  ModelToolCall,
  ProviderTimeoutError,
  ProviderRateLimitError,
  ProviderProtocolError,
} from './types.js';

export interface MockProviderOptions {
  simulateTimeout?: boolean;
  simulateRateLimit?: boolean;
  simulateError?: string;
  delayMs?: number;
}

/**
 * Deterministic Mock Provider Adapter for offline unit tests and zero-network verification.
 * 
 * Invariants:
 * - Zero network egress, zero token consumption, deterministic responses.
 * - Detects prompt intent and returns standard tool calls with disposable chat-demo- fixtures.
 * - Synthesizes clean summary text upon receiving tool execution results.
 * - Supports controlled failure simulations for timeout, rate-limiting, and error handling tests.
 */
export class DeterministicMockProviderAdapter implements ModelProvider {
  readonly name = 'mock';

  private simulateTimeout: boolean;
  private simulateRateLimit: boolean;
  private simulateError?: string;
  private delayMs: number;

  constructor(options: MockProviderOptions = {}) {
    this.simulateTimeout = Boolean(options.simulateTimeout);
    this.simulateRateLimit = Boolean(options.simulateRateLimit);
    this.simulateError = options.simulateError;
    this.delayMs = options.delayMs ?? 0;
  }

  isConfigured(): boolean {
    return true;
  }

  setSimulateTimeout(enabled: boolean): void {
    this.simulateTimeout = enabled;
  }

  setSimulateRateLimit(enabled: boolean): void {
    this.simulateRateLimit = enabled;
  }

  setSimulateError(errorMsg?: string): void {
    this.simulateError = errorMsg;
  }

  async generateChatTurn(options: ModelRequestOptions): Promise<ModelResponse> {
    if (options.signal?.aborted) {
      throw new ProviderProtocolError('Request cancelled by client');
    }

    if (this.delayMs > 0) {
      await new Promise((res) => setTimeout(res, this.delayMs));
    }

    if (this.simulateTimeout) {
      throw new ProviderTimeoutError('Simulated mock provider timeout');
    }

    if (this.simulateRateLimit) {
      throw new ProviderRateLimitError('Simulated mock provider rate limit (HTTP 429)');
    }

    if (this.simulateError) {
      throw new ProviderProtocolError(this.simulateError);
    }

    // 1. Check if the conversation already contains a tool result
    const lastToolMsg = [...options.messages].reverse().find((m) => m.role === 'tool');
    if (lastToolMsg) {
      const toolName = lastToolMsg.name || lastToolMsg.toolCallId || 'tool';
      let parsedOutput = lastToolMsg.content ?? '';
      try {
        const obj = JSON.parse(parsedOutput);
        if (obj && typeof obj === 'object') {
          parsedOutput = JSON.stringify(obj, null, 2);
        }
      } catch {
        // preserve string
      }

      let summary = `Tool \`${toolName}\` executed successfully.`;
      if (toolName.includes('create_product')) {
        summary = `Successfully created product with SKU \`chat-demo-shirt\`. The product is now cataloged.`;
      } else if (toolName.includes('list_orders') || toolName.includes('orders')) {
        summary = `Retrieved active store orders. Found Order #14 and pending items.`;
      } else if (toolName.includes('list_tasks') || toolName.includes('tasks')) {
        summary = `Retrieved assigned team tasks. Found 3 active tasks in the queue.`;
      } else if (toolName.includes('search_contacts') || toolName.includes('crm')) {
        summary = `Retrieved matching CRM contacts. Found 1 contact record.`;
      }

      return {
        content: summary,
        finishReason: 'stop',
        usage: { promptTokens: 42, completionTokens: 24 },
      };
    }

    // 2. Intent matching based on the last user message
    const lastUserMsg = [...options.messages].reverse().find((m) => m.role === 'user')?.content?.toLowerCase() ?? '';

    // Intent A: Create product
    if (lastUserMsg.includes('create product') || lastUserMsg.includes('add product') || lastUserMsg.includes('new product')) {
      const toolCall: ModelToolCall = {
        id: crypto.randomUUID(),
        name: 'woocommerce__create_product',
        args: {
          name: 'Demo Shirt',
          sku: 'chat-demo-shirt',
          regular_price: '25.00',
        },
      };
      return {
        content: "I will create the product 'Demo Shirt' (SKU: chat-demo-shirt) for $25.00.",
        toolCalls: [toolCall],
        finishReason: 'tool_calls',
        usage: { promptTokens: 35, completionTokens: 18 },
      };
    }

    // Intent B: List orders
    if (lastUserMsg.includes('order') || lastUserMsg.includes('orders')) {
      const toolCall: ModelToolCall = {
        id: crypto.randomUUID(),
        name: 'woocommerce__list_orders',
        args: {
          per_page: 5,
        },
      };
      return {
        content: "I am checking the store orders for you.",
        toolCalls: [toolCall],
        finishReason: 'tool_calls',
        usage: { promptTokens: 28, completionTokens: 15 },
      };
    }

    // Intent C: List tasks
    if (lastUserMsg.includes('task') || lastUserMsg.includes('tasks')) {
      const toolCall: ModelToolCall = {
        id: crypto.randomUUID(),
        name: 'tasks__list_tasks',
        args: {},
      };
      return {
        content: "I am fetching the current task list.",
        toolCalls: [toolCall],
        finishReason: 'tool_calls',
        usage: { promptTokens: 25, completionTokens: 12 },
      };
    }

    // Intent D: CRM search contacts
    if (lastUserMsg.includes('contact') || lastUserMsg.includes('contacts') || lastUserMsg.includes('crm') || lastUserMsg.includes('customer')) {
      const toolCall: ModelToolCall = {
        id: crypto.randomUUID(),
        name: 'crm__search_contacts',
        args: {
          query: 'test',
        },
      };
      return {
        content: "I am searching CRM contacts.",
        toolCalls: [toolCall],
        finishReason: 'tool_calls',
        usage: { promptTokens: 26, completionTokens: 14 },
      };
    }

    // Default conversational response
    return {
      content: 'Hello! I am the Urumi Enterprise AI Gateway Assistant. How can I assist you with products, orders, tasks, or CRM today?',
      finishReason: 'stop',
      usage: { promptTokens: 15, completionTokens: 22 },
    };
  }
}
