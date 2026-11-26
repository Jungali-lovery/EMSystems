import { isIP } from 'node:net';

const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

export function isLoopbackAddress(address) {
  const normalized = String(address || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  return LOOPBACK_ADDRESSES.has(normalized);
}

// Only a local reverse proxy may supply X-Forwarded-For. Caddy appends the
// connecting client address, so the final non-empty hop is the trusted value.
export function getTrustedClientIp(remoteAddress, forwardedFor) {
  const peer = String(remoteAddress || '').trim().toLowerCase();
  if (!isLoopbackAddress(peer)) return peer.replace(/^::ffff:/, '').slice(0, 100) || 'unknown';

  const chain = String(forwardedFor || '').split(',').map((value) => value.trim()).filter(Boolean);
  const candidate = chain.reverse()
    .map((value) => value.replace(/^\[|\]$/g, '').replace(/^::ffff:/i, ''))
    .find((value) => isIP(value));
  const normalizedPeer = peer.replace(/^::ffff:/i, '');
  return (candidate || normalizedPeer).slice(0, 100) || 'unknown';
}