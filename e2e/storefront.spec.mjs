import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const adminPassword = 'EMAdmin@2026!Retail';

async function waitForCatalog(page) {
  await page.goto('/');
  await expect(page.locator('.store-product-card').first()).toBeVisible();
}

async function addFirstProductAndOpenCheckout(page) {
  await waitForCatalog(page);
  const addButton = page.locator('.store-product-buy button:not([disabled])').first();
  await expect(addButton).toBeEnabled();
  const card = addButton.locator('xpath=ancestor::article[contains(@class,"store-product-card")]');
  const sku = (await card.locator('.store-product-sku').innerText()).trim();
  await addButton.click();
  await expect(card.locator('.store-inline-cart')).toContainText('1 trong giỏ');
  await page.getByRole('link', { name: /Tiến hành thanh toán/ }).click();
  await expect(page.getByRole('heading', { name: 'Thanh toán đơn hàng' })).toBeVisible();
  await expect(page.locator('#order-area option').nth(1)).toBeAttached({ timeout: 12_000 });
  return sku;
}

async function fillGuestCheckout(page, suffix) {
  const recipientPhone = '0905' + String(100000 + suffix).slice(-6);
  await page.locator('#order-name').fill('Khách E2E EMSystems');
  await page.locator('#order-phone').fill(recipientPhone);
  await page.locator('#order-area').selectOption({ index: 1 });
  await page.locator('#order-ward').fill('Hải Châu');
  await page.locator('#order-address').fill('12 đường Kiểm thử E2E, Hải Châu');
  return recipientPhone;
}

async function sameOriginJson(page, path, init = {}) {
  return page.evaluate(async ({ path, init }) => {
    const response = await fetch(path, {
      credentials: 'same-origin',
      ...init,
      headers: { ...(init.headers || {}), ...(init.body ? { 'content-type': 'application/json' } : {}) },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
    const payload = await response.json().catch(() => ({}));
    return { status: response.status, payload };
  }, { path, init });
}

test('browser: a single right-aligned login navbar action leads to registration on the login page', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');

  const brand = page.locator('.store-header > .store-brand');
  const login = page.getByRole('link', { name: 'Đăng nhập' });
  const headerRegister = page.locator('.store-header-actions .store-register-button');
  const cart = page.getByRole('link', { name: /Giỏ hàng/ });
  await expect(login).toBeVisible();
  await expect(headerRegister).toHaveCount(0);

  const brandBox = await brand.boundingBox();
  const loginBox = await login.boundingBox();
  const cartBox = await cart.boundingBox();
  expect(loginBox.x).toBeGreaterThan(brandBox.x + brandBox.width);
  expect(cartBox.x).toBeGreaterThan(loginBox.x);
  expect(cartBox.x + cartBox.width).toBeGreaterThan(1100);

  await login.click();
  await expect(page).toHaveURL(/\/login$/);
  const registerFromLogin = page.getByRole('link', { name: /Chưa có tài khoản/ });
  await expect(registerFromLogin).toBeVisible();
  await registerFromLogin.click();
  await expect(page.getByRole('heading', { name: 'Đăng ký tài khoản' })).toBeVisible();
  await expect(page).toHaveURL(/\/register$/);

  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Đăng nhập' })).toBeVisible();
  await expect(page.locator('.store-header-actions .store-register-button')).toHaveCount(0);
  const widths = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }));
  expect(widths.document).toBe(widths.viewport);
});

test('browser: guests must sign in before favoriting and return to the product after registration', async ({ page }) => {
  await waitForCatalog(page);
  const firstCard = page.locator('.store-product-card').first();
  const favoriteButton = firstCard.locator('.store-product-wishlist');
  await expect(favoriteButton).toBeEnabled();
  await expect(favoriteButton).toHaveAttribute('aria-pressed', 'false');
  await favoriteButton.click();

  await expect.poll(() => new URL(page.url()).pathname).toBe('/login');
  await expect(page.locator('.login-form-wrap > p.muted')).toContainText('Đăng nhập tài khoản khách hàng để lưu sản phẩm yêu thích');
  await page.getByRole('link', { name: /Chưa có tài khoản/ }).click();
  await expect.poll(() => new URL(page.url()).pathname).toBe('/register');
  await expect(page.locator('.login-form-wrap > p.muted')).toContainText('Điền thông tin để tạo tài khoản khách hàng');

  const suffix = String(Date.now()).slice(-8);
  const password = 'Wishlist@2026!Pass';
  await page.locator('#register-fullname').fill('Khách E2E yêu thích');
  await page.locator('#register-username').fill(`wish.e2e.${suffix}`);
  await page.locator('#register-email').fill(`wish.e2e.${suffix}@example.test`);
  await page.locator('#register-phone').fill(`0909${suffix.slice(-6)}`);
  await page.locator('#register-password').fill(password);
  await page.locator('#register-confirm-password').fill(password);
  await page.getByRole('button', { name: 'Đăng ký' }).click();

  await expect.poll(() => new URL(page.url()).pathname).toBe('/');
  const restoredFavorite = page.locator('.store-product-card').first().locator('.store-product-wishlist');
  await expect(restoredFavorite).toHaveAttribute('aria-pressed', 'true');
  const storedWishlists = await page.evaluate(() => Object.keys(localStorage)
    .filter((key) => key.startsWith('emsystems.store.wishlist.v1.customer.'))
    .map((key) => JSON.parse(localStorage.getItem(key) || '[]')));
  expect(storedWishlists).toHaveLength(1);
  expect(storedWishlists[0]).toHaveLength(1);
});

test('browser: full product page shows commerce details and related products; failed images fall back', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.route('**/product-images/smartphones/iphone-13-pro/thumbnail.webp', (route) => route.abort());
  await page.goto('/san-pham/iphone-13-pro/2');
  await expect(page.getByRole('heading', { name: 'iPhone 13 Pro', exact: true })).toBeVisible({ timeout: 15_000 });

  await expect(page.getByRole('main', { name: 'Đường dẫn' })).toHaveCount(0);
  await expect(page.locator('.store-product-page-hero')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Thông số sản phẩm' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Bảo hành, giao hàng và đổi trả' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Sản phẩm có thể bạn quan tâm' })).toBeVisible();
  await expect(page.locator('.store-page-recommendation-card')).toHaveCount(16);
  await expect(page.getByRole('search')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const productAxe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(productAxe.violations, `product page accessibility violations: ${JSON.stringify(productAxe.violations.map((violation) => violation.id))}`).toEqual([]);

  const mainImage = page.locator('.store-product-page-main-image img');
  await expect.poll(() => mainImage.getAttribute('src'), { timeout: 10_000 }).toContain('/1.webp');
  await expect.poll(() => mainImage.evaluate((image) => image.naturalWidth), { timeout: 10_000 }).toBeGreaterThan(0);

  const desktopImageLayout = await page.evaluate(() => {
    const frame = document.querySelector('.store-product-page-main-image').getBoundingClientRect();
    const image = document.querySelector('.store-product-page-main-image img').getBoundingClientRect();
    const nav = document.querySelector('.storefront-product-route .store-category-nav');
    const lastNavAction = nav.lastElementChild.getBoundingClientRect();
    return {
      viewportWidth: innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      frameWidth: frame.width,
      frameHeight: frame.height,
      imageContained: image.left >= frame.left && image.top >= frame.top && image.right <= frame.right && image.bottom <= frame.bottom,
      navLastActionRightAligned: lastNavAction.right > innerWidth - 200,
      navLastActionRight: lastNavAction.right,
      navWidth: nav.getBoundingClientRect().width,
      navScrollWidth: nav.scrollWidth,
    };
  });
  expect(desktopImageLayout.frameWidth).toBeGreaterThan(250);
  expect(Math.abs(desktopImageLayout.frameWidth - desktopImageLayout.frameHeight)).toBeLessThanOrEqual(2);
  expect(desktopImageLayout.imageContained).toBe(true);
  expect(desktopImageLayout.navLastActionRightAligned).toBe(true);
  expect(desktopImageLayout.documentWidth).toBe(desktopImageLayout.viewportWidth);

  await page.setViewportSize({ width: 320, height: 800 });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'iPhone 13 Pro', exact: true })).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => mainImage.evaluate((image) => image.naturalWidth), { timeout: 10_000 }).toBeGreaterThan(0);
  const mobileLayout = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, frame: (() => { const r = document.querySelector('.store-product-page-main-image').getBoundingClientRect(); return { width: r.width, height: r.height }; })() }));
  expect(mobileLayout.document).toBe(mobileLayout.viewport);
  expect(Math.abs(mobileLayout.frame.width - mobileLayout.frame.height)).toBeLessThanOrEqual(2);
});

test('browser: product quick view stays on the catalogue and offers a full product page', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  const catalogPath = new URL(page.url()).pathname;
  await expect(page.locator('.store-product-card')).toHaveCount(12);
  await expect(page.locator('.store-catalog-pagination')).toContainText('/ 30 sản phẩm');
  await page.locator('.store-product-card .store-product-view-details').first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(new URL(page.url()).pathname).toBe(catalogPath);
  await expect(page.locator('.store-product-card').first()).toBeVisible();

  const fullPageLink = page.getByRole('link', { name: /Mở trang sản phẩm đầy đủ/ });
  await expect(fullPageLink).toBeVisible();
  await fullPageLink.click();
  await expect(page).toHaveURL(/\/san-pham\/.+\/\d+$/);
  await expect(page.locator('.store-product-page-hero')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.store-page-recommendation-card').first()).toBeVisible();

  await page.locator('.store-page-recommendation-card').first().click();
  await expect(page).toHaveURL(/\/san-pham\/.+\/\d+$/);
  await expect(page.locator('.store-product-page-hero')).toBeVisible();
  await expect(page.locator('.store-product-page-summary h1')).not.toBeEmpty();
});

test('browser: catalog, cart, guest checkout, cancellation and exact stock restoration', async ({ page }) => {
  const chosenSku = await addFirstProductAndOpenCheckout(page);
  const beforePayload = await sameOriginJson(page, '/api/app/store/products?page=1&pageSize=100');
  expect(beforePayload.status).toBe(200);
  const productsBefore = beforePayload.payload.data || [];
  const productBefore = productsBefore.find((item) => item.sku === chosenSku) || productsBefore.find((item) => item.availableStock === true);
  expect(productBefore).toBeTruthy();
  expect(productBefore.availableStock).toBe(true, 'public storefront exposes only a stock-availability flag');

  const recipientPhone = await fillGuestCheckout(page, 123456);
  await page.locator('input[name="checkout-payment-method"][value="cash_on_delivery"]').check();
  await page.getByRole('button', { name: /Đặt hàng/ }).click();
  const confirmation = page.getByRole('heading', { name: /Đã nhận đơn WEB-/ });
  await expect(confirmation).toBeVisible();
  const invoiceMatch = (await confirmation.innerText()).match(/WEB-\d{5,12}/);
  expect(invoiceMatch, 'checkout should display the created invoice').toBeTruthy();
  const invoiceNo = invoiceMatch[0];

  // A confirmation-page link includes both lookup fields; tracking should run automatically.
  await page.goto(`/track-order?orderCode=${encodeURIComponent(invoiceNo)}&phone=${encodeURIComponent(recipientPhone)}`);
  await expect(page.getByLabel('Mã đơn hàng *')).toHaveValue(invoiceNo);
  await expect(page.getByLabel('Số điện thoại nhận hàng *')).toHaveValue(recipientPhone);
  await expect(page.getByRole('heading', { name: invoiceNo })).toBeVisible();
  await expect(page.locator('.store-track-status-pill')).toContainText('Chờ cửa hàng xác nhận');
  await expect(page.locator('.store-track-summary')).toContainText('12 đường Kiểm thử E2E');
  await expect(page.locator('.store-track-payment-status')).not.toBeEmpty();

  const afterOrderPayload = await sameOriginJson(page, '/api/app/store/products?page=1&pageSize=100');
  const afterOrderProduct = (afterOrderPayload.payload.data || []).find((item) => Number(item.id) === Number(productBefore.id));
  expect(afterOrderPayload.status).toBe(200);
  if (afterOrderProduct) expect(afterOrderProduct.availableStock).toBe(true);

  // Staff login occurs through the browser UI. Cancellation then uses the same authenticated API
  // route used by the delivery-order screen and must release stock exactly once.
  await page.goto('/login');
  await page.getByLabel('Tài khoản').fill('admin');
  await page.getByLabel('Mật khẩu').fill(adminPassword);
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
  await expect(page).toHaveURL(/\/admin\/dashboard$/);

  const staffStockAfterOrder = await sameOriginJson(page, '/api/app/products?page=1&pageSize=100');
  expect(staffStockAfterOrder.status).toBe(200);
  const exactStockAfterOrder = (staffStockAfterOrder.payload.data || []).find((item) => Number(item.id) === Number(productBefore.id));
  expect(exactStockAfterOrder).toBeTruthy();
  const stockAfterOrder = Number(exactStockAfterOrder.stock);
  expect(stockAfterOrder).toBeGreaterThanOrEqual(0);

  const orderList = await sameOriginJson(page, '/api/app/store/orders?page=1&pageSize=100');
  expect(orderList.status).toBe(200);
  const order = (orderList.payload.data || []).find((item) => item.invoiceNo === invoiceNo);
  expect(order, 'staff API should see the web order created in checkout').toBeTruthy();

  const cancel = await sameOriginJson(page, `/api/app/store/orders/${order.id}/status`, {
    method: 'PATCH',
    body: { status: 'cancelled' },
  });
  expect(cancel.status).toBe(200);
  const duplicateCancel = await sameOriginJson(page, `/api/app/store/orders/${order.id}/status`, {
    method: 'PATCH',
    body: { status: 'cancelled' },
  });
  expect(duplicateCancel.status).toBe(409);

  const afterCancel = await sameOriginJson(page, '/api/app/products?page=1&pageSize=100');
  const restoredProduct = (afterCancel.payload.data || []).find((item) => Number(item.id) === Number(productBefore.id));
  expect(Number(restoredProduct.stock)).toBe(stockAfterOrder + 1);

  await page.goto(`/track-order?orderCode=${encodeURIComponent(invoiceNo)}&phone=${encodeURIComponent(recipientPhone)}`);
  await expect(page.locator('.store-track-status-pill')).toContainText('Đã hủy');
  await expect(page.locator('.store-track-cancelled')).toBeVisible();
  await expect(page.locator('.store-track-timeline')).toHaveCount(0);
});

test('browser: admin delivery-orders layout and filters stay responsive on desktop and mobile', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Tài khoản').fill('admin');
  await page.getByLabel('Mật khẩu').fill(adminPassword);
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
  await expect.poll(() => new URL(page.url()).pathname).toBe('/admin/dashboard');
  await page.goto('/admin/delivery-orders');
  await expect(page.locator('.store-orders-heading h2')).toHaveText('Đơn giao hàng online');
  await expect(page.locator('.store-orders-stats .store-orders-stat')).toHaveCount(4);
  await expect(page.getByRole('searchbox', { name: 'Tìm đơn giao hàng' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Lọc theo trạng thái' })).toBeVisible();

  const desktopAxe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(desktopAxe.violations.map((violation) => violation.id), 'delivery-orders page should pass desktop accessibility checks').toEqual([]);

  for (const width of [1024, 760, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(60);
    const dimensions = await page.evaluate(() => ({
      viewport: window.innerWidth,
      document: document.documentElement.scrollWidth,
      content: document.querySelector('.page-content')?.getBoundingClientRect().width || 0,
      cards: [...document.querySelectorAll('.store-admin-order-card')].map((card) => ({ width: card.getBoundingClientRect().width, scrollWidth: card.scrollWidth })),
      stats: document.querySelector('.store-orders-stats')?.getBoundingClientRect().width || 0,
    }));
    expect(dimensions.document, `document must not overflow at ${width}px`).toBeLessThanOrEqual(dimensions.viewport);
    expect(dimensions.stats, `stats must fit at ${width}px`).toBeGreaterThan(0);
    for (const card of dimensions.cards) expect(card.scrollWidth, `order card must not overflow at ${width}px`).toBeLessThanOrEqual(card.width + 2);
  }

  await page.getByRole('searchbox', { name: 'Tìm đơn giao hàng' }).fill('no-such-delivery-order');
  if (await page.locator('.store-admin-order-card').count()) {
    await expect(page.getByRole('heading', { name: 'Không tìm thấy đơn phù hợp' })).toBeVisible();
  }
});

test('browser: login routes by authenticated role; customer cannot read or mutate staff data', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Đăng nhập' })).toBeVisible();
  const axe = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const critical = axe.violations.filter((v) => v.impact === 'critical');
  expect(critical, `critical login accessibility violations: ${JSON.stringify(critical.map((v) => ({ id: v.id, nodes: v.nodes.length }))) }`).toEqual([]);
  expect(axe.violations, 'login page must have no WCAG 2.1 A/AA violations').toEqual([]);

  await page.getByLabel('Tài khoản').fill('admin');
  await page.getByLabel('Mật khẩu').fill(adminPassword);
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
  await expect(page).toHaveURL(/\/admin\/dashboard$/);
  expect((await sameOriginJson(page, '/api/app/system/diagnostics')).status).toBe(200);

  await page.goto('/');
  await expect(page.locator('.store-header-account')).toBeVisible();
  await expect(page.locator('.store-header-account')).not.toContainText('Đăng nhập');
  await expect(page.getByRole('button', { name: 'Đăng xuất' })).toBeVisible();

  await page.goto('/admin/system');
  await expect(page.locator('.system-admin-page > .welcome-row h2')).toHaveText('Quản trị hệ thống');
  await expect(page.getByRole('heading', { name: 'Tài khoản ngân hàng nhận tiền' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Thêm tài khoản' })).toBeVisible();
  await expect(page.locator('.system-bank-form')).toBeVisible();
  await expect(page.getByLabel('Mã ngân hàng / BANK ID')).toBeVisible();
  await expect(page.getByLabel('Tên ngân hàng')).toBeVisible();
  await expect(page.getByLabel('Số tài khoản nhận tiền')).toBeVisible();
  await expect(page.getByLabel('Tên chủ tài khoản')).toBeVisible();

  const customerContext = await page.context().browser().newContext();
  const customerPage = await customerContext.newPage();
  try {
    await customerPage.goto('http://127.0.0.1:5193/register');
    const unique = Date.now();
    const username = `e2e_customer_${unique}`;
    const password = 'E2E Customer Passphrase 2026';
    await customerPage.getByLabel('Họ và tên').fill('Khách hàng E2E');
    await customerPage.getByLabel('Tên đăng nhập').fill(username);
    await customerPage.getByLabel('Email').fill(`e2e-${unique}@example.test`);
    await customerPage.getByLabel('Số điện thoại').fill(`0905${String(unique).slice(-6)}`);
    await customerPage.getByLabel('Mật khẩu (12–200 ký tự)').fill(password);
    await customerPage.getByLabel('Nhập lại mật khẩu').fill(password);
    await customerPage.getByRole('button', { name: 'Đăng ký' }).click();
    await expect(customerPage).toHaveURL('http://127.0.0.1:5193/');
    await expect(customerPage.locator('.store-header-account')).toBeVisible();
    await expect(customerPage.locator('.store-header-account')).toContainText('Khách hàng E2E');
    await expect(customerPage.getByRole('button', { name: 'Đăng xuất' })).toBeVisible();
    await customerPage.setViewportSize({ width: 390, height: 844 });
    const signedInMobileWidth = await customerPage.evaluate(() => ({ viewport: window.innerWidth, document: document.documentElement.scrollWidth }));
    expect(signedInMobileWidth.document).toBeLessThanOrEqual(signedInMobileWidth.viewport + 1);

    const protectedReads = await Promise.all([
      sameOriginJson(customerPage, '/api/app/users?page=1&pageSize=10'),
      sameOriginJson(customerPage, '/api/app/audit-logs?page=1&pageSize=10'),
      sameOriginJson(customerPage, '/api/app/system/diagnostics'),
      sameOriginJson(customerPage, '/api/app/system/bank-accounts'),
      sameOriginJson(customerPage, '/api/app/support/requests?page=1&pageSize=20'),
      sameOriginJson(customerPage, '/api/app/reports'),
    ]);
    expect(protectedReads.map((r) => r.status)).toEqual([403, 403, 403, 403, 403, 403]);
    const writeProduct = await sameOriginJson(customerPage, '/api/app/products', {
      method: 'POST',
      body: { name: 'Unauthorized E2E mutation', sku: `BAD-${unique}`, sellingPrice: 1, costPrice: 0, stock: 999 },
    });
    expect(writeProduct.status).toBe(403);
    await customerPage.goto('http://127.0.0.1:5193/admin/users');
    await expect(customerPage.getByRole('heading', { name: 'Không tìm thấy trang' })).toBeVisible();
    await customerPage.goto('http://127.0.0.1:5193/admin/support');
    await expect(customerPage.getByRole('heading', { name: 'Không tìm thấy trang' })).toBeVisible();
    await customerPage.goto('http://127.0.0.1:5193/');
    await customerPage.getByRole('button', { name: 'Đăng xuất' }).click();
    await expect(customerPage.locator('.store-header-account')).toHaveCount(0);
    await expect(customerPage.getByRole('link', { name: /Đăng nhập/ })).toBeVisible();
  } finally {
    await customerContext.close();
  }
});

test('browser: mobile layout, network failure recovery and performance metrics are measured', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await waitForCatalog(page);

  // Verify the larger logo/search/header controls at phone, tablet and desktop widths.
  const responsiveWidths = [320, 360, 390, 768, 1024, 1280, 1440];
  for (const width of responsiveWidths) {
    await page.setViewportSize({ width, height: 844 });
    const layout = await page.evaluate(() => {
      const header = document.querySelector('.store-header');
      const logo = document.querySelector('.store-brand-logo');
      const search = document.querySelector('.store-header-search');
      const nav = document.querySelector('.store-category-nav');
      return {
        viewport: innerWidth,
        document: document.documentElement.scrollWidth,
        headerWidth: header.getBoundingClientRect().width,
        logoWidth: logo.getBoundingClientRect().width,
        searchWidth: search.getBoundingClientRect().width,
        searchFontSize: Number.parseFloat(getComputedStyle(search.querySelector('input')).fontSize),
        navClientWidth: nav.clientWidth,
        navScrollWidth: nav.scrollWidth,
      };
    });
    expect(layout.document, `no page overflow at ${width}px`).toBeLessThanOrEqual(width + 1);
    expect(layout.headerWidth).toBe(width);
    expect(layout.logoWidth, `visible logo at ${width}px`).toBeGreaterThanOrEqual(width <= 420 ? 43 : 49);
    expect(layout.searchWidth, `search spans the available header width at ${width}px`).toBeGreaterThan(250);
    expect(layout.searchFontSize).toBeGreaterThanOrEqual(13);
    if (width <= 760) expect(layout.navScrollWidth).toBeGreaterThanOrEqual(layout.navClientWidth);
  }
  await page.setViewportSize({ width: 390, height: 844 });

  const metrics = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0];
    const fcp = performance.getEntriesByName('first-contentful-paint')[0];
    return {
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      domContentLoadedMs: Math.round(nav?.domContentLoadedEventEnd || 0),
      loadEventMs: Math.round(nav?.loadEventEnd || 0),
      firstContentfulPaintMs: Math.round(fcp?.startTime || 0),
    };
  });
  await testInfo.attach('mobile-performance-metrics.json', {
    body: Buffer.from(JSON.stringify(metrics, null, 2)),
    contentType: 'application/json',
  });
  console.info('[EMSYSTEMS E2E mobile/performance]', JSON.stringify(metrics));
  expect(metrics.documentWidth).toBeLessThanOrEqual(metrics.viewportWidth + 1);
  expect(metrics.domContentLoadedMs).toBeGreaterThan(0);
  expect(metrics.domContentLoadedMs).toBeLessThan(10_000);

  const axe = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const critical = axe.violations.filter((v) => v.impact === 'critical');
  await testInfo.attach('axe-storefront-summary.json', {
    body: Buffer.from(JSON.stringify(axe.violations.map((v) => ({
      id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length,
    })), null, 2)),
    contentType: 'application/json',
  });
  console.info('[EMSYSTEMS E2E axe]', JSON.stringify(axe.violations.map((v) => ({
    id: v.id, impact: v.impact, nodes: v.nodes.map((node) => ({
      target: node.target, summary: node.failureSummary, html: node.html.slice(0, 180),
    })),
  }))));
  expect(critical).toEqual([]);
  expect(axe.violations, 'storefront must have no WCAG 2.1 A/AA violations').toEqual([]);

  await page.route('**/api/app/store/products**', (route) => route.abort('failed'));
  await page.reload();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByText(/Thử tải lại|Không thể tải|kết nối/i).first()).toBeVisible();
});

test('browser: track-order handles direct links, invalid lookups and narrow mobile view', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto('/track-order');
  await expect(page.getByRole('heading', { name: 'Tra cứu đơn giao hàng' })).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Hướng dẫn tra cứu đơn hàng' })).toBeVisible();

  const layout = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    timelineRule: getComputedStyle(document.querySelector('.store-track-heading')).display,
  }));
  expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth + 1);
  expect(layout.timelineRule).toBe('flex');

  const axe = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(axe.violations, `track-order accessibility violations: ${JSON.stringify(axe.violations.map((v) => v.id))}`).toEqual([]);

  await page.goto('/track-order?orderCode=WEB-99999&phone=0905123456');
  await expect(page.getByLabel('Mã đơn hàng *')).toHaveValue('WEB-99999');
  await expect(page.getByLabel('Số điện thoại nhận hàng *')).toHaveValue('0905123456');
  await expect(page.getByRole('alert')).toContainText(/Không tìm thấy đơn hàng/i);
  await expect(page.locator('.store-track-result')).toHaveCount(0);
});

test('browser: customer help center creates and tracks a support case', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/support');
  await expect(page.getByRole('heading', { name: 'Trung tâm hỗ trợ khách hàng' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Không quét được mã QR' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Mất QR, đóng nhầm tab hoặc mất mạng' })).toBeVisible();
  await expect(page.getByText(/không yêu cầu mật khẩu ngân hàng, mã OTP/i)).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await expect(page.locator('.store-network-status')).toContainText(/Kết nối mạng đang gián đoạn/i);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.locator('.store-network-status')).toContainText(/Kết nối mạng đã trở lại/i);
  await expect(page.locator('.store-network-status').getByRole('button', { name: 'Tải lại trang' })).toBeVisible();

  const mobile = await page.evaluate(() => ({ viewport: window.innerWidth, document: document.documentElement.scrollWidth }));
  expect(mobile.document).toBeLessThanOrEqual(mobile.viewport + 1);

  await page.getByLabel('Họ tên liên hệ *').fill('Khách hỗ trợ E2E');
  await page.getByLabel('Số điện thoại đã đặt hàng *').fill('0905123456');
  await page.getByLabel('Nhóm vấn đề *').selectOption('payment_qr');
  await page.getByLabel('Mô tả sự cố *').fill('Tôi đóng nhầm tab thanh toán và không còn nhìn thấy mã QR của đơn hàng.');
  await page.getByRole('button', { name: 'Gửi yêu cầu hỗ trợ' }).click();
  const createdCase = page.locator('.store-support-created');
  await expect(createdCase).toContainText(/HT-[0-9]{5,8}/);
  const caseCode = (await createdCase.locator('strong').innerText()).match(/HT-[0-9]{5,8}/)?.[0];
  expect(caseCode).toBeTruthy();

  await page.getByLabel('Mã hỗ trợ *').fill(caseCode);
  await page.getByLabel('Số điện thoại liên hệ *').fill('0905123456');
  await page.getByRole('button', { name: 'Tra cứu yêu cầu', exact: true }).click();
  await expect(page.locator('.store-support-ticket-result')).toContainText('Đã tiếp nhận');
  await expect(page.locator('.store-support-ticket-result')).toContainText('Tôi đóng nhầm tab thanh toán');

  const staffContext = await page.context().browser().newContext();
  const staffPage = await staffContext.newPage();
  try {
    await staffPage.goto('/login');
    await staffPage.getByLabel('Tài khoản').fill('admin');
    await staffPage.getByLabel('Mật khẩu').fill(adminPassword);
    await staffPage.getByRole('button', { name: 'Đăng nhập' }).click();
    await expect(staffPage).toHaveURL(/\/admin\/dashboard$/);
    await staffPage.goto('/admin/support');
    await expect(staffPage.locator('.support-inbox-page .welcome-row h2')).toHaveText('Hỗ trợ khách hàng');
    await staffPage.getByRole('button', { name: new RegExp(caseCode) }).click();
    await staffPage.getByLabel('Phản hồi gửi cho khách').fill('EMSystems đã nhận yêu cầu. Không thanh toán lần hai; nhân viên đang kiểm tra phiên thanh toán.');
    await staffPage.getByLabel('Trạng thái xử lý').selectOption('in_progress');
    await staffPage.getByRole('button', { name: 'Lưu phản hồi và trạng thái' }).click();
    await expect(staffPage.getByRole('status')).toContainText('Đã cập nhật yêu cầu hỗ trợ');
  } finally {
    await staffContext.close();
  }

  await page.getByRole('button', { name: 'Tra cứu yêu cầu', exact: true }).click();
  await expect(page.locator('.store-support-ticket-result')).toContainText('Đang xử lý');
  await expect(page.locator('.store-support-ticket-result')).toContainText('EMSystems đã nhận yêu cầu');

  await page.getByLabel('Số điện thoại liên hệ *').fill('0905000000');
  await page.getByRole('button', { name: 'Tra cứu yêu cầu', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText(/Không tìm thấy yêu cầu hỗ trợ/i);
  await expect(page.locator('.store-support-ticket-result')).toHaveCount(0);
});

test('browser: online checkout fails closed when merchant sandbox credentials are missing', async ({ page }) => {
  await addFirstProductAndOpenCheckout(page);
  await fillGuestCheckout(page, 654321);
  await page.locator('input[name="checkout-payment-method"][value="momo_sandbox"]').check();
  await page.getByRole('button', { name: /Tiếp tục thanh toán/ }).click();
  await expect(page.getByRole('alert')).toContainText(/Chưa có đủ cấu hình để tạo yêu cầu/i);
  await expect(page.getByRole('heading', { name: /Đã nhận đơn WEB-/ })).toHaveCount(0);
  await page.locator('input[name="checkout-payment-method"][value="vnpay_sandbox"]').check();
  await page.getByRole('button', { name: /Tiếp tục thanh toán/ }).click();
  await expect(page.getByRole('alert')).toContainText(/Chưa có đủ cấu hình để tạo yêu cầu/i);
  await expect(page.getByRole('heading', { name: /Đã nhận đơn WEB-/ })).toHaveCount(0);
});
