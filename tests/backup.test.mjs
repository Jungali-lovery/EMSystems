import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const projectRoot = new URL('..', import.meta.url).pathname.replace(/^\/(\w:)/, '$1').replace(/\//g, '\\');
const backupKey = 'a'.repeat(64);

test('backup:data creates a consistent SQLite snapshot, checksums, manifest and payment-state copy', async (t) => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'emsystems-backup-test-'));
  const sourceDb = join(tempRoot, 'source.sqlite');
  const paymentState = join(tempRoot, 'payment-state');
  const backupRoot = join(tempRoot, 'backups');
  t.after(() => rm(tempRoot, { recursive: true, force: true }));

  const db = new DatabaseSync(sourceDb);
  db.exec('PRAGMA journal_mode = WAL; CREATE TABLE backup_probe (id INTEGER PRIMARY KEY, value TEXT NOT NULL);');
  db.prepare('INSERT INTO backup_probe(value) VALUES (?)').run('committed-value');
  db.close();

  await mkdir(paymentState, { recursive: true });
  await writeFile(join(paymentState, 'payments.json'), JSON.stringify([{ paymentId: 'sandbox-test', status: 'pending' }]), { mode: 0o600 });

  const result = spawnSync(process.execPath, [join(projectRoot, 'scripts', 'backup.mjs')], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      EMSYSTEMS_DB_PATH: sourceDb,
      PAYMENT_STATE_DIR: paymentState,
      EMSYSTEMS_BACKUP_DIR: backupRoot,
      EMSYSTEMS_BACKUP_RETENTION: '2',
      EMSYSTEMS_BACKUP_ENCRYPTION_KEY: backupKey,
    },
    timeout: 15000,
    windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const match = result.stdout.match(/Backup completed: (.+) \((\d+) data files;/);
  assert.ok(match, result.stdout);
  assert.equal(Number(match[2]), 2);
  const backupDir = match[1];

  const encryptedDatabase = await readFile(join(backupDir, 'emsystems.sqlite.enc'));
  assert.equal(encryptedDatabase.subarray(0, 8).toString('ascii'), 'EMSBACK1');
  assert.equal((await readdir(backupDir)).some((name) => name === 'emsystems.sqlite' || name === 'payments.json'), false);
  assert.equal(encryptedDatabase.toString('utf8').includes('committed-value'), false);
  const encryptedPayments = await readFile(join(backupDir, 'payments.json.enc'));
  assert.equal(encryptedPayments.subarray(0, 8).toString('ascii'), 'EMSBACK1');
  const manifest = JSON.parse(await readFile(join(backupDir, 'manifest.json'), 'utf8'));
  assert.equal(manifest.format, 'emsystems-backup');
  assert.equal(manifest.version, 1);
  assert.equal(manifest.encryption.algorithm, 'AES-256-GCM');
  assert.equal(manifest.includesPaymentState, true);
  assert.deepEqual(new Set(manifest.files.map((entry) => entry.name)), new Set(['emsystems.sqlite.enc', 'payments.json.enc']));
  for (const entry of manifest.files) {
    const bytes = await readFile(join(backupDir, entry.name));
    assert.equal(bytes.byteLength, entry.sizeBytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256);
  }
  assert.equal((await readdir(backupDir)).includes('.env'), false);
});

test('backup:data fails clearly if the SQLite source is missing', async (t) => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'emsystems-backup-missing-test-'));
  t.after(() => rm(tempRoot, { recursive: true, force: true }));

  const result = spawnSync(process.execPath, [join(projectRoot, 'scripts', 'backup.mjs')], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      EMSYSTEMS_DB_PATH: join(tempRoot, 'missing.sqlite'),
      PAYMENT_STATE_DIR: join(tempRoot, 'payment-state'),
      EMSYSTEMS_BACKUP_DIR: join(tempRoot, 'backups'),
      EMSYSTEMS_BACKUP_ENCRYPTION_KEY: backupKey,
    },
    timeout: 15000,
    windowsHide: true,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /SQLite database not found/i);
});

test('backup:data refuses to create plaintext backups without an encryption key', async (t) => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'emsystems-backup-key-test-'));
  const sourceDb = join(tempRoot, 'source.sqlite');
  const db = new DatabaseSync(sourceDb);
  db.exec('CREATE TABLE backup_probe (id INTEGER PRIMARY KEY);');
  db.close();
  t.after(() => rm(tempRoot, { recursive: true, force: true }));
  const result = spawnSync(process.execPath, [join(projectRoot, 'scripts', 'backup.mjs')], {
    cwd: projectRoot, encoding: 'utf8',
    env: { ...process.env, EMSYSTEMS_DB_PATH: sourceDb, EMSYSTEMS_BACKUP_DIR: join(tempRoot, 'backups'), EMSYSTEMS_BACKUP_ENCRYPTION_KEY: '' },
    timeout: 15000, windowsHide: true,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /EMSYSTEMS_BACKUP_ENCRYPTION_KEY is required/i);
  assert.equal((await readdir(join(tempRoot, 'backups')).catch(() => [])).length, 0);
});
