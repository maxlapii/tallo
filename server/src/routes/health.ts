import { Router } from 'express';
import type { Database } from '../db/connection.js';
import type { StoreRegistry } from '../tenancy/registry.js';

export function healthRouter(db: Database): Router {
  const router = Router();
  router.get('/', (req, res) => {
    const registry = req.app.get('registry') as StoreRegistry | undefined;
    let ok: boolean;
    let stores: number | undefined;
    try {
      if (registry) {
        stores = registry.list().length;
        ok = true;
      } else {
        ok = db.get<{ ok: number }>('SELECT 1 AS ok')?.ok === 1;
      }
    } catch {
      ok = false;
    }
    res.status(ok ? 200 : 503).json({
      status: ok ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      ...(stores !== undefined ? { stores } : {}),
    });
  });
  return router;
}
