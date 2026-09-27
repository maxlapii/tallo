import { expect, test } from '@playwright/test';
import { ensureRegisterOpen, login } from './helpers';

test.describe('E2E-10 Printers per area and print stations', () => {
  test('admin manages printers and routing; a print station receives only its area tickets', async ({
    browser,
    page,
    request,
  }) => {
    await ensureRegisterOpen(request, 'admin');
    await login(page, 'admin');

    // Printers page lists the seeded areas and can add a network printer (validation included).
    await page.getByTestId('nav-printers').click();
    await expect(page.getByTestId('printers-table')).toContainText('Kitchen 1');
    await expect(page.getByTestId('printers-table')).toContainText('Drink maker');
    await page.getByTestId('new-printer').click();
    await page.getByTestId('printer-area').fill('Bar');
    await page.getByTestId('printer-name').fill('Bar TCP');
    await page.getByTestId('printer-type-network').click();
    await page.getByTestId('save-printer').click();
    await expect(page.getByTestId('printer-modal')).toContainText('Network printers need a host');
    await page.getByTestId('printer-host').fill('192.0.2.10');
    await page.getByTestId('save-printer').click();
    await expect(page.getByTestId('toast-success')).toContainText('Printer added');
    await expect(page.getByTestId('printers-table')).toContainText('Bar TCP');

    // A kitchen tablet opens the print station for Kitchen 1.
    const kitchenCtx = await browser.newContext();
    const kitchen = await kitchenCtx.newPage();
    await login(kitchen, 'cashier');
    await kitchen.goto('/print-station');
    await kitchen.getByTestId('station-printer').selectOption({ label: 'Kitchen 1 · Kitchen 1' });
    await expect(kitchen.getByRole('heading', { name: /Print station: Kitchen 1/ })).toBeVisible();
    const waitingBefore = await kitchen.locator('[data-testid^="job-"]').count();

    // Cashier sells a drink (Drink maker) and a burger (Kitchen 1).
    await page.goto('/pos');
    await page.getByTestId('add-COKE-001').click();
    await page.getByTestId('add-BURGER-001').click();
    await page.getByTestId('checkout-button').click();
    await page.getByTestId('pay-amount-0').fill('20');
    await page.getByTestId('confirm-payment').click();
    await expect(page.getByTestId('receipt-modal')).toBeVisible();
    const receiptNo = (await page.getByTestId('receipt-no').textContent())!;

    // The kitchen station gets the burger ticket live, without the drink.
    await expect(kitchen.locator('[data-testid^="job-"]')).toHaveCount(waitingBefore + 1);
    const job = kitchen.locator('[data-testid^="job-"]').filter({ hasText: `#${receiptNo}` });
    await expect(job).toContainText('Burger');
    await expect(job).not.toContainText('Coca Cola');
    await job.click();
    await expect(kitchen.getByTestId('ticket')).toContainText('KITCHEN 1');
    await expect(kitchen.getByTestId('ticket')).toContainText('Burger');
    const jobId = (await job.getAttribute('data-testid'))!.replace('job-', '');
    await kitchen.getByTestId(`done-job-${jobId}`).click();
    await expect(
      kitchen.locator('[data-testid^="job-"]').filter({ hasText: `#${receiptNo}` }),
    ).toHaveCount(0);

    // The admin sees the jobs: Drink maker ticket, Kitchen 1 ticket (printed), and the counter receipt.
    await page.getByTestId('new-sale').click();
    await page.goto('/printers');
    const rows = page
      .getByTestId('print-jobs-table')
      .locator('tbody tr')
      .filter({ hasText: `#${receiptNo}` });
    await expect(rows).toHaveCount(3);
    await expect(rows.filter({ hasText: 'Kitchen 1' })).toContainText('PRINTED');
    await expect(rows.filter({ hasText: 'Drink maker' })).toContainText('QUEUED');
    await expect(rows.filter({ hasText: 'Counter' })).toContainText('Receipt');

    // Reprint from the sale page queues the tickets again.
    await page.goto('/sales');
    await page.getByTestId('filter-receipt').fill(receiptNo);
    await page.getByTestId('apply-filters').click();
    await page.getByTestId(`sale-row-${receiptNo}`).click();
    await page.getByTestId('reprint-tickets').click();
    await expect(page.getByTestId('toast-success')).toContainText('print jobs queued');
    await expect(
      kitchen.locator('[data-testid^="job-"]').filter({ hasText: `#${receiptNo}` }),
    ).toContainText('Reprint');

    await kitchenCtx.close();
  });

  test('product print-area override routes an item to a different station', async ({
    page,
    request,
  }) => {
    await ensureRegisterOpen(request, 'admin');
    await login(page, 'admin');
    await page.goto('/products');
    // Route Water (Beverages → Drink maker) to Kitchen 2 explicitly.
    await page.getByTestId('product-search').fill('WATER-001');
    await page.getByTestId('product-search').press('Enter');
    await page
      .getByTestId('product-row-WATER-001')
      .getByRole('button', { name: 'Edit Water' })
      .click();
    await page.getByTestId('product-printerId').selectOption({ label: 'Kitchen 2' });
    await page.getByTestId('save-product').click();
    await expect(page.getByTestId('toast-success')).toContainText('Product updated');

    await page.goto('/pos');
    await page.getByTestId('add-WATER-001').click();
    await page.getByTestId('checkout-button').click();
    await page.getByTestId('pay-amount-0').fill('5');
    await page.getByTestId('confirm-payment').click();
    await expect(page.getByTestId('receipt-modal')).toBeVisible();
    const receiptNo = (await page.getByTestId('receipt-no').textContent())!;

    await page.goto('/printers');
    const rows = page
      .getByTestId('print-jobs-table')
      .locator('tbody tr')
      .filter({ hasText: `#${receiptNo}` });
    await expect(rows.filter({ hasText: 'Kitchen 2' })).toHaveCount(1);
    await expect(rows.filter({ hasText: 'Drink maker' })).toHaveCount(0);

    // Restore the default routing for later tests.
    await page.goto('/products');
    await page.getByTestId('product-search').fill('WATER-001');
    await page.getByTestId('product-search').press('Enter');
    await page
      .getByTestId('product-row-WATER-001')
      .getByRole('button', { name: 'Edit Water' })
      .click();
    await page.getByTestId('product-printerId').selectOption({ label: "Use category's printer" });
    await page.getByTestId('save-product').click();
    await expect(page.getByTestId('toast-success')).toContainText('Product updated');
  });
});
