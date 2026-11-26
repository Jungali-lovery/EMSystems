import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { getTrustedClientIp, isLoopbackAddress } from './security/client-ip.mjs';
import { createInitialData } from '../src/data/initialData.js';
import { createPasswordCredential } from '../src/demo-auth.js';
import { reportOperationalError } from './monitoring.mjs';
import {
  checkPhoneVerification, deliverCustomerNotification, emailDeliveryConfigured,
  getDemoMailboxMessage, mockCommunicationEnabled, sendEmail, startPhoneVerification,
} from './communication-service.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
async function loadEnvironmentFile() {
  try {
    const raw = await readFile(resolve(ROOT, '.env'), 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!match || Object.hasOwn(process.env, match[1])) continue;
      let value = match[2];
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      process.env[match[1]] = value;
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}
await loadEnvironmentFile();
const DB_PATH = resolve(process.env.EMSYSTEMS_DB_PATH || resolve(ROOT, '.emsystems-data', 'emsystems.sqlite'));
const PORT = Number(process.env.APP_API_PORT) || 5176;
const APP_ORIGIN = (process.env.PUBLIC_APP_ORIGIN || 'http://127.0.0.1:5173').replace(/\/$/, '');
const ALLOWED_ORIGINS = new Set((process.env.APP_ALLOWED_ORIGINS || `${APP_ORIGIN},http://localhost:5173`).split(',').map((item) => item.trim().replace(/\/$/, '')).filter(Boolean));
const PAYMENT_SERVICE_TOKEN = String(process.env.PAYMENT_SERVICE_TOKEN || '');
const REQUIRE_PHONE_VERIFICATION = process.env.EMSYSTEMS_REQUIRE_PHONE_VERIFICATION === 'true';
const REQUIRE_DATA_CONSENT = process.env.EMSYSTEMS_REQUIRE_DATA_CONSENT === 'true';
const PAYMENT_API_INTERNAL_URL = (process.env.PAYMENT_API_INTERNAL_URL || 'http://127.0.0.1:5175').replace(/\/$/, '');
const PAYMENT_API_INTERNAL_IS_LOOPBACK = (() => {
  try {
    const url = new URL(PAYMENT_API_INTERNAL_URL);
    return url.protocol === 'http:' && isLoopbackAddress(url.hostname) && !url.username && !url.password && !url.search && !url.hash;
  } catch { return false; }
})();
const APP_DATA_KEY = 'emsystems.demo.data.v1';
const SECURE_COOKIE = process.env.NODE_ENV === 'production' || process.env.EMSYSTEMS_SECURE_COOKIES === 'true';
const COOKIE_NAME = SECURE_COOKIE ? '__Host-ems_session' : 'ems_session';
const SESSION_ABSOLUTE_MS = 12 * 60 * 60 * 1000;
const MAX_BODY_BYTES = 1024 * 1024;
// Encrypted AES-GCM envelopes are Base64-expanded; 38 MiB accommodates the
// 36 MiB browser upload ceiling plus the JSON request wrapper.
const MAX_BACKUP_BYTES = 38 * 1024 * 1024;
const storageContext = new AsyncLocalStorage();
let queue = Promise.resolve();

await mkdir(dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;
  CREATE TABLE IF NOT EXISTS app_kv (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  ) STRICT;
  CREATE TABLE IF NOT EXISTS sessions (
    sid TEXT PRIMARY KEY,
    storage_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  ) STRICT;
  CREATE TABLE IF NOT EXISTS idempotency (
    sid TEXT NOT NULL,
    route TEXT NOT NULL,
    request_key TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    response_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (sid, route, request_key)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);
  CREATE INDEX IF NOT EXISTS idempotency_created_idx ON idempotency(created_at);
  CREATE TABLE IF NOT EXISTS password_reset_tokens (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    used_at INTEGER
  ) STRICT;
  CREATE INDEX IF NOT EXISTS password_reset_user_idx ON password_reset_tokens(user_id, expires_at);
`);

// Public catalogue GETs use a separate WAL reader. They never acquire the
// writer connection's transaction or rewrite the app_kv JSON snapshot.
const readDb = new DatabaseSync(DB_PATH);
readDb.exec('PRAGMA query_only = ON; PRAGMA busy_timeout = 5000;');
const selectKvReadOnly = readDb.prepare('SELECT key, value FROM app_kv');

class ContextStorage {
  constructor(which) { this.which = which; }
  #map() {
    const ctx = storageContext.getStore();
    if (!ctx) throw new Error('Storage access outside API request context.');
    return this.which === 'localStorage' ? ctx.local : ctx.session;
  }
  get length() { return this.#map().size; }
  key(index) { return [...this.#map().keys()][Number(index)] ?? null; }
  getItem(key) { const map = this.#map(); const k = String(key); return map.has(k) ? map.get(k) : null; }
  setItem(key, value) { this.#map().set(String(key), String(value)); }
  removeItem(key) { this.#map().delete(String(key)); }
  clear() { this.#map().clear(); }
}

if (typeof globalThis.CustomEvent === 'undefined') {
  globalThis.CustomEvent = class CustomEvent {
    constructor(type, options = {}) { this.type = type; this.detail = options.detail; }
  };
}
globalThis.window = {
  get localStorage() { return new ContextStorage('localStorage'); },
  get sessionStorage() { return new ContextStorage('sessionStorage'); },
  location: { origin: APP_ORIGIN },
  dispatchEvent() { return true; },
};
const { dataRequest: dispatchDataRequest } = await import('../src/api.js');

const insertKv = db.prepare('INSERT INTO app_kv(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
const selectKv = db.prepare('SELECT key, value FROM app_kv');
const selectAppData = db.prepare('SELECT value FROM app_kv WHERE key = ?');
const selectSession = db.prepare('SELECT storage_json, created_at, expires_at FROM sessions WHERE sid = ?');
const saveSession = db.prepare('INSERT INTO sessions(sid, storage_json, created_at, expires_at) VALUES(?, ?, ?, ?) ON CONFLICT(sid) DO UPDATE SET storage_json = excluded.storage_json, expires_at = excluded.expires_at');
const deleteSession = db.prepare('DELETE FROM sessions WHERE sid = ?');
const deleteAllSessions = db.prepare('DELETE FROM sessions');
const selectIdempotency = db.prepare('SELECT payload_hash, response_json FROM idempotency WHERE sid = ? AND route = ? AND request_key = ?');
const saveIdempotency = db.prepare('INSERT INTO idempotency(sid, route, request_key, payload_hash, response_json, created_at) VALUES(?, ?, ?, ?, ?, ?)');

async function bootstrapAdminCredential() {
  const password = String(process.env.EMSYSTEMS_BOOTSTRAP_ADMIN_PASSWORD || '');
  if (!password) return;
  if (password.length < 12 || password.length > 200) {
    throw new Error('EMSYSTEMS_BOOTSTRAP_ADMIN_PASSWORD must be 12–200 characters.');
  }
  const row = selectAppData.get(APP_DATA_KEY);
  const data = row?.value ? JSON.parse(row.value) : createInitialData();
  const admin = data.users?.find((user) => user.role === 'admin' && user.isActive !== false);
  if (!admin) throw new Error('Cannot bootstrap admin password: no active admin seed account exists.');
  if (!admin.passwordCredential) {
    admin.passwordCredential = await createPasswordCredential(password);
    admin.credentialVersion = Math.max(1, Number(admin.credentialVersion) || 1);
    insertKv.run(APP_DATA_KEY, JSON.stringify(data));
    process.stdout.write('EMSYSTEMS_BOOTSTRAP_ADMIN_PASSWORD applied to the initial admin account. Remove it from .env after first setup.\n');
  }
  delete process.env.EMSYSTEMS_BOOTSTRAP_ADMIN_PASSWORD;
}

await bootstrapAdminCredential();

function serializeQueue(work) {
  const result = queue.then(work, work);
  queue = result.catch(() => {});
  return result;
}

function sendJson(res, status, value, extraHeaders = {}) {
  const payload = JSON.stringify(value);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store, max-age=0',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'x-frame-options': 'DENY',
    'permissions-policy': 'camera=(), microphone=(), geolocation=(self)',
    ...extraHeaders,
  });
  res.end(payload);
}

function secureEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && timingSafeEqual(a, b);
}

function parseCookies(header = '') {
  const values = new Map();
  for (const segment of String(header).split(';')) {
    const separator = segment.indexOf('=');
    if (separator < 1) continue;
    values.set(segment.slice(0, separator).trim(), segment.slice(separator + 1).trim());
  }
  return values;
}

function generateSid() { return randomBytes(32).toString('base64url'); }
function cookieHeader(sid, expired = false) {
  const bits = [`${COOKIE_NAME}=${expired ? '' : sid}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (SECURE_COOKIE) bits.push('Secure');
  bits.push(expired ? 'Max-Age=0' : `Max-Age=${Math.floor(SESSION_ABSOLUTE_MS / 1000)}`);
  return bits.join('; ');
}

function readStoredSession(sid) {
  const row = selectSession.get(sid);
  const now = Date.now();
  if (!row || Number(row.expires_at) <= now || now - Number(row.created_at) > SESSION_ABSOLUTE_MS) {
    deleteSession.run(sid);
    return { storage: new Map(), createdAt: now };
  }
  let parsed = {};
  try { parsed = JSON.parse(row.storage_json); } catch { deleteSession.run(sid); }
  const entries = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? Object.entries(parsed) : [];
  return { storage: new Map(entries.filter(([key, value]) => typeof key === 'string' && typeof value === 'string')), createdAt: Number(row.created_at) || now };
}

function loadLocalStore() {
  return new Map(selectKv.all().map((row) => [String(row.key), String(row.value)]));
}

function loadReadOnlyStore() {
  return new Map(selectKvReadOnly.all().map((row) => [String(row.key), String(row.value)]));
}

function persistContext(ctx) {
  const existing = new Set(selectKv.all().map((row) => String(row.key)));
  for (const [key, value] of ctx.local) {
    insertKv.run(key, value);
    existing.delete(key);
  }
  const removeKv = db.prepare('DELETE FROM app_kv WHERE key = ?');
  for (const key of existing) removeKv.run(key);
}

async function readJsonBody(req, maxBytes) {
  const contentType = String(req.headers['content-type'] || '').toLowerCase();
  if (!contentType.startsWith('application/json')) {
    throw Object.assign(new Error('API chỉ nhận dữ liệu application/json.'), { status: 415 });
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw Object.assign(new Error('Nội dung yêu cầu vượt giới hạn cho phép.'), { status: 413 });
    chunks.push(chunk);
  }
  if (!size) return {};
  let parsed;
  try { parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('JSON không hợp lệ.'), { status: 400 }); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw Object.assign(new Error('Body phải là một JSON object.'), { status: 400 });
  }
  return parsed;
}

const loginBuckets = new Map();
const loginUsernameBuckets = new Map();
const orderBuckets = new Map();
const supportBuckets = new Map();
const supportLookupBuckets = new Map();
const phoneOtpBuckets = new Map();
const passwordResetIpBuckets = new Map();
const passwordResetEmailBuckets = new Map();
const demoMailboxBuckets = new Map();
function throttle(map, key, limit, windowMs) {
  const now = Date.now();
  const current = map.get(key);
  if (!current || now - current.start >= windowMs) {
    map.set(key, { start: now, count: 1 });
    return true;
  }
  current.count += 1;
  if (map.size > 10000) {
    for (const [entry, value] of map) if (now - value.start > windowMs * 2) map.delete(entry);
  }
  return current.count <= limit;
}

function safeErrorStatus(error) {
  const status = Number(error?.status || error?.statusCode || 500);
  return Number.isInteger(status) && status >= 400 && status <= 599 ? status : 500;
}

function validateOrigin(req) {
  const origin = req.headers.origin;
  // GET can be used by server-to-server health/inspection clients without Origin;
  // every mutation must carry a browser origin that is explicitly allowlisted.
  if (!origin) return ['GET', 'HEAD'].includes(String(req.method || '').toUpperCase());
  try {
    const parsed = new URL(origin);
    if (parsed.origin !== origin) return false;
    return ALLOWED_ORIGINS.has(origin.replace(/\/$/, ''));
  } catch {
    return false;
  }
}

function normalizeVietnamPhoneE164(value) {
  let digits = String(value || '').replace(/[^0-9]/g, '');
  if (digits.startsWith('0084')) digits = digits.slice(2);
  if (digits.startsWith('84')) digits = `0${digits.slice(2)}`;
  if (!/^0[35789][0-9]{8}$/.test(digits)) return '';
  return `+84${digits.slice(1)}`;
}

const RESET_GENERIC_MESSAGE = 'Nếu địa chỉ email khớp với tài khoản đang hoạt động, hướng dẫn đặt lại mật khẩu sẽ được gửi. Hãy kiểm tra hộp thư và thư rác.';

async function handlePasswordResetRequest(req, res, ip, body) {
  const email = String(body.email || '').trim().toLowerCase();
  const emailKey = createHash('sha256').update(email).digest('hex');
  if (!throttle(passwordResetIpBuckets, ip, 5, 15 * 60 * 1000)
    || (email && !throttle(passwordResetEmailBuckets, emailKey, 4, 60 * 60 * 1000))) {
    return sendJson(res, 202, { message: RESET_GENERIC_MESSAGE });
  }
  if (!email || email.length > 190 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !emailDeliveryConfigured()) {
    return sendJson(res, 202, { message: RESET_GENERIC_MESSAGE });
  }

  let user = null;
  try {
    const row = selectAppData.get(APP_DATA_KEY);
    const data = row?.value ? JSON.parse(row.value) : createInitialData();
    user = data.users?.find((item) => item.isActive !== false && String(item.email || '').trim().toLowerCase() === email) || null;
  } catch {
    return sendJson(res, 202, { message: RESET_GENERIC_MESSAGE });
  }
  if (!user) return sendJson(res, 202, { message: RESET_GENERIC_MESSAGE });

  const token = randomBytes(32).toString('base64url');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const now = Date.now();
  await serializeQueue(async () => {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('DELETE FROM password_reset_tokens WHERE expires_at <= ? OR used_at IS NOT NULL').run(now);
      db.prepare('DELETE FROM password_reset_tokens WHERE user_id = ?').run(user.id);
      db.prepare('INSERT INTO password_reset_tokens(token_hash, user_id, created_at, expires_at, used_at) VALUES(?, ?, ?, ?, NULL)')
        .run(tokenHash, user.id, now, now + 30 * 60 * 1000);
      db.exec('COMMIT');
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch { /* Preserve the original database error. */ }
      throw error;
    }
  });

  const resetUrl = `${APP_ORIGIN}/reset-password#token=${encodeURIComponent(token)}`;
  let delivery = null;
  try {
    const safeName = String(user.fullName || 'Khách hàng').slice(0, 120);
    delivery = await sendEmail({
      to: email,
      subject: 'Đặt lại mật khẩu EMSystems',
      text: `Xin chào ${safeName}. Bạn vừa yêu cầu đặt lại mật khẩu EMSystems. Liên kết dùng một lần, hết hạn sau 30 phút: ${resetUrl}. Nếu bạn không yêu cầu, hãy bỏ qua email này.`,
      html: `<p>Xin chào ${escapeHtml(safeName)},</p><p>Bạn vừa yêu cầu đặt lại mật khẩu EMSystems.</p><p><a href="${escapeHtml(resetUrl)}">Đặt lại mật khẩu</a></p><p>Liên kết dùng một lần và hết hạn sau 30 phút. Nếu bạn không yêu cầu, hãy bỏ qua email này.</p>`,
    });
  } catch {
    await serializeQueue(async () => {
      db.prepare('DELETE FROM password_reset_tokens WHERE token_hash = ?').run(tokenHash);
    });
    console.error('[EMSystems API] Password reset email delivery failed.');
    void reportOperationalError({ service: 'email-delivery', status: 502, method: 'POST', pathname: '/auth/password-reset/request', category: 'provider_delivery' });
  }
  // The reset token is never returned by the API when using a real provider.
  // In demo mode the unguessable mailbox ID is the only way to view the mock email.
  return sendJson(res, 202, {
    message: RESET_GENERIC_MESSAGE,
    ...(mockCommunicationEnabled() && delivery?.mock === true && delivery.id
      ? { demoEmailId: delivery.id, deliveryMode: 'demo' }
      : {}),
  });
}

async function handlePasswordResetConfirm(req, res, body) {
  const token = String(body.token || '').trim();
  const password = String(body.password || '');
  const confirmPassword = String(body.confirmPassword || '');
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(token) || password.length < 12 || password.length > 200 || password !== confirmPassword) {
    return sendJson(res, 400, { error: 'Liên kết hoặc mật khẩu mới không hợp lệ.' });
  }
  const tokenHash = createHash('sha256').update(token).digest('hex');
  try {
    await serializeQueue(async () => {
      db.exec('BEGIN IMMEDIATE');
      try {
        const now = Date.now();
        const reset = db.prepare('SELECT user_id, expires_at, used_at FROM password_reset_tokens WHERE token_hash = ?').get(tokenHash);
        if (!reset || reset.used_at != null || Number(reset.expires_at) <= now) {
          throw Object.assign(new Error('Liên kết đặt lại mật khẩu đã hết hạn hoặc đã được sử dụng.'), { status: 400 });
        }
        const row = selectAppData.get(APP_DATA_KEY);
        if (!row?.value) throw Object.assign(new Error('Không tìm thấy tài khoản.'), { status: 404 });
        const data = JSON.parse(row.value);
        const user = data.users?.find((item) => Number(item.id) === Number(reset.user_id) && item.isActive !== false);
        if (!user) throw Object.assign(new Error('Không tìm thấy tài khoản đang hoạt động.'), { status: 404 });
        user.passwordCredential = await createPasswordCredential(password);
        user.credentialVersion = Math.max(1, Number(user.credentialVersion) || 1) + 1;
        user.mustChangePassword = false;
        user.passwordResetAt = new Date(now).toISOString();
        if (!Array.isArray(data.auditLogs)) data.auditLogs = [];
        if (!data.nextIds) data.nextIds = {};
        const auditId = Math.max(1, Number(data.nextIds.auditLogs) || 1);
        data.nextIds.auditLogs = auditId + 1;
        data.auditLogs.unshift({
          id: auditId, createdAt: new Date(now).toISOString(), action: 'auth.password_reset_completed',
          actorUserId: user.id, actorName: user.username, details: { userId: user.id, method: 'email-token' },
        });
        insertKv.run(APP_DATA_KEY, JSON.stringify(data));
        db.prepare('UPDATE password_reset_tokens SET used_at = ? WHERE token_hash = ? AND used_at IS NULL').run(now, tokenHash);
        db.prepare('DELETE FROM password_reset_tokens WHERE user_id = ? AND token_hash <> ?').run(user.id, tokenHash);
        // Revoke every session; this avoids keeping a previously stolen session alive after credential recovery.
        db.prepare('DELETE FROM sessions').run();
        db.exec('COMMIT');
      } catch (error) {
        try { db.exec('ROLLBACK'); } catch { /* Preserve the original reset error. */ }
        throw error;
      }
    });
    return sendJson(res, 200, { ok: true, message: 'Đã đặt lại mật khẩu. Hãy đăng nhập bằng mật khẩu mới.' });
  } catch (error) {
    return sendJson(res, safeErrorStatus(error), { error: error.message || 'Không thể đặt lại mật khẩu.' });
  }
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

// Chỉ payment service trên loopback mới được xác minh đơn trước khi tạo giao dịch.
// Không dựa vào số tiền do trình duyệt gửi: SQLite là nguồn dữ liệu sự thật.
async function handleInternalPaymentIntent(req, res) {
  const suppliedToken = String(req.headers['x-ems-payment-service-token'] || '');
  if (PAYMENT_SERVICE_TOKEN.length < 32 || !secureEqual(suppliedToken, PAYMENT_SERVICE_TOKEN)) {
    return sendJson(res, 403, { error: 'Payment service không được xác thực.' });
  }

  let body;
  try { body = await readJsonBody(req, 16 * 1024); }
  catch (error) { return sendJson(res, safeErrorStatus(error), { error: error.message }); }

  const orderId = String(body.orderId || '').trim();
  const provider = String(body.provider || '').trim().toLowerCase();
  const amount = Number(body.amount);
  const expectedMethod = provider === 'momo' ? 'momo_sandbox'
    : provider === 'vnpay' ? 'vnpay_sandbox'
      : provider === 'vietqr' ? 'vietqr_transfer' : '';
  if (!/^WEB-[0-9]{5,12}$/.test(orderId) || !expectedMethod || !Number.isSafeInteger(amount) || amount < 1000) {
    return sendJson(res, 400, { error: 'Thông tin xác minh đơn thanh toán không hợp lệ.' });
  }

  return serializeQueue(async () => {
    db.exec('BEGIN IMMEDIATE');
    try {
      const snapshotRow = selectAppData.get(APP_DATA_KEY);
      if (!snapshotRow?.value) throw Object.assign(new Error('Kho dữ liệu đơn hàng chưa được khởi tạo.'), { status: 503 });
      let snapshot;
      try { snapshot = JSON.parse(snapshotRow.value); }
      catch { throw Object.assign(new Error('Không đọc được snapshot đơn hàng.'), { status: 503 }); }

      const sale = Array.isArray(snapshot?.sales)
        ? snapshot.sales.find((item) => item?.isWebOrder === true && item.invoiceNo === orderId)
        : null;
      if (!sale) throw Object.assign(new Error('Không tìm thấy đơn hàng phía máy chủ.'), { status: 404 });
      if (sale.paymentMethod !== expectedMethod) {
        throw Object.assign(new Error('Nhà cung cấp thanh toán không khớp với đơn hàng.'), { status: 409 });
      }
      if (sale.paymentStatus !== 'pending_payment' || sale.fulfillmentStatus === 'cancelled') {
        throw Object.assign(new Error('Đơn hàng không còn ở trạng thái chờ thanh toán.'), { status: 409 });
      }
      if (!Number.isSafeInteger(Number(sale.totalAmount)) || Number(sale.totalAmount) !== amount) {
        throw Object.assign(new Error('Số tiền yêu cầu không khớp tổng tiền do máy chủ tính.'), { status: 409 });
      }
      const paymentRecord = Array.isArray(snapshot.payments)
        ? snapshot.payments.find((item) => Number(item.saleId) === Number(sale.id) && item.method === expectedMethod)
        : null;
      if (!paymentRecord || Number(paymentRecord.amount) !== amount || paymentRecord.status !== 'pending') {
        throw Object.assign(new Error('Bản ghi thanh toán của đơn hàng không hợp lệ hoặc đã được xử lý.'), { status: 409 });
      }

      db.exec('COMMIT');
      return sendJson(res, 200, { orderId, amount, provider, verified: true });
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch { /* Transaction may already be closed. */ }
      return sendJson(res, safeErrorStatus(error), { error: error.message || 'Không thể xác minh đơn thanh toán.' });
    }
  });
}

// Payment service chỉ được đọc tài khoản VietQR đang kích hoạt qua loopback + shared token.
// Không công khai endpoint này cho trình duyệt hoặc các client không có service secret.
async function handleInternalPaymentConfig(req, res) {
  const suppliedToken = String(req.headers['x-ems-payment-service-token'] || '');
  if (PAYMENT_SERVICE_TOKEN.length < 32 || !secureEqual(suppliedToken, PAYMENT_SERVICE_TOKEN)) {
    return sendJson(res, 403, { error: 'Payment service không được xác thực.' });
  }

  return serializeQueue(async () => {
    db.exec('BEGIN');
    try {
      const snapshotRow = selectAppData.get(APP_DATA_KEY);
      if (!snapshotRow?.value) {
        db.exec('COMMIT');
        return sendJson(res, 200, { configured: false, account: null });
      }
      const snapshot = JSON.parse(snapshotRow.value);
      const active = Array.isArray(snapshot?.bankAccounts)
        ? snapshot.bankAccounts.filter((item) => item?.isActive === true)
        : [];
      if (active.length > 1) throw Object.assign(new Error('Có nhiều hơn một tài khoản VietQR đang kích hoạt.'), { status: 409 });
      const account = active[0];
      const valid = account
        && /^[A-Z0-9-]{2,30}$/.test(String(account.bankCode || '').trim().toUpperCase())
        && /^\d{6,19}$/.test(String(account.accountNumber || '').trim())
        && String(account.bankName || '').trim().length >= 2
        && String(account.accountName || '').trim().length >= 2;
      db.exec('COMMIT');
      return sendJson(res, 200, {
        configured: Boolean(valid),
        account: valid ? {
          bankCode: String(account.bankCode).trim().toUpperCase(),
          bankName: String(account.bankName).trim(),
          accountNumber: String(account.accountNumber).trim(),
          accountName: String(account.accountName).trim(),
        } : null,
      });
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch { /* Transaction may already be closed. */ }
      return sendJson(res, safeErrorStatus(error), { error: error.message || 'Không thể đọc cấu hình VietQR.' });
    }
  });
}

// Chỉ xác minh quyền khôi phục giao dịch; không trả thông tin người nhận hoặc dữ liệu đơn hàng.
async function handleInternalPaymentRecovery(req, res) {
  const suppliedToken = String(req.headers['x-ems-payment-service-token'] || '');
  if (PAYMENT_SERVICE_TOKEN.length < 32 || !secureEqual(suppliedToken, PAYMENT_SERVICE_TOKEN)) {
    return sendJson(res, 403, { error: 'Payment service không được xác thực.' });
  }
  let body;
  try { body = await readJsonBody(req, 16 * 1024); }
  catch (error) { return sendJson(res, safeErrorStatus(error), { error: error.message }); }
  const orderCode = String(body.orderCode || '').trim().toUpperCase();
  const normalizePhone = (value) => {
    let normalized = String(value || '').trim().replace(/[\s().-]/g, '');
    if (normalized.startsWith('+84')) normalized = `0${normalized.slice(3)}`;
    else if (normalized.startsWith('84') && normalized.length === 11) normalized = `0${normalized.slice(2)}`;
    return /^0[35789]\d{8}$/.test(normalized) ? normalized : '';
  };
  const phone = normalizePhone(body.phone);
  if (!/^WEB-[0-9]{5,12}$/.test(orderCode) || !phone) {
    return sendJson(res, 400, { error: 'Mã đơn hoặc số điện thoại chưa đúng định dạng.' });
  }
  return serializeQueue(async () => {
    db.exec('BEGIN');
    try {
      const snapshotRow = selectAppData.get(APP_DATA_KEY);
      if (!snapshotRow?.value) throw Object.assign(new Error('Không tìm thấy đơn hàng.'), { status: 404 });
      const snapshot = JSON.parse(snapshotRow.value);
      const sale = Array.isArray(snapshot?.sales)
        ? snapshot.sales.find((item) => item?.isWebOrder === true && item.invoiceNo === orderCode
          && normalizePhone(item.delivery?.phone || item.customerPhone) === phone)
        : null;
      if (!sale) throw Object.assign(new Error('Không tìm thấy đơn hàng khớp mã và số điện thoại.'), { status: 404 });
      const provider = sale.paymentMethod === 'momo_sandbox' ? 'momo'
        : sale.paymentMethod === 'vnpay_sandbox' ? 'vnpay'
          : sale.paymentMethod === 'vietqr_transfer' ? 'vietqr' : null;
      if (!provider) throw Object.assign(new Error('Đơn hàng không sử dụng thanh toán trực tuyến.'), { status: 409 });
      if (sale.paymentStatus !== 'pending_payment' || sale.fulfillmentStatus === 'cancelled') {
        throw Object.assign(new Error('Đơn hàng không còn chờ thanh toán. Hãy kiểm tra trạng thái đơn hoặc gửi yêu cầu hỗ trợ.'), { status: 409 });
      }
      const expectedMethod = provider === 'momo' ? 'momo_sandbox' : provider === 'vnpay' ? 'vnpay_sandbox' : 'vietqr_transfer';
      const paymentRecord = Array.isArray(snapshot.payments)
        ? snapshot.payments.find((item) => Number(item.saleId) === Number(sale.id) && item.method === expectedMethod && item.status === 'pending')
        : null;
      if (!paymentRecord || Number(paymentRecord.amount) !== Number(sale.totalAmount)) {
        throw Object.assign(new Error('Không còn giao dịch đang chờ hợp lệ cho đơn hàng.'), { status: 409 });
      }
      db.exec('COMMIT');
      return sendJson(res, 200, {
        authorized: true, orderId: sale.invoiceNo, amount: Number(sale.totalAmount), provider,
        paymentStatus: sale.paymentStatus,
      });
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch { /* Transaction may already be closed. */ }
      return sendJson(res, safeErrorStatus(error), { error: error.message || 'Không thể xác minh yêu cầu khôi phục.' });
    }
  });
}

async function dispatchInternalDomainMutation(route, body = {}) {
  return serializeQueue(async () => {
    db.exec('BEGIN IMMEDIATE');
    let committed = false;
    const now = Date.now();
    const ctx = { sid: generateSid(), local: loadLocalStore(), session: new Map(), createdAt: now };
    try {
      const before = new Map(ctx.local);
      const result = await storageContext.run(ctx, () => dispatchDataRequest(route, { method: 'POST', body }));
      const changed = before.size !== ctx.local.size
        || [...before].some(([key, value]) => ctx.local.get(key) !== value);
      if (changed) persistContext(ctx);
      db.exec('COMMIT');
      committed = true;
      return result;
    } catch (error) {
      if (!committed) {
        try { db.exec('ROLLBACK'); } catch { /* Transaction may already be closed. */ }
      }
      throw error;
    }
  });
}

async function handleInternalDomainMutation(req, res, route) {
  const suppliedToken = String(req.headers['x-ems-payment-service-token'] || '');
  if (PAYMENT_SERVICE_TOKEN.length < 32 || !secureEqual(suppliedToken, PAYMENT_SERVICE_TOKEN)) {
    return sendJson(res, 403, { error: 'Payment service không được xác thực.' });
  }
  let body;
  try { body = await readJsonBody(req, 32 * 1024); }
  catch (error) { return sendJson(res, safeErrorStatus(error), { error: error.message }); }
  try {
    const result = await dispatchInternalDomainMutation(route, body);
    return sendJson(res, 200, result);
  } catch (error) {
    if (safeErrorStatus(error) >= 500) void reportOperationalError({ service: 'business-api-internal', status: safeErrorStatus(error), method: req.method, pathname: route });
    return sendJson(res, safeErrorStatus(error), { error: error.message || 'Không thể xử lý sự kiện payment nội bộ.' });
  }
}

async function handleAppApi(req, res, url) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { allow: 'GET, POST, PUT, PATCH, DELETE, OPTIONS', 'cache-control': 'no-store' });
    return res.end();
  }

  const route = url.pathname.slice('/api/app'.length) || '/';
  if (req.method === 'POST' && ['/internal/payment-settlement', '/internal/orders/expire-pending', '/internal/notifications/claim', '/internal/notifications/complete'].includes(route)) {
    return handleInternalDomainMutation(req, res, route);
  }
  if (route === '/internal/payment-intent' && req.method === 'POST') {
    return handleInternalPaymentIntent(req, res);
  }
  if (route === '/internal/payment-config' && req.method === 'GET') {
    return handleInternalPaymentConfig(req, res);
  }
  if (route === '/internal/payment-recovery' && req.method === 'POST') {
    return handleInternalPaymentRecovery(req, res);
  }
  if (!validateOrigin(req)) return sendJson(res, 403, { error: 'Nguồn yêu cầu không được phép.' });

  if (route.includes('..') || route.length > 300) return sendJson(res, 400, { error: 'Đường dẫn API không hợp lệ.' });
  if (url.search.length > 4096) return sendJson(res, 414, { error: 'Tham số truy vấn quá dài.' });
  const clientIp = getTrustedClientIp(req.socket.remoteAddress, req.headers['x-forwarded-for']);
  if (route === '/auth/password-reset/request' && req.method === 'POST') {
    let body;
    try { body = await readJsonBody(req, 16 * 1024); }
    catch (error) { return sendJson(res, safeErrorStatus(error), { error: error.message }); }
    return handlePasswordResetRequest(req, res, clientIp, body);
  }
  if (route === '/auth/password-reset/confirm' && req.method === 'POST') {
    let body;
    try { body = await readJsonBody(req, 16 * 1024); }
    catch (error) { return sendJson(res, safeErrorStatus(error), { error: error.message }); }
    return handlePasswordResetConfirm(req, res, body);
  }
  const demoMailboxMatch = route.match(/^\/demo\/mailbox\/([A-Za-z0-9_-]{24,64})$/);
  if (demoMailboxMatch && req.method === 'GET') {
    if (!mockCommunicationEnabled()) return sendJson(res, 404, { error: 'Không tìm thấy thư demo.' });
    if (!throttle(demoMailboxBuckets, clientIp, 30, 60 * 1000)) {
      return sendJson(res, 429, { error: 'Bạn đã mở hộp thư demo quá nhiều lần. Hãy thử lại sau.' }, { 'retry-after': '60' });
    }
    const message = getDemoMailboxMessage(demoMailboxMatch[1]);
    if (!message) return sendJson(res, 404, { error: 'Thư demo không tồn tại hoặc đã hết hạn.' });
    return sendJson(res, 200, { message });
  }
  if (req.method === 'POST' && ['/store/member/login', '/store/member/register'].includes(route.replace(/\/$/, ''))) {
    return sendJson(res, 410, { error: 'Đăng nhập thành viên chỉ sử dụng tài khoản EMSystems có mật khẩu tại /login. Đăng nhập chỉ bằng số điện thoại đã bị tắt để tránh chiếm đoạt thẻ.' });
  }

  const publicReadOnlyRoutes = new Set(['/store/products', '/store/delivery-areas', '/store/branches', '/store/promotions']);
  const publicReadPath = route.replace(/\/$/, '') || '/';
  if (req.method === 'GET' && publicReadOnlyRoutes.has(publicReadPath)) {
    const local = loadReadOnlyStore();
    // Fall back to the normal initialized path if this is an empty/new database.
    if (local.has(APP_DATA_KEY)) {
      const ctx = { sid: '', local, session: new Map(), createdAt: Date.now() };
      const before = new Map(local);
      try {
        const result = await storageContext.run(ctx, () => dispatchDataRequest(`${publicReadPath}${url.search}`, { method: 'GET' }));
        const changed = before.size !== local.size || [...before].some(([key, value]) => local.get(key) !== value);
        if (changed) throw new Error(`Read-only public route mutated storage: ${publicReadPath}`);
        return sendJson(res, 200, result);
      } catch (error) {
        return sendJson(res, safeErrorStatus(error), { error: safeErrorStatus(error) >= 500 ? 'Lỗi máy chủ khi đọc danh mục.' : error.message });
      }
    }
  }

  const isMutation = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
  let body = {};
  if (isMutation) {
    const max = route === '/system/backup/restore' ? MAX_BACKUP_BYTES : MAX_BODY_BYTES;
    try { body = await readJsonBody(req, max); }
    catch (error) { return sendJson(res, safeErrorStatus(error), { error: error.message }); }
  }

  if (route === '/auth/phone-verification/start' && req.method === 'POST') {
    const phone = normalizeVietnamPhoneE164(body.phone);
    if (!phone) return sendJson(res, 400, { error: 'Số điện thoại Việt Nam chưa đúng định dạng.' });
    const ipAllowed = throttle(phoneOtpBuckets, `ip:${clientIp}`, 8, 60 * 60 * 1000);
    const phoneAllowed = throttle(phoneOtpBuckets, `phone:${createHash('sha256').update(phone).digest('hex')}`, 3, 60 * 60 * 1000);
    if (!ipAllowed || !phoneAllowed) return sendJson(res, 429, { error: 'Bạn đã yêu cầu quá nhiều mã OTP. Hãy thử lại sau.' }, { 'retry-after': '3600' });
    try {
      const verificationResult = await startPhoneVerification(phone);
      return sendJson(res, 200, {
        ok: true,
        message: 'Đã gửi mã xác minh đến số điện thoại. Mã có thời hạn theo quy định của nhà cung cấp.',
        ...(verificationResult?.mock === true && mockCommunicationEnabled()
          ? { mock: true, demoCode: verificationResult.mockCode }
          : { mock: false }),
      });
    } catch (error) {
      return sendJson(res, safeErrorStatus(error) >= 500 ? safeErrorStatus(error) : 502, { error: safeErrorStatus(error) === 503 ? error.message : 'Không gửi được OTP. Hãy thử lại sau.' });
    }
  }

  if (route === '/auth/phone-verification/check' && req.method === 'POST') {
    const phone = normalizeVietnamPhoneE164(body.phone);
    const code = String(body.code || '').trim();
    if (!phone || !/^\d{4,10}$/.test(code)) return sendJson(res, 400, { error: 'Số điện thoại hoặc mã OTP chưa hợp lệ.' });
    const ipAllowed = throttle(phoneOtpBuckets, `check-ip:${clientIp}`, 10, 15 * 60 * 1000);
    const phoneAllowed = throttle(phoneOtpBuckets, `check-phone:${createHash('sha256').update(phone).digest('hex')}`, 6, 15 * 60 * 1000);
    if (!ipAllowed || !phoneAllowed) return sendJson(res, 429, { error: 'Bạn đã nhập OTP quá nhiều lần. Hãy yêu cầu mã mới sau.' }, { 'retry-after': '900' });
    try {
      const approved = await checkPhoneVerification(phone, code);
      if (!approved) return sendJson(res, 400, { error: 'Mã OTP không đúng hoặc đã hết hạn.' });
      body = { verifiedPhone: phone, phoneVerificationApproved: true };
    } catch (error) {
      return sendJson(res, safeErrorStatus(error) >= 500 ? safeErrorStatus(error) : 502, { error: safeErrorStatus(error) === 503 ? error.message : 'Không xác minh được OTP. Hãy thử lại.' });
    }
  }

  // The browser sends the payment credential only as a header. Bridge it into
  // the domain adapter's request context without placing it in a URL or body.
  if (route.replace(/\/$/, '') === '/store/orders/sync-payment' && req.method === 'POST') {
    body.paymentToken = String(req.headers['x-payment-token'] || '');
    const paymentId = String(body.paymentId || '').trim();
    if (!/^[A-Za-z0-9_-]{20,100}$/.test(paymentId) || !/^[a-f0-9]{64}$/i.test(body.paymentToken)) {
      return sendJson(res, 400, { error: 'Thông tin kiểm tra thanh toán không hợp lệ.' });
    }
    if (!PAYMENT_API_INTERNAL_IS_LOOPBACK) {
      return sendJson(res, 503, { error: 'Payment API nội bộ chưa được cấu hình loopback an toàn.' });
    }
    try {
      const paymentResponse = await fetch(`${PAYMENT_API_INTERNAL_URL}/api/payments/status/${encodeURIComponent(paymentId)}`, {
        headers: { accept: 'application/json', 'x-payment-token': body.paymentToken },
        cache: 'no-store', signal: AbortSignal.timeout(5000),
      });
      const verifiedPaymentStatus = await paymentResponse.json().catch(() => ({}));
      if (!paymentResponse.ok) {
        return sendJson(res, paymentResponse.status === 404 ? 404 : 502, {
          error: verifiedPaymentStatus.error || 'Payment API không xác minh được giao dịch.',
        });
      }
      body.verifiedPaymentStatus = verifiedPaymentStatus;
    } catch {
      return sendJson(res, 503, { error: 'Không kết nối được payment API nội bộ để xác minh giao dịch.' });
    }
  }

  const ip = clientIp;
  if (route === '/auth/login' && req.method === 'POST') {
    const username = String(body.identifier || body.username || '').trim().normalize('NFKC').toLocaleLowerCase('vi').slice(0, 190);
    const ipAllowed = throttle(loginBuckets, ip, 10, 15 * 60 * 1000);
    const usernameAllowed = username.length > 0 && throttle(loginUsernameBuckets, username, 5, 15 * 60 * 1000);
    if (!ipAllowed || !usernameAllowed) {
      return sendJson(res, 429, { error: 'Quá nhiều lần đăng nhập cho IP hoặc tài khoản này. Hãy thử lại sau 15 phút.' }, { 'retry-after': '900' });
    }
  }
  if (route === '/store/orders' && req.method === 'POST' && !throttle(orderBuckets, ip, 25, 60 * 1000)) {
    return sendJson(res, 429, { error: 'Quá nhiều yêu cầu đặt hàng. Hãy thử lại sau.' }, { 'retry-after': '60' });
  }
  if (route === '/store/support/requests' && req.method === 'POST' && !throttle(supportBuckets, ip, 8, 60 * 60 * 1000)) {
    return sendJson(res, 429, { error: 'Bạn đã gửi nhiều yêu cầu hỗ trợ. Vui lòng chờ trước khi gửi tiếp.' }, { 'retry-after': '3600' });
  }
  if (route === '/store/support/track' && req.method === 'GET' && !throttle(supportLookupBuckets, ip, 20, 60 * 1000)) {
    return sendJson(res, 429, { error: 'Bạn đã tra cứu quá nhiều lần. Hãy chờ một phút rồi thử lại.' }, { 'retry-after': '60' });
  }

  const cookieValues = parseCookies(req.headers.cookie);
  let sid = cookieValues.get(COOKIE_NAME) || '';
  let cookieNeedsSet = false;
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(sid) || !selectSession.get(sid)) {
    sid = generateSid();
    cookieNeedsSet = true;
  }
  const originalSid = sid;
  const pathname = route.replace(/\/$/, '') || '/';
  const requestKey = req.headers['idempotency-key'] ? String(req.headers['idempotency-key']) : '';
  if (pathname === '/store/orders' && req.method === 'POST'
    && !/^[A-Za-z0-9:_-]{16,128}$/.test(requestKey)) {
    return sendJson(res, 400, { error: 'Thiếu hoặc sai Idempotency-Key cho yêu cầu đặt hàng.' });
  }

  return serializeQueue(async () => {
    const now = Date.now();
    db.exec('BEGIN IMMEDIATE');
    let committed = false;
    let ctx;
    try {
      db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now);
      db.prepare('DELETE FROM idempotency WHERE created_at <= ?').run(now - 7 * 24 * 60 * 60 * 1000);

      // Refresh the session after entering the serializable transaction to avoid stale reads.
      let activeSid = sid;
      let sessionRow = readStoredSession(activeSid);
      if (cookieValues.get(COOKIE_NAME) && activeSid === cookieValues.get(COOKIE_NAME) && !selectSession.get(activeSid)) {
        activeSid = generateSid();
        cookieNeedsSet = true;
        sessionRow = { storage: new Map(), createdAt: now };
      }
      ctx = { sid: activeSid, local: loadLocalStore(), session: sessionRow.storage, createdAt: sessionRow.createdAt };
      const parsedSession = Object.fromEntries(ctx.session);
      let responseValue;

      const payloadHash = createHash('sha256').update(JSON.stringify(body)).digest('hex');
      if (pathname === '/store/orders' && req.method === 'POST') {
        const previous = selectIdempotency.get(ctx.sid, pathname, requestKey);
        if (previous) {
          if (!secureEqual(previous.payload_hash, payloadHash)) {
            db.exec('ROLLBACK');
            return sendJson(res, 409, { error: 'Idempotency-Key này đã được sử dụng với dữ liệu khác.' }, cookieNeedsSet ? { 'set-cookie': cookieHeader(ctx.sid) } : {});
          }
          const cached = JSON.parse(previous.response_json);
          persistContext(ctx);
          saveSession.run(ctx.sid, JSON.stringify(Object.fromEntries(ctx.session)), ctx.createdAt, ctx.createdAt + SESSION_ABSOLUTE_MS);
          db.exec('COMMIT');
          committed = true;
          return sendJson(res, 200, cached, cookieNeedsSet ? { 'set-cookie': cookieHeader(ctx.sid) } : {});
        }
      }

      try {
        if (pathname === '/health' || pathname === '/healthz') {
          responseValue = { mode: 'server', storage: 'sqlite', backend: true, status: 'ok' };
        } else {
          if (req.method === 'GET' && ['/store/member/me', '/store/member/orders'].includes(pathname)) {
            const auth = await storageContext.run(ctx, () => dispatchDataRequest('/auth/me', { method: 'GET' }));
            if (auth?.user?.role !== 'customer' || !Number.isSafeInteger(Number(auth.user.customerId))) {
              throw Object.assign(new Error('Cần đăng nhập tài khoản khách hàng để xem thẻ thành viên.'), { status: 403 });
            }
          }
          if (pathname === '/auth/phone-verification/check' && req.method === 'POST' && body.phoneVerificationApproved === true) {
            ctx.session.set('emsystems.phone.verified', String(body.verifiedPhone || ''));
            ctx.session.set('emsystems.phone.verified.at', String(Date.now()));
            responseValue = { verified: true, phone: String(body.verifiedPhone || '') };
          } else {
            responseValue = await storageContext.run(ctx, () => dispatchDataRequest(`${pathname}${url.search}`, { method: req.method, body }));
          }
        }
      } catch (error) {
        // Preserve only the intentional failed-login audit. Every other rejected request rolls back,
        // so validation/authorization errors cannot partially consume inventory, points or promotions.
        if (error?.status && pathname === '/auth/login' && Number(error.status) === 401) {
          persistContext(ctx);
          saveSession.run(ctx.sid, JSON.stringify(Object.fromEntries(ctx.session)), ctx.createdAt, ctx.createdAt + SESSION_ABSOLUTE_MS);
          db.exec('COMMIT');
          committed = true;
        } else if (error?.status) {
          db.exec('ROLLBACK');
          committed = true;
          const headers = {};
          if (pathname === '/auth/me' && Number(error.status) === 401 && cookieValues.get(COOKIE_NAME)) {
            deleteSession.run(sid);
            headers['set-cookie'] = cookieHeader('', true);
          }
          return sendJson(res, safeErrorStatus(error), { error: error.message || 'Không thể xử lý yêu cầu.' }, headers);
        } else {
          throw error;
        }
        const headers = cookieNeedsSet ? { 'set-cookie': cookieHeader(ctx.sid) } : {};
        return sendJson(res, safeErrorStatus(error), { error: error.message || 'Không thể xử lý yêu cầu.' }, headers);
      }

      // Rotate identifiers after successful credential verification/registration to reduce session fixation risk.
      let responseSid = ctx.sid;
      let shouldExpireCookie = false;
      const shouldInvalidateAllSessions = req.method === 'POST'
        && (pathname === '/system/reset-demo' || pathname === '/system/backup/restore');
      if ((pathname === '/auth/login' || pathname === '/auth/register') && req.method === 'POST' && responseValue?.user) {
        responseSid = generateSid();
        deleteSession.run(ctx.sid);
        ctx.sid = responseSid;
        cookieNeedsSet = true;
      } else if (pathname === '/auth/logout' && req.method === 'POST') {
        deleteSession.run(ctx.sid);
        shouldExpireCookie = true;
      }
      if (shouldInvalidateAllSessions) {
        deleteAllSessions.run();
        shouldExpireCookie = true;
      }

      persistContext(ctx);
      if (!shouldExpireCookie) {
        saveSession.run(ctx.sid, JSON.stringify(Object.fromEntries(ctx.session)), ctx.createdAt, ctx.createdAt + SESSION_ABSOLUTE_MS);
      }
      if (pathname === '/store/orders' && req.method === 'POST') {
        saveIdempotency.run(ctx.sid, pathname, requestKey, payloadHash, JSON.stringify(responseValue), now);
      }
      db.exec('COMMIT');
      committed = true;

      const headers = {};
      if (cookieNeedsSet) headers['set-cookie'] = cookieHeader(responseSid);
      if (shouldExpireCookie) headers['set-cookie'] = cookieHeader('', true);
      return sendJson(res, 200, responseValue, headers);
    } catch (error) {
      if (!committed) {
        try { db.exec('ROLLBACK'); } catch { /* Transaction may already be closed. */ }
      }
      console.error('[EMSystems API] Request failed:', req.method, pathname, safeErrorStatus(error));
      if (safeErrorStatus(error) >= 500) void reportOperationalError({ service: 'business-api', status: safeErrorStatus(error), method: req.method, pathname });
      return sendJson(res, safeErrorStatus(error), {
        error: safeErrorStatus(error) >= 500 ? 'Lỗi máy chủ. Yêu cầu chưa được hoàn tất.' : error.message,
      }, cookieNeedsSet && ctx ? { 'set-cookie': cookieHeader(ctx.sid) } : {});
    }
  });
}

const server = (await import('node:http')).createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
  if (url.pathname === '/api/app/healthz') {
    return sendJson(res, 200, { status: 'ok', service: 'emsystems-app-api', storage: 'sqlite' });
  }
  if (!url.pathname.startsWith('/api/app/')) {
    return sendJson(res, 404, { error: 'Không tìm thấy endpoint.' });
  }
  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].includes(req.method || '')) {
    return sendJson(res, 405, { error: 'Phương thức không được hỗ trợ.' }, { allow: 'GET, POST, PUT, PATCH, DELETE, OPTIONS' });
  }
  try {
    await handleAppApi(req, res, url);
  } catch (error) {
    console.error('[EMSystems API] Handler failed:', req.method, safeErrorStatus(error));
    if (safeErrorStatus(error) >= 500) void reportOperationalError({ service: 'business-api', status: safeErrorStatus(error), method: req.method, pathname: url.pathname });
    if (!res.headersSent) sendJson(res, safeErrorStatus(error), { error: 'Không thể xử lý yêu cầu.' });
    else res.destroy();
  }
});

server.requestTimeout = 20_000;
server.headersTimeout = 10_000;
server.keepAliveTimeout = 5_000;
server.listen(PORT, '127.0.0.1', () => {
  console.log(`[EMSystems API] Listening on http://127.0.0.1:${PORT}`);
  console.log(`[EMSystems API] SQLite database: ${DB_PATH}`);
  console.log('[EMSystems API] Session cookies are HttpOnly; payment stays sandbox-only until verified.');
});

// Orders that keep inventory reserved for online payment expire after 15 minutes.
const expirePendingOrders = () => dispatchInternalDomainMutation('/internal/orders/expire-pending', {})
  .catch((error) => console.error('[EMSystems API] Pending-order expiration sweep failed:', safeErrorStatus(error)));
const expirationTimer = setInterval(expirePendingOrders, 60_000);
expirationTimer.unref();
void expirePendingOrders();

async function dispatchNotificationOutbox() {
  const claim = await dispatchInternalDomainMutation('/internal/notifications/claim', { limit: 10 });
  for (const notification of claim.notifications || []) {
    try {
      await deliverCustomerNotification(notification);
      await dispatchInternalDomainMutation('/internal/notifications/complete', { id: notification.id, success: true });
    } catch (error) {
      console.error('[EMSystems API] Customer notification delivery failed:', notification.channel, safeErrorStatus(error));
      void reportOperationalError({ service: 'notification-worker', status: safeErrorStatus(error) >= 500 ? safeErrorStatus(error) : 502, method: 'DELIVER', pathname: `/internal/notifications/${notification.channel}`, category: 'provider_delivery' });
      try {
        await dispatchInternalDomainMutation('/internal/notifications/complete', { id: notification.id, success: false });
      } catch (completeError) {
        console.error('[EMSystems API] Could not update notification outbox:', safeErrorStatus(completeError));
      }
    }
  }
}
const notificationTimer = setInterval(() => {
  void dispatchNotificationOutbox().catch((error) => console.error('[EMSystems API] Notification worker failed:', safeErrorStatus(error)));
}, 15_000);
notificationTimer.unref();
void dispatchNotificationOutbox().catch((error) => console.error('[EMSystems API] Notification worker failed:', safeErrorStatus(error)));

function stop() {
  clearInterval(expirationTimer);
  clearInterval(notificationTimer);
  server.close(() => {
    try { readDb.close(); } catch { /* Ignore close errors during shutdown. */ }
    try { db.close(); } catch { /* Ignore close errors during shutdown. */ }
    process.exit(0);
  });
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
