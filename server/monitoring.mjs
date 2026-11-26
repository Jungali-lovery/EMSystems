const recentAlerts = new Map();

function safeRoute(pathname) {
  return String(pathname || '/')
    .split('?')[0]
    .slice(0, 120)
    .replace(/[0-9]{5,}/g, ':id');
}

/** Send a low-PII operational alert; request bodies, email, phone and stack traces are never transmitted. */
export async function reportOperationalError({ service, status, method = 'UNKNOWN', pathname = '/', category = 'http_error' }) {
  const endpoint = String(process.env.EMSYSTEMS_ALERT_WEBHOOK_URL || '').trim();
  if (!endpoint) return false;
  let parsed;
  try { parsed = new URL(endpoint); } catch { return false; }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return false;

  const route = safeRoute(pathname);
  const fingerprint = `${service}:${category}:${status}:${method}:${route}`;
  const now = Date.now();
  const lastSent = recentAlerts.get(fingerprint) || 0;
  if (now - lastSent < 5 * 60_000) return false;
  recentAlerts.set(fingerprint, now);
  if (recentAlerts.size > 2000) {
    for (const [key, sentAt] of recentAlerts) if (now - sentAt > 60 * 60_000) recentAlerts.delete(key);
  }

  const payload = {
    text: `[EMSystems] ${service} ${category}: HTTP ${Number(status) || 500} · ${String(method).toUpperCase()} ${route} · ${new Date(now).toISOString()}`,
    service, category, status: Number(status) || 500,
    method: String(method).toUpperCase(), path: route,
    timestamp: new Date(now).toISOString(),
  };
  const headers = { 'content-type': 'application/json', accept: 'application/json' };
  const token = String(process.env.EMSYSTEMS_ALERT_WEBHOOK_TOKEN || '').trim();
  if (token) headers.authorization = `Bearer ${token}`;
  try {
    const response = await fetch(parsed, {
      method: 'POST', headers, body: JSON.stringify(payload),
      signal: AbortSignal.timeout(4000),
    });
    return response.ok;
  } catch {
    return false;
  }
}