/**
 * Captures the README screenshots against a running dev stack
 * (API on :3000, UI on :5173, demo store seeded). Usage: npm run docs:screenshots
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const API = 'http://localhost:3000';
const UI = 'http://localhost:5173';
const OUT = 'docs/screenshots';
const STORE = 'demo';
const PASSWORD = 'test-password';

mkdirSync(OUT, { recursive: true });

async function api(method, path, body, token) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${await res.text()}`);
  return res.json();
}

async function login(page, username) {
  await page.goto(`${UI}/login`);
  await page.getByLabel('Store code').fill(STORE);
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((u) => !u.pathname.endsWith('/login'));
}

async function settle(page, ms = 700) {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(ms);
}

const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.png` });

// ---- arrange data via the API ----
const cashierToken = (
  await api('POST', '/api/auth/login', { store: STORE, username: 'cashier', password: PASSWORD })
).token;
const status = await api('GET', '/api/registers/status', null, cashierToken);
if (!status.status.ownRegisterId)
  await api('POST', '/api/registers/open', { openingCash: 150 }, cashierToken);
const products = (await api('GET', '/api/products?limit=50', null, cashierToken)).products;
const id = (sku) => products.find((p) => p.sku === sku).id;
const orders = [
  {
    items: [
      { productId: id('BURGER-001'), quantity: 2 },
      { productId: id('FRIES-001'), quantity: 2 },
      { productId: id('COKE-001'), quantity: 2 },
    ],
    payments: [{ method: 'CASH', amount: 30 }],
    customerName: 'Table 4',
  },
  {
    items: [
      { productId: id('COFFEE-001'), quantity: 3 },
      { productId: id('CHIPS-001'), quantity: 1 },
    ],
    payments: [{ method: 'CARD', amount: 9.9 }],
  },
  {
    items: [
      { productId: id('WATER-001'), quantity: 4 },
      { productId: id('BURGER-001'), quantity: 1 },
    ],
    payments: [{ method: 'QR', amount: 9.5 }],
    customerName: 'Take away',
  },
];
for (const o of orders) await api('POST', '/api/sales', o, cashierToken);

const browser = await chromium.launch();
const desktop = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
});

// ---- signup (public) ----
{
  const page = await desktop.newPage();
  await page.goto(`${UI}/signup`);
  await page.getByTestId('signup-store-name').fill('Blue Fern Cafe');
  await page.getByTestId('signup-fullname').fill('Alex Rivera');
  await page.getByTestId('signup-username').fill('alex');
  await settle(page);
  await shot(page, 'signup');
  await page.close();
}

// ---- cashier: POS, payment, customer display, print station ----
{
  const page = await desktop.newPage();
  await login(page, 'cashier');
  await page.goto(`${UI}/pos`);
  await page.getByTestId('product-card-COKE-001').waitFor();
  await page.waitForTimeout(1500); // product photos
  await page.getByTestId('add-COKE-001').click();
  await page.getByTestId('add-COKE-001').click();
  await page.getByTestId('add-BURGER-001').click();
  await page.getByTestId('add-FRIES-001').click();
  await page.getByTestId('cart-discount').fill('1.00');
  await settle(page);
  await shot(page, 'pos');

  const display = await desktop.newPage();
  await display.goto(`${UI}/display`);
  await display.waitForTimeout(1200);
  await shot(display, 'customer-display');
  await display.close();

  await page.getByTestId('checkout-button').click();
  await page.getByTestId('pay-amount-0').fill('20');
  await settle(page, 400);
  await shot(page, 'payment');
  await page.getByTestId('confirm-payment').click();
  await page.getByTestId('receipt-modal').waitFor();
  await settle(page, 400);
  await shot(page, 'receipt');
  await page.getByTestId('new-sale').click();

  await page.goto(`${UI}/print-station`);
  await page.getByTestId('station-printer').selectOption({ label: 'Kitchen 1 · Kitchen 1' });
  await settle(page);
  const first = page.locator('[data-testid^="job-"]').first();
  if (await first.count()) await first.click();
  await settle(page, 400);
  await shot(page, 'print-station');
  await page.close();
}

// ---- admin: dashboard, printers, stock, reports, sales, shift, users, store ----
{
  // Fresh context: sessions live in localStorage, so a new context means a clean login.
  const adminCtx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });
  const page = await adminCtx.newPage();
  await login(page, 'admin');
  const adminToken = (
    await api('POST', '/api/auth/login', { store: STORE, username: 'admin', password: PASSWORD })
  ).token;
  const s = await api('GET', '/api/registers/status', null, adminToken);
  if (!s.status.ownRegisterId)
    await api('POST', '/api/registers/open', { openingCash: 200 }, adminToken);
  for (const [path, name] of [
    ['/', 'dashboard'],
    ['/printers', 'printers'],
    ['/inventory', 'stock'],
    ['/reports', 'reports'],
    ['/sales', 'sales'],
    ['/shift', 'shift'],
    ['/users', 'users'],
    ['/store', 'store'],
    ['/products', 'products'],
  ]) {
    await page.goto(`${UI}${path}`);
    await settle(page, path === '/products' ? 1500 : 800);
    await shot(page, name);
  }
  await adminCtx.close();
}

// ---- sales role on a phone ----
{
  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const page = await mobile.newPage();
  await page.goto(`${UI}/login`);
  await page.getByLabel('Store code').fill(STORE);
  await page.getByLabel('Username').fill('sale');
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/pos$/);
  await page.getByTestId('product-card-COKE-001').waitFor();
  await page.waitForTimeout(1500);
  await page.getByTestId('add-BURGER-001').click();
  await page.getByTestId('add-COKE-001').click();
  await settle(page);
  await shot(page, 'mobile-pos');
  await page.getByRole('button', { name: 'View order' }).click();
  await page.waitForTimeout(500);
  await shot(page, 'mobile-order');
  await mobile.close();
}

await browser.close();
console.log(`Screenshots written to ${OUT}/`);
