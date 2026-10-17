import { loadConfig } from './config.js';
import { createExpressApp } from './server.js';
import { LifecycleManager } from './lifecycle.js';
import { logger } from './logging/logger.js';

// Load and validate environment configuration, failing fast on invalid values
const config = loadConfig(process.env, true);
logger.setLevel(config.LOG_LEVEL);

import { DatabaseManager } from './db/connection.js';
import { ApiKeyRepository } from './db/api-key-repo.js';
import { ApiKeyService } from './auth/api-key-service.js';
import { DatabaseAuthenticator } from './auth/database-authenticator.js';

// Initialize SQLite database and run pending migrations
const dbManager = new DatabaseManager({
  dbPath: config.DB_PATH,
  autoMigrate: true,
});

try {
  dbManager.initialize();
} catch (err: unknown) {
  logger.error('Fatal error initializing SQLite database. Aborting startup.', {
    dbPath: config.DB_PATH,
    error: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
}

// Instantiate SQLite-backed authentication
const apiKeyRepo = new ApiKeyRepository(dbManager.getDb());
const apiKeyService = new ApiKeyService(apiKeyRepo);
const authenticator = new DatabaseAuthenticator(apiKeyService);

const app = createExpressApp({
  config,
  authenticator,
  readinessCheck: () => dbManager.isHealthy(),
});

const server = app.listen(config.PORT, config.HOST, () => {
  logger.info(`Urumi Team MCP Gateway listening on http://${config.HOST}:${config.PORT}`, {
    port: config.PORT,
    host: config.HOST,
    nodeEnv: config.NODE_ENV,
    logLevel: config.LOG_LEVEL,
    dbPath: config.DB_PATH,
    upstreamTimeoutMs: config.DEFAULT_UPSTREAM_TIMEOUT_MS,
  });
});

const lifecycle = new LifecycleManager(server, config);
lifecycle.registerCleanupHook(() => {
  logger.info('Closing SQLite database connection during shutdown');
  dbManager.close();
});
lifecycle.registerSignalHandlers();
