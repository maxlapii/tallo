import { Router } from 'express';
import type { AppConfig } from '../config/index.js';
import type { Database } from '../db/connection.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { createCategory, listCategories, updateCategory } from '../services/categoryService.js';
import { parseId, parseOptionalBool } from '../utils/validation.js';

export function categoriesRouter(db: Database, config: AppConfig): Router {
  const router = Router();
  router.use(authenticate(db, config));

  router.get('/', (req, res) => {
    const includeInactive = parseOptionalBool(req.query.includeInactive) ?? false;
    res.json({ categories: listCategories(db, includeInactive) });
  });

  router.post('/', authorize('ADMIN'), (req, res) => {
    res.status(201).json({ category: createCategory(db, req.body) });
  });

  router.put('/:id', authorize('ADMIN'), (req, res) => {
    res.json({ category: updateCategory(db, parseId(req.params.id), req.body) });
  });

  return router;
}
