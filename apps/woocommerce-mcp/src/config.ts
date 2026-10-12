import { z } from 'zod';

/**
 * Environment configuration schema for WooCommerce MCP server.
 * Enforces strict typing, defaults, and boundary constraints.
 */
const ConfigSchema = z.object({
  PORT: z.coerce.number().int().min(1024).max(65535).default(7777),
  HOST: z.string().min(1).default('0.0.0.0'),
  WOOCOMMERCE_BASE_URL: z.string().url().default('http://urumi-wordpress.urumi.svc.cluster.local:80'),
  WOOCOMMERCE_SITE_URL: z.string().url().default('http://shop.127.0.0.1.nip.io:8080'),
  WOOCOMMERCE_CONSUMER_KEY: z.string().min(1, 'WOOCOMMERCE_CONSUMER_KEY is required'),
  WOOCOMMERCE_CONSUMER_SECRET: z.string().min(1, 'WOOCOMMERCE_CONSUMER_SECRET is required'),
  UPSTREAM_HOST_HEADER: z.string().optional(),
  REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export type AppConfig = z.infer<typeof ConfigSchema>;

let cachedConfig: AppConfig | null = null;

/**
 * Loads, validates, and freezes application configuration.
 * Exits immediately if required secrets or URLs are missing or malformed.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  const result = ConfigSchema.safeParse(env);
  if (!result.success) {
    const errorDetails = result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
    console.error(`[FATAL] Configuration validation failed: ${errorDetails}`);
    console.error('[FATAL] Process exiting due to missing or invalid required configuration.');
    process.exit(1);
  }

  cachedConfig = Object.freeze(result.data);
  return cachedConfig;
}

/**
 * Reset config cache (useful for isolated unit testing).
 */
export function resetConfigCache(): void {
  cachedConfig = null;
}
