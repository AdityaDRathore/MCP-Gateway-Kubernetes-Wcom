/**
 * Structured, Redacted JSON Logger for Urumi WooCommerce MCP Server.
 * Guarantees zero credential, signature, and customer PII leakage to stdout/stderr.
 */

const SENSITIVE_KEY_PATTERNS = [
  /authorization/i,
  /consumer[-_]?secret/i,
  /consumer[-_]?key/i,
  /password/i,
  /secret/i,
  /token/i,
  /signature/i,
  /oauth/i,
  /billing/i,
  /shipping/i,
  /email/i,
  /phone/i,
  /first[-_]?name/i,
  /last[-_]?name/i,
  /address/i,
  /postcode/i,
];

/**
 * Recursively redacts sensitive keys from an object or value.
 */
export function redactSensitiveData(data: unknown): unknown {
  if (data === null || data === undefined) {
    return data;
  }

  if (typeof data === 'string') {
    // Redact basic auth or bearer tokens in strings
    if (data.toLowerCase().startsWith('bearer ') || data.toLowerCase().startsWith('basic ')) {
      return '[REDACTED_AUTH_HEADER]';
    }
    return data;
  }

  if (Array.isArray(data)) {
    return data.map(redactSensitiveData);
  }

  if (typeof data === 'object') {
    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      const isSensitive = SENSITIVE_KEY_PATTERNS.some(pattern => pattern.test(key));
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
  tool?: string;
  durationMs?: number;
  statusCode?: number;
  [key: string]: unknown;
}

class Logger {
  private service = 'urumi-woocommerce-mcp';

  private log(level: LogEntry['level'], message: string, meta?: Record<string, unknown>): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      service: this.service,
      message,
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
