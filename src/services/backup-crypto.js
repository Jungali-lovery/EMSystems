const ENVELOPE_FORMAT = 'emsystems-encrypted-backup';
const ENVELOPE_VERSION = 1;
const KDF_ITERATIONS = 310_000;

function toBase64(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw new Error('Dữ liệu mã hóa không hợp lệ.');
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function deriveKey(passphrase, salt, iterations) {
  if (!globalThis.crypto?.subtle || typeof TextEncoder === 'undefined') throw new Error('Thiết bị không hỗ trợ Web Crypto.');
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptBackupPayload(payload, passphrase) {
  if (typeof passphrase !== 'string' || passphrase.length < 12 || passphrase.length > 200) {
    throw new Error('Mật khẩu mã hóa backup phải dài từ 12 đến 200 ký tự.');
  }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt, KDF_ITERATIONS);
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  if (plaintext.length > 25 * 1024 * 1024) throw new Error('Dữ liệu backup vượt giới hạn 25 MB trước mã hóa.');
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
  return JSON.stringify({
    format: ENVELOPE_FORMAT,
    version: ENVELOPE_VERSION,
    kdf: 'PBKDF2-SHA256',
    iterations: KDF_ITERATIONS,
    cipher: 'AES-256-GCM',
    salt: toBase64(salt),
    iv: toBase64(iv),
    ciphertext: toBase64(new Uint8Array(ciphertext)),
  }, null, 2);
}

export async function decryptBackupPayload(envelope, passphrase) {
  if (!envelope || envelope.format !== ENVELOPE_FORMAT || envelope.version !== ENVELOPE_VERSION
    || envelope.kdf !== 'PBKDF2-SHA256' || envelope.cipher !== 'AES-256-GCM') {
    throw new Error('Định dạng backup mã hóa không được hỗ trợ.');
  }
  const iterations = Number(envelope.iterations);
  if (!Number.isSafeInteger(iterations) || iterations < 100_000 || iterations > 1_000_000) {
    throw new Error('Thông số dẫn xuất khóa trong backup không hợp lệ.');
  }
  const salt = fromBase64(envelope.salt);
  const iv = fromBase64(envelope.iv);
  const ciphertext = fromBase64(envelope.ciphertext);
  if (salt.length !== 16 || iv.length !== 12 || ciphertext.length < 16 || ciphertext.length > 25 * 1024 * 1024) {
    throw new Error('Kích thước dữ liệu backup mã hóa không hợp lệ.');
  }
  try {
    const key = await deriveKey(passphrase, salt, iterations);
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
    return JSON.parse(new TextDecoder().decode(plaintext));
  } catch {
    throw new Error('Không giải mã được backup. Kiểm tra mật khẩu hoặc tính toàn vẹn của file.');
  }
}