import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createPasswordCredential, verifyDemoCredential } from '../src/demo-auth.js';

globalThis.crypto ??= webcrypto;

test('demo authentication has no source-coded account password fallback', async () => {
  const source = await readFile(fileURLToPath(new URL('../src/demo-auth.js', import.meta.url)), 'utf8');
  assert.equal(source.includes('PASSWORD_VERIFIERS'), false);
  assert.equal(await verifyDemoCredential('admin', 'any-password', { username: 'admin' }), false);
});

test('only a salted per-user PBKDF2 credential can authenticate', async () => {
  const credential = await createPasswordCredential('Correct admin passphrase 2026!');
  const user = { username: 'admin', passwordCredential: credential };
  assert.equal(await verifyDemoCredential('admin', 'Correct admin passphrase 2026!', user), true);
  assert.equal(await verifyDemoCredential('admin', 'wrong password 2026!', user), false);
});