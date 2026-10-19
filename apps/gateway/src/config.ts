import { z } from 'zod';

/**
 * Configuration schema for Urumi Team MCP Gateway.
 * 
 * Explicit Boundary Segregation:
 * - ACTIVELY ENFORCED IN GATE G3:
 *   - PORT (1024..65535, default 3000)
 *   - HOST (default 0.0.0.0)
 *   - NODE_ENV ('development' | 'production' | 'test', default 'production')
 *   - LOG_LEVEL ('debug' | 'info' | 'warn' | 'error', default 'info')
 *   - DEFAULT_UPSTREAM_TIMEOUT_MS (500..30000, default 10000 per ADR-011)
 *   - MAX_PAYLOAD_SIZE_BYTES (default 65536 / 64 KiB, enforced on HTTP body)
 *   - DRAIN_TIMEOUT_MS (500..15000, default 5000, enforced on SIGTERM drain)
 * 
 * - RESERVED & VALIDATED FOR LATER GATES (G4-G6):
 *   - DB_PATH (default '/data/gateway.db', reserved for G4 SQLite WAL storage)
 *   - MAX_RESULT_SIZE_BYTES (default 1048576 / 1 MiB, reserved for G6 router result cap)
 *   - GLOBAL_CONCURRENCY_LIMIT (default 20, reserved for G6 router global permit pool)
 *   - PER_UPSTREAM_CONCURRENCY_LIMIT (default 4, reserved for G6 router per-upstream pool)
 */
export const ConfigSchema = z.object({
  // === Actively Enforced in G3 ===
  PORT: z.coerce.number().int().min(1024, 'PORT must be at least 1024').max(65535, 'PORT must not exceed 65535').default(3000),
  HOST: z.string().min(1, 'HOST must not be empty').default('0.0.0.0'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  DEFAULT_UPSTREAM_TIMEOUT_MS: z.coerce.number().int()
    .min(500, 'DEFAULT_UPSTREAM_TIMEOUT_MS must be at least 500ms')
    .max(30000, 'DEFAULT_UPSTREAM_TIMEOUT_MS must not exceed 30000ms')
    .default(10000),
  MAX_PAYLOAD_SIZE_BYTES: z.coerce.number().int().positive('MAX_PAYLOAD_SIZE_BYTES must be positive').default(65536),
  DRAIN_TIMEOUT_MS: z.coerce.number().int().min(500).max(15000).default(5000),

  // === Reserved & Validated (G4-G6) ===
  DB_PATH: z.string().min(1, 'DB_PATH must not be empty').default('/data/gateway.db'),
  MAX_RESULT_SIZE_BYTES: z.coerce.number().int().positive('MAX_RESULT_SIZE_BYTES must be positive').default(1048576),
  GLOBAL_CONCURRENCY_LIMIT: z.coerce.number().int().positive('GLOBAL_CONCURRENCY_LIMIT must be positive').default(20),
  PER_UPSTREAM_CONCURRENCY_LIMIT: z.coerce.number().int().positive('PER_UPSTREAM_CONCURRENCY_LIMIT must be positive').default(4),

  // === Gate G7: Kubernetes Secret Lifecycle Configuration ===
  KUBERNETES_SECRETS_NAMESPACE: z.string()
    .min(1, 'KUBERNETES_SECRETS_NAMESPACE must not be empty')
    .max(63, 'KUBERNETES_SECRETS_NAMESPACE must not exceed 63 characters')
    .regex(/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/, 'KUBERNETES_SECRETS_NAMESPACE must be a valid RFC 1123 DNS label')
    .refine(
      (ns) => !['urumi', 'default', 'kube-system', 'kube-public', 'kube-node-lease'].includes(ns.toLowerCase()),
      'KUBERNETES_SECRETS_NAMESPACE cannot target core workload or cluster system namespaces (urumi, default, kube-system, kube-public, kube-node-lease)'
    )
    .default('urumi-gateway-secrets'),

  // === Phase 5: Browser Listener & Dashboard Configuration ===
  BROWSER_PORT: z.coerce.number().int().min(1024, 'BROWSER_PORT must be at least 1024').max(65535, 'BROWSER_PORT must not exceed 65535').default(3001),
  ALLOWED_ORIGINS: z.string().default('http://dashboard.127.0.0.1.nip.io:8080,http://localhost:3001,http://127.0.0.1:3001'),
  TRUSTED_PROXIES: z.string().default('127.0.0.1,::1,10.42.0.0/16,10.43.0.0/16'),
  COOKIE_SECURE: z.coerce.boolean().default(false),
  DASHBOARD_STATIC_PATH: z.string().default('/app/dist-dashboard'),
  KUBERNETES_API_URL: z.string().url('KUBERNETES_API_URL must be a valid URL')
    .refine(
      (url) => url.startsWith('https://'),
      'KUBERNETES_API_URL must use the HTTPS protocol'
    )
    .refine(
      (url) => {
        try {
          const parsed = new URL(url);
          return !parsed.username && !parsed.password;
        } catch {
          return false;
        }
      },
      'KUBERNETES_API_URL must not contain embedded userinfo credentials'
    )
    .refine(
      (url) => {
        try {
          const parsed = new URL(url);
          const hostname = parsed.hostname.toLowerCase();
          const allowedHosts = new Set([
            'kubernetes.default.svc',
            'kubernetes.default.svc.cluster.local',
            'kubernetes.default',
            'kubernetes',
            '10.43.0.1',
          ]);
          if (process.env.KUBERNETES_SERVICE_HOST) {
            allowedHosts.add(process.env.KUBERNETES_SERVICE_HOST.toLowerCase());
          }
          if (process.env.NODE_ENV !== 'production') {
            allowedHosts.add('localhost');
            allowedHosts.add('127.0.0.1');
            allowedHosts.add('::1');
          }
          return allowedHosts.has(hostname);
        } catch {
          return false;
        }
      },
      'KUBERNETES_API_URL destination must be an approved Kubernetes API server host (e.g. kubernetes.default.svc or 10.43.0.1)'
    )
    .optional(),
});

export type AppConfig = z.infer<typeof ConfigSchema>;

let cachedConfig: AppConfig | null = null;

/**
 * Pure parsing function that validates environment variables without exiting the process.
 * Throws ZodError on validation failure.
 */
export function parseConfig(rawEnv: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = ConfigSchema.safeParse(rawEnv);
  if (!result.success) {
    const errorDetails = result.error.errors
      .map((e) => `${e.path.join('.')}: ${e.message}`)
      .join(', ');
    throw new Error(`Configuration validation failed: ${errorDetails}`);
  }
  return Object.freeze(result.data);
}

/**
 * Loads and caches application configuration.
 * If exitOnError is true and validation fails, logs to stderr and terminates process.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env, exitOnError = false): AppConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  try {
    cachedConfig = parseConfig(env);
    return cachedConfig;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (exitOnError) {
      console.error(`[FATAL] ${message}`);
      process.exit(1);
    }
    throw err;
  }
}

/**
 * Resets configuration cache. Used in tests.
 */
export function resetConfigCache(): void {
  cachedConfig = null;
}
