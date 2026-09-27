import { Router } from 'express';
import type { AppConfig } from '../config/index.js';
import type { Database } from '../db/connection.js';
import { eventBus, type ScopedEvent } from '../realtime/eventBus.js';
import { enterTenant } from '../tenancy/context.js';
import type { StoreRegistry } from '../tenancy/registry.js';
import { requireActiveUser, verifyToken } from '../services/authService.js';
import { UnauthorizedError } from '../utils/errors.js';

/**
 * Server-Sent Events stream. `EventSource` cannot set headers, so the bearer
 * token is passed as `?token=`; the request logger redacts it.
 */
export function eventsRouter(db: Database, config: AppConfig): Router {
  const router = Router();

  router.get('/', (req, res) => {
    const header = req.headers.authorization;
    const token =
      typeof req.query.token === 'string'
        ? req.query.token
        : header?.startsWith('Bearer ')
          ? header.slice(7)
          : '';
    if (!token) throw new UnauthorizedError('Missing token');
    const decoded = verifyToken(config, token);
    const registry = req.app.get('registry') as StoreRegistry | undefined;
    if (registry) enterTenant({ slug: decoded.store, db: registry.openStore(decoded.store) });
    const user = requireActiveUser(db, decoded);

    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const send = (type: string, data: unknown) => {
      res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    send('connected', { userId: user.id, role: user.role, at: new Date().toISOString() });

    const unsubscribe = eventBus.subscribe((event: ScopedEvent) => {
      if (event.store === user.store) send(event.type, event.payload);
    });
    const ping = setInterval(() => res.write(': ping\n\n'), 25_000);

    req.on('close', () => {
      clearInterval(ping);
      unsubscribe();
    });
  });

  return router;
}
