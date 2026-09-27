import { Router, type Request } from 'express';
import type { AppConfig } from '../config/index.js';
import type { Database } from '../db/connection.js';
import { authenticate, authorize } from '../middleware/auth.js';
import {
  dailySalesReport,
  inventoryReport,
  paymentSummaryReport,
  productSalesReport,
  todayUtc,
  type DateRange,
} from '../services/reportService.js';
import { InvalidRequestError } from '../utils/errors.js';
import { parseOptionalDate } from '../utils/validation.js';

function rangeFrom(req: Request): DateRange {
  const date = parseOptionalDate(req.query.date, 'date');
  const from = parseOptionalDate(req.query.from, 'from') ?? date ?? todayUtc();
  const to = parseOptionalDate(req.query.to, 'to') ?? date ?? from;
  if (to < from) throw new InvalidRequestError('"to" must not be before "from"');
  return { from, to };
}

export function reportsRouter(db: Database, config: AppConfig): Router {
  const router = Router();
  router.use(authenticate(db, config), authorize('ADMIN', 'CASHIER'));

  router.get('/daily', (req, res) => res.json({ report: dailySalesReport(db, rangeFrom(req)) }));
  router.get('/payments', (req, res) =>
    res.json({ report: paymentSummaryReport(db, rangeFrom(req)) }),
  );
  router.get('/products', (req, res) =>
    res.json({ report: productSalesReport(db, rangeFrom(req)) }),
  );
  router.get('/inventory', (_req, res) => res.json({ report: inventoryReport(db) }));

  return router;
}
