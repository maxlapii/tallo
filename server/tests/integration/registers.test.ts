import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listAuditLogs } from '../../src/services/auditService.js';
import { bearer, createTestApp, loginAs, productIdBySku, type TestContext } from '../helpers.js';

describe('/api/registers', () => {
  let ctx: TestContext;
  let cashier: string;
  let admin: string;
  beforeEach(async () => {
    ctx = createTestApp();
    cashier = await loginAs(ctx.app, 'cashier');
    admin = await loginAs(ctx.app, 'admin');
  });
  afterEach(() => ctx.db.close());

  it('opens a register with an opening float', async () => {
    const none = await request(ctx.app).get('/api/registers/current').set(bearer(cashier));
    expect(none.body.register).toBeNull();
    const res = await request(ctx.app)
      .post('/api/registers/open')
      .set(bearer(cashier))
      .send({ openingCash: 100 });
    expect(res.status).toBe(201);
    expect(res.body.register).toMatchObject({
      status: 'OPEN',
      openingCash: 100,
      userName: 'Front Cashier',
    });
    expect(res.body.register.summary).toMatchObject({
      openingCash: 100,
      expectedCash: 100,
      cashSales: 0,
      salesCount: 0,
    });
    expect(res.body.register.movements).toEqual([
      expect.objectContaining({ type: 'OPENING', amount: 100 }),
    ]);
    const current = await request(ctx.app).get('/api/registers/current').set(bearer(cashier));
    expect(current.body.register.id).toBe(res.body.register.id);
  });

  it('cannot open a duplicate register for the same user', async () => {
    await request(ctx.app)
      .post('/api/registers/open')
      .set(bearer(cashier))
      .send({ openingCash: 100 });
    const res = await request(ctx.app)
      .post('/api/registers/open')
      .set(bearer(cashier))
      .send({ openingCash: 50 });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/already have an open shift/);
  });

  it('cash sale affects expected cash; cash in/out; close with difference', async () => {
    await request(ctx.app)
      .post('/api/registers/open')
      .set(bearer(cashier))
      .send({ openingCash: 100 });
    const coke = productIdBySku(ctx.db, 'COKE-001');
    // 2 x 2.00 + 10% = 4.40, cash 10 -> change 5.60, net cash 4.40
    await request(ctx.app)
      .post('/api/sales')
      .set(bearer(cashier))
      .send({
        items: [{ productId: coke, quantity: 2 }],
        payments: [{ method: 'CASH', amount: 10 }],
      });
    // card sale must not affect cash
    await request(ctx.app)
      .post('/api/sales')
      .set(bearer(cashier))
      .send({
        items: [{ productId: coke, quantity: 1 }],
        payments: [{ method: 'CARD', amount: 2.2 }],
      });

    const cashIn = await request(ctx.app)
      .post('/api/registers/cash-in')
      .set(bearer(cashier))
      .send({ amount: 20, note: 'Float top-up' });
    expect(cashIn.status).toBe(201);
    const cashOut = await request(ctx.app)
      .post('/api/registers/cash-out')
      .set(bearer(cashier))
      .send({ amount: 15.5, note: 'Supplies' });
    expect(cashOut.status).toBe(201);
    expect(cashOut.body.register.summary).toMatchObject({
      openingCash: 100,
      cashSales: 4.4,
      cashIn: 20,
      cashOut: 15.5,
      expectedCash: 108.9,
      salesCount: 2,
      totalSales: 6.6,
    });

    const close = await request(ctx.app)
      .post('/api/registers/close')
      .set(bearer(cashier))
      .send({ actualCash: 108, note: 'End of shift' });
    expect(close.status).toBe(200);
    expect(close.body.register).toMatchObject({
      status: 'CLOSED',
      expectedCash: 108.9,
      actualCash: 108,
      difference: -0.9,
      note: 'End of shift',
    });
    expect(close.body.register.closedAt).toBeTruthy();
    expect(listAuditLogs(ctx.db, 'registers', close.body.register.id).map((l) => l.action)).toEqual(
      expect.arrayContaining([
        'REGISTER_OPEN',
        'REGISTER_CASH_IN',
        'REGISTER_CASH_OUT',
        'REGISTER_CLOSE',
      ]),
    );

    // After closing, no current register and sales are blocked.
    expect(
      (await request(ctx.app).get('/api/registers/current').set(bearer(cashier))).body.register,
    ).toBeNull();
    const blocked = await request(ctx.app)
      .post('/api/sales')
      .set(bearer(cashier))
      .send({
        items: [{ productId: coke, quantity: 1 }],
        payments: [{ method: 'CASH', amount: 5 }],
      });
    expect(blocked.body.error.code).toBe('REGISTER_NOT_OPEN');
    // A new register can be opened afterwards.
    expect(
      (
        await request(ctx.app)
          .post('/api/registers/open')
          .set(bearer(cashier))
          .send({ openingCash: 0 })
      ).status,
    ).toBe(201);
  });

  it('cash in/out/close require an open register', async () => {
    for (const path of ['cash-in', 'cash-out']) {
      const res = await request(ctx.app)
        .post(`/api/registers/${path}`)
        .set(bearer(cashier))
        .send({ amount: 5 });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('REGISTER_NOT_OPEN');
    }
    const close = await request(ctx.app)
      .post('/api/registers/close')
      .set(bearer(cashier))
      .send({ actualCash: 5 });
    expect(close.body.error.code).toBe('REGISTER_NOT_OPEN');
  });

  it('validates amounts', async () => {
    await request(ctx.app)
      .post('/api/registers/open')
      .set(bearer(cashier))
      .send({ openingCash: 10 });
    expect(
      (
        await request(ctx.app)
          .post('/api/registers/cash-in')
          .set(bearer(cashier))
          .send({ amount: 0 })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(ctx.app)
          .post('/api/registers/cash-out')
          .set(bearer(cashier))
          .send({ amount: -1 })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(ctx.app)
          .post('/api/registers/open')
          .set(bearer(admin))
          .send({ openingCash: -1 })
      ).status,
    ).toBe(400);
    expect(
      (await request(ctx.app).post('/api/registers/close').set(bearer(cashier)).send({})).status,
    ).toBe(400);
  });

  it('lists registers: cashier sees own, admin sees all and can fetch any', async () => {
    const mine = await request(ctx.app)
      .post('/api/registers/open')
      .set(bearer(cashier))
      .send({ openingCash: 10 });
    await request(ctx.app).post('/api/registers/open').set(bearer(admin)).send({ openingCash: 20 });
    const cashierList = await request(ctx.app).get('/api/registers').set(bearer(cashier));
    expect(cashierList.body.registers).toHaveLength(1);
    const adminList = await request(ctx.app).get('/api/registers').set(bearer(admin));
    expect(adminList.body.registers).toHaveLength(2);
    expect(
      (await request(ctx.app).get(`/api/registers/${mine.body.register.id}`).set(bearer(admin)))
        .status,
    ).toBe(200);
    const adminReg = adminList.body.registers.find(
      (r: { userName: string }) => r.userName === 'Store Admin',
    );
    expect(
      (await request(ctx.app).get(`/api/registers/${adminReg.id}`).set(bearer(cashier))).status,
    ).toBe(403);
    expect((await request(ctx.app).get('/api/registers/999').set(bearer(admin))).status).toBe(404);
  });
});
