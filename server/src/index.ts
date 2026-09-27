import 'dotenv/config';
import { createApp } from './app.js';
import { loadConfig } from './config/index.js';
import { StoreRegistry } from './tenancy/registry.js';
import { createLogger } from './utils/logger.js';

const config = loadConfig();
const logger = createLogger(config.logLevel);

// One private SQLite file per store under DATA_DIR/stores; the directory
// database holds only store codes and names.
const registry = new StoreRegistry(config.dataDir);
logger.info(
  { dataDir: config.dataDir, stores: registry.list().length, signup: config.allowSignup },
  'Store registry ready',
);

const app = createApp({ registry, config, logger });
const server = app.listen(config.port, () => {
  logger.info({ port: config.port, env: config.nodeEnv }, 'POS server listening');
});

function shutdown(signal: string): void {
  logger.info({ signal }, 'Shutting down');
  server.close(() => {
    registry.closeAll();
    process.exit(0);
  });
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
