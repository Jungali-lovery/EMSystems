import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  checkPhoneVerification, getDemoMailboxMessage, getZaloZnsAccessToken,
  sendEmail, startPhoneVerification, zaloZnsConfigured,
} from '../server/communication-service.mjs';

test('Smart Mock OTP is random, single-use and limited to five attempts; demo email is readable from inbox', async () => {
  const envKeys = ['NODE_ENV', 'EMSYSTEMS_MOCK_COMMUNICATION', 'RESEND_API_KEY', 'EMSYSTEMS_EMAIL_FROM', 'EMSYSTEMS_PUBLIC_URL',
    'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_VERIFY_SERVICE_SID'];
  const previous = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  try {
    process.env.NODE_ENV = 'development';
    process.env.EMSYSTEMS_MOCK_COMMUNICATION = 'true';
    for (const key of ['RESEND_API_KEY', 'EMSYSTEMS_EMAIL_FROM', 'EMSYSTEMS_PUBLIC_URL', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_VERIFY_SERVICE_SID']) process.env[key] = '';

    const phone = '+84905123456';
    const first = await startPhoneVerification(phone);
    const second = await startPhoneVerification('+84906123456');
    assert.equal(first.mock, true);
    assert.match(first.mockCode, /^\d{6}$/);
    assert.notEqual(first.mockCode, '123456', 'the old hard-coded OTP must not remain a universal bypass');
    assert.notEqual(first.mockCode, second.mockCode, 'OTP codes must be generated per request');
    for (let attempt = 0; attempt < 5; attempt += 1) {
      assert.equal(await checkPhoneVerification(phone, '000000'), false, 'incorrect OTP must not be accepted');
    }
    assert.equal(await checkPhoneVerification(phone, first.mockCode), false, 'five failed attempts must invalidate the code');

    const next = await startPhoneVerification(phone);
    assert.equal(await checkPhoneVerification(phone, next.mockCode), true, 'the current OTP should verify once');
    assert.equal(await checkPhoneVerification(phone, next.mockCode), false, 'the OTP must be single-use');

    const sent = await sendEmail({ to: 'demo@example.invalid', subject: 'Thư thử nghiệm', text: 'Liên kết demo: https://example.invalid/reset#token=example-token' });
    assert.equal(sent.mock, true);
    const inbox = getDemoMailboxMessage(sent.id);
    assert.equal(inbox.to, 'demo@example.invalid');
    assert.equal(inbox.subject, 'Thư thử nghiệm');
    assert.match(inbox.text, /example-token/);
    assert.equal(getDemoMailboxMessage('not-a-valid-mailbox-id'), null);

    process.env.NODE_ENV = 'production';
    assert.equal(getDemoMailboxMessage(sent.id), null, 'the demo inbox must be inaccessible in production mode');
  } finally {
    for (const key of envKeys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});

test('Zalo OA token refresh is serialized and the rotated token pair is persisted', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'emsystems-zalo-token-'));
  const tokenPath = join(directory, 'zalo-token.json');
  const envKeys = [
    'ZALO_ZNS_ACCESS_TOKEN', 'ZALO_ZNS_ACCESS_TOKEN_EXPIRES_AT',
    'ZALO_ZNS_APP_ID', 'ZALO_ZNS_APP_SECRET', 'ZALO_ZNS_REFRESH_TOKEN',
    'ZALO_ZNS_TEMPLATE_ID_ORDER', 'EMSYSTEMS_ZALO_TOKEN_STATE_FILE',
  ];
  const previous = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  let refreshCalls = 0;
  try {
    process.env.ZALO_ZNS_ACCESS_TOKEN = '';
    process.env.ZALO_ZNS_ACCESS_TOKEN_EXPIRES_AT = '';
    process.env.ZALO_ZNS_APP_ID = 'test-app-id';
    process.env.ZALO_ZNS_APP_SECRET = 'test-app-secret';
    process.env.ZALO_ZNS_REFRESH_TOKEN = 'old-single-use-refresh-token';
    process.env.ZALO_ZNS_TEMPLATE_ID_ORDER = 'approved-template-id';
    process.env.EMSYSTEMS_ZALO_TOKEN_STATE_FILE = tokenPath;
    globalThis.fetch = async (input, init) => {
      refreshCalls += 1;
      assert.equal(String(input), 'https://oauth.zaloapp.com/v4/oa/access_token');
      assert.equal(init.method, 'POST');
      assert.equal(init.headers.secret_key, 'test-app-secret');
      const parameters = new URLSearchParams(init.body);
      assert.equal(parameters.get('app_id'), 'test-app-id');
      assert.equal(parameters.get('grant_type'), 'refresh_token');
      assert.equal(parameters.get('refresh_token'), 'old-single-use-refresh-token');
      return new Response(JSON.stringify({ access_token: 'new-access-token', refresh_token: 'rotated-refresh-token', expires_in: '90000', refresh_token_expires_in: '7000000' }), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    };

    assert.equal(zaloZnsConfigured(), true);
    const tokens = await Promise.all([getZaloZnsAccessToken(), getZaloZnsAccessToken()]);
    assert.deepEqual(tokens, ['new-access-token', 'new-access-token']);
    assert.equal(refreshCalls, 1, 'concurrent notifications must share one refresh for the single-use refresh token');

    const saved = JSON.parse(await readFile(tokenPath, 'utf8'));
    assert.equal(saved.accessToken, 'new-access-token');
    assert.equal(saved.refreshToken, 'rotated-refresh-token');
    assert.ok(saved.expiresAt > Date.now());
    assert.equal(await getZaloZnsAccessToken(), 'new-access-token');
    assert.equal(refreshCalls, 1, 'a still-valid persisted token should be reused');
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of envKeys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
    await rm(directory, { recursive: true, force: true });
  }
});