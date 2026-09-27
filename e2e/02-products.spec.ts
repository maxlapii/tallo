import { expect, test } from '@playwright/test';
import { login, uniqueSuffix } from './helpers';

test.describe('E2E-02 Product', () => {
  test('admin creates a product, searches for it, and verifies it', async ({ page }) => {
    await login(page, 'admin');
    await page.getByTestId('nav-products').click();
    await expect(page.getByRole('heading', { name: 'Products' })).toBeVisible();

    const sku = `E2E-${uniqueSuffix()}`.toUpperCase();
    await page.getByTestId('new-product').click();
    await expect(page.getByTestId('product-modal')).toBeVisible();
    await page.getByTestId('product-name').fill('E2E Sparkling Water');
    await page.getByTestId('product-sku').fill(sku);
    await page.getByTestId('product-barcode').fill(`9${Date.now()}`);
    await page.getByTestId('product-price').fill('1.25');
    await page.getByTestId('product-costPrice').fill('0.40');
    await page.getByTestId('product-taxRate').fill('10');
    await page.getByTestId('product-stockQty').fill('12');
    await page.getByTestId('product-lowStockThreshold').fill('3');
    await page.getByTestId('save-product').click();
    await expect(page.getByTestId('toast-success')).toContainText('Product created');

    await page.getByTestId('product-search').fill(sku);
    await page.getByTestId('product-search').press('Enter');
    const row = page.getByTestId(`product-row-${sku}`);
    await expect(row).toBeVisible();
    await expect(row).toContainText('E2E Sparkling Water');
    await expect(row).toContainText('$1.25');
    await expect(row).toContainText('12');
  });

  test('duplicate SKU is rejected with a clear error', async ({ page }) => {
    await login(page, 'admin');
    await page.goto('/products');
    await page.getByTestId('new-product').click();
    await page.getByTestId('product-name').fill('Dup');
    await page.getByTestId('product-sku').fill('COKE-001');
    await page.getByTestId('product-price').fill('1');
    await page.getByTestId('save-product').click();
    await expect(page.getByTestId('product-modal').getByRole('alert')).toContainText(
      'already exists',
    );
  });

  test('cashier cannot see product management actions', async ({ page }) => {
    await login(page, 'cashier');
    await page.goto('/products');
    await expect(page.getByTestId('products-table')).toBeVisible();
    await expect(page.getByTestId('new-product')).toHaveCount(0);
  });
});
