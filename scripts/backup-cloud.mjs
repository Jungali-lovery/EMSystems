import { createHash, createHmac } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function loadEnvironmentFile() {
  try {
    const raw = await readFile(join(ROOT, '.env'), 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!match || Object.hasOwn(process.env, match[1])) continue;
      let value = match[2];
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      process.env[match[1]] = value;
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
function hmac(key, value, encoding) { return createHmac('sha256', key).update(value).digest(encoding); }
function encodeSegment(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

function canonicalHeaders(headers) {
  const entries = Object.entries(headers)
    .map(([key, value]) => [key.toLowerCase(), String(value).trim().replace(/\s+/g, ' ')])
    .sort(([left], [right]) => left.localeCompare(right));
  return {
    text: entries.map(([key, value]) => `${key}:${value}\n`).join(''),
    signed: entries.map(([key]) => key).join(';'),
  };
}

export function buildS3Authorization({ method, url, payloadHash, accessKeyId, secretAccessKey, region = 'auto', extraHeaders = {}, now = new Date() }) {
  const dateTime = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = dateTime.slice(0, 8);
  const headers = {
    host: url.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': dateTime,
    ...extraHeaders,
  };
  const canonical = canonicalHeaders(headers);
  const canonicalRequest = [method.toUpperCase(), url.pathname, url.search.slice(1), canonical.text, canonical.signed, payloadHash].join('\n');
  const scope = `${dateStamp}/${region}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', dateTime, scope, sha256(canonicalRequest)].join('\n');
  const dateKey = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const regionKey = hmac(dateKey, region);
  const serviceKey = hmac(regionKey, 's3');
  const signingKey = hmac(serviceKey, 'aws4_request');
  const signature = hmac(signingKey, stringToSign, 'hex');
  return {
    ...headers,
    authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${canonical.signed}, Signature=${signature}`,
  };
}

function required(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name} is required for off-site backup upload.`);
  return value;
}

async function loadLatestBackup(backupRoot) {
  const directories = (await readdir(backupRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('emsystems-backup-') && !entry.name.endsWith('.tmp'))
    .map((entry) => entry.name)
    .sort((left, right) => right.localeCompare(left));
  if (!directories.length) throw new Error('No completed encrypted backup directory was found. Run npm run backup:data first.');
  return join(backupRoot, directories[0]);
}

async function putObject({ endpoint, bucket, key, bytes, sha256Value, credentials, region }) {
  const url = new URL(endpoint);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('EMSYSTEMS_S3_ENDPOINT must be a clean HTTPS endpoint without credentials/query/fragment.');
  }
  const prefixPath = url.pathname.replace(/\/+$/, '');
  url.pathname = `${prefixPath}/${encodeSegment(bucket)}/${key.split('/').map(encodeSegment).join('/')}`;
  const payloadHash = sha256(bytes);
  const auth = buildS3Authorization({
    method: 'PUT', url, payloadHash,
    accessKeyId: credentials.accessKeyId,
    secretAccessKey: credentials.secretAccessKey,
    region,
    extraHeaders: { 'x-amz-meta-sha256': sha256Value },
  });
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: 'PUT', body: bytes,
        headers: { ...auth, 'content-type': 'application/octet-stream' },
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) {
        const detail = (await response.text().catch(() => '')).slice(0, 200);
        throw new Error(`S3 PUT failed with HTTP ${response.status}${detail ? `: ${detail}` : ''}`);
      }
      return response.status;
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolveDelay) => setTimeout(resolveDelay, attempt * 1000));
    }
  }
  throw lastError || new Error('S3 upload failed.');
}

async function main() {
  await loadEnvironmentFile();
  const endpoint = required('EMSYSTEMS_S3_ENDPOINT');
  const bucket = required('EMSYSTEMS_S3_BUCKET');
  const accessKeyId = required('EMSYSTEMS_S3_ACCESS_KEY_ID');
  const secretAccessKey = required('EMSYSTEMS_S3_SECRET_ACCESS_KEY');
  const region = String(process.env.EMSYSTEMS_S3_REGION || 'auto').trim();
  const prefix = String(process.env.EMSYSTEMS_S3_PREFIX || 'emsystems/backups').replace(/^\/+|\/+$/g, '');
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/i.test(bucket)) throw new Error('EMSYSTEMS_S3_BUCKET name is invalid.');
  if (prefix.split('/').some((part) => !part || part === '.' || part === '..')) throw new Error('EMSYSTEMS_S3_PREFIX is invalid.');

  const backupRoot = resolve(process.env.EMSYSTEMS_BACKUP_DIR || join(ROOT, '.emsystems-backups'));
  const backupDir = await loadLatestBackup(backupRoot);
  const manifestPath = join(backupDir, 'manifest.json');
  const manifestBytes = await readFile(manifestPath);
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  if (manifest.format !== 'emsystems-backup' || manifest.encryption?.algorithm !== 'AES-256-GCM' || !Array.isArray(manifest.files)) {
    throw new Error('Backup manifest is not a recognized encrypted EMSystems backup.');
  }

  const backupName = basename(backupDir);
  const remotePrefix = `${prefix}/${backupName}`;
  const uploadItems = [];
  for (const item of manifest.files) {
    if (!item.name || !String(item.name).endsWith('.enc') || String(item.name).includes('/') || String(item.name).includes('\\')) {
      throw new Error('Backup manifest contains an unexpected/non-encrypted file entry.');
    }
    const path = join(backupDir, item.name);
    const info = await stat(path);
    if (!info.isFile() || info.size !== Number(item.sizeBytes)) throw new Error(`Backup file size mismatch: ${item.name}`);
    const bytes = await readFile(path);
    const digest = sha256(bytes);
    if (digest !== item.sha256) throw new Error(`Backup checksum mismatch: ${item.name}`);
    uploadItems.push({ name: item.name, bytes, digest });
  }
  uploadItems.push({ name: 'manifest.json', bytes: manifestBytes, digest: sha256(manifestBytes) });

  const credentials = { accessKeyId, secretAccessKey };
  for (const item of uploadItems) {
    const remoteKey = `${remotePrefix}/${item.name}`;
    const status = await putObject({ endpoint, bucket, key: remoteKey, bytes: item.bytes, sha256Value: item.digest, credentials, region });
    process.stdout.write(`Uploaded ${remoteKey} (HTTP ${status}, ${item.bytes.length} bytes, SHA-256 ${item.digest}).\n`);
  }
  process.stdout.write(`Off-site encrypted backup upload completed: s3://${bucket}/${remotePrefix}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`Cloud backup failed: ${error?.message || 'unknown error'}\n`);
    process.exitCode = 1;
  });
}