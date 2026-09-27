import { expect, type APIRequestContext, type Page } from '@playwright/test';

export const API = 'http://localhost:3000';

export const STORE = 'demo';

export const USERS = {
  admin: { username: 'admin', password: 'test-password' },
  cashier: { username: 'cashier', password: 'test-password' },
} as const;

export async function login(page: Page, user: keyof typeof USERS = 'cashier'): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Store code').fill(STORE);
  await page.getByLabel('Username').fill(USERS[user].username);
  await page.getByLabel('Password').fill(USERS[user].password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByTestId('dashboard-title')).toBeVisible();
}

/** API helpers used to arrange state quickly (the UI is exercised in the specs themselves). */
export async function apiToken(
  request: APIRequestContext,
  user: keyof typeof USERS = 'cashier',
): Promise<string> {
  const res = await request.post(`${API}/api/auth/login`, {
    data: { ...USERS[user], store: STORE },
  });
  expect(res.ok()).toBeTruthy();
  return (await res.json()).token as string;
}

export async function ensureRegisterOpen(
  request: APIRequestContext,
  user: keyof typeof USERS = 'cashier',
  openingCash = 100,
): Promise<void> {
  const token = await apiToken(request, user);
  const headers = { Authorization: `Bearer ${token}` };
  const cur = await request.get(`${API}/api/registers/current`, { headers });
  if ((await cur.json()).register === null) {
    const res = await request.post(`${API}/api/registers/open`, { headers, data: { openingCash } });
    expect(res.status()).toBe(201);
  }
}

export async function ensureRegisterClosed(
  request: APIRequestContext,
  user: keyof typeof USERS = 'cashier',
): Promise<void> {
  const token = await apiToken(request, user);
  const headers = { Authorization: `Bearer ${token}` };
  const cur = await request.get(`${API}/api/registers/current`, { headers });
  const reg = (await cur.json()).register;
  if (reg) {
    await request.post(`${API}/api/registers/close`, {
      headers,
      data: { actualCash: reg.summary.expectedCash },
    });
  }
}

export async function stockOf(request: APIRequestContext, sku: string): Promise<number> {
  const token = await apiToken(request, 'admin');
  const res = await request.get(`${API}/api/products/lookup?code=${sku}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return (await res.json()).product.stockQty as number;
}

export function uniqueSuffix(): string {
  return `${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
}

export function parseMoney(text: string | null): number {
  return Number((text ?? '0').replace(/[^0-9.-]/g, ''));
}
