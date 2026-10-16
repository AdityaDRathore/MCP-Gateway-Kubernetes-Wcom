import { loadConfig } from './config.js';
import { createExpressApp } from './server.js';
import { FailClosedAuthenticator } from './auth/authenticator.js';
import { LifecycleManager } from './lifecycle.js';
import { logger } from './logging/logger.js';

// Load and validate environment configuration, failing fast on invalid values
const config = loadConfig(process.env, true);
logger.setLevel(config.LOG_LEVEL);

/**
 * Gate G3 Non-Negotiable Invariant:
 * Production startup explicitly instantiates FailClosedAuthenticator.
 * No environment switch, mock flag, or auth-bypass exists.
 */
const authenticator = new FailClosedAuthenticator();

const app = createExpressApp({
  config,
  authenticator,
  readinessCheck: () => true,
});

const server = app.listen(config.PORT, config.HOST, () => {
  logger.info(`Urumi Team MCP Gateway listening on http://${config.HOST}:${config.PORT}`, {
    port: config.PORT,
    host: config.HOST,
    nodeEnv: config.NODE_ENV,
    logLevel: config.LOG_LEVEL,
    upstreamTimeoutMs: config.DEFAULT_UPSTREAM_TIMEOUT_MS,
  });
});

const lifecycle = new LifecycleManager(server, config);
lifecycle.registerSignalHandlers();
