import { Router } from 'express';
import type { AppConfig } from '../config/index.js';
import type { Database } from '../db/connection.js';
import { authenticate, authorize } from '../middleware/auth.js';
import {
  closeRegister,
  findOpenRegister,
  getRegister,
  listRegisters,
  openRegister,
  recordManualCash,
  registerStatus,
} from '../services/registerService.js';
import { ForbiddenError } from '../utils/errors.js';
import { parseId, parseOptionalInt } from '../utils/validation.js';

export function registersRouter(db: Database, config: AppConfig): Router {
  const router = Router();
  router.use(authenticate(db, config));

  /** Any role: can this user sell right now? */
  router.get('/status', (req, res) => {
    res.json({ status: registerStatus(db, req.user!) });
  });

  router.use(authorize('ADMIN', 'CASHIER'));

  router.get('/current', (req, res) => {
    res.json({ register: findOpenRegister(db, req.user!.id) });
  });

  router.get('/', (req, res) => {
    const user = req.user!;
    const userId = user.role === 'ADMIN' ? parseOptionalInt(req.query.userId, 'userId') : user.id;
    res.json({
      registers: listRegisters(db, { userId, limit: parseOptionalInt(req.query.limit, 'limit') }),
    });
  });

  router.get('/:id', (req, res) => {
    const register = getRegister(db, parseId(req.params.id));
    if (req.user!.role !== 'ADMIN' && register.userId !== req.user!.id) throw new ForbiddenError();
    res.json({ register });
  });

  router.post('/open', (req, res) => {
    res.status(201).json({ register: openRegister(db, req.user!, req.body) });
  });

  router.post('/close', (req, res) => {
    res.json({ register: closeRegister(db, req.user!, req.body) });
  });

  router.post('/cash-in', (req, res) => {
    res.status(201).json({ register: recordManualCash(db, req.user!, 'CASH_IN', req.body) });
  });

  router.post('/cash-out', (req, res) => {
    res.status(201).json({ register: recordManualCash(db, req.user!, 'CASH_OUT', req.body) });
  });

  return router;
}
