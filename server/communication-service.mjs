import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RESEND_API_URL = 'https://api.resend.com/emails';
const TWILIO_API_ROOT = 'https://verify.twilio.com/v2/Services';
const TWILIO_MESSAGES_ROOT = 'https://api.twilio.com/2010-04-01/Accounts';
const ZALO_ZNS_API_URL = 'https://business.openapi.zalo.me/message/template';
const ZALO_OAUTH_TOKEN_URL = 'https://oauth.zaloapp.com/v4/oa/access_token';
const SERVER_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let zaloRefreshInFlight = null;

function basicAuthorization(username, password) {
  return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
}

function toVietnamE164(value) {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.startsWith('0084')) digits = digits.slice(2);
  if (digits.startsWith('84')) digits = `0${digits.slice(2)}`;
  if (!/^0[35789]\d{8}$/.test(digits)) throw new Error('Số điện thoại thông báo không hợp lệ.');
  return `+84${digits.slice(1)}`;
}

async function readProviderError(response) {
  const payload = await response.json().catch(() => ({}));
  const message = String(payload.message || payload.error || payload.error_description || 'Provider request failed');
  return Object.assign(new Error(message.slice(0, 180)), { status: response.status });
}

const mockOtpStore = new Map();
const demoMailbox = new Map();
const MOCK_MESSAGE_TTL_MS = 30 * 60 * 1000;

// Smart Mock is an explicit development-only opt-in. It can never be enabled
// by an environment variable in production.
export function mockCommunicationEnabled() {
  return process.env.NODE_ENV !== 'production' && process.env.EMSYSTEMS_MOCK_COMMUNICATION === 'true';
}

function hashOtp(code) {
  return createHash('sha256').update(String(code)).digest();
}

function secureDigestEqual(left, right) {
  return Buffer.isBuffer(left) && Buffer.isBuffer(right)
    && left.length === right.length && timingSafeEqual(left, right);
}

function pruneDemoMessages(now = Date.now()) {
  for (const [key, value] of mockOtpStore) if (value.expiresAt <= now) mockOtpStore.delete(key);
  for (const [key, value] of demoMailbox) if (value.expiresAt <= now) demoMailbox.delete(key);
  while (demoMailbox.size > 500) demoMailbox.delete(demoMailbox.keys().next().value);
  while (mockOtpStore.size > 10000) mockOtpStore.delete(mockOtpStore.keys().next().value);
}

export function getDemoMailboxMessage(id) {
  if (!mockCommunicationEnabled()) return null;
  const key = String(id || '');
  if (!/^[A-Za-z0-9_-]{24,64}$/.test(key)) return null;
  pruneDemoMessages();
  const message = demoMailbox.get(key);
  if (!message) return null;
  return {
    id: message.id,
    to: message.to,
    subject: message.subject,
    text: message.text,
    createdAt: message.createdAt,
    expiresAt: new Date(message.expiresAt).toISOString(),
  };
}

function saveDemoMessage({ to, subject, text, html = '' }) {
  const now = Date.now();
  pruneDemoMessages(now);
  const id = randomBytes(24).toString('base64url');
  demoMailbox.set(id, {
    id,
    to: String(to || '').trim().slice(0, 190),
    subject: String(subject || '').trim().slice(0, 200),
    text: String(text || '').slice(0, 12000),
    html: String(html || '').slice(0, 20000),
    createdAt: new Date(now).toISOString(),
    expiresAt: now + MOCK_MESSAGE_TTL_MS,
  });
  return { id, mock: true };
}

export function emailDeliveryConfigured() {
  if (Boolean(process.env.RESEND_API_KEY && process.env.EMSYSTEMS_EMAIL_FROM && process.env.EMSYSTEMS_PUBLIC_URL)) return true;
  return mockCommunicationEnabled();
}

export function phoneVerificationConfigured() {
  if (Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_VERIFY_SERVICE_SID)) return true;
  return mockCommunicationEnabled();
}

export function smsDeliveryConfigured() {
  if (Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_SMS_FROM)) return true;
  return mockCommunicationEnabled();
}

export function zaloZnsConfigured() {
  const canUseStaticToken = Boolean(process.env.ZALO_ZNS_ACCESS_TOKEN);
  const canRefreshToken = Boolean(process.env.ZALO_ZNS_APP_ID && process.env.ZALO_ZNS_APP_SECRET && process.env.ZALO_ZNS_REFRESH_TOKEN);
  return Boolean((canUseStaticToken || canRefreshToken) && process.env.ZALO_ZNS_TEMPLATE_ID_ORDER);
}

function zaloTokenFile() {
  const defaultPath = join(dirname(resolve(process.env.EMSYSTEMS_DB_PATH || join(SERVER_ROOT, '.emsystems-data', 'emsystems.sqlite'))), 'zalo-zns-token.json');
  return resolve(process.env.EMSYSTEMS_ZALO_TOKEN_STATE_FILE || defaultPath);
}

async function readZaloTokenState() {
  try {
    const path = zaloTokenFile();
    await chmod(path, 0o600).catch(() => {});
    const raw = await readFile(path, 'utf8');
    const state = JSON.parse(raw);
    if (state && typeof state === 'object' && typeof state.accessToken === 'string' && typeof state.expiresAt === 'number') return state;
  } catch (error) {
    if (error?.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
  }
  return {
    accessToken: String(process.env.ZALO_ZNS_ACCESS_TOKEN || ''),
    refreshToken: String(process.env.ZALO_ZNS_REFRESH_TOKEN || ''),
    expiresAt: Date.parse(process.env.ZALO_ZNS_ACCESS_TOKEN_EXPIRES_AT || '') || 0,
  };
}

async function persistZaloTokenState(state) {
  const path = zaloTokenFile();
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await chmod(dirname(path), 0o700).catch(() => {});
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(state)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    await rename(temporary, path);
  } catch (error) {
    try { await rm(temporary, { force: true }); } catch { /* Keep original token-state persistence error. */ }
    throw error;
  }
}

async function refreshZaloZnsToken(currentState) {
  if (zaloRefreshInFlight) return zaloRefreshInFlight;
  zaloRefreshInFlight = (async () => {
    const appId = String(process.env.ZALO_ZNS_APP_ID || '').trim();
    const appSecret = String(process.env.ZALO_ZNS_APP_SECRET || '').trim();
    const refreshToken = String(currentState.refreshToken || process.env.ZALO_ZNS_REFRESH_TOKEN || '').trim();
    if (!appId || !appSecret || !refreshToken) {
      throw Object.assign(new Error('Zalo ZNS access token hết hạn hoặc thiếu; cần cấu hình App ID, App Secret và refresh token OA.'), { status: 503 });
    }
    const body = new URLSearchParams({ app_id: appId, grant_type: 'refresh_token', refresh_token: refreshToken });
    const response = await fetch(ZALO_OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: { secret_key: appSecret, 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body,
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw await readProviderError(response);
    const result = await response.json();
    const accessToken = String(result.access_token || '').trim();
    const nextRefreshToken = String(result.refresh_token || '').trim();
    const expiresIn = Number(result.expires_in);
    if (!accessToken || !nextRefreshToken || !Number.isFinite(expiresIn) || expiresIn < 60) {
      throw new Error('Zalo OAuth refresh response is missing valid access/refresh token data.');
    }
    const state = {
      accessToken,
      refreshToken: nextRefreshToken,
      expiresAt: Date.now() + expiresIn * 1000,
      refreshedAt: new Date().toISOString(),
    };
    // Refresh tokens rotate on every successful use; persist the new pair before returning it.
    await persistZaloTokenState(state);
    return state;
  })();
  try { return await zaloRefreshInFlight; }
  finally { zaloRefreshInFlight = null; }
}

export async function getZaloZnsAccessToken() {
  if (!zaloZnsConfigured()) throw Object.assign(new Error('Zalo ZNS chưa có OA access token/refresh credentials hoặc template đã duyệt.'), { status: 503 });
  const state = await readZaloTokenState();
  const refreshConfigured = Boolean(process.env.ZALO_ZNS_APP_ID && process.env.ZALO_ZNS_APP_SECRET && (state.refreshToken || process.env.ZALO_ZNS_REFRESH_TOKEN));
  const shouldRefresh = refreshConfigured && (!state.accessToken || !state.expiresAt || state.expiresAt <= Date.now() + 10 * 60_000);
  if (shouldRefresh) return (await refreshZaloZnsToken(state)).accessToken;
  if (!state.accessToken) throw Object.assign(new Error('Zalo ZNS access token chưa được cấu hình.'), { status: 503 });
  return state.accessToken;
}

export async function startPhoneVerification(phoneE164) {
  const hasTwilioVerify = Boolean(process.env.TWILIO_VERIFY_SERVICE_SID && process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN);
  if (!hasTwilioVerify) {
    if (!phoneVerificationConfigured()) throw Object.assign(new Error('Dịch vụ OTP SMS chưa được cấu hình.'), { status: 503 });
    const now = Date.now();
    pruneDemoMessages(now);
    const mockCode = String(randomInt(0, 1_000_000)).padStart(6, '0');
    mockOtpStore.set(phoneE164, { codeHash: hashOtp(mockCode), expiresAt: now + 5 * 60 * 1000, attempts: 0 });
    return { status: 'pending', mock: true, mockCode };
  }
  const serviceId = encodeURIComponent(process.env.TWILIO_VERIFY_SERVICE_SID);
  const body = new URLSearchParams({ To: phoneE164, Channel: 'sms' });
  const response = await fetch(`${TWILIO_API_ROOT}/${serviceId}/Verifications`, {
    method: 'POST',
    headers: {
      authorization: basicAuthorization(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN),
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
    },
    body,
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw await readProviderError(response);
  const result = await response.json();
  return { status: String(result.status || 'pending') };
}

export async function checkPhoneVerification(phoneE164, code) {
  const hasTwilioVerify = Boolean(process.env.TWILIO_VERIFY_SERVICE_SID && process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN);
  if (!hasTwilioVerify) {
    if (!phoneVerificationConfigured()) throw Object.assign(new Error('Dịch vụ OTP SMS chưa được cấu hình.'), { status: 503 });
    const stored = mockOtpStore.get(phoneE164);
    if (!stored || stored.expiresAt <= Date.now() || stored.attempts >= 5) {
      mockOtpStore.delete(phoneE164);
      return false;
    }
    stored.attempts += 1;
    const approved = secureDigestEqual(stored.codeHash, hashOtp(String(code || '').trim()));
    if (approved) {
      mockOtpStore.delete(phoneE164);
      return true;
    }
    if (stored.attempts >= 5) mockOtpStore.delete(phoneE164);
    return false;
  }
  const serviceId = encodeURIComponent(process.env.TWILIO_VERIFY_SERVICE_SID);
  const body = new URLSearchParams({ To: phoneE164, Code: code });
  const response = await fetch(`${TWILIO_API_ROOT}/${serviceId}/VerificationCheck`, {
    method: 'POST',
    headers: {
      authorization: basicAuthorization(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN),
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
    },
    body,
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw await readProviderError(response);
  const result = await response.json();
  return result.status === 'approved';
}

export async function sendEmail({ to, subject, text, html }) {
  const hasResend = Boolean(process.env.RESEND_API_KEY && process.env.EMSYSTEMS_EMAIL_FROM && process.env.EMSYSTEMS_PUBLIC_URL);
  if (!hasResend) {
    if (!emailDeliveryConfigured()) throw new Error('Email provider chưa được cấu hình.');
    return saveDemoMessage({ to, subject, text, html });
  }
  const response = await fetch(RESEND_API_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({
      from: process.env.EMSYSTEMS_EMAIL_FROM,
      to: [to], subject, text, html,
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw await readProviderError(response);
  return response.json();
}

export async function sendSms({ to, text }) {
  const hasTwilioSms = Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_SMS_FROM);
  if (!hasTwilioSms) {
    if (!mockCommunicationEnabled()) throw new Error('SMS provider chưa được cấu hình.');
    return saveDemoMessage({ to, subject: 'Tin nhắn SMS mô phỏng · EMSystems', text });
  }
  const accountId = encodeURIComponent(process.env.TWILIO_ACCOUNT_SID);
  const body = new URLSearchParams({ To: toVietnamE164(to), From: process.env.TWILIO_SMS_FROM, Body: text });
  const response = await fetch(`${TWILIO_MESSAGES_ROOT}/${accountId}/Messages.json`, {
    method: 'POST',
    headers: {
      authorization: basicAuthorization(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN),
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
    },
    body,
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw await readProviderError(response);
  const result = await response.json();
  return { sid: result.sid || null, status: result.status || 'accepted' };
}

export async function sendZaloZns({ to, templateId, templateData }) {
  const accessToken = await getZaloZnsAccessToken();
  if (!templateId) throw new Error('Zalo ZNS chưa có template ID.');
  const phone = toVietnamE164(to).replace(/^\+/, '');
  const response = await fetch(ZALO_ZNS_API_URL, {
    method: 'POST',
    headers: { access_token: accessToken, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ phone, template_id: templateId, template_data: templateData }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw await readProviderError(response);
  const result = await response.json();
  if (Number(result.error) !== 0) throw new Error(String(result.message || 'Zalo ZNS rejected the message').slice(0, 180));
  return { messageId: result.data?.msg_id || null };
}

export async function deliverCustomerNotification(notification) {
  const data = notification.templateData || {};
  if (notification.channel === 'email') {
    const lines = [
      `Xin chào ${data.customerName || 'Quý khách'},`,
      notification.message,
      `Mã đơn: ${data.orderCode || ''}`,
      `Tổng tiền: ${data.amountText || ''}`,
      `Trạng thái: ${data.statusText || ''}`,
      `Tra cứu: ${process.env.EMSYSTEMS_PUBLIC_URL || ''}/track-order`,
      'EMSystems không yêu cầu mật khẩu ngân hàng, PIN hoặc OTP thanh toán.',
    ].filter(Boolean);
    const text = lines.join('\n');
    const html = `<div style="font-family:Arial,sans-serif;line-height:1.6"><p>${escapeHtml(lines[0])}</p><p>${escapeHtml(notification.message)}</p><p><b>Mã đơn:</b> ${escapeHtml(data.orderCode || '')}<br><b>Tổng tiền:</b> ${escapeHtml(data.amountText || '')}<br><b>Trạng thái:</b> ${escapeHtml(data.statusText || '')}</p><p><a href="${escapeHtml(process.env.EMSYSTEMS_PUBLIC_URL || '')}/track-order">Theo dõi đơn hàng</a></p><small>EMSystems không yêu cầu mật khẩu ngân hàng, PIN hoặc OTP thanh toán.</small></div>`;
    await sendEmail({ to: notification.target, subject: notification.subject || 'Cập nhật đơn hàng EMSystems', text, html });
    return { accepted: true };
  }
  if (notification.channel === 'sms') {
    const text = `EMSystems: ${notification.message} Don ${data.orderCode || ''}, ${data.amountText || ''}. Tra cuu: ${process.env.EMSYSTEMS_PUBLIC_URL || ''}/track-order`;
    await sendSms({ to: notification.target, text: text.slice(0, 900) });
    return { accepted: true };
  }
  if (notification.channel === 'zalo_zns') {
    await sendZaloZns({ to: notification.target, templateId: notification.templateId || process.env.ZALO_ZNS_TEMPLATE_ID_ORDER, templateData: data });
    return { accepted: true };
  }
  throw new Error('Kênh thông báo không được hỗ trợ.');
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}