import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { decryptBackupPayload, encryptBackupPayload } from '../src/services/backup-crypto.js';

globalThis.crypto ??= webcrypto;

test('backup export encrypts business data and can be decrypted with the correct passphrase', async () => {
  const payload = { format: 'emsystems-data-backup', backupVersion: 1, data: { customers: [{ fullName: 'Nguyễn Văn A' }] } };
  const encrypted = await encryptBackupPayload(payload, 'Correct horse battery 2026!');
  assert.equal(encrypted.includes('Nguyễn Văn A'), false);
  const envelope = JSON.parse(encrypted);
  assert.equal(envelope.cipher, 'AES-256-GCM');
  assert.deepEqual(await decryptBackupPayload(envelope, 'Correct horse battery 2026!'), payload);
});

test('encrypted backup rejects an incorrect passphrase and modified ciphertext', async () => {
  const encrypted = JSON.parse(await encryptBackupPayload({ secret: 'customer-data' }, 'Correct horse battery 2026!'));
  await assert.rejects(decryptBackupPayload(encrypted, 'Wrong password 2026!'), /Không giải mã được backup/);
  const bytes = Uint8Array.from(atob(encrypted.ciphertext), (character) => character.charCodeAt(0));
  bytes[bytes.length - 1] ^= 1;
  encrypted.ciphertext = btoa(String.fromCharCode(...bytes));
  await assert.rejects(decryptBackupPayload(encrypted, 'Correct horse battery 2026!'), /Không giải mã được backup/);
});