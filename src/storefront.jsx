import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import QRCode from 'qrcode';
import { dataRequest, formatMoney } from './api-client.js';
import { fetchDummyJsonElectronics } from './services/dummyjson.js';
import { calculateDeliveryQuote, findNearestSupportedDeliveryArea } from './services/delivery.js';
import emsystemsLogo from './picture/emsystems-logo.webp';
import emsystemsHeader from './picture/emsystems-tech-background.webp';

const CART_KEY = 'emsystems.store.cart.v1';
const PENDING_PAYMENT_KEY = 'emsystems.store.pending-payment.v1';
const PENDING_WISHLIST_KEY = 'emsystems.store.pending-wishlist.v1';

function readCart() {
  try {
    const raw = window.localStorage.getItem(CART_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((row) => Number.isSafeInteger(Number(row.productId)) && Number(row.productId) > 0
      && Number.isSafeInteger(Number(row.quantity)) && Number(row.quantity) > 0)
      .map((row) => ({ productId: Number(row.productId), quantity: Math.min(50, Number(row.quantity)) }));
  } catch {
    try { window.localStorage.removeItem(CART_KEY); } catch { /* Storage bị khóa: giỏ chỉ dùng tạm. */ }
    return [];
  }
}

function money(value) {
  return formatMoney(Number(value) || 0);
}

function normalizeSearchText(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLocaleLowerCase('vi').trim();
}

function wishlistStorageKey(customerId) {
  const id = Number(customerId);
  return Number.isSafeInteger(id) && id > 0 ? `emsystems.store.wishlist.v1.customer.${id}` : '';
}

function readWishlist(customerId) {
  const key = wishlistStorageKey(customerId);
  if (!key) return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) || '[]');
    return Array.isArray(parsed) ? [...new Set(parsed.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0))] : [];
  } catch { return []; }
}

async function paymentApiRequest(path, options = {}) {
  const response = await fetch(path, {
    method: options.method || 'GET',
    headers: { accept: 'application/json', ...(options.body ? { 'content-type': 'application/json' } : {}), ...(options.headers || {}) },
    body: options.body ? JSON.stringify(options.body) : undefined,
    cache: 'no-store',
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(result.error || 'Không xử lý được yêu cầu thanh toán sandbox.');
    error.status = response.status;
    error.missing = Array.isArray(result.missing) ? result.missing : [];
    throw error;
  }
  return result;
}

function paymentMethodLabel(method) {
  return ({ cash_on_delivery: 'COD · Thanh toán khi nhận hàng', momo_sandbox: 'MoMo Sandbox', vnpay_sandbox: 'VNPAY Sandbox', vietqr_transfer: 'Chuyển khoản ngân hàng · VietQR' })[method] || 'Chưa xác định';
}

function StoreFooter() {
  const [publicDetails, setPublicDetails] = useState(null);
  useEffect(() => {
    let active = true;
    dataRequest('/config/public').then((result) => { if (active) setPublicDetails(result); }).catch(() => { if (active) setPublicDetails(null); });
    return () => { active = false; };
  }, []);
  const legal = publicDetails?.legalBusiness || {};
  let officialBadgeUrl = '';
  try {
    const badgeUrl = new URL(legal.ecommerceBadgeUrl || '');
    if (badgeUrl.protocol === 'https:' && (badgeUrl.hostname === 'online.gov.vn' || badgeUrl.hostname.endsWith('.online.gov.vn'))) officialBadgeUrl = badgeUrl.href;
  } catch { /* No badge URL is safer than accepting an untrusted image host. */ }
  return (
    <footer className="store-footer">
      <div className="store-footer-servicebar" aria-label="Dịch vụ tại EMSystems">
        <Link to="/#shop" className="store-footer-service">
          <span className="store-footer-service-icon" aria-hidden="true"><i className="bi bi-patch-check" /></span>
          <span className="store-footer-service-copy"><strong>Thông tin rõ ràng</strong><small>Giá và tình trạng hàng theo danh mục</small></span>
          <i className="bi bi-chevron-right store-footer-service-arrow" aria-hidden="true" />
        </Link>
        <Link to="/#delivery-coverage" className="store-footer-service">
          <span className="store-footer-service-icon" aria-hidden="true"><i className="bi bi-truck" /></span>
          <span className="store-footer-service-copy"><strong>Giao hàng theo khu vực</strong><small>Xem phí và thời gian dự kiến</small></span>
          <i className="bi bi-chevron-right store-footer-service-arrow" aria-hidden="true" />
        </Link>
        <Link to="/track-order" className="store-footer-service">
          <span className="store-footer-service-icon" aria-hidden="true"><i className="bi bi-box-seam" /></span>
          <span className="store-footer-service-copy"><strong>Theo dõi đơn hàng</strong><small>Tra cứu bằng mã đơn và số điện thoại</small></span>
          <i className="bi bi-chevron-right store-footer-service-arrow" aria-hidden="true" />
        </Link>
        <Link to="/login" className="store-footer-service">
          <span className="store-footer-service-icon" aria-hidden="true"><i className="bi bi-person-check" /></span>
          <span className="store-footer-service-copy"><strong>Tài khoản khách hàng</strong><small>Quản lý tài khoản và thành viên</small></span>
          <i className="bi bi-chevron-right store-footer-service-arrow" aria-hidden="true" />
        </Link>
      </div>

      <div className="store-footer-main">
        <section className="store-footer-brand" aria-label="Giới thiệu EMSystems">
          <Link to="/" className="store-brand store-footer-brand-link">
            <img className="store-brand-logo" src={emsystemsLogo} alt="" />
            <span><strong>EMSystems</strong><small>TECH & ELECTRONICS</small></span>
          </Link>
          <p>Mua sắm thiết bị công nghệ với thông tin sản phẩm, giá bán và lựa chọn giao hàng được trình bày rõ ràng.</p>
          <div className="store-footer-brand-tags"><span><i className="bi bi-search" aria-hidden="true" /> Dễ tìm sản phẩm</span><span><i className="bi bi-receipt" aria-hidden="true" /> Dễ tra cứu đơn</span></div>
        </section>

        <nav className="store-footer-column" aria-label="Khám phá EMSystems">
          <h2>KHÁM PHÁ</h2>
          <Link to="/">Trang chủ</Link>
          <Link to="/#shop">Danh mục sản phẩm</Link>
          <Link to="/login">Tài khoản khách hàng</Link>
          <Link to="/register">Tạo tài khoản</Link>
        </nav>

        <nav className="store-footer-column" aria-label="Hỗ trợ mua hàng">
          <h2>HỖ TRỢ MUA HÀNG</h2>
          <Link to="/support">Trung tâm trợ giúp</Link>
          <Link to="/track-order">Tra cứu đơn hàng</Link>
          <Link to="/checkout">Mở trang thanh toán</Link>
          <Link to="/#delivery-coverage">Khu vực giao hàng</Link>
          <Link to="/member">Thẻ thành viên</Link>
        </nav>

        <section className="store-footer-payments" aria-label="Giao hàng và phương thức thanh toán">
          <h2>GIAO HÀNG & THANH TOÁN</h2>
          <p>Chọn khu vực nhận hàng để xem mức phí và thời gian giao dự kiến.</p>
          <Link className="store-footer-delivery-link" to="/#delivery-coverage">Xem khu vực hỗ trợ <i className="bi bi-arrow-up-right" aria-hidden="true" /></Link>
          <h3>PHƯƠNG THỨC THANH TOÁN</h3>
          <div className="store-footer-payment-badges" aria-label="COD, MoMo và VNPAY">
            <span><i className="bi bi-cash-coin" aria-hidden="true" /> COD</span>
            <span><i className="bi bi-wallet2" aria-hidden="true" /> MoMo</span>
            <span><i className="bi bi-qr-code" aria-hidden="true" /> VNPAY QR</span>
          </div>
          <p className="store-footer-payment-note"><i className="bi bi-shield-check" aria-hidden="true" /> MoMo/VNPAY hiện dùng môi trường sandbox; trạng thái thanh toán chỉ được xác nhận từ máy chủ.</p>
        </section>
      </div>

      <section className="store-footer-legal" aria-label="Thông tin chủ thể kinh doanh và chính sách">
        <div className="store-footer-legal-heading"><h2>THÔNG TIN CHỦ THỂ KINH DOANH</h2><span>{legal.operatorName ? legal.operatorName : 'Chưa khai báo chủ thể kinh doanh'}</span></div>
        <dl>
          <div><dt>Mã số thuế</dt><dd>{legal.taxCode || 'Chưa khai báo'}</dd></div>
          <div><dt>Đăng ký kinh doanh</dt><dd>{legal.businessRegistration || 'Chưa khai báo'}</dd></div>
          <div><dt>Ngày cấp / Cơ quan cấp</dt><dd>{[legal.businessRegistrationDate, legal.businessRegistrationIssuer].filter(Boolean).join(' · ') || 'Chưa khai báo'}</dd></div>
          <div><dt>Địa chỉ trụ sở</dt><dd>{legal.registeredAddress || 'Chưa khai báo'}</dd></div>
          <div><dt>Người đại diện / Chức danh</dt><dd>{[legal.representativeName, legal.representativeTitle].filter(Boolean).join(' · ') || 'Chưa khai báo'}</dd></div>
          <div><dt>Hotline</dt><dd>{legal.hotline || 'Chưa khai báo'}</dd></div>
          <div><dt>Email</dt><dd>{legal.email || 'Chưa khai báo'}</dd></div>
        </dl>
        <div className="store-footer-legal-links">
          <Link to="/legal/operating">Quy chế hoạt động</Link>
          <Link to="/legal/privacy">Bảo vệ dữ liệu cá nhân</Link>
          <Link to="/legal/returns">Đổi trả & hoàn tiền</Link>
          <Link to="/legal/shipping">Vận chuyển & kiểm hàng</Link>
        </div>
        {legal.ecommerceNoticeId && officialBadgeUrl
          ? <div className="store-footer-notice-reference"><span>Mã tiếp nhận thông báo website: {legal.ecommerceNoticeId}</span><a className="store-footer-moit-badge" href={officialBadgeUrl} target="_blank" rel="noreferrer"><img src={officialBadgeUrl} alt="Biểu trưng thông báo website với Bộ Công Thương" loading="lazy" referrerPolicy="no-referrer" /></a></div>
          : <p className="store-footer-notice-reference">Chưa khai báo mã tiếp nhận thông báo website TMĐT hoặc tài nguyên xác nhận. Không hiển thị biểu trưng chứng nhận giả.</p>}
      </section>

      <div className="store-footer-bottom">
        <div className="store-footer-bottom-copy">
          <strong>© {new Date().getFullYear()} EMSystems</strong>
          <span>Thông tin giao dịch, tồn kho và giao hàng cần được xác nhận theo trạng thái hệ thống.</span>
        </div>
        <div className="store-footer-bottom-links"><Link to="/">Trang chủ</Link><Link to="/track-order">Tra cứu đơn</Link><Link to="/login">Tài khoản</Link><Link to="/legal/operating">Quy chế hoạt động</Link></div>
      </div>
    </footer>
  );
}

function VnpayQrPanel({ paymentSession, qrDataUrl, paymentSyncStatus, qrError, amount }) {
  if (paymentSession?.provider !== 'vnpay') return null;

  return (
    <section className="store-vnpay-qr-panel" aria-labelledby="store-vnpay-qr-heading">
      <div className="store-vnpay-qr-copy">
        <span className="store-eyebrow">VNPAY · SANDBOX</span>
        <h3 id="store-vnpay-qr-heading">{paymentSession.qrMode === 'merchant-hosted-qr' ? 'Quét mã VNPAY để thanh toán' : 'Quét mã để mở trang thanh toán VNPAY'}</h3>
        <p>{paymentSession.qrMode === 'merchant-hosted-qr'
          ? 'Mã QR được tạo bởi API Merchant Hosted QR của VNPAY. Hệ thống vẫn chờ IPN có chữ ký hợp lệ trước khi xác nhận đơn.'
          : 'Tài khoản hiện chưa trả về QR Merchant Hosted từ VNPAY. Mã dự phòng này mở liên kết thanh toán đã ký; khi quét, điện thoại sẽ mở trang VNPAY để tiếp tục. Đây không phải QR chuyển khoản VietQR.'}</p>
        {paymentSession.qrMode !== 'merchant-hosted-qr' && paymentSession.qrMessage && <small className="store-vnpay-qr-fallback-note">{paymentSession.qrMessage}</small>}
        <strong className="store-vnpay-qr-amount">{money(amount)}</strong>
        <a className="store-button store-button-primary" href={paymentSession.paymentUrl} target="_blank" rel="noopener noreferrer">Mở cổng VNPAY trên thiết bị này <i className="bi bi-box-arrow-up-right" aria-hidden="true" /></a>
      </div>
      <div className="store-vnpay-qr-code">
        {paymentSyncStatus === 'paid' ? <div className="store-vnpay-qr-state is-paid"><i className="bi bi-check-circle-fill" aria-hidden="true" /><strong>Đã xác nhận thanh toán</strong></div>
          : paymentSyncStatus === 'failed' ? <div className="store-vnpay-qr-state is-failed"><i className="bi bi-x-circle-fill" aria-hidden="true" /><strong>Giao dịch thất bại hoặc bị hủy</strong></div>
            : qrDataUrl ? <img src={qrDataUrl} alt="Mã QR mở liên kết thanh toán VNPAY sandbox" />
              : <div className="store-vnpay-qr-placeholder" role="status">{qrError || 'Đang tạo mã QR…'}</div>}
        {paymentSyncStatus !== 'paid' && paymentSyncStatus !== 'failed' && <small>Đang chờ máy chủ xác minh kết quả thanh toán.</small>}
      </div>
    </section>
  );
}

function VietQrTransferPanel({ paymentSession, amount }) {
  const [copyStatus, setCopyStatus] = useState('');
  if (paymentSession?.provider !== 'vietqr' || paymentSession.qrMode !== 'bank-transfer-vietqr') return null;
  const bank = paymentSession.bank || {};

  async function copyTransferContent() {
    try {
      await navigator.clipboard.writeText(paymentSession.transferContent || '');
      setCopyStatus('Đã sao chép nội dung chuyển khoản.');
    } catch {
      setCopyStatus('Không thể tự sao chép trên trình duyệt này. Hãy chọn và sao chép nội dung bên trên.');
    }
  }

  return (
    <section className="store-vnpay-qr-panel store-vietqr-transfer-panel" aria-labelledby="store-vietqr-heading">
      <div className="store-vnpay-qr-copy">
        <span className="store-eyebrow">CHUYỂN KHOẢN NGÂN HÀNG · VIETQR</span>
        <h3 id="store-vietqr-heading">Quét mã để chuyển khoản đúng đơn hàng</h3>
        <p>Mã QR đã điền sẵn tài khoản nhận, số tiền và nội dung chuyển khoản. Mở ứng dụng ngân hàng, quét mã rồi kiểm tra lại thông tin trước khi xác nhận.</p>
        <strong className="store-vnpay-qr-amount">{money(amount)}</strong>
        <div className="store-vietqr-transfer-details">
          <div><span>Ngân hàng</span><strong>{bank.bankName ? `${bank.bankName} (${bank.bankCode || 'VietQR'})` : bank.bankCode || '—'}</strong></div>
          <div><span>Số tài khoản nhận</span><strong>{bank.accountNumber || '—'}</strong></div>
          <div><span>Chủ tài khoản</span><strong>{bank.accountName || '—'}</strong></div>
          <div className="store-vietqr-transfer-memo"><span>Nội dung chuyển khoản bắt buộc</span><strong>{paymentSession.transferContent || '—'}</strong><button type="button" className="store-button store-button-light" onClick={copyTransferContent}>Sao chép nội dung</button></div>
        </div>
        {copyStatus && <small role="status">{copyStatus}</small>}
        <small className="store-vietqr-transfer-warning">Đơn vẫn ở trạng thái chờ xác nhận. VietQR chỉ tạo lệnh chuyển khoản; hệ thống chưa tự đối soát biến động số dư ngân hàng.</small>
      </div>
      <div className="store-vnpay-qr-code store-vietqr-image-wrap">
        {paymentSession.qrImageUrl ? <img src={paymentSession.qrImageUrl} alt={`VietQR chuyển ${money(amount)} với nội dung ${paymentSession.transferContent || ''}`} /> : <div className="store-vnpay-qr-placeholder" role="status">Không có ảnh QR. Kiểm tra cấu hình tài khoản VietQR.</div>}
        <small>Chỉ chuyển đúng số tiền và giữ nguyên nội dung trên mã.</small>
      </div>
    </section>
  );
}

function shippingStatusLabel(status) {
  return ({
    pending_confirmation: 'Chờ cửa hàng xác nhận',
    confirmed: 'Đã xác nhận',
    preparing: 'Đang chuẩn bị hàng',
    shipping: 'Đang giao hàng',
    delivered: 'Đã giao thành công',
    cancelled: 'Đã hủy',
  })[status] || status || 'Chưa rõ';
}

function paymentStatusLabel(status) {
  return ({
    pending: 'Đang chờ xác nhận',
    pending_payment: 'Chờ thanh toán',
    processing: 'Đang xử lý',
    paid: 'Đã thanh toán',
    completed: 'Đã thanh toán',
    expired: 'Hết hạn chờ thanh toán',
    paid_after_cancellation: 'Đã nhận tiền sau khi hủy · cần đối soát',
    failed: 'Thanh toán thất bại',
    cancelled: 'Đã hủy thanh toán',
    refunded: 'Đã hoàn tiền',
    partially_refunded: 'Đã hoàn một phần',
  })[status] || 'Chưa xác định';
}

const STORE_CATEGORIES = Object.freeze([
  { value: 'smartphones', label: 'Điện thoại', icon: 'phone' },
  { value: 'computers', label: 'Laptop & Máy tính', icon: 'laptop' },
  { value: 'tablets', label: 'Máy tính bảng', icon: 'tablet' },
  { value: 'accessories', label: 'Phụ kiện điện tử', icon: 'headphones' },
]);
const STORE_CATEGORY_LABELS = Object.freeze(Object.fromEntries(STORE_CATEGORIES.map(({ value, label }) => [value, label])));

function productSlug(name) {
  return String(name || 'san-pham')
    .replace(/[đĐ]/g, 'd')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('en')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'san-pham';
}

function productPath(product) {
  return `/san-pham/${productSlug(product?.name)}/${Number(product?.id)}`;
}

function getStoreCategoryKey(product, apiCategory = '') {
  const categoryId = Number(product?.categoryId);
  if (categoryId === 1) return 'smartphones';
  if (categoryId === 2) return 'computers';
  if (categoryId === 3) return 'accessories';
  if (categoryId === 4) return 'tablets';
  const slug = String(apiCategory || product?.externalCategory || '').trim().toLowerCase();
  if (slug === 'smartphones') return 'smartphones';
  if (slug === 'laptops' || slug === 'computers') return 'computers';
  if (slug === 'tablets') return 'tablets';
  if (slug === 'mobile-accessories' || slug === 'computer-accessories') return 'accessories';
  const name = String(product?.categoryName || '').trim().toLocaleLowerCase('vi');
  if (name.includes('điện thoại')) return 'smartphones';
  if (name.includes('máy tính bảng') || name.includes('tablet')) return 'tablets';
  if (name.includes('máy tính') || name.includes('laptop')) return 'computers';
  if (name.includes('phụ kiện')) return 'accessories';
  return 'accessories';
}

function WarrantyModal({ isOpen, onClose }) {
  const [keyword, setKeyword] = useState('');
  const [warranties, setWarranties] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  async function handleCheck(e) {
    e.preventDefault();
    if (!keyword.trim()) return;
    setLoading(true);
    setError('');
    setWarranties(null);
    try {
      const res = await dataRequest(`/store/warranty/check?keyword=${encodeURIComponent(keyword.trim())}`);
      setWarranties(res.data || []);
      if (!res.data || !res.data.length) setError('Không tìm thấy thông tin bảo hành khớp với từ khóa.');
    } catch (err) {
      setError(err.message || 'Không thể tra cứu bảo hành.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose} style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: '12px', width: '500px', maxWidth: '92vw', maxHeight: '85vh', overflowY: 'auto', padding: '24px', boxShadow: '0 10px 30px rgba(0,0,0,0.3)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px', color: '#1e293b' }}>
            <i className="bi bi-shield-check" style={{ color: '#2563eb' }} /> Tra cứu bảo hành điện tử
          </h3>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '24px', cursor: 'pointer', color: '#666', lineHeight: 1 }}>&times;</button>
        </div>
        <p style={{ margin: '0 0 16px', fontSize: '13px', color: '#64748b' }}>
          Nhập số điện thoại mua hàng hoặc mã bảo hành (ví dụ: WAR-00001) để kiểm tra thời hạn và quyền lợi bảo hành.
        </p>
        <form onSubmit={handleCheck} style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
          <input
            type="text"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="0905 123 456 hoặc WAR-00001"
            style={{ flex: 1, padding: '10px 12px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '14px' }}
            required
          />
          <button type="submit" className="button button-primary" disabled={loading} style={{ padding: '10px 16px' }}>
            {loading ? 'Đang tìm…' : 'Tra cứu'}
          </button>
        </form>
        {error && <div className="notice notice-error" style={{ marginBottom: '16px' }}>{error}</div>}
        {warranties && warranties.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {warranties.map((item) => (
              <div key={item.id} style={{ border: '1px solid #e2e8f0', borderRadius: '8px', padding: '14px', background: '#f8fafc' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                  <span style={{ fontWeight: 'bold', color: '#1e293b' }}>{item.productName}</span>
                  <span style={{
                    padding: '2px 8px', borderRadius: '12px', fontSize: '12px', fontWeight: 'bold',
                    background: item.status === 'active' ? '#dcfce7' : '#fee2e2',
                    color: item.status === 'active' ? '#15803d' : '#b91c1c'
                  }}>
                    {item.status === 'active' ? `Còn ${item.daysRemaining} ngày` : 'Hết hạn'}
                  </span>
                </div>
                <div style={{ fontSize: '13px', color: '#475569', lineHeight: '1.6' }}>
                  <div>Mã BH: <code>{item.code}</code> · Khách: {item.customerName}</div>
                  <div>Thời hạn: {item.startDate} đến {item.endDate}</div>
                  <div>Nơi tiếp nhận: {item.branchName}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StoreHeader({ cartCount, user, authReady = true, onLogout = () => {}, workspacePath = '/', roleLabel = '', member, onShowMember, search = '', onSearch = () => {}, onSearchSubmit = () => {}, category = 'all', onCategoryChange = () => {}, showCategories = true, showSearch = true }) {
  const [showNotif, setShowNotif] = useState(false);
  const [showWarrantyModal, setShowWarrantyModal] = useState(false);
  const categoryLinks = [{ label: 'Tất cả sản phẩm', value: 'all', icon: 'grid' }, ...STORE_CATEGORIES];
  const accountName = String(user?.fullName || user?.username || member?.fullName || '').trim();

  return (
    <div className="store-header-shell">
      <div className="store-utility-bar"><span><i className="bi bi-truck" aria-hidden="true" /> Giao hàng theo khu vực hỗ trợ</span><span><i className="bi bi-shield-check" aria-hidden="true" /> Giá bán và tồn kho được cửa hàng xác nhận</span></div>
      <header className={`store-header${showSearch ? '' : ' store-header-no-search'}`}>
        <Link to="/" className="store-brand">
          <img className="store-brand-logo" src={emsystemsLogo} alt="" />
          <span><strong>EMSystems</strong><small>TECH & ELECTRONICS</small></span>
        </Link>
        {showSearch && <form className="store-header-search" role="search" onSubmit={(event) => { event.preventDefault(); onSearchSubmit(search); }}><i className="bi bi-search" aria-hidden="true" /><input type="search" value={search} onChange={(event) => onSearch(event.target.value)} placeholder="Bạn tìm điện thoại, laptop hay phụ kiện?" aria-label="Tìm sản phẩm trong cửa hàng" /><button type="submit" aria-label="Tìm kiếm"><i className="bi bi-arrow-right" aria-hidden="true" /></button></form>}
        <div className="store-header-actions">
          <div style={{ position: 'relative' }}>
            <button
              type="button"
              className="store-member-button"
              onClick={() => setShowNotif(!showNotif)}
              aria-label="Thông báo, 3 mục mới"
              style={{ padding: '8px 12px', position: 'relative', display: 'flex', alignItems: 'center', gap: '6px' }}
            >
              <i className="bi bi-bell" style={{ fontSize: '18px' }} />
              <span style={{
                position: 'absolute', top: '-4px', right: '-4px',
                background: '#ef4444', color: '#fff', fontSize: '11px', fontWeight: 'bold',
                width: '18px', height: '18px', borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center'
              }}>3</span>
            </button>
            {showNotif && (
              <div style={{
                position: 'absolute', right: 0, top: '100%', marginTop: '8px',
                width: '320px', background: '#fff', borderRadius: '10px',
                boxShadow: '0 8px 30px rgba(0,0,0,0.18)', border: '1px solid #e2e8f0',
                zIndex: 1000, overflow: 'hidden', textAlign: 'left', color: '#1e293b'
              }}>
                <div style={{ padding: '12px 16px', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f8fafc' }}>
                  <strong style={{ fontSize: '14px' }}>Thông báo cửa hàng</strong>
                  <span style={{ fontSize: '11px', color: '#64748b' }}>Demo học tập</span>
                </div>
                <div style={{ maxHeight: '280px', overflowY: 'auto' }}>
                  <div style={{ padding: '12px 16px', borderBottom: '1px solid #f1f5f9' }}>
                    <div style={{ fontWeight: 'bold', fontSize: '13px', color: '#2563eb' }}>🎉 Ưu đãi thành viên EM Club</div>
                    <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#475569' }}>Nhận đến 2% điểm tích lũy cho mọi đơn hàng điện thoại & phụ kiện.</p>
                    <small style={{ color: '#94a3b8', fontSize: '11px' }}>Vừa xong</small>
                  </div>
                  <div style={{ padding: '12px 16px', borderBottom: '1px solid #f1f5f9' }}>
                    <div style={{ fontWeight: 'bold', fontSize: '13px', color: '#16a34a' }}>🛡️ Tra cứu bảo hành điện tử</div>
                    <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#475569' }}>Bảo hành chính hãng 12 tháng tại các chi nhánh toàn quốc.</p>
                    <small style={{ color: '#94a3b8', fontSize: '11px' }}>Hôm nay</small>
                  </div>
                  <div style={{ padding: '12px 16px' }}>
                    <div style={{ fontWeight: 'bold', fontSize: '13px', color: '#ea580c' }}>🚀 Giao hàng siêu tốc 2H</div>
                    <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#475569' }}>Giao hàng nhanh chóng theo khoảng cách chi nhánh gần nhất.</p>
                    <small style={{ color: '#94a3b8', fontSize: '11px' }}>Hôm qua</small>
                  </div>
                </div>
              </div>
            )}
          </div>
          {!authReady ? <span className="store-account-loading" role="status">Đang kiểm tra tài khoản…</span> : user ? <div className="store-authenticated-actions">
            {user.role === 'customer' ? <button type="button" className="store-member-button store-header-account" onClick={onShowMember} aria-label={`Tài khoản ${accountName || 'khách hàng'}`}>
              <span className="store-header-account-avatar" aria-hidden="true">{(accountName || 'K').slice(0, 1).toUpperCase()}</span>
              <span className="store-header-account-copy"><strong>{accountName || 'Tài khoản'}</strong><small>{member ? 'EM Club · Thành viên' : 'Tài khoản khách hàng'}</small></span>
            </button> : <Link to={workspacePath} className="store-member-button store-header-account" aria-label={`Tài khoản ${accountName || 'nhân viên'}`}>
              <span className="store-header-account-avatar" aria-hidden="true">{(accountName || 'U').slice(0, 1).toUpperCase()}</span>
              <span className="store-header-account-copy"><strong>{accountName || 'Tài khoản'}</strong><small>{roleLabel || 'Đã đăng nhập'}</small></span>
            </Link>}
            <button type="button" className="store-account-logout" aria-label="Đăng xuất" onClick={onLogout}><i className="bi bi-box-arrow-right" aria-hidden="true" /><span>Đăng xuất</span></button>
          </div> : <Link to="/login" className="store-member-button store-auth-login">
            <i className="bi bi-box-arrow-in-right" aria-hidden="true" /><span>Đăng nhập</span>
          </Link>}
          <Link to="/checkout" className="store-cart-button"><i className="bi bi-cart3" aria-hidden="true" /><span>Giỏ hàng</span><b>{cartCount}</b></Link>
        </div>
      </header>
      <nav className="store-category-nav" aria-label="Danh mục sản phẩm">
        {showCategories && <>{categoryLinks.map((item) => <button type="button" key={item.value} className={category === item.value ? 'selected' : ''} onClick={() => { onCategoryChange(item.value); document.getElementById('shop')?.scrollIntoView({ behavior: 'smooth' }); }}><i className={`bi bi-${item.icon}`} aria-hidden="true" /><span>{item.label}</span></button>)}
          <a href="/#benefits"><i className="bi bi-lightning-charge" aria-hidden="true" /><span>Ưu đãi</span></a></>}
        <Link to="/track-order"><i className="bi bi-box-seam" aria-hidden="true" /><span>Tra cứu đơn</span></Link>
        <button type="button" onClick={() => setShowWarrantyModal(true)} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', color: 'inherit', font: 'inherit' }}>
          <i className="bi bi-shield-check" aria-hidden="true" />
          <span>Tra cứu bảo hành</span>
        </button>
      </nav>
      <WarrantyModal isOpen={showWarrantyModal} onClose={() => setShowWarrantyModal(false)} />
    </div>
  );
}

function StoreNetworkStatus() {
  const [networkState, setNetworkState] = useState(() => typeof navigator === 'undefined' || navigator.onLine ? 'online' : 'offline');
  useEffect(() => {
    const onOffline = () => setNetworkState('offline');
    const onOnline = () => setNetworkState('restored');
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);
    return () => {
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
    };
  }, []);
  if (networkState === 'online') return null;
  const offline = networkState === 'offline';
  return <div className={'store-network-status' + (offline ? ' is-offline' : ' is-restored')} role={offline ? 'alert' : 'status'}>
    <i className={'bi ' + (offline ? 'bi-wifi-off' : 'bi-wifi')} aria-hidden="true" />
    <span>{offline
      ? 'Kết nối mạng đang gián đoạn. Không đặt lại đơn và không thanh toán lần hai khi chưa kiểm tra giao dịch cũ. Khi mạng ổn định, mở Tra cứu đơn để khôi phục hướng dẫn.'
      : 'Kết nối mạng đã trở lại. Hãy tải lại trang hoặc tra cứu đơn trước khi tiếp tục thanh toán.'}</span>
    {!offline && <button type="button" onClick={() => window.location.reload()}>Tải lại trang</button>}
  </div>;
}

function MemberPanel({ member, onClose, onMemberChange }) {
  const [orders, setOrders] = useState([]);

  useEffect(() => {
    if (!member) return;
    dataRequest('/store/member/orders').then((result) => setOrders(result.data || [])).catch(() => setOrders([]));
  }, [member?.id]);

  async function logout() {
    // Tài khoản khách dùng chung phiên đăng nhập EMSystems; phải kết thúc cả phiên tài khoản lẫn phiên EM Club.
    try { await dataRequest('/auth/logout', { method: 'POST' }); }
    finally {
      onMemberChange(null);
      window.location.reload();
    }
  }

  return (
    <div className="store-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="store-member-modal" role="dialog" aria-modal="true" aria-labelledby="member-title">
        <button className="store-modal-close" type="button" onClick={onClose} aria-label="Đóng"><i className="bi bi-x-lg" aria-hidden="true" /></button>
        <span className="store-eyebrow">EM CLUB · THẺ THÀNH VIÊN</span>
        <h2 id="member-title">{member ? 'Quyền lợi thành viên' : 'Đăng nhập thành viên'}</h2>
        <p className="store-muted">Tích điểm đổi ưu đãi, lưu lịch sử mua hàng và sử dụng mã dành riêng cho thành viên.</p>
        {!member && <div className="store-demo-warning">Thẻ EM Club sử dụng tài khoản EMSystems đã xác thực bằng mật khẩu. Đăng nhập chỉ bằng số điện thoại đã bị vô hiệu hóa.</div>}
        {member ? <>
          <div className="store-member-card">
            <div className="store-member-card-top"><span>EM CLUB</span><strong>{member.memberTier || 'Đồng'}</strong></div>
            <strong className="store-member-name">{member.fullName}</strong>
            <span>{member.phone}</span>
            <div className="store-points"><strong>{Number(member.loyaltyPoints || 0).toLocaleString('vi-VN')}</strong><span>điểm khả dụng</span></div>
            <small>Quy đổi demo: 100 điểm = 10.000đ. Điểm mới cộng sau khi giao hàng thành công.</small>
          </div>
          <div className="store-member-actions"><button className="store-button store-button-secondary" type="button" onClick={logout}>Đăng xuất thành viên</button><button className="store-button store-button-primary" type="button" onClick={onClose}>Tiếp tục mua sắm</button></div>
          <section className="store-member-orders"><h3>Lịch sử đơn giao hàng</h3>
            {!orders.length ? <p className="store-muted">Chưa có đơn hàng online gắn với thẻ thành viên.</p> : orders.map((order) => <div className="store-order-mini" key={order.id}><span><strong>{order.invoiceNo}</strong><small>{new Date(order.createdAt).toLocaleString('vi-VN')}</small></span><span><b>{money(order.totalAmount)}</b><small>{shippingStatusLabel(order.status)}</small></span></div>)}
          </section>
        </> : <div className="store-form">
          <Link className="store-button store-button-primary store-button-wide" to="/login" onClick={onClose}>Đăng nhập bằng tài khoản EMSystems</Link>
          <Link className="store-button store-button-secondary store-button-wide" to="/register" onClick={onClose}>Tạo tài khoản EMSystems</Link>
        </div>}
      </section>
    </div>
  );
}

// Full product page for shareable URLs. The catalogue keeps its quick-view modal,
// while direct product links render a complete commerce layout with recommendations.
function StoreProductPage({
  product, products, selectedArea, shippingFee, shippingEta, locationCoordinates,
  locationStatus, isLocating, areas, locateDeliveryArea, stockAtBranch, quantityInCart,
  onSelectDeliveryArea, updateCart, buyNow, wishlistIds, toggleWishlist, shareProduct, member, memberLoaded, reviewForm,
  setReviewForm, reviewBusy, submitProductReview, reviewStatus,
}) {
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);
  const [failedImages, setFailedImages] = useState([]);
  const [zoomOpen, setZoomOpen] = useState(false);
  const images = [...new Set([product.thumbnail, product.imageUrl, ...(product.images || [])]
    .filter((image) => typeof image === 'string' && image.trim()))].slice(0, 12);
  const nextImageIndex = images.findIndex((image, index) => index >= selectedImageIndex && !failedImages.includes(image));
  const activeImageIndex = nextImageIndex >= 0 ? nextImageIndex : images.findIndex((image) => !failedImages.includes(image));
  const activeImage = activeImageIndex >= 0 ? images[activeImageIndex] : '';
  const sameCategoryProducts = products.filter((item) => item.id !== product.id && item.storeCategoryKey === product.storeCategoryKey).slice(0, 8);
  const otherProducts = products.filter((item) => item.id !== product.id && item.storeCategoryKey !== product.storeCategoryKey).slice(0, 8);
  const specs = [
    ['Mã sản phẩm', product.sku || 'Chưa gán mã'],
    ['Thương hiệu', product.brandName || 'Chưa xác định'],
    ['Danh mục', product.categoryName || 'Chưa phân loại'],
    ['Bảo hành', Number(product.warrantyMonths) > 0 ? `${product.warrantyMonths} tháng` : 'Theo chính sách cửa hàng'],
    ['Kho giao hàng', selectedArea ? `${selectedArea.district}, ${selectedArea.city}` : 'Chưa chọn khu vực'],
    ['Tồn kho khu vực', `${stockAtBranch} sản phẩm`],
    ...(product.weight != null ? [['Khối lượng tham khảo', `${product.weight} kg`]] : []),
    ...(product.dimensions && ['width', 'height', 'depth'].some((key) => product.dimensions[key] != null)
      ? [['Kích thước tham khảo', ['width', 'height', 'depth'].filter((key) => product.dimensions[key] != null).map((key) => `${key}: ${product.dimensions[key]} cm`).join(' · ')]]
      : []),
  ];

  useEffect(() => {
    setSelectedImageIndex(0);
    setFailedImages([]);
    setZoomOpen(false);
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, [product.id]);

  function renderRecommendations(items) {
    return items.map((item) => {
      const image = item.thumbnail || item.imageUrl || item.images?.[0] || '';
      return <Link className="store-page-recommendation-card" to={productPath(item)} key={item.id}>
        <span className="store-page-recommendation-image"><i className={`bi ${item.storeCategoryKey === 'smartphones' ? 'bi-phone' : item.storeCategoryKey === 'computers' ? 'bi-laptop' : item.storeCategoryKey === 'tablets' ? 'bi-tablet' : 'bi-box-seam'}`} aria-hidden="true" />{image && <img src={image} alt={item.name} loading="lazy" onLoad={(event) => { event.currentTarget.dataset.loaded = 'true'; }} onError={(event) => { event.currentTarget.style.display = 'none'; }} />}</span>
        <span className="store-page-recommendation-category">{item.categoryName || 'Thiết bị điện tử'}</span>
        <strong>{item.name}</strong>
        <span className="store-page-recommendation-stock">{Number(item.availableStock) > 0 ? 'Có thể đặt hàng' : 'Cần kiểm tra tồn kho'}</span>
        <b>{money(item.sellingPrice)}</b>
      </Link>;
    });
  }

  return <div className="store-product-page-shell">
    <main className="store-product-page">
      <nav className="store-product-breadcrumb" aria-label="Đường dẫn">
        <Link to="/">Trang chủ</Link><i className="bi bi-chevron-right" aria-hidden="true" />
        <Link to="/#shop">Sản phẩm</Link><i className="bi bi-chevron-right" aria-hidden="true" />
        <span>{product.name}</span>
      </nav>

      <section className="store-product-page-hero" aria-labelledby="store-product-page-title">
        <div className="store-product-page-gallery">
          <div className="store-product-page-main-image">
            <span className="store-product-page-image-fallback" aria-hidden="true"><i className="bi bi-box-seam" /></span>
            {activeImage && <img src={activeImage} alt={product.name} onError={() => setFailedImages((current) => current.includes(activeImage) ? current : [...current, activeImage])} />}
            {activeImage && <button type="button" className="store-image-zoom-button" onClick={() => setZoomOpen(true)}><i className="bi bi-arrows-fullscreen" aria-hidden="true" /> Xem ảnh lớn</button>}
          </div>
          {images.length > 1 && <div className="store-product-page-thumbnails" aria-label="Ảnh sản phẩm">
            {images.map((image, index) => <button type="button" key={image} className={`${index === activeImageIndex ? 'selected ' : ''}${failedImages.includes(image) ? 'image-failed' : ''}`} aria-label={`Xem ảnh ${index + 1} của ${product.name}`} aria-pressed={index === activeImageIndex} onClick={() => setSelectedImageIndex(index)}>
              <span className="store-product-page-thumbnail-fallback" aria-hidden="true"><i className="bi bi-image" /></span>
              <img src={image} alt="" loading="lazy" onError={() => setFailedImages((current) => current.includes(image) ? current : [...current, image])} />
            </button>)}
          </div>}
          <p className="store-product-page-gallery-note"><i className="bi bi-images" aria-hidden="true" /> {activeImage ? `${images.length} ảnh tham khảo của sản phẩm` : 'Nguồn ảnh hiện không phản hồi; thử lại sau'}</p>
        </div>

        <div className="store-product-page-summary">
          <div className="store-product-page-category"><span>{product.categoryName || 'Thiết bị điện tử'}</span><span>{product.brandName || 'Thương hiệu đang cập nhật'}</span></div>
          <h1 id="store-product-page-title">{product.name}</h1>
          <p className="store-product-page-sku">Mã sản phẩm: <strong>{product.sku || 'Chưa gán mã'}</strong></p>
          <div className="store-product-page-rating"><i className="bi bi-star-fill" aria-hidden="true" /><strong>{product.reviewCount ? Number(product.rating).toFixed(1) + ' / 5' : 'Chưa có đánh giá'}</strong><span>{product.reviewCount ? `${product.reviewCount} đánh giá đã xác minh` : 'Đánh giá chỉ hiển thị sau khi đơn đủ điều kiện'}</span></div>
          <div className="store-product-page-price"><span>Giá bán tại EMSystems</span><strong>{money(product.sellingPrice)}</strong><small>Giá và tồn kho lấy từ danh mục nội bộ của cửa hàng.</small></div>

          <div className="store-product-page-highlights">
            <div><i className="bi bi-shield-check" aria-hidden="true" /><span><strong>Thông tin minh bạch</strong><small>Mã hàng, giá và chính sách hiển thị riêng</small></span></div>
            <div><i className="bi bi-box-seam" aria-hidden="true" /><span><strong>{stockAtBranch > quantityInCart ? 'Có thể đặt hàng' : stockAtBranch > 0 ? 'Đã đạt số lượng tối đa trong giỏ' : 'Cần xác nhận tồn kho'}</strong><small>{stockAtBranch} sản phẩm tại khu vực giao đã chọn</small></span></div>
            <div><i className="bi bi-truck" aria-hidden="true" /><span><strong>Giao hàng theo khu vực</strong><small>{selectedArea ? `${selectedArea.district}, ${selectedArea.city} · ${shippingEta}` : 'Chọn khu vực để xem phí dự kiến'}</small></span></div>
          </div>
          <div className="store-product-page-delivery"><label htmlFor="product-page-delivery-area">Khu vực nhận hàng</label><div className="store-product-page-delivery-controls"><select id="product-page-delivery-area" value={selectedArea?.id || ''} onChange={(event) => { const area = areas.find((item) => item.id === Number(event.target.value)); if (area) window.dispatchEvent(new CustomEvent('emsystems:select-delivery-area', { detail: area })); }}>
              {areas.map((area) => <option key={area.id} value={area.id}>{area.district}, {area.city}</option>)}
            </select><button type="button" className="store-location-button" onClick={locateDeliveryArea} disabled={isLocating || !areas.length}><i className={`bi ${isLocating ? 'bi-hourglass-split' : 'bi-geo-alt'}`} aria-hidden="true" />{isLocating ? 'Đang định vị…' : 'Vị trí của tôi'}</button></div>
            <div className="store-product-page-shipping-quote"><span>Phí giao dự kiến</span><strong>{money(shippingFee)}</strong><span>Thời gian dự kiến</span><strong>{shippingEta}</strong></div>
            {locationStatus && <p role="status">{locationStatus}</p>}
            <small>{locationCoordinates ? 'Ước tính theo vị trí hiện tại.' : 'Phí và thời gian chỉ là thông tin demo theo khu vực.'}</small>
          </div>

          <div className="store-product-page-actions">
            <button type="button" className="store-button store-button-secondary" disabled={!memberLoaded} aria-pressed={wishlistIds.includes(product.id)} onClick={() => toggleWishlist(product.id)} title={!memberLoaded ? 'Đang kiểm tra tài khoản' : !member ? 'Đăng nhập để lưu sản phẩm yêu thích' : undefined}><i className={`bi ${wishlistIds.includes(product.id) ? 'bi-heart-fill' : 'bi-heart'}`} aria-hidden="true" /> {wishlistIds.includes(product.id) ? 'Đã lưu yêu thích' : 'Yêu thích'}</button>
            <button type="button" className="store-button store-button-secondary" onClick={() => shareProduct(product)}><i className="bi bi-share" aria-hidden="true" /> Chia sẻ</button>
            <button type="button" className="store-button store-button-secondary" disabled={stockAtBranch <= quantityInCart} onClick={() => updateCart(product.id, 1, stockAtBranch)}><i className="bi bi-cart-plus" aria-hidden="true" /> Thêm vào giỏ</button>
            <button type="button" className="store-button store-button-primary store-product-page-buy" disabled={stockAtBranch <= quantityInCart} onClick={() => buyNow(product, stockAtBranch)}>Mua ngay <i className="bi bi-arrow-right" aria-hidden="true" /></button>
          </div>
        </div>
      </section>

      {(sameCategoryProducts.length > 0 || otherProducts.length > 0) && <section className="store-product-page-recommendations" aria-label="Sản phẩm đề xuất">
        <div className="store-product-page-section-heading"><div><span className="store-eyebrow">KHÁM PHÁ THÊM</span><h2>Sản phẩm có thể bạn quan tâm</h2><p>Các sản phẩm dưới đây đều lấy từ danh mục EMSystems đã có giá bán nội bộ.</p></div><Link to="/#shop">Xem toàn bộ sản phẩm <i className="bi bi-arrow-up-right" aria-hidden="true" /></Link></div>
        {sameCategoryProducts.length > 0 && <div className="store-product-page-recommendation-group"><h3>Cùng danh mục: {product.categoryName || 'Thiết bị điện tử'}</h3><div className="store-page-recommendations-grid">{renderRecommendations(sameCategoryProducts)}</div></div>}
        {otherProducts.length > 0 && <div className="store-product-page-recommendation-group"><h3>Có thể bạn cũng thích</h3><div className="store-page-recommendations-grid">{renderRecommendations(otherProducts)}</div></div>}
      </section>}

      <section className="store-product-page-information" aria-label="Thông tin chi tiết sản phẩm">
        <article className="store-product-page-info-card store-product-page-description"><span className="store-eyebrow">PRODUCT DETAILS</span><h2>Mô tả sản phẩm</h2><p>{product.description?.trim() || 'Cửa hàng chưa cập nhật mô tả chi tiết cho sản phẩm này.'}</p>{product.tags?.length > 0 && <div className="store-product-tags">{product.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>}</article>
        <article className="store-product-page-info-card"><span className="store-eyebrow">SPECIFICATIONS</span><h2>Thông số sản phẩm</h2><dl className="store-product-spec-grid">{specs.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>{String(product.technicalDetails || '').trim() && <p className="store-product-page-extra-specs">{product.technicalDetails}</p>}</article>
        <article className="store-product-page-info-card"><span className="store-eyebrow">SERVICE & POLICY</span><h2>Bảo hành, giao hàng và đổi trả</h2><dl className="store-product-custom-specs"><div><dt>Bảo hành</dt><dd>{product.warrantyInformation || (Number(product.warrantyMonths) > 0 ? `${product.warrantyMonths} tháng theo hồ sơ sản phẩm` : 'Chưa có chính sách bảo hành riêng được cấu hình.')}</dd></div><div><dt>Giao hàng</dt><dd>{product.shippingInformation || 'Phí giao và thời gian dự kiến được tính theo khu vực. Cửa hàng cần xác nhận trước khi giao.'}</dd></div><div><dt>Đổi trả</dt><dd>{product.returnPolicy || 'Chưa cấu hình chính sách đổi trả riêng; vui lòng xác nhận điều kiện với cửa hàng trước khi mua.'}</dd></div></dl></article>
        <article className="store-product-page-info-card store-product-page-reviews"><span className="store-eyebrow">CUSTOMER REVIEWS</span><h2>Đánh giá khách hàng</h2><p>{product.reviewCount ? `${product.reviewCount} đánh giá đã xác minh · ${Number(product.rating).toFixed(1)} / 5` : 'Chưa có đánh giá đã xác minh cho sản phẩm này.'}</p>
          {(product.reviews || []).filter((review) => review.verifiedPurchase).map((review) => <article className="store-verified-review" key={review.id}><div><strong>{review.reviewerName}</strong><span>{'★'.repeat(Math.max(0, Math.min(5, Number(review.rating) || 0)))}{'☆'.repeat(5 - Math.max(0, Math.min(5, Number(review.rating) || 0)))}</span><time dateTime={review.createdAt}>{new Date(review.createdAt).toLocaleDateString('vi-VN')}</time></div><h4>{review.title}</h4><p>{review.body}</p><small><i className="bi bi-patch-check-fill" aria-hidden="true" /> Đã xác minh đơn mua</small></article>)}
          {member ? <form className="store-review-form" onSubmit={(event) => submitProductReview(event, product)}><h4>Viết đánh giá</h4><p>Chỉ tài khoản có đơn chứa sản phẩm này đã giao thành công mới đủ điều kiện gửi đánh giá.</p><label><span>Số sao</span><select required value={reviewForm.rating} onChange={(event) => setReviewForm((current) => ({ ...current, rating: Number(event.target.value) }))}><option value={5}>5 sao — Rất tốt</option><option value={4}>4 sao — Tốt</option><option value={3}>3 sao — Bình thường</option><option value={2}>2 sao — Chưa tốt</option><option value={1}>1 sao — Không hài lòng</option></select></label><label><span>Tiêu đề</span><input required minLength={3} maxLength={120} value={reviewForm.title} onChange={(event) => setReviewForm((current) => ({ ...current, title: event.target.value }))} placeholder="Điểm nổi bật của sản phẩm" /></label><label><span>Nội dung</span><textarea required minLength={10} maxLength={2000} rows={3} value={reviewForm.body} onChange={(event) => setReviewForm((current) => ({ ...current, body: event.target.value }))} placeholder="Chia sẻ trải nghiệm sử dụng thực tế của bạn" /></label><button type="submit" className="store-button store-button-primary" disabled={reviewBusy}>{reviewBusy ? 'Đang gửi…' : 'Gửi đánh giá'}</button></form> : <p className="store-review-signin">Đăng nhập để gửi đánh giá sau khi đơn hàng đã giao thành công. <Link to="/login">Đăng nhập</Link></p>}
          {reviewStatus && <p role="status" className="store-location-status">{reviewStatus}</p>}
        </article>
      </section>
      <div className="store-product-page-return"><Link to="/#shop"><i className="bi bi-arrow-left" aria-hidden="true" /> Quay lại danh mục sản phẩm</Link></div>
    </main>
    <StoreFooter />
    {zoomOpen && <div className="store-image-zoom-backdrop" role="dialog" aria-modal="true" aria-label={`Ảnh phóng to ${product.name}`} onMouseDown={(event) => { if (event.target === event.currentTarget) setZoomOpen(false); }}><button type="button" className="store-image-zoom-close" onClick={() => setZoomOpen(false)} aria-label="Đóng ảnh phóng to"><i className="bi bi-x-lg" aria-hidden="true" /></button>{activeImage ? <img src={activeImage} alt={product.name} /> : <p role="status">Không tải được ảnh sản phẩm.</p>}</div>}
  </div>;
}

export function StorefrontPage({ initialSection = 'shop', user = null, authReady = true, onLogout = () => {}, workspacePath = '/', roleLabel = '' }) {
  const navigate = useNavigate();
  const { productId: routeProductId } = useParams();
  const checkoutOnly = initialSection === 'checkout';
  const [products, setProducts] = useState([]);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);
  const [failedProductImages, setFailedProductImages] = useState([]);
  const [areas, setAreas] = useState([]);
  const [promotions, setPromotions] = useState([]);
  const [isLocating, setIsLocating] = useState(false);
  const [locationStatus, setLocationStatus] = useState('');
  const [locationCoordinates, setLocationCoordinates] = useState(null);
  const [cart, setCart] = useState(readCart);
  const [member, setMember] = useState(null);
  const [memberLoaded, setMemberLoaded] = useState(false);
  const [memberPanelOpen, setMemberPanelOpen] = useState(initialSection === 'member');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [search, setSearch] = useState(() => new URLSearchParams(window.location.search).get('q') || '');
  const [category, setCategory] = useState(() => new URLSearchParams(window.location.search).get('category') || 'all');
  const [brandFilter, setBrandFilter] = useState('all');
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [sortOrder, setSortOrder] = useState('recommended');
  const [catalogPage, setCatalogPage] = useState(1);
  const [wishlistIds, setWishlistIds] = useState([]);
  const [zoomOpen, setZoomOpen] = useState(false);
  const [reviewForm, setReviewForm] = useState({ rating: 5, title: '', body: '' });
  const [reviewStatus, setReviewStatus] = useState('');
  const [reviewBusy, setReviewBusy] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(checkoutOnly);
  const [placing, setPlacing] = useState(false);
  const [checkoutError, setCheckoutError] = useState('');
  const [placedOrder, setPlacedOrder] = useState(null);
  const [paymentStartError, setPaymentStartError] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState('cash_on_delivery');
  const [paymentGatewayConfig, setPaymentGatewayConfig] = useState(null);
  const [paymentSession, setPaymentSession] = useState(null);
  const [paymentQrDataUrl, setPaymentQrDataUrl] = useState('');
  const [paymentQrError, setPaymentQrError] = useState('');
  const [paymentSyncStatus, setPaymentSyncStatus] = useState('pending');
  const [storefrontPolicyConfig, setStorefrontPolicyConfig] = useState(null);
  const [phoneOtpSent, setPhoneOtpSent] = useState(false);
  const [phoneOtpCode, setPhoneOtpCode] = useState('');
  const [phoneVerified, setPhoneVerified] = useState(false);
  const [phoneOtpBusy, setPhoneOtpBusy] = useState(false);
  const [phoneOtpMessage, setPhoneOtpMessage] = useState('');
  const [dataProcessingConsent, setDataProcessingConsent] = useState(false);
  const [marketingConsent, setMarketingConsent] = useState(false);
  const [locationConsent, setLocationConsent] = useState(false);
  const [notificationPreferences, setNotificationPreferences] = useState({ email: false, sms: false, zaloZns: false });
  const dataConsentRequired = storefrontPolicyConfig?.dataConsentRequired === true;
  const dataConsentReady = storefrontPolicyConfig?.dataConsentReady === true;
  const dataControllerName = storefrontPolicyConfig?.legalBusiness?.operatorName || 'chủ thể kinh doanh chưa khai báo';
  const [promotionCode, setPromotionCode] = useState(() => {
    try {
      const savedCode = window.sessionStorage.getItem('emsystems.store.checkout-promotion.v1') || '';
      window.sessionStorage.removeItem('emsystems.store.checkout-promotion.v1');
      return savedCode;
    } catch {
      return '';
    }
  });
  const [usePoints, setUsePoints] = useState(false);
  const [form, setForm] = useState({
    fullName: '', phone: '', email: '', deliveryAreaId: '1', address: '', ward: '', note: '',
  });

  useEffect(() => {
    paymentApiRequest('/api/payments/config').then(setPaymentGatewayConfig).catch(() => setPaymentGatewayConfig(null));
    dataRequest('/config/public').then(setStorefrontPolicyConfig).catch(() => setStorefrontPolicyConfig(null));
  }, []);

  async function sendCheckoutOtp() {
    setPhoneOtpBusy(true); setPhoneOtpMessage(''); setCheckoutError('');
    try {
      const result = await dataRequest('/auth/phone-verification/start', { method: 'POST', body: { phone: form.phone } });
      setPhoneOtpSent(true); setPhoneVerified(false);
      setPhoneOtpMessage(result.message || 'Đã gửi mã OTP qua SMS.');
    } catch (error) { setPhoneOtpMessage(error.message || 'Không gửi được OTP.'); }
    finally { setPhoneOtpBusy(false); }
  }

  async function verifyCheckoutOtp() {
    setPhoneOtpBusy(true); setPhoneOtpMessage(''); setCheckoutError('');
    try {
      const result = await dataRequest('/auth/phone-verification/check', { method: 'POST', body: { phone: form.phone, code: phoneOtpCode } });
      setPhoneVerified(result.verified === true);
      setPhoneOtpMessage(result.verified ? 'Số điện thoại đã được xác minh trong phiên này.' : 'Mã OTP không hợp lệ.');
    } catch (error) { setPhoneVerified(false); setPhoneOtpMessage(error.message || 'Không xác minh được OTP.'); }
    finally { setPhoneOtpBusy(false); }
  }

  useEffect(() => {
    let active = true;
    setPaymentQrDataUrl('');
    setPaymentQrError('');
    if (paymentSession?.provider !== 'vnpay' || !paymentSession.paymentUrl) return () => { active = false; };

    const qrPayload = paymentSession.qrContent || paymentSession.paymentUrl;
    QRCode.toDataURL(qrPayload, {
      errorCorrectionLevel: 'M', margin: 2, width: 360,
      color: { dark: '#102a43', light: '#ffffff' },
    }).then((dataUrl) => {
      if (active) setPaymentQrDataUrl(dataUrl);
    }).catch(() => {
      if (active) setPaymentQrError('Không thể kết xuất QR trên thiết bị này. Hãy mở liên kết thanh toán VNPAY bên cạnh.');
    });

    return () => { active = false; };
  }, [paymentSession]);

  useEffect(() => {
    if (paymentSession?.provider !== 'vnpay' || !paymentSession.paymentId || !paymentSession.token) return undefined;
    let active = true;
    let inFlight = false;
    let timer;

    async function syncPaymentStatus() {
      if (inFlight) return;
      inFlight = true;
      try {
        const result = await dataRequest('/store/orders/sync-payment', {
          method: 'POST', headers: { 'X-Payment-Token': paymentSession.token }, body: { paymentId: paymentSession.paymentId },
        });
        if (!active) return;
        if (result.status === 'paid') {
          setPaymentSyncStatus('paid');
          if (timer) window.clearInterval(timer);
          await loadStoreData();
        } else if (result.status === 'failed') {
          setPaymentSyncStatus('failed');
          if (timer) window.clearInterval(timer);
          await loadStoreData();
        } else {
          setPaymentSyncStatus('pending');
        }
      } catch {
        if (active) setPaymentSyncStatus((current) => current === 'paid' || current === 'failed' ? current : 'checking');
      } finally {
        inFlight = false;
      }
    }

    syncPaymentStatus();
    timer = window.setInterval(syncPaymentStatus, 5000);
    return () => { active = false; if (timer) window.clearInterval(timer); };
  }, [paymentSession]);

  useEffect(() => {
    if (!checkoutOnly) return;
    setCheckoutOpen(true);
    // Giữ mã ưu đãi khi người dùng chọn từ trang chủ rồi chuyển sang trang checkout.
    try {
      const savedCode = window.sessionStorage.getItem('emsystems.store.checkout-promotion.v1');
      if (savedCode) {
        setPromotionCode((current) => current || savedCode);
        window.sessionStorage.removeItem('emsystems.store.checkout-promotion.v1');
      }
    } catch { /* Vẫn có thể nhập mã trực tiếp trong trang thanh toán. */ }
  }, [checkoutOnly]);

  async function loadStoreData() {
    setLoading(true);
    setLoadError('');
    try {
      const [productResult, areaResult, promotionResult] = await Promise.all([
        dataRequest('/store/products?page=1&pageSize=100'),
        dataRequest('/store/delivery-areas'),
        dataRequest('/store/promotions'),
      ]);
      let apiCatalog = { products: [], errors: [] };
      // Checkout chỉ cần catalog nội bộ để tính giá/giữ đúng dòng hàng; không chờ API ngoài.
      if (!checkoutOnly) {
        try {
          apiCatalog = await fetchDummyJsonElectronics();
        } catch { /* Cửa hàng vẫn hoạt động bằng catalog và ảnh đã lưu nội bộ. */ }
      }
      const apiProductsById = new Map(apiCatalog.products.map((item) => [Number(item.id), item]));
      const registeredProducts = (productResult.data || []).map((product) => {
        const apiProduct = apiProductsById.get(Number(product.dummyJsonId));
        const storeCategoryKey = getStoreCategoryKey(product, apiProduct?.category);
        return {
          ...product,
          // Tên và phân loại đã được cửa hàng cấu hình là nguồn chính; API chỉ bù dữ liệu còn thiếu.
          name: product.name || apiProduct?.title || 'Sản phẩm điện tử',
          brandName: product.brandName || apiProduct?.brand || '',
          storeCategoryKey,
          categoryName: STORE_CATEGORY_LABELS[storeCategoryKey],
          description: product.description || apiProduct?.description || '',
          thumbnail: apiProduct?.thumbnail || product.imageUrl || product.images?.[0] || '',
          images: apiProduct?.images?.length ? apiProduct.images : (product.images || []),
          tags: product.tags || [],
          weight: product.weight ?? null,
          dimensions: product.dimensions || null,
          technicalDetails: product.technicalDetails || '',
        };
      });
      // Chỉ đưa lên cửa hàng những sản phẩm đã có giá bán và tồn kho nội bộ hợp lệ.
      setProducts(registeredProducts);
      setAreas(areaResult.data || []);
      setPromotions(promotionResult.data || []);
    } catch (error) {
      setLoadError(error.message || 'Không tải được cửa hàng demo.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadStoreData(); }, [checkoutOnly]);
  useEffect(() => {
    if (!routeProductId) {
      setSelectedProduct(null);
      return;
    }
    if (loading) return;
    const requested = products.find((product) => Number(product.id) === Number(routeProductId));
    if (!requested) {
      setSelectedProduct(null);
      navigate('/', { replace: true });
      return;
    }
    setSelectedProduct(requested);
    setSelectedImageIndex(0);
    setFailedProductImages([]);
  }, [routeProductId, products, loading, navigate]);
  useEffect(() => {
    if (!selectedProduct) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    function onKeyDown(event) {
      if (event.key === 'Escape') {
        if (zoomOpen) setZoomOpen(false);
        else closeProductDetails();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [selectedProduct, routeProductId, zoomOpen]);
  useEffect(() => {
    try { window.localStorage.setItem(CART_KEY, JSON.stringify(cart)); } catch { /* Giỏ hàng chỉ tồn tại trong bộ nhớ nếu storage bị khóa. */ }
  }, [cart]);
  useEffect(() => {
    const key = memberLoaded && member ? wishlistStorageKey(member.id) : '';
    if (!key) return;
    try { window.localStorage.setItem(key, JSON.stringify(wishlistIds)); } catch { /* Favorites are optional and must never block shopping. */ }
  }, [member, memberLoaded, wishlistIds]);
  useEffect(() => {
    if (!authReady) {
      setMemberLoaded(false);
      return undefined;
    }
    if (!user || user.role !== 'customer') {
      setMember(null);
      setWishlistIds([]);
      setMemberLoaded(true);
      return undefined;
    }

    let active = true;
    setMemberLoaded(false);
    dataRequest('/store/member/me').then((result) => {
      if (!active) return;
      const currentMember = result.member || null;
      let savedIds = readWishlist(currentMember?.id);
      if (currentMember) {
        try {
          const pendingProductId = Number(window.sessionStorage.getItem(PENDING_WISHLIST_KEY));
          if (Number.isSafeInteger(pendingProductId) && pendingProductId > 0) {
            savedIds = [...new Set([...savedIds, pendingProductId])];
            window.sessionStorage.removeItem(PENDING_WISHLIST_KEY);
          }
        } catch { /* If session storage is unavailable, the customer can tap the heart again. */ }
      }
      setMember(currentMember);
      setWishlistIds(savedIds);
      setMemberLoaded(true);
    }).catch(() => {
      if (!active) return;
      setMember(null);
      setWishlistIds([]);
      setMemberLoaded(true);
    });
    return () => { active = false; };
  }, [authReady, user?.id, user?.role]);

  useEffect(() => {
    if (!member) {
      setUsePoints(false);
      return;
    }
    setForm((current) => ({
      ...current,
      fullName: current.fullName || member.fullName || '',
      phone: current.phone || member.phone || '',
      email: current.email || member.email || '',
    }));
  }, [member]);

  const selectedArea = areas.find((area) => area.id === Number(form.deliveryAreaId)) || areas[0] || null;
  const activeDeliveryQuote = locationCoordinates && selectedArea
    ? calculateDeliveryQuote(selectedArea.branchId, locationCoordinates.latitude, locationCoordinates.longitude)
    : null;
  const shippingFee = activeDeliveryQuote?.available
    ? activeDeliveryQuote.shippingFee
    : Number(selectedArea?.shippingFee || 0);
  const shippingEta = activeDeliveryQuote?.available ? activeDeliveryQuote.eta : (selectedArea?.eta || '—');
  const categories = STORE_CATEGORIES.filter((item) => products.some((product) => product.storeCategoryKey === item.value));
  const cartLines = cart.map((line) => ({
    ...line,
    product: products.find((product) => product.id === line.productId),
  })).filter((line) => line.product);
  const cartQuantity = cartLines.reduce((sum, line) => sum + line.quantity, 0);
  const subtotal = cartLines.reduce((sum, line) => sum + Number(line.product.sellingPrice || 0) * line.quantity, 0);
  const activePromotion = promotions.find((promo) => promo.code === promotionCode.trim().toUpperCase());
  const promotionAllowed = activePromotion && subtotal >= Number(activePromotion.minimumOrder || 0)
    && (!activePromotion.memberOnly || Boolean(member));
  const promotionDiscount = promotionAllowed
    ? activePromotion.discountType === 'percent'
      ? Math.floor(subtotal * Number(activePromotion.discountValue) / 100)
      : Math.min(subtotal, Number(activePromotion.discountValue))
    : 0;
  const maxRedeemablePoints = member ? Math.min(Number(member.loyaltyPoints || 0), Math.floor(Math.max(0, subtotal - promotionDiscount) / 100)) : 0;
  const pointsDiscount = member && usePoints ? maxRedeemablePoints * 100 : 0;
  const discounts = promotionDiscount + pointsDiscount;
  const total = Math.max(0, subtotal - discounts + shippingFee);
  const brands = [...new Set(products.map((product) => String(product.brandName || '').trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, 'vi'));
  const normalizedQuery = normalizeSearchText(search);
  const filteredProducts = products.filter((product) => {
    const matchesSearch = !normalizedQuery || [product.name, product.sku, product.brandName, product.categoryName]
      .some((value) => normalizeSearchText(value).includes(normalizedQuery));
    const matchesCategory = category === 'all' || product.storeCategoryKey === category;
    const matchesBrand = brandFilter === 'all' || product.brandName === brandFilter;
    const price = Number(product.sellingPrice) || 0;
    const matchesMinPrice = minPrice === '' || price >= Math.max(0, Number(minPrice) || 0);
    const matchesMaxPrice = maxPrice === '' || price <= Math.max(0, Number(maxPrice) || 0);
    return matchesSearch && matchesCategory && matchesBrand && matchesMinPrice && matchesMaxPrice;
  });
  const sortedProducts = [...filteredProducts].sort((left, right) => {
    if (sortOrder === 'price-asc') return Number(left.sellingPrice || 0) - Number(right.sellingPrice || 0);
    if (sortOrder === 'price-desc') return Number(right.sellingPrice || 0) - Number(left.sellingPrice || 0);
    if (sortOrder === 'name-asc') return String(left.name || '').localeCompare(String(right.name || ''), 'vi');
    if (sortOrder === 'rating-desc') return (Number(right.rating) || 0) - (Number(left.rating) || 0);
    if (sortOrder === 'newest') return Number(right.id) - Number(left.id);
    return Number(left.id) - Number(right.id);
  });
  const catalogPageSize = 12;
  const catalogTotalPages = Math.max(1, Math.ceil(sortedProducts.length / catalogPageSize));
  const visibleProducts = sortedProducts.slice((catalogPage - 1) * catalogPageSize, catalogPage * catalogPageSize);

  useEffect(() => { setCatalogPage(1); }, [search, category, brandFilter, minPrice, maxPrice, sortOrder]);
  useEffect(() => {
    if (catalogPage > catalogTotalPages) setCatalogPage(catalogTotalPages);
  }, [catalogPage, catalogTotalPages]);

  function toggleWishlist(productId) {
    if (!memberLoaded) return;
    if (!member) {
      const returnTo = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      try { window.sessionStorage.setItem(PENDING_WISHLIST_KEY, String(productId)); } catch { /* The user can save the item after signing in. */ }
      navigate('/login', { state: { reason: 'wishlist', returnTo } });
      return;
    }
    setWishlistIds((current) => current.includes(productId)
      ? current.filter((id) => id !== productId)
      : [...current, productId]);
  }

  async function submitProductReview(event, product) {
    event.preventDefault();
    if (!member) {
      navigate('/login');
      return;
    }
    setReviewBusy(true);
    setReviewStatus('');
    try {
      const result = await dataRequest(`/store/products/${product.id}/reviews`, { method: 'POST', body: reviewForm });
      const summary = result.summary || {};
      setProducts((current) => current.map((item) => item.id === product.id ? { ...item, ...summary } : item));
      setSelectedProduct((current) => current?.id === product.id ? { ...current, ...summary } : current);
      setReviewForm({ rating: 5, title: '', body: '' });
      setReviewStatus(result.message || 'Đã gửi đánh giá.');
    } catch (error) {
      setReviewStatus(error.message || 'Không thể gửi đánh giá.');
    } finally {
      setReviewBusy(false);
    }
  }

  async function shareProduct(product) {
    const url = `${window.location.origin}${productPath(product)}`;
    try {
      if (typeof navigator.share === 'function') {
        await navigator.share({ title: product.name, text: `Xem ${product.name} tại EMSystems`, url });
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        setReviewStatus('Đã sao chép liên kết sản phẩm.');
      } else {
        window.prompt('Sao chép liên kết sản phẩm:', url);
      }
    } catch (error) {
      if (error?.name !== 'AbortError') setReviewStatus('Không thể chia sẻ lúc này. Hãy sao chép URL trên thanh địa chỉ.');
    }
  }

  useEffect(() => {
    const previousTitle = document.title;
    const meta = document.querySelector('meta[name="description"]');
    const createdMeta = !meta;
    const descriptionMeta = meta || document.createElement('meta');
    if (createdMeta) {
      descriptionMeta.setAttribute('name', 'description');
      document.head.appendChild(descriptionMeta);
    }
    const previousDescription = descriptionMeta.content;
    let canonical = document.querySelector('link[rel="canonical"]');
    const createdCanonical = !canonical;
    if (!canonical) {
      canonical = document.createElement('link');
      canonical.rel = 'canonical';
      document.head.appendChild(canonical);
    }
    const previousCanonical = canonical.href;
    const product = selectedProduct || products.find((item) => Number(item.id) === Number(routeProductId));
    const title = checkoutOnly
      ? 'Thanh toán đơn hàng | EMSystems'
      : product ? `${product.name} chính hãng | EMSystems` : 'EMSystems | Cửa hàng điện tử & giao tận nhà';
    const description = checkoutOnly
      ? 'Kiểm tra giỏ hàng, thông tin giao nhận, ưu đãi và phương thức thanh toán tại EMSystems.'
      : product
        ? `${product.name}. Giá ${money(product.sellingPrice)}, mã ${product.sku || 'đang cập nhật'}, tình trạng tồn kho và thông tin bảo hành tại EMSystems.`.slice(0, 160)
        : 'Khám phá điện thoại, laptop, máy tính bảng và phụ kiện điện tử tại EMSystems. Xem giá, tồn kho, ưu đãi và phí giao hàng.';
    document.title = title;
    descriptionMeta.content = description;
    canonical.href = `${window.location.origin}${checkoutOnly ? '/checkout' : product ? productPath(product) : '/'}`;
    const oldSchema = document.getElementById('emsystems-product-schema');
    if (oldSchema) oldSchema.remove();
    if (product && !checkoutOnly) {
      const schema = {
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: product.name,
        sku: product.sku || undefined,
        description: String(product.description || '').slice(0, 5000) || undefined,
        image: productImageList(product),
        brand: product.brandName ? { '@type': 'Brand', name: product.brandName } : undefined,
        offers: {
          '@type': 'Offer',
          priceCurrency: 'VND',
          price: String(Math.max(0, Number(product.sellingPrice) || 0)),
          availability: Number(product.availableStock) > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
          url: canonical.href,
        },
      };
      if (Number(product.reviewCount) > 0 && Number.isFinite(Number(product.rating))) {
        schema.aggregateRating = { '@type': 'AggregateRating', ratingValue: Number(product.rating), reviewCount: Number(product.reviewCount), bestRating: 5, worstRating: 1 };
        schema.review = (product.reviews || []).filter((review) => review.verifiedPurchase).map((review) => ({
          '@type': 'Review',
          author: { '@type': 'Person', name: review.reviewerName },
          datePublished: review.createdAt,
          reviewBody: review.body,
          name: review.title,
          reviewRating: { '@type': 'Rating', ratingValue: review.rating, bestRating: 5, worstRating: 1 },
        }));
      }
      const schemaElement = document.createElement('script');
      schemaElement.id = 'emsystems-product-schema';
      schemaElement.type = 'application/ld+json';
      schemaElement.textContent = JSON.stringify(schema);
      document.head.appendChild(schemaElement);
    }
    return () => {
      document.title = previousTitle;
      if (!createdMeta) descriptionMeta.content = previousDescription;
      else descriptionMeta.remove();
      if (!createdCanonical) canonical.href = previousCanonical;
      else canonical.remove();
      document.getElementById('emsystems-product-schema')?.remove();
    };
  }, [selectedProduct, products, routeProductId, checkoutOnly]);

  function closeProductDetails() {
    setSelectedProduct(null);
    if (routeProductId) navigate('/', { replace: true });
  }

  function locateDeliveryArea() {
    if (!locationConsent) {
      setLocationStatus('Hãy đồng ý riêng với việc sử dụng vị trí trước khi bật định vị. Bạn vẫn có thể chọn khu vực giao hàng thủ công.');
      return;
    }
    if (!navigator.geolocation) {
      setLocationStatus('Trình duyệt không hỗ trợ định vị. Hãy chọn khu vực giao hàng thủ công.');
      setLocationCoordinates(null);
      return;
    }
    setIsLocating(true);
    setLocationStatus('Đang xác định vị trí…');
    navigator.geolocation.getCurrentPosition((position) => {
      const latitude = Number(position.coords.latitude);
      const longitude = Number(position.coords.longitude);
      const nearest = findNearestSupportedDeliveryArea(areas, latitude, longitude);
      if (!nearest) {
        setLocationCoordinates(null);
        setLocationStatus('Chưa xác định được khu vực giao hàng hỗ trợ gần bạn. Hãy chọn thủ công trong danh sách.');
        setIsLocating(false);
        return;
      }
      const quote = calculateDeliveryQuote(nearest.area.branchId, latitude, longitude);
      if (!quote.available) {
        setLocationCoordinates(null);
        setLocationStatus(quote.reason || 'Vị trí đang nằm ngoài phạm vi giao hàng. Hãy chọn thủ công.');
        setIsLocating(false);
        return;
      }
      setLocationCoordinates({ latitude, longitude });
      setForm((current) => ({ ...current, deliveryAreaId: String(nearest.area.id) }));
      setLocationStatus(`Đã xác định khu vực ${nearest.area.district}, ${nearest.area.city}. Phí giao ước tính theo cự ly ${quote.distanceKm.toFixed(1)} km.`);
      setIsLocating(false);
    }, (error) => {
      setLocationCoordinates(null);
      setLocationStatus(error.code === 1
        ? 'Bạn chưa cấp quyền vị trí. Hãy cho phép định vị hoặc chọn khu vực thủ công.'
        : 'Không lấy được vị trí hiện tại. Hãy thử lại hoặc chọn khu vực thủ công.');
      setIsLocating(false);
    }, { enableHighAccuracy: false, timeout: 12000, maximumAge: 120000 });
  }

  function updateCart(productId, delta, maxQuantity = 50) {
    const limit = Math.max(0, Math.min(50, Number(maxQuantity) || 0));
    setCart((current) => {
      const existing = current.find((line) => line.productId === productId);
      if (!existing && delta > 0) return limit > 0 ? [...current, { productId, quantity: 1 }] : current;
      return current.flatMap((line) => {
        if (line.productId !== productId) return [line];
        const quantity = Math.min(limit, line.quantity + delta);
        return quantity <= 0 ? [] : [{ ...line, quantity }];
      });
    });
  }

  function openProductDetails(product) {
    setSelectedImageIndex(0);
    setFailedProductImages([]);
    setSelectedProduct(product);
  }

  function buyNow(product, maxQuantity) {
    const existing = cart.find((line) => line.productId === product.id);
    const nextCart = existing
      ? cart
      : [...cart, { productId: product.id, quantity: 1 }];
    // Lưu đồng bộ trước khi chuyển route vì trang chi tiết/cửa hàng sẽ unmount.
    try { window.localStorage.setItem(CART_KEY, JSON.stringify(nextCart)); } catch { /* State tại phiên hiện tại vẫn dùng được nếu storage bị khóa. */ }
    setCart(nextCart);
    setSelectedProduct(null);
    navigate('/checkout');
  }

  function productImageList(product) {
    return [...new Set([product.thumbnail, product.imageUrl, ...(product.images || [])].filter((url) => typeof url === 'string' && url.trim()))].slice(0, 12);
  }

  async function placeOrder(event) {
    event.preventDefault();
    setPlacing(true);
    setCheckoutError('');
    setPlacedOrder(null);
    setPaymentSession(null);
    setPaymentQrDataUrl('');
    setPaymentSyncStatus('pending');
    setPaymentStartError(false);
    try {
      if (paymentMethod !== 'cash_on_delivery') {
        const provider = paymentMethod === 'momo_sandbox' ? 'momo' : paymentMethod === 'vietqr_transfer' ? 'vietqr' : 'vnpay';
        const config = await paymentApiRequest('/api/payments/config');
        setPaymentGatewayConfig(config);
        const providerConfig = config.methods?.[provider];
        if (!providerConfig?.canCreate) {
          const missing = providerConfig?.missingCredentials?.length ? ` Cần cấu hình: ${providerConfig.missingCredentials.join(', ')}.` : '';
          throw new Error(`Chưa có đủ cấu hình để tạo yêu cầu ${provider === 'momo' ? 'MoMo' : provider === 'vnpay' ? 'VNPAY' : 'VietQR'}.${missing} Xem .env.example để biết các biến cần điền.`);
        }
      }
      const result = await dataRequest('/store/orders', {
        method: 'POST',
        body: {
          ...form,
          paymentMethod,
          dataProcessingConsent,
          marketingConsent,
          locationConsent,
          notificationPreferences,
          deliveryAreaId: Number(form.deliveryAreaId),
          promotionCode: promotionCode.trim().toUpperCase(),
          usePoints,
          items: cartLines.map((line) => ({ productId: line.productId, quantity: line.quantity })),
          ...(locationCoordinates ? { deliveryCoordinates: locationCoordinates } : {}),
        },
      });
      setPlacedOrder(result.order);
      setCart([]);
      setPromotionCode('');
      setUsePoints(false);
      setCheckoutError('');
      if (paymentMethod !== 'cash_on_delivery') {
        try {
          const provider = paymentMethod === 'momo_sandbox' ? 'momo' : paymentMethod === 'vietqr_transfer' ? 'vietqr' : 'vnpay';
          const payment = await paymentApiRequest(`/api/payments/${provider}/create`, {
            method: 'POST', body: { orderId: result.order.invoiceNo, amount: Number(result.order.totalAmount) },
          });
          const nextPaymentSession = { ...payment, invoiceNo: result.order.invoiceNo, phone: form.phone, provider, token: payment.statusToken };
          window.sessionStorage.setItem(PENDING_PAYMENT_KEY, JSON.stringify({
            invoiceNo: result.order.invoiceNo, phone: form.phone, paymentId: payment.paymentId,
            token: payment.statusToken, provider,
          }));
          setPaymentStartError(false);
          if (provider === 'vnpay' || provider === 'vietqr') {
            setPaymentSession(nextPaymentSession);
            setCheckoutError('');
            setPaymentSyncStatus('pending');
            return;
          }
          window.location.assign(payment.paymentUrl);
          return;
        } catch (paymentError) {
          setPaymentStartError(true);
          setCheckoutError(`Đơn ${result.order.invoiceNo} đã được tạo nhưng chưa mở được cổng thanh toán. ${paymentError.message} Hãy thử tiếp tục thanh toán bên dưới; không cần tạo đơn mới.`);
          return;
        }
      }
      try {
        const response = await dataRequest('/store/member/me');
        setMember(response.member);
      } catch {
        // Đơn khách vãng lai vẫn được đặt; không được tích điểm.
      }
      await loadStoreData();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (error) {
      setCheckoutError(error.message || 'Không thể đặt đơn demo.');
    } finally {
      setPlacing(false);
    }
  }

  async function retryOnlinePayment() {
    if (!placedOrder || !['momo_sandbox', 'vnpay_sandbox', 'vietqr_transfer'].includes(placedOrder.paymentMethod)) return;
    setPlacing(true);
    setCheckoutError('');
    try {
      const provider = placedOrder.paymentMethod === 'momo_sandbox' ? 'momo' : placedOrder.paymentMethod === 'vietqr_transfer' ? 'vietqr' : 'vnpay';
      const payment = await paymentApiRequest(`/api/payments/${provider}/create`, {
        method: 'POST', body: { orderId: placedOrder.invoiceNo, amount: Number(placedOrder.totalAmount) },
      });
      const nextPaymentSession = { ...payment, invoiceNo: placedOrder.invoiceNo, phone: form.phone, provider, token: payment.statusToken };
      window.sessionStorage.setItem(PENDING_PAYMENT_KEY, JSON.stringify({
        invoiceNo: placedOrder.invoiceNo, phone: form.phone, paymentId: payment.paymentId,
        token: payment.statusToken, provider,
      }));
      setPaymentStartError(false);
      if (provider === 'vnpay' || provider === 'vietqr') {
        setPaymentSession(nextPaymentSession);
        setPaymentSyncStatus('pending');
        setCheckoutError('');
        return;
      }
      window.location.assign(payment.paymentUrl);
    } catch (error) {
      setCheckoutError(error.message || 'Không thể tiếp tục thanh toán sandbox.');
    } finally {
      setPlacing(false);
    }
  }

  return (
    <div className={`storefront${routeProductId ? ' storefront-product-route' : ''}`}>
      <StoreHeader cartCount={cartQuantity} user={user} authReady={authReady} onLogout={onLogout} workspacePath={workspacePath} roleLabel={roleLabel} member={member} onShowMember={() => { if (member) setMemberPanelOpen(true); else navigate(user?.role === 'customer' ? '/member' : '/login'); }} search={search} onSearch={setSearch} onSearchSubmit={(query) => { const value = String(query || '').trim(); if (routeProductId) navigate(value ? '/?q=' + encodeURIComponent(value) + '#shop' : '/#shop'); else document.getElementById('shop')?.scrollIntoView({ behavior: 'smooth' }); }} category={category} onCategoryChange={(value) => { setCategory(value); if (routeProductId) navigate(value === 'all' ? '/#shop' : '/?category=' + encodeURIComponent(value) + '#shop'); else document.getElementById('shop')?.scrollIntoView({ behavior: 'smooth' }); }} showSearch={!checkoutOnly} showCategories={!checkoutOnly} />
      <StoreNetworkStatus />
      {!checkoutOnly && <div className="store-announcement"><i className="bi bi-stars" aria-hidden="true" /> Chọn thiết bị phù hợp · Kiểm tra tồn kho theo chi nhánh · Đơn hàng và thanh toán chỉ là bản demo</div>}
      {checkoutOnly && <div className="store-announcement"><i className="bi bi-shield-check" aria-hidden="true" /> Thanh toán đơn hàng · Chọn phương thức và kiểm tra thông tin trước khi tiếp tục</div>}
      <main>
        {!checkoutOnly && <>
        {placedOrder && <section className="store-order-confirmation" role="status">
          <span className="store-confirm-icon"><i className="bi bi-check-lg" aria-hidden="true" /></span>
          <div className="store-eyebrow">{['momo_sandbox', 'vnpay_sandbox', 'vietqr_transfer'].includes(placedOrder.paymentMethod) ? 'ĐƠN HÀNG ĐÃ TẠO · CHỜ THANH TOÁN' : 'ĐẶT HÀNG THÀNH CÔNG · DEMO'}</div>
          <h2>Đã nhận đơn {placedOrder.invoiceNo}</h2>
          <p>{placedOrder.paymentMethod === 'vietqr_transfer' ? 'Quét mã VietQR và chuyển khoản theo đúng số tiền, nội dung. Đơn chỉ được xác nhận sau khi cửa hàng đối soát giao dịch ngân hàng.' : ['momo_sandbox', 'vnpay_sandbox'].includes(placedOrder.paymentMethod) ? `Phương thức: ${paymentMethodLabel(placedOrder.paymentMethod)}. Đơn chỉ được xác nhận thanh toán sau khi server kiểm tra phản hồi chữ ký/IPN từ cổng.` : 'Cửa hàng sẽ xác nhận đơn trước khi giao. Trạng thái và tiền hàng hiện là dữ liệu demo.'}</p>
          <div className="store-confirm-grid"><span>Tổng tiền gồm phí giao hàng<strong>{money(placedOrder.totalAmount)}</strong></span><span>Dự kiến giao<strong>{placedOrder.eta}</strong></span><span>Mã đơn<strong>{placedOrder.invoiceNo}</strong></span><span>Thanh toán<strong>{paymentMethodLabel(placedOrder.paymentMethod)}</strong></span><span>Điểm thành viên<strong>{placedOrder.memberCustomerId ? 'Dự kiến +' + Number(placedOrder.pointsExpectedOnDelivery || 0).toLocaleString('vi-VN') : 'Không tích điểm'}</strong></span></div>
          <p className={placedOrder.memberCustomerId ? 'store-points-notice' : 'store-guest-points-notice'}>{placedOrder.notice}</p>
          <VnpayQrPanel paymentSession={paymentSession} qrDataUrl={paymentQrDataUrl} qrError={paymentQrError} paymentSyncStatus={paymentSyncStatus} amount={placedOrder.totalAmount} />
          <VietQrTransferPanel paymentSession={paymentSession} amount={placedOrder.totalAmount} />
          {paymentStartError && <button type="button" className="store-button store-button-primary" onClick={retryOnlinePayment} disabled={placing}>{placing ? 'Đang kết nối cổng…' : 'Tiếp tục thanh toán'}</button>}
          <Link className="store-button store-button-primary" to={'/track-order?orderCode=' + encodeURIComponent(placedOrder.invoiceNo) + '&phone=' + encodeURIComponent(form.phone)}>Theo dõi đơn hàng</Link>
          <Link className="store-link-button" to={'/support?orderCode=' + encodeURIComponent(placedOrder.invoiceNo)}>Gặp sự cố thanh toán hoặc đơn hàng? Mở Trung tâm hỗ trợ</Link>
        </section>}

        <section
          className="store-hero store-retail-hero store-hero-background"
          style={{ backgroundImage: `linear-gradient(90deg, rgba(10, 27, 42, .94) 0%, rgba(10, 27, 42, .82) 44%, rgba(10, 27, 42, .22) 100%), url("${emsystemsHeader}")` }}
          aria-label="Giới thiệu cửa hàng EMSystems"
        >
          <div className="store-hero-copy">
            <span className="store-eyebrow">EM SYSTEMS · TECH FOR EVERY DAY</span>
            <h1>Mua sắm công nghệ.<br /><em>Chọn đúng thiết bị.</em></h1>
            <p>Khám phá điện thoại, laptop, máy tính bảng và phụ kiện. Giá bán, tồn kho và phí giao hàng được hiển thị theo dữ liệu demo của EMSystems.</p>
            <div className="store-hero-actions">
              <a className="store-button store-button-primary" href="#shop">Xem sản phẩm <i className="bi bi-arrow-right" aria-hidden="true" /></a>
              <button className="store-button store-button-light" type="button" onClick={() => { if (member) setMemberPanelOpen(true); else navigate('/login'); }}>Quyền lợi EM Club</button>
            </div>
            <div className="store-trust-row">
              <span><i className="bi bi-check2-circle" aria-hidden="true" /> Giá hiển thị rõ ràng</span>
              <span><i className="bi bi-check2-circle" aria-hidden="true" /> Kiểm tra tồn theo kho</span>
              <span><i className="bi bi-check2-circle" aria-hidden="true" /> Tra cứu trạng thái đơn</span>
            </div>
          </div>
        </section>

        <section className="store-benefit-strip" id="benefits"><div><span className="store-benefit-icon"><i className="bi bi-house-door" aria-hidden="true" /></span><span><strong>Giao tận nhà</strong><small>Chọn khu vực và xem phí trước khi đặt</small></span></div><div><span className="store-benefit-icon"><i className="bi bi-person-check" aria-hidden="true" /></span><span><strong>Tích điểm EM Club</strong><small>10.000đ chi tiêu hợp lệ = 1 điểm demo</small></span></div><div><span className="store-benefit-icon"><i className="bi bi-percent" aria-hidden="true" /></span><span><strong>Mã ưu đãi</strong><small>Có mã cho khách mới và thành viên</small></span></div><div><span className="store-benefit-icon"><i className="bi bi-arrow-counterclockwise" aria-hidden="true" /></span><span><strong>Theo dõi đơn</strong><small>Tra cứu bằng mã đơn và số điện thoại</small></span></div></section>

        <section className="store-promo-section"><div><span className="store-eyebrow">DEALS & REWARDS</span><h2>Ưu đãi đang áp dụng</h2><p>Mã ưu đãi được kiểm tra điều kiện và hạn sử dụng khi đặt đơn demo.</p></div><div className="store-promo-list">{promotions.length ? promotions.map((promo) => <article className="store-promo-card" key={promo.code}><span className="store-promo-badge">{promo.memberOnly ? 'EM CLUB' : 'DEAL'}</span><div><strong>{promo.code}</strong><p>{promo.description || (promo.discountType === 'percent' ? 'Giảm ' + promo.discountValue + '%' : 'Giảm ' + money(promo.discountValue))}</p><small>Đơn tối thiểu {money(promo.minimumOrder)} · đến {new Date(promo.endAt).toLocaleDateString('vi-VN')}</small></div><button type="button" className="store-copy-code" onClick={() => { try { window.sessionStorage.setItem('emsystems.store.checkout-promotion.v1', promo.code); } catch { /* Có thể nhập mã trực tiếp tại trang thanh toán. */ } navigate('/checkout'); }}>Dùng mã</button></article>) : <p className="store-muted">Hiện chưa có mã ưu đãi.</p>}</div></section>

        <section className="store-product-section" id="shop"><div className="store-section-heading"><div><span className="store-eyebrow">DANH MỤC SẢN PHẨM</span><h2>Chọn thiết bị của bạn</h2><p>Xem thông tin, chọn số lượng, kiểm tra phí giao hàng theo khu vực rồi thêm vào giỏ hoặc mua ngay.</p></div><span className="store-product-count">{filteredProducts.length} mặt hàng</span></div>
          <div className="store-catalog-tools">
            <label className="store-search"><i className="bi bi-search" aria-hidden="true" /><input type="search" list="store-product-suggestions" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tìm tên sản phẩm, hãng hoặc SKU..." aria-label="Tìm sản phẩm" /><datalist id="store-product-suggestions">{products.map((product) => <option key={product.id} value={product.name} />)}</datalist></label>
            <div className="store-category-pills"><button type="button" className={category === 'all' ? 'selected' : ''} onClick={() => setCategory('all')}>Tất cả</button>{categories.map((item) => <button type="button" className={category === item.value ? 'selected' : ''} key={item.value} onClick={() => setCategory(item.value)}>{item.label}</button>)}</div>
          </div>
          <div className="store-catalog-filter-row" aria-label="Lọc và sắp xếp sản phẩm">
            <label><span>Thương hiệu</span><select value={brandFilter} onChange={(event) => setBrandFilter(event.target.value)}><option value="all">Tất cả hãng</option>{brands.map((brand) => <option key={brand} value={brand}>{brand}</option>)}</select></label>
            <label><span>Giá từ (₫)</span><input type="number" min="0" inputMode="numeric" value={minPrice} onChange={(event) => setMinPrice(event.target.value)} placeholder="Không giới hạn" /></label>
            <label><span>Đến giá (₫)</span><input type="number" min="0" inputMode="numeric" value={maxPrice} onChange={(event) => setMaxPrice(event.target.value)} placeholder="Không giới hạn" /></label>
            <label><span>Sắp xếp</span><select value={sortOrder} onChange={(event) => setSortOrder(event.target.value)}><option value="recommended">Mặc định</option><option value="newest">Mới nhất</option><option value="price-asc">Giá thấp đến cao</option><option value="price-desc">Giá cao đến thấp</option><option value="rating-desc">Đánh giá cao</option><option value="name-asc">Tên A–Z</option></select></label>
            <button type="button" className="store-link-button" onClick={() => { setSearch(''); setCategory('all'); setBrandFilter('all'); setMinPrice(''); setMaxPrice(''); setSortOrder('recommended'); }}>Xóa bộ lọc</button>
          </div>
          {loadError && <div className="store-form-error" role="alert">{loadError}<button type="button" className="store-link-button" onClick={loadStoreData}>Thử tải lại</button></div>}
          {loading ? <div className="store-loading">Đang tải sản phẩm…</div> : !visibleProducts.length ? <div className="store-empty">Không tìm thấy sản phẩm phù hợp hoặc khu vực kho demo chưa có hàng.</div> : <div className="store-product-grid">{visibleProducts.map((product, index) => {
            const inCart = cart.find((line) => line.productId === product.id)?.quantity || 0;
            const imageUrl = product.thumbnail || product.imageUrl || product.images?.[0] || '';
            const inStockAtBranch = Boolean(product.inStockByBranch?.[String(selectedArea?.branchId)] ?? product.inStock);
            // Public catalog receives only availability flags; the API validates exact quantity at checkout.
            const stockAtBranch = inStockAtBranch ? 50 : 0;
            return <article className="store-product-card" key={product.id}>
              <button type="button" className={'store-product-visual store-product-visual-button store-product-visual-' + (index % 6)} onClick={() => openProductDetails(product)} >
                <span className="store-product-type">{product.categoryName || 'Thiết bị điện tử'}</span>
                <span className="store-product-image-fallback" aria-hidden="true"><i className={`bi ${product.storeCategoryKey === 'smartphones' ? 'bi-phone' : product.storeCategoryKey === 'computers' ? 'bi-laptop' : product.storeCategoryKey === 'tablets' ? 'bi-tablet' : 'bi-box-seam'}`} /></span>{imageUrl && <img className="store-product-image" src={imageUrl} alt={product.name} loading="lazy" onLoad={(event) => { event.currentTarget.dataset.loaded = 'true'; }} onError={(event) => { event.currentTarget.style.display = 'none'; }} />}
                <span className="store-product-brand">{product.brandName || 'EMSystems'}</span>
              </button>
              <div className="store-product-details"><span className="store-product-sku">{product.sku}</span><h3><button type="button" className="store-product-title-button" onClick={() => openProductDetails(product)}>{product.name}</button></h3>
                <div className="store-product-meta"><span>Bảo hành {product.warrantyMonths || 0} tháng</span><span className={inStockAtBranch ? 'store-stock-ready' : 'store-stock-empty'}>{inStockAtBranch ? `Còn hàng tại ${selectedArea?.district || 'kho'}` : 'Chưa có hàng tại khu vực này'}</span></div>
                <div className="store-product-rating" aria-label={product.reviewCount ? `${product.rating} trên 5 sao, ${product.reviewCount} đánh giá đã xác minh` : 'Chưa có đánh giá đã xác minh'}><i className="bi bi-star-fill" aria-hidden="true" /> {product.reviewCount ? `${Number(product.rating).toFixed(1)} · ${product.reviewCount} đánh giá` : 'Chưa có đánh giá'}</div>
                <div className="store-product-buy"><strong>{money(product.sellingPrice)}</strong><button type="button" disabled={stockAtBranch <= inCart} onClick={() => updateCart(product.id, 1, stockAtBranch)}>{inCart ? <>Thêm nữa <i className="bi bi-plus-lg" aria-hidden="true" /></> : <>Thêm vào giỏ <i className="bi bi-plus-lg" aria-hidden="true" /></>}</button></div>
                <button type="button" className="store-product-wishlist" disabled={!memberLoaded} aria-pressed={wishlistIds.includes(product.id)} onClick={() => toggleWishlist(product.id)} title={!memberLoaded ? 'Đang kiểm tra tài khoản' : !member ? 'Đăng nhập để lưu sản phẩm yêu thích' : undefined}><i className={`bi ${wishlistIds.includes(product.id) ? 'bi-heart-fill' : 'bi-heart'}`} aria-hidden="true" /> {wishlistIds.includes(product.id) ? 'Đã lưu yêu thích' : 'Thêm yêu thích'}</button>
                <button type="button" className="store-product-view-details" onClick={() => openProductDetails(product)}>Xem thông tin chi tiết <i className="bi bi-arrow-up-right" aria-hidden="true" /></button>
                {inCart > 0 && <div className="store-inline-cart"><button type="button" aria-label={'Giảm ' + product.name} onClick={() => updateCart(product.id, -1)}><i className="bi bi-dash-lg" aria-hidden="true" /></button><span>{inCart} trong giỏ</span><button type="button" aria-label={'Tăng ' + product.name} disabled={inCart >= stockAtBranch} onClick={() => updateCart(product.id, 1, stockAtBranch)}><i className="bi bi-plus-lg" aria-hidden="true" /></button></div>}
              </div>
            </article>;
          })}</div>}
          {!loading && filteredProducts.length > 0 && <div className="store-catalog-pagination"><span>Hiển thị {Math.min(filteredProducts.length, (catalogPage - 1) * catalogPageSize + 1)}–{Math.min(filteredProducts.length, catalogPage * catalogPageSize)} / {filteredProducts.length} sản phẩm · Trang {catalogPage}/{catalogTotalPages}</span><div><button type="button" className="store-button store-button-secondary" disabled={catalogPage <= 1} onClick={() => { setCatalogPage((page) => Math.max(1, page - 1)); document.getElementById('shop')?.scrollIntoView({ behavior: 'smooth' }); }}>Trước</button><button type="button" className="store-button store-button-secondary" disabled={catalogPage >= catalogTotalPages} onClick={() => { setCatalogPage((page) => Math.min(catalogTotalPages, page + 1)); document.getElementById('shop')?.scrollIntoView({ behavior: 'smooth' }); }}>Tiếp</button></div></div>}
        </section>
        </>}

        {checkoutOnly && <div className="store-checkout-page-heading"><div><span className="store-eyebrow">SECURE CHECKOUT</span><h1>Thanh toán đơn hàng</h1><p>Kiểm tra giỏ hàng, thông tin giao nhận và phương thức thanh toán trước khi xác nhận.</p></div><Link to="/" className="store-link-button"><i className="bi bi-arrow-left" aria-hidden="true" /> Tiếp tục mua sắm</Link></div>}

        {checkoutOnly && placedOrder && <section className="store-order-confirmation" role="status">
          <span className="store-confirm-icon"><i className="bi bi-check-lg" aria-hidden="true" /></span>
          <div className="store-eyebrow">{['momo_sandbox', 'vnpay_sandbox', 'vietqr_transfer'].includes(placedOrder.paymentMethod) ? 'ĐƠN HÀNG ĐÃ TẠO · CHỜ THANH TOÁN' : 'ĐẶT HÀNG THÀNH CÔNG · DEMO'}</div>
          <h2>Đã nhận đơn {placedOrder.invoiceNo}</h2>
          <p>{placedOrder.paymentMethod === 'vietqr_transfer' ? 'Quét mã VietQR và chuyển khoản theo đúng số tiền, nội dung. Đơn chỉ được xác nhận sau khi cửa hàng đối soát giao dịch ngân hàng.' : ['momo_sandbox', 'vnpay_sandbox'].includes(placedOrder.paymentMethod) ? `Phương thức: ${paymentMethodLabel(placedOrder.paymentMethod)}. Đơn chỉ được xác nhận thanh toán sau khi server kiểm tra phản hồi chữ ký/IPN từ cổng.` : 'Cửa hàng sẽ xác nhận đơn trước khi giao. Trạng thái và tiền hàng hiện là dữ liệu demo.'}</p>
          <div className="store-confirm-grid"><span>Tổng tiền gồm phí giao hàng<strong>{money(placedOrder.totalAmount)}</strong></span><span>Dự kiến giao<strong>{placedOrder.eta}</strong></span><span>Mã đơn<strong>{placedOrder.invoiceNo}</strong></span><span>Thanh toán<strong>{paymentMethodLabel(placedOrder.paymentMethod)}</strong></span><span>Điểm thành viên<strong>{placedOrder.memberCustomerId ? 'Dự kiến +' + Number(placedOrder.pointsExpectedOnDelivery || 0).toLocaleString('vi-VN') : 'Không tích điểm'}</strong></span></div>
          <p className={placedOrder.memberCustomerId ? 'store-points-notice' : 'store-guest-points-notice'}>{placedOrder.notice}</p>
          <VnpayQrPanel paymentSession={paymentSession} qrDataUrl={paymentQrDataUrl} qrError={paymentQrError} paymentSyncStatus={paymentSyncStatus} amount={placedOrder.totalAmount} />
          <VietQrTransferPanel paymentSession={paymentSession} amount={placedOrder.totalAmount} />
          {paymentStartError && <button type="button" className="store-button store-button-primary" onClick={retryOnlinePayment} disabled={placing}>{placing ? 'Đang kết nối cổng…' : 'Tiếp tục thanh toán'}</button>}
          <Link className="store-button store-button-primary" to={'/track-order?orderCode=' + encodeURIComponent(placedOrder.invoiceNo) + '&phone=' + encodeURIComponent(form.phone)}>Theo dõi đơn hàng</Link>
          <Link className="store-link-button" to={'/support?orderCode=' + encodeURIComponent(placedOrder.invoiceNo)}>Gặp sự cố thanh toán hoặc đơn hàng? Mở Trung tâm hỗ trợ</Link>
        </section>}

        {checkoutOnly && !placedOrder && <section className="store-checkout-section store-checkout-page" id="checkout">
          <div className="store-checkout-intro"><span className="store-eyebrow">YOUR BASKET</span><h2>Giỏ hàng & giao tận nhà</h2><p>Không cần đăng nhập vẫn đặt được. Chúng tôi cần số điện thoại và địa chỉ cụ thể để cửa hàng xác nhận đơn và shipper giao đúng nơi.</p>
            {member ? <div className="store-member-inline"><strong>EM Club · {member.fullName}</strong><span>{Number(member.loyaltyPoints || 0).toLocaleString('vi-VN')} điểm · hạng {member.memberTier}</span><button type="button" onClick={() => setMemberPanelOpen(true)}>Quản lý thẻ</button></div> : <div className="store-guest-points-notice"><strong>Mua hàng không cần đăng nhập</strong><p>Nếu đặt hàng khi chưa đăng nhập thẻ thành viên, đơn hàng vẫn được nhận nhưng <b>không được tích điểm thành viên</b>. Đăng ký/đăng nhập EM Club trước khi đặt để nhận điểm sau khi giao thành công.</p><button type="button" className="store-link-button" onClick={() => navigate('/login')}>Đăng nhập hoặc đăng ký EM Club <i className="bi bi-arrow-right" aria-hidden="true" /></button></div>}
          </div>
          <div className="store-checkout-card">
            {!cartLines.length ? <div className="store-cart-empty"><span><i className="bi bi-cart3" aria-hidden="true" /></span><h3>Giỏ hàng đang trống</h3><p>Thêm sản phẩm bạn muốn mua rồi nhập thông tin giao hàng bên dưới.</p><Link className="store-button store-button-secondary" to="/#shop">Chọn sản phẩm</Link></div> : <>
              <div className="store-cart-heading"><h3>Đơn hàng của bạn</h3><span>{cartQuantity} sản phẩm</span></div>
              <div className="store-cart-lines">{cartLines.map((line) => <div className="store-cart-line" key={line.productId}><div><strong>{line.product.name}</strong><small>{money(line.product.sellingPrice)} / sản phẩm</small><button type="button" className="store-cart-remove" onClick={() => updateCart(line.productId, -line.quantity)} aria-label={`Xóa ${line.product.name} khỏi giỏ`}>Xóa sản phẩm</button></div><div className="store-cart-qty"><button type="button" onClick={() => updateCart(line.productId, -1)} aria-label={`Giảm số lượng ${line.product.name}`}><i className="bi bi-dash-lg" aria-hidden="true" /></button><span>{line.quantity}</span><button type="button" disabled={line.quantity >= 50} onClick={() => updateCart(line.productId, 1, 50)} aria-label={`Tăng số lượng ${line.product.name}`}><i className="bi bi-plus-lg" aria-hidden="true" /></button></div><strong>{money(line.product.sellingPrice * line.quantity)}</strong></div>)}</div>
              <div className="store-cart-subtotal"><span>Tạm tính</span><strong>{money(subtotal)}</strong></div>
            </>}
            {!checkoutOnly && <button type="button" className="store-checkout-toggle" onClick={() => setCheckoutOpen((current) => !current)}>{checkoutOpen ? 'Thu gọn biểu mẫu đặt hàng' : 'Nhập thông tin và đặt hàng'} <span>{checkoutOpen ? <i className="bi bi-dash-lg" aria-hidden="true" /> : <i className="bi bi-plus-lg" aria-hidden="true" />}</span></button>}
            {checkoutOpen && cartLines.length > 0 && <>
              <form className="store-form store-checkout-form" onSubmit={placeOrder}>
                <div className="store-form-heading"><span className="store-eyebrow">DELIVERY DETAILS</span><h3>Thông tin nhận hàng</h3></div>
                <div className="store-form-grid">
                  <div className="store-field"><label htmlFor="order-name">Họ và tên người nhận *</label><input id="order-name" autoComplete="name" value={form.fullName} onChange={(event) => setForm((current) => ({ ...current, fullName: event.target.value }))} minLength="2" maxLength="100" required /></div>
                  <div className="store-field"><label htmlFor="order-phone">Số điện thoại nhận hàng *</label><input id="order-phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="0905 123 456" value={form.phone} onChange={(event) => { setForm((current) => ({ ...current, phone: event.target.value })); setPhoneVerified(false); setPhoneOtpSent(false); setPhoneOtpCode(''); setPhoneOtpMessage(''); }} maxLength="20" required /><small>Cửa hàng cần số này để xác nhận và shipper liên hệ.</small>
                    {storefrontPolicyConfig?.phoneVerificationRequired === true && <div className="store-field">
                      <button type="button" className="store-button store-button-secondary" onClick={sendCheckoutOtp} disabled={phoneOtpBusy || !form.phone.trim()}>{phoneOtpBusy ? 'Đang gửi OTP…' : phoneOtpSent ? 'Gửi lại OTP' : 'Xác minh số điện thoại bằng OTP'}</button>
                      {phoneOtpSent && <><label htmlFor="checkout-phone-otp">Mã OTP</label><input id="checkout-phone-otp" inputMode="numeric" autoComplete="one-time-code" value={phoneOtpCode} onChange={(event) => setPhoneOtpCode(event.target.value.replace(/\D/g, '').slice(0, 10))} maxLength="10" placeholder="Nhập mã SMS" /><button type="button" className="store-button store-button-secondary" onClick={verifyCheckoutOtp} disabled={phoneOtpBusy || phoneOtpCode.length < 4}>Xác minh OTP</button></>}
                      {phoneOtpMessage && <small role="status">{phoneOtpMessage}</small>}
                      {phoneVerified && <small className="store-inline-good">Số điện thoại đã xác minh.</small>}
                    </div>}
                  </div>
                  <div className="store-field"><label htmlFor="order-email">Email (không bắt buộc)</label><input id="order-email" type="email" autoComplete="email" value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} maxLength="190" /></div>
                  <div className="store-field"><label htmlFor="order-area">Khu vực giao hàng *</label><div className="store-delivery-area-control"><select id="order-area" value={selectedArea?.id || ''} onChange={(event) => { setLocationCoordinates(null); setForm((current) => ({ ...current, deliveryAreaId: event.target.value })); setLocationStatus('Đang dùng mức phí mặc định của khu vực đã chọn.'); }} required><option value="">Chọn khu vực hỗ trợ</option>{areas.map((area) => <option key={area.id} value={area.id}>{area.district}, {area.city} · {money(area.shippingFee)}</option>)}</select><button type="button" className="store-location-button" onClick={locateDeliveryArea} disabled={isLocating || !areas.length}><i className={`bi ${isLocating ? 'bi-hourglass-split' : 'bi-geo-alt'}`} aria-hidden="true" /> {isLocating ? 'Đang định vị…' : 'Dùng vị trí hiện tại'}</button></div>{locationStatus && <small className="store-location-status" role="status">{locationStatus}</small>}</div>
                  <div className="store-field"><label htmlFor="order-ward">Phường / xã *</label><input id="order-ward" value={form.ward} onChange={(event) => setForm((current) => ({ ...current, ward: event.target.value }))} minLength="2" maxLength="100" placeholder="Tên phường / xã" required /></div>
                  <div className="store-field store-field-wide"><label htmlFor="order-address">Số nhà, tên đường, tòa nhà hoặc địa chỉ cụ thể *</label><input id="order-address" autoComplete="street-address" value={form.address} onChange={(event) => setForm((current) => ({ ...current, address: event.target.value }))} minLength="5" maxLength="220" placeholder="Ví dụ: 12 Nguyễn Văn Linh, căn hộ..." required /></div>
                  <div className="store-field store-field-wide"><label htmlFor="order-note">Ghi chú giao hàng (không bắt buộc)</label><textarea id="order-note" rows="2" value={form.note} onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))} maxLength="300" placeholder="Cổng vào, giờ nhận, gọi trước khi đến..." /></div>
                </div>
                <div className="store-privacy-consent">
                  {dataConsentRequired && !dataConsentReady && <div className="notice notice-error" role="alert">Chưa thể đặt hàng: cửa hàng chưa khai báo đầy đủ chủ thể kiểm soát dữ liệu và đầu mối liên hệ pháp lý.</div>}
                  <label className="consent-checkbox"><input type="checkbox" checked={dataProcessingConsent} onChange={(event) => setDataProcessingConsent(event.target.checked)} required={dataConsentRequired} /><span>Bên kiểm soát dữ liệu: <strong>{dataControllerName}</strong>. Tôi đã đọc <Link to="/legal/privacy" target="_blank" rel="noreferrer">Chính sách bảo vệ dữ liệu cá nhân</Link> và đồng ý xử lý thông tin cần thiết cho mục đích tiếp nhận, giao hàng và hỗ trợ đơn này.</span></label>
                  <label className="consent-checkbox"><input type="checkbox" checked={marketingConsent} onChange={(event) => setMarketingConsent(event.target.checked)} /><span>Tôi đồng ý nhận thông tin ưu đãi/tiếp thị. Đây là lựa chọn riêng, không ảnh hưởng việc mua hàng và có thể rút lại.</span></label>
                  <label className="consent-checkbox"><input type="checkbox" checked={locationConsent} onChange={(event) => { setLocationConsent(event.target.checked); if (!event.target.checked) setLocationCoordinates(null); }} /><span>Tôi đồng ý riêng cho phép truy cập vị trí hiện tại để ước tính khu vực và phí giao hàng. Không chọn vẫn có thể nhập khu vực thủ công.</span></label>
                  <div className="store-notification-preferences">
                    <strong>Nhận cập nhật đơn hàng (tùy chọn)</strong>
                    {storefrontPolicyConfig?.notificationChannels?.email && <label className="consent-checkbox"><input type="checkbox" checked={notificationPreferences.email} onChange={(event) => setNotificationPreferences((current) => ({ ...current, email: event.target.checked }))} disabled={!form.email.trim()} /><span>Email đơn hàng và trạng thái giao hàng</span></label>}
                    {storefrontPolicyConfig?.notificationChannels?.sms && <label className="consent-checkbox"><input type="checkbox" checked={notificationPreferences.sms} onChange={(event) => setNotificationPreferences((current) => ({ ...current, sms: event.target.checked }))} /><span>SMS khi nhận đơn, thanh toán thành công và bắt đầu giao</span></label>}
                    {storefrontPolicyConfig?.notificationChannels?.zaloZns && <label className="consent-checkbox"><input type="checkbox" checked={notificationPreferences.zaloZns} onChange={(event) => setNotificationPreferences((current) => ({ ...current, zaloZns: event.target.checked }))} /><span>Zalo ZNS khi có cập nhật đơn hàng</span></label>}
                    {!Object.values(storefrontPolicyConfig?.notificationChannels || {}).some(Boolean) && <small className="store-form-footnote">Kênh email/SMS/Zalo chưa được cấu hình. Hãy theo dõi đơn tại trang Tra cứu đơn hàng.</small>}
                  </div>
                </div>
                <div className="store-delivery-summary"><div><span>Giao đến</span><strong>{selectedArea ? selectedArea.district + ', ' + selectedArea.city : 'Chưa chọn khu vực'}</strong></div><div><span>Thời gian dự kiến</span><strong>{shippingEta}</strong></div><div><span>Phí giao hàng</span><strong>{money(shippingFee)}</strong></div></div><p className="store-form-footnote">{locationCoordinates ? `Phí ước tính theo khoảng cách từ chi nhánh đến vị trí hiện tại${activeDeliveryQuote?.available ? ` (${activeDeliveryQuote.distanceKm.toFixed(1)} km)` : ''}.` : 'Phí mặc định theo khu vực sẽ được dùng khi không sử dụng định vị.'}</p>
                <div className="store-field"><label htmlFor="order-promotion">Mã ưu đãi</label><input id="order-promotion" value={promotionCode} onChange={(event) => setPromotionCode(event.target.value.toUpperCase())} maxLength="32" placeholder="Ví dụ TECH50" />{promotionCode && <small className={promotionAllowed ? 'store-inline-good' : 'store-inline-warning'}>{promotionAllowed ? 'Mã áp dụng: giảm ' + money(promotionDiscount) : activePromotion?.memberOnly && !member ? 'Mã này chỉ dành cho thành viên đăng nhập.' : 'Mã chưa hợp lệ hoặc đơn chưa đạt giá trị tối thiểu.'}</small>}</div>
                {member && Number(member.loyaltyPoints || 0) > 0 && <label className="store-points-check"><input type="checkbox" checked={usePoints} onChange={(event) => setUsePoints(event.target.checked)} /><span>Dùng tối đa {maxRedeemablePoints.toLocaleString('vi-VN')} điểm để giảm {money(maxRedeemablePoints * 100)} <small>Số điểm được trừ khi đặt đơn; sẽ hoàn lại nếu đơn bị hủy.</small></span></label>}
                {!member && <div className="store-guest-points-notice compact"><strong>Chưa đăng nhập thành viên?</strong> Bạn vẫn có thể đặt hàng, nhưng đơn này không được tích điểm. <button type="button" className="store-link-button" onClick={() => navigate('/login')}>Đăng nhập / đăng ký</button></div>}
                <fieldset className="store-payment-options">
                  <legend>Phương thức thanh toán</legend>
                  <label className={paymentMethod === 'cash_on_delivery' ? 'selected' : ''}><input type="radio" name="checkout-payment-method" value="cash_on_delivery" checked={paymentMethod === 'cash_on_delivery'} onChange={() => setPaymentMethod('cash_on_delivery')} /><span><strong>Thanh toán khi nhận hàng</strong><small>COD · Thanh toán cho đơn vị giao hàng</small></span></label>
                  <label className={paymentMethod === 'momo_sandbox' ? 'selected' : ''}><input type="radio" name="checkout-payment-method" value="momo_sandbox" checked={paymentMethod === 'momo_sandbox'} onChange={() => setPaymentMethod('momo_sandbox')} /><span><strong>MoMo Sandbox</strong><small>{paymentGatewayConfig?.methods?.momo?.ready ? 'Tạo giao dịch và callback đã cấu hình' : paymentGatewayConfig?.methods?.momo?.canCreate ? 'Đã cấu hình khóa; callback HTTPS cần hoàn tất' : 'Cần thông tin merchant sandbox để tạo yêu cầu'}</small></span><i className="bi bi-wallet2" aria-hidden="true" /></label>
                  <label className={paymentMethod === 'vnpay_sandbox' ? 'selected' : ''}><input type="radio" name="checkout-payment-method" value="vnpay_sandbox" checked={paymentMethod === 'vnpay_sandbox'} onChange={() => setPaymentMethod('vnpay_sandbox')} /><span><strong>VNPAY QR Sandbox</strong><small>{paymentGatewayConfig?.methods?.vnpay?.ready ? 'Có thể tạo URL ký số và xác nhận qua IPN' : paymentGatewayConfig?.methods?.vnpay?.canCreate ? 'Có thể tạo URL; IPN HTTPS cần hoàn tất' : 'Cần VNPAY TMN Code và Hash Secret trước khi tạo QR'}</small></span><i className="bi bi-bank" aria-hidden="true" /></label>
                  <label className={paymentMethod === 'vietqr_transfer' ? 'selected' : ''}><input type="radio" name="checkout-payment-method" value="vietqr_transfer" checked={paymentMethod === 'vietqr_transfer'} disabled={!paymentGatewayConfig?.methods?.vietqr?.canCreate} onChange={() => setPaymentMethod('vietqr_transfer')} /><span><strong>Chuyển khoản ngân hàng · VietQR</strong><small>{paymentGatewayConfig?.methods?.vietqr?.canCreate ? 'Tự tạo QR có sẵn số tiền và nội dung theo mã đơn' : 'Chưa cấu hình tài khoản nhận tiền tại Admin → Quản trị hệ thống → Tài khoản ngân hàng'}</small></span><i className="bi bi-qr-code" aria-hidden="true" /></label>
                </fieldset>
                {checkoutError && <div className="store-form-error" role="alert">{checkoutError}</div>}
                {checkoutError && <Link className="store-link-button" to="/support">Không xử lý được lỗi này? Gửi yêu cầu hỗ trợ</Link>}
                <div className="store-total-lines"><div><span>Tạm tính</span><strong>{money(subtotal)}</strong></div><div><span>Khuyến mãi + điểm</span><strong>−{money(discounts)}</strong></div><div><span>Phí giao hàng</span><strong>{money(shippingFee)}</strong></div><div className="store-total-final"><span>Tổng cần thanh toán</span><strong>{money(total)}</strong></div></div>
                <div className="store-payment-note"><strong>{paymentMethod === 'cash_on_delivery' ? 'Thanh toán khi nhận hàng (COD)' : `Thanh toán qua ${paymentMethodLabel(paymentMethod)}`}</strong><span>{paymentMethod === 'cash_on_delivery' ? 'Đơn được ghi nhận trên bản demo. Cửa hàng cần xác nhận và cập nhật trạng thái giao hàng.' : paymentMethod === 'vietqr_transfer' ? 'Hệ thống tạo QR chuyển khoản với số tiền và nội dung theo mã đơn. Hiện chưa tích hợp webhook/đối soát ngân hàng tự động.' : paymentMethod === 'vnpay_sandbox' ? 'Sau khi API tạo liên kết thanh toán có chữ ký hợp lệ, trang sẽ hiển thị QR để mở cổng VNPAY. Hệ thống chỉ ghi nhận đã thanh toán sau khi IPN hợp lệ được xác minh.' : 'Bạn sẽ được chuyển tới cổng MoMo thử nghiệm. Đơn chỉ được đánh dấu đã thanh toán sau khi chữ ký/IPN hợp lệ được xác minh.'}</span></div>
                <button type="submit" className="store-button store-button-primary store-button-wide store-place-order" disabled={placing || loading || !cartLines.length || !selectedArea || (storefrontPolicyConfig?.phoneVerificationRequired === true && !phoneVerified) || (dataConsentRequired && (!dataConsentReady || !dataProcessingConsent))}>{placing ? 'Đang xử lý...' : paymentMethod === 'cash_on_delivery' ? 'Đặt hàng · ' + money(total) : 'Tiếp tục thanh toán · ' + money(total)}</button>
                <p className="store-form-footnote">MoMo/VNPAY đang dùng môi trường sandbox. VietQR được cấu hình tại Admin → Quản trị hệ thống → Tài khoản ngân hàng. Mất mã QR hoặc mất mạng: không đặt lại đơn, hãy dùng Tra cứu đơn để khôi phục hướng dẫn.</p>
                <Link className="store-link-button" to="/support">Cần trợ giúp trước khi thanh toán? Xem hướng dẫn xử lý sự cố</Link>
              </form>
            </>}
          </div>
        </section>}

        {!checkoutOnly && cartQuantity > 0 && <section className="store-cart-checkout-cta"><div><span className="store-eyebrow">GIỎ HÀNG CỦA BẠN</span><strong>{cartQuantity} sản phẩm · {money(subtotal)}</strong><p>Sang trang thanh toán riêng để nhập địa chỉ giao hàng và chọn phương thức thanh toán.</p></div><Link className="store-button store-button-primary" to="/checkout">Tiến hành thanh toán <i className="bi bi-arrow-right" aria-hidden="true" /></Link></section>}

        {!checkoutOnly && <>
        <section className="store-delivery-areas" id="delivery-coverage" aria-labelledby="store-delivery-title">
          <div className="store-delivery-intro">
            <div className="store-delivery-heading-row">
              <span className="store-delivery-heading-icon" aria-hidden="true"><i className="bi bi-truck" /></span>
              <div><span className="store-eyebrow">DELIVERY COVERAGE</span><h2 id="store-delivery-title">Khu vực giao hàng hỗ trợ</h2></div>
            </div>
            <p>Dùng vị trí hiện tại để ước tính cự ly và phí giao. Không cấp quyền định vị vẫn có thể xem khu vực và tự chọn nơi nhận hàng khi thanh toán.</p>
            <div className="store-delivery-highlights">
              <span><i className="bi bi-geo-alt" aria-hidden="true" /> {new Set(areas.map((area) => area.city)).size} thành phố</span>
              <span><i className="bi bi-grid" aria-hidden="true" /> {areas.length} khu vực hỗ trợ</span>
              {areas.length > 0 && <span><i className="bi bi-wallet2" aria-hidden="true" /> Phí từ {money(Math.min(...areas.map((area) => Number(area.shippingFee) || 0)))}</span>}
            </div>
          </div>
          <div className="store-area-cities">
            {[...new Set(areas.map((area) => area.city))].map((city, cityIndex) => {
              const cityAreas = areas.filter((area) => area.city === city);
              return <section className="store-area-city" key={city} aria-label={`Khu vực giao hàng tại ${city}`}>
                <div className="store-area-city-heading">
                  <span className="store-area-city-icon" aria-hidden="true"><i className="bi bi-geo-alt-fill" /></span>
                  <div><h3>{city}</h3><small>{cityAreas.length} khu vực giao hàng</small></div>
                  <span className="store-area-city-index">{String(cityIndex + 1).padStart(2, '0')}</span>
                </div>
                <div className="store-area-grid">{cityAreas.map((area) => <div className="store-area-card" key={area.id}>
                  <span className="store-area-pin" aria-hidden="true"><i className="bi bi-geo-alt" /></span>
                  <div className="store-area-details"><strong>{area.district}</strong><small><i className="bi bi-clock" aria-hidden="true" /> {area.eta}</small></div>
                  <div className="store-area-fee"><strong>{money(area.shippingFee)}</strong><small>Phí giao</small></div>
                </div>)}</div>
              </section>;
            })}
          </div>
        </section>
        </>}
      </main>
      <StoreFooter />
      {routeProductId && !selectedProduct && loading && <main className="store-product-page-loading" role="status"><span className="loader" /> Đang tải thông tin sản phẩm…</main>}
      {routeProductId && selectedProduct && <StoreProductPage
        product={selectedProduct}
        products={products}
        selectedArea={selectedArea}
        shippingFee={shippingFee}
        shippingEta={shippingEta}
        locationCoordinates={locationCoordinates}
        locationStatus={locationStatus}
        isLocating={isLocating}
        areas={areas}
        locateDeliveryArea={locateDeliveryArea}
        stockAtBranch={(selectedProduct.inStockByBranch?.[String(selectedArea?.branchId)] ?? selectedProduct.inStock) ? 50 : 0}
        quantityInCart={cart.find((line) => line.productId === selectedProduct.id)?.quantity || 0}
        onSelectDeliveryArea={(areaId) => { setForm((current) => ({ ...current, deliveryAreaId: String(areaId) })); setLocationCoordinates(null); setLocationStatus(''); }}
        updateCart={updateCart}
        buyNow={buyNow}
        wishlistIds={wishlistIds}
        toggleWishlist={toggleWishlist}
        shareProduct={shareProduct}
        member={member}
        memberLoaded={memberLoaded}
        reviewForm={reviewForm}
        setReviewForm={setReviewForm}
        reviewBusy={reviewBusy}
        submitProductReview={submitProductReview}
        reviewStatus={reviewStatus}
      />}
      {selectedProduct && !routeProductId && (() => {
        const product = selectedProduct;
        const images = productImageList(product);
        // Bỏ qua URL ảnh đã lỗi và tự chuyển sang ảnh kế tiếp thay vì để vùng ảnh trống.
        const nextImageIndex = images.findIndex((image, index) => index >= selectedImageIndex && !failedProductImages.includes(image));
        const activeImageIndex = nextImageIndex >= 0 ? nextImageIndex : images.findIndex((image) => !failedProductImages.includes(image));
        const activeImage = activeImageIndex >= 0 ? images[activeImageIndex] : '';
        const stockAtBranch = (product.inStockByBranch?.[String(selectedArea?.branchId)] ?? product.inStock) ? 50 : 0;
        const quantityInCart = cart.find((line) => line.productId === product.id)?.quantity || 0;
        const relatedProducts = [...products.filter((item) => item.id !== product.id && item.storeCategoryKey === product.storeCategoryKey), ...products.filter((item) => item.id !== product.id && item.storeCategoryKey !== product.storeCategoryKey)].slice(0, 8);
        const technicalLines = String(product.technicalDetails || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 24);
        const specs = [
          ['Mã sản phẩm', product.sku || 'Chưa gán mã'],
          ['Thương hiệu', product.brandName || 'Chưa xác định'],
          ['Danh mục', product.categoryName || 'Chưa phân loại'],
          ['Bảo hành', `${product.warrantyMonths || 0} tháng`],
          ['Kho giao hàng', selectedArea ? `${selectedArea.district}, ${selectedArea.city}` : 'Chưa chọn khu vực'],
          ['Số lượng có thể giao', `${stockAtBranch} sản phẩm`],
          ...(product.weight != null ? [['Khối lượng', `${product.weight} kg`]] : []),
          ...(product.dimensions && ['width', 'height', 'depth'].some((key) => product.dimensions[key] != null)
            ? [['Kích thước', ['width', 'height', 'depth'].filter((key) => product.dimensions[key] != null).map((key) => `${key}: ${product.dimensions[key]} cm`).join(' · ')]]
            : []),
        ];
        return <div className="store-product-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeProductDetails(); }}>
          <section className="store-product-modal" role="dialog" aria-modal="true" aria-labelledby="store-product-modal-title">
            <button type="button" className="store-product-modal-close" onClick={closeProductDetails} aria-label="Đóng chi tiết sản phẩm"><i className="bi bi-x-lg" aria-hidden="true" /></button>
            <nav className="store-product-breadcrumb" aria-label="Đường dẫn"><Link to="/">Trang chủ</Link><i className="bi bi-chevron-right" aria-hidden="true" /><Link to="/#shop">Sản phẩm</Link><i className="bi bi-chevron-right" aria-hidden="true" /><span>{product.name}</span></nav>
            <div className="store-product-detail-layout">
              <div className="store-product-detail-gallery">
                <div className="store-product-detail-main-image"><span className="store-product-image-fallback" aria-hidden="true"><i className="bi bi-box-seam" /></span>{activeImage && <img src={activeImage} alt={product.name} onError={() => setFailedProductImages((current) => current.includes(activeImage) ? current : [...current, activeImage])} />}<button type="button" className="store-image-zoom-button" onClick={() => setZoomOpen(true)} disabled={!activeImage} aria-label={`Phóng to ảnh ${product.name}`}><i className="bi bi-arrows-fullscreen" aria-hidden="true" /> Phóng to</button></div>
                {images.length > 1 && <div className="store-product-detail-thumbnails" aria-label="Ảnh sản phẩm">{images.map((image, index) => <button type="button" key={image} className={`${index === activeImageIndex ? 'selected ' : ''}${failedProductImages.includes(image) ? 'image-failed' : ''}`} aria-label={`Xem ảnh ${index + 1} của ${product.name}`} aria-pressed={index === activeImageIndex} onClick={() => setSelectedImageIndex(index)}><span className="store-product-thumbnail-fallback" aria-hidden="true"><i className="bi bi-image" /></span><img src={image} alt="" loading="lazy" onError={() => setFailedProductImages((current) => current.includes(image) ? current : [...current, image])} /></button>)}</div>}
                <div className="store-product-gallery-caption"><i className="bi bi-images" aria-hidden="true" /> {activeImage ? `${images.length} ảnh sản phẩm` : 'Không tải được ảnh sản phẩm'}</div>
              </div>
              <div className="store-product-detail-content">
                <div className="store-product-detail-eyebrow"><span>{product.categoryName || 'Thiết bị điện tử'}</span></div>
                <h1 id="store-product-modal-title">{product.name}</h1>
                <p className="store-product-detail-sku">Mã sản phẩm: {product.sku || 'Chưa gán mã'}</p>
                <div className="store-product-rating store-product-detail-rating"><i className="bi bi-star-fill" aria-hidden="true" /> {product.reviewCount ? `${Number(product.rating).toFixed(1)} / 5 · ${product.reviewCount} đánh giá đã xác minh` : 'Chưa có đánh giá đã xác minh'}</div>
                <div className="store-product-detail-price"><strong>{money(product.sellingPrice)}</strong><span>Giá bán (VNĐ)</span></div>
                <div className="store-product-detail-utilities"><button type="button" className="store-link-button" disabled={!memberLoaded} aria-pressed={wishlistIds.includes(product.id)} onClick={() => toggleWishlist(product.id)} title={!memberLoaded ? 'Đang kiểm tra tài khoản' : !member ? 'Đăng nhập để lưu sản phẩm yêu thích' : undefined}><i className={`bi ${wishlistIds.includes(product.id) ? 'bi-heart-fill' : 'bi-heart'}`} aria-hidden="true" /> {wishlistIds.includes(product.id) ? 'Đã lưu yêu thích' : 'Thêm yêu thích'}</button><button type="button" className="store-link-button" onClick={() => shareProduct(product)}><i className="bi bi-share" aria-hidden="true" /> Chia sẻ sản phẩm</button><Link className="store-product-full-page-link" to={productPath(product)}>Mở trang sản phẩm đầy đủ <i className="bi bi-arrow-up-right" aria-hidden="true" /></Link></div>
                <section className="store-product-detail-section"><h3>Mô tả sản phẩm</h3><p>{product.description?.trim() || 'Cửa hàng chưa cập nhật mô tả cho sản phẩm này.'}</p></section>
                <section className="store-product-detail-section"><h3>Thông tin sản phẩm</h3><dl className="store-product-spec-grid">{specs.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></section>
                {technicalLines.length > 0 && <section className="store-product-detail-section"><h3>Thông số do cửa hàng cung cấp</h3><dl className="store-product-custom-specs">{technicalLines.map((line, index) => { const separator = line.indexOf(':'); return <div key={`${line}-${index}`}><dt>{separator > 0 ? line.slice(0, separator).trim() : `Thông số ${index + 1}`}</dt><dd>{separator > 0 ? line.slice(separator + 1).trim() : line}</dd></div>; })}</dl></section>}
                {product.tags?.length > 0 && <section className="store-product-detail-section"><h3>Từ khóa</h3><div className="store-product-tags">{product.tags.map((tag) => <span key={tag}>{tag}</span>)}</div></section>}
                <section className="store-product-detail-section store-product-policies"><h3>Bảo hành, giao hàng và đổi trả</h3><dl className="store-product-custom-specs"><div><dt>Bảo hành</dt><dd>{product.warrantyInformation || (Number(product.warrantyMonths) > 0 ? `${product.warrantyMonths} tháng theo hồ sơ sản phẩm` : 'Chưa có chính sách bảo hành riêng được cấu hình.')}</dd></div><div><dt>Giao hàng</dt><dd>{product.shippingInformation || 'Phí và thời gian giao dự kiến được hiển thị theo khu vực; cửa hàng cần xác nhận trước khi giao.'}</dd></div><div><dt>Đổi trả</dt><dd>{product.returnPolicy || 'Chưa có chính sách đổi trả riêng được cấu hình. Vui lòng xác nhận điều kiện với cửa hàng trước khi mua.'}</dd></div></dl></section>
                <section className="store-product-detail-section"><h3>Giao hàng tại khu vực đã chọn</h3><div className="store-product-shipping-summary"><div><i className="bi bi-truck" aria-hidden="true" /><span><small>Khu vực</small><strong>{selectedArea ? `${selectedArea.district}, ${selectedArea.city}` : 'Chưa chọn'}</strong></span></div><div><i className="bi bi-clock" aria-hidden="true" /><span><small>Dự kiến</small><strong>{shippingEta}</strong></span></div><div><i className="bi bi-cash-coin" aria-hidden="true" /><span><small>Phí giao hàng</small><strong>{money(shippingFee)}</strong></span></div></div><button type="button" className="store-link-button store-product-locate-button" onClick={locateDeliveryArea} disabled={isLocating || !areas.length}><i className={`bi ${isLocating ? 'bi-hourglass-split' : 'bi-geo-alt'}`} aria-hidden="true" /> {isLocating ? 'Đang định vị…' : 'Tính phí theo vị trí hiện tại'}</button>{locationStatus && <p className="store-location-status" role="status">{locationStatus}</p>}<p className="store-product-api-disclaimer">{locationCoordinates ? 'Phí ước tính theo vị trí hiện tại.' : 'Phí mặc định theo khu vực đã chọn.'}</p></section>
                <div className="store-product-detail-actions"><div className="store-product-detail-stock"><span className={stockAtBranch > quantityInCart ? 'store-stock-ready' : 'store-stock-empty'}><i className={`bi ${stockAtBranch > quantityInCart ? 'bi-check-circle' : 'bi-exclamation-circle'}`} aria-hidden="true" /> {stockAtBranch > 0 ? `${stockAtBranch} sản phẩm tại khu vực đang chọn` : 'Chưa có hàng tại khu vực đang chọn'}</span>{quantityInCart > 0 && <span>{quantityInCart} trong giỏ</span>}</div><div className="store-product-detail-buttons"><button type="button" className="store-button store-button-secondary store-product-detail-add" disabled={stockAtBranch <= quantityInCart} onClick={() => updateCart(product.id, 1, stockAtBranch)}><i className="bi bi-cart-plus" aria-hidden="true" /> {stockAtBranch <= quantityInCart ? 'Hết số lượng có thể thêm' : 'Thêm vào giỏ'}</button><button type="button" className="store-button store-button-primary store-product-detail-add" disabled={stockAtBranch <= quantityInCart} onClick={() => buyNow(product, stockAtBranch)}>Mua ngay <i className="bi bi-arrow-right" aria-hidden="true" /></button></div></div>
                <section className="store-product-detail-section store-verified-reviews"><div className="store-reviews-heading"><div><h3>Đánh giá khách hàng</h3><p>{product.reviewCount ? `${product.reviewCount} đánh giá từ đơn đã giao thành công` : 'Chưa có đánh giá đã xác minh cho sản phẩm này.'}</p></div>{product.reviewCount > 0 && <strong><i className="bi bi-star-fill" aria-hidden="true" /> {Number(product.rating).toFixed(1)} / 5</strong>}</div>
                  {(product.reviews || []).filter((review) => review.verifiedPurchase).map((review) => <article className="store-verified-review" key={review.id}><div><strong>{review.reviewerName}</strong><span>{'★'.repeat(Math.max(0, Math.min(5, Number(review.rating) || 0)))}{'☆'.repeat(5 - Math.max(0, Math.min(5, Number(review.rating) || 0)))}</span><time dateTime={review.createdAt}>{new Date(review.createdAt).toLocaleDateString('vi-VN')}</time></div><h4>{review.title}</h4><p>{review.body}</p><small><i className="bi bi-patch-check-fill" aria-hidden="true" /> Đã xác minh đơn mua</small></article>)}
                  {member ? <form className="store-review-form" onSubmit={(event) => submitProductReview(event, product)}><h4>Viết đánh giá</h4><p>Chỉ đánh giá được chấp nhận khi tài khoản có đơn chứa sản phẩm này đã giao thành công; mỗi khách hàng đánh giá một lần.</p><label><span>Số sao</span><select required value={reviewForm.rating} onChange={(event) => setReviewForm((current) => ({ ...current, rating: Number(event.target.value) }))}><option value={5}>5 sao — Rất tốt</option><option value={4}>4 sao — Tốt</option><option value={3}>3 sao — Bình thường</option><option value={2}>2 sao — Chưa tốt</option><option value={1}>1 sao — Không hài lòng</option></select></label><label><span>Tiêu đề</span><input required minLength={3} maxLength={120} value={reviewForm.title} onChange={(event) => setReviewForm((current) => ({ ...current, title: event.target.value }))} placeholder="Điểm nổi bật của sản phẩm" /></label><label><span>Nội dung</span><textarea required minLength={10} maxLength={2000} rows={3} value={reviewForm.body} onChange={(event) => setReviewForm((current) => ({ ...current, body: event.target.value }))} placeholder="Chia sẻ trải nghiệm sử dụng thực tế của bạn" /></label><button type="submit" className="store-button store-button-primary" disabled={reviewBusy}>{reviewBusy ? 'Đang gửi…' : 'Gửi đánh giá'}</button></form> : <p className="store-review-signin">Đăng nhập tài khoản khách hàng để gửi đánh giá sau khi đơn hàng đã giao thành công. <Link to="/login">Đăng nhập</Link></p>}
                  {reviewStatus && <p className="store-location-status" role="status">{reviewStatus}</p>}
                </section>
                {relatedProducts.length > 0 && <section className="store-product-detail-section store-related-products"><h3>Sản phẩm cùng danh mục</h3><div className="store-related-grid">{relatedProducts.map((item) => <button type="button" className="store-related-card" key={item.id} onClick={() => openProductDetails(item)}><img src={item.thumbnail || item.imageUrl || item.images?.[0] || ''} alt="" loading="lazy" /><span>{item.name}</span><strong>{money(item.sellingPrice)}</strong></button>)}</div></section>}
              </div>
            </div>
          </section>
        </div>;
      })()}
      {zoomOpen && selectedProduct && !routeProductId && <div className="store-image-zoom-backdrop" role="dialog" aria-modal="true" aria-label={`Ảnh phóng to ${selectedProduct.name}`} onMouseDown={(event) => { if (event.target === event.currentTarget) setZoomOpen(false); }}><button type="button" className="store-image-zoom-close" onClick={() => setZoomOpen(false)} aria-label="Đóng ảnh phóng to"><i className="bi bi-x-lg" aria-hidden="true" /></button>{(() => { const zoomImages = productImageList(selectedProduct); const zoomImage = zoomImages.slice(selectedImageIndex).find((image) => !failedProductImages.includes(image)) || zoomImages.find((image) => !failedProductImages.includes(image)); return zoomImage ? <img src={zoomImage} alt={selectedProduct.name} /> : <p role="status">Không tải được ảnh sản phẩm.</p>; })()}</div>}
      {memberPanelOpen && <MemberPanel member={member} onClose={() => setMemberPanelOpen(false)} onMemberChange={(value) => { setMember(value); if (!value) setUsePoints(false); }} />}
    </div>
  );
}

export function MemberPortalPage(props) {
  return <StorefrontPage {...props} initialSection="member" />;
}

export function PaymentReturnPage({ user = null, authReady = true, onLogout = () => {}, workspacePath = '/', roleLabel = '' } = {}) {
  const params = new URLSearchParams(window.location.search);
  const paymentId = params.get('paymentId') || '';
  // Payment token is carried in the URL fragment as a tab-safe fallback; fragments are not sent to the server.
  const fragmentToken = new URLSearchParams(String(window.location.hash || '').replace(/^#/, '')).get('paymentToken') || '';
  const [pending, setPending] = useState(() => {
    try {
      const stored = JSON.parse(window.sessionStorage.getItem(PENDING_PAYMENT_KEY) || 'null');
      return stored ? { ...stored, paymentId: stored.paymentId || paymentId, token: stored.token || fragmentToken } : { paymentId, token: fragmentToken };
    } catch { return { paymentId, token: fragmentToken }; }
  });
  const token = String(pending?.token || '');
  const [state, setState] = useState('checking');
  const [payment, setPayment] = useState(null);
  const [error, setError] = useState('');
  const [retryVersion, setRetryVersion] = useState(0);

  useEffect(() => {
    let active = true;
    let timer = null;
    const wait = () => new Promise((resolve) => { timer = window.setTimeout(resolve, 2000); });

    async function verifyPayment() {
      if (!paymentId || !/^[a-f0-9]{64}$/i.test(token)) {
        setState('invalid');
        setError('Liên kết xác minh thanh toán không hợp lệ hoặc đã thiếu thông tin.');
        return;
      }
      setState('checking');
      setError('');
      for (let attempt = 0; attempt < 15 && active; attempt += 1) {
        try {
          const result = await paymentApiRequest(`/api/payments/status/${encodeURIComponent(paymentId)}`, { headers: { 'X-Payment-Token': token } });
          if (!active) return;
          setPayment(result);
          if ((pending?.paymentId && pending.paymentId !== paymentId) || (pending?.invoiceNo && pending.invoiceNo !== result.orderId)) {
            setState('invalid');
            setError('Mã đơn hàng không khớp với giao dịch thanh toán.');
            return;
          }
          if (result.status === 'paid' || result.status === 'failed') {
            const syncResult = await dataRequest('/store/orders/sync-payment', { method: 'POST', headers: { 'X-Payment-Token': token }, body: { paymentId } });
            if (!active) return;
            try { window.sessionStorage.removeItem(PENDING_PAYMENT_KEY); } catch { /* Không giữ thông tin thanh toán trong bộ nhớ lâu hơn cần thiết. */ }
            if (window.location.hash) window.history.replaceState({}, '', `${window.location.pathname}${window.location.search}`);
            setPending((current) => current ? { ...current, invoiceNo: result.orderId } : { invoiceNo: result.orderId });
            setState(syncResult.status === 'manual_review' ? 'review' : result.status);
            return;
          }
          setState(attempt === 14 ? 'pending' : 'checking');
        } catch (requestError) {
          if (!active) return;
          setError(requestError.message || 'Chưa kiểm tra được trạng thái giao dịch.');
          setState('unavailable');
          return;
        }
        if (attempt < 14 && active) await wait();
      }
    }

    verifyPayment();
    return () => {
      active = false;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [paymentId, token, retryVersion]);

  const title = state === 'paid' ? 'Thanh toán sandbox thành công'
    : state === 'review' ? 'Đã nhận tiền · cần đối soát đơn hàng'
    : state === 'failed' ? 'Thanh toán chưa thành công'
      : state === 'invalid' ? 'Không xác minh được giao dịch'
        : state === 'pending' ? 'Đang chờ xác nhận từ cổng thanh toán'
          : state === 'unavailable' ? 'Chưa kiểm tra được trạng thái'
            : 'Đang xác minh thanh toán…';

  return <div className="storefront store-secondary-page"><StoreHeader cartCount={0} user={user} authReady={authReady} onLogout={onLogout} workspacePath={workspacePath} roleLabel={roleLabel} member={null} onShowMember={() => { window.location.href = user?.role === 'customer' ? '/member' : '/login'; }} showCategories={false} showSearch={false} /><StoreNetworkStatus />
    <main className="store-track-page store-payment-return-page">
      <div className="store-payment-result-icon"><i className={`bi ${state === 'paid' ? 'bi-check-circle' : state === 'failed' || state === 'invalid' ? 'bi-exclamation-circle' : 'bi-shield-check'}`} aria-hidden="true" /></div>
      <span className="store-eyebrow">PAYMENT GATEWAY · SANDBOX</span>
      <h1>{title}</h1>
      {payment?.orderId && <p>Mã đơn <strong>{payment.orderId}</strong> · Số tiền <strong>{money(payment.amount)}</strong></p>}
      {state === 'checking' && <p>Đang đợi thông báo thanh toán có chữ ký hợp lệ. Không đóng cửa sổ này trong khi hệ thống đang kiểm tra.</p>}
      {state === 'pending' && <p>Cổng chưa gửi xác nhận cuối cùng. Hệ thống chưa ghi nhận đơn là đã thanh toán. Bạn có thể kiểm tra lại trạng thái.</p>}
      {state === 'paid' && <p>Máy chủ đã xác minh trạng thái thanh toán qua callback/IPN. Đơn hàng tiếp tục chờ cửa hàng xác nhận trước khi giao.</p>}
      {state === 'review' && <p>Cổng thanh toán báo đã thu tiền, nhưng đơn hàng đã hết hạn hoặc đã bị hủy trước đó. Hệ thống giữ nguyên trạng thái hủy, không xuất kho và chuyển giao dịch sang đối soát/hoàn tiền thủ công. Hãy liên hệ hỗ trợ, không đặt lại đơn này.</p>}
      {state === 'failed' && <p>Giao dịch không được hoàn tất. Đơn đã được hủy trong bản demo và tồn kho/điểm đã dùng được hoàn lại theo điều kiện.</p>}
      {(state === 'invalid' || state === 'unavailable') && error && <div className="store-form-error" role="alert">{error}</div>}
      {(state === 'pending' || state === 'unavailable') && <button type="button" className="store-button store-button-primary" onClick={() => setRetryVersion((version) => version + 1)}>Kiểm tra lại</button>}
      {state === 'paid' && pending?.phone && <Link className="store-button store-button-primary" to={`/track-order?orderCode=${encodeURIComponent(payment?.orderId || pending.invoiceNo || '')}&phone=${encodeURIComponent(pending.phone)}`}>Theo dõi đơn hàng</Link>}
      {(state === 'invalid' || state === 'unavailable' || state === 'pending' || state === 'review') && <Link className="store-button store-button-secondary" to="/support">Gặp sự cố? Liên hệ hỗ trợ EMSystems</Link>}
      <Link className="store-link-button" to="/"><i className="bi bi-arrow-left" aria-hidden="true" /> Quay lại cửa hàng</Link>
      <p className="store-form-footnote">Đây là môi trường sandbox. Trạng thái hoàn tất chỉ được cập nhật sau khi server xác minh thông báo của cổng thanh toán.</p>
    </main>
    <StoreFooter />
  </div>;
}

const SUPPORT_STATUS_TEXT = {
  new: 'Đã tiếp nhận', in_progress: 'Đang xử lý', waiting_customer: 'Chờ khách bổ sung thông tin',
  resolved: 'Đã giải quyết', closed: 'Đã đóng',
};

export function HelpSupportPage({ user = null } = {}) {
  const initialOrderCode = new URLSearchParams(window.location.search).get('orderCode') || '';
  const [form, setForm] = useState({
    fullName: user?.fullName || '', phone: user?.phone || '', email: user?.email || '',
    orderCode: initialOrderCode.toUpperCase(), category: 'payment_qr', message: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [submitted, setSubmitted] = useState(null);
  const [caseCode, setCaseCode] = useState('');
  const [lookupPhone, setLookupPhone] = useState(user?.phone || '');
  const [lookupBusy, setLookupBusy] = useState(false);
  const [lookupError, setLookupError] = useState('');
  const [ticket, setTicket] = useState(null);
  const [supportDataConsent, setSupportDataConsent] = useState(false);
  const [supportConsentRequired, setSupportConsentRequired] = useState(false);
  const [supportConsentReady, setSupportConsentReady] = useState(true);
  const [supportDataControllerName, setSupportDataControllerName] = useState('chủ thể kinh doanh chưa khai báo');

  useEffect(() => {
    dataRequest('/config/public').then((result) => {
      setSupportConsentRequired(result.dataConsentRequired === true);
      setSupportConsentReady(result.dataConsentReady === true);
      setSupportDataControllerName(result.legalBusiness?.operatorName || 'chủ thể kinh doanh chưa khai báo');
    }).catch(() => { setSupportConsentRequired(false); setSupportConsentReady(false); });
  }, []);

  async function submitSupportRequest(event) {
    event.preventDefault();
    setSubmitting(true);
    setSubmitError('');
    setSubmitted(null);
    try {
      const result = await dataRequest('/store/support/requests', { method: 'POST', body: { ...form, dataProcessingConsent: supportDataConsent } });
      setSubmitted(result.data);
      setCaseCode(result.data.caseCode);
      setTicket(null);
      setForm((current) => ({ ...current, message: '' }));
    } catch (requestError) {
      setSubmitError(requestError.message || 'Không gửi được yêu cầu. Hãy kiểm tra kết nối và thử lại.');
    } finally {
      setSubmitting(false);
    }
  }

  async function trackSupportRequest(event) {
    event.preventDefault();
    setLookupBusy(true);
    setLookupError('');
    setTicket(null);
    try {
      const result = await dataRequest(`/store/support/track?caseCode=${encodeURIComponent(caseCode.trim().toUpperCase())}&phone=${encodeURIComponent(lookupPhone.trim())}`);
      setTicket(result.ticket);
    } catch (requestError) {
      setLookupError(requestError.message || 'Không tra cứu được yêu cầu hỗ trợ.');
    } finally {
      setLookupBusy(false);
    }
  }

  return <div className="storefront store-secondary-page">
    <StoreHeader cartCount={readCart().reduce((total, item) => total + item.quantity, 0)} user={user} authReady member={null} onShowMember={() => { window.location.href = user ? '/member' : '/login'; }} showCategories={false} showSearch={false} />
    <StoreNetworkStatus />
    <main className="store-support-page">
      <header className="store-support-hero">
        <span className="store-eyebrow">EMSYSTEMS CUSTOMER CARE</span>
        <h1>Trung tâm hỗ trợ khách hàng</h1>
        <p>Mất mã QR, lỗi mạng, không mở được cổng thanh toán hay đơn hàng chưa cập nhật? Bắt đầu từ hướng dẫn bên dưới. Bạn có thể khôi phục thanh toán hoặc gửi yêu cầu để cửa hàng theo dõi.</p>
        <div className="store-support-hero-actions"><Link className="store-button store-button-primary" to="/track-order"><i className="bi bi-search" aria-hidden="true" /> Tra cứu / khôi phục đơn</Link><a className="store-button store-button-light" href="#send-support-request">Gửi yêu cầu hỗ trợ</a></div>
      </header>

      <section className="store-support-guides" aria-label="Hướng dẫn xử lý sự cố thường gặp">
        <article className="store-support-guide"><span className="store-support-guide-icon"><i className="bi bi-qr-code-scan" aria-hidden="true" /></span><div><h2>Không quét được mã QR</h2><ul><li>Tăng độ sáng màn hình, lau camera và giữ mã QR nằm trọn trong khung.</li><li>Mở chức năng quét QR bên trong ứng dụng ngân hàng, không dùng trình quét mã vạch thông thường.</li><li>Nếu đang mở website trên cùng điện thoại, hãy chọn nút mở hướng dẫn thanh toán hoặc dùng thiết bị thứ hai để quét.</li><li>Kiểm tra ngân hàng, số tài khoản, số tiền và nội dung chuyển khoản trước khi xác nhận.</li></ul></div></article>
        <article className="store-support-guide"><span className="store-support-guide-icon"><i className="bi bi-window-x" aria-hidden="true" /></span><div><h2>Mất QR, đóng nhầm tab hoặc mất mạng</h2><ul><li>Không tạo đơn mua hàng mới chỉ vì mất mã QR.</li><li>Mở Tra cứu đơn, nhập mã WEB và số điện thoại nhận hàng để lấy lại hướng dẫn thanh toán của đơn hiện tại.</li><li>Với MoMo/VNPAY, nếu phiên thanh toán đã hết hạn, hệ thống sẽ cho tạo lại phiên trên đơn cũ khi đơn vẫn còn chờ thanh toán.</li><li>VietQR được khôi phục theo đúng số tiền và nội dung của đơn; không tự sửa nội dung chuyển khoản.</li></ul><Link to="/track-order">Đi tới khôi phục mã thanh toán <i className="bi bi-arrow-right" aria-hidden="true" /></Link></div></article>
        <article className="store-support-guide"><span className="store-support-guide-icon"><i className="bi bi-bank" aria-hidden="true" /></span><div><h2>Đã bị trừ tiền nhưng đơn vẫn chờ</h2><ul><li>Không thanh toán lần thứ hai và không tạo đơn mới.</li><li>Lưu biên lai, thời gian, số tiền và mã giao dịch do ngân hàng/ví cung cấp.</li><li>MoMo/VNPAY chỉ được cập nhật sau khi máy chủ xác minh callback/IPN hợp lệ. Hãy tra cứu lại đơn sau ít phút.</li><li>VietQR cần cửa hàng đối soát biến động tài khoản thủ công; gửi yêu cầu hỗ trợ và đính kèm thông tin giao dịch, không gửi OTP hoặc mật khẩu.</li></ul></div></article>
        <article className="store-support-guide"><span className="store-support-guide-icon"><i className="bi bi-exclamation-triangle" aria-hidden="true" /></span><div><h2>Sai số tiền, sai nội dung hoặc ứng dụng ngân hàng báo lỗi</h2><ul><li>Không xác nhận chuyển khoản khi số tiền, tài khoản nhận hoặc nội dung không khớp.</li><li>Nếu đã chuyển sai/thiếu tiền hoặc quên nội dung, giữ biên lai và gửi yêu cầu kèm mã đơn để nhân viên kiểm tra.</li><li>Nếu website báo lỗi mạng, kiểm tra lại kết nối rồi tra cứu mã đơn trước khi thử thanh toán lại.</li></ul></div></article>
      </section>

      <section className="store-support-safety"><i className="bi bi-shield-lock-fill" aria-hidden="true" /><div><strong>EMSystems không yêu cầu mật khẩu ngân hàng, mã OTP, PIN thẻ hoặc mã đăng nhập ví điện tử.</strong><p>Chỉ cung cấp mã đơn, số điện thoại nhận hàng và mã giao dịch/biên lai đã che thông tin nhạy cảm khi cần đối soát. Không chuyển tiền vào tài khoản khác với thông tin hiển thị ở đơn hàng.</p></div></section>

      <section className="store-support-contact-grid">
        <section className="store-support-form-card" id="send-support-request">
          <span className="store-eyebrow">CREATE A SUPPORT CASE</span><h2>Gửi yêu cầu hỗ trợ</h2><p>Yêu cầu được lưu vào hệ thống và có mã để tra cứu. Nhân viên sẽ cập nhật phản hồi tại đây.</p>
          {submitted && <div className="store-support-created" role="status"><i className="bi bi-check-circle-fill" aria-hidden="true" /><div><strong>Đã nhận yêu cầu {submitted.caseCode}</strong><p>Hãy lưu mã hỗ trợ và số điện thoại đã cung cấp để kiểm tra phản hồi.</p><button type="button" className="store-link-button" onClick={() => { setCaseCode(submitted.caseCode); document.getElementById('track-support-case')?.scrollIntoView({ behavior: 'smooth' }); }}>Tra cứu yêu cầu này</button></div></div>}
          {submitError && <div className="store-form-error" role="alert">{submitError}</div>}
          {supportConsentRequired && !supportConsentReady && <div className="notice notice-error" role="alert">Chưa thể gửi yêu cầu: cửa hàng chưa khai báo đầy đủ chủ thể kiểm soát dữ liệu và đầu mối liên hệ.</div>}
          <form className="store-form" onSubmit={submitSupportRequest}>
            <div className="store-field"><label htmlFor="support-full-name">Họ tên liên hệ *</label><input id="support-full-name" value={form.fullName} onChange={(event) => setForm((current) => ({ ...current, fullName: event.target.value }))} minLength={2} maxLength={100} autoComplete="name" required /></div>
            <div className="store-field"><label htmlFor="support-phone">Số điện thoại đã đặt hàng *</label><input id="support-phone" type="tel" inputMode="tel" value={form.phone} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} autoComplete="tel" placeholder="0905 123 456" required /></div>
            <div className="store-field"><label htmlFor="support-email">Email (không bắt buộc)</label><input id="support-email" type="email" value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} autoComplete="email" maxLength={190} /></div>
            <div className="store-field"><label htmlFor="support-order-code">Mã đơn hàng (nếu có)</label><input id="support-order-code" value={form.orderCode} onChange={(event) => setForm((current) => ({ ...current, orderCode: event.target.value.toUpperCase() }))} placeholder="WEB-00001" maxLength={20} /></div>
            <div className="store-field"><label htmlFor="support-category">Nhóm vấn đề *</label><select id="support-category" value={form.category} onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))}><option value="payment_qr">Không quét được QR / mất mã</option><option value="payment_pending">Đã trả tiền nhưng đơn chưa cập nhật</option><option value="payment_mismatch">Sai số tiền / nội dung chuyển khoản</option><option value="website_error">Lỗi website / mất kết nối</option><option value="order_delivery">Đơn hàng / giao hàng</option><option value="product">Sản phẩm</option><option value="other">Vấn đề khác</option></select></div>
            <div className="store-field"><label htmlFor="support-message">Mô tả sự cố *</label><textarea id="support-message" rows={5} minLength={10} maxLength={2000} value={form.message} onChange={(event) => setForm((current) => ({ ...current, message: event.target.value }))} placeholder="Nêu bước đã thực hiện, thông báo lỗi, thời điểm xảy ra và mã giao dịch nếu có. Không nhập OTP/mật khẩu." required /></div>
            <label className="consent-checkbox"><input type="checkbox" checked={supportDataConsent} onChange={(event) => setSupportDataConsent(event.target.checked)} required={supportConsentRequired} /><span>Bên kiểm soát dữ liệu: <strong>{supportDataControllerName}</strong>. Tôi đã đọc <Link to="/legal/privacy" target="_blank" rel="noreferrer">Chính sách bảo vệ dữ liệu cá nhân</Link> và đồng ý xử lý thông tin liên hệ/nội dung yêu cầu để tiếp nhận, xác minh và phản hồi hỗ trợ.</span></label>
            <button type="submit" className="store-button store-button-primary store-button-wide" disabled={submitting || (supportConsentRequired && (!supportConsentReady || !supportDataConsent))}>{submitting ? 'Đang gửi yêu cầu...' : 'Gửi yêu cầu hỗ trợ'}</button>
          </form>
        </section>

        <section className="store-support-track-card" id="track-support-case">
          <span className="store-eyebrow">TRACK A SUPPORT CASE</span><h2>Tra cứu phản hồi</h2><p>Nhập mã HT- được cấp sau khi gửi yêu cầu cùng số điện thoại liên hệ. Chỉ người có đủ hai thông tin này mới xem được nội dung phản hồi.</p>
          <form className="store-form" onSubmit={trackSupportRequest}>
            <div className="store-field"><label htmlFor="support-case-code">Mã hỗ trợ *</label><input id="support-case-code" value={caseCode} onChange={(event) => { setCaseCode(event.target.value.toUpperCase()); setTicket(null); }} placeholder="HT-00001" required /></div>
            <div className="store-field"><label htmlFor="support-track-phone">Số điện thoại liên hệ *</label><input id="support-track-phone" type="tel" value={lookupPhone} onChange={(event) => { setLookupPhone(event.target.value); setTicket(null); }} required /></div>
            <button className="store-button store-button-secondary store-button-wide" type="submit" disabled={lookupBusy}>{lookupBusy ? 'Đang tra cứu...' : 'Tra cứu yêu cầu'}</button>
          </form>
          {lookupError && <div className="store-form-error" role="alert">{lookupError}</div>}
          {ticket && <article className="store-support-ticket-result" aria-live="polite"><div><span>Trạng thái</span><strong>{SUPPORT_STATUS_TEXT[ticket.status] || ticket.status}</strong></div><div><span>Nhóm vấn đề</span><strong>{ticket.category}</strong></div><p>{ticket.message}</p>{ticket.publicReply ? <blockquote><strong>Phản hồi từ EMSystems</strong><p>{ticket.publicReply}</p></blockquote> : <small>Yêu cầu đã lưu. Cửa hàng chưa gửi phản hồi công khai.</small>}<small>Cập nhật: {new Date(ticket.updatedAt).toLocaleString('vi-VN')}</small></article>}
          <div className="store-support-fallback"><strong>Chưa có mã hỗ trợ?</strong><p>Gửi biểu mẫu bên trái. Nếu website đang lỗi hoặc mạng không ổn định, hãy giữ lại mã đơn trên hóa đơn hoặc ảnh chụp màn hình đã che thông tin nhạy cảm để gửi lại khi kết nối phục hồi.</p><Link to="/track-order">Mở tra cứu đơn hàng</Link></div>
        </section>
      </section>
    </main>
    <StoreFooter />
  </div>;
}

export function TrackOrderPage({ user = null, authReady = true, onLogout = () => {}, workspacePath = '/', roleLabel = '' } = {}) {
  const [initialLookup] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return { orderCode: params.get('orderCode') || '', phone: params.get('phone') || '' };
  });
  const [orderCode, setOrderCode] = useState(initialLookup.orderCode.toUpperCase());
  const [phone, setPhone] = useState(initialLookup.phone);
  const [order, setOrder] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [recoverySession, setRecoverySession] = useState(null);
  const [recoveryState, setRecoveryState] = useState('');
  const [recoveryError, setRecoveryError] = useState('');
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [recoveryQrDataUrl, setRecoveryQrDataUrl] = useState('');
  const [recoverySyncStatus, setRecoverySyncStatus] = useState('pending');
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelReason, setCancelReason] = useState('Đổi ý, không còn nhu cầu mua');
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelError, setCancelError] = useState('');
  const [cancelSuccess, setCancelSuccess] = useState('');

  async function handleCustomerCancel() {
    setCancelBusy(true);
    setCancelError('');
    try {
      const res = await dataRequest('/store/orders/cancel', {
        method: 'POST',
        body: { orderCode: order.invoiceNo, phone: phone.trim(), reason: cancelReason },
      });
      setShowCancelModal(false);
      setCancelSuccess(res.message || 'Đã hủy đơn hàng thành công.');
      await lookupOrder(order.invoiceNo, phone.trim());
    } catch (err) {
      setCancelError(err.message || 'Không thể hủy đơn hàng.');
    } finally {
      setCancelBusy(false);
    }
  }

  async function lookupOrder(code, recipientPhone) {
    setBusy(true);
    setError('');
    setOrder(null);
    setRecoverySession(null);
    setRecoveryState('');
    setRecoveryError('');
    try {
      const result = await dataRequest('/store/orders/track?orderCode=' + encodeURIComponent(code) + '&phone=' + encodeURIComponent(recipientPhone));
      setOrder(result.order);
    } catch (requestError) {
      setError(requestError.message || 'Không tra cứu được đơn.');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!initialLookup.orderCode.trim() || !initialLookup.phone.trim()) return undefined;
    let active = true;
    setBusy(true);
    setError('');
    dataRequest('/store/orders/track?orderCode=' + encodeURIComponent(initialLookup.orderCode) + '&phone=' + encodeURIComponent(initialLookup.phone))
      .then((result) => { if (active) setOrder(result.order); })
      .catch((requestError) => { if (active) setError(requestError.message || 'Không tra cứu được đơn.'); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [initialLookup]);

  async function track(event) {
    event.preventDefault();
    await lookupOrder(orderCode.trim().toUpperCase(), phone.trim());
  }

  async function recoverPaymentInstructions() {
    if (!order || !phone.trim()) return;
    setRecoveryBusy(true);
    setRecoveryError('');
    setRecoverySession(null);
    setRecoveryState('checking');
    setRecoveryQrDataUrl('');
    try {
      const result = await paymentApiRequest('/api/payments/recover', {
        method: 'POST', body: { orderCode: order.invoiceNo, phone: phone.trim() },
      });
      setRecoveryState(result.recoveryState || 'closed');
      if (result.recoveryState === 'resumable') {
        setRecoverySession(result);
        setRecoverySyncStatus('pending');
      } else if (result.recoveryState === 'paid') {
        setRecoveryError(result.message || 'Giao dịch đã thanh toán. Hãy tải lại trạng thái đơn.');
        await lookupOrder(order.invoiceNo, phone.trim());
      } else if (result.recoveryState === 'create_new') {
        setRecoveryError(result.message || 'Đơn hàng vẫn chờ thanh toán.');
      } else {
        setRecoveryError(result.message || 'Đơn hàng không còn chờ thanh toán.');
      }
    } catch (requestError) {
      setRecoveryState('error');
      setRecoveryError(requestError.message || 'Không thể khôi phục hướng dẫn thanh toán. Hãy thử lại hoặc gửi yêu cầu hỗ trợ.');
    } finally {
      setRecoveryBusy(false);
    }
  }

  async function createReplacementPayment() {
    if (!order || !['momo_sandbox', 'vnpay_sandbox', 'vietqr_transfer'].includes(order.paymentMethod)) return;
    const provider = order.paymentMethod === 'momo_sandbox' ? 'momo' : order.paymentMethod === 'vnpay_sandbox' ? 'vnpay' : 'vietqr';
    setRecoveryBusy(true);
    setRecoveryError('');
    try {
      const result = await paymentApiRequest(`/api/payments/${provider}/create`, {
        method: 'POST', body: { orderId: order.invoiceNo, amount: Number(order.totalAmount) },
      });
      setRecoverySession(result);
      setRecoveryState('resumable');
      setRecoverySyncStatus('pending');
    } catch (requestError) {
      setRecoveryError(requestError.message || 'Không thể tạo lại hướng dẫn thanh toán. Hãy gửi yêu cầu hỗ trợ nếu lỗi tiếp diễn.');
      setRecoveryState('error');
    } finally {
      setRecoveryBusy(false);
    }
  }

  async function refreshRecoveredPaymentStatus() {
    if (!recoverySession || recoverySession.provider === 'vietqr') {
      setRecoveryBusy(true);
      setRecoveryError('');
      try {
        const result = await dataRequest('/store/orders/track?orderCode=' + encodeURIComponent(order?.invoiceNo || orderCode.trim().toUpperCase()) + '&phone=' + encodeURIComponent(phone.trim()));
        setOrder(result.order);
        setRecoveryError('VietQR không tự xác nhận tiền vào. Cửa hàng cần đối soát sao kê; không chuyển khoản lần hai khi chưa được kiểm tra.');
      } catch (requestError) {
        setRecoveryError(requestError.message || 'Chưa tra cứu được đơn. Hãy thử lại khi mạng ổn định.');
      } finally {
        setRecoveryBusy(false);
      }
      return;
    }
    setRecoveryBusy(true);
    setRecoveryError('');
    try {
      const result = await dataRequest('/store/orders/sync-payment', {
        method: 'POST', headers: { 'X-Payment-Token': recoverySession.statusToken }, body: { paymentId: recoverySession.paymentId },
      });
      if (result.status === 'paid') {
        setRecoverySyncStatus('paid');
        setRecoverySession(null);
        setRecoveryState('paid');
        await lookupOrder(order.invoiceNo, phone.trim());
        setRecoveryError('Máy chủ đã xác minh thanh toán thành công.');
      } else if (result.status === 'failed') {
        setRecoverySyncStatus('failed');
        setRecoveryError('Giao dịch bị từ chối hoặc thất bại. Đơn đã được cập nhật theo kết quả xác minh của cổng.');
        await lookupOrder(order.invoiceNo, phone.trim());
      } else {
        setRecoverySyncStatus('pending');
        setRecoveryError('Cổng chưa xác nhận giao dịch. Đừng thanh toán lần hai; hãy kiểm tra lại sau ít phút.');
      }
    } catch (requestError) {
      setRecoveryError(requestError.message || 'Chưa kiểm tra được giao dịch. Hãy thử lại khi mạng ổn định.');
    } finally {
      setRecoveryBusy(false);
    }
  }

  useEffect(() => {
    let active = true;
    setRecoveryQrDataUrl('');
    if (recoverySession?.provider !== 'vnpay' || !recoverySession.paymentUrl) return () => { active = false; };
    QRCode.toDataURL(recoverySession.qrContent || recoverySession.paymentUrl, {
      errorCorrectionLevel: 'M', margin: 2, width: 360,
      color: { dark: '#102a43', light: '#ffffff' },
    }).then((dataUrl) => { if (active) setRecoveryQrDataUrl(dataUrl); })
      .catch(() => { if (active) setRecoveryError('Không kết xuất được QR trên trình duyệt. Hãy mở liên kết thanh toán bên cạnh.'); });
    return () => { active = false; };
  }, [recoverySession]);

  return <div className="storefront store-secondary-page"><StoreHeader cartCount={readCart().reduce((total, item) => total + item.quantity, 0)} user={user} authReady={authReady} onLogout={onLogout} workspacePath={workspacePath} roleLabel={roleLabel} member={null} onShowMember={() => { window.location.href = user?.role === 'customer' ? '/member' : '/login'; }} showCategories={false} showSearch={false} /><StoreNetworkStatus />
    <main className="store-track-page">
      <header className="store-track-heading">
        <span className="store-track-heading-icon" aria-hidden="true"><i className="bi bi-box-seam" /></span>
        <div className="store-track-heading-copy">
          <span className="store-eyebrow">ORDER TRACKING</span>
          <h1>Tra cứu đơn giao hàng</h1>
          <p>Nhập mã đơn và số điện thoại đã cung cấp khi đặt hàng. Nếu vừa đặt đơn, trang sẽ tự tra cứu khi mở bằng liên kết theo dõi.</p>
        </div>
      </header>

      <form className="store-form store-track-form" onSubmit={track}>
        <div className="store-field">
          <label htmlFor="track-code">Mã đơn hàng *</label>
          <input id="track-code" autoComplete="off" spellCheck="false" value={orderCode} onChange={(event) => { setOrderCode(event.target.value.toUpperCase()); setError(''); }} placeholder="WEB-00002" required />
        </div>
        <div className="store-field">
          <label htmlFor="track-phone">Số điện thoại nhận hàng *</label>
          <input id="track-phone" type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(event) => { setPhone(event.target.value); setError(''); }} placeholder="0905 123 456" required />
        </div>
        <button className="store-button store-button-primary store-button-wide" type="submit" disabled={busy} aria-busy={busy}>
          <i className={busy ? 'bi bi-arrow-repeat' : 'bi bi-search'} aria-hidden="true" />
          {busy ? 'Đang tra cứu...' : 'Tra cứu trạng thái'}
        </button>
      </form>

      {!busy && !error && !order && <aside className="store-track-help" aria-label="Hướng dẫn tra cứu đơn hàng">
        <div><i className="bi bi-receipt" aria-hidden="true" /><span><strong>Mã đơn hàng</strong><small>Mã bắt đầu bằng WEB- trên xác nhận đặt hàng.</small></span></div>
        <div><i className="bi bi-phone" aria-hidden="true" /><span><strong>Đúng số điện thoại</strong><small>Dùng số nhận hàng đã nhập khi đặt đơn.</small></span></div>
        <div><i className="bi bi-shield-check" aria-hidden="true" /><span><strong>Thông tin riêng tư</strong><small>Chỉ hiển thị khi mã đơn và số điện thoại khớp.</small></span></div>
      </aside>}

      {busy && <p className="store-track-loading" role="status" aria-live="polite">Đang kiểm tra mã đơn và số điện thoại…</p>}
      {error && <div className="store-form-error store-track-error" role="alert">{error}</div>}

      {order && <section className="store-track-result" aria-labelledby="track-result-heading">
        <header className="store-track-result-header">
          <div>
            <span className="store-eyebrow">MÃ ĐƠN HÀNG</span>
            <h2 id="track-result-heading">{order.invoiceNo}</h2>
            <p>Ngày đặt: {new Date(order.createdAt).toLocaleString('vi-VN')}</p>
          </div>
          <span className={'store-track-status-pill' + (order.status === 'cancelled' ? ' is-cancelled' : order.status === 'delivered' ? ' is-delivered' : '')}>
            {order.status === 'cancelled' && <i className="bi bi-x-circle-fill" aria-hidden="true" />}
            {order.status !== 'cancelled' && <i className={order.status === 'delivered' ? 'bi bi-check-circle-fill' : 'bi bi-clock-history'} aria-hidden="true" />}
            {shippingStatusLabel(order.status)}
          </span>
        </header>

        {order.status === 'cancelled'
          ? <div className="store-track-cancelled" role="status"><i className="bi bi-info-circle" aria-hidden="true" /><span>Đơn hàng đã bị hủy. Tồn kho và các ưu đãi liên quan đã được xử lý theo trạng thái hủy của đơn.</span></div>
          : <ol className="store-track-timeline" aria-label="Tiến trình xử lý đơn hàng">
            {['pending_confirmation', 'confirmed', 'preparing', 'shipping', 'delivered'].map((step, index, steps) => {
              const currentIndex = steps.indexOf(order.status);
              const done = currentIndex >= 0 && index < currentIndex;
              const current = step === order.status;
              return <li className={'store-track-step' + (done ? ' done' : '') + (current ? ' current' : '')} key={step}>
                <span aria-hidden="true"><i className={done ? 'bi bi-check-lg' : current ? 'bi bi-circle-fill' : 'bi bi-circle'} /></span>
                <small>{shippingStatusLabel(step)}</small>
              </li>;
            })}
          </ol>}

        <div className="store-track-summary">
          <div><span>Người nhận</span><strong>{order.delivery?.recipientName || '—'}</strong></div>
          <div><span>Số điện thoại</span><strong>{order.delivery?.phone || '—'}</strong></div>
          <div className="store-track-summary-wide"><span>Địa chỉ giao hàng</span><strong>{[order.delivery?.address, order.delivery?.ward, order.delivery?.district, order.delivery?.city].filter(Boolean).join(', ') || '—'}</strong></div>
          <div><span>Tổng tiền</span><strong>{money(order.totalAmount)}</strong></div>
          <div><span>Phương thức thanh toán</span><strong>{paymentMethodLabel(order.paymentMethod)}</strong></div>
          <div><span>Trạng thái thanh toán</span><strong className={'store-track-payment-status' + (['paid', 'completed'].includes(order.paymentStatus) ? ' is-paid' : '')}>{paymentStatusLabel(order.paymentStatus)}</strong></div>
          <div><span>Điểm thành viên</span><strong>{Number(order.loyaltyPointsEarned || 0).toLocaleString('vi-VN')}</strong></div>
        </div>
        <p className={order.isMemberOrder ? 'store-points-notice' : 'store-guest-points-notice'}>{order.memberPointsNotice}</p>

        {cancelSuccess && <div className="store-form-success" role="status" style={{ margin: '1rem 0', padding: '0.75rem 1rem', background: '#ecfdf5', color: '#065f46', borderRadius: '8px', border: '1px solid #a7f3d0' }}>{cancelSuccess}</div>}

        {order.status !== 'cancelled' && order.status !== 'delivered' && !['paid', 'completed'].includes(order.paymentStatus) && (
          <div style={{ marginTop: '1.25rem', paddingTop: '1rem', borderTop: '1px dashed #cbd5e1', display: 'flex', justifyContent: 'flex-end' }}>
            <button
              type="button"
              className="store-button"
              onClick={() => { setShowCancelModal(true); setCancelError(''); }}
              style={{ background: '#fee2e2', color: '#b91c1c', border: '1px solid #f87171', borderRadius: '6px', padding: '0.6rem 1.2rem', cursor: 'pointer', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}
            >
              <i className="bi bi-x-circle" aria-hidden="true" /> Hủy đơn hàng này
            </button>
          </div>
        )}

        {showCancelModal && (
          <div className="store-modal-backdrop" style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }}>
            <div className="store-modal" style={{ background: '#fff', borderRadius: '12px', padding: '1.5rem', maxWidth: '480px', width: '100%', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.2)' }}>
              <h3 style={{ margin: '0 0 0.75rem 0', display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#b91c1c' }}>
                <i className="bi bi-exclamation-triangle" /> Xác nhận hủy đơn hàng {order.invoiceNo}
              </h3>
              <p style={{ fontSize: '0.9rem', color: '#4b5563', marginBottom: '1rem' }}>
                Khi hủy đơn, sản phẩm sẽ được hoàn lại vào kho và các điểm tích lũy / khuyến mãi áp dụng sẽ được hoàn trả lại.
              </p>
              {cancelError && <div className="store-form-error" style={{ marginBottom: '1rem', color: '#dc2626' }}>{cancelError}</div>}
              <div className="store-field" style={{ marginBottom: '1.25rem' }}>
                <label htmlFor="cancel-reason" style={{ display: 'block', fontWeight: 600, marginBottom: '0.5rem' }}>Lý do hủy đơn *</label>
                <select
                  id="cancel-reason"
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  style={{ width: '100%', padding: '0.6rem', borderRadius: '6px', border: '1px solid #d1d5db' }}
                >
                  <option value="Đổi ý, không còn nhu cầu mua">Đổi ý, không còn nhu cầu mua</option>
                  <option value="Muốn thay đổi sản phẩm hoặc địa chỉ nhận hàng">Muốn thay đổi sản phẩm hoặc địa chỉ nhận hàng</option>
                  <option value="Thời gian giao hàng dự kiến quá lâu">Thời gian giao hàng dự kiến quá lâu</option>
                  <option value="Tìm thấy giá tốt hơn ở nơi khác">Tìm thấy giá tốt hơn ở nơi khác</option>
                  <option value="Đặt nhầm số lượng hoặc sản phẩm">Đặt nhầm số lượng hoặc sản phẩm</option>
                  <option value="Khác">Lý do khác</option>
                </select>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
                <button
                  type="button"
                  className="store-button store-button-secondary"
                  onClick={() => { setShowCancelModal(false); setCancelError(''); }}
                  disabled={cancelBusy}
                >
                  Đóng
                </button>
                <button
                  type="button"
                  className="store-button"
                  style={{ background: '#dc2626', color: '#fff', border: 'none', borderRadius: '6px', padding: '0.6rem 1.2rem', fontWeight: 600, cursor: 'pointer' }}
                  onClick={handleCustomerCancel}
                  disabled={cancelBusy}
                >
                  {cancelBusy ? 'Đang hủy...' : 'Xác nhận hủy đơn'}
                </button>
              </div>
            </div>
          </div>
        )}

        {['momo_sandbox', 'vnpay_sandbox', 'vietqr_transfer'].includes(order.paymentMethod)
          && order.paymentStatus === 'pending_payment'
          && order.status !== 'cancelled' && <section className="store-track-recovery" aria-labelledby="track-recovery-heading">
            <div className="store-track-recovery-heading"><span className="store-support-guide-icon"><i className="bi bi-qr-code" aria-hidden="true" /></span><div><span className="store-eyebrow">PAYMENT RECOVERY</span><h3 id="track-recovery-heading">Mất mã QR hoặc không mở được thanh toán?</h3><p>Khôi phục hướng dẫn của chính đơn này. Không cần đặt lại đơn hàng.</p></div></div>
            {!recoverySession && <button type="button" className="store-button store-button-primary" onClick={recoverPaymentInstructions} disabled={recoveryBusy}>{recoveryBusy ? 'Đang khôi phục...' : 'Khôi phục QR / hướng dẫn thanh toán'}</button>}
            {recoveryState === 'create_new' && <div className="store-track-recovery-next"><p>Đơn vẫn đang chờ tiền. Phiên thanh toán cũ không còn dùng được hoặc chưa được tạo. Có thể tạo lại hướng dẫn trên đơn hiện tại.</p><button type="button" className="store-button store-button-primary" onClick={createReplacementPayment} disabled={recoveryBusy}>{recoveryBusy ? 'Đang tạo lại...' : 'Tạo lại hướng dẫn thanh toán cho đơn này'}</button></div>}
            {recoverySession?.provider === 'vietqr' && <VietQrTransferPanel paymentSession={recoverySession} amount={order.totalAmount} />}
            {recoverySession?.provider === 'vnpay' && <VnpayQrPanel paymentSession={recoverySession} qrDataUrl={recoveryQrDataUrl} paymentSyncStatus={recoverySyncStatus} qrError={recoveryQrDataUrl ? '' : recoveryError || 'Đang tạo lại mã QR VNPAY...'} amount={order.totalAmount} />}
            {recoverySession?.provider === 'momo' && <section className="store-support-ticket-result store-recovered-momo"><span className="store-eyebrow">MOMO · SANDBOX</span><strong>Hướng dẫn thanh toán MoMo đã được khôi phục</strong><p>Số tiền: <b>{money(order.totalAmount)}</b>. Mở cổng thanh toán để hoàn tất trên cùng đơn hàng.</p>{recoverySession.paymentUrl && <a className="store-button store-button-primary" href={recoverySession.paymentUrl} target="_blank" rel="noopener noreferrer">Mở thanh toán MoMo <i className="bi bi-box-arrow-up-right" aria-hidden="true" /></a>}</section>}
            {recoverySession && <div className="store-track-recovery-actions"><button type="button" className="store-button store-button-secondary" onClick={refreshRecoveredPaymentStatus} disabled={recoveryBusy}>{recoveryBusy ? 'Đang kiểm tra...' : recoverySession.provider === 'vietqr' ? 'Tôi đã chuyển khoản · Tra cứu đơn' : 'Tôi đã thanh toán · Kiểm tra trạng thái'}</button><button type="button" className="store-link-button" onClick={() => setRecoverySession(null)}>Ẩn hướng dẫn</button></div>}
            {recoveryError && <p className="store-track-recovery-message" role="status">{recoveryError}</p>}
            <p className="store-track-recovery-warning"><i className="bi bi-shield-exclamation" aria-hidden="true" /> Không thanh toán lần hai khi giao dịch cũ chưa có kết quả. VietQR chỉ được xác nhận sau khi cửa hàng đối soát sao kê ngân hàng.</p>
          </section>}
      </section>}

      <aside className="store-track-contact-support"><div><strong>Vẫn chưa xử lý được sự cố?</strong><p>Gửi mã đơn và mô tả lỗi để cửa hàng tiếp nhận, phản hồi theo mã hỗ trợ.</p></div><Link className="store-button store-button-secondary" to="/support">Mở Trung tâm hỗ trợ <i className="bi bi-headset" aria-hidden="true" /></Link></aside>

      <Link className="store-track-back" to="/"><i className="bi bi-arrow-left" aria-hidden="true" /> Quay lại cửa hàng</Link>
    </main>
    <StoreFooter />
  </div>;
}

export function StoreOrdersPage({ user }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [savingId, setSavingId] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const statusActions = {
    pending_confirmation: [{ status: 'confirmed', label: 'Xác nhận đơn' }, { status: 'cancelled', label: 'Hủy đơn' }],
    confirmed: [{ status: 'preparing', label: 'Bắt đầu soạn hàng' }, { status: 'cancelled', label: 'Hủy đơn' }],
    preparing: [{ status: 'shipping', label: 'Bàn giao shipper' }, { status: 'cancelled', label: 'Hủy đơn' }],
    shipping: [{ status: 'delivered', label: 'Xác nhận đã giao' }],
  };
  async function loadOrders() {
    setLoading(true);
    setError('');
    try {
      const result = await dataRequest('/store/orders?page=1&pageSize=100');
      setOrders(result.data || []);
    } catch (requestError) {
      setError(requestError.message || 'Không tải được đơn giao hàng.');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { loadOrders(); }, []);
  const orderStatus = (order) => order.fulfillmentStatus || order.status || 'pending_confirmation';
  const normalizeOrderSearch = (value) => String(value || '').normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLocaleLowerCase('vi').trim();
  const filteredOrders = orders.filter((order) => {
    const query = normalizeOrderSearch(searchTerm);
    const delivery = order.delivery || {};
    const matchesQuery = !query || [order.invoiceNo, order.customerName, delivery.phone, delivery.address, delivery.district, delivery.city, order.branchName]
      .some((value) => normalizeOrderSearch(value).includes(query));
    return matchesQuery && (statusFilter === 'all' || orderStatus(order) === statusFilter);
  });
  const orderStats = [
    { label: 'Tổng đơn', value: orders.length, note: 'Tất cả đơn online', icon: 'receipt', tone: 'total' },
    { label: 'Chờ xác nhận', value: orders.filter((order) => orderStatus(order) === 'pending_confirmation').length, note: 'Cần cửa hàng xử lý', icon: 'hourglass-split', tone: 'pending' },
    { label: 'Đang xử lý / giao', value: orders.filter((order) => ['confirmed', 'preparing', 'shipping'].includes(orderStatus(order))).length, note: 'Đã tiếp nhận đến đang giao', icon: 'truck', tone: 'progress' },
    { label: 'Đã hoàn tất', value: orders.filter((order) => orderStatus(order) === 'delivered').length, note: 'Giao thành công', icon: 'check2-circle', tone: 'complete' },
  ];
  async function changeStatus(order, action) {
    const descriptions = {
      confirmed: 'xác nhận đơn hàng', preparing: 'bắt đầu chuẩn bị hàng',
      shipping: 'bàn giao đơn cho shipper', delivered: 'xác nhận giao thành công và cộng điểm cho thành viên nếu đủ điều kiện',
      cancelled: 'hủy đơn và hoàn lại tồn kho',
    };
    if (!window.confirm('Bạn chắc chắn muốn ' + descriptions[action.status] + ' ' + order.invoiceNo + '?')) return;
    setSavingId(order.id); setError(''); setSuccess('');
    try {
      const result = await dataRequest('/store/orders/' + order.id + '/status', { method: 'PATCH', body: { status: action.status } });
      setSuccess(result.message);
      await loadOrders();
    } catch (requestError) {
      setError(requestError.message || 'Không cập nhật được trạng thái đơn.');
    } finally {
      setSavingId(null);
    }
  }
  async function confirmVietQrTransfer(order) {
    if (!window.confirm(`Chỉ xác nhận khi đã kiểm tra sao kê và thấy khoản tiền vào đúng tài khoản EMSystems. Tiếp tục đối soát ${order.invoiceNo}?`)) return;
    const amountText = window.prompt(`Nhập số tiền thực nhận cho đơn ${order.invoiceNo} (chỉ nhập chữ số):`, String(order.totalAmount));
    if (amountText === null) return;
    const receivedAmount = Number(String(amountText).replace(/\D/g, ''));
    if (!Number.isSafeInteger(receivedAmount) || receivedAmount !== Number(order.totalAmount)) {
      setError('Số tiền thực nhận không khớp tổng tiền đơn. Chưa xác nhận thanh toán.');
      return;
    }
    const transactionReference = window.prompt('Nhập mã tham chiếu/mã giao dịch hiển thị trên sao kê ngân hàng:');
    if (transactionReference === null || !transactionReference.trim()) return;
    setSavingId(order.id); setError(''); setSuccess('');
    try {
      const result = await dataRequest(`/store/orders/${order.id}/payment-confirmation`, {
        method: 'POST', body: { receivedAmount, transactionReference: transactionReference.trim() },
      });
      setSuccess(result.message || 'Đã đối soát chuyển khoản.');
      await loadOrders();
    } catch (requestError) {
      setError(requestError.message || 'Không xác nhận được giao dịch VietQR.');
    } finally {
      setSavingId(null);
    }
  }
  return <div className="page-stack store-orders-page">
    <section className="welcome-row store-orders-heading"><div className="store-orders-heading-copy"><span className="eyebrow">GIAO NHẬN · VẬN HÀNH</span><h2>Đơn giao hàng online</h2><p>Theo dõi thông tin người nhận, thanh toán và tiến độ giao hàng trên một màn hình.</p></div><button className="button button-secondary store-orders-refresh" type="button" onClick={loadOrders} disabled={loading}><i className={'bi ' + (loading ? 'bi-arrow-repeat' : 'bi-arrow-clockwise')} aria-hidden="true" /> {loading ? 'Đang tải...' : 'Làm mới'}</button></section>
    <section className="store-orders-stats" aria-label="Tổng quan đơn giao hàng">{orderStats.map((stat) => <article className={'store-orders-stat store-orders-stat-' + stat.tone} key={stat.tone}><span className="store-orders-stat-icon"><i className={'bi bi-' + stat.icon} aria-hidden="true" /></span><span className="store-orders-stat-label">{stat.label}</span><strong>{loading ? '—' : stat.value.toLocaleString('vi-VN')}</strong><small>{stat.note}</small></article>)}</section>
    <div className="notice notice-simulation store-orders-notice"><i className="bi bi-info-circle" aria-hidden="true" /><span>MoMo/VNPAY cần IPN hợp lệ. VietQR cần quản lý đối chiếu tiền đã vào sao kê và nhập mã giao dịch trước khi xác nhận; không xác nhận dựa vào ảnh chụp màn hình của khách.</span></div>
    {error && <div className="notice notice-error" role="alert">{error}</div>}{success && <div className="notice notice-success" role="status">{success}</div>}
    <section className="store-orders-toolbar" aria-label="Tìm và lọc đơn giao hàng"><label className="store-orders-search"><i className="bi bi-search" aria-hidden="true" /><input type="search" value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Tìm mã đơn, khách hàng, số điện thoại..." aria-label="Tìm đơn giao hàng" /></label><label className="store-orders-status-filter"><span>Trạng thái</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="Lọc theo trạng thái"><option value="all">Tất cả trạng thái</option><option value="pending_confirmation">Chờ xác nhận</option><option value="confirmed">Đã xác nhận</option><option value="preparing">Đang soạn hàng</option><option value="shipping">Đang giao</option><option value="delivered">Đã giao thành công</option><option value="cancelled">Đã hủy</option></select></label><span className="store-orders-result-count">{loading ? 'Đang tải đơn...' : `${filteredOrders.length} / ${orders.length} đơn hàng`}</span></section>
    {loading ? <div className="store-orders-state"><span className="loader" /> <strong>Đang đồng bộ đơn giao hàng</strong><p>Đang tải đơn và trạng thái xử lý mới nhất.</p></div> : error && !orders.length ? <div className="store-orders-state store-orders-state-error"><span className="store-orders-state-icon"><i className="bi bi-cloud-slash" aria-hidden="true" /></span><h3>Chưa tải được đơn hàng</h3><p>Kiểm tra kết nối rồi thử tải lại danh sách.</p><button className="button button-secondary" type="button" onClick={loadOrders}>Thử lại</button></div> : !orders.length ? <div className="store-orders-state"><span className="store-orders-state-icon"><i className="bi bi-truck" aria-hidden="true" /></span><h3>Chưa có đơn giao hàng</h3><p>Đơn khách đặt từ trang cửa hàng sẽ xuất hiện tại đây sau khi được ghi nhận.</p></div> : !filteredOrders.length ? <div className="store-orders-state"><span className="store-orders-state-icon"><i className="bi bi-search" aria-hidden="true" /></span><h3>Không tìm thấy đơn phù hợp</h3><p>Thử từ khóa khác hoặc chọn “Tất cả trạng thái”.</p><button className="button button-secondary" type="button" onClick={() => { setSearchTerm(''); setStatusFilter('all'); }}>Xóa bộ lọc</button></div> : <section className="store-admin-orders" aria-label="Danh sách đơn giao hàng">{filteredOrders.map((order) => { const delivery = order.delivery || {}; const currentStatus = orderStatus(order); const bankTransfer = order.paymentMethod === 'vietqr_transfer'; const actions = (statusActions[currentStatus] || []).filter((action) => {
      if (!['momo_sandbox', 'vnpay_sandbox', 'vietqr_transfer'].includes(order.paymentMethod)) return true;
      if (['paid', 'completed'].includes(order.paymentStatus)) return true;
      return ['admin', 'manager'].includes(user?.role) && order.paymentStatus === 'pending_payment' && action.status === 'cancelled';
    }); return <article className="store-admin-order-card" key={order.id}>
      <header><div className="store-admin-order-heading"><span className="store-admin-order-invoice">{order.invoiceNo || `Đơn #${order.id}`}</span><h3>{order.customerName || delivery.recipientName || 'Khách hàng'}</h3><small><i className="bi bi-calendar3" aria-hidden="true" /> {order.createdAt ? new Date(order.createdAt).toLocaleString('vi-VN') : 'Chưa có thời gian'} <span aria-hidden="true">·</span> {order.branchName || 'Chưa xác định chi nhánh'}</small></div><div className="store-admin-order-total"><span>Tổng thanh toán</span><strong>{money(order.totalAmount)}</strong></div></header>
      <div className="store-admin-order-info"><div><span>Điện thoại</span>{delivery.phone ? <a href={'tel:' + delivery.phone}><i className="bi bi-telephone" aria-hidden="true" /> {delivery.phone}</a> : <strong>Chưa có số điện thoại</strong>}</div><div className="store-admin-order-address"><span>Địa chỉ giao hàng</span><strong>{[delivery.address, delivery.ward, delivery.district, delivery.city].filter(Boolean).join(', ') || 'Chưa có địa chỉ'}</strong></div><div><span>Phí giao / dự kiến</span><strong>{money(order.shippingFee)} <span className="store-admin-order-eta">· {delivery.eta || 'Chưa có ETA'}</span></strong></div><div><span>Thanh toán</span><strong>{paymentMethodLabel(order.paymentMethod)} · {paymentStatusLabel(order.paymentStatus)}</strong></div><div><span>Thành viên</span><strong>{order.memberCustomerId ? 'Có thẻ — tích điểm sau khi giao thành công' : 'Khách vãng lai — không tích điểm'}</strong></div><div><span>Ghi chú đơn hàng</span><strong>{order.note || 'Không có ghi chú'}</strong></div></div>
      <div className="store-admin-order-items-wrap"><span className="store-admin-order-items-label">SẢN PHẨM ({(order.items || []).length})</span><div className="store-admin-order-items">{(order.items || []).map((item) => <span key={item.id || `${item.productId}-${item.productName}`}>{item.productName} <b>× {item.quantity}</b></span>)}</div></div>
      <div className="store-admin-order-footer"><span className={'status-tag store-admin-order-status store-admin-status-' + currentStatus + (currentStatus === 'delivered' ? ' status-active' : '')}>{shippingStatusLabel(currentStatus)}</span><div className="row-actions">{bankTransfer && order.paymentStatus === 'pending_payment' && ['admin', 'manager'].includes(user?.role) && <button type="button" className="table-action" disabled={savingId === order.id} onClick={() => confirmVietQrTransfer(order)}>{savingId === order.id ? 'Đang đối soát...' : 'Xác nhận đã nhận tiền'}</button>}{actions.map((action) => <button type="button" className={'table-action' + (action.status === 'cancelled' ? ' table-action-danger' : '')} key={action.status} disabled={savingId === order.id} onClick={() => changeStatus(order, action)}>{savingId === order.id ? 'Đang lưu...' : action.label}</button>)}{!actions.length && currentStatus === 'cancelled' && <span className="store-admin-order-complete-note">Đơn đã hủy</span>}{!actions.length && currentStatus === 'delivered' && <span className="store-admin-order-complete-note"><i className="bi bi-check-circle" aria-hidden="true" /> Đã hoàn tất</span>}</div></div>
    </article>; })}</section>}
  </div>;
}
