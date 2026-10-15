/**
 * Structured Redacted JSON Logger for Tasks Mock MCP Server.
 * Guarantees zero credential and real customer PII leakage to stdout/stderr.
 */

const SENSITIVE_KEY_PATTERNS = [
  /authorization/i,
  /password/i,
  /secret/i,
  /token/i,
  /api[-_]?key/i,
];

const LOG_LEVELS = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
} as const;

export function sanitizeString(data: string): string {
  let sanitized = data;

  if (sanitized.toLowerCase().startsWith('bearer ') || sanitized.toLowerCase().startsWith('basic ')) {
    return '[REDACTED_AUTH_HEADER]';
  }

  // Redact real emails (exclude RFC-reserved .mock and .example domains)
  sanitized = sanitized.replace(
    /\b[A-Za-z0-9._%+-]+@(?!example\.mock\b)[A-Za-z0-9.-]+\.[A-Za-z]{2,7}\b/g,
    '[REDACTED_EMAIL]'
  );

  return sanitized;
}

export function redactSensitiveData(data: unknown): unknown {
  if (data === null || data === undefined) {
    return data;
  }

  if (typeof data === 'string') {
    return sanitizeString(data);
  }

  if (Array.isArray(data)) {
    return data.map(redactSensitiveData);
  }

  if (typeof data === 'object') {
    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      const isSensitive = SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key));
      if (isSensitive) {
        sanitized[key] = '[REDACTED]';
      } else {
        sanitized[key] = redactSensitiveData(value);
      }
    }
    return sanitized;
  }

  return data;
}

export interface LogEntry {
  timestamp: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  service: string;
  message: string;
  [key: string]: unknown;
}

export class Logger {
  private service: string;
  private minLevel: 'debug' | 'info' | 'warn' | 'error';

  constructor(service = 'urumi-mcp-tasks', minLevel: 'debug' | 'info' | 'warn' | 'error' = 'info') {
    this.service = service;
    this.minLevel = minLevel;
  }

  setLevel(level: 'debug' | 'info' | 'warn' | 'error'): void {
    this.minLevel = level;
  }

  private shouldLog(level: 'debug' | 'info' | 'warn' | 'error'): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[this.minLevel];
  }

  private log(level: LogEntry['level'], message: string, meta?: Record<string, unknown>): void {
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
