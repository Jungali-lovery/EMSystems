import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const projectRoot = new URL('..', import.meta.url).pathname.replace(/^\/(\w:)/, '$1').replace(/\//g, '\\');
const backupKey = 'b'.repeat(64);

function fixtureData(productName = 'Backup Product') {
  return {
    meta: { schemaVersion: 1 },
    nextIds: { product: 2, branch: 2, sale: 2 },
    users: [{ id: 1, username: 'backup-admin', role: 'admin', isActive: true }],
    branches: [{ id: 1, code: 'BR-01', name: 'Branch One', address: 'Test address', phone: '0905000000', isActive: true }],
    categories: [{ id: 1, name: 'Electronics' }],
    brands: [{ id: 1, name: 'TestBrand' }],
    suppliers: [{ id: 1, name: 'TestSupplier' }],
    products: [{ id: 1, sku: 'RESTORE-P1', name: productName, categoryId: 1, brandId: 1, supplierId: 1, sellingPrice: 125000, costPrice: 90000, isActive: true }],
    stock: [{ productId: 1, branchId: 1, quantity: 5 }],
    customers: [{ id: 1, code: 'C-RESTORE-1', fullName: 'Customer Fixture', phone: '0905000001', isActive: true }],
    deliveryAreas: [],
    sales: [{
      id: 1, invoiceNo: 'WEB-00001', branchId: 1, customerId: 1, cashierId: 1,
      status: 'completed', paymentStatus: 'paid', paymentMethod: 'cash_on_delivery',
      subtotal: 125000, discountAmount: 0, totalAmount: 125000, returnedAmount: 0,
      items: [{ id: 1, productId: 1, productName, quantity: 1, unitPrice: 125000, lineTotal: 125000, costPrice: 90000, returnedQuantity: 0, returnedAmount: 0 }],
    }],
    payments: [{ id: 1, saleId: 1, method: 'cash_on_delivery', status: 'paid', amount: 125000 }],
    movements: [], transfers: [], counts: [], purchaseReceipts: [], serials: [],
    promotions: [], returns: [], warrantyJobs: [], auditLogs: [], notifications: [], warranties: [],
  };
}

function createFixtureDatabase(path, data) {
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE app_kv (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
    CREATE TABLE sessions (
      sid TEXT PRIMARY KEY, storage_json TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE idempotency (
      sid TEXT NOT NULL, route TEXT NOT NULL, request_key TEXT NOT NULL, payload_hash TEXT NOT NULL,
      response_json TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (sid, route, request_key)
    ) STRICT;
    INSERT INTO sessions(sid, storage_json, created_at, expires_at)
      VALUES ('obsolete-session-id-long-enough-00000000000000000000', '{}', 100, 9999999999999);
    INSERT INTO idempotency(sid, route, request_key, payload_hash, response_json, created_at)
      VALUES ('obsolete-session-id-long-enough-00000000000000000000', '/store/orders', 'old-checkout-key-0001', 'hash', '{}', 100);
  `);
  db.prepare('INSERT INTO app_kv(key, value) VALUES (?, ?)').run('emsystems.demo.data.v1', JSON.stringify(data));
  db.close();
}

test('restore:data restores a verified backup, revokes sessions/idempotency and preserves business links', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'emsystems-restore-test-'));
  const dbPath = join(root, 'live.sqlite');
  const paymentDir = join(root, 'payment-state');
  const backupRoot = join(root, 'backups');
  await mkdir(paymentDir, { recursive: true });
  t.after(() => rm(root, { recursive: true, force: true }));

  const savedPayments = [{ paymentId: 'sandbox-payment-fixture', provider: 'momo', orderId: 'WEB-00001', amount: 125000, status: 'paid' }];
  await writeFile(join(paymentDir, 'payments.json'), JSON.stringify(savedPayments, null, 2), { mode: 0o600 });
  createFixtureDatabase(dbPath, fixtureData('Backup Product'));

  const backupResult = spawnSync(process.execPath, [join(projectRoot, 'scripts', 'backup.mjs')], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      EMSYSTEMS_DB_PATH: dbPath,
      PAYMENT_STATE_DIR: paymentDir,
      EMSYSTEMS_BACKUP_DIR: backupRoot,
      EMSYSTEMS_BACKUP_RETENTION: '2',
      EMSYSTEMS_BACKUP_ENCRYPTION_KEY: backupKey,
    },
    timeout: 20000,
    windowsHide: true,
  });
  assert.equal(backupResult.status, 0, backupResult.stderr || backupResult.stdout);
  const backupMatch = backupResult.stdout.match(/Backup completed: (.+) \((\d+) data files;/);
  assert.ok(backupMatch, backupResult.stdout);
  const backupDir = backupMatch[1];
  const originalBackupPayments = await readFile(join(backupDir, 'payments.json.enc'));

  // Create divergent current state so a successful restore must roll back to the saved snapshot.
  const current = new DatabaseSync(dbPath);
  const changed = fixtureData('Current Product');
  current.prepare('UPDATE app_kv SET value = ? WHERE key = ?').run(JSON.stringify(changed), 'emsystems.demo.data.v1');
  current.prepare('INSERT INTO sessions(sid, storage_json, created_at, expires_at) VALUES (?, ?, ?, ?)').run(
    'new-session-id-long-enough-0000000000000000000000', '{}', 200, 9999999999999,
  );
  current.close();
  await writeFile(join(paymentDir, 'payments.json'), JSON.stringify([{ ...savedPayments[0], status: 'pending' }], null, 2), { mode: 0o600 });

  const noConfirmation = spawnSync(process.execPath, [join(projectRoot, 'scripts', 'restore.mjs'), backupDir], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: { ...process.env, EMSYSTEMS_DB_PATH: dbPath, PAYMENT_STATE_DIR: paymentDir, APP_API_PORT: '5296', PAYMENT_PORT: '5297', EMSYSTEMS_BACKUP_ENCRYPTION_KEY: backupKey },
    timeout: 20000,
    windowsHide: true,
  });
  assert.equal(noConfirmation.status, 1, 'restore must require explicit confirmation');
  assert.match(noConfirmation.stderr, /--confirm/);

  // A checksum failure must be rejected before touching the current database/payment state.
  const tampered = Buffer.from(originalBackupPayments);
  tampered[tampered.length - 1] ^= 0xff;
  await writeFile(join(backupDir, 'payments.json.enc'), tampered);
  const corruptRestore = spawnSync(process.execPath, [join(projectRoot, 'scripts', 'restore.mjs'), backupDir, '--confirm'], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: { ...process.env, EMSYSTEMS_DB_PATH: dbPath, PAYMENT_STATE_DIR: paymentDir, APP_API_PORT: '5296', PAYMENT_PORT: '5297', EMSYSTEMS_BACKUP_ENCRYPTION_KEY: backupKey },
    timeout: 20000,
    windowsHide: true,
  });
  assert.equal(corruptRestore.status, 1);
  assert.match(corruptRestore.stderr, /checksum|size validation/i);
  const unchanged = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const unchangedData = JSON.parse(unchanged.prepare('SELECT value FROM app_kv WHERE key = ?').get('emsystems.demo.data.v1').value);
    assert.equal(unchangedData.products[0].name, 'Current Product');
  } finally { unchanged.close(); }
  assert.equal(JSON.parse(await readFile(join(paymentDir, 'payments.json'), 'utf8'))[0].status, 'pending');
  await writeFile(join(backupDir, 'payments.json.enc'), originalBackupPayments);

  const restoreResult = spawnSync(process.execPath, [join(projectRoot, 'scripts', 'restore.mjs'), backupDir, '--confirm'], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: { ...process.env, EMSYSTEMS_DB_PATH: dbPath, PAYMENT_STATE_DIR: paymentDir, APP_API_PORT: '5296', PAYMENT_PORT: '5297', EMSYSTEMS_BACKUP_ENCRYPTION_KEY: backupKey },
    timeout: 20000,
    windowsHide: true,
  });
  assert.equal(restoreResult.status, 0, restoreResult.stderr || restoreResult.stdout);
  assert.match(restoreResult.stdout, /All sessions and idempotency keys were revoked/i);

  const restored = new DatabaseSync(dbPath, { readOnly: true });
  try {
    assert.equal(restored.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    assert.equal(restored.prepare('SELECT COUNT(*) AS count FROM sessions').get().count, 0);
    assert.equal(restored.prepare('SELECT COUNT(*) AS count FROM idempotency').get().count, 0);
    const data = JSON.parse(restored.prepare('SELECT value FROM app_kv WHERE key = ?').get('emsystems.demo.data.v1').value);
    assert.equal(data.products[0].name, 'Backup Product');
    const productIds = new Set(data.products.map((item) => item.id));
    const branchIds = new Set(data.branches.map((item) => item.id));
    assert.ok(data.stock.every((row) => productIds.has(row.productId) && branchIds.has(row.branchId)));
    assert.ok(data.sales.every((sale) => sale.items.every((line) => productIds.has(line.productId))));
    const saleIds = new Set(data.sales.map((sale) => sale.id));
    assert.ok(data.payments.every((payment) => saleIds.has(payment.saleId)));
  } finally {
    restored.close();
  }

  assert.deepEqual(JSON.parse(await readFile(join(paymentDir, 'payments.json'), 'utf8')), savedPayments);
  const manifest = JSON.parse(await readFile(join(backupDir, 'manifest.json'), 'utf8'));
  for (const item of manifest.files) {
    const bytes = await readFile(join(backupDir, item.name));
    assert.equal(bytes.byteLength, item.sizeBytes);
  }
});
