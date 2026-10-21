export * from './types.js';
export * from './gemini-provider.js';
export * from './mock-provider.js';
export * from './confirmation.js';
export * from './agent-loop.js';

import { ModelProvider } from './types.js';
import { GeminiProviderAdapter } from './gemini-provider.js';
import { DeterministicMockProviderAdapter } from './mock-provider.js';
import { AppConfig } from '../config.js';

/**
 * Creates the configured ModelProvider based on gateway configuration.
 * Under test or when CHAT_PROVIDER === 'mock', selects DeterministicMockProviderAdapter.
 * Otherwise creates GeminiProviderAdapter using server-side GEMINI_API_KEY.
 */
export function createModelProvider(config: AppConfig): ModelProvider {
  if (config.CHAT_PROVIDER === 'mock' || config.NODE_ENV === 'test') {
    return new DeterministicMockProviderAdapter();
  }
  return new GeminiProviderAdapter({
    apiKey: config.GEMINI_API_KEY,
    model: config.GEMINI_MODEL,
    defaultTimeoutMs: config.PROVIDER_TIMEOUT_MS,
  });
}
