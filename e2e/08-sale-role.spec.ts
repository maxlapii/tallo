import { expect, test } from '@playwright/test';
import { ensureRegisterOpen, login, stockOf, USERS } from './helpers';

test.describe('E2E-08 SALE role and real-time updates', () => {
  test('sales account sees only POS and its own orders and can place an order', async ({
    page,
    request,
  }) => {
    await ensureRegisterOpen(request, 'cashier');
    await page.goto('/login');
    await page.getByLabel('Store code').fill('demo');
    await page.getByLabel('Username').fill('sale');
    await page.getByLabel('Password').fill(USERS.cashier.password);
    await page.getByRole('button', { name: 'Sign in' }).click();

    // Lands on the POS, with a restricted navigation.
    await expect(page).toHaveURL(/\/pos$/);
    await expect(page.getByTestId('nav-pos')).toBeVisible();
    await expect(page.getByTestId('nav-history')).toContainText('My orders');
    await expect(page.getByTestId('nav-register')).toHaveCount(0);
    await expect(page.getByTestId('nav-reports')).toHaveCount(0);
    await expect(page.getByTestId('nav-products')).toHaveCount(0);
    await expect(page.getByTestId('nav-stock')).toHaveCount(0);
    await expect(page.getByTestId('live-indicator')).toContainText('Live');

    // Guarded routes bounce back to the POS.
    await page.goto('/shift');
    await expect(page).toHaveURL(/\/pos$/);
    await page.goto('/inventory');
    await expect(page).toHaveURL(/\/pos$/);

    // Place an order (booked against the cashier's open register).
    await page.getByTestId('add-WATER-001').click();
    await page.getByTestId('checkout-button').click();
    await page.getByTestId('pay-amount-0').fill('5');
    await page.getByTestId('confirm-payment').click();
    await expect(page.getByTestId('receipt-modal')).toBeVisible();
    const receiptNo = (await page.getByTestId('receipt-no').textContent())!;
    await page.getByTestId('new-sale').click();

    await page.getByTestId('nav-history').click();
    await expect(page.getByRole('heading', { name: 'My orders' })).toBeVisible();
    await expect(page.getByTestId(`sale-row-${receiptNo}`)).toBeVisible();
    // Cannot refund: no refund button on its own order.
    await page.getByTestId(`sale-row-${receiptNo}`).click();
    await expect(page.getByTestId('sale-title')).toContainText(receiptNo);
    await expect(page.getByTestId('refund-button')).toHaveCount(0);
  });

  test('an order placed on one device updates stock and the order feed on another device without reload', async ({
    browser,
    request,
  }) => {
    await ensureRegisterOpen(request, 'cashier');
    const before = await stockOf(request, 'CHIPS-001');

    const cashierCtx = await browser.newContext();
    const saleCtx = await browser.newContext();
    const cashierPage = await cashierCtx.newPage();
    const salePage = await saleCtx.newPage();

    await login(cashierPage, 'cashier');
    await cashierPage.goto('/pos');
    await expect(cashierPage.getByTestId('product-card-CHIPS-001')).toBeVisible();
    await expect(cashierPage.getByTestId('live-indicator')).toContainText('Live');

    await salePage.goto('/login');
    await salePage.getByLabel('Store code').fill('demo');
    await salePage.getByLabel('Username').fill('sale');
    await salePage.getByLabel('Password').fill(USERS.cashier.password);
    await salePage.getByRole('button', { name: 'Sign in' }).click();
    await expect(salePage).toHaveURL(/\/pos$/);
    await salePage.getByTestId('add-CHIPS-001').click();
    await salePage.getByTestId('cart-qty-CHIPS-001').fill('3');
    await salePage.getByTestId('checkout-button').click();
    await salePage.getByTestId('pay-amount-0').fill('20');
    await salePage.getByTestId('confirm-payment').click();
    await expect(salePage.getByTestId('receipt-modal')).toBeVisible();
    const receiptNo = (await salePage.getByTestId('receipt-no').textContent())!;

    // The cashier's POS reflects the new stock and gets an order notification, with no reload.
    await expect(cashierPage.getByTestId('product-card-CHIPS-001')).toContainText(
      before - 3 <= 10 ? 'Low' : 'Available',
    );
    await expect(cashierPage.getByTestId('toast-info')).toContainText(`New order #${receiptNo}`);
    const shown = await cashierPage.evaluate(async () => {
      const token = localStorage.getItem('pos.token');
      const res = await fetch('/api/products/lookup?code=CHIPS-001', {
        headers: { Authorization: `Bearer ${token}` },
      });
      return (await res.json()).product.stockQty as number;
    });
    expect(shown).toBe(before - 3);
    // Adding beyond the live stock is blocked using the pushed value.
    await cashierPage.getByTestId('add-CHIPS-001').click();
    await cashierPage.getByTestId('cart-qty-CHIPS-001').fill(String(before));
    await expect(cashierPage.getByTestId('toast-error')).toContainText(`Only ${before - 3}`);

    await cashierCtx.close();
    await saleCtx.close();
  });
});
