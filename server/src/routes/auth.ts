import { Router } from 'express';
import { z } from 'zod';
import type { AppConfig } from '../config/index.js';
import type { Database } from '../db/connection.js';
import { authenticate } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { validateBody } from '../middleware/validate.js';
import { login } from '../services/authService.js';
import { getUser } from '../services/userService.js';
import { enterTenant } from '../tenancy/context.js';
import { StoreRegistry } from '../tenancy/registry.js';
import { InvalidRequestError, UnauthorizedError } from '../utils/errors.js';

const loginSchema = z.object({
  username: z.string().trim().min(1).max(32),
  password: z.string().min(1).max(128),
  /** Store code; required in multi-store mode. */
  store: z.string().trim().min(1).max(40).optional(),
});

export function authRouter(db: Database, config: AppConfig): Router {
  const router = Router();

  router.post('/login', rateLimit(config.loginRateLimit), validateBody(loginSchema), (req, res) => {
    const { username, password, store } = req.body as z.infer<typeof loginSchema>;
    const registry = req.app.get('registry') as StoreRegistry | undefined;
    let slug = 'default';
    if (registry) {
      if (!store)
        throw new InvalidRequestError('Store code is required', {
          store: ['Enter your store code'],
        });
      slug = StoreRegistry.validateSlug(store);
      if (!registry.exists(slug))
        throw new UnauthorizedError('Invalid store code, username or password');
      enterTenant({ slug, db: registry.openStore(slug) });
    }
    const result = login(db, config, username, password, slug);
    res.json(result);
  });

  router.get('/me', authenticate(db, config), (req, res) => {
    res.json({ user: getUser(db, req.user!.id) });
  });

  return router;
}
