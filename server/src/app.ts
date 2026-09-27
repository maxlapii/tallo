import express, { type Express } from 'express';
import type { AppConfig } from './config/index.js';
import type { Database } from './db/connection.js';
import { ContextDatabase } from './tenancy/context.js';
import type { StoreRegistry } from './tenancy/registry.js';
import { storesRouter } from './routes/stores.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { requestLogger } from './middleware/requestLogger.js';
import { authRouter } from './routes/auth.js';
import { categoriesRouter } from './routes/categories.js';
import { eventsRouter } from './routes/events.js';
import { healthRouter } from './routes/health.js';
import { inventoryRouter } from './routes/inventory.js';
import { printersRouter, printJobsRouter } from './routes/printers.js';
import { productsRouter } from './routes/products.js';
import { registersRouter } from './routes/registers.js';
import { reportsRouter } from './routes/reports.js';
import { salesRouter } from './routes/sales.js';
import { usersRouter } from './routes/users.js';
import type { Logger } from './utils/logger.js';

export interface AppDeps {
  /** Single-store mode (tests, embedded use). Ignored when `registry` is given. */
  db?: Database;
  /** Multi-store mode: one private database per store, chosen per request. */
  registry?: StoreRegistry;
  config: AppConfig;
  logger: Logger;
}

/**
 * Builds the Express application. Dependencies are injected so tests can run
 * the full HTTP stack against an in-memory database.
 */
export function createApp({ db: singleDb, registry, config, logger }: AppDeps): Express {
  const db: Database | undefined = registry ? new ContextDatabase() : singleDb;
  if (!db) throw new Error('createApp needs a db or a store registry');
  const app = express();
  if (registry) app.set('registry', registry);
  app.disable('x-powered-by');
  app.set('trust proxy', false);
  app.use(express.json({ limit: '100kb' }));
  app.use(requestLogger(logger));

  app.use('/api/health', healthRouter(db));
  app.use('/api/auth', authRouter(db, config));
  app.use('/api/stores', storesRouter(db, config));
  app.use('/api/users', usersRouter(db, config));
  app.use('/api/categories', categoriesRouter(db, config));
  app.use('/api/products', productsRouter(db, config));
  app.use('/api/inventory', inventoryRouter(db, config));
  app.use('/api/sales', salesRouter(db, config));
  app.use('/api/registers', registersRouter(db, config));
  app.use('/api/reports', reportsRouter(db, config));
  app.use('/api/events', eventsRouter(db, config));
  app.use('/api/printers', printersRouter(db, config));
  app.use('/api/print-jobs', printJobsRouter(db, config));

  app.use('/api', notFoundHandler);
  app.use(errorHandler(logger));
  return app;
}
