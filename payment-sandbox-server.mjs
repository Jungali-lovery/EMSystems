import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getTrustedClientIp } from './server/security/client-ip.mjs';
import { reportOperationalError } from './server/monitoring.mjs';
import {
  buildVietQrQuickLink,
  formatVnpayDate,
  momoCreateSignature,
  safeHexEqual,
  verifyMomoNotification,
  verifyVnpaySignature,
  vnpayCanonicalQuery,
  vnpaySignature,
} from './server/payment-gateway-utils.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));

async function loadEnvironmentFile() {
  try {
    const raw = await readFile(join(ROOT, '.env'), 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!match || match[1] in process.env) continue;
      let value = match[2];
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      process.env[match[1]] = value;
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

await loadEnvironmentFile();

const STATE_DIR = resolve(process.env.PAYMENT_STATE_DIR || join(ROOT, '.payment-sandbox-data'));
const STATE_FILE = join(STATE_DIR, 'payments.json');
const PORT = Number(process.env.PAYMENT_PORT) || 5175;
const FRONTEND_URL = (process.env.PAYMENT_FRONTEND_URL || 'http://127.0.0.1:5173').replace(/\/$/, '');
const PUBLIC_BASE_URL = (process.env.PAYMENT_PUBLIC_BASE_URL || '').replace(/\/$/, '');
const APP_API_INTERNAL_URL = (process.env.APP_API_INTERNAL_URL || 'http://127.0.0.1:5176').replace(/\/$/, '');
const PAYMENT_SERVICE_TOKEN = String(process.env.PAYMENT_SERVICE_TOKEN || '');
const INTERNAL_API_IS_LOOPBACK = (() => {
  try {
    const url = new URL(APP_API_INTERNAL_URL);
    return url.protocol === 'http:'
      && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      && !url.username && !url.password && !url.search && !url.hash;
  } catch { return false; }
})();
const MOMO_CREATE_URL = 'https://test-payment.momo.vn/v2/gateway/api/create';
const VNPAY_PAYMENT_URL = 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html';
const VNPAY_IPN_CONFIGURED = process.env.VNPAY_IPN_CONFIGURED === 'true';
const VNPAY_RETURN_URL = (process.env.VNPAY_RETURN_URL || `${FRONTEND_URL}/api/payments/vnpay/return`).replace(/\/$/, '');
const PAYMENTS = new Map();
const RATE_LIMITS = new Map();
const BUSINESS_SYNC_IN_FLIGHT = new Set();
let paymentMutationQueue = Promise.resolve();
let paymentsWriteQueue = Promise.resolve();

function serializePaymentMutation(work) {
  const result = paymentMutationQueue.then(work, work);
  paymentMutationQueue = result.catch(() => {});
  return result;
}

function publicCallbackBaseIsReady() {
  try {
    const url = new URL(PUBLIC_BASE_URL);
    return url.protocol === 'https:'
      && !['localhost', '127.0.0.1', '::1', 'your-public-https-tunnel'].includes(url.hostname)
      && !url.hostname.endsWith('.example');
  } catch {
    return false;
  }
}

async function fetchVietQrAccountConfig() {
  if (PAYMENT_SERVICE_TOKEN.length < 32 || !INTERNAL_API_IS_LOOPBACK) return null;
  try {
    const response = await fetch(`${APP_API_INTERNAL_URL}/api/app/internal/payment-config`, {
      method: 'GET',
      headers: { accept: 'application/json', 'x-ems-payment-service-token': PAYMENT_SERVICE_TOKEN },
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return null;
    const result = await response.json().catch(() => ({}));
    const account = result?.configured === true ? result.account : null;
    if (!account
      || !/^[A-Z0-9-]{2,30}$/.test(String(account.bankCode || '').trim().toUpperCase())
      || !/^\d{6,19}$/.test(String(account.accountNumber || '').trim())
      || String(account.bankName || '').trim().length < 2
      || String(account.accountName || '').trim().length < 2) return null;
    return {
      bankCode: String(account.bankCode).trim().toUpperCase(),
      bankName: String(account.bankName).trim(),
      accountNumber: String(account.accountNumber).trim(),
      accountName: String(account.accountName).trim(),
    };
  } catch {
    return null;
  }
}

async function paymentConfig() {
  const httpsCallbackReady = publicCallbackBaseIsReady();
  const serviceMissing = PAYMENT_SERVICE_TOKEN.length >= 32
    ? []
    : ['PAYMENT_SERVICE_TOKEN (chuỗi bí mật dùng chung với business API, tối thiểu 32 ký tự)'];
  const momoCredentialMissing = [];
  if (!process.env.MOMO_PARTNER_CODE) momoCredentialMissing.push('MOMO_PARTNER_CODE');
  if (!process.env.MOMO_ACCESS_KEY) momoCredentialMissing.push('MOMO_ACCESS_KEY');
  if (!process.env.MOMO_SECRET_KEY) momoCredentialMissing.push('MOMO_SECRET_KEY');
  const momoCallbackMissing = httpsCallbackReady ? [] : ['PAYMENT_PUBLIC_BASE_URL (HTTPS công khai)'];

  const vnpayCredentialMissing = [];
  if (!process.env.VNPAY_TMN_CODE) vnpayCredentialMissing.push('VNPAY_TMN_CODE');
  if (!process.env.VNPAY_HASH_SECRET) vnpayCredentialMissing.push('VNPAY_HASH_SECRET');
  const vnpayCallbackMissing = [];
  if (!httpsCallbackReady) vnpayCallbackMissing.push('PAYMENT_PUBLIC_BASE_URL (HTTPS công khai)');
  if (!VNPAY_IPN_CONFIGURED) vnpayCallbackMissing.push('VNPAY_IPN_CONFIGURED=true sau khi khai báo IPN trên cổng VNPAY');

  const vietqrAccount = await fetchVietQrAccountConfig();
  const vietqrCredentialMissing = vietqrAccount ? [] : ['Thêm và kích hoạt tài khoản nhận tiền tại Admin → Quản trị hệ thống → Tài khoản ngân hàng.'];

  return {
    sandboxOnly: true,
    methods: {
      momo: {
        canCreate: momoCredentialMissing.length === 0 && serviceMissing.length === 0,
        ready: momoCredentialMissing.length === 0 && serviceMissing.length === 0 && momoCallbackMissing.length === 0,
        missingCredentials: momoCredentialMissing,
        missingService: serviceMissing,
        missingCallbacks: momoCallbackMissing,
        missing: [...momoCredentialMissing, ...serviceMissing, ...momoCallbackMissing],
      },
      vnpay: {
        canCreate: vnpayCredentialMissing.length === 0 && serviceMissing.length === 0,
        ready: vnpayCredentialMissing.length === 0 && serviceMissing.length === 0 && vnpayCallbackMissing.length === 0,
        missingCredentials: vnpayCredentialMissing,
        missingService: serviceMissing,
        missingCallbacks: vnpayCallbackMissing,
        missing: [...vnpayCredentialMissing, ...serviceMissing, ...vnpayCallbackMissing],
      },
      vietqr: {
        canCreate: vietqrCredentialMissing.length === 0 && serviceMissing.length === 0,
        ready: vietqrCredentialMissing.length === 0 && serviceMissing.length === 0,
        missingCredentials: vietqrCredentialMissing,
        missingService: serviceMissing,
        missingCallbacks: [],
        missing: [...vietqrCredentialMissing, ...serviceMissing],
      },
    },
  };
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(data));
}

function sendText(res, statusCode, body) {
  res.writeHead(statusCode, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
}

function redirect(res, destination) {
  res.writeHead(302, { location: destination, 'cache-control': 'no-store' });
  res.end();
}

async function readJsonBody(req, limit = 100 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error('Yêu cầu vượt quá giới hạn dữ liệu.'), { statusCode: 413 });
    chunks.push(chunk);
  }
  if (size === 0) return {};
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Body phải là một JSON object.');
    return parsed;
  } catch {
    throw Object.assign(new Error('Nội dung JSON không hợp lệ.'), { statusCode: 400 });
  }
}

function persistPayments() {
  const save = async () => {
    await mkdir(STATE_DIR, { recursive: true, mode: 0o700 });
    const tempPath = `${STATE_FILE}.${randomBytes(8).toString('hex')}.tmp`;
    try {
      await writeFile(tempPath, JSON.stringify([...PAYMENTS.values()], null, 2), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      await rename(tempPath, STATE_FILE);
    } catch (error) {
      try { await rm(tempPath, { force: true }); } catch { /* Preserve the original write error. */ }
      throw error;
    }
  };
  const result = paymentsWriteQueue.then(save, save);
  paymentsWriteQueue = result.catch(() => {});
  return result;
}

async function loadPayments() {
  try {
    const rows = JSON.parse(await readFile(STATE_FILE, 'utf8'));
    if (Array.isArray(rows)) for (const row of rows) if (row?.paymentId) PAYMENTS.set(row.paymentId, row);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

function newId() {
  return `${Date.now()}${randomBytes(12).toString('hex')}`;
}

function rateLimitAllows(req) {
  const now = Date.now();
  const key = getTrustedClientIp(req.socket.remoteAddress, req.headers['x-forwarded-for']);
  const record = RATE_LIMITS.get(key);
  if (!record || now - record.start > 60_000) {
    RATE_LIMITS.set(key, { start: now, count: 1 });
    return true;
  }
  record.count += 1;
  return record.count <= 30;
}

async function notifyBusinessApi(payment) {
  if (!INTERNAL_API_IS_LOOPBACK || PAYMENT_SERVICE_TOKEN.length < 32) {
    payment.businessSyncError = 'Business API nội bộ chưa được cấu hình an toàn.';
    return false;
  }
  if (BUSINESS_SYNC_IN_FLIGHT.has(payment.paymentId) || payment.businessSyncedAt) return Boolean(payment.businessSyncedAt);
  BUSINESS_SYNC_IN_FLIGHT.add(payment.paymentId);
  try {
    const response = await fetch(`${APP_API_INTERNAL_URL}/api/app/internal/payment-settlement`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-ems-payment-service-token': PAYMENT_SERVICE_TOKEN },
      body: JSON.stringify({
        paymentId: payment.paymentId, orderId: payment.orderId, provider: payment.provider,
        status: payment.status, amount: payment.amount, transactionId: payment.transactionId || null,
      }),
      signal: AbortSignal.timeout(5000),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.synchronized !== true) {
      payment.businessSyncError = `Business API trả về HTTP ${response.status}.`;
      payment.businessSyncAttemptedAt = new Date().toISOString();
      await persistPayments();
      return false;
    }
    payment.businessSyncedAt = new Date().toISOString();
    payment.businessSyncError = null;
    payment.businessSyncAttemptedAt = payment.businessSyncedAt;
    await persistPayments();
    return true;
  } catch (error) {
    payment.businessSyncError = error?.name === 'TimeoutError' ? 'Business API phản hồi quá thời gian.' : 'Không kết nối được Business API nội bộ.';
    payment.businessSyncAttemptedAt = new Date().toISOString();
    await persistPayments();
    return false;
  } finally {
    BUSINESS_SYNC_IN_FLIGHT.delete(payment.paymentId);
  }
}

function sanitizePayment(payment) {
  return {
    paymentId: payment.paymentId,
    provider: payment.provider,
    orderId: payment.orderId,
    amount: payment.amount,
    status: payment.status,
    transactionId: payment.transactionId || null,
    message: payment.status === 'paid'
      ? 'Cổng thanh toán đã xác nhận giao dịch.'
      : payment.status === 'failed'
        ? 'Giao dịch thất bại hoặc bị hủy tại cổng thanh toán.'
        : payment.provider === 'vietqr'
          ? 'Đang chờ cửa hàng đối soát khoản tiền đã vào tài khoản ngân hàng.'
          : 'Đang chờ cổng thanh toán xác nhận qua IPN.',
  };
}

function paymentForStatusRequest(url, req) {
  const match = url.pathname.match(/^\/api\/payments\/status\/([A-Za-z0-9_-]{20,100})$/);
  if (!match) return null;
  const payment = PAYMENTS.get(match[1]);
  if (!payment || !safeHexEqual(String(req.headers['x-payment-token'] || ''), payment.statusToken)) return null;
  return payment;
}

async function verifyOrderBeforePayment(provider, orderId, amount) {
  if (PAYMENT_SERVICE_TOKEN.length < 32) {
    return { ok: false, status: 503, error: 'Thiếu PAYMENT_SERVICE_TOKEN để xác minh đơn phía máy chủ; chưa tạo giao dịch.' };
  }
  if (!INTERNAL_API_IS_LOOPBACK) {
    return { ok: false, status: 503, error: 'APP_API_INTERNAL_URL phải trỏ tới business API loopback đáng tin cậy; chưa tạo giao dịch.' };
  }
  let response;
  try {
    response = await fetch(`${APP_API_INTERNAL_URL}/api/app/internal/payment-intent`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'x-ems-payment-service-token': PAYMENT_SERVICE_TOKEN,
      },
      body: JSON.stringify({ orderId, amount, provider }),
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    return { ok: false, status: 503, error: 'Không kết nối được business API để xác minh đơn; chưa tạo giao dịch.' };
  }
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const allowedStatus = [400, 403, 404, 409, 503].includes(response.status) ? response.status : 503;
    return { ok: false, status: allowedStatus, error: result.error || 'Business API từ chối xác minh đơn; chưa tạo giao dịch.' };
  }
  if (result.verified !== true || result.orderId !== orderId || result.provider !== provider || Number(result.amount) !== amount) {
    return { ok: false, status: 409, error: 'Business API trả kết quả xác minh đơn không khớp; chưa tạo giao dịch.' };
  }
  return { ok: true };
}

async function verifyOrderForRecovery(orderCode, phone) {
  if (PAYMENT_SERVICE_TOKEN.length < 32 || !INTERNAL_API_IS_LOOPBACK) {
    return { ok: false, status: 503, error: 'Dịch vụ xác minh đơn chưa sẵn sàng. Hãy thử lại sau.' };
  }
  let response;
  try {
    response = await fetch(`${APP_API_INTERNAL_URL}/api/app/internal/payment-recovery`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'x-ems-payment-service-token': PAYMENT_SERVICE_TOKEN,
      },
      body: JSON.stringify({ orderCode, phone }),
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    return { ok: false, status: 503, error: 'Không kết nối được hệ thống đơn hàng. Hãy thử lại khi mạng ổn định.' };
  }
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const allowedStatus = [400, 403, 404, 409, 503].includes(response.status) ? response.status : 503;
    return { ok: false, status: allowedStatus, error: result.error || 'Không xác minh được thông tin khôi phục.' };
  }
  if (result.authorized !== true || result.orderId !== orderCode
    || !['momo', 'vnpay', 'vietqr'].includes(result.provider)
    || !Number.isSafeInteger(Number(result.amount)) || Number(result.amount) < 1000) {
    return { ok: false, status: 409, error: 'Kết quả xác minh đơn không hợp lệ.' };
  }
  return { ok: true, intent: result };
}

async function recoverPayment(body, req, res) {
  if (!rateLimitAllows(req)) return sendJson(res, 429, { error: 'Quá nhiều yêu cầu khôi phục. Hãy chờ một phút rồi thử lại.' });
  const orderCode = String(body.orderCode || '').trim().toUpperCase();
  const phone = String(body.phone || '').trim();
  if (!/^WEB-[0-9]{5,12}$/.test(orderCode) || phone.length < 9 || phone.length > 15) {
    return sendJson(res, 400, { error: 'Nhập đúng mã đơn hàng và số điện thoại đã dùng khi đặt hàng.' });
  }

  // Chỉ tìm giao dịch sau khi business API đã đối chiếu mã đơn + số điện thoại trong SQLite.
  const verified = await verifyOrderForRecovery(orderCode, phone);
  if (!verified.ok) return sendJson(res, verified.status, { error: verified.error });
  const intent = verified.intent;
  const orderPayments = [...PAYMENTS.values()]
    .filter((item) => item.orderId === orderCode && item.provider === intent.provider)
    .sort((a, b) => Number(b.createdAtMs || 0) - Number(a.createdAtMs || 0));

  if (intent.paymentStatus === 'completed') {
    const paid = orderPayments.find((item) => item.status === 'paid');
    return sendJson(res, 200, {
      recoveryState: 'paid', orderId: orderCode, provider: intent.provider, amount: intent.amount,
      paymentId: paid?.paymentId || null,
      message: intent.provider === 'vietqr'
        ? 'Cửa hàng đã xác nhận khoản chuyển khoản. Không cần thanh toán thêm.'
        : 'Đơn hàng đã được xác nhận thanh toán. Không cần thanh toán thêm.',
    });
  }

  if (intent.paymentStatus !== 'pending_payment') {
    return sendJson(res, 409, {
      recoveryState: 'closed', orderId: orderCode,
      message: 'Đơn hàng không còn ở trạng thái chờ thanh toán. Hãy tra cứu trạng thái hoặc gửi yêu cầu hỗ trợ.',
    });
  }

  const pending = orderPayments.find((item) => item.status === 'pending' && (item.paymentUrl || item.qrImageUrl));
  if (pending) {
    const ageMs = Math.max(0, Date.now() - Number(pending.createdAtMs || 0));
    const providerWindowMs = 14 * 60_000;
    // VietQR là lệnh chuyển khoản tĩnh theo đơn; MoMo/VNPAY có cửa sổ thanh toán hữu hạn.
    if (pending.provider === 'vietqr' || ageMs < providerWindowMs) {
      return sendJson(res, 200, {
        recoveryState: 'resumable',
        ...sanitizePayment(pending),
        statusToken: pending.statusToken,
        paymentUrl: pending.paymentUrl || null,
        qrMode: pending.qrMode || null,
        qrImageUrl: pending.qrImageUrl || null,
        qrContent: pending.qrContent || null,
        transferContent: pending.transferContent || null,
        bank: pending.bank || null,
        expiresAt: pending.expiresAt || null,
      });
    }
    pending.status = 'expired';
    pending.updatedAt = new Date().toISOString();
    pending.failureReason = 'Phiên thanh toán đã hết thời gian tiếp tục.';
    await persistPayments();
  }

  const latest = orderPayments[0];
  if (latest?.status === 'paid') {
    return sendJson(res, 200, {
      recoveryState: 'paid', orderId: orderCode, provider: intent.provider, amount: intent.amount,
      paymentId: latest.paymentId, message: 'Giao dịch đã được cổng xác nhận. Đang cập nhật trạng thái đơn hàng.',
    });
  }
  return sendJson(res, 200, {
    recoveryState: 'create_new', orderId: orderCode, provider: intent.provider,
    amount: intent.amount, canCreateNew: true,
    message: 'Đơn hàng vẫn chờ thanh toán. Bạn có thể tạo lại hướng dẫn thanh toán cho chính đơn này.',
  });
}

async function createPayment(provider, body, req, res) {
  if (!rateLimitAllows(req)) return sendJson(res, 429, { error: 'Quá nhiều yêu cầu tạo thanh toán. Hãy thử lại sau.' });
  const config = (await paymentConfig()).methods[provider];
  if (!config?.canCreate) {
    return sendJson(res, 503, {
      error: `Chưa có đủ cấu hình để tạo yêu cầu ${provider === 'momo' ? 'MoMo' : provider === 'vnpay' ? 'VNPAY' : 'VietQR'}.`,
      missing: config?.missing || [],
    });
  }

  const orderId = String(body.orderId || '').trim();
  const amount = Number(body.amount);
  if (!/^WEB-[0-9]{5,12}$/.test(orderId)) return sendJson(res, 400, { error: 'Mã đơn hàng không hợp lệ.' });
  if (!Number.isSafeInteger(amount) || amount < 1000 || amount > 100_000_000) {
    return sendJson(res, 400, { error: 'Số tiền sandbox phải là số nguyên từ 1.000đ đến 100.000.000đ.' });
  }

  // Không tin orderId/amount do trình duyệt cung cấp. Business API kiểm tra đơn,
  // phương thức, trạng thái và tổng tiền đã tính trong SQLite trước khi liên hệ cổng.
  const intent = await verifyOrderBeforePayment(provider, orderId, amount);
  if (!intent.ok) return sendJson(res, intent.status, { error: intent.error });

  const existingPending = [...PAYMENTS.values()].find((item) => item.orderId === orderId && item.provider === provider && item.status === 'pending');
  if (existingPending && (existingPending.paymentUrl || existingPending.qrImageUrl) && Date.now() - existingPending.createdAtMs < 14 * 60_000) {
    if (existingPending.amount !== amount) return sendJson(res, 409, { error: 'Số tiền khác với giao dịch đang chờ cho đơn hàng này.' });
    return sendJson(res, 200, {
      paymentUrl: existingPending.paymentUrl || null,
      qrMode: existingPending.qrMode || null,
      qrImageUrl: existingPending.qrImageUrl || null,
      transferContent: existingPending.transferContent || null,
      bank: existingPending.bank || null,
      ...sanitizePayment(existingPending), statusToken: existingPending.statusToken,
    });
  }

  const paymentId = newId();
  const statusToken = randomBytes(32).toString('hex');
  const payment = {
    paymentId, statusToken, provider, orderId, amount,
    providerOrderId: paymentId,
    status: 'pending', transactionId: null,
    createdAt: new Date().toISOString(), createdAtMs: Date.now(),
    returnSignatureValid: null,
  };
  PAYMENTS.set(paymentId, payment);
  await persistPayments();

  try {
    if (provider === 'vietqr') {
      const bankAccount = await fetchVietQrAccountConfig();
      if (!bankAccount) {
        payment.status = 'failed';
        payment.failureReason = 'Chưa có tài khoản ngân hàng VietQR đang được kích hoạt trong phần Admin.';
        await persistPayments();
        return sendJson(res, 503, { error: payment.failureReason });
      }
      // Nội dung không dấu, chỉ chữ/số/khoảng trắng theo Quick Link VietQR.
      // Rút dấu gạch trong mã đơn để tương thích với bộ ký tự của addInfo.
      const transferContent = `EMSYS WEB ${orderId.slice(4)}`;
      const qr = buildVietQrQuickLink({
        bankCode: bankAccount.bankCode,
        accountNumber: bankAccount.accountNumber,
        accountName: bankAccount.accountName,
        amount,
        addInfo: transferContent,
      });
      payment.qrMode = 'bank-transfer-vietqr';
      payment.qrImageUrl = qr.imageUrl;
      payment.transferContent = qr.transferContent;
      payment.bank = {
        bankCode: qr.bankCode,
        bankName: bankAccount.bankName,
        accountNumber: qr.accountNumber,
        accountName: qr.accountName,
      };
    } else if (provider === 'momo') {
      const payload = {
        partnerCode: process.env.MOMO_PARTNER_CODE,
        partnerName: process.env.MOMO_PARTNER_NAME || 'EMSystems',
        storeId: process.env.MOMO_STORE_ID || 'EMSystemsSandbox',
        requestId: paymentId,
        amount,
        orderId: paymentId,
        orderInfo: `Thanh toan don hang ${orderId}`,
        redirectUrl: `${FRONTEND_URL}/payment/return?paymentId=${paymentId}#paymentToken=${statusToken}`,
        ipnUrl: process.env.MOMO_IPN_URL || `${PUBLIC_BASE_URL || `http://127.0.0.1:${PORT}`}/api/payments/momo/ipn`,
        lang: 'vi',
        requestType: 'captureWallet',
        extraData: '',
      };
      payload.signature = momoCreateSignature(payload, process.env.MOMO_ACCESS_KEY, process.env.MOMO_SECRET_KEY);
      const response = await fetch(MOMO_CREATE_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json; charset=UTF-8' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30_000),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || Number(result.resultCode) !== 0 || !/^https:\/\//i.test(String(result.payUrl || ''))) {
        payment.status = 'failed';
        payment.failureReason = `MoMo sandbox không tạo được giao dịch (resultCode ${result.resultCode ?? 'n/a'}).`;
        await persistPayments();
        return sendJson(res, 502, { error: payment.failureReason });
      }
      payment.providerTransactionId = result.transId || null;
      payment.paymentUrl = result.payUrl;
    } else {
      const createdAt = new Date();
      const expiresAt = new Date(createdAt.getTime() + 15 * 60_000);
      const params = {
        vnp_Version: '2.1.0',
        vnp_Command: 'pay',
        vnp_TmnCode: process.env.VNPAY_TMN_CODE,
        vnp_Amount: String(amount * 100),
        vnp_CurrCode: 'VND',
        vnp_TxnRef: paymentId,
        vnp_OrderInfo: `Thanh toan don hang ${orderId}`,
        vnp_OrderType: 'other',
        // Yêu cầu VNPAY ưu tiên phương thức quét QR trên trang thanh toán.
        vnp_BankCode: 'VNPAYQR',
        vnp_Locale: 'vn',
        vnp_ReturnUrl: VNPAY_RETURN_URL,
        vnp_IpAddr: getTrustedClientIp(req.socket.remoteAddress, req.headers['x-forwarded-for']).slice(0, 45),
        vnp_CreateDate: formatVnpayDate(createdAt),
        vnp_ExpireDate: formatVnpayDate(expiresAt),
      };
      const query = vnpayCanonicalQuery(params);
      const signature = vnpaySignature(params, process.env.VNPAY_HASH_SECRET);
      payment.paymentUrl = `${VNPAY_PAYMENT_URL}?${query}&vnp_SecureHash=${signature}`;

      // Merchant Hosted QR is a separate VNPAY capability. Request an official QR payload
      // server-to-server; some merchant accounts/sandbox tenants may not have this enabled.
      const qrParams = { ...params, vnp_Command: 'genqr' };
      delete qrParams.vnp_BankCode;
      const qrQuery = vnpayCanonicalQuery(qrParams);
      const qrSignature = vnpaySignature(qrParams, process.env.VNPAY_HASH_SECRET);
      try {
        const qrResponse = await fetch(`${VNPAY_PAYMENT_URL}?${qrQuery}&vnp_SecureHash=${qrSignature}`, {
          method: 'GET',
          headers: { accept: 'application/json' },
          cache: 'no-store',
          signal: AbortSignal.timeout(12_000),
        });
        const qrResult = await qrResponse.json().catch(() => null);
        if (qrResponse.ok && String(qrResult?.code) === '00' && typeof qrResult?.qrcontent === 'string' && qrResult.qrcontent.trim()) {
          payment.qrMode = 'merchant-hosted-qr';
          payment.qrContent = qrResult.qrcontent.trim();
          payment.qrProviderMessage = String(qrResult.message || 'VNPAY đã tạo QR.');
        } else {
          payment.qrMode = 'payment-url';
          payment.qrProviderCode = String(qrResult?.code || (qrResponse.ok ? 'INVALID_QR_RESPONSE' : `HTTP_${qrResponse.status}`));
          payment.qrProviderMessage = String(qrResult?.message || 'Merchant Hosted QR chưa khả dụng cho merchant này. Dùng QR mở trang thanh toán VNPAY thay thế.').slice(0, 240);
          payment.qrContent = payment.paymentUrl;
        }
      } catch (qrError) {
        // Still keep the valid signed payment URL; do not mark the payment failed just because genqr is unavailable.
        payment.qrMode = 'payment-url';
        payment.qrProviderCode = qrError?.name === 'TimeoutError' ? 'QR_TIMEOUT' : 'QR_UNAVAILABLE';
        payment.qrProviderMessage = 'Không gọi được API Merchant Hosted QR. Dùng QR mở trang thanh toán VNPAY thay thế.';
        payment.qrContent = payment.paymentUrl;
      }
    }
    payment.updatedAt = new Date().toISOString();
    await persistPayments();
    return sendJson(res, 200, {
      paymentUrl: payment.paymentUrl || null,
      qrMode: payment.qrMode || null,
      qrContent: payment.qrContent || null,
      qrImageUrl: payment.qrImageUrl || null,
      transferContent: payment.transferContent || null,
      bank: payment.bank || null,
      qrMessage: payment.qrProviderMessage || null,
      qrProviderCode: payment.qrProviderCode || null,
      ...sanitizePayment(payment),
      statusToken,
    });
  } catch (error) {
    payment.status = 'failed';
    payment.failureReason = 'Không thể kết nối cổng thanh toán sandbox.';
    payment.updatedAt = new Date().toISOString();
    await persistPayments();
    return sendJson(res, 502, { error: payment.failureReason, detail: error?.name === 'TimeoutError' ? 'Cổng thanh toán phản hồi quá chậm.' : undefined });
  }
}

async function handleMomoIpn(req, res) {
  const body = await readJsonBody(req);
  if (!process.env.MOMO_ACCESS_KEY || !process.env.MOMO_SECRET_KEY || !process.env.MOMO_PARTNER_CODE) {
    return sendJson(res, 503, { error: 'MoMo sandbox IPN chưa được cấu hình.' });
  }
  if (!verifyMomoNotification(body, process.env.MOMO_ACCESS_KEY, process.env.MOMO_SECRET_KEY)) {
    return sendJson(res, 400, { error: 'Chữ ký IPN MoMo không hợp lệ.' });
  }
  if (body.partnerCode !== process.env.MOMO_PARTNER_CODE) return sendJson(res, 400, { error: 'PartnerCode không khớp.' });
  const payment = [...PAYMENTS.values()].find((item) => item.provider === 'momo' && item.providerOrderId === String(body.orderId || ''));
  if (!payment) return sendJson(res, 404, { error: 'Không tìm thấy giao dịch MoMo tương ứng.' });
  if (String(body.requestId || '') !== payment.providerOrderId) return sendJson(res, 409, { error: 'RequestId không khớp với giao dịch.' });
  if (Number(body.amount) !== payment.amount) return sendJson(res, 409, { error: 'Số tiền IPN không khớp với giao dịch đã tạo.' });
  if (payment.status === 'pending') {
    payment.status = Number(body.resultCode) === 0 ? 'paid' : 'failed';
    payment.transactionId = body.transId == null ? null : String(body.transId);
    payment.gatewayResultCode = Number(body.resultCode);
    payment.updatedAt = new Date().toISOString();
    await persistPayments();
  }
  if (payment.status === 'paid' || payment.status === 'failed') await notifyBusinessApi(payment);
  return res.writeHead(204).end();
}

function validateVnpayNotice(params) {
  if (!process.env.VNPAY_HASH_SECRET || !process.env.VNPAY_TMN_CODE) {
    return { ok: false, code: '97', message: 'VNPAY sandbox is not configured' };
  }
  if (!verifyVnpaySignature(params, process.env.VNPAY_HASH_SECRET)) return { ok: false, code: '97', message: 'Invalid signature' };
  if (params.vnp_TmnCode !== process.env.VNPAY_TMN_CODE) return { ok: false, code: '97', message: 'Invalid merchant' };
  const payment = PAYMENTS.get(String(params.vnp_TxnRef || ''));
  if (!payment || payment.provider !== 'vnpay') return { ok: false, code: '01', message: 'Order not found' };
  if (Number(params.vnp_Amount) !== payment.amount * 100) return { ok: false, code: '04', message: 'Invalid amount' };
  return { ok: true, payment };
}

async function handleVnpayIpn(url, res) {
  const params = Object.fromEntries(url.searchParams.entries());
  const validation = validateVnpayNotice(params);
  if (!validation.ok) return sendJson(res, 200, { RspCode: validation.code, Message: validation.message });
  const { payment } = validation;
  if (payment.status === 'pending') {
    payment.status = params.vnp_ResponseCode === '00' && params.vnp_TransactionStatus === '00' ? 'paid' : 'failed';
    payment.transactionId = params.vnp_TransactionNo || null;
    payment.gatewayResultCode = params.vnp_ResponseCode || null;
    payment.updatedAt = new Date().toISOString();
    await persistPayments();
  }
  if (payment.status === 'paid' || payment.status === 'failed') await notifyBusinessApi(payment);
  if (payment.status === 'paid' || payment.status === 'failed') return sendJson(res, 200, { RspCode: '00', Message: 'Confirm Success' });
  return sendJson(res, 200, { RspCode: '02', Message: 'Order already confirmed' });
}

async function handleVnpayReturn(url, res) {
  const params = Object.fromEntries(url.searchParams.entries());
  const payment = PAYMENTS.get(String(params.vnp_TxnRef || ''));
  const valid = verifyVnpaySignature(params, process.env.VNPAY_HASH_SECRET)
    && params.vnp_TmnCode === process.env.VNPAY_TMN_CODE
    && payment?.provider === 'vnpay'
    && Number(params.vnp_Amount) === payment.amount * 100;
  if (payment) {
    payment.returnSignatureValid = Boolean(valid);
    payment.returnCode = valid ? String(params.vnp_ResponseCode || '') : 'INVALID_SIGNATURE';
    payment.updatedAt = new Date().toISOString();
    await persistPayments();
    return redirect(res, `${FRONTEND_URL}/payment/return?paymentId=${encodeURIComponent(payment.paymentId)}#paymentToken=${encodeURIComponent(payment.statusToken)}`);
  }
  return redirect(res, `${FRONTEND_URL}/payment/return?invalidReturn=1`);
}

async function handleRequest(req, res) {
  const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
  if (req.method === 'GET' && url.pathname === '/api/payments/health') return sendJson(res, 200, { ok: true, service: 'payment-sandbox', mode: 'sandbox-only' });
  if (req.method === 'GET' && url.pathname === '/api/payments/config') return sendJson(res, 200, await paymentConfig());

  const createMatch = url.pathname.match(/^\/api\/payments\/(momo|vnpay|vietqr)\/create$/);
  if (req.method === 'POST' && createMatch) return serializePaymentMutation(async () => createPayment(createMatch[1], await readJsonBody(req), req, res));
  if (req.method === 'POST' && url.pathname === '/api/payments/recover') return serializePaymentMutation(async () => recoverPayment(await readJsonBody(req), req, res));
  if (req.method === 'GET' && url.pathname === '/api/payments/vnpay/ipn') return serializePaymentMutation(() => handleVnpayIpn(url, res));
  if (req.method === 'GET' && url.pathname === '/api/payments/vnpay/return') return serializePaymentMutation(() => handleVnpayReturn(url, res));
  if (req.method === 'POST' && url.pathname === '/api/payments/momo/ipn') return serializePaymentMutation(() => handleMomoIpn(req, res));
  if (req.method === 'GET' && url.pathname.startsWith('/api/payments/status/')) {
    const payment = paymentForStatusRequest(url, req);
    return payment ? sendJson(res, 200, sanitizePayment(payment)) : sendJson(res, 404, { error: 'Không tìm thấy giao dịch sandbox.' });
  }
  return sendJson(res, 404, { error: 'Not found' });
}

await loadPayments();

const server = createServer((req, res) => {
  Promise.resolve(handleRequest(req, res)).catch((error) => {
    const status = Number(error?.statusCode) || 500;
    if (status >= 500) void reportOperationalError({ service: 'payment-api', status, method: req.method, pathname: new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`).pathname });
    if (res.headersSent) return res.destroy();
    sendJson(res, status, { error: error?.message || 'Lỗi dịch vụ thanh toán sandbox.' });
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[EMSystems] Payment sandbox API: http://127.0.0.1:${PORT}/api/payments/health`);
  console.log('[EMSystems] Sandbox only; provider secrets are read from .env and are never sent to the browser.');
});

// Retry IPN-to-business synchronization after transient API/network failures.
const businessSyncTimer = setInterval(() => {
  void serializePaymentMutation(async () => {
    for (const payment of PAYMENTS.values()) {
      if (['paid', 'failed'].includes(payment.status) && !payment.businessSyncedAt) {
        await notifyBusinessApi(payment);
      }
    }
  });
}, 30_000);
businessSyncTimer.unref();

function stop() {
  clearInterval(businessSyncTimer);
  server.close(() => process.exit(0));
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);