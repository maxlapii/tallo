import { expect, test } from '@playwright/test';
import { ensureRegisterOpen, login, stockOf } from './helpers';

test.describe('E2E-04 Inventory', () => {
  test('receive stock, sell product, verify stock decreased', async ({ page, request }) => {
    await ensureRegisterOpen(request, 'admin');
    await login(page, 'admin');

    // Create stock via a PURCHASE adjustment.
    await page.getByTestId('nav-stock').click();
    const before = await stockOf(request, 'CHIPS-001');
    await page.getByTestId('adjust-CHIPS-001').click();
    await page.getByTestId('adjust-type').selectOption('PURCHASE');
    await page.getByTestId('adjust-qty').fill('5');
    await page.getByTestId('adjust-submit').click();
    await expect(
      page.getByTestId('toast-success').filter({ hasText: 'stock is now' }),
    ).toContainText(`stock is now ${before + 5}`);
    await expect(page.getByTestId('stock-CHIPS-001')).toHaveText(String(before + 5));
    await expect(page.getByTestId('movements-table')).toContainText('PURCHASE');

    // Sell 3 units.
    await page.getByTestId('nav-pos').click();
    await page.getByTestId('add-CHIPS-001').click();
    await page.getByTestId('cart-qty-CHIPS-001').fill('3');
    await page.getByTestId('checkout-button').click();
    await page.getByTestId('pay-amount-0').fill('100');
    await page.getByTestId('confirm-payment').click();
    await expect(page.getByTestId('receipt-modal')).toBeVisible();
    await page.getByTestId('new-sale').click();

    // Verify stock decreased by 3 and a SALE movement exists.
    await page.getByTestId('nav-stock').click();
    await expect(page.getByTestId('stock-CHIPS-001')).toHaveText(String(before + 2));
    await expect(page.getByTestId('movements-table')).toContainText('SALE');
    expect(await stockOf(request, 'CHIPS-001')).toBe(before + 2);
  });

  test('POS blocks adding more than the available stock', async ({ page, request }) => {
    await ensureRegisterOpen(request, 'cashier');
    await login(page, 'cashier');
    await page.goto('/pos');
    const stock = await stockOf(request, 'FRIES-001');
    await page.getByTestId('add-FRIES-001').click();
    await page.getByTestId('cart-qty-FRIES-001').fill(String(stock + 5));
    await expect(page.getByTestId('toast-error')).toContainText(`Only ${stock}`);
    await expect(page.getByTestId('cart-qty-FRIES-001')).toHaveValue(String(stock));
  });
});
