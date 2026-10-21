/**
 * Core types, interfaces, DTOs, and error classes for the Gateway chat provider abstraction layer.
 * 
 * Gate: Phase 6 Gate P6-G2
 * Traceability: CHT-02, CHT-03, CHT-04
 */

export type ModelRole = 'user' | 'assistant' | 'system' | 'tool';

/**
 * Message passed into or returned from a model conversation turn.
 */
export interface ModelMessage {
  role: ModelRole;
  content?: string;
  toolCalls?: ModelToolCall[];
  toolCallId?: string;
  name?: string;
}

/**
 * Representation of a function/tool call requested by the model.
 */
export interface ModelToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

/**
 * Parameter definition for tools exposed to the model.
 */
export interface ModelToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
}

/**
 * Options passed to ModelProvider.generateChatTurn.
 */
export interface ModelRequestOptions {
  messages: ModelMessage[];
  tools?: ModelToolDefinition[];
  signal?: AbortSignal;
  timeoutMs?: number;
}

/**
 * Normalized model response.
 */
export interface ModelResponse {
  content?: string;
  toolCalls?: ModelToolCall[];
  finishReason: 'stop' | 'tool_calls' | 'length' | 'error';
  usage?: { promptTokens?: number; completionTokens?: number };
}

/**
 * Unified model provider interface.
 */
export interface ModelProvider {
  readonly name: string;
  isConfigured(): boolean;
  generateChatTurn(options: ModelRequestOptions): Promise<ModelResponse>;
}

/**
 * DTO for incoming browser chat turn request.
 */
export interface ChatTurnRequest {
  message: string;
  history?: ModelMessage[];
}

/**
 * DTO for browser chat turn response.
 */
export interface ChatTurnResponse {
  message: string;
  toolCalls?: Array<{
    name: string;
    args: Record<string, unknown>;
    result?: unknown;
    status: 'success' | 'error' | 'confirmation_required';
    durationMs?: number;
  }>;
  confirmationToken?: string;
  confirmationPrompt?: string;
  turnId: string;
}

// === Provider Error Hierarchy ===

export class ProviderError extends Error {
  readonly code: string;
  readonly statusCode: number;

  constructor(message: string, code = 'PROVIDER_ERROR', statusCode = 502) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
  }
}

export class ProviderUnconfiguredError extends ProviderError {
  constructor(message = 'Chat service unconfigured: model provider credential not configured') {
    super(message, 'PROVIDER_UNCONFIGURED', 503);
  }
}

export class ProviderTimeoutError extends ProviderError {
  constructor(message = 'Model provider request timed out') {
    super(message, 'PROVIDER_TIMEOUT', 504);
  }
}

export class ProviderRateLimitError extends ProviderError {
  constructor(message = 'Model provider rate limit exceeded') {
    super(message, 'PROVIDER_RATE_LIMITED', 429);
  }
}

export class ProviderProtocolError extends ProviderError {
  constructor(message: string) {
    super(message, 'PROVIDER_PROTOCOL_ERROR', 502);
  }
}
