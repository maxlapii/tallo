import { z } from 'zod';
import { fromCents, toCents } from '@tallo/shared';
import type { Database } from '../db/connection.js';
import { AppError, ConflictError, ErrorCodes, NotFoundError } from '../utils/errors.js';
import { moneySchema, parseBody } from '../utils/validation.js';
import { eventBus } from '../realtime/eventBus.js';
import { recordAudit } from './auditService.js';
import type { AuthUser } from './types.js';

export type RegisterStatus = 'OPEN' | 'CLOSED';
export type CashMovementType = 'OPENING' | 'SALE' | 'REFUND' | 'CASH_IN' | 'CASH_OUT';

interface RegisterRow {
  id: number;
  user_id: number;
  user_name?: string;
  status: RegisterStatus;
  opening_cash_cents: number;
  expected_cash_cents: number | null;
  actual_cash_cents: number | null;
  difference_cents: number | null;
  opened_at: string;
  closed_at: string | null;
  note: string | null;
}

interface CashMovementRow {
  id: number;
  register_id: number;
  type: CashMovementType;
  amount_cents: number;
  reference_type: string | null;
  reference_id: number | null;
  note: string | null;
  user_id: number | null;
  created_at: string;
}

export interface CashMovement {
  id: number;
  registerId: number;
  type: CashMovementType;
  amount: number;
  referenceType: string | null;
  referenceId: number | null;
  note: string | null;
  userId: number | null;
  createdAt: string;
}

export interface RegisterSummary {
  openingCash: number;
  cashSales: number;
  cashRefunds: number;
  cashIn: number;
  cashOut: number;
  expectedCash: number;
  salesCount: number;
  totalSales: number;
}

export interface Register {
  id: number;
  userId: number;
  userName: string;
  status: RegisterStatus;
  openingCash: number;
  expectedCash: number | null;
  actualCash: number | null;
  difference: number | null;
  openedAt: string;
  closedAt: string | null;
  note: string | null;
  summary: RegisterSummary;
  movements: CashMovement[];
}

export class RegisterNotOpenError extends AppError {
  constructor(message = 'No open shift for this user. Open a shift before making sales.') {
    super(ErrorCodes.REGISTER_NOT_OPEN, message, 409);
  }
}

const SELECT = `SELECT r.*, u.full_name AS user_name FROM registers r JOIN users u ON u.id = r.user_id`;

function toCashMovement(row: CashMovementRow): CashMovement {
  return {
    id: row.id,
    registerId: row.register_id,
    type: row.type,
    amount: fromCents(row.amount_cents),
    referenceType: row.reference_type,
    referenceId: row.reference_id,
    note: row.note,
    userId: row.user_id,
    createdAt: row.created_at,
  };
}

/** Expected cash is always computed from cash movements, never from a running counter. */
export function computeSummary(db: Database, registerId: number): RegisterSummary {
  const sums = db.get<{
    opening: number;
    sale: number;
    refund: number;
    cash_in: number;
    cash_out: number;
  }>(
    `SELECT
       COALESCE(SUM(CASE WHEN type = 'OPENING'  THEN amount_cents END), 0) AS opening,
       COALESCE(SUM(CASE WHEN type = 'SALE'     THEN amount_cents END), 0) AS sale,
       COALESCE(SUM(CASE WHEN type = 'REFUND'   THEN amount_cents END), 0) AS refund,
       COALESCE(SUM(CASE WHEN type = 'CASH_IN'  THEN amount_cents END), 0) AS cash_in,
       COALESCE(SUM(CASE WHEN type = 'CASH_OUT' THEN amount_cents END), 0) AS cash_out
     FROM cash_movements WHERE register_id = ?`,
    [registerId],
  )!;
  const sales = db.get<{ n: number; total: number }>(
    'SELECT COUNT(*) AS n, COALESCE(SUM(total_cents), 0) AS total FROM sales WHERE register_id = ?',
    [registerId],
  )!;
  const expected = sums.opening + sums.sale + sums.refund + sums.cash_in + sums.cash_out;
  return {
    openingCash: fromCents(sums.opening),
    cashSales: fromCents(sums.sale),
    cashRefunds: fromCents(-sums.refund),
    cashIn: fromCents(sums.cash_in),
    cashOut: fromCents(-sums.cash_out),
    expectedCash: fromCents(expected),
    salesCount: sales.n,
    totalSales: fromCents(sales.total),
  };
}

function toRegister(db: Database, row: RegisterRow): Register {
  const movements = db
    .all<CashMovementRow>('SELECT * FROM cash_movements WHERE register_id = ? ORDER BY id', [
      row.id,
    ])
    .map(toCashMovement);
  return {
    id: row.id,
    userId: row.user_id,
    userName: row.user_name ?? '',
    status: row.status,
    openingCash: fromCents(row.opening_cash_cents),
    expectedCash: row.expected_cash_cents === null ? null : fromCents(row.expected_cash_cents),
    actualCash: row.actual_cash_cents === null ? null : fromCents(row.actual_cash_cents),
    difference: row.difference_cents === null ? null : fromCents(row.difference_cents),
    openedAt: row.opened_at,
    closedAt: row.closed_at,
    note: row.note,
    summary: computeSummary(db, row.id),
    movements,
  };
}

export function getRegister(db: Database, id: number): Register {
  const row = db.get<RegisterRow>(`${SELECT} WHERE r.id = ?`, [id]);
  if (!row) throw new NotFoundError('Shift not found');
  return toRegister(db, row);
}

export function findOpenRegister(db: Database, userId: number): Register | null {
  const row = db.get<RegisterRow>(`${SELECT} WHERE r.user_id = ? AND r.status = 'OPEN'`, [userId]);
  return row ? toRegister(db, row) : null;
}

/** Returns the id of the user's open register or throws REGISTER_NOT_OPEN. */
export function requireOpenRegisterId(db: Database, userId: number): number {
  const row = db.get<{ id: number }>(
    "SELECT id FROM registers WHERE user_id = ? AND status = 'OPEN'",
    [userId],
  );
  if (!row) throw new RegisterNotOpenError();
  return row.id;
}

/**
 * Resolves the register a sale is booked against.
 * - ADMIN/CASHIER: their own open register (they run a cash drawer).
 * - SALE (handheld order-takers): the store's most recently opened register, so
 *   their cash lands in the drawer a cashier is responsible for.
 */
export function resolveRegisterForSale(db: Database, actor: AuthUser): number {
  if (actor.role !== 'SALE') return requireOpenRegisterId(db, actor.id);
  const row = db.get<{ id: number }>(
    "SELECT id FROM registers WHERE status = 'OPEN' ORDER BY opened_at DESC, id DESC LIMIT 1",
  );
  if (!row) {
    throw new RegisterNotOpenError(
      'No shift is open. Ask a cashier to open a shift before placing orders.',
    );
  }
  return row.id;
}

export interface SellStatus {
  canSell: boolean;
  reason: string | null;
  ownRegisterId: number | null;
  openRegisters: number;
}

/** Lightweight "can this user sell right now?" check used by the POS screen (all roles). */
export function registerStatus(db: Database, actor: AuthUser): SellStatus {
  const openRegisters = db.get<{ n: number }>(
    "SELECT COUNT(*) AS n FROM registers WHERE status = 'OPEN'",
  )!.n;
  const own = db.get<{ id: number }>(
    "SELECT id FROM registers WHERE user_id = ? AND status = 'OPEN'",
    [actor.id],
  );
  if (actor.role === 'SALE') {
    return {
      canSell: openRegisters > 0,
      reason:
        openRegisters > 0
          ? null
          : 'No shift is open. Ask a cashier to open a shift before placing orders.',
      ownRegisterId: null,
      openRegisters,
    };
  }
  return {
    canSell: Boolean(own),
    reason: own ? null : 'No shift is open. Open a shift before taking payments.',
    ownRegisterId: own?.id ?? null,
    openRegisters,
  };
}

function emitRegisterChanged(register: Register): Register {
  eventBus.broadcast({
    type: 'register.changed',
    payload: { registerId: register.id, userId: register.userId, status: register.status },
  });
  return register;
}

export function listRegisters(
  db: Database,
  filter: { userId?: number | undefined; limit?: number | undefined } = {},
): Register[] {
  const where: string[] = [];
  const params: number[] = [];
  if (filter.userId !== undefined) {
    where.push('r.user_id = ?');
    params.push(filter.userId);
  }
  const whereSql = where.length ? ` WHERE ${where.join(' AND ')}` : '';
  const limit = Math.min(Math.max(filter.limit ?? 50, 1), 500);
  return db
    .all<RegisterRow>(`${SELECT}${whereSql} ORDER BY r.id DESC LIMIT ?`, [...params, limit])
    .map((r) => toRegister(db, r));
}

export const openRegisterSchema = z.object({
  openingCash: moneySchema,
  note: z.string().trim().max(200).optional(),
});

export function openRegister(db: Database, actor: AuthUser, input: unknown): Register {
  const data = parseBody(openRegisterSchema, input);
  return emitRegisterChanged(
    db.transaction(() => {
      if (findOpenRegister(db, actor.id)) {
        throw new ConflictError(ErrorCodes.INVALID_REQUEST, 'You already have an open shift');
      }
      const r = db.run(
        `INSERT INTO registers (user_id, status, opening_cash_cents, note) VALUES (?, 'OPEN', ?, ?)`,
        [actor.id, toCents(data.openingCash), data.note ?? null],
      );
      const id = r.lastInsertRowid;
      if (data.openingCash > 0) {
        db.run(
          `INSERT INTO cash_movements (register_id, type, amount_cents, note, user_id) VALUES (?, 'OPENING', ?, 'Opening float', ?)`,
          [id, toCents(data.openingCash), actor.id],
        );
      }
      recordAudit(db, {
        userId: actor.id,
        action: 'REGISTER_OPEN',
        entity: 'registers',
        entityId: id,
        details: { openingCash: data.openingCash },
      });
      return getRegister(db, id);
    }),
  );
}

export const cashMovementSchema = z.object({
  amount: moneySchema.refine((v) => v > 0, 'Amount must be greater than zero'),
  note: z.string().trim().max(200).optional(),
});

/** Records a manual cash in/out on the actor's open register. */
export function recordManualCash(
  db: Database,
  actor: AuthUser,
  type: 'CASH_IN' | 'CASH_OUT',
  input: unknown,
): Register {
  const data = parseBody(cashMovementSchema, input);
  return emitRegisterChanged(
    db.transaction(() => {
      const registerId = requireOpenRegisterId(db, actor.id);
      const cents = toCents(data.amount);
      db.run(
        `INSERT INTO cash_movements (register_id, type, amount_cents, note, user_id) VALUES (?, ?, ?, ?, ?)`,
        [registerId, type, type === 'CASH_IN' ? cents : -cents, data.note ?? null, actor.id],
      );
      recordAudit(db, {
        userId: actor.id,
        action: `REGISTER_${type}`,
        entity: 'registers',
        entityId: registerId,
        details: { amount: data.amount, note: data.note },
      });
      return getRegister(db, registerId);
    }),
  );
}

/** Called by checkout/refund inside their transaction to track cash in the drawer. */
export function recordSaleCash(
  db: Database,
  registerId: number,
  type: 'SALE' | 'REFUND',
  amountCents: number,
  referenceId: number,
  userId: number,
): void {
  if (!db.inTransaction) throw new Error('recordSaleCash must run inside a transaction');
  if (amountCents === 0) return;
  db.run(
    `INSERT INTO cash_movements (register_id, type, amount_cents, reference_type, reference_id, user_id) VALUES (?, ?, ?, ?, ?, ?)`,
    [registerId, type, type === 'SALE' ? amountCents : -amountCents, type, referenceId, userId],
  );
}

export const closeRegisterSchema = z.object({
  actualCash: moneySchema,
  note: z.string().trim().max(200).optional(),
});

export function closeRegister(db: Database, actor: AuthUser, input: unknown): Register {
  const data = parseBody(closeRegisterSchema, input);
  return emitRegisterChanged(
    db.transaction(() => {
      const registerId = requireOpenRegisterId(db, actor.id);
      const summary = computeSummary(db, registerId);
      const expected = toCents(summary.expectedCash);
      const actual = toCents(data.actualCash);
      db.run(
        `UPDATE registers SET status = 'CLOSED', expected_cash_cents = ?, actual_cash_cents = ?, difference_cents = ?,
         closed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), note = COALESCE(?, note)
       WHERE id = ?`,
        [expected, actual, actual - expected, data.note ?? null, registerId],
      );
      recordAudit(db, {
        userId: actor.id,
        action: 'REGISTER_CLOSE',
        entity: 'registers',
        entityId: registerId,
        details: {
          expectedCash: summary.expectedCash,
          actualCash: data.actualCash,
          difference: fromCents(actual - expected),
        },
      });
      return getRegister(db, registerId);
    }),
  );
}
