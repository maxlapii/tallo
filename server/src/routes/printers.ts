import { Router } from 'express';
import type { AppConfig } from '../config/index.js';
import type { Database } from '../db/connection.js';
import { authenticate, authorize } from '../middleware/auth.js';
import {
  createPrinter,
  deletePrinter,
  dispatchJob,
  getJob,
  getPrinter,
  listJobs,
  listPrinters,
  markJobPrinted,
  requeueJob,
  testPrinterConnection,
  updatePrinter,
  type JobStatus,
} from '../services/printService.js';
import { InvalidRequestError } from '../utils/errors.js';
import {
  parseId,
  parseOptionalBool,
  parseOptionalInt,
  parseOptionalString,
} from '../utils/validation.js';

const STATUSES: JobStatus[] = ['QUEUED', 'SENDING', 'PRINTED', 'FAILED'];

export function printersRouter(db: Database, config: AppConfig): Router {
  const router = Router();
  router.use(authenticate(db, config));

  router.get('/', (req, res) => {
    const includeInactive = parseOptionalBool(req.query.includeInactive) ?? false;
    res.json({ printers: listPrinters(db, includeInactive) });
  });

  router.get('/:id', (req, res) => {
    res.json({ printer: getPrinter(db, parseId(req.params.id)) });
  });

  router.post('/', authorize('ADMIN'), (req, res) => {
    res.status(201).json({ printer: createPrinter(db, req.user!, req.body) });
  });

  router.put('/:id', authorize('ADMIN'), (req, res) => {
    res.json({ printer: updatePrinter(db, req.user!, parseId(req.params.id), req.body) });
  });

  router.delete('/:id', authorize('ADMIN'), (req, res) => {
    res.json(deletePrinter(db, req.user!, parseId(req.params.id)));
  });

  router.post('/:id/test', authorize('ADMIN'), async (req, res) => {
    res.json(await testPrinterConnection(getPrinter(db, parseId(req.params.id))));
  });

  return router;
}

export function printJobsRouter(db: Database, config: AppConfig): Router {
  const router = Router();
  router.use(authenticate(db, config));

  router.get('/', (req, res) => {
    const status = parseOptionalString(req.query.status);
    if (status !== undefined && !STATUSES.includes(status as JobStatus))
      throw new InvalidRequestError('Invalid status');
    res.json({
      jobs: listJobs(db, {
        printerId: parseOptionalInt(req.query.printerId, 'printerId'),
        saleId: parseOptionalInt(req.query.saleId, 'saleId'),
        status: status as JobStatus | undefined,
        limit: parseOptionalInt(req.query.limit, 'limit'),
      }),
    });
  });

  router.get('/:id', (req, res) => {
    res.json({ job: getJob(db, parseId(req.params.id)) });
  });

  /** A print station confirms a browser job was printed. */
  router.post('/:id/printed', (req, res) => {
    res.json({ job: markJobPrinted(db, parseId(req.params.id)) });
  });

  /** Requeue a job and, for network printers, send it again. */
  router.post('/:id/retry', authorize('ADMIN', 'CASHIER'), async (req, res) => {
    const id = parseId(req.params.id);
    const job = requeueJob(db, id);
    res.json({ job: job.printerType === 'NETWORK' ? await dispatchJob(db, id) : job });
  });

  return router;
}
