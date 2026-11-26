// Password credentials are salted and stored with the server-side user record.
const PASSWORD_SCHEME = 'PBKDF2-SHA256';
const PASSWORD_ITERATIONS = 120_000;

function toHex(bytes) {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
}

function fromHex(value) {
  if (typeof value !== 'string' || value.length % 2 !== 0 || !/^[a-f0-9]+$/i.test(value)) return null;
  return new Uint8Array(value.match(/.{2}/g).map((byte) => Number.parseInt(byte, 16)));
}

async function derivePasswordDigest(password, salt, iterations) {
  if (!globalThis.crypto?.subtle || typeof TextEncoder === 'undefined') {
    throw new Error('Web Crypto không khả dụng trong trình duyệt này.');
  }
  const material = await globalThis.crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await globalThis.crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    material,
    256,
  );
  return new Uint8Array(bits);
}

/**
 * Tạo credential PBKDF2 với salt ngẫu nhiên cho từng tài khoản. Hàm chỉ được
 * gọi từ business API đáng tin cậy; không phát credential ra client.
 */
export async function createPasswordCredential(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 200) {
    throw new Error('Mật khẩu phải dài từ 12 đến 200 ký tự.');
  }
  if (!globalThis.crypto?.getRandomValues || !globalThis.crypto?.subtle) {
    throw new Error('Web Crypto không khả dụng; không thể cấp mật khẩu an toàn cho tài khoản demo.');
  }
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const digest = await derivePasswordDigest(password, salt, PASSWORD_ITERATIONS);
  return {
    scheme: PASSWORD_SCHEME,
    iterations: PASSWORD_ITERATIONS,
    salt: toHex(salt),
    digest: toHex(digest),
    createdAt: new Date().toISOString(),
  };
}

async function verifyPasswordCredential(password, credential) {
  if (typeof password !== 'string' || !credential || credential.scheme !== PASSWORD_SCHEME) return false;
  const iterations = Number(credential.iterations);
  const salt = fromHex(credential.salt);
  const expected = fromHex(credential.digest);
  if (!salt || salt.length < 16 || !expected || expected.length !== 32
    || !Number.isSafeInteger(iterations) || iterations < 100_000 || iterations > 1_000_000) return false;
  const actual = await derivePasswordDigest(password, salt, iterations);
  let mismatch = actual.length ^ expected.length;
  for (let index = 0; index < actual.length; index += 1) mismatch |= actual[index] ^ expected[index];
  return mismatch === 0;
}

export async function verifyDemoCredential(_username, password, user = null) {
  if (typeof password !== 'string' || password.length === 0 || !user?.passwordCredential) return false;
  try { return await verifyPasswordCredential(password, user.passwordCredential); } catch { return false; }
}
