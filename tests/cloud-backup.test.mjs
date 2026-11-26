import test from 'node:test';
import assert from 'node:assert/strict';
import { buildS3Authorization } from '../scripts/backup-cloud.mjs';

test('S3 SigV4 authorization is deterministic and signs the payload hash', () => {
  const input = {
    method: 'PUT',
    url: new URL('https://example-account.r2.cloudflarestorage.com/emsystems/backup/manifest.json'),
    payloadHash: 'a'.repeat(64),
    accessKeyId: 'R2ACCESSKEYEXAMPLE',
    secretAccessKey: 'secret-example-value-not-a-real-key',
    region: 'auto',
    extraHeaders: { 'x-amz-meta-sha256': 'b'.repeat(64) },
    now: new Date('2026-11-09T15:00:00.000Z'),
  };
  const first = buildS3Authorization(input);
  const second = buildS3Authorization(input);
  assert.equal(first.authorization, second.authorization);
  assert.match(first.authorization, /^AWS4-HMAC-SHA256 Credential=R2ACCESSKEYEXAMPLE\/20261109\/auto\/s3\/aws4_request,/);
  assert.match(first.authorization, /SignedHeaders=host;x-amz-content-sha256;x-amz-date;x-amz-meta-sha256/);
  assert.match(first.authorization, /Signature=[a-f0-9]{64}$/);
  assert.notEqual(buildS3Authorization({ ...input, payloadHash: 'c'.repeat(64) }).authorization, first.authorization);
});