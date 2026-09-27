import { expect, test } from '@playwright/test';
import { ensureRegisterClosed, login, parseMoney, stockOf } from './helpers';

/**
 * MVP completion scenario (CLAUDE.md §28), automated end to end through the UI.
 */
test('MVP smoke: login → register → sale → receipt → history → refund → report → close', async ({
  page,
  request,
}) => {
  await ensureRegisterClosed(request, 'cashier');
  const cokeBefore = await stockOf(request, 'COKE-001');
  const burgerBefore = await stockOf(request, 'BURGER-001');

  // 1. Login as cashier
  await login(page, 'cashier');

  // 2. Open register
  await page.getByTestId('nav-register').click();
  await page.getByTestId('open-register').click();
  await page.getByTestId('register-amount').fill('100');
  await page.getByTestId('register-submit').click();
  await expect(page.getByTestId('stat-expected-cash')).toContainText('$100.00');

  // 3-4. Search/scan and add 2 products
  await page.getByTestId('nav-pos').click();
  await page.getByTestId('pos-search').fill('COKE-001');
  await page.getByTestId('pos-search').press('Enter');
  await page.getByTestId('pos-search').fill('0490000000026');
  await page.getByTestId('pos-search').press('Enter');
  await expect(page.getByTestId('cart-item-COKE-001')).toBeVisible();
  await expect(page.getByTestId('cart-item-BURGER-001')).toBeVisible();

  // 5. Change quantity
  await page.getByTestId('cart-qty-COKE-001').fill('2');
  await expect(page.getByTestId('cart-subtotal')).toHaveText('$9.00');

  // 6-7. Apply discount, tax is calculated
  await page.getByTestId('cart-discount').fill('0.50');
  await expect(page.getByTestId('cart-tax')).toHaveText('$0.85');
  await expect(page.getByTestId('cart-total')).toHaveText('$9.35');

  // 8-11. Checkout, cash, change, complete
  await page.getByTestId('checkout-button').click();
  await page.getByTestId('pay-amount-0').fill('10');
  await expect(page.getByTestId('payment-change')).toHaveText('$0.65');
  await page.getByTestId('confirm-payment').click();

  // 12. Receipt
  await expect(page.getByTestId('receipt-modal')).toBeVisible();
  const receiptNo = (await page.getByTestId('receipt-no').textContent())!;
  await expect(page.getByTestId('receipt-total')).toHaveText('$9.35');
  await expect(page.getByTestId('receipt-change')).toHaveText('$0.65');
  await page.getByTestId('new-sale').click();

  // 13. Sale in history
  await page.getByTestId('nav-history').click();
  await expect(page.getByTestId(`sale-row-${receiptNo}`)).toContainText('$9.35');

  // 14. Inventory decreased
  expect(await stockOf(request, 'COKE-001')).toBe(cokeBefore - 2);
  expect(await stockOf(request, 'BURGER-001')).toBe(burgerBefore - 1);

  // 15. Refund one item (burger)
  await page.getByTestId(`sale-row-${receiptNo}`).click();
  await page.getByTestId('refund-button').click();
  await page.getByTestId('refund-qty-BURGER-001').fill('1');
  await page.getByTestId('refund-submit').click();
  await expect(page.getByTestId('toast-success').filter({ hasText: 'Refunded' })).toBeVisible();

  // 16. Inventory increased
  expect(await stockOf(request, 'BURGER-001')).toBe(burgerBefore);

  // 17. Refund appears in history
  await expect(page.getByTestId('sale-refunds')).toContainText('1 × Burger');
  await page.getByTestId('nav-history').click();
  await expect(page.getByTestId(`sale-row-${receiptNo}`)).toContainText('Partially Refunded');

  // 18. Daily sales report
  await page.getByTestId('nav-reports').click();
  await expect(page.getByTestId('daily-report')).toBeVisible();
  expect(
    parseMoney(await page.getByTestId('report-net').locator('.value').textContent()),
  ).toBeGreaterThanOrEqual(9.35);
  expect(
    parseMoney(await page.getByTestId('report-refunds').locator('.value').textContent()),
  ).toBeGreaterThan(0);

  // 19-20. Close register and verify reconciliation
  await page.getByTestId('nav-register').click();
  const expected = parseMoney(
    await page.getByTestId('stat-expected-cash').locator('.value').textContent(),
  );
  // 100 float + 9.35 cash sale − 5.19 burger refund (5.00 − 0.28 discount share + 0.47 tax)
  expect(expected).toBeCloseTo(104.16, 2);
  await page.getByTestId('close-register').click();
  await page.getByTestId('register-amount').fill(expected.toFixed(2));
  await page.getByTestId('register-submit').click();
  await expect(page.getByTestId('reconciliation-modal')).toBeVisible();
  await expect(page.getByTestId('recon-difference')).toHaveText('$0.00');
});
