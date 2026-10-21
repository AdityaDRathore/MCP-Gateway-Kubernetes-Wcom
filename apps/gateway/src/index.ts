import { loadConfig } from './config.js';
import { createExpressApp, createBrowserApp } from './server.js';
import { LifecycleManager } from './lifecycle.js';
import { logger } from './logging/logger.js';
import { UserRepository } from './db/user-repo.js';
import { SessionRepository } from './db/session-repo.js';
import { ScryptPasswordService } from './auth/scrypt-password-service.js';
import { SessionService } from './auth/session-service.js';

// Load and validate environment configuration, failing fast on invalid values
const config = loadConfig(process.env, true);
logger.setLevel(config.LOG_LEVEL);

import { DatabaseManager } from './db/connection.js';
import { ApiKeyRepository } from './db/api-key-repo.js';
import { ApiKeyService } from './auth/api-key-service.js';
import { DatabaseAuthenticator } from './auth/database-authenticator.js';
import { InvitationRepository } from './db/invitation-repo.js';
import { InvitationService } from './auth/invitation-service.js';

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

import { UpstreamRepository } from './db/upstream-repo.js';
import { CatalogService } from './upstream/catalog-service.js';
import { UpstreamManager } from './upstream/upstream-manager.js';
import { AuditRepository } from './db/audit-repo.js';
import { AuditService } from './audit/audit-service.js';
import { ToolRouter } from './upstream/tool-router.js';

import { DirectKubernetesSecretClient } from './k8s/secret-client.js';
import { SecretManager } from './k8s/secret-manager.js';
import { AdminService } from './admin/admin-service.js';

// Instantiate SQLite-backed authentication
const apiKeyRepo = new ApiKeyRepository(dbManager.getDb());
const apiKeyService = new ApiKeyService(apiKeyRepo);
const authenticator = new DatabaseAuthenticator(apiKeyService);

// Instantiate Kubernetes Secret Manager
const secretClient = new DirectKubernetesSecretClient({
  apiUrl: config.KUBERNETES_API_URL,
  allowLocalhostForTesting: config.NODE_ENV !== 'production',
});
const secretManager = new SecretManager(secretClient, {
  namespace: config.KUBERNETES_SECRETS_NAMESPACE,
});

// Instantiate Upstream Manager & Dynamic Catalog
const upstreamRepo = new UpstreamRepository(dbManager.getDb());
const catalogService = new CatalogService();
const upstreamManager = new UpstreamManager(upstreamRepo, catalogService, {
  allowLocalhostForTesting: config.NODE_ENV !== 'production',
  credentialsResolver: (secretName) => secretManager.getSecretData(secretName),
});

// Instantiate Audit Service & Dynamic Tool Router
const auditRepo = new AuditRepository(dbManager.getDb());
const auditService = new AuditService(auditRepo);
const toolRouter = new ToolRouter(catalogService, upstreamManager, auditService, config);

const adminService = new AdminService(
  upstreamRepo,
  secretManager,
  upstreamManager,
  auditService,
  {
    allowLocalhostForTesting: config.NODE_ENV !== 'production',
  }
);

// Initialize upstreams and discover initial catalog
try {
  await upstreamManager.initialize();
} catch (err: unknown) {
  logger.warn('Initial upstream discovery encountered errors; continuing with partial catalog', {
    error: err instanceof Error ? err.message : String(err),
  });
}

// Run startup reconciliation for crashed provisioning, cleanup, and orphaned secrets
try {
  const recon = await adminService.runStartupReconciliation();
  logger.info('Completed startup reconciliation', recon);
} catch (err: unknown) {
  logger.warn('Startup reconciliation encountered errors', {
    error: err instanceof Error ? err.message : String(err),
  });
}

// Instantiate Browser Auth & Session Management
const userRepo = new UserRepository(dbManager.getDb());
const sessionRepo = new SessionRepository(dbManager.getDb());
const passwordService = new ScryptPasswordService();
const sessionService = new SessionService(sessionRepo, userRepo);
const invitationRepo = new InvitationRepository(dbManager.getDb());
const invitationService = new InvitationService(
  invitationRepo,
  userRepo,
  sessionService,
  passwordService,
  dbManager
);

const app = createExpressApp({
  config,
  authenticator,
  catalogService,
  toolRouter,
  adminService,
  readinessCheck: () => dbManager.isHealthy(),
});

const browserApp = createBrowserApp({
  config,
  sessionService,
  userRepo,
  passwordService,
  adminService,
  catalogService,
  invitationService,
  invitationRepo,
  apiKeyService,
  apiKeyRepo,
  dbManager,
  auditRepo,
  readinessCheck: () => dbManager.isHealthy(),
});

const mcpServer = app.listen(config.PORT, config.HOST, () => {
  logger.info(`Urumi Team MCP Gateway listening on http://${config.HOST}:${config.PORT}`, {
    port: config.PORT,
    host: config.HOST,
    nodeEnv: config.NODE_ENV,
    logLevel: config.LOG_LEVEL,
    dbPath: config.DB_PATH,
    upstreamTimeoutMs: config.DEFAULT_UPSTREAM_TIMEOUT_MS,
  });
});

const browserServer = browserApp.listen(config.BROWSER_PORT, config.HOST, () => {
  logger.info(`Urumi Dashboard & Browser API listening on http://${config.HOST}:${config.BROWSER_PORT}`, {
    port: config.BROWSER_PORT,
    host: config.HOST,
    allowedOrigins: config.ALLOWED_ORIGINS,
    cookieSecure: config.COOKIE_SECURE,
    dashboardStaticPath: config.DASHBOARD_STATIC_PATH,
  });
});

const lifecycle = new LifecycleManager([mcpServer, browserServer], config);
lifecycle.registerCleanupHook(() => {
  logger.info('Closing tool router during shutdown');
  toolRouter.close();
});
lifecycle.registerCleanupHook(async () => {
  logger.info('Closing upstream manager clients during shutdown');
  await upstreamManager.close();
});
lifecycle.registerCleanupHook(() => {
  logger.info('Closing SQLite database connection during shutdown');
  dbManager.close();
});
lifecycle.registerSignalHandlers();
