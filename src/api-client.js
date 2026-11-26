import { formatMoney } from './format.js';

const IDEMPOTENCY_KEY_STORAGE = 'emsystems.checkout.idempotency-key.v1';

function stablePath(path) {
  const value = String(path || '/');
  const parsed = new URL(value, window.location.origin);
  const pathname = parsed.pathname.replace(/\/$/, '') || '/';
  return `${pathname}${parsed.search}`;
}

function newIdempotencyKey() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `ems-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Frontend transport: all business requests go to the server API. Business data,
 * staff authorization and browser sessions must never be handled as source-of-truth
 * in this module. api.js remains the server-side domain adapter and unit-test target.
 */
export async function dataRequest(path, options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  const requestPath = stablePath(path);
  const apiPath = requestPath.startsWith('/api/') ? requestPath.slice(4) : requestPath;
  const headers = { accept: 'application/json', ...(options.headers || {}) };
  let body;
  if (options.body !== undefined && !['GET', 'HEAD'].includes(method)) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(options.body);
  }

  let idempotencyKey = '';
  if (method === 'POST' && requestPath.split('?')[0] === '/store/orders') {
    try {
      idempotencyKey = window.sessionStorage.getItem(IDEMPOTENCY_KEY_STORAGE) || '';
      if (!/^[A-Za-z0-9:_-]{16,128}$/.test(idempotencyKey)) {
        idempotencyKey = newIdempotencyKey();
        window.sessionStorage.setItem(IDEMPOTENCY_KEY_STORAGE, idempotencyKey);
      }
    } catch {
      idempotencyKey = newIdempotencyKey();
    }
    headers['Idempotency-Key'] = idempotencyKey;
  }

  let response;
  try {
    response = await fetch(`/api/app${apiPath}`, {
      method,
      headers,
      body,
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
    });
  } catch {
    throw Object.assign(new Error('Không thể kết nối máy chủ EMSystems. Kiểm tra kết nối và thử lại.'), { status: 503 });
  }

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    // A deterministic 4xx response means the order request was rejected without a commit;
    // discard the key so the user can fix the form and submit a different payload.
    // For 5xx/network errors keep it: the client may not know whether the transaction committed.
    if (idempotencyKey && response.status < 500) {
      try {
        if (window.sessionStorage.getItem(IDEMPOTENCY_KEY_STORAGE) === idempotencyKey) {
          window.sessionStorage.removeItem(IDEMPOTENCY_KEY_STORAGE);
        }
      } catch { /* A fresh key will be generated on the next submission. */ }
    }
    throw Object.assign(new Error(result.error || 'Máy chủ không thể xử lý yêu cầu.'), {
      status: response.status,
      retryAfter: response.headers.get('retry-after'),
    });
  }

  if (idempotencyKey && result?.order) {
    try {
      if (window.sessionStorage.getItem(IDEMPOTENCY_KEY_STORAGE) === idempotencyKey) {
        window.sessionStorage.removeItem(IDEMPOTENCY_KEY_STORAGE);
      }
    } catch { /* Server-side idempotency is authoritative even if browser storage is blocked. */ }
  }
  return result;
}

export { formatMoney };
