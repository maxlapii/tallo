import { Router } from 'express';
import type { AppConfig } from '../config/index.js';
import type { Database } from '../db/connection.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import {
  createUser,
  createUserSchema,
  getUser,
  listUsers,
  updateUser,
  type CreateUserInput,
} from '../services/userService.js';
import { InvalidRequestError } from '../utils/errors.js';

export function usersRouter(db: Database, config: AppConfig): Router {
  const router = Router();
  router.use(authenticate(db, config), authorize('ADMIN'));

  router.get('/', (_req, res) => {
    res.json({ users: listUsers(db) });
  });

  router.get('/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw new InvalidRequestError('Invalid user id');
    res.json({ user: getUser(db, id) });
  });

  router.put('/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw new InvalidRequestError('Invalid user id');
    res.json({ user: updateUser(db, req.user!, id, req.body) });
  });

  router.post('/', validateBody(createUserSchema), (req, res) => {
    const user = createUser(db, req.user!, req.body as CreateUserInput);
    res.status(201).json({ user });
  });

  return router;
}
