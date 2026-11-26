import { createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { createConnection } from 'node:net';
import {
  chmod, copyFile, mkdir, readFile, rename, rm, stat, writeFile,
} from 'node:fs/promises';
import { dirname, join, resolve, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA_KEY = 'emsystems.demo.data.v1';

async function loadEnvironmentFile() {
  try {
    const raw = await readFile(join(ROOT, '.env'), 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!match || Object.hasOwn(process.env, match[1])) continue;
      let value = match[2];
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      process.env[match[1]] = value;
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

function fail(message) {
  throw new Error(message);
}

function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

function readEncryptionKey() {
  const value = String(process.env.EMSYSTEMS_BACKUP_ENCRYPTION_KEY || '').trim();
  if (!/^[a-f0-9]{64}$/i.test(value)) {
    fail('EMSYSTEMS_BACKUP_ENCRYPTION_KEY is required and must be exactly 64 hexadecimal characters (32 bytes).');
  }
  return Buffer.from(value, 'hex');
}

async function decryptFile(sourcePath, targetPath, key) {
  const encrypted = await readFile(sourcePath);
  if (encrypted.length < 36 || encrypted.subarray(0, 8).toString('ascii') !== 'EMSBACK1') {
    fail(`Encrypted backup file has an invalid header: ${basename(sourcePath)}`);
  }
  const nonce = encrypted.subarray(8, 20);
  const tag = encrypted.subarray(20, 36);
  const ciphertext = encrypted.subarray(36);
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, nonce);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    await writeFile(targetPath, plaintext, { mode: 0o600, flag: 'wx' });
  } catch {
    fail(`Backup authentication/decryption failed: ${basename(sourcePath)}. Check the encryption key and file integrity.`);
  }
}

async function checkListening(port) {
  return new Promise((resolveResult) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    let resolved = false;
    const finish = (result) => {
      if (resolved) return;
      resolved = true;
      socket.destroy();
      resolveResult(result);
    };
    socket.setTimeout(350, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

async function assertServiceStopped(port, name) {
  if (await checkListening(port)) {
    fail(`${name} appears to be running on 127.0.0.1:${port}; stop it before restoring a backup.`);
  }
}

function assertUniqueIds(rows, label) {
  if (!Array.isArray(rows)) fail(`Backup collection "${label}" is missing or is not an array.`);
  const ids = new Set();
  for (const row of rows) {
    const id = Number(row?.id);
    if (!Number.isSafeInteger(id) || id < 1 || ids.has(id)) {
      fail(`Backup collection "${label}" has an invalid or duplicate ID.`);
    }
    ids.add(id);
  }
  return ids;
}

function validateBusinessData(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) fail('Business data snapshot is not a JSON object.');
  for (const collection of ['products', 'branches', 'categories', 'brands', 'suppliers', 'stock', 'customers', 'sales', 'payments']) {
    if (!Array.isArray(data[collection])) fail(`Business data collection "${collection}" is missing or invalid.`);
  }

  const products = assertUniqueIds(data.products, 'products');
  const branches = assertUniqueIds(data.branches, 'branches');
  const customers = assertUniqueIds(data.customers, 'customers');
  const categories = assertUniqueIds(data.categories, 'categories');
  const brands = assertUniqueIds(data.brands, 'brands');
  const suppliers = assertUniqueIds(data.suppliers, 'suppliers');
  const sales = assertUniqueIds(data.sales, 'sales');

  for (const product of data.products) {
    for (const [field, allowed, label] of [
      ['categoryId', categories, 'category'],
      ['brandId', brands, 'brand'],
      ['supplierId', suppliers, 'supplier'],
    ]) {
      if (product[field] != null && !allowed.has(Number(product[field]))) {
        fail(`Product ${product.id} refers to a missing ${label}.`);
      }
    }
  }
  for (const stock of data.stock) {
    if (!products.has(Number(stock.productId)) || !branches.has(Number(stock.branchId))) {
      fail('A stock row refers to a missing product or branch.');
    }
    if (!Number.isSafeInteger(Number(stock.quantity)) || Number(stock.quantity) < 0) {
      fail('A stock row contains a negative or invalid quantity.');
    }
  }
  for (const sale of data.sales) {
    if (sale.branchId != null && !branches.has(Number(sale.branchId))) fail(`Sale ${sale.id} refers to a missing branch.`);
    if (sale.customerId != null && !customers.has(Number(sale.customerId))) fail(`Sale ${sale.id} refers to a missing customer.`);
    if (!Array.isArray(sale.items)) fail(`Sale ${sale.id} has no valid item list.`);
    for (const item of sale.items) {
      if (!products.has(Number(item.productId))) fail(`Sale ${sale.id} contains a line for a missing product.`);
      if (!Number.isSafeInteger(Number(item.quantity)) || Number(item.quantity) < 1) {
        fail(`Sale ${sale.id} contains an invalid item quantity.`);
      }
    }
  }
  for (const payment of data.payments) {
    if (!sales.has(Number(payment.saleId))) fail('A payment row refers to a missing sale.');
  }
  return { products: data.products.length, branches: data.branches.length, sales: data.sales.length, payments: data.payments.length };
}

function inspectDatabase(path, { writable = false } = {}) {
  const db = new DatabaseSync(path, writable ? {} : { readOnly: true });
  try {
    const integrity = db.prepare('PRAGMA integrity_check').get();
    if (integrity?.integrity_check !== 'ok') fail('SQLite integrity_check failed for the backup database.');
    const tableNames = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name));
    for (const name of ['app_kv', 'sessions', 'idempotency']) {
      if (!tableNames.has(name)) fail(`Backup SQLite is missing required table "${name}".`);
    }
    const row = db.prepare('SELECT value FROM app_kv WHERE key = ?').get(DATA_KEY);
    if (!row?.value) fail('Backup SQLite has no EMSystems business data snapshot.');
    let data;
    try { data = JSON.parse(row.value); }
    catch { fail('Backup business data is not valid JSON.'); }
    const counts = validateBusinessData(data);
    return { counts, db };
  } catch (error) {
    db.close();
    throw error;
  }
}

async function validateBackup(backupDir, stagingDir, encryptionKey) {
  const manifestPath = join(backupDir, 'manifest.json');
  let manifest;
  try { manifest = JSON.parse(await readFile(manifestPath, 'utf8')); }
  catch { fail('Backup manifest is missing or invalid JSON.'); }
  if (manifest.format !== 'emsystems-backup' || manifest.version !== 1
    || manifest.encryption?.algorithm !== 'AES-256-GCM' || manifest.encryption?.format !== 'EMSBACK1'
    || manifest.database !== 'emsystems.sqlite.enc' || !Array.isArray(manifest.files)) {
    fail('Unsupported backup manifest format/version.');
  }
  const expectedNames = new Set(['emsystems.sqlite.enc', 'payments.json.enc']);
  const found = new Set();
  for (const entry of manifest.files) {
    if (!entry || !expectedNames.has(entry.name) || found.has(entry.name)) fail('Backup manifest contains an unsupported or duplicate file name.');
    found.add(entry.name);
    const file = join(backupDir, entry.name);
    const bytes = await readFile(file).catch(() => null);
    if (!bytes) fail(`Backup data file is missing: ${entry.name}`);
    if (bytes.byteLength !== entry.sizeBytes || sha256(bytes) !== entry.sha256) {
      fail(`Backup checksum/size validation failed: ${entry.name}`);
    }
    await decryptFile(file, join(stagingDir, entry.name.slice(0, -4)), encryptionKey);
  }
  if (!found.has('emsystems.sqlite.enc')) fail('Backup does not contain an encrypted SQLite snapshot.');
  if (Boolean(manifest.includesPaymentState) !== found.has('payments.json.enc')) {
    fail('Backup manifest payment-state flag does not match its files.');
  }

  const databasePath = join(stagingDir, 'emsystems.sqlite');
  const inspected = inspectDatabase(databasePath);
  inspected.db.close();

  let paymentRows = null;
  if (found.has('payments.json.enc')) {
    try { paymentRows = JSON.parse(await readFile(join(stagingDir, 'payments.json'), 'utf8')); }
    catch { fail('Backup payment state is invalid JSON.'); }
    if (!Array.isArray(paymentRows)) fail('Backup payment state has an unexpected shape.');
    const dataDb = new DatabaseSync(databasePath, { readOnly: true });
    try {
      const snapshot = JSON.parse(dataDb.prepare('SELECT value FROM app_kv WHERE key = ?').get(DATA_KEY).value);
      const invoices = new Set(snapshot.sales.map((sale) => String(sale.invoiceNo || '')));
      for (const payment of paymentRows) {
        if (payment?.orderId && !invoices.has(String(payment.orderId))) {
          fail('A sandbox payment points to an order that is not present in the SQLite backup.');
        }
      }
    } finally {
      dataDb.close();
    }
  }
  return { manifest, paymentRows, counts: inspected.counts };
}

async function atomicWritePaymentState(source, target) {
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  const temp = `${target}.restore-${randomBytes(5).toString('hex')}.tmp`;
  await copyFile(source, temp);
  await chmod(temp, 0o600);
  await rename(temp, target);
}

async function main() {
  await loadEnvironmentFile();
  const encryptionKey = readEncryptionKey();
  const backupArgument = process.argv[2];
  if (!backupArgument || !process.argv.includes('--confirm')) {
    fail('Usage: node scripts/restore.mjs "<backup-directory>" --confirm (stop API and payment services first).');
  }
  const backupDir = resolve(backupArgument);
  const backupStat = await stat(backupDir).catch(() => null);
  if (!backupStat?.isDirectory()) fail(`Backup directory not found: ${backupDir}`);

  const targetDb = resolve(process.env.EMSYSTEMS_DB_PATH || join(ROOT, '.emsystems-data', 'emsystems.sqlite'));
  const paymentDir = resolve(process.env.PAYMENT_STATE_DIR || join(ROOT, '.payment-sandbox-data'));
  const targetPayments = join(paymentDir, 'payments.json');
  if (targetDb === join(backupDir, 'emsystems.sqlite') || targetDb === join(backupDir, 'emsystems.sqlite.enc')) fail('Restore target cannot be the backup snapshot itself.');

  const apiPort = Number(process.env.APP_API_PORT) || 5176;
  const paymentPort = Number(process.env.PAYMENT_PORT) || 5175;
  await assertServiceStopped(apiPort, 'Business API');
  await assertServiceStopped(paymentPort, 'Payment service');

  // Decrypted validation snapshots stay in a private OS temp directory, never beside stored backups.
  const validationDir = join(tmpdir(), `.emsystems-restore-validation-${randomBytes(6).toString('hex')}`);
  await mkdir(validationDir, { recursive: false, mode: 0o700 });
  let validated;
  try { validated = await validateBackup(backupDir, validationDir, encryptionKey); }
  catch (error) { await rm(validationDir, { recursive: true, force: true }); throw error; }
  const { manifest, counts } = validated;
  const backupHasPayments = Boolean(manifest.includesPaymentState);
  if (!backupHasPayments && await stat(targetPayments).catch(() => null)) {
    await rm(validationDir, { recursive: true, force: true });
    fail('Current payment state exists but this backup has no payments.json. Create a complete backup before restoring to prevent mismatched orders/payment records.');
  }

  const tag = new Date().toISOString().replace(/[:.]/g, '-');
  const suffix = randomBytes(4).toString('hex');
  const stagedDb = join(dirname(targetDb), `.${basename(targetDb)}.restore-${suffix}.tmp`);
  const rollbackDb = `${targetDb}.pre-restore-${tag}-${suffix}.bak`;
  const paymentRollback = `${targetPayments}.pre-restore-${tag}-${suffix}.bak`;
  let originalDbMoved = false;
  let originalPaymentMoved = false;
  let newDbInstalled = false;
  let newPaymentInstalled = false;

  try {
    await mkdir(dirname(targetDb), { recursive: true });
    await mkdir(paymentDir, { recursive: true, mode: 0o700 });
    await copyFile(join(validationDir, 'emsystems.sqlite'), stagedDb);
    await chmod(stagedDb, 0o600);
    const stagedInspection = inspectDatabase(stagedDb, { writable: true });
    // Old sessions and idempotency caches must not survive restore: they could revive stale auth
    // or replay responses from a data state that was replaced.
    stagedInspection.db.exec('DELETE FROM sessions; DELETE FROM idempotency;');
    const checkpoint = stagedInspection.db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();
    if (checkpoint && Number(checkpoint.busy) > 0) fail('Cannot checkpoint the staged restore database.');
    stagedInspection.db.exec('PRAGMA journal_mode = DELETE;');
    stagedInspection.db.close();

    // The API and payment service must be offline. Preserve the previous files by atomic rename
    // and roll them back if any later filesystem operation fails.
    const currentStat = await stat(targetDb).catch(() => null);
    if (currentStat?.isFile()) {
      const current = new DatabaseSync(targetDb);
      try {
        const checkpoint = current.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();
        if (checkpoint && Number(checkpoint.busy) > 0) fail('Current SQLite database is busy; restore cancelled before replacement.');
      } finally { current.close(); }
      await rm(`${targetDb}-wal`, { force: true });
      await rm(`${targetDb}-shm`, { force: true });
      await rename(targetDb, rollbackDb);
      originalDbMoved = true;
    }

    const currentPaymentsStat = await stat(targetPayments).catch(() => null);
    if (backupHasPayments && currentPaymentsStat?.isFile()) {
      await rename(targetPayments, paymentRollback);
      originalPaymentMoved = true;
    }

    await rename(stagedDb, targetDb);
    newDbInstalled = true;

    if (backupHasPayments) {
      const paymentTemp = `${targetPayments}.restore-${suffix}.tmp`;
      await copyFile(join(validationDir, 'payments.json'), paymentTemp);
      await chmod(paymentTemp, 0o600);
      await rename(paymentTemp, targetPayments);
      newPaymentInstalled = true;
    }

    const verified = inspectDatabase(targetDb);
    verified.db.close();
    process.stdout.write(
      `Restore completed: ${targetDb}. Restored ${counts.products} products, ${counts.branches} branches, ${counts.sales} sales, ${counts.payments} payment records. All sessions and idempotency keys were revoked.\n`,
    );
    if (originalDbMoved) process.stdout.write(`Pre-restore database retained at: ${rollbackDb}\n`);
    if (originalPaymentMoved) process.stdout.write(`Pre-restore payment state retained at: ${paymentRollback}\n`);
    await rm(validationDir, { recursive: true, force: true });
  } catch (error) {
    if (newPaymentInstalled || originalPaymentMoved) {
      await rm(targetPayments, { force: true }).catch(() => {});
    }
    if (originalPaymentMoved) await rename(paymentRollback, targetPayments).catch(() => {});
    await rm(`${targetPayments}.restore-${suffix}.tmp`, { force: true }).catch(() => {});
    if (newDbInstalled) await rm(targetDb, { force: true }).catch(() => {});
    if (originalDbMoved) await rename(rollbackDb, targetDb).catch(() => {});
    await rm(stagedDb, { force: true }).catch(() => {});
    await rm(validationDir, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

main().catch((error) => {
  process.stderr.write(`Restore failed: ${error?.message || 'unknown error'}\n`);
  process.exitCode = 1;
});
