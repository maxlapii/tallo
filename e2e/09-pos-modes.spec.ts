import { expect, test } from '@playwright/test';
import { ensureRegisterOpen, login } from './helpers';

test.describe('E2E-09 POS full screen and customer display', () => {
  test('full screen toggle hides the app chrome and can be exited', async ({ page, request }) => {
    await ensureRegisterOpen(request, 'cashier');
    await login(page, 'cashier');
    await page.goto('/pos');
    await expect(page.locator('.sidebar')).toBeVisible();
    await page.getByTestId('fullscreen-toggle').click();
    await expect(page.locator('body')).toHaveClass(/pos-fullscreen/);
    await expect(page.locator('.sidebar')).toBeHidden();
    await expect(page.locator('.topbar')).toBeHidden();
    await expect(page.getByTestId('fullscreen-toggle')).toContainText('Exit');
    await page.getByTestId('fullscreen-toggle').click();
    await expect(page.locator('body')).not.toHaveClass(/pos-fullscreen/);
    await expect(page.locator('.sidebar')).toBeVisible();
  });

  test('sales role has full screen but no customer display', async ({ page, request }) => {
    await ensureRegisterOpen(request, 'cashier');
    await page.goto('/login');
    await page.getByLabel('Store code').fill('demo');
    await page.getByLabel('Username').fill('sale');
    await page.getByLabel('Password').fill('test-password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/pos$/);
    await expect(page.getByTestId('fullscreen-toggle')).toBeVisible();
    await expect(page.getByTestId('customer-display-toggle')).toHaveCount(0);
    await page.goto('/display');
    await expect(page).toHaveURL(/\/pos$/);
  });

  test('customer display mirrors the order and shows change after payment', async ({
    page,
    context,
    request,
  }) => {
    await ensureRegisterOpen(request, 'cashier');
    await login(page, 'cashier');
    await page.goto('/pos');

    // Open the customer display through the POS button (second window, same session).
    const [display] = await Promise.all([
      context.waitForEvent('page'),
      page.getByTestId('customer-display-toggle').click(),
    ]);
    await display.waitForLoadState();
    await expect(display).toHaveURL(/\/display$/);
    await expect(display.getByTestId('customer-display')).toHaveAttribute('data-mode', 'idle');
    await expect(display.getByRole('heading', { name: 'Welcome' })).toBeVisible();
    await expect(page.getByTestId('customer-display-toggle')).toContainText('Customer display on');

    await page.getByTestId('add-COKE-001').click();
    await page.getByTestId('add-COKE-001').click();
    await page.getByTestId('add-BURGER-001').click();
    await page.getByTestId('cart-discount').fill('0.50');
    await expect(display.getByTestId('customer-display')).toHaveAttribute('data-mode', 'order');
    await expect(display.getByTestId('cd-line')).toHaveCount(2);
    await expect(display.getByTestId('cd-line').first()).toContainText('Coca Cola');
    await expect(display.getByTestId('cd-line').first()).toContainText('2 ×');
    await expect(display.getByTestId('cd-total')).toHaveText('$9.35');

    await page.getByTestId('checkout-button').click();
    await page.getByTestId('pay-amount-0').fill('10');
    await page.getByTestId('confirm-payment').click();
    await expect(page.getByTestId('receipt-modal')).toBeVisible();
    await expect(display.getByTestId('customer-display')).toHaveAttribute('data-mode', 'paid');
    await expect(display.getByTestId('cd-change')).toHaveText('$0.65');
    await expect(display.getByText('Thank you!')).toBeVisible();

    // Starting the next sale returns the display to the welcome screen.
    await page.getByTestId('new-sale').click();
    await expect(display.getByTestId('customer-display')).toHaveAttribute('data-mode', 'idle');
    await display.close();
  });
});
