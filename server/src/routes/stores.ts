import { Router } from 'express';
import { z } from 'zod';
import type { AppConfig } from '../config/index.js';
import type { Database } from '../db/connection.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { validateBody } from '../middleware/validate.js';
import { login } from '../services/authService.js';
import { verifyPassword } from '../services/passwordService.js';
import type { UserRow } from '../services/types.js';
import { enterTenant } from '../tenancy/context.js';
import { StoreRegistry } from '../tenancy/registry.js';
import { ForbiddenError, InvalidRequestError, UnauthorizedError } from '../utils/errors.js';

const signupSchema = z.object({
  storeName: z.string().trim().min(2).max(80),
  storeCode: z.string().trim().min(3).max(32),
  adminUsername: z
    .string()
    .trim()
    .min(3)
    .max(32)
    .regex(
      /^[a-zA-Z0-9._-]+$/,
      'Username may only contain letters, numbers, dots, underscores, and hyphens',
    ),
  adminPassword: z.string().min(8).max(128),
  adminFullName: z.string().trim().min(1).max(100),
  demoData: z.boolean().optional(),
});

const confirmSchema = z.object({ password: z.string().min(1).max(128) });

function registryOf(req: { app: { get: (k: string) => unknown } }): StoreRegistry {
  const registry = req.app.get('registry') as StoreRegistry | undefined;
  if (!registry) throw new InvalidRequestError('This server runs in single-store mode');
  return registry;
}

/**
 * Self-serve stores. Anyone may create a store and gets a private database
 * with their own admin account; only that store's admins can rename, export,
 * or permanently delete it.
 */
export function storesRouter(db: Database, config: AppConfig): Router {
  const router = Router();

  /** Is a store code free? Returns only availability, never store details. */
  router.get('/check', (req, res) => {
    const registry = registryOf(req);
    const raw = typeof req.query.code === 'string' ? req.query.code : '';
    try {
      const slug = StoreRegistry.validateSlug(raw);
      res.json({ code: slug, available: !registry.exists(slug) });
    } catch (err) {
      res.json({ code: raw, available: false, reason: (err as Error).message });
    }
  });

  router.post(
    '/',
    rateLimit({ max: 5, windowMs: 60 * 60 * 1000 }),
    validateBody(signupSchema),
    (req, res) => {
      if (!config.allowSignup) throw new ForbiddenError('Store signup is disabled on this server');
      const registry = registryOf(req);
      const body = req.body as z.infer<typeof signupSchema>;
      const store = registry.createStore({
        slug: body.storeCode,
        name: body.storeName,
        admin: {
          username: body.adminUsername,
          password: body.adminPassword,
          fullName: body.adminFullName,
        },
        demoData: body.demoData ?? false,
      });
      enterTenant({ slug: store.slug, db: registry.openStore(store.slug) });
      const session = login(db, config, body.adminUsername, body.adminPassword, store.slug);
      res.status(201).json({ ...session, store: store.slug, storeName: store.name });
    },
  );

  router.use(authenticate(db, config));

  router.get('/current', (req, res) => {
    const registry = req.app.get('registry') as StoreRegistry | undefined;
    const slug = req.user!.store;
    const store = registry
      ? registry.find(slug)
      : { slug, name: config.storeName, active: true, createdAt: '' };
    res.json({ store, signupEnabled: Boolean(registry) && config.allowSignup });
  });

  router.put(
    '/current',
    authorize('ADMIN'),
    validateBody(z.object({ name: z.string().trim().min(2).max(80) })),
    (req, res) => {
      const registry = registryOf(req);
      res.json({ store: registry.rename(req.user!.store, (req.body as { name: string }).name) });
    },
  );

  /** Data portability: download the store's complete SQLite file. */
  router.get('/current/export', authorize('ADMIN'), (req, res) => {
    const registry = registryOf(req);
    const file = registry.checkpoint(req.user!.store);
    res.download(file, `${req.user!.store}-${new Date().toISOString().slice(0, 10)}.db`);
  });

  /** Right to erasure: permanently deletes the store and everything in it. */
  router.delete('/current', authorize('ADMIN'), validateBody(confirmSchema), (req, res) => {
    const registry = registryOf(req);
    const row = db.get<UserRow>('SELECT * FROM users WHERE id = ?', [req.user!.id]);
    if (!row || !verifyPassword((req.body as { password: string }).password, row.password_hash)) {
      throw new UnauthorizedError('Password confirmation failed');
    }
    registry.deleteStore(req.user!.store);
    res.json({ deleted: true });
  });

  return router;
}
