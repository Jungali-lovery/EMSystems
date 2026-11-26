import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import {
  momoNotificationSignature,
  vnpaySignature,
} from '../server/payment-gateway-utils.mjs';

const projectRoot = new URL('..', import.meta.url).pathname.replace(/^\/(\w:)/, '$1').replace(/\//g, '\\');
const port = 5207;
const base = `http://127.0.0.1:${port}/api/payments`;
const momoAccessKey = 'e2e-only-momo-access-key';
const momoSecret = 'e2e-only-momo-signing-secret';
const vnpaySecret = 'e2e-only-vnpay-signing-secret';
const token = 'e2e-only-shared-payment-service-secret-long-enough';
const businessPort = 5208;
const businessBase = `http://127.0.0.1:${businessPort}`;
const momoPaymentId = 'momo-payment-fixture-0123456789';
const vnpayPaymentId = 'vnpay-fixture-txn-ref-12345';

async function waitForHealth(child) {
  const deadline = Date.now() + 15000;
  let lastError;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Payment test server exited with ${child.exitCode}`);
    try {
      const response = await fetch(`${base}/health`, { signal: AbortSignal.timeout(500) });
      if (response.ok) return;
    } catch (error) { lastError = error; }
    await delay(150);
  }
  throw new Error(`Payment test server did not start: ${lastError?.message || 'timeout'}`);
}

function signedMomo(overrides = {}) {
  const body = {
    partnerCode: 'TEST_MOMO_PARTNER',
    amount: 125000,
    requestId: momoPaymentId,
    orderId: momoPaymentId,
    orderInfo: 'Thanh toan don WEB-00001',
    orderType: 'momo_wallet',
    transId: 'MOMO-TRANSACTION-1',
    resultCode: 0,
    message: 'Successful.',
    payType: 'qr',
    responseTime: 1793018096000,
    extraData: '',
    ...overrides,
  };
  body.signature = momoNotificationSignature(body, momoAccessKey, momoSecret);
  return body;
}

function signedVnpay(overrides = {}) {
  const params = {
    vnp_Version: '2.1.0',
    vnp_Command: 'pay',
    vnp_TmnCode: 'TESTVNPAY',
    vnp_TxnRef: vnpayPaymentId,
    vnp_Amount: '12500000',
    vnp_OrderInfo: 'Thanh toan don WEB-00002',
    vnp_ResponseCode: '00',
    vnp_TransactionStatus: '00',
    vnp_TransactionNo: 'VNPAY-TRANSACTION-1',
    vnp_CurrCode: 'VND',
    vnp_PayDate: '20261026123456',
    ...overrides,
  };
  params.vnp_SecureHash = vnpaySignature(params, vnpaySecret);
  return params;
}

async function postMomo(body) {
  const response = await fetch(`${base}/momo/ipn`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body),
  });
  return response;
}

async function getVnpay(params) {
  const url = new URL(`${base}/vnpay/ipn`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  const response = await fetch(url);
  return { response, payload: await response.json() };
}

test('payment IPN integration: signed MoMo/VNPAY callbacks reject tampering and are idempotent', async (t) => {
  const tempDir = await import('node:fs/promises').then((fs) => fs.mkdtemp(join(tmpdir(), 'emsystems-ipn-test-')));
  const stateDir = join(tempDir, 'state');
  await mkdir(stateDir, { recursive: true });
  const settlements = [];
  const businessServer = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    if (req.url !== '/api/app/internal/payment-settlement'
      || req.headers['x-ems-payment-service-token'] !== token) {
      res.writeHead(403).end(JSON.stringify({ error: 'forbidden' }));
      return;
    }
    settlements.push(body);
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ synchronized: true, status: body.status }));
  });
  await new Promise((resolve, reject) => {
    businessServer.once('error', reject);
    businessServer.listen(businessPort, '127.0.0.1', resolve);
  });
  const fixtures = [
    {
      paymentId: momoPaymentId,
      statusToken: 'momo-status-token',
      provider: 'momo',
      orderId: 'WEB-00001',
      amount: 125000,
      providerOrderId: momoPaymentId,
      status: 'pending',
      transactionId: null,
    },
    {
      paymentId: vnpayPaymentId,
      statusToken: 'vnpay-status-token',
      provider: 'vnpay',
      orderId: 'WEB-00002',
      amount: 125000,
      providerOrderId: vnpayPaymentId,
      status: 'pending',
      transactionId: null,
    },
  ];
  await writeFile(join(stateDir, 'payments.json'), JSON.stringify(fixtures, null, 2), { mode: 0o600 });

  const child = spawn(process.execPath, ['payment-sandbox-server.mjs'], {
    cwd: projectRoot,
    env: {
      ...process.env,
      PAYMENT_PORT: String(port),
      PAYMENT_STATE_DIR: stateDir,
      PAYMENT_FRONTEND_URL: 'http://127.0.0.1:5193',
      PAYMENT_PUBLIC_BASE_URL: 'https://callback.invalid',
      APP_API_INTERNAL_URL: businessBase,
      PAYMENT_SERVICE_TOKEN: token,
      MOMO_PARTNER_CODE: 'TEST_MOMO_PARTNER',
      MOMO_ACCESS_KEY: momoAccessKey,
      MOMO_SECRET_KEY: momoSecret,
      VNPAY_TMN_CODE: 'TESTVNPAY',
      VNPAY_HASH_SECRET: vnpaySecret,
      VNPAY_IPN_CONFIGURED: 'false',
      NODE_ENV: 'test',
    },
    stdio: 'ignore',
    windowsHide: true,
  });
  t.after(async () => {
    if (child.exitCode === null) {
      child.kill('SIGTERM');
      await Promise.race([
        new Promise((resolve) => child.once('exit', resolve)),
        delay(3000),
      ]);
    }
    await new Promise((resolve) => businessServer.close(resolve));
    await rm(tempDir, { recursive: true, force: true });
  });
  await waitForHealth(child);

  const badMomoSignature = await postMomo({ ...signedMomo(), signature: '0'.repeat(64) });
  assert.equal(badMomoSignature.status, 400, 'MoMo must reject a forged signature');

  const wrongMomoAmount = await postMomo(signedMomo({ amount: 125001 }));
  assert.equal(wrongMomoAmount.status, 409, 'MoMo must reject a signed notification with a wrong amount');

  const validMomo = signedMomo();
  const acceptedMomo = await postMomo(validMomo);
  assert.equal(acceptedMomo.status, 204, 'signed MoMo IPN must be accepted');
  const duplicateMomo = await postMomo(validMomo);
  assert.equal(duplicateMomo.status, 204, 'duplicate successful MoMo IPN must be idempotent');

  const invalidVnpay = signedVnpay();
  invalidVnpay.vnp_SecureHash = '0'.repeat(128);
  const rejectedVnpay = await getVnpay(invalidVnpay);
  assert.equal(rejectedVnpay.response.status, 200);
  assert.equal(rejectedVnpay.payload.RspCode, '97', 'VNPAY must reject an invalid signature');

  const wrongVnpayAmount = await getVnpay(signedVnpay({ vnp_Amount: '12500100' }));
  assert.equal(wrongVnpayAmount.payload.RspCode, '04', 'VNPAY must reject a signed callback with a wrong amount');

  const validVnpay = signedVnpay();
  const acceptedVnpay = await getVnpay(validVnpay);
  assert.equal(acceptedVnpay.payload.RspCode, '00', 'signed VNPAY IPN must be accepted');
  const duplicateVnpay = await getVnpay(validVnpay);
  assert.equal(duplicateVnpay.payload.RspCode, '00', 'duplicate successful VNPAY IPN must be idempotent');

  assert.deepEqual(settlements.map((item) => `${item.provider}:${item.status}`).sort(), ['momo:paid', 'vnpay:paid'],
    'accepted IPNs must actively synchronize the business API without browser redirection');
  assert.equal(settlements[0].amount, 125000);
  assert.ok(settlements.every((item) => item.paymentId && item.orderId && item.transactionId),
    'business callback must include payment, order and gateway transaction identifiers');

  for (let index = 0; index < 30; index += 1) {
    const response = await fetch(`${base}/recover`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '198.51.100.10' },
      body: JSON.stringify({ orderCode: 'invalid', phone: '0905000000' }),
    });
    assert.equal(response.status, 400, 'the first 30 requests from one forwarded client should reach validation');
  }
  const rateLimitedClient = await fetch(`${base}/recover`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '198.51.100.10' },
    body: JSON.stringify({ orderCode: 'invalid', phone: '0905000000' }),
  });
  assert.equal(rateLimitedClient.status, 429, 'rate limit must apply to the original client IP behind loopback reverse proxy');
  const independentClient = await fetch(`${base}/recover`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '198.51.100.11' },
    body: JSON.stringify({ orderCode: 'invalid', phone: '0905000000' }),
  });
  assert.equal(independentClient.status, 400, 'a second public client must not inherit the first client limit');

  const persisted = JSON.parse(await readFile(join(stateDir, 'payments.json'), 'utf8'));
  assert.equal(persisted.find((row) => row.provider === 'momo').status, 'paid');
  assert.equal(persisted.find((row) => row.provider === 'vnpay').status, 'paid');
  assert.ok(persisted.every((row) => row.businessSyncedAt), 'successful IPNs must persist business synchronization acknowledgements');
});
