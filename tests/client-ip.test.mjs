import test from 'node:test';
import assert from 'node:assert/strict';
import { getTrustedClientIp, isLoopbackAddress } from '../server/security/client-ip.mjs';

test('only loopback peers may supply the forwarded client IP', () => {
  assert.equal(isLoopbackAddress('127.0.0.1'), true);
  assert.equal(isLoopbackAddress('::1'), true);
  assert.equal(isLoopbackAddress('::ffff:127.0.0.1'), true);
  assert.equal(isLoopbackAddress('10.0.0.8'), false);
  assert.equal(getTrustedClientIp('10.0.0.8', '198.51.100.10'), '10.0.0.8');
});

test('trusted proxy chains use the final hop, not attacker-controlled earlier values', () => {
  assert.equal(getTrustedClientIp('127.0.0.1', '203.0.113.99, 198.51.100.24'), '198.51.100.24');
  assert.equal(getTrustedClientIp('::1', '203.0.113.5'), '203.0.113.5');
  assert.equal(getTrustedClientIp('127.0.0.1', '198.51.100.24, not-an-ip'), '198.51.100.24');
  assert.equal(getTrustedClientIp('127.0.0.1', ''), '127.0.0.1');
});