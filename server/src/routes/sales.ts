import { Router } from 'express';
import { PaymentMethods, type PaymentMethod } from '@tallo/shared';
import type { AppConfig } from '../config/index.js';
import type { Database } from '../db/connection.js';
import { authenticate, authorize } from '../middleware/auth.js';
import {
  dispatchQueuedNetworkJobs,
  enqueueJobsForSale,
  getJob as getJobSafe,
  type JobKind,
} from '../services/printService.js';
import { refundSale } from '../services/refundService.js';
import {
  createSale,
  getReceipt,
  getSale,
  listSales,
  type SaleStatus,
} from '../services/salesService.js';
import { ForbiddenError, InvalidRequestError } from '../utils/errors.js';
import {
  parseId,
  parseOptionalDate,
  parseOptionalInt,
  parseOptionalString,
} from '../utils/validation.js';

const STATUSES: SaleStatus[] = ['COMPLETED', 'PARTIALLY_REFUNDED', 'REFUNDED'];

export function salesRouter(db: Database, config: AppConfig): Router {
  const router = Router();
  router.use(authenticate(db, config));

  router.post('/', (req, res) => {
    res
      .status(201)
      .json({ sale: createSale(db, req.user!, req.body, { storeName: config.storeName }) });
  });

  router.get('/', (req, res) => {
    const paymentMethod = parseOptionalString(req.query.paymentMethod);
    if (paymentMethod !== undefined && !PaymentMethods.includes(paymentMethod as PaymentMethod)) {
      throw new InvalidRequestError('Invalid payment method');
    }
    const status = parseOptionalString(req.query.status);
    if (status !== undefined && !STATUSES.includes(status as SaleStatus)) {
      throw new InvalidRequestError('Invalid status');
    }
    res.json(
      listSales(db, {
        from: parseOptionalDate(req.query.from, 'from'),
        to: parseOptionalDate(req.query.to, 'to'),
        receiptNo: parseOptionalString(req.query.receiptNo),
        cashierId:
          req.user!.role === 'SALE'
            ? req.user!.id
            : parseOptionalInt(req.query.cashierId, 'cashierId'),
        paymentMethod: paymentMethod as PaymentMethod | undefined,
        status: status as SaleStatus | undefined,
        limit: parseOptionalInt(req.query.limit, 'limit'),
        offset: parseOptionalInt(req.query.offset, 'offset'),
      }),
    );
  });

  router.get('/:id', (req, res) => {
    const sale = getSale(db, parseId(req.params.id));
    if (req.user!.role === 'SALE' && sale.cashierId !== req.user!.id) throw new ForbiddenError();
    res.json({ sale });
  });

  router.get('/:id/receipt', (req, res) => {
    const id = parseId(req.params.id);
    if (req.user!.role === 'SALE' && getSale(db, id).cashierId !== req.user!.id)
      throw new ForbiddenError();
    res.json({ receipt: getReceipt(db, config.storeName, id) });
  });

  /** Reprint the receipt and/or kitchen tickets for a sale. */
  router.post('/:id/print', authorize('ADMIN', 'CASHIER'), async (req, res) => {
    const id = parseId(req.params.id);
    const body = (req.body ?? {}) as { kinds?: unknown };
    const kinds = Array.isArray(body.kinds)
      ? (body.kinds.filter((k) => k === 'RECEIPT' || k === 'TICKET') as JobKind[])
      : undefined;
    const jobs = enqueueJobsForSale(db, config.storeName, id, {
      reprint: true,
      ...(kinds && kinds.length ? { kinds } : {}),
    });
    if (jobs.some((j) => j.printerType === 'NETWORK')) await dispatchQueuedNetworkJobs(db);
    res.status(201).json({ jobs: jobs.map((j) => getJobSafe(db, j.id)) });
  });

  router.post('/:id/refund', authorize('ADMIN', 'CASHIER'), (req, res) => {
    res.status(201).json(refundSale(db, req.user!, parseId(req.params.id), req.body));
  });

  return router;
}
