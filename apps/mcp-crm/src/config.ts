import { z } from 'zod';

/**
 * Configuration schema for CRM mock service.
 * Enforces boundary checks, sensible defaults, and safety checks against accidental production failure injection.
 */
const ConfigSchema = z.object({
  PORT: z.coerce.number().int().min(1024).max(65535).default(3000),
  HOST: z.string().min(1).default('0.0.0.0'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  MOCK_DELAY_MS: z.coerce.number().int().min(0).max(30000).default(0),
  MOCK_FAIL_MODE: z.enum(['none', 'http-500', 'tool-error', 'timeout']).default('none'),
}).transform((cfg) => {
  // Guardrail: in production, failure injection is strictly disabled to prevent accidental misconfiguration
  if (cfg.NODE_ENV === 'production') {
    return {
      ...cfg,
      MOCK_DELAY_MS: 0,
      MOCK_FAIL_MODE: 'none' as const,
    };
  }
  return cfg;
});

export type AppConfig = z.infer<typeof ConfigSchema>;

let cachedConfig: AppConfig | null = null;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  const result = ConfigSchema.safeParse(env);
  if (!result.success) {
    const errorDetails = result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
    console.error(`[FATAL] Configuration validation failed: ${errorDetails}`);
    process.exit(1);
  }

  cachedConfig = Object.freeze(result.data);
  return cachedConfig;
}

export function resetConfigCache(): void {
  cachedConfig = null;
}
