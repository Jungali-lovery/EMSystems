import test from 'node:test';
import assert from 'node:assert/strict';

class MemoryStorage {
  #values = new Map();
  getItem(key) { return this.#values.has(String(key)) ? this.#values.get(String(key)) : null; }
  setItem(key, value) { this.#values.set(String(key), String(value)); }
  removeItem(key) { this.#values.delete(String(key)); }
  clear() { this.#values.clear(); }
}
if (typeof globalThis.CustomEvent === 'undefined') {
  globalThis.CustomEvent = class CustomEvent { constructor(type, options = {}) { this.type = type; this.detail = options.detail; } };
}
process.env.NODE_ENV = 'test';
process.env.EMSYSTEMS_ALLOW_MOCK_PAYMENT = 'true';
globalThis.window = {
  localStorage: new MemoryStorage(), sessionStorage: new MemoryStorage(),
  location: { origin: 'http://127.0.0.1:5173', reload() {} },
  dispatchEvent() {}, addEventListener() {}, removeEventListener() {},
  matchMedia: () => ({ matches: false }),
};
const api = await import('../src/api.js');
const { createPasswordCredential } = await import('../src/demo-auth.js');
const { canAccessAdminRoute, canAccessDataRequest, canAccessPortal, getPortalForRole, toCanonicalWorkspacePath } = await import('../src/access-control.js');
const { calculateDeliveryQuote, findNearestSupportedDeliveryArea } = await import('../src/services/delivery.js');
const DATA_KEY = 'emsystems.demo.data.v1';
const BACKUP_KEY = 'emsystems.demo.corrupt-backup.v1';
const DEMO_PASSWORDS = Object.freeze({
  admin: 'EMAdmin@2026!Retail',
  manager: 'EMManager@2026!Branch',
  sales: 'EMSales@2026!POS',
  warehouse: 'EMWarehouse@2026!Stock',
});

async function resetAndLogin(username = 'admin') {
  window.localStorage.clear();
  window.sessionStorage.clear();
  api.resetDemoData();
  await loginStaff(username);
}

async function loginStaff(username = 'admin') {
  const data = api.getStoredDemoData();
  const user = data.users.find((item) => item.username === username);
  user.passwordCredential = await createPasswordCredential(DEMO_PASSWORDS[username]);
  user.credentialVersion = 1;
  window.localStorage.setItem(DATA_KEY, JSON.stringify(data));
  const login = await api.dataRequest('/auth/login', { method: 'POST', body: {
    username, password: DEMO_PASSWORDS[username],
  } });
  assert.equal(login.user.username, username);
}

async function registerMemberAccount() {
  const password = 'Member test passphrase 2026';
  const result = await api.dataRequest('/auth/register', { method: 'POST', body: {
    username: 'membertester', fullName: 'Thành viên kiểm thử', email: 'membertester@example.com',
    phone: '0905123456', password, confirmPassword: password,
  } });
  assert.equal(result.user.role, 'customer');
  return api.dataRequest('/store/member/me');
}

async function expectReject(promise, status) {
  await assert.rejects(promise, (error) => { assert.equal(error.status, status); return true; });
}

test('định vị chọn vùng giao gần nhất và báo phí khác nhau theo cự ly; ngoài vùng không tự gán nhầm', () => {
  const areas = [
    { id: 1, city: 'Đà Nẵng', district: 'Hải Châu', branchId: 1, shippingFee: 15000, isActive: true },
    { id: 5, city: 'Đà Nẵng', district: 'Liên Chiểu', branchId: 1, shippingFee: 25000, isActive: true },
  ];
  const latitude = 16.0736;
  const longitude = 108.1517;
  const nearest = findNearestSupportedDeliveryArea(areas, latitude, longitude);
  assert.equal(nearest.area.id, 5);
  const quote = calculateDeliveryQuote(nearest.area.branchId, latitude, longitude);
  assert.equal(quote.available, true);
  assert.equal(quote.shippingFee, 22000);
  assert.notEqual(quote.shippingFee, nearest.area.shippingFee, 'vị trí GPS phải tính phí theo cự ly, không chỉ sao chép phí vùng');
  assert.equal(findNearestSupportedDeliveryArea(areas, 0, 0), null);
  assert.equal(calculateDeliveryQuote(1, 0, 0).available, false);
});

test('đơn giao dùng cùng báo giá theo vị trí, xác nhận tổng tiền và không lưu tọa độ GPS chính xác', async () => {
  await resetAndLogin('admin');
  const coordinates = { latitude: 16.0736, longitude: 108.1517 };
  const quote = calculateDeliveryQuote(1, coordinates.latitude, coordinates.longitude);
  const placed = await api.dataRequest('/store/orders', { method: 'POST', body: {
    fullName: 'Khách kiểm thử GPS', phone: '0905111444', address: '12 Nguyễn Văn Linh',
    ward: 'Hòa Minh', deliveryAreaId: 5, deliveryCoordinates: coordinates,
    items: [{ productId: 1, quantity: 1 }],
  } });
  assert.equal(placed.order.shippingFee, quote.shippingFee);
  assert.equal(placed.order.estimatedDistanceKm, Math.round(quote.distanceKm * 10) / 10);
  const savedSale = api.getStoredDemoData().sales.find((sale) => sale.invoiceNo === placed.order.invoiceNo);
  assert.equal(savedSale.delivery.shippingFee, quote.shippingFee);
  assert.equal(savedSale.delivery.eta, quote.eta);
  assert.equal(Object.hasOwn(savedSale.delivery, 'latitude'), false);
  assert.equal(Object.hasOwn(savedSale.delivery, 'longitude'), false);
  assert.equal(Object.hasOwn(savedSale.delivery, 'deliveryCoordinates'), false);
  assert.notEqual(savedSale.delivery.shippingFee, api.getStoredDemoData().deliveryAreas.find((area) => area.id === 5).shippingFee);
});

test('đơn chọn MoMo/VNPAY sandbox ở trạng thái chờ thanh toán và không thể giao trước khi IPN xác nhận', async () => {
  for (const paymentMethod of ['momo_sandbox', 'vnpay_sandbox']) {
    await resetAndLogin('admin');
    const placed = await api.dataRequest('/store/orders', { method: 'POST', body: {
      fullName: 'Khách thử thanh toán online', phone: '0905111555', address: '12 Nguyễn Văn Linh',
      ward: 'Hải Châu', deliveryAreaId: 1, paymentMethod,
      items: [{ productId: 1, quantity: 1 }],
    } });
    assert.equal(placed.order.paymentMethod, paymentMethod);
    assert.equal(placed.order.paymentStatus, 'pending_payment');
    const snapshot = api.getStoredDemoData();
    const sale = snapshot.sales.find((item) => item.invoiceNo === placed.order.invoiceNo);
    assert.equal(sale.paymentProvider, paymentMethod === 'momo_sandbox' ? 'momo' : 'vnpay');
    assert.equal(snapshot.payments.find((item) => item.saleId === sale.id)?.method, paymentMethod);
    await expectReject(api.dataRequest(`/store/orders/${sale.id}/status`, { method: 'PATCH', body: { status: 'confirmed' } }), 409);
  }
});
function quantity(productId, branchId = 1) {
  const data = api.getStoredDemoData();
  return Number(data.stock.find((row) => row.productId === productId && row.branchId === branchId)?.quantity || 0);
}

test('đơn online có thể hủy, hoàn tồn đúng một lần và callback thanh toán muộn phải chuyển đối soát', async () => {
  await resetAndLogin('admin');
  const stockBefore = quantity(1, 1);
  const placed = await api.dataRequest('/store/orders', { method: 'POST', body: {
    fullName: 'Khách kiểm thử hủy đơn', phone: '0905111888', address: '12 Nguyễn Văn Linh',
    ward: 'Hải Châu', deliveryAreaId: 1, paymentMethod: 'momo_sandbox',
    items: [{ productId: 1, quantity: 1 }],
  } });
  const saleId = placed.order.id;
  assert.equal(quantity(1, 1), stockBefore - 1);

  await api.dataRequest(`/store/orders/${saleId}/status`, { method: 'PATCH', body: { status: 'cancelled' } });
  const cancelled = api.getStoredDemoData().sales.find((item) => item.id === saleId);
  assert.equal(cancelled.fulfillmentStatus, 'cancelled');
  assert.equal(cancelled.paymentStatus, 'cancelled');
  assert.equal(cancelled.inventoryReservationReleased, true);
  assert.equal(quantity(1, 1), stockBefore, 'staff cancellation must release the reserved unit');
  await expectReject(api.dataRequest(`/store/orders/${saleId}/status`, { method: 'PATCH', body: { status: 'cancelled' } }), 409);
  assert.equal(quantity(1, 1), stockBefore, 'duplicate cancellation must not restore inventory twice');

  const latePaid = await api.dataRequest('/internal/payment-settlement', { method: 'POST', body: {
    paymentId: '20261109paymentfixture00000000000000000001', orderId: placed.order.invoiceNo,
    provider: 'momo', status: 'paid', amount: placed.order.totalAmount, transactionId: 'MOMO-LATE-001',
  } });
  assert.equal(latePaid.status, 'manual_review');
  const afterLatePayment = api.getStoredDemoData().sales.find((item) => item.id === saleId);
  assert.equal(afterLatePayment.fulfillmentStatus, 'cancelled', 'a late gateway success must never resurrect a cancelled order');
  assert.equal(afterLatePayment.paymentStatus, 'paid_after_cancellation');
  assert.equal(afterLatePayment.paymentException.resolution, 'manual_review_required');
  const exceptionDetectedAt = afterLatePayment.paymentException.detectedAt;
  const auditEventsBeforeDuplicate = api.getStoredDemoData().auditLogs.filter((item) => item.action === 'store.payment_received_after_order_cancelled').length;
  const duplicateLatePaid = await api.dataRequest('/internal/payment-settlement', { method: 'POST', body: {
    paymentId: '20261109paymentfixture00000000000000000001', orderId: placed.order.invoiceNo,
    provider: 'momo', status: 'paid', amount: placed.order.totalAmount, transactionId: 'MOMO-LATE-001',
  } });
  assert.equal(duplicateLatePaid.status, 'manual_review');
  const afterDuplicateLatePayment = api.getStoredDemoData().sales.find((item) => item.id === saleId);
  assert.equal(afterDuplicateLatePayment.paymentException.detectedAt, exceptionDetectedAt);
  assert.equal(api.getStoredDemoData().auditLogs.filter((item) => item.action === 'store.payment_received_after_order_cancelled').length, auditEventsBeforeDuplicate,
    'duplicate late IPN delivery must not duplicate the reconciliation event');
  assert.equal(quantity(1, 1), stockBefore, 'late payment must not consume stock after cancellation');
});

test('đơn online tự hết hạn sau 15 phút và hoàn tồn/điểm/khuyến mãi idempotent', async () => {
  await resetAndLogin('admin');
  const stockBefore = quantity(1, 1);
  const placed = await api.dataRequest('/store/orders', { method: 'POST', body: {
    fullName: 'Khách kiểm thử TTL', phone: '0905111999', address: '12 Nguyễn Văn Linh',
    ward: 'Hải Châu', deliveryAreaId: 1, paymentMethod: 'vnpay_sandbox',
    items: [{ productId: 1, quantity: 1 }],
  } });
  assert.equal(quantity(1, 1), stockBefore - 1);

  const agedData = api.getStoredDemoData();
  const agedSale = agedData.sales.find((item) => item.id === placed.order.id);
  agedSale.createdAt = new Date(Date.now() - 16 * 60_000).toISOString();
  agedSale.paymentExpiresAt = new Date(Date.now() - 60_000).toISOString();
  window.localStorage.setItem(DATA_KEY, JSON.stringify(agedData));

  const expired = await api.dataRequest('/internal/orders/expire-pending', { method: 'POST', body: {} });
  assert.equal(expired.expiredCount, 1);
  assert.deepEqual(expired.invoiceNos, [placed.order.invoiceNo]);
  const sale = api.getStoredDemoData().sales.find((item) => item.id === placed.order.id);
  assert.equal(sale.paymentStatus, 'expired');
  assert.equal(sale.fulfillmentStatus, 'cancelled');
  assert.equal(sale.inventoryReservationReleased, true);
  assert.equal(quantity(1, 1), stockBefore);
  const secondSweep = await api.dataRequest('/internal/orders/expire-pending', { method: 'POST', body: {} });
  assert.equal(secondSweep.expiredCount, 0, 'repeated scheduler runs must not release stock a second time');
  assert.equal(quantity(1, 1), stockBefore);
});

test('consent được lưu tách biệt; notification outbox chỉ tạo kênh đã chọn và claim/retry idempotent', async () => {
  await resetAndLogin('admin');
  const envKeys = [
    'RESEND_API_KEY', 'EMSYSTEMS_EMAIL_FROM', 'EMSYSTEMS_PUBLIC_URL',
    'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_SMS_FROM',
    'ZALO_ZNS_ACCESS_TOKEN', 'ZALO_ZNS_TEMPLATE_ID_ORDER',
  ];
  const oldEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  try {
    for (const key of envKeys) delete process.env[key];
    const disabledProvidersOrder = await api.dataRequest('/store/orders', { method: 'POST', body: {
      fullName: 'Khách chưa bật provider', phone: '0905111666', email: 'guest@example.test',
      address: '12 Nguyễn Văn Linh', ward: 'Hải Châu', deliveryAreaId: 1,
      dataProcessingConsent: true, marketingConsent: false,
      notificationPreferences: { email: true, sms: true, zaloZns: true },
      items: [{ productId: 1, quantity: 1 }],
    } });
    let snapshot = api.getStoredDemoData();
    const disabledSale = snapshot.sales.find((item) => item.invoiceNo === disabledProvidersOrder.order.invoiceNo);
    assert.equal(snapshot.notificationOutbox.length, 0, 'unconfigured providers must not receive phantom queued sends');
    const disabledConsent = snapshot.dataConsents.find((item) => item.saleId === disabledSale.id);
    assert.equal(disabledConsent.processingConsent, true);
    assert.equal(disabledConsent.marketingConsent, false);

    process.env.RESEND_API_KEY = 'test-resend-key';
    process.env.EMSYSTEMS_EMAIL_FROM = 'orders@example.test';
    process.env.EMSYSTEMS_PUBLIC_URL = 'https://shop.example.test';
    process.env.TWILIO_ACCOUNT_SID = 'ACtest';
    process.env.TWILIO_AUTH_TOKEN = 'test-token';
    process.env.TWILIO_SMS_FROM = '+15005550006';
    const configuredProvidersOrder = await api.dataRequest('/store/orders', { method: 'POST', body: {
      fullName: 'Khách chọn email và SMS', phone: '0905111667', email: 'notify@example.test',
      address: '14 Nguyễn Văn Linh', ward: 'Hải Châu', deliveryAreaId: 1,
      dataProcessingConsent: true, marketingConsent: false,
      notificationPreferences: { email: true, sms: true, zaloZns: false },
      items: [{ productId: 2, quantity: 1 }],
    } });
    snapshot = api.getStoredDemoData();
    const queued = snapshot.notificationOutbox.filter((item) => item.eventType === 'order_placed');
    assert.equal(queued.length, 2);
    assert.deepEqual(queued.map((item) => item.channel).sort(), ['email', 'sms']);
    assert.ok(queued.every((item) => item.dedupeKey.includes(String(configuredProvidersOrder.order.id))));

    const firstClaim = await api.dataRequest('/internal/notifications/claim', { method: 'POST', body: { limit: 10 } });
    assert.equal(firstClaim.notifications.length, 2);
    const duplicateClaim = await api.dataRequest('/internal/notifications/claim', { method: 'POST', body: { limit: 10 } });
    assert.equal(duplicateClaim.notifications.length, 0, 'claimed notifications must not be dispatched twice concurrently');

    await api.dataRequest('/internal/notifications/complete', { method: 'POST', body: { id: firstClaim.notifications[0].id, success: true } });
    const oneRetry = await api.dataRequest('/internal/notifications/complete', { method: 'POST', body: { id: firstClaim.notifications[1].id, success: false } });
    assert.equal(oneRetry.status, 'pending');
    snapshot = api.getStoredDemoData();
    assert.equal(snapshot.notificationOutbox.find((item) => item.id === firstClaim.notifications[0].id).status, 'sent');
    assert.equal(snapshot.notificationOutbox.find((item) => item.id === firstClaim.notifications[1].id).attemptCount, 1);
  } finally {
    for (const key of envKeys) {
      if (oldEnv[key] === undefined) delete process.env[key];
      else process.env[key] = oldEnv[key];
    }
  }
});

test('consent bắt buộc fail-closed khi thiếu chủ thể kiểm soát dữ liệu hoặc khách chưa đồng ý', async () => {
  await resetAndLogin('admin');
  const envKeys = [
    'EMSYSTEMS_REQUIRE_DATA_CONSENT', 'EMSYSTEMS_LEGAL_OPERATOR_NAME',
    'EMSYSTEMS_LEGAL_REGISTERED_ADDRESS', 'EMSYSTEMS_LEGAL_EMAIL', 'EMSYSTEMS_LEGAL_HOTLINE',
  ];
  const previous = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  const body = {
    fullName: 'Khách thử consent', phone: '0905111888', address: '12 Nguyễn Văn Linh',
    ward: 'Hải Châu', deliveryAreaId: 1, items: [{ productId: 1, quantity: 1 }],
  };
  try {
    for (const key of envKeys) delete process.env[key];
    process.env.EMSYSTEMS_REQUIRE_DATA_CONSENT = 'true';
    await expectReject(api.dataRequest('/store/orders', { method: 'POST', body }), 503);

    process.env.EMSYSTEMS_LEGAL_OPERATOR_NAME = 'Công ty kiểm thử EMSystems';
    process.env.EMSYSTEMS_LEGAL_REGISTERED_ADDRESS = 'Đà Nẵng, Việt Nam';
    process.env.EMSYSTEMS_LEGAL_EMAIL = 'privacy@example.test';
    await expectReject(api.dataRequest('/store/orders', { method: 'POST', body }), 400);

    const accepted = await api.dataRequest('/store/orders', { method: 'POST', body: { ...body, dataProcessingConsent: true } });
    const snapshot = api.getStoredDemoData();
    const sale = snapshot.sales.find((item) => item.invoiceNo === accepted.order.invoiceNo);
    const consent = snapshot.dataConsents.find((item) => item.saleId === sale.id);
    assert.equal(consent.processingConsent, true);
    assert.equal(consent.marketingConsent, false);
    assert.equal(consent.locationConsent, false);
  } finally {
    for (const key of envKeys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});

test('IPN nội bộ xác nhận đơn online mà không cần redirect từ trình duyệt', async () => {
  await resetAndLogin('admin');
  const placed = await api.dataRequest('/store/orders', { method: 'POST', body: {
    fullName: 'Khách kiểm thử IPN', phone: '0905111777', address: '12 Nguyễn Văn Linh',
    ward: 'Hải Châu', deliveryAreaId: 1, paymentMethod: 'momo_sandbox',
    items: [{ productId: 1, quantity: 1 }],
  } });
  const settlement = {
    paymentId: '20261109paymentfixture00000000000000000002', orderId: placed.order.invoiceNo,
    provider: 'momo', status: 'paid', amount: placed.order.totalAmount, transactionId: 'MOMO-IPN-001',
  };
  const first = await api.dataRequest('/internal/payment-settlement', { method: 'POST', body: settlement });
  assert.equal(first.status, 'paid');
  assert.equal(first.order.paymentStatus, 'completed');
  const second = await api.dataRequest('/internal/payment-settlement', { method: 'POST', body: settlement });
  assert.equal(second.status, 'paid', 'duplicate IPN delivery must be idempotent');
  const saved = api.getStoredDemoData().sales.find((item) => item.id === placed.order.id);
  assert.equal(saved.paymentStatus, 'completed');
  assert.ok(saved.paymentConfirmedAt);
});

test('bảng nhân viên bị rỗng được khôi phục bằng dữ liệu mẫu để không mất quyền quản trị', async () => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  api.resetDemoData();
  const brokenSnapshot = api.getStoredDemoData();
  brokenSnapshot.users = [];
  window.localStorage.setItem(DATA_KEY, JSON.stringify(brokenSnapshot));
  window.sessionStorage.clear();

  // The server restores the initial account records; provision its credential
  // exactly as the one-time bootstrap flow does, rather than using a source hash.
  await api.dataRequest('/health');
  const recoveredSnapshot = api.getStoredDemoData();
  const recoveredAdmin = recoveredSnapshot.users.find((user) => user.username === 'admin');
  recoveredAdmin.passwordCredential = await createPasswordCredential(DEMO_PASSWORDS.admin);
  recoveredAdmin.credentialVersion = 1;
  window.localStorage.setItem(DATA_KEY, JSON.stringify(recoveredSnapshot));

  const login = await api.dataRequest('/auth/login', {
    method: 'POST',
    body: { username: 'admin', password: DEMO_PASSWORDS.admin },
  });
  assert.equal(login.user.username, 'admin');
  assert.equal(api.getStoredDemoData().users.length, 4);
});

test('CRUD lưu localStorage, tải lại dữ liệu và không ghi mật khẩu', async () => {
  await resetAndLogin();
  const created = await api.dataRequest('/products', { method: 'POST', body: {
    sku: 'TEST-LOCAL-01', name: 'Sản phẩm kiểm thử', costPrice: 1000, sellingPrice: 1500,
    warrantyMonths: 3, categoryId: 3, brandId: 4, supplierId: 1,
    description: 'Mô tả chi tiết sản phẩm', imageUrl: 'https://cdn.example.com/test-product.webp',
    images: ['https://cdn.example.com/test-product.webp'], technicalDetails: 'RAM: 8 GB\nBộ nhớ: 256 GB',
  } });
  const id = created.id;
  assert.ok(id > 0);
  assert.equal(api.getStoredDemoData().products.find((item) => item.id === id).name, 'Sản phẩm kiểm thử');
  assert.equal(api.getStoredDemoData().products.find((item) => item.id === id).description, 'Mô tả chi tiết sản phẩm');
  assert.deepEqual(api.getStoredDemoData().products.find((item) => item.id === id).images, ['https://cdn.example.com/test-product.webp']);
  assert.equal(window.localStorage.getItem(DATA_KEY).includes(DEMO_PASSWORDS.admin), false);
  await api.dataRequest('/products/' + id, { method: 'PATCH', body: {
    name: 'Sản phẩm đã sửa', sellingPrice: 1700, description: 'Mô tả đã cập nhật',
    imageUrl: 'https://cdn.example.com/updated.webp', images: ['https://cdn.example.com/updated.webp'],
    technicalDetails: 'RAM: 16 GB\nBộ nhớ: 512 GB',
  } });
  let stored = api.getStoredDemoData();
  assert.equal(stored.products.find((item) => item.id === id).name, 'Sản phẩm đã sửa');
  assert.equal(stored.products.find((item) => item.id === id).sellingPrice, 1700);
  assert.equal(stored.products.find((item) => item.id === id).description, 'Mô tả đã cập nhật');
  assert.equal(stored.products.find((item) => item.id === id).imageUrl, 'https://cdn.example.com/updated.webp');
  assert.equal(stored.products.find((item) => item.id === id).technicalDetails, 'RAM: 16 GB\nBộ nhớ: 512 GB');
  await api.dataRequest('/products/' + id, { method: 'DELETE' });
  stored = api.getStoredDemoData();
  assert.equal(stored.products.some((item) => item.id === id), false);
  assert.ok(window.localStorage.getItem(DATA_KEY));
});

test('từ chối URL ảnh sản phẩm có giao thức không an toàn', async () => {
  await resetAndLogin();
  await expectReject(api.dataRequest('/products', { method: 'POST', body: {
    sku: 'TEST-IMAGE-UNSAFE', name: 'Sản phẩm ảnh không an toàn', costPrice: 0, sellingPrice: 0,
    imageUrl: 'javascript:alert(1)', images: ['data:text/html,<script>alert(1)</script>'],
  } }), 400);
  assert.equal(api.getStoredDemoData().products.some((item) => item.sku === 'TEST-IMAGE-UNSAFE'), false);
  const originalImage = api.getStoredDemoData().products.find((item) => item.id === 1).imageUrl;
  await expectReject(api.dataRequest('/products/1', { method: 'PATCH', body: { imageUrl: 'data:text/html,bad' } }), 400);
  assert.equal(api.getStoredDemoData().products.find((item) => item.id === 1).imageUrl, originalImage);
});

test('đăng nhập chỉ thành công với mật khẩu đúng; nhập username admin hoặc mật khẩu sai không tạo phiên', async () => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  api.resetDemoData();

  // Phiên đời cũ đã được tạo khi login chưa kiểm tra mật khẩu phải hết hiệu lực sau bản sửa.
  window.sessionStorage.setItem('emsystems.demo.session.v1', JSON.stringify({ userId: 1 }));
  await expectReject(api.dataRequest('/auth/me'), 401);
  assert.equal(window.sessionStorage.getItem('emsystems.demo.session.v1'), null);

  await expectReject(api.dataRequest('/auth/login', { method: 'POST', body: {
    username: 'admin', password: 'admin',
  } }), 401);
  await expectReject(api.dataRequest('/auth/me'), 401);

  await expectReject(api.dataRequest('/auth/login', { method: 'POST', body: {
    username: 'not-a-user', password: DEMO_PASSWORDS.admin,
  } }), 401);
  await expectReject(api.dataRequest('/auth/me'), 401);

  await expectReject(api.dataRequest('/auth/login', { method: 'POST', body: {
    username: 'admin', password: `${DEMO_PASSWORDS.admin}wrong`,
  } }), 401);
  await expectReject(api.dataRequest('/auth/me'), 401);

  await loginStaff('admin');
  const session = await api.dataRequest('/auth/me');
  assert.equal(session.user.username, 'admin');
});

test('phiên v1/v2 cũ bị vô hiệu hóa sau khi nâng cấp cơ chế phiên', async () => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  api.resetDemoData();
  window.sessionStorage.setItem('emsystems.demo.session.v2', JSON.stringify({ userId: 1, authVersion: 2 }));
  await expectReject(api.dataRequest('/auth/me'), 401);
  assert.equal(window.sessionStorage.getItem('emsystems.demo.session.v2'), null);
  assert.equal(window.sessionStorage.getItem('emsystems.demo.session.v3'), null);
});

test('phiên nhân viên hết hạn sau 30 phút nhàn rỗi hoặc 12 giờ tuyệt đối', async () => {
  await resetAndLogin('admin');
  const sessionKey = 'emsystems.demo.session.v3';
  let session = JSON.parse(window.sessionStorage.getItem(sessionKey));
  session.issuedAt = Date.now() - 60 * 60 * 1000;
  session.lastActivityAt = Date.now() - 31 * 60 * 1000;
  window.sessionStorage.setItem(sessionKey, JSON.stringify(session));
  await expectReject(api.dataRequest('/auth/me'), 401);
  assert.equal(window.sessionStorage.getItem(sessionKey), null);
  assert.ok(api.getStoredDemoData().auditLogs.some((entry) => entry.action === 'auth.session_expired' && entry.details.reason === 'idle_timeout'));

  await loginStaff('admin');
  session = JSON.parse(window.sessionStorage.getItem(sessionKey));
  session.issuedAt = Date.now() - 13 * 60 * 60 * 1000;
  session.lastActivityAt = Date.now();
  window.sessionStorage.setItem(sessionKey, JSON.stringify(session));
  await expectReject(api.dataRequest('/auth/me'), 401);
  assert.equal(window.sessionStorage.getItem(sessionKey), null);
  assert.ok(api.getStoredDemoData().auditLogs.some((entry) => entry.action === 'auth.session_expired' && entry.details.reason === 'absolute_timeout'));
});

test('khóa tài khoản thu hồi phiên cũ; mở lại tài khoản không hồi sinh phiên đó', async () => {
  await resetAndLogin('manager');
  const data = api.getStoredDemoData();
  data.users.find((user) => user.username === 'manager').isActive = false;
  window.localStorage.setItem(DATA_KEY, JSON.stringify(data));
  await expectReject(api.dataRequest('/auth/me'), 401);
  assert.equal(window.sessionStorage.getItem('emsystems.demo.session.v3'), null);

  data.users.find((user) => user.username === 'manager').isActive = true;
  window.localStorage.setItem(DATA_KEY, JSON.stringify(data));
  await expectReject(api.dataRequest('/auth/me'), 401);
});

test('không báo đăng nhập thành công khi trình duyệt không lưu được sessionStorage', async () => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  api.resetDemoData();
  const bootstrapData = api.getStoredDemoData();
  const bootstrapAdmin = bootstrapData.users.find((user) => user.username === 'admin');
  bootstrapAdmin.passwordCredential = await createPasswordCredential(DEMO_PASSWORDS.admin);
  bootstrapAdmin.credentialVersion = 1;
  window.localStorage.setItem(DATA_KEY, JSON.stringify(bootstrapData));
  const originalSetItem = window.sessionStorage.setItem.bind(window.sessionStorage);
  window.sessionStorage.setItem = () => { throw new Error('session storage disabled'); };
  try {
    await expectReject(api.dataRequest('/auth/login', { method: 'POST', body: {
      username: 'admin', password: DEMO_PASSWORDS.admin,
    } }), 503);
  } finally {
    window.sessionStorage.setItem = originalSetItem;
  }
  await expectReject(api.dataRequest('/auth/me'), 401);
});

test('tài khoản không phải admin không được đọc danh bạ nhân viên qua API dữ liệu', async () => {
  await resetAndLogin('manager');
  await expectReject(api.dataRequest('/users'), 403);
  await expectReject(api.dataRequest('/users/1'), 403);
  await expectReject(api.dataRequest('/users', { method: 'POST', body: {
    username: 'illegalstaff', fullName: 'Tài khoản trái quyền', email: 'illegalstaff@example.test',
    role: 'employee', branchId: 1, password: 'TemporaryPass@2026', confirmPassword: 'TemporaryPass@2026',
  } }), 403);
  await expectReject(api.dataRequest('/users/3/status', { method: 'PATCH', body: { isActive: false } }), 403);
  const branches = await api.dataRequest('/branches');
  assert.ok(branches.data.length > 0, 'Quản lý vẫn được đọc danh sách chi nhánh phục vụ nghiệp vụ');
});

test('đăng nhập thành công/có lỗi được ghi nhật ký và cập nhật lần đăng nhập gần nhất, không ghi mật khẩu', async () => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  api.resetDemoData();

  await expectReject(api.dataRequest('/auth/login', { method: 'POST', body: {
    username: 'admin', password: 'wrong-password',
  } }), 401);
  let data = api.getStoredDemoData();
  assert.equal(data.auditLogs[0].action, 'auth.login_failed');
  assert.equal(data.auditLogs[0].details.attemptedUsername, 'admin');
  assert.equal(Object.hasOwn(data.auditLogs[0].details, 'password'), false);

  await loginStaff('admin');
  data = api.getStoredDemoData();
  const admin = data.users.find((item) => item.username === 'admin');
  assert.ok(admin.lastLoginAt);
  assert.equal(Number.isNaN(Date.parse(admin.lastLoginAt)), false);
  assert.ok(data.auditLogs.some((entry) => entry.action === 'auth.login_succeeded' && entry.userId === admin.id));
  assert.equal(JSON.stringify(data.auditLogs).includes(DEMO_PASSWORDS.admin), false);
});

test('tài khoản mới phải đổi mật khẩu tạm trước khi gọi nghiệp vụ và có thể đăng nhập lại bằng mật khẩu mới', async () => {
  await resetAndLogin('admin');
  const temporaryPassword = 'TempStaff@2026!First';
  const newPassword = 'PrivateStaff@2026!Changed';
  const created = await api.dataRequest('/users', { method: 'POST', body: {
    username: 'newstaff', fullName: 'Nhân viên mới', email: 'newstaff@example.test',
    role: 'employee', branchId: 1, password: temporaryPassword, confirmPassword: temporaryPassword,
  } });
  assert.equal(created.data.mustChangePassword, true);
  assert.equal(JSON.stringify(api.getStoredDemoData().users).includes(temporaryPassword), false);

  await api.dataRequest('/auth/logout', { method: 'POST' });
  const firstLogin = await api.dataRequest('/auth/login', { method: 'POST', body: { username: 'newstaff', password: temporaryPassword } });
  assert.equal(firstLogin.user.mustChangePassword, true);
  await expectReject(api.dataRequest('/dashboard/summary'), 403);

  await api.dataRequest('/auth/change-password', { method: 'POST', body: {
    currentPassword: temporaryPassword, newPassword, confirmPassword: newPassword,
  } });
  await expectReject(api.dataRequest('/auth/me'), 401);
  const nextLogin = await api.dataRequest('/auth/login', { method: 'POST', body: { username: 'newstaff', password: newPassword } });
  assert.equal(nextLogin.user.mustChangePassword, false);
  const dashboard = await api.dataRequest('/dashboard/summary');
  assert.ok(dashboard.summary);
});

test('không cho vô hiệu hóa quản trị viên đang hoạt động cuối cùng', async () => {
  await resetAndLogin('admin');
  await expectReject(api.dataRequest('/users/1/status', { method: 'PATCH', body: { isActive: false } }), 409);
  await expectReject(api.dataRequest('/users/1', { method: 'DELETE' }), 409);
  const data = api.getStoredDemoData();
  assert.equal(data.users.find((item) => item.id === 1).isActive, true);
  assert.equal(data.users.some((item) => item.id === 1), true);
});

test('JSON lưu hỏng được sao lưu và dữ liệu mẫu được khôi phục', async () => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.localStorage.setItem(DATA_KEY, '{invalid-json');
  const restored = api.getStoredDemoData();
  assert.ok(restored.products.length >= 5);
  assert.ok(restored.branches.length >= 2);
  assert.equal(window.localStorage.getItem(BACKUP_KEY), '{invalid-json');
  assert.doesNotThrow(() => JSON.parse(window.localStorage.getItem(DATA_KEY)));
  assert.match(api.getStorageNotice(), /bị lỗi định dạng/i);
});

test('khi localStorage bị chặn thì thông báo và giữ dữ liệu tạm mà không reload giả vờ', async () => {
  await resetAndLogin();
  const originalSetItem = window.localStorage.setItem.bind(window.localStorage);
  window.localStorage.setItem = () => { throw new Error('storage disabled'); };
  try {
    await expectReject(api.dataRequest('/products/1', { method: 'PATCH', body: { name: 'Tên trong bộ nhớ tạm' } }), 507);
    assert.equal(api.getStoredDemoData().products.find((item) => item.id === 1).name, 'Samsung Galaxy S7');
    assert.match(api.getStorageNotice(), /chỉ lưu tạm trong bộ nhớ/i);
    const beforeOrderCount = api.getStoredDemoData().sales.length;
    const beforeStock = quantity(1);
    await expectReject(api.dataRequest('/store/orders', { method: 'POST', body: {
      fullName: 'Khách kiểm thử', phone: '0905999888',
      address: '12 Nguyễn Văn Linh', ward: 'Thạch Thang', deliveryAreaId: 1,
      items: [{ productId: 1, quantity: 1 }],
    } }), 507);
    assert.equal(api.getStoredDemoData().sales.length, beforeOrderCount);
    assert.equal(quantity(1), beforeStock);
    const persisted = api.resetDemoData();
    assert.equal(persisted, false);
    assert.equal(api.getStoredDemoData().products.find((item) => item.id === 1).name, 'Samsung Galaxy S7');
    assert.match(api.getStorageNotice(), /đặt lại trong bộ nhớ tạm/i);
  } finally {
    window.localStorage.setItem = originalSetItem;
  }
});

test('bán hàng kiểm tra tồn, tính giá chuẩn và cho đổi trả nhiều lần đúng giới hạn', async () => {
  await resetAndLogin();
  await expectReject(api.dataRequest('/sales', { method: 'POST', body: {
    branchId: 1, paymentMethod: 'cash', items: [{ productId: 2, quantity: 999, unitPrice: 1 }],
  } }), 409);
  const startStock = quantity(2);
  const result = await api.dataRequest('/sales', { method: 'POST', body: {
    branchId: 1, customerId: 1, paymentMethod: 'cash', items: [{ productId: 2, quantity: 2, unitPrice: 1 }],
  } });
  const sale = result.sale;
  assert.equal(sale.items[0].unitPrice, 18990000);
  assert.equal(sale.totalAmount, 37980000);
  assert.equal(quantity(2), startStock - 2);
  const returnDetails = await api.dataRequest('/sales/' + sale.id);
  assert.equal(returnDetails.items[0].sku, 'PH-APL-IP13P');
  assert.equal(returnDetails.items[0].soldQuantity, 2);
  assert.equal(returnDetails.items[0].returnedQuantity, 0);
  assert.equal(returnDetails.items[0].returnableQuantity, 2);
  const first = await api.dataRequest('/sales/' + sale.id + '/returns', { method: 'POST', body: {
    reason: 'Kiểm thử', items: [{ saleItemId: sale.items[0].id, quantity: 1 }],
  } });
  assert.equal(first.return.refundAmount, 18990000);
  assert.equal(quantity(2), startStock - 1);
  const second = await api.dataRequest('/sales/' + sale.id + '/returns', { method: 'POST', body: {
    reason: 'Trả nốt', items: [{ saleItemId: sale.items[0].id, quantity: 1 }],
  } });
  assert.equal(first.return.refundAmount + second.return.refundAmount, sale.totalAmount);
  assert.equal(quantity(2), startStock);
  await expectReject(api.dataRequest('/sales/' + sale.id + '/returns', { method: 'POST', body: {
    items: [{ saleItemId: sale.items[0].id, quantity: 1 }],
  } }), 409);
  assert.equal(api.getStoredDemoData().returns.length, 2);
});

test('điều chuyển nháp, xuất và nhận cập nhật tồn đúng một lần', async () => {
  await resetAndLogin();
  const fromBefore = quantity(1, 1);
  const toBefore = quantity(1, 2);
  const created = await api.dataRequest('/inventory/transfers', { method: 'POST', body: {
    fromBranchId: 1, toBranchId: 2, note: 'Kiểm thử điều chuyển', items: [{ productId: 1, quantity: 2 }],
  } });
  const id = created.data.id;
  assert.equal(created.data.status, 'draft');
  assert.equal(quantity(1, 1), fromBefore);
  assert.equal(quantity(1, 2), toBefore);
  await api.dataRequest('/inventory/transfers/' + id + '/ship', { method: 'POST' });
  assert.equal(quantity(1, 1), fromBefore - 2);
  await expectReject(api.dataRequest('/inventory/transfers/' + id + '/ship', { method: 'POST' }), 409);
  assert.equal(quantity(1, 1), fromBefore - 2);
  await api.dataRequest('/inventory/transfers/' + id + '/receive', { method: 'POST' });
  assert.equal(quantity(1, 2), toBefore + 2);
  await expectReject(api.dataRequest('/inventory/transfers/' + id + '/receive', { method: 'POST' }), 409);
  assert.equal(quantity(1, 2), toBefore + 2);
});

test('thanh toán mô phỏng không thu tiền thật và chặn hoàn tất trùng', async () => {
  await resetAndLogin();
  const startStock = quantity(5);
  const result = await api.dataRequest('/sales', { method: 'POST', body: {
    branchId: 1, customerId: 1, paymentMethod: 'bank_transfer', items: [{ productId: 5, quantity: 1 }],
  } });
  assert.equal(result.sale.status, 'draft');
  assert.equal(result.sale.paymentStatus, 'pending');
  assert.equal(quantity(5), startStock);
  const url = '/payments/mock/' + result.sale.invoiceNo + '/complete';
  const paid = await api.dataRequest(url, { method: 'POST', body: { success: true } });
  assert.equal(paid.status, 'simulated-completed');
  assert.equal(quantity(5), startStock - 1);
  await expectReject(api.dataRequest(url, { method: 'POST', body: { success: true } }), 409);
  assert.equal(quantity(5), startStock - 1);
  assert.equal(api.getStoredDemoData().payments.find((payment) => payment.saleId === result.sale.id).status, 'simulated-completed');
});

test('thanh toán mô phỏng thất bại/hủy không thu tiền và không giảm tồn', async () => {
  await resetAndLogin();
  const startStock = quantity(6);
  const created = await api.dataRequest('/sales', { method: 'POST', body: {
    branchId: 1, paymentMethod: 'bank_transfer', items: [{ productId: 6, quantity: 1 }],
  } });
  const url = '/payments/mock/' + created.sale.invoiceNo + '/complete';
  const result = await api.dataRequest(url, { method: 'POST', body: {
    success: false,
  } });
  assert.equal(result.status, 'cancelled');
  assert.equal(quantity(6), startStock);
  const state = api.getStoredDemoData();
  assert.equal(state.sales.find((sale) => sale.id === created.sale.id).paymentStatus, 'failed');
  await expectReject(api.dataRequest(url, { method: 'POST', body: {
    success: true,
  } }), 409);
  assert.equal(quantity(6), startStock);
});

test('báo cáo có doanh thu ròng, giá vốn và lợi nhuận ước tính', async () => {
  await resetAndLogin();
  const result = await api.dataRequest('/reports/summary?dateFrom=2000-01-01&dateTo=2100-01-01');
  assert.ok(result.summary.grossRevenue >= result.summary.netRevenue);
  assert.equal(result.summary.grossRevenue - result.summary.refundedAmount, result.summary.netRevenue);
  assert.equal(result.summary.grossProfit, result.summary.netRevenue - result.summary.costOfGoods);
  assert.ok(Array.isArray(result.revenueByDay));
  assert.ok(result.summary.totalUnits > 0);
  assert.ok(result.topProducts.every((product) => Number.isFinite(product.netQuantity) && Number.isFinite(product.netSales)));
  assert.equal(result.period.branchId, null);
});

test('phiếu nhập nháp không đổi tồn; xác nhận nhập đúng một lần', async () => {
  await resetAndLogin();
  const before = quantity(2, 1);
  const created = await api.dataRequest('/purchase-receipts', { method: 'POST', body: {
    supplierId: 1, branchId: 1, note: 'Test nhận hàng', items: [{ productId: 2, quantity: 3, unitCost: 100 }],
  } });
  assert.equal(created.data.status, 'draft');
  assert.equal(created.data.totalAmount, 300);
  assert.equal(quantity(2, 1), before);
  await api.dataRequest('/purchase-receipts/' + created.id + '/confirm', { method: 'POST' });
  assert.equal(quantity(2, 1), before + 3);
  await expectReject(api.dataRequest('/purchase-receipts/' + created.id + '/confirm', { method: 'POST' }), 409);
  assert.equal(quantity(2, 1), before + 3);
});

test('khuyến mãi có ngày hợp lệ và chỉ ghi nhận lượt dùng khi đơn hoàn tất', async () => {
  await resetAndLogin();
  const startAt = new Date(Date.now() - 60000).toISOString();
  const endAt = new Date(Date.now() + 86400000).toISOString();
  const created = await api.dataRequest('/promotions', { method: 'POST', body: {
    code: 'TEST10', discountType: 'percent', discountValue: 10, minimumOrder: 0,
    startAt, endAt, usageLimit: 1, isActive: true,
  } });
  assert.equal(created.data.code, 'TEST10');
  const startStock = quantity(5);
  const sale = await api.dataRequest('/sales', { method: 'POST', body: {
    branchId: 1, paymentMethod: 'cash', promotionCode: 'TEST10',
    items: [{ productId: 5, quantity: 1 }],
  } });
  assert.equal(sale.sale.subtotal, 290000);
  assert.equal(sale.sale.discountAmount, 29000);
  assert.equal(sale.sale.totalAmount, 261000);
  assert.equal(quantity(5), startStock - 1);
  assert.equal(api.getStoredDemoData().promotions.find((item) => item.code === 'TEST10').usedCount, 1);
  await expectReject(api.dataRequest('/sales', { method: 'POST', body: {
    branchId: 1, paymentMethod: 'cash', promotionCode: 'TEST10', items: [{ productId: 6, quantity: 1 }],
  } }), 400);
});

test('chốt kiểm kê chỉ điều chỉnh phần chênh lệch một lần', async () => {
  await resetAndLogin();
  const before = quantity(3, 1);
  const created = await api.dataRequest('/inventory/counts', { method: 'POST', body: {
    branchId: 1, note: 'Test kiểm kê', items: [{ productId: 3 }],
  } });
  const countId = created.id;
  await api.dataRequest('/inventory/counts/' + countId + '/items', { method: 'PATCH', body: {
    items: [{ productId: 3, countedQuantity: before + 2 }],
  } });
  const finalized = await api.dataRequest('/inventory/counts/' + countId + '/complete', { method: 'POST' });
  assert.equal(finalized.adjustmentCount, 1);
  assert.equal(quantity(3, 1), before + 2);
  await expectReject(api.dataRequest('/inventory/counts/' + countId + '/complete', { method: 'POST' }), 409);
  assert.equal(quantity(3, 1), before + 2);
});

test('vai trò chi nhánh hiển thị tồn kho theo phạm vi demo', async () => {
  await resetAndLogin('manager');
  const products = await api.dataRequest('/products?page=1&pageSize=100');
  const product = products.data.find((item) => item.id === 1);
  assert.equal(product.stock, 11);
  const otherBranch = await api.dataRequest('/inventory/stock?branchId=2');
  assert.equal(otherBranch.data.length, 0);
});

test('cửa hàng xem được trước đăng nhập và khách vãng lai đặt giao hàng không tích điểm', async () => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  api.resetDemoData();
  const publicProducts = await api.dataRequest('/store/products?page=1&pageSize=100');
  const deliveryAreas = await api.dataRequest('/store/delivery-areas');
  const promotions = await api.dataRequest('/store/promotions');
  assert.ok(publicProducts.data.length > 0);
  assert.ok(deliveryAreas.data.some((area) => area.city === 'Đà Nẵng'));
  assert.ok(promotions.data.some((promo) => promo.code === 'TECH50'));

  const before = quantity(5, 1);
  await expectReject(api.dataRequest('/store/orders', { method: 'POST', body: {
    fullName: 'Khách Kiểm Thử', phone: '123', address: '12 Nguyễn Văn Linh',
    ward: 'Thạch Thang', deliveryAreaId: 1, items: [{ productId: 5, quantity: 1 }],
  } }), 400);

  const placed = await api.dataRequest('/store/orders', { method: 'POST', body: {
    fullName: 'Khách Kiểm Thử', phone: '0905999888', email: '',
    address: '12 Nguyễn Văn Linh', ward: 'Thạch Thang', deliveryAreaId: 1,
    note: 'Gọi trước khi giao', items: [{ productId: 5, quantity: 1 }],
  } });
  assert.match(placed.order.invoiceNo, /^WEB-/);
  assert.equal(placed.order.subtotal, 290000);
  assert.equal(placed.order.shippingFee, 15000);
  assert.equal(placed.order.totalAmount, 305000);
  assert.match(placed.order.notice, /không được tích điểm/i);
  assert.equal(placed.order.memberCustomerId, null);
  assert.equal(quantity(5, 1), before - 1);

  const tracked = await api.dataRequest('/store/orders/track?orderCode=' + placed.order.invoiceNo + '&phone=0905-999-888');
  assert.equal(tracked.order.status, 'pending_confirmation');
  assert.equal(tracked.order.delivery.phone, '0905999888');
  assert.equal(tracked.order.delivery.address, '12 Nguyễn Văn Linh');
  assert.match(tracked.order.memberPointsNotice, /khách vãng lai/i);

  await loginStaff('admin');
  await api.dataRequest('/store/orders/' + placed.order.id + '/status', { method: 'PATCH', body: { status: 'cancelled' } });
  assert.equal(quantity(5, 1), before);
  await expectReject(api.dataRequest('/store/orders/' + placed.order.id + '/status', { method: 'PATCH', body: { status: 'cancelled' } }), 409);
  assert.equal(quantity(5, 1), before);
});

test('đóng API đăng ký/đăng nhập thành viên chỉ bằng số điện thoại', async () => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  api.resetDemoData();
  const customerCount = api.getStoredDemoData().customers.length;
  await expectReject(api.dataRequest('/store/member/login', { method: 'POST', body: { phone: '0905123456' } }), 410);
  await expectReject(api.dataRequest('/store/member/register', { method: 'POST', body: {
    fullName: 'Thành viên kiểm thử', phone: '0905123456', email: 'member@example.test',
  } }), 410);
  assert.equal(api.getStoredDemoData().customers.length, customerCount, 'legacy endpoints must not create or mutate customer profiles');
  await expectReject(api.dataRequest('/store/member/me'), 401);
});

test('thành viên chỉ tích điểm sau giao thành công và không được cộng lặp', async () => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  api.resetDemoData();
  const memberLogin = await registerMemberAccount();
  assert.equal(memberLogin.member.isMember, true);
  const pointsBefore = memberLogin.member.loyaltyPoints;
  const stockBefore = quantity(2, 1);

  const placed = await api.dataRequest('/store/orders', { method: 'POST', body: {
    fullName: memberLogin.member.fullName, phone: memberLogin.member.phone,
    email: memberLogin.member.email, address: '12 Nguyễn Văn Linh',
    ward: 'Thạch Thang', deliveryAreaId: 1,
    items: [{ productId: 2, quantity: 1 }],
  } });
  assert.equal(placed.order.memberCustomerId, memberLogin.member.id);
  assert.equal(placed.order.pointsExpectedOnDelivery, Math.floor(18990000 / 10000));
  assert.equal(api.getStoredDemoData().customers.find((row) => row.id === memberLogin.member.id).loyaltyPoints, pointsBefore);
  assert.equal(quantity(2, 1), stockBefore - 1);

  await loginStaff('admin');
  for (const status of ['confirmed', 'preparing', 'shipping', 'delivered']) {
    await api.dataRequest('/store/orders/' + placed.order.id + '/status', { method: 'PATCH', body: { status } });
  }
  const delivered = api.getStoredDemoData().sales.find((sale) => sale.id === placed.order.id);
  assert.equal(delivered.fulfillmentStatus, 'delivered');
  assert.equal(delivered.loyaltyPointsAwarded, true);
  assert.equal(delivered.loyaltyPointsEarned, Math.floor(18990000 / 10000));
  const memberAfterDelivery = api.getStoredDemoData().customers.find((row) => row.id === memberLogin.member.id);
  assert.equal(memberAfterDelivery.loyaltyPoints, pointsBefore + Math.floor(18990000 / 10000));
  assert.equal(quantity(2, 1), stockBefore - 1);
  await expectReject(api.dataRequest('/store/orders/' + placed.order.id + '/status', { method: 'PATCH', body: { status: 'delivered' } }), 409);
  assert.equal(api.getStoredDemoData().customers.find((row) => row.id === memberLogin.member.id).loyaltyPoints, pointsBefore + Math.floor(18990000 / 10000));
});

test('nhập sản phẩm DummyJSON là bản nháp idempotent; chỉ bán sau khi đặt giá, nhận hàng và kích hoạt', async () => {
  await resetAndLogin('admin');
  const apiProduct = {
    id: 9091, title: 'QA Smartphone from DummyJSON', description: 'Sample device for import test',
    category: 'smartphones', price: 299.99, rating: 4.4, brand: 'Samsung',
    sku: 'SMA-QA-9091',
    thumbnail: 'https://cdn.dummyjson.com/product-images/smartphones/qa-phone/thumbnail.webp',
    images: ['https://cdn.dummyjson.com/product-images/smartphones/qa-phone/1.webp'],
    tags: ['phones', 'smartphone'], weight: 0.18,
    dimensions: { width: 7, height: 15, depth: 0.8 },
    warrantyInformation: 'One year warranty', shippingInformation: 'Ships in one week',
    returnPolicy: 'No return', availabilityStatus: 'In Stock', minimumOrderQuantity: 1,
    reviews: [{ rating: 4, comment: 'Looks good', date: '2026-10-01', reviewerName: 'Sample Reviewer', reviewerEmail: 'private@example.test' }],
  };
  const imported = await api.dataRequest('/catalogs/dummyjson/import', { method: 'POST', body: { products: [apiProduct] } });
  assert.equal(imported.created.length, 1);
  const productId = imported.created[0].id;
  const draft = api.getStoredDemoData().products.find((item) => item.id === productId);
  assert.equal(draft.name, apiProduct.title);
  assert.equal(draft.sellingPrice, 0);
  assert.equal(draft.costPrice, 0);
  assert.equal(draft.isActive, false);
  assert.equal(draft.externalSource, 'dummyjson');
  assert.deepEqual(draft.tags, ['phones', 'smartphone']);
  assert.equal(draft.weight, 0.18);
  assert.deepEqual(draft.dimensions, { width: 7, height: 15, depth: 0.8 });
  assert.equal(draft.warrantyInformation, 'One year warranty');
  assert.equal(draft.shippingInformation, 'Ships in one week');
  assert.equal(draft.returnPolicy, 'No return');
  assert.equal(draft.availabilityStatus, 'In Stock');
  assert.equal(draft.minimumOrderQuantity, 1);
  assert.deepEqual(draft.reviews, [{ rating: 4, comment: 'Looks good', date: '2026-10-01', reviewerName: 'Sample Reviewer' }]);
  assert.equal(quantity(productId, 1), 0);

  const duplicate = await api.dataRequest('/catalogs/dummyjson/import', { method: 'POST', body: { products: [apiProduct] } });
  assert.equal(duplicate.created.length, 0);
  assert.equal(duplicate.skipped.length, 1);
  await expectReject(api.dataRequest('/store/orders', { method: 'POST', body: {
    fullName: 'QA Customer', phone: '0905111222', address: '12 Nguyễn Văn Linh',
    ward: 'Thạch Thang', deliveryAreaId: 1, items: [{ productId, quantity: 1 }],
  } }), 409);

  await api.dataRequest('/products/' + productId, { method: 'PATCH', body: {
    costPrice: 5000000, sellingPrice: 6500000, isActive: true,
  } });
  const receipt = await api.dataRequest('/purchase-receipts', { method: 'POST', body: {
    supplierId: 1, branchId: 1, items: [{ productId, quantity: 2, unitCost: 5000000 }],
  } });
  await api.dataRequest('/purchase-receipts/' + receipt.id + '/confirm', { method: 'POST' });
  assert.equal(quantity(productId, 1), 2);
  const storefront = await api.dataRequest('/store/products?page=1&pageSize=100');
  const retailProduct = storefront.data.find((item) => item.id === productId);
  assert.ok(retailProduct);
  assert.equal(retailProduct.availableStock, true, 'public product data exposes only availability, never precise inventory counts');
  assert.equal(Object.hasOwn(retailProduct, 'stock'), false);
  assert.equal(Object.hasOwn(retailProduct, 'stockByBranch'), false);
  assert.equal(retailProduct.sellingPrice, 6500000);
  assert.equal(retailProduct.dummyJsonId, 9091);
  assert.equal(retailProduct.description, apiProduct.description);
  assert.deepEqual(retailProduct.tags, apiProduct.tags);
  assert.equal(retailProduct.reviewCount, 0, 'unverified third-party sample reviews must not be presented as verified EMSystems customer reviews');
  assert.deepEqual(retailProduct.reviews, [], 'only reviews linked to a delivered customer order may appear publicly');
  assert.equal(Object.hasOwn(retailProduct, 'costPrice'), false, 'public product must not expose internal cost');
  assert.equal(Object.hasOwn(retailProduct, 'supplierId'), false, 'public product must not expose supplier relations');
  assert.equal(Object.hasOwn(retailProduct, 'externalPriceUsd'), false, 'API USD source price must not become storefront price data');

  const placed = await api.dataRequest('/store/orders', { method: 'POST', body: {
    fullName: 'QA Customer', phone: '0905111222', address: '12 Nguyễn Văn Linh',
    ward: 'Thạch Thang', deliveryAreaId: 1, items: [{ productId, quantity: 1 }],
  } });
  assert.equal(placed.order.subtotal, 6500000);
  assert.equal(quantity(productId, 1), 1);

  const tabletImport = await api.dataRequest('/catalogs/dummyjson/import', { method: 'POST', body: {
    products: [{ id: 9092, title: 'QA Tablet from DummyJSON', category: 'tablets', price: 599.99, sku: 'TAB-QA-9092', thumbnail: 'https://cdn.dummyjson.com/product-images/tablets/qa-tablet/thumbnail.webp' }],
  } });
  assert.equal(tabletImport.created.length, 1);
  const importedTablet = api.getStoredDemoData().products.find((item) => item.dummyJsonId === 9092);
  assert.equal(importedTablet.categoryName, 'Máy tính bảng');
  assert.equal(importedTablet.categoryId, api.getStoredDemoData().categories.find((category) => category.name === 'Máy tính bảng').id);
  assert.equal(importedTablet.isActive, false);
});

test('schema v3 được nâng cấp lên v7, bổ sung tablet và catalog 30 sản phẩm mà không ghi đè dữ liệu đã sửa', async () => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  api.resetDemoData();
  const oldData = api.getStoredDemoData();
  oldData.meta.schemaVersion = 3;
  oldData.categories = oldData.categories.filter((category) => category.name !== 'Máy tính bảng');
  oldData.products[0].name = 'Tên do người dùng tự chỉnh';
  window.localStorage.setItem(DATA_KEY, JSON.stringify(oldData));

  const migrated = api.getStoredDemoData();
  const tablet = migrated.categories.find((category) => category.name === 'Máy tính bảng');
  assert.equal(migrated.meta.schemaVersion, 7);
  assert.equal(migrated.products.length, 30, 'sample catalog should contain 30 products');
  assert.ok(tablet);
  assert.equal(tablet.id, 4);
  assert.equal(migrated.nextIds.categories, 5);
  assert.equal(migrated.products[0].name, 'Tên do người dùng tự chỉnh');
  assert.equal(migrated.products[0].sellingPrice, oldData.products[0].sellingPrice);
});

test('hủy đơn thành viên hoàn lại điểm đã sử dụng và nhả mã ưu đãi một lần', async () => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  api.resetDemoData();
  const memberLogin = await registerMemberAccount();
  const pointsBefore = memberLogin.member.loyaltyPoints;
  const placed = await api.dataRequest('/store/orders', { method: 'POST', body: {
    fullName: memberLogin.member.fullName, phone: memberLogin.member.phone,
    address: '12 Nguyễn Văn Linh', ward: 'Thạch Thang', deliveryAreaId: 1,
    promotionCode: 'THANHVIEN5', usePoints: true,
    items: [{ productId: 2, quantity: 1 }],
  } });
  assert.ok(placed.order.pointsDiscountAmount > 0);
  assert.equal(api.getStoredDemoData().promotions.find((row) => row.code === 'THANHVIEN5').usedCount, 1);
  assert.equal(api.getStoredDemoData().customers.find((row) => row.id === memberLogin.member.id).loyaltyPoints, pointsBefore - placed.order.pointsDiscountAmount / 100);

  await loginStaff('admin');
  await api.dataRequest('/store/orders/' + placed.order.id + '/status', { method: 'PATCH', body: { status: 'cancelled' } });
  const afterCancel = api.getStoredDemoData();
  assert.equal(afterCancel.customers.find((row) => row.id === memberLogin.member.id).loyaltyPoints, pointsBefore);
  assert.equal(afterCancel.promotions.find((row) => row.code === 'THANHVIEN5').usedCount, 0);
  await expectReject(api.dataRequest('/store/orders/' + placed.order.id + '/status', { method: 'PATCH', body: { status: 'cancelled' } }), 409);
  assert.equal(api.getStoredDemoData().customers.find((row) => row.id === memberLogin.member.id).loyaltyPoints, pointsBefore);
});


test('dữ liệu mẫu giữ đúng khóa liên kết giữa catalog, hóa đơn, biến động kho và bảo hành', async () => {
  await resetAndLogin();
  const data = api.getStoredDemoData();
  const product = data.products.find((item) => item.id === 1);
  const seedSale = data.sales.find((item) => item.id === 1);
  const seedMovement = data.movements.find((item) => item.referenceCode === seedSale.invoiceNo);
  const seedWarranty = data.warranties.find((item) => item.saleId === seedSale.id);
  assert.equal(seedSale.items[0].productId, product.id);
  assert.equal(seedSale.items[0].productName, product.name);
  assert.equal(seedMovement.productId, product.id);
  assert.equal(seedMovement.sku, product.sku);
  assert.equal(seedWarranty.productId, product.id);
  assert.equal(seedWarranty.productName, product.name);
  for (const record of data.sales) {
    assert.ok(data.branches.some((branch) => branch.id === record.branchId));
    for (const line of record.items || []) assert.ok(data.products.some((item) => item.id === line.productId));
  }
});

test('POS từ chối chi nhánh, phương thức thanh toán, dòng hàng và liên kết sản phẩm không hợp lệ', async () => {
  await resetAndLogin();
  const countBefore = api.getStoredDemoData().sales.length;
  await expectReject(api.dataRequest('/sales', { method: 'POST', body: {
    branchId: 999, paymentMethod: 'cash', items: [{ productId: 2, quantity: 1 }],
  } }), 409);
  await expectReject(api.dataRequest('/sales', { method: 'POST', body: {
    branchId: 1, paymentMethod: 'crypto', items: [{ productId: 2, quantity: 1 }],
  } }), 400);
  await expectReject(api.dataRequest('/sales', { method: 'POST', body: {
    branchId: 1, paymentMethod: 'cash', items: [null],
  } }), 400);
  await expectReject(api.dataRequest('/products/1', { method: 'PATCH', body: { id: 999, name: 'Không được đổi ID' } }), 400);
  await expectReject(api.dataRequest('/products/1', { method: 'PATCH', body: { sku: 'PH-APL-IP13P' } }), 409);
  await expectReject(api.dataRequest('/products/1', { method: 'PATCH', body: { categoryId: 999 } }), 400);
  assert.equal(api.getStoredDemoData().sales.length, countBefore);
  assert.equal(api.getStoredDemoData().products.find((item) => item.id === 1).name, 'Samsung Galaxy S7');
});

test('mã khuyến mãi giới hạn một lượt được giữ khi chờ thanh toán và nhả khi giao dịch thất bại', async () => {
  await resetAndLogin();
  const now = Date.now();
  await api.dataRequest('/promotions', { method: 'POST', body: {
    code: 'ONE-USE-QA', discountType: 'amount', discountValue: 1000,
    minimumOrder: 0, startAt: new Date(now - 60000).toISOString(),
    endAt: new Date(now + 3600000).toISOString(), usageLimit: 1, isActive: true,
  } });
  const startStock = quantity(2);
  const first = await api.dataRequest('/sales', { method: 'POST', body: {
    branchId: 1, customerId: 1, paymentMethod: 'bank_transfer', promotionCode: 'ONE-USE-QA',
    items: [{ productId: 2, quantity: 1 }],
  } });
  let promotion = api.getStoredDemoData().promotions.find((item) => item.code === 'ONE-USE-QA');
  assert.equal(promotion.reservedCount, 1);
  assert.equal(promotion.usedCount, 0);
  await expectReject(api.dataRequest('/sales', { method: 'POST', body: {
    branchId: 1, customerId: 1, paymentMethod: 'bank_transfer', promotionCode: 'ONE-USE-QA',
    items: [{ productId: 2, quantity: 1 }],
  } }), 400);
  await api.dataRequest('/payments/mock/' + first.sale.invoiceNo + '/complete', {
    method: 'POST', body: { success: false },
  });
  promotion = api.getStoredDemoData().promotions.find((item) => item.code === 'ONE-USE-QA');
  assert.equal(promotion.reservedCount, 0);
  assert.equal(promotion.usedCount, 0);
  assert.equal(quantity(2), startStock);

  const second = await api.dataRequest('/sales', { method: 'POST', body: {
    branchId: 1, customerId: 1, paymentMethod: 'bank_transfer', promotionCode: 'ONE-USE-QA',
    items: [{ productId: 2, quantity: 1 }],
  } });
  await api.dataRequest('/payments/mock/' + second.sale.invoiceNo + '/complete', {
    method: 'POST', body: { success: true },
  });
  promotion = api.getStoredDemoData().promotions.find((item) => item.code === 'ONE-USE-QA');
  assert.equal(promotion.reservedCount, 0);
  assert.equal(promotion.usedCount, 1);
  assert.equal(quantity(2), startStock - 1);
  await expectReject(api.dataRequest('/sales', { method: 'POST', body: {
    branchId: 1, customerId: 1, paymentMethod: 'cash', promotionCode: 'ONE-USE-QA',
    items: [{ productId: 2, quantity: 1 }],
  } }), 400);
});

test('thành viên chỉ nhận điểm khi bán thành công; đổi trả hoàn tồn và thu hồi điểm một lần', async () => {
  await resetAndLogin();
  const before = api.getStoredDemoData().customers.find((item) => item.id === 1).loyaltyPoints;
  const beforeStock = quantity(1);
  const result = await api.dataRequest('/sales', { method: 'POST', body: {
    branchId: 1, customerId: 1, paymentMethod: 'cash', items: [{ productId: 1, quantity: 1 }],
  } });
  const sale = result.sale;
  const earned = Math.floor(sale.totalAmount / 10000);
  assert.equal(sale.loyaltyPointsEarned, earned);
  assert.equal(api.getStoredDemoData().customers.find((item) => item.id === 1).loyaltyPoints, before + earned);
  const returned = await api.dataRequest('/sales/' + sale.id + '/returns', {
    method: 'POST', body: { reason: 'Kiểm thử đổi trả', items: [{ saleItemId: sale.items[0].id, quantity: 1 }] },
  });
  assert.equal(returned.return.refundAmount, sale.totalAmount);
  assert.equal(api.getStoredDemoData().sales.find((item) => item.id === sale.id).paymentStatus, 'refunded');
  assert.equal(api.getStoredDemoData().customers.find((item) => item.id === 1).loyaltyPoints, before);
  assert.equal(quantity(1), beforeStock);
  await expectReject(api.dataRequest('/sales/' + sale.id + '/returns', {
    method: 'POST', body: { reason: 'Gửi trùng', items: [{ saleItemId: sale.items[0].id, quantity: 1 }] },
  }), 409);
  assert.equal(api.getStoredDemoData().customers.find((item) => item.id === 1).loyaltyPoints, before);
});

test('bảo hành theo đúng trạng thái; không cho xóa cứng dữ liệu đã có giao dịch liên quan', async () => {
  await resetAndLogin();
  await expectReject(api.dataRequest('/warranties/1', { method: 'PATCH', body: {
    status: 'completed', issueDescription: 'Lỗi màn hình', resolution: 'Đã sửa xong',
  } }), 409);
  await expectReject(api.dataRequest('/warranties/1', { method: 'PATCH', body: {
    status: 'received', issueDescription: '', resolution: '',
  } }), 400);
  await api.dataRequest('/warranties/1', { method: 'PATCH', body: {
    status: 'received', issueDescription: 'Lỗi màn hình', resolution: '',
  } });
  await expectReject(api.dataRequest('/warranties/1', { method: 'PATCH', body: {
    status: 'completed', issueDescription: 'Lỗi màn hình', resolution: '',
  } }), 400);
  await api.dataRequest('/warranties/1', { method: 'PATCH', body: {
    status: 'completed', issueDescription: 'Lỗi màn hình', resolution: 'Đã thay linh kiện',
  } });
  await expectReject(api.dataRequest('/warranties/1', { method: 'PATCH', body: {
    status: 'void', resolution: 'Hủy sau hoàn tất',
  } }), 409);
  await expectReject(api.dataRequest('/sales/1', { method: 'PATCH', body: { status: 'cancelled' } }), 409);
  await expectReject(api.dataRequest('/products/1', { method: 'DELETE' }), 409);
  await expectReject(api.dataRequest('/customers/1', { method: 'DELETE' }), 409);
  await expectReject(api.dataRequest('/branches/1', { method: 'DELETE' }), 409);
  await expectReject(api.dataRequest('/users/1', { method: 'DELETE' }), 409);
});

test('API bảo hành trả DTO đủ trường cho giao diện, khóa cập nhật ngoài chi nhánh và không cho sửa liên kết nghiệp vụ', async () => {
  await resetAndLogin('admin');
  const list = await api.dataRequest('/warranties?page=1&pageSize=10');
  const warranty = list.data.find((item) => item.id === 1);
  assert.ok(warranty);
  assert.equal(warranty.warrantyNo, 'WAR-DEMO-0001');
  assert.equal(typeof warranty.invoiceNo, 'string');
  assert.equal(typeof warranty.sku, 'string');
  assert.equal(typeof warranty.serialNo, 'string');

  await loginStaff('manager');
  await api.dataRequest('/warranties/1', { method: 'PATCH', body: {
    status: 'received', issueDescription: 'Lỗi màn hình', resolution: '', branchId: 2, saleId: 999, customerId: 999,
  } });
  let snapshot = JSON.parse(window.localStorage.getItem(DATA_KEY));
  assert.equal(snapshot.warranties.find((item) => item.id === 1).branchId, 1, 'branchId must not be mass-assignable');
  assert.equal(snapshot.warranties.find((item) => item.id === 1).saleId, 1, 'saleId must remain linked to the original invoice');
  assert.equal(snapshot.warranties.find((item) => item.id === 1).customerId, 1, 'customerId must remain linked to the original buyer');

  snapshot.warranties.find((item) => item.id === 1).branchId = 2;
  window.localStorage.setItem(DATA_KEY, JSON.stringify(snapshot));
  await expectReject(api.dataRequest('/warranties/1', { method: 'PATCH', body: {
    status: 'repairing', issueDescription: 'Lỗi màn hình', resolution: '',
  } }), 404);
  snapshot = JSON.parse(window.localStorage.getItem(DATA_KEY));
  assert.equal(snapshot.warranties.find((item) => item.id === 1).status, 'received', 'a manager must not update another branch warranty');
});

test('từ chối trùng tồn kho, loại biến động sai và dữ liệu nhận hàng bị lặp', async () => {
  await resetAndLogin();
  const beforeStock = quantity(2);
  const broken = JSON.parse(window.localStorage.getItem(DATA_KEY));
  broken.stock.push({ productId: 2, branchId: 1, quantity: 3 });
  window.localStorage.setItem(DATA_KEY, JSON.stringify(broken));
  await expectReject(api.dataRequest('/sales', { method: 'POST', body: {
    branchId: 1, paymentMethod: 'cash', items: [{ productId: 2, quantity: 1 }],
  } }), 409);
  await resetAndLogin();
  await expectReject(api.dataRequest('/inventory/movements', { method: 'POST', body: {
    productId: 2, branchId: 1, quantity: 1, movementType: 'unknown',
  } }), 400);
  await expectReject(api.dataRequest('/purchase-receipts', { method: 'POST', body: {
    supplierId: 1, branchId: 1, items: [{ productId: 2, quantity: 1 }, { productId: 2, quantity: 2 }],
  } }), 400);
  assert.equal(quantity(2), beforeStock);
});

test('ma trận phân quyền giới hạn điều hướng theo vai trò và chặn URL quản trị trực tiếp', () => {
  assert.equal(canAccessAdminRoute('admin', '/admin/system'), true);
  assert.equal(canAccessAdminRoute('sales', '/admin/system'), false);
  assert.equal(canAccessAdminRoute('sales', '/admin/sales'), true);
  assert.equal(canAccessAdminRoute('sales', '/admin/products'), false);
  assert.equal(canAccessAdminRoute('warehouse', '/admin/stock-counts'), true);
  assert.equal(canAccessAdminRoute('manager', '/admin/users'), false);
  assert.equal(canAccessAdminRoute('unknown', '/admin/dashboard'), false);
  assert.equal(canAccessAdminRoute('admin', '/admin/system/?from=sidebar'), true);
});

test('ma trận dữ liệu từ chối quyền CRM/báo cáo trái vai trò và cho POS đọc hồ sơ tối thiểu', async () => {
  assert.equal(canAccessDataRequest('sales', '/reports/summary'), false);
  assert.equal(canAccessDataRequest('sales', '/products'), false);
  assert.equal(canAccessDataRequest('sales', '/customers'), true);
  assert.equal(canAccessDataRequest('employee', '/customers'), false);
  assert.equal(canAccessDataRequest('employee', '/pos/customers'), true);
  assert.equal(canAccessDataRequest('manager', '/audit-logs'), false);

  await resetAndLogin('sales');
  await expectReject(api.dataRequest('/reports/summary'), 403);
  await expectReject(api.dataRequest('/products?page=1&pageSize=10'), 403);
  const crmCustomers = await api.dataRequest('/customers?page=1&pageSize=10');
  assert.ok(crmCustomers.data.length > 0, 'Nhân viên bán hàng được dùng CRM theo ma trận vai trò');
  await expectReject(api.dataRequest('/inventory/transfers'), 403);

  const posCustomers = await api.dataRequest('/pos/customers?page=1&pageSize=10');
  assert.ok(posCustomers.data.length > 0);
  assert.equal(Object.hasOwn(posCustomers.data[0], 'email'), false);
  assert.equal(Object.hasOwn(posCustomers.data[0], 'address'), false);
  assert.equal(Object.hasOwn(posCustomers.data[0], 'note'), false);

  const stock = await api.dataRequest('/inventory/stock?page=1&pageSize=10');
  assert.ok(stock.data.length > 0);
  assert.equal(Object.hasOwn(stock.data[0], 'costPrice'), false);
  assert.equal(Object.hasOwn(stock.data[0], 'supplierName'), false);

  const sales = await api.dataRequest('/sales?page=1&pageSize=10');
  assert.ok(sales.data.length > 0);
  assert.equal(Object.hasOwn(sales.data[0].items[0], 'costPrice'), false);
});

test('nhân viên chi nhánh không được xem hoặc xác nhận thanh toán đơn của chi nhánh khác', async () => {
  await resetAndLogin('admin');
  const created = await api.dataRequest('/sales', { method: 'POST', body: {
    branchId: 2, paymentMethod: 'bank_transfer', items: [{ productId: 1, quantity: 1 }],
  } });
  const sale = created.sale;
  assert.equal(sale.status, 'draft');

  await api.dataRequest('/auth/logout', { method: 'POST' });
  await loginStaff('sales');
  await expectReject(api.dataRequest('/payments/' + sale.invoiceNo + '/status'), 404);
  await expectReject(api.dataRequest('/payments/mock/' + sale.invoiceNo + '/complete', {
    method: 'POST', body: { success: true },
  }), 404);
  assert.equal(api.getStoredDemoData().sales.find((item) => item.id === sale.id).status, 'draft');

  window.sessionStorage.clear();
  await expectReject(api.dataRequest('/payments/' + sale.invoiceNo + '/status'), 401);
});

test('vai trò employee không đọc CRM đầy đủ hoặc báo cáo nhưng vẫn truy cập POS tối thiểu', async () => {
  await resetAndLogin('admin');
  const tempPassword = 'TemporaryPassword123!';
  const changedPassword = 'ChangedPassword123!';
  await api.dataRequest('/users', { method: 'POST', body: {
    username: 'basicstaff', fullName: 'Nhan vien thu quyen', email: 'basicstaff@example.test',
    role: 'employee', branchId: 1, password: tempPassword, confirmPassword: tempPassword,
  } });
  await api.dataRequest('/auth/logout', { method: 'POST' });
  const initialLogin = await api.dataRequest('/auth/login', { method: 'POST', body: { username: 'basicstaff', password: tempPassword } });
  assert.equal(initialLogin.user.mustChangePassword, true);
  await api.dataRequest('/auth/change-password', { method: 'POST', body: {
    currentPassword: tempPassword, newPassword: changedPassword, confirmPassword: changedPassword,
  } });
  const login = await api.dataRequest('/auth/login', { method: 'POST', body: { username: 'basicstaff', password: changedPassword } });
  assert.equal(login.user.role, 'employee');

  await expectReject(api.dataRequest('/customers?page=1&pageSize=10'), 403);
  await expectReject(api.dataRequest('/products?page=1&pageSize=10'), 403);
  await expectReject(api.dataRequest('/inventory/transfers'), 403);
  await expectReject(api.dataRequest('/reports/summary'), 403);
  const posCustomers = await api.dataRequest('/pos/customers?page=1&pageSize=10');
  assert.ok(posCustomers.data.length > 0);
  assert.equal(Object.hasOwn(posCustomers.data[0], 'email'), false);
  assert.equal(Object.hasOwn(posCustomers.data[0], 'address'), false);
});

test('backup JSON có version, ghi nhật ký xuất và báo cáo tình trạng lưu trữ', async () => {
  await resetAndLogin('admin');
  const backup = api.createDataBackup();
  assert.equal(backup.format, 'emsystems-data-backup');
  assert.equal(backup.backupVersion, 1);
  assert.equal(backup.product, 'EMSystems');
  assert.ok(backup.recordCounts.products > 0);
  assert.ok(backup.recordCounts.sales > 0);
  assert.equal(backup.storageSaved, true);

  const validation = api.validateDataBackup(backup);
  assert.equal(validation.valid, true, validation.error);
  assert.equal(validation.schemaVersion, api.getStoredDemoData().meta.schemaVersion);
  assert.ok(validation.recordCount > 0);
  assert.ok(api.getStoredDemoData().auditLogs.some((entry) => entry.action === 'system.backup_exported'));
  const auditResponse = await api.dataRequest('/audit-logs?page=1&pageSize=100');
  assert.ok(Array.isArray(auditResponse.data));
  assert.ok(auditResponse.data.some((entry) => entry.action === 'system.backup_exported'));

  const diagnostics = api.getSystemDiagnostics();
  assert.equal(diagnostics.mode, 'server-backed-demo');
  assert.equal(diagnostics.storage, 'sqlite');
  assert.equal(diagnostics.persistent, true);
  assert.ok(diagnostics.recordCount > 0);
});

test('khôi phục backup hợp lệ giữ dữ liệu snapshot, ghi nhật ký và xóa phiên đăng nhập cũ', async () => {
  await resetAndLogin('admin');
  const backup = api.createDataBackup();
  const originalName = backup.data.products.find((item) => item.id === 1).name;

  await api.dataRequest('/products/1', { method: 'PATCH', body: { name: 'Tên chỉ để kiểm thử khôi phục' } });
  assert.equal(api.getStoredDemoData().products.find((item) => item.id === 1).name, 'Tên chỉ để kiểm thử khôi phục');

  const result = api.restoreDataBackup(backup);
  assert.equal(result.ok, true);
  assert.equal(api.getStoredDemoData().products.find((item) => item.id === 1).name, originalName);
  assert.ok(api.getStoredDemoData().auditLogs.some((entry) => entry.action === 'system.backup_restored'));
  await expectReject(api.dataRequest('/auth/me'), 401);
});

test('backup sai định dạng, trùng SKU hoặc sai liên kết không được ghi đè dữ liệu hiện tại', async () => {
  await resetAndLogin('admin');
  const originalName = api.getStoredDemoData().products.find((item) => item.id === 1).name;

  const wrongFormat = api.createDataBackup();
  wrongFormat.format = 'unknown-format';
  assert.equal(api.validateDataBackup(wrongFormat).valid, false);
  assert.throws(() => api.restoreDataBackup(wrongFormat), (error) => error.status === 400);

  const duplicateSku = api.createDataBackup();
  duplicateSku.data.products[1].sku = duplicateSku.data.products[0].sku;
  assert.equal(api.validateDataBackup(duplicateSku).valid, false);
  assert.throws(() => api.restoreDataBackup(duplicateSku), (error) => error.status === 400);

  const invalidStock = api.createDataBackup();
  invalidStock.data.stock[0].branchId = 999999;
  assert.equal(api.validateDataBackup(invalidStock).valid, false);
  assert.throws(() => api.restoreDataBackup(invalidStock), (error) => error.status === 400);

  const noAdminBackup = api.createDataBackup();
  noAdminBackup.data.users = noAdminBackup.data.users.filter((user) => user.role !== 'admin');
  assert.equal(api.validateDataBackup(noAdminBackup).valid, false);
  assert.throws(() => api.restoreDataBackup(noAdminBackup), (error) => error.status === 400);

  assert.equal(api.getStoredDemoData().products.find((item) => item.id === 1).name, originalName);
});

test('chỉ admin được xuất/khôi phục backup và đọc nhật ký thao tác', async () => {
  await resetAndLogin('admin');
  const backup = api.createDataBackup();
  const logId = api.getStoredDemoData().auditLogs[0].id;
  await expectReject(api.dataRequest(`/audit-logs/${logId}`, { method: 'PATCH', body: { action: 'tampered' } }), 409);
  await expectReject(api.dataRequest(`/audit-logs/${logId}`, { method: 'DELETE' }), 409);
  await loginStaff('sales');

  assert.throws(() => api.createDataBackup(), (error) => error.status === 403);
  assert.throws(() => api.restoreDataBackup(backup), (error) => error.status === 403);
  await expectReject(api.dataRequest('/audit-logs'), 403);
  await expectReject(api.dataRequest(`/audit-logs/${logId}`), 403);
});

test('khôi phục dữ liệu mẫu kết thúc cả phiên nhân viên và phiên thành viên', async () => {
  await resetAndLogin('admin');
  await registerMemberAccount();
  assert.equal(api.resetDemoData(), true);
  await expectReject(api.dataRequest('/auth/me'), 401);
  await expectReject(api.dataRequest('/store/member/me'), 401);
});

test('phân luồng sau đăng nhập dựa trên vai trò tài khoản, không dựa vào lựa chọn ở giao diện', () => {
  assert.equal(getPortalForRole('admin'), '/admin');
  assert.equal(getPortalForRole('manager'), '/ctv');
  assert.equal(getPortalForRole('sales'), '/ctv');
  assert.equal(getPortalForRole('ctv'), '/ctv');
  assert.equal(getPortalForRole('customer'), '/');
  assert.equal(canAccessPortal('admin', '/admin'), true);
  assert.equal(canAccessPortal('sales', '/admin'), false);
  assert.equal(canAccessPortal('customer', '/admin'), false);
  assert.equal(canAccessPortal('ctv', '/ctv'), true);
  assert.equal(canAccessAdminRoute('ctv', '/admin/dashboard'), true);
  assert.equal(canAccessAdminRoute('ctv', '/admin/products'), true);
  assert.equal(canAccessAdminRoute('ctv', '/admin/sales'), false);
  assert.equal(canAccessDataRequest('ctv', '/products', 'GET'), true);
  assert.equal(canAccessDataRequest('ctv', '/products', 'POST'), false);
  assert.equal(canAccessDataRequest('ctv', '/sales', 'GET'), false);
  assert.equal(canAccessDataRequest('ctv', '/inventory/stock', 'GET'), false);
  assert.equal(canAccessDataRequest('ctv', '/branches', 'GET'), false);
  assert.equal(canAccessDataRequest('ctv', '/notifications', 'GET'), false);
  assert.equal(canAccessDataRequest('ctv', '/payments/PAY-001/status', 'GET'), false);
  assert.equal(canAccessAdminRoute('ctv', '/admin/payment-demo'), false);
  assert.equal(toCanonicalWorkspacePath('/ctv/sales'), '/admin/sales');
  assert.equal(toCanonicalWorkspacePath('/ctv/dashboard'), '/admin/dashboard');
});

test('tài khoản khách đăng ký có mật khẩu dùng chung cổng đăng nhập, liên kết EM Club và không xuất hiện trong danh bạ nhân viên', async () => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  api.resetDemoData();
  const registration = {
    fullName: 'Khách hàng thử nghiệm',
    username: 'shopper.demo',
    email: 'shopper.demo@example.test',
    phone: '0905999888',
    password: 'Customer@2026!Demo',
    confirmPassword: 'Customer@2026!Demo',
  };
  const created = await api.dataRequest('/auth/register', { method: 'POST', body: registration });
  assert.equal(created.user.role, 'customer');
  assert.equal(created.user.username, registration.username);
  assert.equal('passwordCredential' in created.user, false);
  assert.equal((await api.dataRequest('/auth/me')).user.role, 'customer');
  assert.equal((await api.dataRequest('/store/member/me')).member.phone, '0905999888');
  await expectReject(api.dataRequest('/auth/register', { method: 'POST', body: registration }), 409);

  await api.dataRequest('/auth/logout', { method: 'POST' });
  await expectReject(api.dataRequest('/auth/me'), 401);
  await expectReject(api.dataRequest('/store/member/me'), 401);

  const loggedIn = await api.dataRequest('/auth/login', { method: 'POST', body: {
    identifier: registration.email,
    password: registration.password,
  } });
  assert.equal(loggedIn.user.role, 'customer');
  assert.equal((await api.dataRequest('/store/member/me')).member.id, created.user.customerId);

  await loginStaff('admin');
  const staffDirectory = await api.dataRequest('/users?page=1&pageSize=100');
  assert.equal(staffDirectory.data.some((entry) => entry.role === 'customer'), false);
});


