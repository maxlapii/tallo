import { Router } from 'express';
import type { AppConfig } from '../config/index.js';
import type { Database } from '../db/connection.js';
import { authenticate, authorize } from '../middleware/auth.js';
import {
  adjustStock,
  getInventory,
  listMovements,
  MovementTypes,
  type MovementType,
} from '../services/inventoryService.js';
import { InvalidRequestError } from '../utils/errors.js';
import { parseOptionalBool, parseOptionalInt, parseOptionalString } from '../utils/validation.js';

export function inventoryRouter(db: Database, config: AppConfig): Router {
  const router = Router();
  router.use(authenticate(db, config), authorize('ADMIN', 'CASHIER'));

  router.get('/', (req, res) => {
    res.json(
      getInventory(db, {
        q: parseOptionalString(req.query.q),
        categoryId: parseOptionalInt(req.query.categoryId, 'categoryId'),
        active: parseOptionalBool(req.query.active),
        lowStock: parseOptionalBool(req.query.lowStock),
        limit: parseOptionalInt(req.query.limit, 'limit'),
        offset: parseOptionalInt(req.query.offset, 'offset'),
      }),
    );
  });

  router.get('/movements', (req, res) => {
    const type = parseOptionalString(req.query.type);
    if (type !== undefined && !MovementTypes.includes(type as MovementType)) {
      throw new InvalidRequestError('Invalid movement type');
    }
    res.json({
      movements: listMovements(db, {
        productId: parseOptionalInt(req.query.productId, 'productId'),
        type: type as MovementType | undefined,
        limit: parseOptionalInt(req.query.limit, 'limit'),
      }),
    });
  });

  router.post('/adjust', authorize('ADMIN'), (req, res) => {
    res.status(201).json({ movement: adjustStock(db, req.user!, req.body) });
  });

  return router;
}
