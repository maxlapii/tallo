import { expect, test } from '@playwright/test';
import { login, uniqueSuffix } from './helpers';

test.describe('E2E-11 Private stores', () => {
  test('a visitor creates their own store, works in isolation, exports and deletes it', async ({
    page,
    request,
  }) => {
    const code = `trial-${uniqueSuffix()}`;
    await page.goto('/signup');
    await page.getByTestId('signup-store-name').fill('Trial Bakery');
    await page.getByTestId('signup-store-code').fill(code);
    await expect(page.getByTestId('signup-code-status')).toContainText('is available');
    await page.getByTestId('signup-fullname').fill('Pat Owner');
    await page.getByTestId('signup-username').fill('pat');
    await page.getByTestId('signup-password').fill('bakery-secret-1');
    await page.getByTestId('signup-submit').click();

    // Lands in the new store as admin; the demo store's data is nowhere to be seen.
    await expect(page.getByTestId('dashboard-title')).toBeVisible();
    await expect(page.getByTestId('current-user')).toContainText('Pat Owner');
    await expect(page.getByTestId('current-user')).toContainText(code);
    await page.goto('/sales');
    await expect(page.getByTestId('empty-state')).toBeVisible();
    await page.goto('/users');
    await expect(page.getByTestId('users-table')).toContainText('pat');
    await expect(page.getByTestId('users-table')).not.toContainText('cashier');

    // Sample catalogue was loaded, so the POS works immediately after opening a shift.
    await page.goto('/pos');
    await expect(page.getByTestId('product-card-COKE-001')).toBeVisible();

    // The demo store cannot log in with this store's admin, and vice versa.
    const cross = await request.post('http://localhost:3000/api/auth/login', {
      data: { store: 'demo', username: 'pat', password: 'bakery-secret-1' },
    });
    expect(cross.status()).toBe(401);
    const crossBack = await request.post('http://localhost:3000/api/auth/login', {
      data: { store: code, username: 'admin', password: 'test-password' },
    });
    expect(crossBack.status()).toBe(401);

    // Export, then delete with password confirmation.
    await page.goto('/store');
    await expect(page.getByTestId('store-code')).toHaveText(code);
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('store-export').click(),
    ]);
    expect(download.suggestedFilename()).toContain(code);
    await page.getByTestId('store-delete').click();
    await page.getByTestId('delete-confirm-code').fill(code);
    await page.getByTestId('delete-password').fill('bakery-secret-1');
    await page.getByTestId('delete-store-submit').click();
    await expect(page).toHaveURL(/\/signup$/);
    const gone = await request.get(`http://localhost:3000/api/stores/check?code=${code}`);
    expect((await gone.json()).available).toBe(true);
  });

  test('login requires the store code and the demo store still works', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Store code').fill('no-such-store');
    await page.getByLabel('Username').fill('admin');
    await page.getByLabel('Password').fill('test-password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('alert')).toContainText('Invalid store code, username or password');
    await login(page, 'admin');
    await expect(page.getByTestId('current-user')).toContainText('demo');
  });
});
