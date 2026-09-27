import { expect, test } from '@playwright/test';
import { ensureRegisterOpen, login, parseMoney } from './helpers';

test.describe('E2E-03 Sale', () => {
  test.beforeEach(async ({ request }) => {
    await ensureRegisterOpen(request, 'cashier');
  });

  test('search, add to cart, checkout with cash, receipt shows change', async ({ page }) => {
    await login(page, 'cashier');
    await page.getByTestId('nav-pos').click();
    await expect(page.getByTestId('product-grid')).toBeVisible();

    // Search by name
    await page.getByTestId('pos-search').fill('Coca');
    await expect(page.getByTestId('product-card-COKE-001')).toBeVisible();
    await expect(page.getByTestId('product-card-BURGER-001')).toHaveCount(0);
    await page.getByTestId('add-COKE-001').click();
    await page.getByTestId('add-COKE-001').click();

    // "Scan" a barcode: type it and press Enter
    await page.getByTestId('pos-search').fill('0490000000026');
    await page.getByTestId('pos-search').press('Enter');
    await expect(page.getByTestId('cart-item-BURGER-001')).toBeVisible();
    await expect(page.getByTestId('pos-search')).toHaveValue('');

    await expect(page.getByTestId('cart-subtotal')).toHaveText('$9.00');
    await page.getByTestId('cart-discount').fill('0.50');
    await expect(page.getByTestId('cart-tax')).toHaveText('$0.85');
    await expect(page.getByTestId('cart-total')).toHaveText('$9.35');

    await page.getByTestId('checkout-button').click();
    await expect(page.getByTestId('payment-modal')).toBeVisible();
    await expect(page.getByTestId('payment-due')).toHaveText('$9.35');
    await page.getByTestId('pay-amount-0').fill('10');
    await expect(page.getByTestId('payment-change')).toHaveText('$0.65');
    await page.getByTestId('confirm-payment').click();

    await expect(page.getByTestId('receipt-modal')).toBeVisible();
    await expect(page.getByTestId('receipt-total')).toHaveText('$9.35');
    await expect(page.getByTestId('receipt-change')).toHaveText('$0.65');
    const receiptNo = await page.getByTestId('receipt-no').textContent();
    expect(receiptNo).toMatch(/^\d{6}$/);
    expect(parseMoney(await page.getByTestId('receipt-total').textContent())).toBe(9.35);

    await page.getByTestId('new-sale').click();
    await expect(page.getByTestId('order-panel')).toContainText('Cart is empty');
  });

  test('card payment cannot exceed the total', async ({ page }) => {
    await login(page, 'cashier');
    await page.goto('/pos');
    await page.getByTestId('add-WATER-001').click();
    await page.getByTestId('checkout-button').click();
    await page.getByTestId('pay-method-card').click();
    await page.getByTestId('pay-amount-0').fill('5');
    await expect(page.getByTestId('confirm-payment')).toBeDisabled();
    await page.getByTestId('pay-amount-0').fill('1');
    await expect(page.getByTestId('confirm-payment')).toBeEnabled();
  });
});
