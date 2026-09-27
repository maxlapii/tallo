import { Router } from 'express';
import type { AppConfig } from '../config/index.js';
import type { Database } from '../db/connection.js';
import { authenticate, authorize } from '../middleware/auth.js';
import {
  createProduct,
  deleteProduct,
  getProduct,
  listProducts,
  lookupProductByCode,
  updateProduct,
} from '../services/productService.js';
import { InvalidRequestError } from '../utils/errors.js';
import {
  parseId,
  parseOptionalBool,
  parseOptionalInt,
  parseOptionalString,
} from '../utils/validation.js';

export function productsRouter(db: Database, config: AppConfig): Router {
  const router = Router();
  router.use(authenticate(db, config));

  router.get('/', (req, res) => {
    res.json(
      listProducts(db, {
        q: parseOptionalString(req.query.q),
        categoryId: parseOptionalInt(req.query.categoryId, 'categoryId'),
        active: parseOptionalBool(req.query.active),
        lowStock: parseOptionalBool(req.query.lowStock),
        limit: parseOptionalInt(req.query.limit, 'limit'),
        offset: parseOptionalInt(req.query.offset, 'offset'),
      }),
    );
  });

  /** Exact barcode/SKU lookup for scanners: GET /api/products/lookup?code=... */
  router.get('/lookup', (req, res) => {
    const code = parseOptionalString(req.query.code);
    if (!code) throw new InvalidRequestError('code is required');
    res.json({ product: lookupProductByCode(db, code) });
  });

  router.get('/:id', (req, res) => {
    res.json({ product: getProduct(db, parseId(req.params.id)) });
  });

  router.post('/', authorize('ADMIN'), (req, res) => {
    res.status(201).json({ product: createProduct(db, req.user!, req.body) });
  });

  router.put('/:id', authorize('ADMIN'), (req, res) => {
    res.json({ product: updateProduct(db, req.user!, parseId(req.params.id), req.body) });
  });

  router.delete('/:id', authorize('ADMIN'), (req, res) => {
    res.json(deleteProduct(db, req.user!, parseId(req.params.id)));
  });

  return router;
}
