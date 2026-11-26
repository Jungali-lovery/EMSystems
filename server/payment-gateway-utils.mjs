import { createHmac, timingSafeEqual } from 'node:crypto';

function asText(value) {
  return value === undefined || value === null ? '' : String(value);
}

export function hmacHex(algorithm, secret, message) {
  return createHmac(algorithm, secret).update(message, 'utf8').digest('hex');
}

export function safeHexEqual(actual, expected) {
  const left = Buffer.from(asText(actual).toLowerCase(), 'utf8');
  const right = Buffer.from(asText(expected).toLowerCase(), 'utf8');
  return left.length > 0 && left.length === right.length && timingSafeEqual(left, right);
}

export function momoCreateSignature(payload, accessKey, secretKey) {
  const fields = [
    ['accessKey', accessKey],
    ['amount', payload.amount],
    ['extraData', payload.extraData],
    ['ipnUrl', payload.ipnUrl],
    ['orderId', payload.orderId],
    ['orderInfo', payload.orderInfo],
    ['partnerCode', payload.partnerCode],
    ['redirectUrl', payload.redirectUrl],
    ['requestId', payload.requestId],
    ['requestType', payload.requestType],
  ];
  const data = fields.map(([key, value]) => `${key}=${asText(value)}`).join('&');
  return hmacHex('sha256', secretKey, data);
}

export function momoNotificationSignature(payload, accessKey, secretKey) {
  const fields = [
    ['accessKey', accessKey],
    ['amount', payload.amount],
    ['extraData', payload.extraData],
    ['message', payload.message],
    ['orderId', payload.orderId],
    ['orderInfo', payload.orderInfo],
    ['orderType', payload.orderType],
    ['partnerCode', payload.partnerCode],
    ['payType', payload.payType],
    ['requestId', payload.requestId],
    ['responseTime', payload.responseTime],
    ['resultCode', payload.resultCode],
    ['transId', payload.transId],
  ];
  const data = fields.map(([key, value]) => `${key}=${asText(value)}`).join('&');
  return hmacHex('sha256', secretKey, data);
}

export function verifyMomoNotification(payload, accessKey, secretKey) {
  if (!payload || typeof payload !== 'object' || !payload.signature) return false;
  return safeHexEqual(payload.signature, momoNotificationSignature(payload, accessKey, secretKey));
}

export function vnpayCanonicalQuery(params) {
  const encode = (value) => encodeURIComponent(asText(value))
    .replace(/[!'()*~]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/%20/g, '+');
  return Object.entries(params || {})
    .filter(([key, value]) => key.startsWith('vnp_')
      && key !== 'vnp_SecureHash'
      && key !== 'vnp_SecureHashType'
      && value !== undefined && value !== null && String(value) !== '')
    .sort(([a], [b]) => a.localeCompare(b, 'en'))
    .map(([key, value]) => `${encode(key)}=${encode(value)}`)
    .join('&');
}

export function vnpaySignature(params, secretKey) {
  return hmacHex('sha512', secretKey, vnpayCanonicalQuery(params));
}

export function verifyVnpaySignature(params, secretKey) {
  return Boolean(params?.vnp_SecureHash)
    && safeHexEqual(params.vnp_SecureHash, vnpaySignature(params, secretKey));
}

export function formatVnpayDate(date = new Date()) {
  const values = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).filter((item) => item.type !== 'literal').map((item) => [item.type, item.value]));
  return `${values.year}${values.month}${values.day}${values.hour}${values.minute}${values.second}`;
}

// VietQR Quick Link: thông tin tài khoản nhận tiền phải đến từ cấu hình server,
// còn amount/addInfo được tạo từ đơn đã xác minh ở business API.
export function buildVietQrQuickLink({ bankCode, accountNumber, accountName, amount, addInfo }) {
  const bank = asText(bankCode).trim().toLowerCase();
  const account = asText(accountNumber).trim();
  const holder = asText(accountName).trim();
  const memo = asText(addInfo).trim();
  const numericAmount = Number(amount);

  if (!/^[a-z0-9-]{2,30}$/.test(bank) || !/^\d{6,19}$/.test(account)) {
    throw new Error('Mã ngân hàng hoặc số tài khoản VietQR chưa hợp lệ.');
  }
  if (holder.length < 2 || holder.length > 100 || /[<>\r\n]/.test(holder)) {
    throw new Error('Tên chủ tài khoản VietQR chưa hợp lệ.');
  }
  if (!Number.isSafeInteger(numericAmount) || numericAmount < 1000 || numericAmount > 100_000_000) {
    throw new Error('Số tiền VietQR phải là số nguyên từ 1.000đ đến 100.000.000đ.');
  }
  if (!/^[A-Za-z0-9 ]{3,50}$/.test(memo)) {
    throw new Error('Nội dung chuyển khoản VietQR không hợp lệ.');
  }

  const imageUrl = new URL(`https://img.vietqr.io/image/${bank}-${account}-qr_only.png`);
  imageUrl.search = new URLSearchParams({
    amount: String(numericAmount),
    addInfo: memo,
    accountName: holder,
  }).toString();

  return {
    imageUrl: imageUrl.toString(),
    transferContent: memo,
    amount: numericAmount,
    bankCode: bank,
    accountNumber: account,
    accountName: holder,
  };
}