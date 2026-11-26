import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

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

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function readEncryptionKey() {
  const value = String(process.env.EMSYSTEMS_BACKUP_ENCRYPTION_KEY || '').trim();
  if (!/^[a-f0-9]{64}$/i.test(value)) {
    throw new Error('EMSYSTEMS_BACKUP_ENCRYPTION_KEY is required and must be exactly 64 hexadecimal characters (32 bytes).');
  }
  return Buffer.from(value, 'hex');
}

async function encryptFile(sourcePath, targetPath, key) {
  const plaintext = await readFile(sourcePath);
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const encrypted = Buffer.concat([Buffer.from('EMSBACK1', 'ascii'), nonce, cipher.getAuthTag(), ciphertext]);
  await writeFile(targetPath, encrypted, { mode: 0o600 });
  return { sizeBytes: encrypted.byteLength, sha256: sha256(encrypted) };
}

async function main() {
  await loadEnvironmentFile();
  const encryptionKey = readEncryptionKey();

  const sourceDb = resolve(process.env.EMSYSTEMS_DB_PATH || join(ROOT, '.emsystems-data', 'emsystems.sqlite'));
  const sourcePaymentState = resolve(process.env.PAYMENT_STATE_DIR || join(ROOT, '.payment-sandbox-data'));
  const backupRoot = resolve(process.env.EMSYSTEMS_BACKUP_DIR || join(ROOT, '.emsystems-backups'));
  const retentionValue = Number(process.env.EMSYSTEMS_BACKUP_RETENTION || 14);
  const retention = Number.isSafeInteger(retentionValue) ? Math.max(1, Math.min(100, retentionValue)) : 14;

  const sourceStat = await stat(sourceDb).catch(() => null);
  if (!sourceStat?.isFile()) {
    throw new Error(`SQLite database not found: ${sourceDb}. Start the API and verify EMSYSTEMS_DB_PATH before backing up.`);
  }

  await mkdir(backupRoot, { recursive: true, mode: 0o700 });
  const timestamp = new Date().toISOString().replace(/[.:]/g, '-');
  const uniqueSuffix = randomBytes(3).toString('hex');
  const backupName = `emsystems-backup-${timestamp}-${uniqueSuffix}`;
  // Plaintext SQLite/payment snapshots exist only in a private OS temp folder.
  const workingDir = join(tmpdir(), `${backupName}.tmp`);
  const publishDir = join(backupRoot, `${backupName}.tmp`);
  const backupDir = join(backupRoot, backupName);
  try {
    await mkdir(workingDir, { recursive: false, mode: 0o700 });
    await mkdir(publishDir, { recursive: false, mode: 0o700 });
    const manifestFiles = [];
    const databaseBackup = join(workingDir, 'emsystems.sqlite');
    const escapedOutput = databaseBackup.replace(/'/g, "''");
    const database = new DatabaseSync(sourceDb);
    try {
      // VACUUM INTO captures a consistent SQLite snapshot, including committed WAL state.
      database.exec(`VACUUM INTO '${escapedOutput}'`);
    } finally {
      database.close();
    }
    const encryptedDatabase = join(publishDir, 'emsystems.sqlite.enc');
    manifestFiles.push({ name: 'emsystems.sqlite.enc', ...(await encryptFile(databaseBackup, encryptedDatabase, encryptionKey)) });
    await rm(databaseBackup, { force: true });

    const sourcePayments = join(sourcePaymentState, 'payments.json');
    const paymentStat = await stat(sourcePayments).catch(() => null);
    if (paymentStat?.isFile()) {
      const paymentContent = await readFile(sourcePayments);
      let parsed;
      try { parsed = JSON.parse(paymentContent.toString('utf8')); }
      catch { throw new Error('Payment state JSON is invalid; refusing to report a complete backup.'); }
      if (!Array.isArray(parsed)) throw new Error('Payment state JSON has an unexpected shape; refusing to report a complete backup.');
      const paymentPlaintext = join(workingDir, 'payments.json');
      const paymentBackup = join(publishDir, 'payments.json.enc');
      await writeFile(paymentPlaintext, paymentContent, { mode: 0o600 });
      manifestFiles.push({ name: 'payments.json.enc', ...(await encryptFile(paymentPlaintext, paymentBackup, encryptionKey)) });
      await rm(paymentPlaintext, { force: true });
    }

    const manifest = {
      format: 'emsystems-backup',
      version: 1,
      createdAt: new Date().toISOString(),
      encryption: { algorithm: 'AES-256-GCM', format: 'EMSBACK1' },
      database: 'emsystems.sqlite.enc',
      includesPaymentState: manifestFiles.some((file) => file.name === 'payments.json.enc'),
      files: manifestFiles,
    };
    await writeFile(join(publishDir, 'manifest.json'), JSON.stringify(manifest, null, 2), { encoding: 'utf8', mode: 0o600 });
    await rm(workingDir, { recursive: true, force: true });
    // Publish only a complete backup directory; interrupted runs remain invisible to retention logic.
    await rename(publishDir, backupDir);

    const entries = (await readdir(backupRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && entry.name.startsWith('emsystems-backup-') && !entry.name.endsWith('.tmp'))
      .map((entry) => entry.name)
      .sort((left, right) => right.localeCompare(left));
    for (const obsolete of entries.slice(retention)) {
      await rm(join(backupRoot, obsolete), { recursive: true, force: true });
    }

    process.stdout.write(`Backup completed: ${backupDir} (${manifestFiles.length} data files; retention ${retention}).\n`);
  } catch (error) {
    await rm(workingDir, { recursive: true, force: true });
    await rm(publishDir, { recursive: true, force: true });
    throw error;
  }
}

main().catch((error) => {
  process.stderr.write(`Backup failed: ${error?.message || 'unknown error'}\n`);
  process.exitCode = 1;
});
