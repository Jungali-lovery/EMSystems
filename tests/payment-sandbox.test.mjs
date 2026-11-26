import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatVnpayDate,
  buildVietQrQuickLink,
  momoNotificationSignature,
  verifyMomoNotification,
  verifyVnpaySignature,
  vnpayCanonicalQuery,
  vnpaySignature,
} from '../server/payment-gateway-utils.mjs';

test('MoMo IPN signature is verified and tampered amount is rejected', () => {
  const accessKey = 'sandbox-access-key';
  const secretKey = 'sandbox-secret-key';
  const payload = {
    partnerCode: 'MOMO', amount: 125000, requestId: 'request-1', orderId: 'payment-1',
    orderInfo: 'Thanh toan don WEB-00001', orderType: 'momo_wallet', transId: 'trans-1',
    resultCode: 0, message: 'Successful.', payType: 'qr', responseTime: 1761000000000, extraData: '',
  };
  payload.signature = momoNotificationSignature(payload, accessKey, secretKey);
  assert.equal(verifyMomoNotification(payload, accessKey, secretKey), true);
  assert.equal(verifyMomoNotification({ ...payload, amount: 1 }, accessKey, secretKey), false);
  assert.equal(verifyMomoNotification({ ...payload, signature: 'invalid' }, accessKey, secretKey), false);
});

test('VNPAY signatures sort parameters, encode spaces consistently, and reject modified values', () => {
  const secretKey = 'sandbox-hash-secret';
  const params = {
    vnp_Version: '2.1.0', vnp_Command: 'pay', vnp_TmnCode: 'TEST1234',
    vnp_TxnRef: 'payment-123', vnp_OrderInfo: 'Thanh toan don WEB-00001',
    vnp_Amount: '12500000', vnp_SecureHashType: 'HmacSHA512',
  };
  assert.match(vnpayCanonicalQuery(params), /vnp_OrderInfo=Thanh\+toan\+don\+WEB-00001/);
  const signed = { ...params, vnp_SecureHash: vnpaySignature(params, secretKey) };
  assert.equal(verifyVnpaySignature(signed, secretKey), true);
  assert.equal(verifyVnpaySignature({ ...signed, vnp_Amount: '125000' }, secretKey), false);
  assert.equal(verifyVnpaySignature({ ...params }, secretKey), false);
});

test('VNPAY canonical query uses PHP-style URL encoding for reserved characters', () => {
  const canonical = vnpayCanonicalQuery({ vnp_OrderInfo: "test !*'()~" });
  assert.equal(canonical, 'vnp_OrderInfo=test+%21%2A%27%28%29%7E');
});

test('VNPAY Merchant Hosted QR command is separately signed and tampering is rejected', () => {
  const secret = 'test-only-secret';
  const params = {
    vnp_Version: '2.1.0',
    vnp_Command: 'genqr',
    vnp_TmnCode: 'TEST1234',
    vnp_Amount: '12500000',
    vnp_CurrCode: 'VND',
    vnp_TxnRef: '1234567890abcdef1234567890abcdef',
    vnp_OrderInfo: 'Thanh toan don hang WEB-TEST',
  };
  const signed = { ...params, vnp_SecureHash: vnpaySignature(params, secret) };

  assert.match(vnpayCanonicalQuery(params), /vnp_Command=genqr/);
  assert.equal(verifyVnpaySignature(signed, secret), true);
  assert.equal(verifyVnpaySignature({ ...signed, vnp_Command: 'pay' }, secret), false);
  assert.equal(verifyVnpaySignature({ ...signed, vnp_Amount: '1' }, secret), false);
});

test('VNPAY date strings use the expected 14-digit timestamp shape', () => {
  assert.match(formatVnpayDate(new Date('2026-10-25T00:00:00.000Z')), /^\d{14}$/);
});

test('VietQR quick link embeds exact order amount and transfer memo safely', () => {
  const result = buildVietQrQuickLink({
    bankCode: 'MB',
    accountNumber: '0123456789',
    accountName: 'NGUYEN VAN A',
    amount: 1250000,
    addInfo: 'EMSYS WEB 00042',
  });
  const url = new URL(result.imageUrl);
  assert.equal(url.origin, 'https://img.vietqr.io');
  assert.equal(url.pathname, '/image/mb-0123456789-qr_only.png');
  assert.equal(url.searchParams.get('amount'), '1250000');
  assert.equal(url.searchParams.get('addInfo'), 'EMSYS WEB 00042');
  assert.equal(url.searchParams.get('accountName'), 'NGUYEN VAN A');
  assert.equal(result.transferContent, 'EMSYS WEB 00042');
});

test('VietQR quick link rejects malformed receiving account and transfer content', () => {
  const base = {
    bankCode: 'MB', accountNumber: '0123456789', accountName: 'NGUYEN VAN A',
    amount: 1250000, addInfo: 'EMSYS WEB 00042',
  };
  assert.throws(() => buildVietQrQuickLink({ ...base, accountNumber: 'javascript:alert(1)' }), /tài khoản/i);
  assert.throws(() => buildVietQrQuickLink({ ...base, amount: 0 }), /số tiền/i);
  assert.throws(() => buildVietQrQuickLink({ ...base, addInfo: 'EMSYS <script>' }), /nội dung/i);
});