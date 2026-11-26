import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const projectRoot = new URL('..', import.meta.url).pathname.replace(/^\/(\w:)/, '$1').replace(/\//g, '\\');
const origin = 'http://127.0.0.1:5173';
const port = 5196;
const base = `http://127.0.0.1:${port}/api/app`;
const paymentPort = 5197;
const paymentBase = `http://127.0.0.1:${paymentPort}/api/payments`;
const adminPassword = 'EMAdmin@2026!Retail';
const paymentServiceToken = 'test-only-payment-service-shared-secret-64-characters-minimum';

async function waitForHealth(child) {
  const deadline = Date.now() + 15000;
  let lastError;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`API test server exited with ${child.exitCode}`);
    try {
      const response = await fetch(`${base}/healthz`, { signal: AbortSignal.timeout(500) });
      if (response.ok) return;
    } catch (error) { lastError = error; }
    await delay(150);
  }
  throw new Error(`API test server did not become ready: ${lastError?.message || 'timeout'}`);
}

async function waitForPaymentHealth(child) {
  const deadline = Date.now() + 15000;
  let lastError;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Payment test server exited with ${child.exitCode}`);
    try {
      const response = await fetch(`${paymentBase}/health`, { signal: AbortSignal.timeout(500) });
      if (response.ok) {
        const payload = await response.json();
        if (payload.service === 'payment-sandbox' && payload.mode === 'sandbox-only') return;
      }
    } catch (error) { lastError = error; }
    await delay(150);
  }
  throw new Error(`Payment test server did not become ready: ${lastError?.message || 'timeout'}`);
}

function startServer(dbPath) {
  return spawn(process.execPath, ['server/app-api-server.mjs'], {
    cwd: projectRoot,
    env: {
      ...process.env,
      APP_API_PORT: String(port),
      EMSYSTEMS_DB_PATH: dbPath,
      PUBLIC_APP_ORIGIN: origin,
      APP_ALLOWED_ORIGINS: `${origin},http://localhost:5173`,
      PAYMENT_SERVICE_TOKEN: paymentServiceToken,
      PAYMENT_API_INTERNAL_URL: `http://127.0.0.1:${paymentPort}`,
      EMSYSTEMS_BOOTSTRAP_ADMIN_PASSWORD: adminPassword,
      EMSYSTEMS_REQUIRE_PHONE_VERIFICATION: 'false',
      EMSYSTEMS_REQUIRE_DATA_CONSENT: 'false',
      RESEND_API_KEY: '',
      EMSYSTEMS_EMAIL_FROM: '',
      EMSYSTEMS_PUBLIC_URL: origin,
      TWILIO_ACCOUNT_SID: '',
      TWILIO_AUTH_TOKEN: '',
      TWILIO_VERIFY_SERVICE_SID: '',
      TWILIO_SMS_FROM: '',
      ZALO_ZNS_ACCESS_TOKEN: '',
      ZALO_ZNS_TEMPLATE_ID_ORDER: '',
      EMSYSTEMS_ALERT_WEBHOOK_URL: '',
      NODE_ENV: 'test',
    },
    stdio: 'ignore',
    windowsHide: true,
  });
}

function startPaymentServer(stateDir) {
  return spawn(process.execPath, ['payment-sandbox-server.mjs'], {
    cwd: projectRoot,
    env: {
      ...process.env,
      PAYMENT_PORT: String(paymentPort),
      PAYMENT_STATE_DIR: stateDir,
      PAYMENT_FRONTEND_URL: origin,
      PAYMENT_PUBLIC_BASE_URL: 'https://callback.invalid',
      APP_API_INTERNAL_URL: `http://127.0.0.1:${port}`,
      PAYMENT_SERVICE_TOKEN: paymentServiceToken,
      VNPAY_TMN_CODE: 'TEST_TMN_CODE_ONLY',
      VNPAY_HASH_SECRET: 'test-vnpay-secret-never-used-for-network-call',
      MOMO_PARTNER_CODE: 'TEST_PARTNER_CODE',
      MOMO_ACCESS_KEY: 'TEST_ACCESS_KEY',
      MOMO_SECRET_KEY: 'test-momo-secret-never-used-for-network-call',
      NODE_ENV: 'test',
    },
    stdio: 'ignore',
    windowsHide: true,
  });
}

async function api(path, { method = 'GET', body, cookie = '', key = '', requestOrigin = origin, serviceToken = '', forwardedFor = '', paymentToken = '' } = {}) {
  const headers = { Accept: 'application/json' };
  if (requestOrigin !== null) headers.Origin = requestOrigin;
  if (cookie) headers.Cookie = cookie;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (key) headers['Idempotency-Key'] = key;
  if (serviceToken) headers['x-ems-payment-service-token'] = serviceToken;
  if (forwardedFor) headers['x-forwarded-for'] = forwardedFor;
  if (paymentToken) headers['x-payment-token'] = paymentToken;
  const response = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual',
  });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

function cookiePair(response) {
  const setCookie = response.headers.get('set-cookie') || '';
  assert.match(setCookie, /HttpOnly/i, 'session identifier must never be readable by JavaScript');
  assert.match(setCookie, /SameSite=Lax/i);
  assert.match(setCookie, /Path=\//i);
  const pair = setCookie.split(';', 1)[0];
  assert.match(pair, /^ems_session=[A-Za-z0-9_-]{40,60}$/);
  return pair;
}

test('server API: cookies, validation, persistent SQLite state and idempotent atomic checkout', async (t) => {
  const tempDir = await mkdtemp(join(tmpdir(), 'emsystems-api-test-'));
  const dbPath = join(tempDir, 'test.sqlite');
  let child = startServer(dbPath);
  let paymentChild = null;
  t.after(async () => {
    if (paymentChild && paymentChild.exitCode === null) {
      paymentChild.kill('SIGTERM');
      await Promise.race([
        new Promise((resolve) => paymentChild.once('exit', resolve)),
        delay(3000),
      ]);
    }
    if (child && child.exitCode === null) {
      child.kill('SIGTERM');
      await Promise.race([
        new Promise((resolve) => child.once('exit', resolve)),
        delay(3000),
      ]);
    }
    await rm(tempDir, { recursive: true, force: true });
  });

  await waitForHealth(child);
  const health = await fetch(`${base}/healthz`);
  assert.equal(health.status, 200);
  assert.equal((await health.json()).storage, 'sqlite');

  const publicConfig = await api('/config/public');
  assert.equal(publicConfig.response.status, 200);
  assert.equal(publicConfig.payload.phoneVerificationRequired, false);
  assert.deepEqual(publicConfig.payload.notificationChannels, { email: false, sms: false, zaloZns: false });
  assert.equal(publicConfig.payload.einvoice.provider, 'none');

  const resetKnown = await api('/auth/password-reset/request', { method: 'POST', body: { email: 'admin@emsystems.local' } });
  const resetUnknown = await api('/auth/password-reset/request', { method: 'POST', body: { email: 'unknown@example.invalid' } });
  assert.equal(resetKnown.response.status, 202);
  assert.equal(resetKnown.payload.message, resetUnknown.payload.message,
    'reset endpoint must not disclose whether an email is registered');
  const invalidReset = await api('/auth/password-reset/confirm', {
    method: 'POST', body: { token: 'invalid', password: 'TestOnlyPassword!123', confirmPassword: 'TestOnlyPassword!123' },
  });
  assert.equal(invalidReset.response.status, 400);

  const otpUnavailable = await api('/auth/phone-verification/start', {
    method: 'POST', body: { phone: '0905123456' },
  });
  assert.equal(otpUnavailable.response.status, 503, 'OTP must fail closed when provider credentials are absent');

  const noNotifications = await api('/internal/notifications/claim', {
    method: 'POST', body: { limit: 10 }, requestOrigin: null, serviceToken: paymentServiceToken,
  });
  assert.equal(noNotifications.response.status, 200);
  assert.deepEqual(noNotifications.payload.notifications, []);
  const missingNotification = await api('/internal/notifications/complete', {
    method: 'POST', body: { id: 999999, success: true }, requestOrigin: null, serviceToken: paymentServiceToken,
  });
  assert.equal(missingNotification.response.status, 404);

  const internalIntentWithoutToken = await api('/internal/payment-intent', {
    method: 'POST', body: { orderId: 'WEB-00001', amount: 125000, provider: 'momo' }, requestOrigin: null,
  });
  assert.equal(internalIntentWithoutToken.response.status, 403, 'internal payment verification must require a shared service secret');

  const invalidOrigin = await api('/store/products?page=1&pageSize=10', { requestOrigin: 'https://attacker.invalid' });
  assert.equal(invalidOrigin.response.status, 403);

  const missingMutationOrigin = await api('/auth/login', {
    method: 'POST', body: { username: 'admin', password: adminPassword }, requestOrigin: null,
  });
  assert.equal(missingMutationOrigin.response.status, 403, 'mutations without a browser origin must fail closed');

  // Distinct spoofed chains behind the local proxy must resolve to the final
  // trusted hop, while the username bucket follows the account across IPs.
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const failedLogin = await api('/auth/login', {
      method: 'POST', body: { identifier: 'rate-limit-target', password: 'wrong-password' },
      forwardedFor: `203.0.113.250, 198.51.100.${attempt}`,
    });
    assert.equal(failedLogin.response.status, 401, `attempt ${attempt} should reach authentication`);
  }
  const usernameThrottled = await api('/auth/login', {
    method: 'POST', body: { identifier: 'rate-limit-target', password: 'wrong-password' },
    forwardedFor: '203.0.113.250, 198.51.100.6',
  });
  assert.equal(usernameThrottled.response.status, 429, 'the same username must be throttled across different forwarded client IPs');
  const differentUsername = await api('/auth/login', {
    method: 'POST', body: { identifier: 'different-rate-limit-target', password: 'wrong-password' },
    forwardedFor: '198.51.100.6',
  });
  assert.equal(differentUsername.response.status, 401, 'a different username must not inherit the previous account lockout');

  const phoneOnlyMemberLogin = await api('/store/member/login', {
    method: 'POST', body: { phone: '0905123456' },
  });
  assert.equal(phoneOnlyMemberLogin.response.status, 410, 'phone-only member login must not allow account takeover');

  const unauthenticated = await api('/users?page=1&pageSize=10');
  assert.equal(unauthenticated.response.status, 401);

  const publicProducts = await api('/store/products?page=1&pageSize=100');
  assert.equal(publicProducts.response.status, 200);
  assert.ok(publicProducts.payload.data.length >= 1);
  assert.equal(Object.hasOwn(publicProducts.payload.data[0], 'costPrice'), false);
  assert.equal(Object.hasOwn(publicProducts.payload.data[0], 'supplierId'), false);
  assert.equal(typeof publicProducts.payload.data[0].availableStock, 'boolean', 'public product API must expose availability, not exact stock counts');
  assert.equal(Object.hasOwn(publicProducts.payload.data[0], 'stock'), false);
  assert.equal(Object.hasOwn(publicProducts.payload.data[0], 'stockByBranch'), false);

  const login = await api('/auth/login', {
    method: 'POST',
    body: { username: 'admin', password: adminPassword },
  });
  assert.equal(login.response.status, 200, JSON.stringify(login.payload));
  assert.equal(login.payload.user.role, 'admin');
  let cookie = cookiePair(login.response);

  const mockPaymentDisabled = await api('/payments/mock/WEB-99999/complete', {
    method: 'POST', cookie, body: { success: true, signature: 'local-demo-1' },
  });
  assert.equal(mockPaymentDisabled.response.status, 404, 'mock payment completion must be hidden unless explicitly enabled outside production');

  const diagnostics = await api('/system/diagnostics', { cookie });
  assert.equal(diagnostics.response.status, 200, JSON.stringify(diagnostics.payload));
  assert.equal(diagnostics.payload.storage, 'sqlite');
  assert.equal(diagnostics.payload.persistent, true);

  const bankAccountsBeforeSetup = await api('/system/bank-accounts', { cookie });
  assert.equal(bankAccountsBeforeSetup.response.status, 200, JSON.stringify(bankAccountsBeforeSetup.payload));
  assert.deepEqual(bankAccountsBeforeSetup.payload.data, []);
  const invalidBankAccount = await api('/system/bank-accounts', {
    method: 'POST', cookie,
    body: { bankCode: '<script>', bankName: 'Ngân hàng thử', accountNumber: '1234567890', accountName: 'EMS TEST' },
  });
  assert.equal(invalidBankAccount.response.status, 400, 'invalid bank identifiers must be rejected');
  const firstBankAccount = await api('/system/bank-accounts', {
    method: 'POST', cookie,
    body: { bankCode: 'MB', bankName: 'MB Bank', accountNumber: '0123456789', accountName: 'EMSYSTEMS TEST ACCOUNT' },
  });
  assert.equal(firstBankAccount.response.status, 200, JSON.stringify(firstBankAccount.payload));
  assert.equal(firstBankAccount.payload.data.isActive, true, 'the first account becomes the active receiving account');
  const secondBankAccount = await api('/system/bank-accounts', {
    method: 'POST', cookie,
    body: { bankCode: 'VCB', bankName: 'Vietcombank', accountNumber: '9988776655', accountName: 'EMSYSTEMS SECOND ACCOUNT' },
  });
  assert.equal(secondBankAccount.response.status, 200, JSON.stringify(secondBankAccount.payload));
  assert.equal(secondBankAccount.payload.data.isActive, false, 'adding another account must not silently replace the active one');
  const activateSecondBankAccount = await api(`/system/bank-accounts/${secondBankAccount.payload.data.id}`, {
    method: 'PATCH', cookie, body: { isActive: true },
  });
  assert.equal(activateSecondBankAccount.response.status, 200, JSON.stringify(activateSecondBankAccount.payload));
  const bankAccountsAfterActivation = await api('/system/bank-accounts', { cookie });
  assert.equal(bankAccountsAfterActivation.payload.data.filter((account) => account.isActive).length, 1);
  assert.equal(bankAccountsAfterActivation.payload.data.find((account) => account.id === firstBankAccount.payload.data.id).isActive, false);
  const internalBankConfigWithoutToken = await api('/internal/payment-config', { requestOrigin: null });
  assert.equal(internalBankConfigWithoutToken.response.status, 403, 'payment service settings must be protected by the shared token');
  const internalBankConfig = await api('/internal/payment-config', { requestOrigin: null, serviceToken: paymentServiceToken });
  assert.equal(internalBankConfig.response.status, 200, JSON.stringify(internalBankConfig.payload));
  assert.equal(internalBankConfig.payload.account.accountNumber, '9988776655');

  const orderBody = {
    fullName: 'Khách kiểm thử API',
    phone: '0905111222',
    address: '12 Nguyễn Văn Linh',
    ward: 'Hải Châu',
    deliveryAreaId: 1,
    paymentMethod: 'cash_on_delivery',
    items: [{ productId: 1, quantity: 1 }],
  };
  const key = 'e2e-checkout-key-000001';
  const firstOrder = await api('/store/orders', { method: 'POST', body: orderBody, cookie, key });
  assert.equal(firstOrder.response.status, 200, JSON.stringify(firstOrder.payload));
  assert.match(firstOrder.payload.order.invoiceNo, /^WEB-\d{5,12}$/);

  const replay = await api('/store/orders', { method: 'POST', body: orderBody, cookie, key });
  assert.equal(replay.response.status, 200);
  assert.equal(replay.payload.order.invoiceNo, firstOrder.payload.order.invoiceNo, 'replay must return the original order');

  const changedReplay = await api('/store/orders', {
    method: 'POST',
    body: { ...orderBody, phone: '0905111333' },
    cookie,
    key,
  });
  assert.equal(changedReplay.response.status, 409, 'reusing the same key with a different payload must fail');

  // Two concurrent orders competing for the same stock: the transaction must allow at most one.
  const compete = await Promise.all([
    api('/store/orders', { method: 'POST', body: { ...orderBody, phone: '0905111441', items: [{ productId: 1, quantity: 10 }] }, cookie, key: 'e2e-concurrent-key-0001' }),
    api('/store/orders', { method: 'POST', body: { ...orderBody, phone: '0905111442', items: [{ productId: 1, quantity: 10 }] }, cookie, key: 'e2e-concurrent-key-0002' }),
  ]);
  assert.deepEqual(compete.map((item) => item.response.status).sort(), [200, 409]);
  const productAfterCompetition = await api('/products?page=1&pageSize=100', { cookie });
  const product = productAfterCompetition.payload.data.find((item) => item.id === 1);
  assert.ok(product.stock >= 0);
  assert.equal(product.stock, 5, 'internal stock remains exact for authorized staff: 16 - first order 1 - one competing order 10 = 5');

  const onlineOrder = await api('/store/orders', {
    method: 'POST', cookie, key: 'e2e-online-order-intent-0001',
    body: { ...orderBody, phone: '0905111555', deliveryAreaId: 6, paymentMethod: 'momo_sandbox', items: [{ productId: 1, quantity: 1 }] },
  });
  assert.equal(onlineOrder.response.status, 200, JSON.stringify(onlineOrder.payload));
  const { invoiceNo, totalAmount } = onlineOrder.payload.order;

  const validIntent = await api('/internal/payment-intent', {
    method: 'POST', requestOrigin: null, serviceToken: paymentServiceToken,
    body: { orderId: invoiceNo, amount: totalAmount, provider: 'momo' },
  });
  assert.equal(validIntent.response.status, 200, JSON.stringify(validIntent.payload));
  assert.equal(validIntent.payload.verified, true);

  const tamperedAmount = await api('/internal/payment-intent', {
    method: 'POST', requestOrigin: null, serviceToken: paymentServiceToken,
    body: { orderId: invoiceNo, amount: totalAmount + 1000, provider: 'momo' },
  });
  assert.equal(tamperedAmount.response.status, 409, 'gateway must not choose a different order amount');

  const tamperedProvider = await api('/internal/payment-intent', {
    method: 'POST', requestOrigin: null, serviceToken: paymentServiceToken,
    body: { orderId: invoiceNo, amount: totalAmount, provider: 'vnpay' },
  });
  assert.equal(tamperedProvider.response.status, 409, 'gateway provider must match the payment method selected in the order');

  const invalidServiceToken = await api('/internal/payment-intent', {
    method: 'POST', requestOrigin: null, serviceToken: 'incorrect-secret',
    body: { orderId: invoiceNo, amount: totalAmount, provider: 'momo' },
  });
  assert.equal(invalidServiceToken.response.status, 403);

  // Exercise the real payment-service boundary with fake merchant keys. Only deliberately invalid
  // intent requests are sent, so this test never contacts MoMo/VNPAY or starts a real charge.
  const vnpayOrder = await api('/store/orders', {
    method: 'POST', cookie, key: 'e2e-vnpay-order-intent-0001',
    body: { ...orderBody, phone: '0905111666', deliveryAreaId: 6, paymentMethod: 'vnpay_sandbox', items: [{ productId: 1, quantity: 1 }] },
  });
  assert.equal(vnpayOrder.response.status, 200, JSON.stringify(vnpayOrder.payload));
  const vietqrOrder = await api('/store/orders', {
    method: 'POST', cookie, key: 'e2e-vietqr-order-intent-0001',
    body: { ...orderBody, phone: '0905111777', deliveryAreaId: 6, paymentMethod: 'vietqr_transfer', items: [{ productId: 1, quantity: 1 }] },
  });
  assert.equal(vietqrOrder.response.status, 200, JSON.stringify(vietqrOrder.payload));
  assert.equal(vietqrOrder.payload.order.paymentStatus, 'pending_payment');
  paymentChild = startPaymentServer(join(tempDir, 'payment-state'));
  await waitForPaymentHealth(paymentChild);
  const paymentConfigResponse = await fetch(`${paymentBase}/config`);
  const paymentConfig = await paymentConfigResponse.json();
  assert.equal(paymentConfig.methods.vietqr.canCreate, true, 'payment service must use the active bank account saved by admin');
  const rejectedGatewayAmount = await fetch(`${paymentBase}/vnpay/create`, {
    method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ orderId: vnpayOrder.payload.order.invoiceNo, amount: vnpayOrder.payload.order.totalAmount + 1000 }),
  });
  assert.equal(rejectedGatewayAmount.status, 409, 'payment service must reject a client-tampered amount before calling VNPAY');
  assert.match((await rejectedGatewayAmount.json()).error, /amount|số tiền|khớp/i);
  const rejectedGatewayProvider = await fetch(`${paymentBase}/momo/create`, {
    method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ orderId: vnpayOrder.payload.order.invoiceNo, amount: vnpayOrder.payload.order.totalAmount }),
  });
  assert.equal(rejectedGatewayProvider.status, 409, 'payment service must reject a provider mismatch before contacting the gateway');

  const vietqrResponse = await fetch(`${paymentBase}/vietqr/create`, {
    method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ orderId: vietqrOrder.payload.order.invoiceNo, amount: vietqrOrder.payload.order.totalAmount }),
  });
  assert.equal(vietqrResponse.status, 200, 'VietQR should create a bank transfer QR after server-side order validation');
  const vietqrPayload = await vietqrResponse.json();
  assert.equal(vietqrPayload.provider, 'vietqr');
  assert.equal(vietqrPayload.qrMode, 'bank-transfer-vietqr');
  const statusWithoutHeader = await fetch(`${paymentBase}/status/${vietqrPayload.paymentId}`);
  assert.equal(statusWithoutHeader.status, 404, 'payment status must reject requests without the payment token header');
  const statusWithQueryToken = await fetch(`${paymentBase}/status/${vietqrPayload.paymentId}?token=${vietqrPayload.statusToken}`);
  assert.equal(statusWithQueryToken.status, 404, 'payment status must not accept a token in the query string');
  const statusWithHeader = await fetch(`${paymentBase}/status/${vietqrPayload.paymentId}`, {
    headers: { 'X-Payment-Token': vietqrPayload.statusToken },
  });
  assert.equal(statusWithHeader.status, 200, 'payment status must accept the token in X-Payment-Token');
  const syncWithHeader = await api('/store/orders/sync-payment', {
    method: 'POST', paymentToken: vietqrPayload.statusToken,
    body: { paymentId: vietqrPayload.paymentId },
  });
  assert.equal(syncWithHeader.response.status, 409, 'the API must reach the internal payment service and reject VietQR from the MoMo/VNPAY IPN sync path');
  assert.equal(vietqrPayload.transferContent, `EMSYS WEB ${vietqrOrder.payload.order.invoiceNo.slice(4)}`);
  assert.equal(vietqrPayload.bank.bankName, 'Vietcombank');
  assert.equal(vietqrPayload.bank.accountNumber, '9988776655');
  assert.equal(new URL(vietqrPayload.qrImageUrl).searchParams.get('amount'), String(vietqrOrder.payload.order.totalAmount));
  assert.equal(new URL(vietqrPayload.qrImageUrl).searchParams.get('addInfo'), vietqrPayload.transferContent);

  const recoveryWithoutToken = await api('/internal/payment-recovery', {
    method: 'POST', requestOrigin: null,
    body: { orderCode: vietqrOrder.payload.order.invoiceNo, phone: '0905111777' },
  });
  assert.equal(recoveryWithoutToken.response.status, 403, 'payment recovery verification must require the service token');
  const recoveryWrongPhone = await api('/internal/payment-recovery', {
    method: 'POST', requestOrigin: null, serviceToken: paymentServiceToken,
    body: { orderCode: vietqrOrder.payload.order.invoiceNo, phone: '0905000000' },
  });
  assert.equal(recoveryWrongPhone.response.status, 404, 'payment recovery must reject a mismatched recipient phone');
  const recoveryIntent = await api('/internal/payment-recovery', {
    method: 'POST', requestOrigin: null, serviceToken: paymentServiceToken,
    body: { orderCode: vietqrOrder.payload.order.invoiceNo, phone: '0905111777' },
  });
  assert.equal(recoveryIntent.response.status, 200, JSON.stringify(recoveryIntent.payload));
  assert.equal(recoveryIntent.payload.authorized, true);
  assert.equal(recoveryIntent.payload.provider, 'vietqr');
  const recoveredPaymentResponse = await fetch(`${paymentBase}/recover`, {
    method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ orderCode: vietqrOrder.payload.order.invoiceNo, phone: '0905111777' }),
  });
  assert.equal(recoveredPaymentResponse.status, 200, `customer must be able to recover an existing QR after losing the browser session: ${await recoveredPaymentResponse.clone().text()}`);
  const recoveredPayment = await recoveredPaymentResponse.json();
  assert.equal(recoveredPayment.paymentId, vietqrPayload.paymentId);
  assert.equal(recoveredPayment.qrImageUrl, vietqrPayload.qrImageUrl);
  assert.equal(recoveredPayment.statusToken, vietqrPayload.statusToken);
  const recoveryWrongPhoneAtGateway = await fetch(`${paymentBase}/recover`, {
    method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ orderCode: vietqrOrder.payload.order.invoiceNo, phone: '0905000000' }),
  });
  assert.equal(recoveryWrongPhoneAtGateway.status, 404);

  const supportTicket = await api('/store/support/requests', {
    method: 'POST', body: {
      orderCode: vietqrOrder.payload.order.invoiceNo, fullName: 'Khách hỗ trợ', phone: '0905111777',
      category: 'payment_qr', message: 'Tôi đã tạo đơn nhưng đóng nhầm tab, hiện không còn thấy mã QR.',
    },
  });
  assert.equal(supportTicket.response.status, 200, JSON.stringify(supportTicket.payload));
  assert.match(supportTicket.payload.data.caseCode, /^HT-[0-9]{5,8}$/);
  const publicTicketView = await api(`/store/support/track?caseCode=${supportTicket.payload.data.caseCode}&phone=0905111777`);
  assert.equal(publicTicketView.response.status, 200);
  assert.equal(publicTicketView.payload.ticket.caseCode, supportTicket.payload.data.caseCode);
  const privateTicketView = await api(`/store/support/track?caseCode=${supportTicket.payload.data.caseCode}&phone=0905000000`);
  assert.equal(privateTicketView.response.status, 404);
  const staffTicketList = await api('/support/requests?page=1&pageSize=20', { cookie });
  assert.equal(staffTicketList.response.status, 200, JSON.stringify(staffTicketList.payload));
  assert.ok(staffTicketList.payload.data.some((item) => item.caseCode === supportTicket.payload.data.caseCode));
  const staffTicketReply = await api(`/support/requests/${supportTicket.payload.data.id}`, {
    method: 'PATCH', cookie,
    body: { status: 'in_progress', publicReply: 'Cửa hàng đã nhận yêu cầu và đang kiểm tra giao dịch.' },
  });
  assert.equal(staffTicketReply.response.status, 200, JSON.stringify(staffTicketReply.payload));
  const publicTicketAfterReply = await api(`/store/support/track?caseCode=${supportTicket.payload.data.caseCode}&phone=0905111777`);
  assert.equal(publicTicketAfterReply.payload.ticket.status, 'in_progress');
  assert.equal(publicTicketAfterReply.payload.ticket.publicReply, 'Cửa hàng đã nhận yêu cầu và đang kiểm tra giao dịch.');

  const wrongReceivedAmount = await api(`/store/orders/${vietqrOrder.payload.order.id}/payment-confirmation`, {
    method: 'POST', cookie,
    body: { receivedAmount: vietqrOrder.payload.order.totalAmount + 1000, transactionReference: 'BANK-TXN-10001' },
  });
  assert.equal(wrongReceivedAmount.response.status, 400, 'manual reconciliation must reject an amount mismatch');
  const confirmedVietqr = await api(`/store/orders/${vietqrOrder.payload.order.id}/payment-confirmation`, {
    method: 'POST', cookie,
    body: { receivedAmount: vietqrOrder.payload.order.totalAmount, transactionReference: 'BANK-TXN-10001' },
  });
  assert.equal(confirmedVietqr.response.status, 200, JSON.stringify(confirmedVietqr.payload));
  const duplicateVietqrConfirmation = await api(`/store/orders/${vietqrOrder.payload.order.id}/payment-confirmation`, {
    method: 'POST', cookie,
    body: { receivedAmount: vietqrOrder.payload.order.totalAmount, transactionReference: 'BANK-TXN-10001' },
  });
  assert.equal(duplicateVietqrConfirmation.response.status, 409, 'a bank transfer must not be confirmed twice');

  // Restart the service with the same SQLite file; order and session state must survive.
  child.kill('SIGTERM');
  await Promise.race([new Promise((resolve) => child.once('exit', resolve)), delay(3000)]);
  child = startServer(dbPath);
  await waitForHealth(child);

  const persistedProducts = await api('/products?page=1&pageSize=100', { cookie });
  assert.equal(persistedProducts.response.status, 200);
  const persisted = persistedProducts.payload.data.find((item) => item.id === 1);
  assert.equal(persisted.stock, 2, 'online and VietQR orders reserve stock until payment is confirmed or released');
  const persistedBankAccounts = await api('/system/bank-accounts', { cookie });
  assert.equal(persistedBankAccounts.response.status, 200);
  assert.equal(persistedBankAccounts.payload.data.find((account) => account.isActive)?.accountNumber, '9988776655',
    'active bank account configuration must persist in the SQLite snapshot after an API restart');
  const persistedAudit = await api('/audit-logs?page=1&pageSize=100', { cookie });
  assert.equal(persistedAudit.response.status, 200);
  assert.ok(persistedAudit.payload.data.some((entry) => entry.action === 'store.order_placed'));

  // High-contention regression: 12 independent checkout requests target the same product
  // and same delivery branch when only 3 aggregate units remain. Each request has its own
  // idempotency key, so serialization/stock checks—not duplicate-submit protection—must stop oversell.
  const beforeStress = Number(persisted.stock);
  assert.equal(beforeStress, 2);
  const stressResults = await Promise.all(Array.from({ length: 12 }, (_, index) => api('/store/orders', {
    method: 'POST',
    cookie,
    key: `stress-stock-race-20261026-${String(index).padStart(2, '0')}`,
    body: {
      ...orderBody,
      phone: `0905${String(200000 + index).slice(-6)}`,
      deliveryAreaId: 6,
      paymentMethod: 'cash_on_delivery',
      items: [{ productId: 1, quantity: 1 }],
    },
  })));
  const stressAccepted = stressResults.filter((result) => result.response.status === 200);
  const stressRejected = stressResults.filter((result) => result.response.status === 409);
  assert.equal(stressAccepted.length + stressRejected.length, 12, 'every request must resolve as accepted or stock-conflict');
  assert.ok(stressAccepted.length > 0, 'race test must exercise at least one committed checkout');
  assert.equal(stressAccepted.length, beforeStress, 'exactly the available units should be accepted; the concurrent remainder must be rejected');
  assert.ok(stressAccepted.length <= beforeStress, `oversold: ${stressAccepted.length} successful orders from ${beforeStress} available units`);
  assert.equal(stressRejected.length, 12 - stressAccepted.length);

  const afterStressResponse = await api('/products?page=1&pageSize=100', { cookie });
  assert.equal(afterStressResponse.response.status, 200);
  // Authorized staff stock view retains exact counts; public catalog only returns boolean availability.
  const afterStress = afterStressResponse.payload.data.find((item) => item.id === 1);
  const stockAfterStress = afterStress ? Number(afterStress.stock) : 0;
  assert.ok(stockAfterStress >= 0);
  assert.equal(stockAfterStress, beforeStress - stressAccepted.length, 'each committed unit checkout must consume exactly one unit');

  const acceptedOrder = stressAccepted[0].payload.order;
  const cancelAccepted = await api(`/store/orders/${acceptedOrder.id}/status`, {
    method: 'PATCH', cookie, body: { status: 'cancelled' },
  });
  assert.equal(cancelAccepted.response.status, 200, 'cancelling an accepted COD order should release its reservation');
  const afterRelease = await api('/products?page=1&pageSize=100', { cookie });
  const restoredCatalogProduct = afterRelease.payload.data.find((item) => item.id === 1);
  assert.ok(restoredCatalogProduct, 'product should return to the public catalog once cancellation restores stock');
  const stockAfterRelease = Number(restoredCatalogProduct.stock);
  assert.equal(stockAfterRelease, stockAfterStress + 1, 'a successful cancellation must release exactly one unit');

  const duplicateRelease = await api(`/store/orders/${acceptedOrder.id}/status`, {
    method: 'PATCH', cookie, body: { status: 'cancelled' },
  });
  assert.equal(duplicateRelease.response.status, 409, 'duplicate cancellation must not release stock twice');
  const finalStock = await api('/products?page=1&pageSize=100', { cookie });
  assert.equal(finalStock.payload.data.find((item) => item.id === 1).stock, stockAfterRelease,
    'duplicate cancellation must leave stock unchanged');

  const secondSessionLogin = await api('/auth/login', {
    method: 'POST', body: { username: 'admin', password: adminPassword },
  });
  assert.equal(secondSessionLogin.response.status, 200);
  const secondAdminCookie = cookiePair(secondSessionLogin.response);
  const resetAll = await api('/system/reset-demo', {
    method: 'POST', cookie, body: { confirm: true },
  });
  assert.equal(resetAll.response.status, 200, JSON.stringify(resetAll.payload));
  assert.match(resetAll.response.headers.get('set-cookie') || '', /Max-Age=0/i,
    'the session performing the reset must also be expired');
  const staleSecondSession = await api('/auth/me', { cookie: secondAdminCookie });
  assert.equal(staleSecondSession.response.status, 401,
    'reset-demo must revoke every server-side session, not just the current session');
});
