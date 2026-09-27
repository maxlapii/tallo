import { expect, test } from '@playwright/test';
import { login, USERS } from './helpers';

test.describe('E2E-01 Login', () => {
  test('cashier can log in and sees the dashboard', async ({ page }) => {
    await login(page, 'cashier');
    await expect(page).toHaveURL('/');
    await expect(page.getByTestId('current-user')).toContainText('Front Cashier');
  });

  test('wrong password shows an error and stays on login', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Store code').fill('demo');
    await page.getByLabel('Username').fill(USERS.cashier.username);
    await page.getByLabel('Password').fill('wrong-password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('alert')).toContainText('Invalid username or password');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('unauthenticated visit to a protected page redirects to login', async ({ page }) => {
    await page.goto('/products');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('session survives reload and logout returns to login', async ({ page }) => {
    await login(page, 'admin');
    await page.reload();
    await expect(page.getByTestId('dashboard-title')).toBeVisible();
    await page.getByRole('button', { name: 'Log out' }).click();
    await expect(page).toHaveURL(/\/login$/);
  });
});
