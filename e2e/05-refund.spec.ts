import { expect, test } from '@playwright/test';
import { ensureRegisterOpen, login, stockOf } from './helpers';

test.describe('E2E-05 Refund', () => {
  test('create sale, open it from history, refund one item, verify inventory increased', async ({
    page,
    request,
  }) => {
    await ensureRegisterOpen(request, 'cashier');
    await login(page, 'cashier');
    const before = await stockOf(request, 'COFFEE-001');

    await page.goto('/pos');
    await page.getByTestId('add-COFFEE-001').click();
    await page.getByTestId('add-COFFEE-001').click();
    await page.getByTestId('checkout-button').click();
    await page.getByTestId('pay-amount-0').fill('20');
    await page.getByTestId('confirm-payment').click();
    await expect(page.getByTestId('receipt-modal')).toBeVisible();
    const receiptNo = (await page.getByTestId('receipt-no').textContent())!;
    await page.getByTestId('new-sale').click();
    expect(await stockOf(request, 'COFFEE-001')).toBe(before - 2);

    await page.getByTestId('nav-history').click();
    await page.getByTestId('filter-receipt').fill(receiptNo);
    await page.getByTestId('apply-filters').click();
    await page.getByTestId(`sale-row-${receiptNo}`).click();
    await expect(page.getByTestId('sale-title')).toContainText(receiptNo);

    await page.getByTestId('refund-button').click();
    await expect(page.getByTestId('refund-modal')).toBeVisible();
    await page.getByTestId('refund-qty-COFFEE-001').fill('1');
    await page.getByTestId('refund-method').selectOption('CASH');
    await page.getByTestId('refund-submit').click();
    await expect(page.getByTestId('toast-success').filter({ hasText: 'Refunded' })).toContainText(
      'Refunded $2.75',
    );
    await expect(page.getByTestId('sale-refunds')).toContainText('1 × Coffee');
    await expect(page.getByTestId('sale-title')).toBeVisible();
    await expect(page.getByText('Partially Refunded')).toBeVisible();

    expect(await stockOf(request, 'COFFEE-001')).toBe(before - 1);

    // Cannot refund more than remaining.
    await page.getByTestId('refund-button').click();
    await page.getByTestId('refund-qty-COFFEE-001').fill('5');
    await expect(page.getByTestId('refund-qty-COFFEE-001')).toHaveValue('1');
  });
});
