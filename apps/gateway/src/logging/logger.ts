/**
 * Structured Redacted JSON Logger for Urumi Team MCP Gateway.
 * 
 * Policy:
 * Log redaction serves as a defense-in-depth risk reduction measure to prevent
 * accidental leakage of credentials, tokens, and PII into log sinks.
 * It is not an absolute cryptographic boundary against arbitrary unstructured text.
 */

const SENSITIVE_KEY_PATTERNS = [
  /authorization/i,
  /password/i,
  /secret/i,
  /token/i,
  /api[-_]?key/i,
  /cookie/i,
  /consumer[-_]?secret/i,
  /consumer[-_]?key/i,
];

const LOG_LEVELS = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
} as const;

export type LogLevel = keyof typeof LOG_LEVELS;

export function sanitizeString(value: string): string {
  let sanitized = value;

  // Redact Bearer and Basic authentication headers
  sanitized = sanitized.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, '[REDACTED_AUTH_HEADER]');
  sanitized = sanitized.replace(/Basic\s+[A-Za-z0-9+/=]+/gi, '[REDACTED_AUTH_HEADER]');

  // Redact Urumi API keys (urumi_live_<hex>)
  sanitized = sanitized.replace(/urumi_live_[0-9a-fA-F]{16,64}/g, '[REDACTED_API_KEY]');

  // Redact credentials in query strings or assignments
  sanitized = sanitized.replace(/(?:password|secret|token|api_key)=([^&\s]+)/gi, '$1=[REDACTED]');

  // Redact real emails while preserving RFC-reserved test domains and synthetic .mock domains
  // Matches TLDs from 2 to 63 chars (RFC 1034), excluding .mock, .example, .test, and .invalid
  sanitized = sanitized.replace(
    /\b[A-Za-z0-9._%+-]+@(?!(?:[A-Za-z0-9-]+\.)*(?:mock|example|test|invalid)\b)[A-Za-z0-9.-]+\.[A-Za-z]{2,63}\b/gi,
    '[REDACTED_EMAIL]'
  );

  return sanitized;
}

/**
 * Recursively redacts sensitive keys and values in objects, arrays, and primitives.
 */
export function redactSensitiveData(data: unknown): unknown {
  if (data === null || data === undefined) {
    return data;
  }

  if (typeof data === 'string') {
    return sanitizeString(data);
  }

  if (typeof data === 'number' || typeof data === 'boolean') {
    return data;
  }

  if (data instanceof Error) {
    return {
      name: data.name,
      message: sanitizeString(data.message),
      // Avoid raw stack leakage in logs
      stack: '[REDACTED_STACK]',
    };
  }

  if (Array.isArray(data)) {
    return data.map((item) => redactSensitiveData(item));
  }

  if (typeof data === 'object') {
    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      const isSensitiveKey = SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key));
      if (isSensitiveKey) {
        sanitized[key] = '[REDACTED]';
      } else {
        sanitized[key] = redactSensitiveData(value);
      }
    }
    return sanitized;
  }

  return sanitizeString(String(data));
}

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  service: string;
  message: string;
  [key: string]: unknown;
}

export class Logger {
  private service: string;
  private minLevel: LogLevel;

  constructor(service = 'urumi-gateway', minLevel: LogLevel = 'info') {
    this.service = service;
    this.minLevel = minLevel;
  }

  setLevel(level: LogLevel): void {
    this.minLevel = level;
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[this.minLevel];
  }

  private log(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
    if (!this.shouldLog(level)) {
      return;
    }

    const sanitizedMessage = sanitizeString(message);
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      service: this.service,
      message: sanitizedMessage,
      ...(meta ? (redactSensitiveData(meta) as Record<string, unknown>) : {}),
    };

    const output = JSON.stringify(entry);
    if (level === 'error') {
      console.error(output);
    } else if (level === 'warn') {
      console.warn(output);
    } else {
      console.log(output);
    }
  }

  debug(message: string, meta?: Record<string, unknown>): void {
    this.log('debug', message, meta);
  }

  info(message: string, meta?: Record<string, unknown>): void {
    this.log('info', message, meta);
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    this.log('warn', message, meta);
  }

  error(message: string, meta?: Record<string, unknown>): void {
    this.log('error', message, meta);
  }
}

export const logger = new Logger();
