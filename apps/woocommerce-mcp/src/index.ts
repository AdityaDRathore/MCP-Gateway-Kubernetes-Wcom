import { loadConfig } from './config.js';
import { createExpressApp } from './server.js';
import { logger } from './logging/logger.js';

const config = loadConfig();
const app = createExpressApp(config);

const server = app.listen(config.PORT, config.HOST, () => {
  logger.info('Urumi WooCommerce MCP Server listening', {
    port: config.PORT,
    host: config.HOST,
    transport: 'Streamable HTTP',
    nodeEnv: config.NODE_ENV,
    apiPrefix: '/wp-json/wc/v3',
  });
});

// Graceful shutdown handling for Kubernetes pod termination
function handleShutdown(signal: string) {
  logger.info(`Received ${signal}. Starting graceful shutdown...`);
  server.close((err) => {
    if (err) {
      logger.error('Error closing HTTP server during shutdown', { error: err.message });
      process.exit(1);
    }
    logger.info('HTTP server closed cleanly. Exiting.');
    process.exit(0);
  });

  // Force exit if shutdown hangs beyond 10 seconds
  setTimeout(() => {
    logger.error('Graceful shutdown timed out. Forcing process termination.');
    process.exit(1);
  }, 10000).unref();
}

process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));
