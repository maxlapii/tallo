import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eventBus, type LiveEvent } from '../../src/realtime/eventBus.js';
import {
  bearer,
  createTestApp,
  loginAs,
  openRegisterFor,
  productIdBySku,
  type TestContext,
} from '../helpers.js';

/** Reads SSE events from a fetch response body until `count` events arrive. */
async function readEvents(
  res: Response,
  count: number,
  timeoutMs = 5000,
): Promise<{ type: string; data: unknown }[]> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  const events: { type: string; data: unknown }[] = [];
  let buffer = '';
  const deadline = Date.now() + timeoutMs;
  while (events.length < count && Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf('\n\n')) >= 0) {
      const chunk = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      if (chunk.startsWith(':')) continue;
      const type = /^event: (.+)$/m.exec(chunk)?.[1] ?? 'message';
      const data = /^data: (.+)$/m.exec(chunk)?.[1];
      events.push({ type, data: data ? JSON.parse(data) : null });
    }
  }
  await reader.cancel();
  return events;
}

describe('event bus', () => {
  let ctx: TestContext;
  let cashier: string;
  beforeEach(async () => {
    ctx = createTestApp();
    cashier = await loginAs(ctx.app, 'cashier');
  });
  afterEach(() => ctx.db.close());

  it('broadcasts sale.created and stock.changed after a committed checkout', async () => {
    await openRegisterFor(ctx.app, cashier, 10);
    const coke = productIdBySku(ctx.db, 'COKE-001');
    const received: LiveEvent[] = [];
    const unsubscribe = eventBus.subscribe((e) => received.push(e));
    try {
      const res = await request(ctx.app)
        .post('/api/sales')
        .set(bearer(cashier))
        .send({
          items: [{ productId: coke, quantity: 3 }],
          payments: [{ method: 'CASH', amount: 10 }],
        });
      expect(res.status).toBe(201);
    } finally {
      unsubscribe();
    }
    const types = received.map((e) => e.type);
    expect(types).toContain('sale.created');
    expect(types).toContain('stock.changed');
    const sale = received.find((e) => e.type === 'sale.created')!;
    expect(sale.payload).toMatchObject({
      receiptNo: '000001',
      total: 6.6,
      cashierName: 'Front Cashier',
      itemCount: 3,
    });
    const stock = received.find((e) => e.type === 'stock.changed')!;
    expect(stock.payload).toEqual({
      products: [{ productId: coke, sku: 'COKE-001', stockQty: 97 }],
    });
  });

  it('does not broadcast when the checkout is rejected', async () => {
    const coke = productIdBySku(ctx.db, 'COKE-001');
    const received: LiveEvent[] = [];
    const unsubscribe = eventBus.subscribe((e) => received.push(e));
    try {
      const res = await request(ctx.app)
        .post('/api/sales')
        .set(bearer(cashier))
        .send({
          items: [{ productId: coke, quantity: 1 }],
          payments: [{ method: 'CASH', amount: 5 }],
        });
      expect(res.status).toBe(409); // no register
    } finally {
      unsubscribe();
    }
    expect(received).toEqual([]);
  });

  it('broadcasts stock.changed on manual adjustments and refund.created on refunds', async () => {
    const admin = await loginAs(ctx.app, 'admin');
    await openRegisterFor(ctx.app, cashier, 10);
    const coke = productIdBySku(ctx.db, 'COKE-001');
    const received: LiveEvent[] = [];
    const unsubscribe = eventBus.subscribe((e) => received.push(e));
    try {
      await request(ctx.app)
        .post('/api/inventory/adjust')
        .set(bearer(admin))
        .send({ productId: coke, type: 'PURCHASE', quantity: 5 });
      const sale = await request(ctx.app)
        .post('/api/sales')
        .set(bearer(cashier))
        .send({
          items: [{ productId: coke, quantity: 1 }],
          payments: [{ method: 'CASH', amount: 5 }],
        });
      await request(ctx.app)
        .post(`/api/sales/${sale.body.sale.id}/refund`)
        .set(bearer(cashier))
        .send({
          items: [{ saleItemId: sale.body.sale.items[0].id, quantity: 1 }],
          refundMethod: 'CASH',
        });
    } finally {
      unsubscribe();
    }
    const stockEvents = received.filter((e) => e.type === 'stock.changed');
    expect(stockEvents[0]!.payload).toEqual({
      products: [{ productId: coke, sku: 'COKE-001', stockQty: 105 }],
    });
    expect(stockEvents.at(-1)!.payload).toEqual({
      products: [{ productId: coke, sku: 'COKE-001', stockQty: 105 }],
    });
    expect(received.some((e) => e.type === 'refund.created')).toBe(true);
  });
});

describe('GET /api/events (SSE)', () => {
  let ctx: TestContext;
  let server: ReturnType<TestContext['app']['listen']>;
  let base: string;
  beforeEach(async () => {
    ctx = createTestApp();
    await new Promise<void>((resolve) => {
      server = ctx.app.listen(0, '127.0.0.1', () => resolve());
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    ctx.db.close();
  });

  it('rejects missing or invalid tokens', async () => {
    expect((await fetch(`${base}/api/events`)).status).toBe(401);
    expect((await fetch(`${base}/api/events?token=nope`)).status).toBe(401);
  });

  it('streams a connected event and then live sale events to every connected device', async () => {
    const cashier = await loginAs(ctx.app, 'cashier');
    const sale = await loginAs(ctx.app, 'sale');
    await openRegisterFor(ctx.app, cashier, 10);

    const device1 = await fetch(`${base}/api/events?token=${encodeURIComponent(sale)}`);
    const device2 = await fetch(`${base}/api/events`, {
      headers: { Authorization: `Bearer ${cashier}` },
    });
    expect(device1.status).toBe(200);
    expect(device1.headers.get('content-type')).toContain('text/event-stream');

    const coke = productIdBySku(ctx.db, 'COKE-001');
    // Give the streams a moment to register their subscribers, then place an order from a handheld.
    await new Promise((r) => setTimeout(r, 100));
    const placed = await fetch(`${base}/api/sales`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sale}` },
      body: JSON.stringify({
        items: [{ productId: coke, quantity: 2 }],
        payments: [{ method: 'CASH', amount: 5 }],
      }),
    });
    expect(placed.status).toBe(201);

    const [e1, e2] = await Promise.all([readEvents(device1, 3), readEvents(device2, 3)]);
    for (const events of [e1, e2]) {
      expect(events[0]).toMatchObject({ type: 'connected' });
      const types = events.map((e) => e.type);
      expect(types).toContain('sale.created');
      expect(types).toContain('stock.changed');
      const stock = events.find((e) => e.type === 'stock.changed')!.data as {
        products: { stockQty: number }[];
      };
      expect(stock.products[0]!.stockQty).toBe(98);
    }
    expect((e1[0]!.data as { role: string }).role).toBe('SALE');
  });
});
