import { expect, test } from '@playwright/test';
import { ensureRegisterClosed, login, parseMoney } from './helpers';

test.describe('E2E-06 Register', () => {
  test('open register, complete sale, close register, verify reconciliation', async ({
    page,
    request,
  }) => {
    await ensureRegisterClosed(request, 'cashier');
    await login(page, 'cashier');

    await page.getByTestId('nav-register').click();
    await page.getByTestId('open-register').click();
    await page.getByTestId('register-amount').fill('50');
    await page.getByTestId('register-submit').click();
    await expect(page.getByTestId('toast-success')).toContainText('Shift opened');
    await expect(page.getByTestId('stat-expected-cash')).toContainText('$50.00');

    await page.getByTestId('nav-pos').click();
    await page.getByTestId('add-WATER-001').click(); // 1.00, no tax
    await page.getByTestId('checkout-button').click();
    await page.getByTestId('pay-amount-0').fill('5');
    await page.getByTestId('confirm-payment').click();
    await expect(page.getByTestId('receipt-modal')).toBeVisible();
    await page.getByTestId('new-sale').click();

    await page.getByTestId('nav-register').click();
    await expect(page.getByTestId('stat-cash-sales')).toContainText('$1.00');
    await expect(page.getByTestId('stat-expected-cash')).toContainText('$51.00');

    await page.getByTestId('cash-out').click();
    await page.getByTestId('register-amount').fill('10');
    await page.getByTestId('register-submit').click();
    await expect(page.getByTestId('stat-expected-cash')).toContainText('$41.00');

    await page.getByTestId('close-register').click();
    await expect(page.getByTestId('close-expected')).toHaveText('$41.00');
    await page.getByTestId('register-amount').fill('40');
    await page.getByTestId('register-submit').click();
    await expect(page.getByTestId('reconciliation-modal')).toBeVisible();
    expect(parseMoney(await page.getByTestId('recon-expected').textContent())).toBe(41);
    expect(parseMoney(await page.getByTestId('recon-actual').textContent())).toBe(40);
    await expect(page.getByTestId('recon-difference')).toHaveText('-$1.00');
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(page.getByTestId('open-register')).toBeVisible();
    await expect(page.getByTestId('register-history').locator('tbody tr').first()).toContainText(
      '-$1.00',
    );
  });
});
