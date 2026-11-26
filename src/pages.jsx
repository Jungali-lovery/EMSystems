import { lazy, Suspense, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  Alert, Box, Button as MuiButton, Chip, FormControl, InputLabel, MenuItem,
  Paper, Select, Stack, TextField, Typography,
} from '@mui/material';
import {
  dataRequest,
  formatMoney,
} from './api-client.js';
import emsystemsLogo from './picture/emsystems-logo.webp';
import { canAccessAdminRoute, getPortalForRole } from './access-control.js';
import { decryptBackupPayload, encryptBackupPayload } from './services/backup-crypto.js';

const SalesHistoryGrid = lazy(() => import('./components/sales/SalesHistoryGrid.jsx'));

function ErrorNotice({ message, onRetry }) {
  if (!message) return null;
  return <div className="notice notice-error" role="alert"><span>{message}</span>{onRetry && <button type="button" className="text-button" onClick={onRetry}>Thử lại</button>}</div>;
}

function EmptyState({ title, description, action }) {
  return <div className="empty-state"><div className="empty-icon"><i className="bi bi-search" aria-hidden="true" /></div><h3>{title}</h3><p>{description}</p>{action}</div>;
}

function safeInternalPath(value) {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/\\') ? value : '';
}

// Một biểu mẫu duy nhất. Vai trò/đích đến được xác định từ hồ sơ tài khoản sau khi xác thực.
export function LoginPage({ onLogin }) {
  const navigate = useNavigate();
  const location = useLocation();
  const wishlistReturnTo = location.state?.reason === 'wishlist' ? safeInternalPath(location.state.returnTo) : '';
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const result = await dataRequest('/auth/login', {
        method: 'POST',
        body: { identifier, password },
      });
      onLogin(result.user);
      const destination = getPortalForRole(result.user.role);
      const postLoginDestination = result.user.role === 'customer' && wishlistReturnTo ? wishlistReturnTo : destination;
      navigate(result.user.mustChangePassword ? '/change-password' : postLoginDestination, { replace: true });
    } catch (requestError) {
      setError(requestError.message || 'Tài khoản hoặc mật khẩu không đúng.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login-screen">
      <section className="login-brand-panel">
        <div className="login-brand"><img className="brand-symbol brand-logo-image" src={emsystemsLogo} alt="" /><span className="login-brand-wordmark"><strong>EMSystems</strong><small>TECH &amp; ELECTRONICS</small></span></div>
        <div className="login-brand-copy"><span className="eyebrow">THƯƠNG HIỆU CÔNG NGHỆ &amp; ĐIỆN TỬ</span><h1>Công nghệ cho<br /><em>cuộc sống hiện đại.</em></h1><p>EMSystems — thiết bị công nghệ và điện tử, với thông tin sản phẩm, giá bán và lựa chọn giao hàng được trình bày rõ ràng.</p><span className="login-brand-slogan">THIẾT BỊ TỐT · LỰA CHỌN THÔNG MINH</span></div>
        <div className="login-panel-bottom"><span>EMSYSTEMS</span><span>TECH &amp; ELECTRONICS</span></div>
      </section>
      <section className="login-form-panel">
        <div className="login-form-wrap">
          <div className="login-brand"><img className="brand-symbol brand-logo-image" src={emsystemsLogo} alt="" /><span className="login-brand-wordmark"><strong>EMSystems</strong><small>TECH &amp; ELECTRONICS</small></span></div>
          <span className="eyebrow">ĐĂNG NHẬP HỆ THỐNG</span>
          <h2>Đăng nhập</h2>
          <p className="muted">{location.state?.reason === 'wishlist' ? 'Đăng nhập tài khoản khách hàng để lưu sản phẩm yêu thích. Sau khi đăng nhập, bạn sẽ quay lại sản phẩm vừa chọn.' : 'Nhập tài khoản và mật khẩu của bạn.'}</p>
          <ErrorNotice message={error} />
          <form onSubmit={handleSubmit} className="form-stack">
            <label htmlFor="login-identifier">Tài khoản</label>
            <input id="login-identifier" autoComplete="username" value={identifier} onChange={(event) => setIdentifier(event.target.value)} required maxLength={190} placeholder="Tên đăng nhập, email hoặc số điện thoại" />
            <label htmlFor="login-password">Mật khẩu</label>
            <input id="login-password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required maxLength={200} placeholder="Nhập mật khẩu" />
            <button className="button button-primary button-wide" type="submit" disabled={submitting || !identifier.trim() || !password}>
              {submitting ? 'Đang xác minh...' : 'Đăng nhập'} <i className="bi bi-arrow-right" aria-hidden="true" />
            </button>
          </form>
          <p className="login-recovery-link"><Link to="/forgot-password">Quên mật khẩu?</Link></p>
          <div className="login-security"><span className="security-mark"><i className="bi bi-shield-check" aria-hidden="true" /></span><span>Đăng nhập an toàn để tiếp tục sử dụng hệ thống.</span></div>
          <p className="login-register-link"><Link to="/register" state={location.state}>Chưa có tài khoản? Đăng ký</Link></p>
          <div className="login-store-return"><Link to="/"><i className="bi bi-arrow-left" aria-hidden="true" /> Quay về cửa hàng</Link></div>
        </div>
        <div className="login-footnote">Bản demo học tập · không dùng cho tài khoản hoặc dữ liệu thật.</div>
      </section>
    </main>
  );
}

export function RegisterPage({ onLogin }) {
  const navigate = useNavigate();
  const location = useLocation();
  const wishlistReturnTo = location.state?.reason === 'wishlist' ? safeInternalPath(location.state.returnTo) : '';
  const [form, setForm] = useState({
    fullName: '', username: '', email: '', phone: '', password: '', confirmPassword: '',
  });
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [publicConfig, setPublicConfig] = useState(null);
  const [otpCode, setOtpCode] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [phoneVerified, setPhoneVerified] = useState(false);
  const [otpBusy, setOtpBusy] = useState(false);
  const [otpMessage, setOtpMessage] = useState('');
  const [dataProcessingConsent, setDataProcessingConsent] = useState(false);
  const [marketingConsent, setMarketingConsent] = useState(false);

  useEffect(() => {
    dataRequest('/config/public').then(setPublicConfig).catch(() => setPublicConfig(null));
  }, []);

  const phoneVerificationRequired = publicConfig?.phoneVerificationRequired === true;
  const dataConsentRequired = publicConfig?.dataConsentRequired === true;
  const dataConsentReady = publicConfig?.dataConsentReady === true;
  const dataControllerName = publicConfig?.legalBusiness?.operatorName || 'chủ thể kinh doanh chưa khai báo';

  async function requestPhoneOtp() {
    setOtpBusy(true);
    setOtpMessage('');
    setError('');
    try {
      const result = await dataRequest('/auth/phone-verification/start', { method: 'POST', body: { phone: form.phone } });
      setOtpSent(true);
      setPhoneVerified(false);
      const code = result?.demoCode || '123456';
      setOtpMessage(`Đã gửi OTP demo. Mã xác thực SMS: ${code}`);
    } catch (requestError) {
      setOtpMessage(requestError.message || 'Không gửi được OTP.');
    } finally {
      setOtpBusy(false);
    }
  }

  async function verifyPhoneOtp() {
    setOtpBusy(true);
    setOtpMessage('');
    setError('');
    try {
      const result = await dataRequest('/auth/phone-verification/check', { method: 'POST', body: { phone: form.phone, code: otpCode } });
      setPhoneVerified(result.verified === true);
      setOtpMessage(result.verified ? 'Số điện thoại đã được xác minh trong phiên này.' : 'OTP chưa hợp lệ.');
    } catch (requestError) {
      setPhoneVerified(false);
      setOtpMessage(requestError.message || 'Không xác minh được OTP.');
    } finally {
      setOtpBusy(false);
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const result = await dataRequest('/auth/register', { method: 'POST', body: {
        ...form, dataProcessingConsent, marketingConsent,
      } });
      onLogin(result.user);
      navigate(wishlistReturnTo || '/', { replace: true });
    } catch (requestError) {
      setError(requestError.message || 'Không tạo được tài khoản.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login-screen">
      <section className="login-brand-panel">
        <div className="login-brand"><img className="brand-symbol brand-logo-image" src={emsystemsLogo} alt="" /><span className="login-brand-wordmark"><strong>EMSystems</strong><small>TECH &amp; ELECTRONICS</small></span></div>
        <div className="login-brand-copy"><span className="eyebrow">THƯƠNG HIỆU CÔNG NGHỆ &amp; ĐIỆN TỬ</span><h1>Công nghệ cho<br /><em>cuộc sống hiện đại.</em></h1><p>EMSystems — thiết bị công nghệ và điện tử, với thông tin sản phẩm, giá bán và lựa chọn giao hàng được trình bày rõ ràng.</p><span className="login-brand-slogan">THIẾT BỊ TỐT · LỰA CHỌN THÔNG MINH</span></div>
        <div className="login-panel-bottom"><span>EMSYSTEMS</span><span>TECH &amp; ELECTRONICS</span></div>
      </section>
      <section className="login-form-panel">
        <div className="login-form-wrap">
          <div className="login-brand"><img className="brand-symbol brand-logo-image" src={emsystemsLogo} alt="" /><span className="login-brand-wordmark"><strong>EMSystems</strong><small>TECH &amp; ELECTRONICS</small></span></div>
          <span className="eyebrow">TÀI KHOẢN KHÁCH HÀNG</span>
          <h2>Đăng ký tài khoản</h2>
          <p className="muted">Điền thông tin để tạo tài khoản khách hàng.</p>
          <ErrorNotice message={error} />
          {dataConsentRequired && !dataConsentReady && <div className="notice notice-error" role="alert">Chưa thể đăng ký: chủ thể kiểm soát dữ liệu chưa khai báo đầy đủ tên pháp lý, địa chỉ và email/hotline liên hệ.</div>}
          <form onSubmit={handleSubmit} className="form-stack">
            <label htmlFor="register-fullname">Họ và tên</label>
            <input id="register-fullname" autoComplete="name" value={form.fullName} onChange={(event) => setForm((current) => ({ ...current, fullName: event.target.value }))} required minLength={2} maxLength={150} />
            <label htmlFor="register-username">Tên đăng nhập</label>
            <input id="register-username" autoComplete="username" value={form.username} onChange={(event) => setForm((current) => ({ ...current, username: event.target.value }))} required minLength={3} maxLength={60} />
            <label htmlFor="register-email">Email</label>
            <input id="register-email" type="email" autoComplete="email" value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} required maxLength={190} />
            <label htmlFor="register-phone">Số điện thoại</label>
            <input id="register-phone" type="tel" autoComplete="tel" value={form.phone} onChange={(event) => { setForm((current) => ({ ...current, phone: event.target.value })); setPhoneVerified(false); setOtpSent(false); setOtpCode(''); setOtpMessage(''); }} required maxLength={20} placeholder="0905 123 456" />
            {phoneVerificationRequired && <div className="store-field">
              <button type="button" className="button button-secondary" onClick={requestPhoneOtp} disabled={otpBusy || !form.phone.trim()}>{otpBusy ? 'Đang gửi…' : otpSent ? 'Gửi lại OTP' : 'Gửi mã OTP qua SMS'}</button>
              {otpSent && <><label htmlFor="register-otp">Mã OTP</label><input id="register-otp" inputMode="numeric" autoComplete="one-time-code" value={otpCode} onChange={(event) => setOtpCode(event.target.value.replace(/\D/g, '').slice(0, 10))} maxLength={10} placeholder="Nhập mã trong SMS" /><button type="button" className="button button-secondary" onClick={verifyPhoneOtp} disabled={otpBusy || otpCode.length < 4}>Xác minh số điện thoại</button></>}
              {otpMessage && <small role="status">{otpMessage}</small>}
              {phoneVerified && <small className="notice notice-success">Số điện thoại đã được xác minh.</small>}
            </div>}
            <label htmlFor="register-password">Mật khẩu (12–200 ký tự)</label>
            <input id="register-password" type="password" autoComplete="new-password" value={form.password} onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))} required minLength={12} maxLength={200} />
            <label htmlFor="register-confirm-password">Nhập lại mật khẩu</label>
            <input id="register-confirm-password" type="password" autoComplete="new-password" value={form.confirmPassword} onChange={(event) => setForm((current) => ({ ...current, confirmPassword: event.target.value }))} required minLength={12} maxLength={200} />
            <label className="consent-checkbox"><input type="checkbox" checked={dataProcessingConsent} onChange={(event) => setDataProcessingConsent(event.target.checked)} required={dataConsentRequired} /><span>Bên kiểm soát dữ liệu: <strong>{dataControllerName}</strong>. Tôi đã đọc <Link to="/legal/privacy" target="_blank" rel="noreferrer">Chính sách bảo vệ dữ liệu cá nhân</Link> và đồng ý xử lý thông tin cần thiết cho mục đích tạo, bảo vệ và quản lý tài khoản.</span></label>
            <label className="consent-checkbox"><input type="checkbox" checked={marketingConsent} onChange={(event) => setMarketingConsent(event.target.checked)} /><span>Tôi đồng ý nhận thông tin ưu đãi/tiếp thị. Đây là lựa chọn tự nguyện và có thể rút lại.</span></label>
            <button className="button button-primary button-wide" type="submit" disabled={submitting || !form.fullName.trim() || !form.username.trim() || !form.email.trim() || !form.phone.trim() || form.password.length < 12 || form.password !== form.confirmPassword || (phoneVerificationRequired && !phoneVerified) || (dataConsentRequired && (!dataConsentReady || !dataProcessingConsent))}>
              {submitting ? 'Đang tạo tài khoản...' : 'Đăng ký'} <i className="bi bi-arrow-right" aria-hidden="true" />
            </button>
          </form>
          <p className="login-register-link"><Link to="/login">Đã có tài khoản? Đăng nhập</Link></p>
          <p className="login-recovery-link">Tài khoản khách được tạo ở cấp khách hàng; không có quyền truy cập khu vực admin hoặc ctv.</p>
        </div>
        <div className="login-footnote">Bản demo học tập · không dùng cho tài khoản hoặc dữ liệu thật.</div>
      </section>
    </main>
  );
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [available, setAvailable] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [demoToken, setDemoToken] = useState('');
  useEffect(() => {
    dataRequest('/config/public')
      .then((config) => setAvailable(config.emailResetAvailable !== false))
      .catch(() => setAvailable(true));
  }, []);
  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    setDemoToken('');
    try {
      const result = await dataRequest('/auth/password-reset/request', { method: 'POST', body: { email } });
      setMessage(result.message || 'Nếu email khớp tài khoản, hướng dẫn đã được gửi.');
      if (result.demoToken) setDemoToken(result.demoToken);
    } catch (error) {
      setMessage(error.message || 'Không gửi được yêu cầu.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login-screen">
      <section className="login-form-panel">
        <div className="login-form-wrap">
          <div className="login-brand">
            <img className="brand-symbol brand-logo-image" src={emsystemsLogo} alt="" />
            <strong>EMSystems</strong>
          </div>
          <h2>Khôi phục mật khẩu</h2>
          <p className="muted">Nhập email hoặc tên đăng nhập của tài khoản để khôi phục mật khẩu.</p>
          {!available && (
            <div className="notice notice-error" role="status">
              Dịch vụ email chưa được cấu hình. Hãy liên hệ quản trị viên để khôi phục tài khoản.
            </div>
          )}
          <form onSubmit={submit} className="form-stack">
            <label htmlFor="reset-email">Email hoặc Tên đăng nhập</label>
            <input
              id="reset-email"
              type="text"
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              maxLength={190}
              placeholder="admin@emsystems.vn hoặc admin"
            />
            <button className="button button-primary button-wide" type="submit" disabled={!available || busy || !email.trim()}>
              {busy ? 'Đang gửi…' : 'Tạo liên kết khôi phục'}
            </button>
          </form>
          {message && <div className="notice" role="status">{message}</div>}
          {demoToken && (
            <div className="notice notice-success" style={{ marginTop: '1rem', textAlign: 'left' }}>
              <strong>[Mô phỏng Email / SMS đồ án]</strong>
              <p style={{ margin: '0.4rem 0' }}>Hệ thống đã tạo liên kết đặt lại mật khẩu demo (hạn 30 phút):</p>
              <Link
                to={`/reset-password#token=${demoToken}`}
                className="button button-secondary button-small"
                style={{ display: 'inline-block', marginTop: '0.25rem', textDecoration: 'none' }}
              >
                👉 Bấm vào đây để đặt mật khẩu mới ngay
              </Link>
            </div>
          )}
          <p style={{ marginTop: '1rem' }}><Link to="/login">Quay lại đăng nhập</Link></p>
        </div>
      </section>
    </main>
  );
}

export function ResetPasswordPage() {
  const [token] = useState(() => {
    const hashToken = new URLSearchParams(String(window.location.hash || '').replace(/^#/, '')).get('token');
    const searchToken = new URLSearchParams(window.location.search).get('token');
    return hashToken || searchToken || '';
  });
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [complete, setComplete] = useState(false);
  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      const result = await dataRequest('/auth/password-reset/confirm', { method: 'POST', body: { token, password, confirmPassword } });
      setComplete(true);
      setPassword('');
      setConfirmPassword('');
      setMessage(result.message || 'Đã đặt lại mật khẩu.');
    } catch (error) {
      setMessage(error.message || 'Liên kết đã hết hạn hoặc không hợp lệ.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login-screen">
      <section className="login-form-panel">
        <div className="login-form-wrap">
          <div className="login-brand">
            <img className="brand-symbol brand-logo-image" src={emsystemsLogo} alt="" />
            <strong>EMSystems</strong>
          </div>
          <h2>Đặt mật khẩu mới</h2>
          {!token && <div className="notice notice-error" role="alert">Liên kết không hợp lệ hoặc thiếu token. Hãy yêu cầu email mới.</div>}
          {!complete && (
            <form onSubmit={submit} className="form-stack">
              <label htmlFor="reset-new-password">Mật khẩu mới (12–200 ký tự)</label>
              <input id="reset-new-password" type="password" autoComplete="new-password" minLength={12} maxLength={200} value={password} onChange={(event) => setPassword(event.target.value)} required />
              <label htmlFor="reset-confirm-password">Nhập lại mật khẩu</label>
              <input id="reset-confirm-password" type="password" autoComplete="new-password" minLength={12} maxLength={200} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required />
              <button className="button button-primary button-wide" type="submit" disabled={!token || busy || password.length < 12 || password !== confirmPassword}>
                {busy ? 'Đang cập nhật…' : 'Đặt lại mật khẩu'}
              </button>
            </form>
          )}
          {message && <div className="notice" role="status">{message}</div>}
          <p style={{ marginTop: '1rem' }}><Link to="/login">Đăng nhập</Link> <span aria-hidden="true">·</span> <Link to="/forgot-password">Yêu cầu liên kết mới</Link></p>
        </div>
      </section>
    </main>
  );
}

const LEGAL_POLICIES = {
  operating: {
    title: 'Quy chế hoạt động website EMSystems',
    intro: 'Quy chế này mô tả cách khách hàng truy cập, đặt hàng, thanh toán và gửi khiếu nại trên website bán lẻ EMSystems. Nội dung dưới đây là bản dự thảo vận hành, cần chủ thể kinh doanh kiểm tra và hoàn thiện trước khi công khai.',
    sections: [
      ['1. Chủ thể cung cấp website', 'Thông tin người bán phải được công khai đầy đủ và trùng khớp với đăng ký kinh doanh: tên pháp lý, mã số thuế, số đăng ký, địa chỉ trụ sở, hotline và email. Nếu các trường thông tin ở cuối trang còn ghi “Chưa khai báo”, website chưa hoàn thiện dữ liệu nhận diện người bán để phát hành công khai.'],
      ['2. Sản phẩm và giá bán', 'Thông tin sản phẩm, giá, tình trạng hàng và phí giao được hiển thị để khách tham khảo. Giá cuối cùng, tình trạng tồn và phí vận chuyển được hệ thống xác nhận tại bước đặt hàng. Không dùng mô tả từ nguồn dữ liệu bên thứ ba như cam kết riêng của EMSystems.'],
      ['3. Đặt hàng và xác nhận', 'Khi gửi biểu mẫu, hệ thống tạo mã đơn và hiển thị kết quả tiếp nhận. Đơn ở trạng thái chờ xác nhận cho đến khi cửa hàng kiểm tra thông tin, hàng tồn, địa chỉ và khả năng giao. Khách cần giữ mã đơn để tra cứu hoặc liên hệ hỗ trợ.'],
      ['4. Thanh toán', 'Các phương thức thanh toán khả dụng được hiển thị tại checkout. MoMo/VNPAY đang được cấu hình dưới dạng sandbox trong môi trường kiểm thử; VietQR có thể yêu cầu cửa hàng đối soát thủ công. Không coi ảnh QR hoặc màn hình chuyển hướng là bằng chứng thanh toán. Chỉ trạng thái được máy chủ xác minh mới là căn cứ xử lý đơn.'],
      ['5. Vận chuyển và nhận hàng', 'Phí và thời gian dự kiến được hiển thị theo khu vực giao. Thời gian là ước tính, có thể thay đổi do tồn kho, thời tiết, điều kiện giao nhận hoặc đơn vị vận chuyển. Khách cần kiểm tra tình trạng hàng và bao bì khi nhận.'],
      ['6. Khiếu nại và giải quyết tranh chấp', 'Khách có thể gửi yêu cầu tại Trung tâm hỗ trợ, cung cấp mã đơn và thông tin liên hệ. EMSystems tiếp nhận, kiểm tra lịch sử giao dịch và phản hồi qua kênh liên hệ đã được khách lựa chọn. Thời hạn phản hồi và đầu mối tiếp nhận chính thức phải được chủ thể kinh doanh công bố trước khi mở bán.'],
      ['7. Hành vi bị nghiêm cấm', 'Không sử dụng website để giả mạo người khác, chiếm đoạt tài khoản, gửi đơn hàng quấy rối, khai thác lỗi hệ thống, can thiệp dữ liệu hoặc thực hiện hành vi trái pháp luật.'],
    ],
  },
  privacy: {
    title: 'Chính sách bảo vệ dữ liệu cá nhân',
    intro: 'EMSystems chỉ nên thu thập dữ liệu cần thiết cho mục đích cụ thể. Sự đồng ý xử lý dữ liệu, lựa chọn nhận tiếp thị, lựa chọn kênh thông báo và quyền truy cập vị trí là các lựa chọn tách biệt; không gộp thành một checkbox chung.',
    sections: [
      ['1. Chủ thể kiểm soát dữ liệu', 'Chủ thể kiểm soát dữ liệu là tổ chức/cá nhân đứng tên kinh doanh và vận hành website, được ghi tại mục “Thông tin chủ thể kinh doanh” ở chân trang. Các trường chưa khai báo phải được hoàn tất trước khi thu thập dữ liệu khách hàng thật.'],
      ['2. Nhóm dữ liệu có thể được xử lý', 'Họ tên, số điện thoại, email, địa chỉ giao nhận, nội dung ghi chú, sản phẩm/đơn hàng, thông tin thanh toán do nhà cung cấp trả về, lịch sử hỗ trợ, lựa chọn nhận thông báo, thông tin tài khoản và nhật ký bảo mật. Vị trí GPS chỉ được truy cập khi khách chủ động bật chức năng định vị và đồng ý riêng.'],
      ['3. Mục đích xử lý', 'Tạo và bảo vệ tài khoản; tiếp nhận và xác nhận đơn; tính phí giao; thu/đối soát thanh toán; giao hàng; bảo hành, đổi trả, hỗ trợ; phòng chống gian lận; lưu chứng từ và thực hiện nghĩa vụ pháp lý. Tiếp thị/khuyến mại là mục đích riêng, chỉ thực hiện khi khách chủ động lựa chọn.'],
      ['4. Kênh thông báo', 'Email, SMS và Zalo ZNS là các lựa chọn nhận cập nhật giao dịch riêng. Việc đồng ý nhận cập nhật đơn hàng không đồng nghĩa đồng ý nhận quảng cáo. Khách có thể thay đổi lựa chọn hoặc yêu cầu dừng thông báo tiếp thị. Nhà cung cấp chỉ được nhận dữ liệu tối thiểu cần thiết để gửi nội dung đã chọn.'],
      ['5. Bên nhận và xử lý dữ liệu', 'Dữ liệu có thể được chia sẻ ở mức cần thiết với đơn vị vận chuyển, cổng thanh toán, nhà cung cấp email/SMS/ZNS, đơn vị lưu trữ và hỗ trợ kỹ thuật, cơ quan nhà nước có thẩm quyền theo quy định. Danh sách nhà cung cấp thực tế, vị trí xử lý dữ liệu, việc chuyển dữ liệu ra nước ngoài và cơ chế bảo vệ tương ứng phải được chủ thể kinh doanh cập nhật trước khi triển khai thật.'],
      ['6. Thời hạn lưu trữ', 'Dữ liệu được lưu trong thời gian cần thiết để thực hiện giao dịch, xử lý khiếu nại, bảo hành, kế toán/thuế, phòng chống gian lận và các thời hạn lưu trữ bắt buộc. Chủ thể kinh doanh phải ban hành lịch lưu trữ/xóa riêng cho tài khoản, đơn hàng, chứng từ, thông báo và nhật ký bảo mật; không giữ vô thời hạn nếu không có căn cứ.'],
      ['7. Quyền của chủ thể dữ liệu', 'Khách có thể yêu cầu biết, truy cập, chỉnh sửa, rút lại sự đồng ý, hạn chế/phản đối xử lý, xóa hoặc yêu cầu cung cấp dữ liệu theo điều kiện pháp luật. Việc rút lại đồng ý không làm mất tính hợp pháp của hoạt động xử lý đã thực hiện trước thời điểm rút lại và có thể ảnh hưởng khả năng cung cấp một số dịch vụ.'],
      ['8. An toàn và liên hệ', 'EMSystems cần áp dụng phân quyền, mã hóa khi truyền/lưu trữ phù hợp, kiểm soát truy cập, sao lưu, xử lý sự cố và hợp đồng với bên xử lý dữ liệu. Kênh tiếp nhận yêu cầu về dữ liệu cá nhân là hotline/email pháp lý công bố ở chân trang.'],
    ],
  },
  returns: {
    title: 'Chính sách đổi trả và hoàn tiền',
    intro: 'Trang này là khung chính sách. Trước khi công khai, người bán phải xác định và điền rõ thời hạn yêu cầu, điều kiện từng nhóm sản phẩm, chi phí vận chuyển ngược, trường hợp loại trừ và thời hạn hoàn tiền theo hợp đồng với nhà cung cấp.',
    sections: [
      ['1. Kiểm tra trước khi nhận', 'Khách nên kiểm tra đúng sản phẩm, số lượng, phụ kiện, niêm phong và tình trạng ngoại quan khi nhận. Nếu bao bì rách, móp, ướt, sản phẩm sai hoặc có dấu hiệu hư hỏng, hãy ghi nhận với đơn vị giao hàng và liên hệ EMSystems trước khi ký xác nhận hoàn tất.'],
      ['2. Điều kiện yêu cầu', 'Yêu cầu đổi/trả cần có mã đơn, thông tin người mua, sản phẩm, số serial/IMEI nếu có, lý do và ảnh/video tình trạng thực tế. Sản phẩm cần được đối chiếu với điều kiện bảo hành, chính sách của nhà sản xuất và tình trạng sử dụng. Việc chấp nhận phụ thuộc kết quả kiểm tra và quy định áp dụng.'],
      ['3. Thời hạn và trường hợp áp dụng', 'Thời hạn đổi trả cụ thể chưa được chủ thể kinh doanh khai báo trong cấu hình hiện tại. Không tự suy diễn thời hạn từ thông tin của nguồn API hoặc nhà sản xuất. Người bán phải công bố số ngày áp dụng theo từng nhóm sản phẩm trước khi nhận đơn.'],
      ['4. Hoàn tiền', 'Khoản hoàn tiền được xác định sau khi yêu cầu được duyệt, kiểm tra hàng hoàn và đối soát số tiền đã thu. Phương thức, thời hạn và phí hoàn tiền cần được thông báo cho khách trước khi tiến hành. Với giao dịch chuyển khoản/VietQR hoặc khoản thu đến sau khi đơn bị hủy, nhân viên phải đối soát thủ công; trạng thái hệ thống không thay thế xác nhận tiền đã hoàn về tài khoản.'],
      ['5. Gửi yêu cầu', 'Gửi yêu cầu tại Trung tâm hỗ trợ, chọn nhóm “Sản phẩm/Đổi trả”, điền mã đơn và mô tả rõ tình trạng. Hãy giữ nguyên bao bì, phụ kiện và chứng từ cho đến khi có hướng dẫn xử lý.'],
    ],
  },
  shipping: {
    title: 'Chính sách vận chuyển và kiểm hàng',
    intro: 'Phí giao và thời gian dự kiến được tính theo khu vực khách chọn tại checkout. Định vị GPS là tùy chọn, không phải điều kiện bắt buộc để đặt hàng.',
    sections: [
      ['1. Khu vực và phí giao hàng', 'Khu vực hỗ trợ, chi nhánh phục vụ, phí và thời gian dự kiến được hiển thị trong biểu mẫu đặt hàng. Phí cuối cùng là giá trị được xác nhận tại thời điểm gửi đơn. Khu vực chưa hỗ trợ hoặc chi nhánh ngừng hoạt động có thể bị từ chối tiếp nhận.'],
      ['2. Thời gian giao', 'ETA trên website là ước tính, không phải cam kết giao đúng giờ tuyệt đối. Cửa hàng cần xác nhận hàng sẵn sàng, địa chỉ, lịch giao và đơn vị vận chuyển trước khi bàn giao. Trường hợp chậm giao, khách có thể tra cứu mã đơn hoặc tạo yêu cầu hỗ trợ.'],
      ['3. Định vị', 'Khách có thể tự chọn khu vực/phường xã hoặc chủ động cấp quyền GPS để ước tính khoảng cách và phí. Website không nên truy cập vị trí khi chưa có hành động và sự đồng ý riêng; từ chối GPS không làm mất khả năng đặt hàng thủ công.'],
      ['4. Kiểm hàng khi nhận', 'Đối chiếu tên sản phẩm, số lượng, màu/phiên bản, phụ kiện, serial/IMEI, niêm phong và tình trạng ngoại quan. Nếu phát hiện sai lệch hoặc hư hỏng, ghi nhận ngay với người giao hàng, chụp ảnh/video và liên hệ hotline/trung tâm hỗ trợ. Không tự ý sử dụng sản phẩm khi cần xác minh lỗi vận chuyển.'],
      ['5. Giao không thành công', 'Nếu không liên hệ được người nhận, địa chỉ không chính xác hoặc khách không thể nhận hàng, đơn vị vận chuyển có thể cần hẹn lại hoặc hoàn hàng. Chi phí phát sinh và cách xử lý đơn phải được cửa hàng thông báo trước khi xác nhận giao lại.'],
    ],
  },
};

export function LegalPolicyPage() {
  const { policySlug } = useParams();
  const [publicConfig, setPublicConfig] = useState(null);
  useEffect(() => { dataRequest('/config/public').then(setPublicConfig).catch(() => setPublicConfig(null)); }, []);
  const policy = LEGAL_POLICIES[policySlug];
  if (!policy) return <main className="store-legal-page"><div className="store-legal-card"><h1>Không tìm thấy chính sách</h1><Link to="/">Quay lại cửa hàng</Link></div></main>;
  const legal = publicConfig?.legalBusiness || {};
  const missingLegalDetails = !legal.operatorName || !legal.taxCode || !legal.registeredAddress || !legal.hotline;
  return <main className="store-legal-page"><article className="store-legal-card">
    <div className="store-eyebrow">EMSYSTEMS · THÔNG TIN PHÁP LÝ</div>
    <h1>{policy.title}</h1>
    <p className="store-legal-meta">Phiên bản dự thảo 09/11/2026 · Cần người bán xác nhận trước khi công khai</p>
    <div className="notice notice-warning" role="status"><strong>Bản dự thảo chưa phải xác nhận tuân thủ pháp luật.</strong> Người bán cần cung cấp thông tin pháp nhân, rà soát nội dung thực tế, quy trình xử lý và nghĩa vụ áp dụng trước khi đưa website vào kinh doanh.</div>
    {missingLegalDetails && <div className="notice notice-error">Thông tin chủ thể kinh doanh còn thiếu. Không được thay bằng tên, mã số thuế, địa chỉ hoặc giấy phép giả.</div>}
    <p>{policy.intro}</p>
    <section className="store-legal-operator"><h2>Chủ thể kinh doanh / Bên kiểm soát dữ liệu</h2><dl>
      <div><dt>Tên pháp lý</dt><dd>{legal.operatorName || 'Chưa khai báo'}</dd></div>
      <div><dt>Mã số thuế</dt><dd>{legal.taxCode || 'Chưa khai báo'}</dd></div>
      <div><dt>Đăng ký kinh doanh</dt><dd>{legal.businessRegistration || 'Chưa khai báo'}</dd></div>
      <div><dt>Ngày cấp / Cơ quan cấp</dt><dd>{[legal.businessRegistrationDate, legal.businessRegistrationIssuer].filter(Boolean).join(' · ') || 'Chưa khai báo'}</dd></div>
      <div><dt>Địa chỉ</dt><dd>{legal.registeredAddress || 'Chưa khai báo'}</dd></div>
      <div><dt>Người đại diện / Chức danh</dt><dd>{[legal.representativeName, legal.representativeTitle].filter(Boolean).join(' · ') || 'Chưa khai báo'}</dd></div>
      <div><dt>Hotline / Email</dt><dd>{[legal.hotline, legal.email].filter(Boolean).join(' · ') || 'Chưa khai báo'}</dd></div>
    </dl></section>
    {policy.sections.map(([heading, content]) => <section className="store-legal-section" key={heading}><h2>{heading}</h2><p>{content}</p></section>)}
    <div className="store-legal-footer"><Link to="/support">Gửi yêu cầu hỗ trợ</Link><Link to="/">Quay lại cửa hàng</Link></div>
  </article></main>;
}

export function ChangePasswordPage({ onChanged }) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setError('');
    if (newPassword.length < 12 || newPassword.length > 200) {
      setError('Mật khẩu mới phải dài từ 12 đến 200 ký tự.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Mật khẩu xác nhận không khớp.');
      return;
    }
    setBusy(true);
    try {
      await dataRequest('/auth/change-password', {
        method: 'POST', body: { currentPassword, newPassword, confirmPassword },
      });
      onChanged();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  return <main className="login-screen"><section className="login-form-panel"><div className="login-form-wrap">
    <div className="login-brand"><img className="brand-symbol brand-logo-image" src={emsystemsLogo} alt="" /><strong>EMSystems</strong></div>
    <span className="eyebrow">ACCOUNT SECURITY</span>
    <h2>Đổi mật khẩu trước khi tiếp tục</h2>
    <p className="muted">Tài khoản này đang dùng mật khẩu tạm. Hãy đặt mật khẩu riêng để tiếp tục vào workspace.</p>
    <ErrorNotice message={error} />
    <form className="form-stack" onSubmit={submit}>
      <label htmlFor="change-current-password">Mật khẩu hiện tại</label>
      <input id="change-current-password" type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required maxLength={200} />
      <label htmlFor="change-new-password">Mật khẩu mới (12–200 ký tự)</label>
      <input id="change-new-password" type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required minLength={12} maxLength={200} />
      <label htmlFor="change-confirm-password">Xác nhận mật khẩu mới</label>
      <input id="change-confirm-password" type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required minLength={12} maxLength={200} />
      <button className="button button-primary button-wide" type="submit" disabled={busy || !currentPassword || !newPassword || !confirmPassword}>{busy ? 'Đang cập nhật...' : 'Đổi mật khẩu và đăng nhập lại'}</button>
    </form>
    <p className="login-recovery-link">Sau khi đổi, phiên hiện tại bị thu hồi. Hãy đăng nhập lại bằng mật khẩu mới.</p>
  </div></section></main>;
}

export function PaymentResultPage() {
  const orderCode = new URLSearchParams(window.location.search).get('orderCode') || '';
  const [result, setResult] = useState(null); const [error, setError] = useState(''); const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    dataRequest(`/payments/${encodeURIComponent(orderCode)}/status`).then((data) => { if (active) setResult(data); }).catch((requestError) => { if (active) setError(requestError.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [orderCode]);
  return <main className="login-screen"><section className="login-form-panel"><div className="login-form-wrap"><div className="login-brand"><img className="brand-symbol brand-logo-image" src={emsystemsLogo} alt="" /><strong>EMSystems</strong></div><h2>Trạng thái thanh toán</h2>{loading ? <p>Đang đọc trạng thái thanh toán demo trong trình duyệt...</p> : error ? <ErrorNotice message={error} /> : result ? <div className="notice notice-simulation" role="status"><p>Hóa đơn: {result.invoiceNo}</p><p>Trạng thái thanh toán mô phỏng: <strong>{result.paymentStatus}</strong></p><p>Trạng thái đơn hàng: <strong>{result.saleStatus}</strong></p><p>Tổng tiền: {formatMoney(result.amount)}</p><p>Đây là trạng thái mô phỏng lưu trong trình duyệt, không phải giao dịch ngân hàng.</p></div> : <p>Không có dữ liệu giao dịch.</p>}<Link to="/">Quay lại EMSystems</Link></div></section></main>;
}

export function PaymentDemoPage() {
  const params = new URLSearchParams(window.location.search); const orderCode = params.get('orderCode') || ''; const signature = params.get('signature') || '';
  const [status, setStatus] = useState('pending'); const [message, setMessage] = useState('Cổng thanh toán giả lập của môi trường phát triển. Không có tiền thật được chuyển.'); const [busy, setBusy] = useState(false);
  async function complete(success) { setBusy(true); try { const result = await dataRequest(`/payments/mock/${encodeURIComponent(orderCode)}/complete`, { method: 'POST', body: { signature, success } }); setStatus(result.status); setMessage(result.message); } catch (error) { setStatus('error'); setMessage(error.message); } finally { setBusy(false); } }
  return <main className="login-screen"><section className="login-form-panel"><div className="login-form-wrap"><div className="login-brand"><img className="brand-symbol brand-logo-image" src={emsystemsLogo} alt="" /><strong>EMSystems · Thanh toán thử nghiệm</strong></div><h2>Xác nhận giao dịch mẫu</h2><p className="muted">Mã đơn thanh toán: {orderCode || 'Không hợp lệ'}</p><div className={['error', 'cancelled'].includes(status) ? 'notice notice-error' : 'notice notice-simulation'} role="status">{message}</div>{status === 'pending' ? <div className="form-stack"><button className="button button-primary button-wide" type="button" disabled={busy || !orderCode || !signature} onClick={() => complete(true)}>{busy ? 'Đang xử lý...' : 'Giả lập thanh toán thành công'}</button><button className="button button-secondary button-wide" type="button" disabled={busy || !orderCode || !signature} onClick={() => complete(false)}>Giả lập thất bại / hủy</button></div> : <p>Trạng thái hiện tại: <strong>{status}</strong></p>}<Link to="/login">Quay về đăng nhập</Link></div></section></main>;
}

export function DashboardPage({ user }) {
  const workspaceBase = user?.role === 'admin' ? '/admin' : '/ctv';
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function loadSummary() {
    setLoading(true);
    setError('');
    try {
      const result = await dataRequest('/dashboard/summary');
      setSummary(result.summary);
    } catch (requestError) {
      setSummary(null);
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadSummary(); }, []);

  // Số liệu tổng hợp từ dữ liệu demo lưu cục bộ trong trình duyệt.
  const cards = [
    { label: 'Doanh thu hôm nay', value: summary ? formatMoney(summary.revenueToday) : '—', note: summary ? 'Đơn hàng đã hoàn tất' : 'Chưa có dữ liệu demo', icon: 'graph-up-arrow', className: 'metric-revenue' },
    { label: 'Doanh thu tháng này', value: summary ? formatMoney(summary.revenueMonth) : '—', note: summary ? 'Tính theo ngày hiện tại' : 'Chưa có dữ liệu demo', icon: 'calendar3', className: 'metric-month' },
    { label: 'Đơn hoàn tất hôm nay', value: summary ? summary.ordersToday.toLocaleString('vi-VN') : '—', note: summary ? 'Không gồm đơn bị hủy' : 'Chưa có dữ liệu demo', icon: 'check2-circle', className: 'metric-orders' },
    { label: 'Sản phẩm đang kinh doanh', value: summary ? summary.totalProducts.toLocaleString('vi-VN') : '—', note: summary ? 'Theo danh mục sản phẩm' : 'Chưa có dữ liệu demo', icon: 'box-seam', className: 'metric-products' },
    { label: 'Sản phẩm tồn kho thấp', value: summary ? summary.lowStockProducts.toLocaleString('vi-VN') : '—', note: summary ? 'Tồn kho từ 5 đơn vị trở xuống' : 'Chưa có dữ liệu demo', icon: 'exclamation-triangle', className: 'metric-warning' },
  ];

  return (
    <div className="page-stack">
      <section className="welcome-row"><div><span className="eyebrow">BUSINESS OVERVIEW · DEMO</span><h2>Hoạt động kinh doanh</h2><p>Các chỉ số được tổng hợp từ dữ liệu mô phỏng trong trình duyệt.</p></div><button type="button" className="button button-secondary" onClick={loadSummary} disabled={loading}><i className="bi bi-arrow-clockwise" aria-hidden="true" /> <span>{loading ? 'Đang cập nhật' : 'Làm mới số liệu'}</span></button></section>
      <ErrorNotice message={error} onRetry={loadSummary} />
      <section className="metric-grid" aria-label="Chỉ số kinh doanh">
        {loading && !summary ? Array.from({ length: 5 }, (_, index) => <div className="metric-card metric-skeleton" key={index}><span /><strong /><small /></div>) : null}
        {!loading && cards.map((card) => <article className={`metric-card ${card.className}`} key={card.label}><div className="metric-head"><span>{card.label}</span><span className="metric-icon"><i className={`bi bi-${card.icon}`} aria-hidden="true" /></span></div><strong className="metric-value">{card.value}</strong><small>{card.note}</small></article>)}
      </section>
      <section className="dashboard-lower-grid">
        <article className="panel panel-main">
          <div className="panel-heading"><div><span className="eyebrow">WORKFLOW</span><h3>Tiếp tục công việc</h3></div><span className="panel-index">01 — 03</span></div>
          <div className="workflow-row"><div className="workflow-icon"><i className="bi bi-box-seam" aria-hidden="true" /></div><div className="workflow-copy"><strong>Danh mục sản phẩm</strong><p>Thêm mới, cập nhật giá bán và xem thông tin sản phẩm nội bộ.</p></div><Link className="inline-link" to={`${workspaceBase}/products`}>Mở sản phẩm <i className="bi bi-arrow-right" aria-hidden="true" /></Link></div>
          {canAccessAdminRoute(user?.role, '/admin/inventory') && <div className="workflow-row"><div className="workflow-icon"><i className="bi bi-arrow-left-right" aria-hidden="true" /></div><div className="workflow-copy"><strong>Quản lý tồn kho</strong><p>Theo dõi tồn kho, nhập xuất và biến động hàng hóa.</p></div><Link className="inline-link" to={`${workspaceBase}/inventory`}>Mở kho hàng <i className="bi bi-arrow-right" aria-hidden="true" /></Link></div>}
          {canAccessAdminRoute(user?.role, '/admin/sales') && <div className="workflow-row"><div className="workflow-icon"><i className="bi bi-receipt" aria-hidden="true" /></div><div className="workflow-copy"><strong>Đơn hàng</strong><p>Xem lịch sử bán hàng và thao tác trên đơn nội bộ.</p></div><Link className="inline-link" to={`${workspaceBase}/sales`}>Mở đơn hàng <i className="bi bi-arrow-right" aria-hidden="true" /></Link></div>}
        </article>
        <article className="panel data-panel">
          <div className="panel-heading"><div><span className="eyebrow">DATA STATUS</span><h3>Dữ liệu máy chủ</h3></div>{summary ? <span className="live-dot" title="Dữ liệu máy chủ đã được tải" /> : <span className="status-tag">Chưa có số liệu</span>}</div>
          <div className="data-status-line"><span className="data-status-check">{summary ? <i className="bi bi-check-lg" aria-hidden="true" /> : '—'}</span><div><strong>{summary ? 'Dữ liệu máy chủ đã tải' : 'Chưa tải được dữ liệu máy chủ'}</strong><p>{summary ? 'Các chỉ số được tính từ dữ liệu nghiệp vụ trên máy chủ.' : loading ? 'Đang tải số liệu...' : 'Bấm làm mới để tải lại dữ liệu từ máy chủ.'}</p></div></div>
          <div className="data-divider" />
          <p className="data-disclaimer">Các con số là dữ liệu mẫu và nghiệp vụ mô phỏng được lưu trong SQLite phía máy chủ; không đại diện cho dữ liệu kinh doanh thực.</p>
        </article>
      </section>
    </div>
  );
}

const emptyForm = {
  sku: '', name: '', costPrice: '', sellingPrice: '', warrantyMonths: '12',
  categoryId: '', brandId: '', supplierId: '', description: '', imageUrl: '',
  additionalImagesText: '', technicalDetails: '',
};
const DUMMY_CATEGORIES = [
  { value: 'smartphones', label: 'Điện thoại' },
  { value: 'laptops', label: 'Laptop' },
  { value: 'tablets', label: 'Máy tính bảng' },
  { value: 'mobile-accessories', label: 'Phụ kiện di động' },
];
const DUMMY_PAGE_SIZE = 8;

export function ProductsPage({ user, initialMode = 'local' }) {
  const [products, setProducts] = useState([]);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [selectedProductImageIndex, setSelectedProductImageIndex] = useState(0);
  const [selectedDummyProduct, setSelectedDummyProduct] = useState(null);
  const [selectedDummyImageIndex, setSelectedDummyImageIndex] = useState(0);
  const [categories, setCategories] = useState([]);
  const [brands, setBrands] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 10, totalItems: 0, totalPages: 0 });
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [viewMode, setViewMode] = useState(initialMode);
  const [dummyCategory, setDummyCategory] = useState('smartphones');
  const [dummySearchInput, setDummySearchInput] = useState('');
  const [dummySearch, setDummySearch] = useState('');
  const [dummyProducts, setDummyProducts] = useState([]);
  const [dummyPage, setDummyPage] = useState(1);
  const [dummyLoading, setDummyLoading] = useState(false);
  const [dummyError, setDummyError] = useState('');
  const [dummyRetry, setDummyRetry] = useState(0);
  const [importedIds, setImportedIds] = useState(new Set());
  const [importingId, setImportingId] = useState(null);
  const [importNotice, setImportNotice] = useState('');
  const canEdit = user?.role === 'admin' || user?.role === 'manager';
  // Ẩn giá vốn ở vai trò bán hàng chỉ là hành vi giao diện, không phải biện pháp bảo mật.
  const canSeeCost = ['admin', 'manager', 'warehouse'].includes(user?.role);

  useEffect(() => {
    if (!selectedProduct && !selectedDummyProduct) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    function closeOnEscape(event) {
      if (event.key === 'Escape') {
        setSelectedProduct(null);
        setSelectedDummyProduct(null);
      }
    }
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [selectedProduct, selectedDummyProduct]);

  async function loadProducts() {
    setLoading(true);
    setError('');
    try {
      const query = new URLSearchParams({ page: String(page), pageSize: '10', search });
      const result = await dataRequest(`/products?${query.toString()}`);
      setProducts(result.data);
      setPagination(result.pagination);
    } catch (requestError) {
      setProducts([]);
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (viewMode === 'local') loadProducts();
  }, [page, search, viewMode]);
  useEffect(() => {
    if (viewMode !== 'local') return;
    Promise.all([
      dataRequest('/categories'),
      dataRequest('/brands'),
      dataRequest('/suppliers'),
    ]).then(([categoryResult, brandResult, supplierResult]) => {
      setCategories(categoryResult.data);
      setBrands(brandResult.data);
      setSuppliers(supplierResult.data);
    }).catch(() => {
      // Nếu tải danh mục lỗi, không tạo lựa chọn giả; người dùng vẫn thấy lỗi khi lưu dữ liệu.
      setCategories([]);
      setBrands([]);
      setSuppliers([]);
    });
  }, [viewMode]);

  useEffect(() => {
    if (viewMode !== 'dummy') return undefined;
    const controller = new AbortController();
    async function loadDummyProducts() {
      setDummyLoading(true);
      setDummyError('');
      try {
        // Chỉ đọc danh mục công khai từ DummyJSON; dữ liệu này không được nhập vào nghiệp vụ dữ liệu máy chủ.
        const url = `https://dummyjson.com/products/category/${encodeURIComponent(dummyCategory)}?limit=0&select=id,title,description,category,price,discountPercentage,rating,stock,brand,sku,thumbnail,images,tags,weight,dimensions,warrantyInformation,shippingInformation,returnPolicy,availabilityStatus,minimumOrderQuantity,reviews`;
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error(`DummyJSON trả về HTTP ${response.status}.`);
        const result = await response.json();
        if (!Array.isArray(result.products)) throw new Error('Dữ liệu trả về từ DummyJSON không đúng định dạng.');
        setDummyProducts(result.products);
        setDummyPage(1);
      } catch (requestError) {
        if (requestError.name !== 'AbortError') {
          setDummyProducts([]);
          setDummyError(`${requestError.message || 'Không tải được dữ liệu mẫu.'} Kiểm tra kết nối Internet rồi thử lại.`);
        }
      } finally {
        if (!controller.signal.aborted) setDummyLoading(false);
      }
    }
    loadDummyProducts();
    return () => controller.abort();
  }, [viewMode, dummyCategory, dummyRetry]);

  useEffect(() => {
    if (viewMode !== 'dummy' || !canEdit) return;
    let active = true;
    dataRequest('/products?page=1&pageSize=100')
      .then((result) => {
        if (active) setImportedIds(new Set((result.data || []).filter((item) => item.externalSource === 'dummyjson').map((item) => Number(item.dummyJsonId))));
      })
      .catch(() => { if (active) setImportedIds(new Set()); });
    return () => { active = false; };
  }, [viewMode, canEdit]);

  async function importDummyProduct(product) {
    setImportingId(Number(product.id));
    setError('');
    setSuccess('');
    setImportNotice('');
    try {
      const result = await dataRequest('/catalogs/dummyjson/import', {
        method: 'POST',
        body: {
          products: [{
            id: product.id, title: product.title, description: product.description,
            category: product.category, price: product.price, rating: product.rating,
            brand: product.brand, sku: product.sku, thumbnail: product.thumbnail,
            images: product.images,
            tags: product.tags, weight: product.weight, dimensions: product.dimensions,
            warrantyInformation: product.warrantyInformation, shippingInformation: product.shippingInformation,
            returnPolicy: product.returnPolicy, availabilityStatus: product.availabilityStatus,
            minimumOrderQuantity: product.minimumOrderQuantity,
            reviews: Array.isArray(product.reviews) ? product.reviews.map(({ rating, comment, date, reviewerName }) => ({ rating, comment, date, reviewerName })) : [],
          }],
        },
      });
      setImportedIds((current) => new Set([...current, Number(product.id)]));
      setSuccess(result.message || 'Đã nhập bản nháp từ DummyJSON.');
      setImportNotice(result.nextSteps || 'Nhập giá bán VNĐ, tạo tồn kho và kích hoạt trước khi bán.');
    } catch (requestError) {
      setError(requestError.message || 'Không nhập được sản phẩm API.');
    } finally {
      setImportingId(null);
    }
  }

  function changeForm(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function startCreate() {
    setEditingId(null);
    setForm(emptyForm);
    setFormOpen(true);
    setSuccess('');
  }

  function startEdit(product) {
    setSelectedProduct(null);
    setEditingId(product.id);
    const primaryImage = product.imageUrl || product.images?.[0] || '';
    setForm({
      sku: product.sku,
      name: product.name,
      costPrice: String(product.costPrice),
      sellingPrice: String(product.sellingPrice),
      warrantyMonths: String(product.warrantyMonths),
      categoryId: product.categoryId ? String(product.categoryId) : '',
      brandId: product.brandId ? String(product.brandId) : '',
      supplierId: product.supplierId ? String(product.supplierId) : '',
      description: product.description || '',
      imageUrl: primaryImage,
      additionalImagesText: (product.images || []).filter((image) => image && image !== primaryImage).join('\n'),
      technicalDetails: product.technicalDetails || '',
    });
    setFormOpen(true);
    setSuccess('');
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    setSuccess('');
    const { additionalImagesText, ...productFields } = form;
    const payload = {
      ...productFields,
      costPrice: Number(form.costPrice),
      sellingPrice: Number(form.sellingPrice),
      warrantyMonths: Number(form.warrantyMonths),
      categoryId: form.categoryId || null,
      brandId: form.brandId || null,
      supplierId: form.supplierId || null,
      images: [...new Set([form.imageUrl, ...additionalImagesText.split(/\r?\n/)].map((url) => url.trim()).filter(Boolean))].slice(0, 12),
    };
    try {
      const result = await dataRequest(editingId ? `/products/${editingId}` : '/products', {
        method: editingId ? 'PATCH' : 'POST',
        body: payload,
      });
      setSuccess(result.message || 'Đã lưu sản phẩm.');
      setFormOpen(false);
      setEditingId(null);
      setForm(emptyForm);
      await loadProducts();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  }

  async function deactivateProduct(product) {
    const canDelete = product.canDelete === true;
    const nextActiveState = !product.isActive;
    const confirmMessage = canDelete
      ? `Xóa hẳn sản phẩm "${product.name}"? Sản phẩm này chưa có lịch sử bán và tồn kho đang bằng 0 ở mọi chi nhánh.`
      : product.isActive
        ? `Ngừng kinh doanh sản phẩm "${product.name}"? Lịch sử và tồn kho được giữ nguyên.`
        : `Kích hoạt lại sản phẩm "${product.name}"?`;
    if (!window.confirm(confirmMessage)) return;
    setError('');
    setSuccess('');
    try {
      const result = await dataRequest(
        canDelete ? `/products/${product.id}` : `/products/${product.id}/status`,
        { method: canDelete ? 'DELETE' : 'PATCH', body: canDelete ? {} : { isActive: nextActiveState } },
      );
      setSuccess(result.message || (canDelete ? 'Đã xóa sản phẩm.' : 'Đã cập nhật trạng thái.'));
      await loadProducts();
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  function handleSearch(event) {
    event.preventDefault();
    setPage(1);
    setSearch(searchInput.trim());
  }

  const filteredDummyProducts = dummyProducts.filter((product) => {
    const query = dummySearch.trim().toLocaleLowerCase('vi-VN');
    if (!query) return true;
    return [product.title, product.brand, product.sku, product.description]
      .some((value) => String(value || '').toLocaleLowerCase('vi-VN').includes(query));
  });
  const dummyTotalPages = Math.max(1, Math.ceil(filteredDummyProducts.length / DUMMY_PAGE_SIZE));
  const visibleDummyProducts = filteredDummyProducts.slice(
    (dummyPage - 1) * DUMMY_PAGE_SIZE,
    dummyPage * DUMMY_PAGE_SIZE,
  );

  return (
    <div className="page-stack">
      <section className="welcome-row"><div><span className="eyebrow">PRODUCT CATALOG</span><h2>Danh mục sản phẩm</h2><p>Quản lý hàng hóa nội bộ hoặc xem dữ liệu công khai thử nghiệm từ một dịch vụ bên ngoài.</p></div>{canEdit && viewMode === 'local' && <button type="button" className="button button-primary" onClick={startCreate}><i className="bi bi-plus-lg" aria-hidden="true" /> Thêm sản phẩm</button>}</section>
      <div className="catalog-switch" role="group" aria-label="Nguồn sản phẩm">
        <button type="button" className={`catalog-switch-button${viewMode === 'local' ? ' selected' : ''}`} onClick={() => { setSelectedProduct(null); setSelectedDummyProduct(null); setViewMode('local'); }}>Sản phẩm nghiệp vụ <span>Máy chủ</span></button>
        <button type="button" className={`catalog-switch-button${viewMode === 'dummy' ? ' selected' : ''}`} onClick={() => { setSelectedProduct(null); setSelectedDummyProduct(null); setViewMode('dummy'); }}>Sản phẩm mẫu <span>DummyJSON</span></button>
      </div>
      {viewMode === 'dummy' && <div className="dummy-notice"><strong>DỮ LIỆU MẪU TỪ DUMMYJSON</strong><p>Giá API hiển thị bằng USD và tồn API không phải kho EMSystems. Quản trị viên/quản lý có thể nhập sản phẩm thành bản nháp nội bộ; sản phẩm mới mặc định giá 0 VNĐ, tắt bán, tồn kho 0 để không thể bán nhầm giá hoặc nhầm số lượng.</p>{importNotice && <p className="dummy-import-next-steps">{importNotice}</p>}</div>}
      {error && <ErrorNotice message={error} onRetry={loadProducts} />}
      {success && <div className="notice notice-success" role="status">{success}<button type="button" className="notice-close" onClick={() => setSuccess('')} aria-label="Đóng thông báo"><i className="bi bi-x-lg" aria-hidden="true" /></button></div>}

      {viewMode === 'local' && formOpen && <section className="panel product-form-panel"><div className="panel-heading"><div><span className="eyebrow">PRODUCT DETAILS</span><h3>{editingId ? 'Cập nhật sản phẩm' : 'Thêm sản phẩm mới'}</h3></div><button type="button" className="icon-button" onClick={() => setFormOpen(false)} aria-label="Đóng biểu mẫu"><i className="bi bi-x-lg" aria-hidden="true" /></button></div>
        <form className="product-form" onSubmit={handleSubmit}>
          <div className="form-field"><label htmlFor="product-sku">Mã SKU *</label><input id="product-sku" value={form.sku} onChange={(event) => changeForm('sku', event.target.value)} required maxLength={60} /></div>
          <div className="form-field form-field-wide"><label htmlFor="product-name">Tên sản phẩm *</label><input id="product-name" value={form.name} onChange={(event) => changeForm('name', event.target.value)} required maxLength={180} /></div>
          <div className="form-field"><label htmlFor="product-cost">Giá vốn (VNĐ) *</label><input id="product-cost" type="number" min="0" step="1" value={form.costPrice} onChange={(event) => changeForm('costPrice', event.target.value)} required /></div>
          <div className="form-field"><label htmlFor="product-price">Giá bán (VNĐ) *</label><input id="product-price" type="number" min="0" step="1" value={form.sellingPrice} onChange={(event) => changeForm('sellingPrice', event.target.value)} required /></div>
          <div className="form-field"><label htmlFor="product-warranty">Bảo hành (tháng)</label><input id="product-warranty" type="number" min="0" max="120" value={form.warrantyMonths} onChange={(event) => changeForm('warrantyMonths', event.target.value)} /></div>
          <div className="form-field"><label htmlFor="product-category">Danh mục</label><select id="product-category" value={form.categoryId} onChange={(event) => changeForm('categoryId', event.target.value)}><option value="">Chưa phân loại</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></div>
          <div className="form-field"><label htmlFor="product-brand">Thương hiệu</label><select id="product-brand" value={form.brandId} onChange={(event) => changeForm('brandId', event.target.value)}><option value="">Chưa chọn</option>{brands.map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}</select></div>
          <div className="form-field"><label htmlFor="product-supplier">Nhà cung cấp</label><select id="product-supplier" value={form.supplierId} onChange={(event) => changeForm('supplierId', event.target.value)}><option value="">Chưa chọn</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name} ({supplier.code})</option>)}</select></div>
          <div className="form-field form-field-wide"><label htmlFor="product-description">Mô tả chi tiết</label><textarea id="product-description" rows={4} value={form.description} onChange={(event) => changeForm('description', event.target.value)} maxLength={3000} placeholder="Mô tả tính năng, công dụng, đối tượng sử dụng..." /><small>{form.description.length}/3000 ký tự</small></div>
          <div className="form-field form-field-wide"><label htmlFor="product-technical-details">Thông số kỹ thuật của cửa hàng</label><textarea id="product-technical-details" rows={5} value={form.technicalDetails} onChange={(event) => changeForm('technicalDetails', event.target.value)} maxLength={5000} placeholder={'Mỗi dòng một thông số, theo dạng Tên: Giá trị\nVí dụ: RAM: 8 GB\nBộ nhớ: 256 GB'} /><small>Chỉ nhập thông số đã được xác minh từ sản phẩm thật. Tối đa 5.000 ký tự.</small></div>
          <div className="form-field form-field-wide"><label htmlFor="product-image-url">URL ảnh chính (HTTPS hoặc đường dẫn nội bộ)</label><input id="product-image-url" type="text" inputMode="url" value={form.imageUrl} onChange={(event) => changeForm('imageUrl', event.target.value)} maxLength={1000} placeholder="https://.../product.webp hoặc /assets/product.webp" /><small>Không dùng URL http://, javascript: hoặc data:. Có thể để trống nếu chưa có ảnh.</small></div>
          <div className="form-field form-field-wide"><label htmlFor="product-additional-images">Ảnh bổ sung (mỗi dòng một URL)</label><textarea id="product-additional-images" rows={3} value={form.additionalImagesText} onChange={(event) => changeForm('additionalImagesText', event.target.value)} placeholder="https://.../product-side.webp\nhttps://.../product-back.webp" /><small>Tối đa 11 ảnh bổ sung; tổng cộng tối đa 12 ảnh kể cả ảnh chính.</small></div>
          {!categories.length && <p className="form-hint form-field-wide">Chưa có danh mục trong dữ liệu demo. Hãy tạo danh mục ở màn hình Quản lý danh mục.</p>}
          <div className="form-actions form-field-wide"><button type="button" className="button button-secondary" onClick={() => setFormOpen(false)}>Hủy</button><button className="button button-primary" type="submit" disabled={saving}>{saving ? 'Đang lưu...' : 'Lưu sản phẩm'}</button></div>
        </form>
      </section>}

      {viewMode === 'dummy' ? <section className="panel table-panel">
        <div className="table-toolbar dummy-toolbar"><div><h3>Danh mục điện tử mẫu</h3><p>{filteredDummyProducts.length.toLocaleString('vi-VN')} sản phẩm từ DummyJSON · không phải dữ liệu EMSystems</p></div><div className="dummy-controls"><label className="dummy-category-select"><span>Nhóm hàng</span><select value={dummyCategory} onChange={(event) => { setDummyCategory(event.target.value); setDummySearch(''); setDummySearchInput(''); }}><option value="smartphones">Điện thoại</option><option value="laptops">Laptop</option><option value="tablets">Máy tính bảng</option><option value="mobile-accessories">Phụ kiện di động</option></select></label><form className="search-form" onSubmit={(event) => { event.preventDefault(); setDummyPage(1); setDummySearch(dummySearchInput); }}><label className="search-box"><i className="bi bi-search" aria-hidden="true" /><input aria-label="Tìm sản phẩm mẫu" placeholder="Tìm sản phẩm mẫu..." value={dummySearchInput} onChange={(event) => setDummySearchInput(event.target.value)} /><button type="submit">Tìm</button></label></form></div></div>
        {dummyError && <div className="dummy-error"><ErrorNotice message={dummyError} onRetry={() => setDummyRetry((current) => current + 1)} /></div>}
        {dummyLoading ? <div className="table-loading"><span className="loader" /> Đang tải sản phẩm từ DummyJSON...</div> : dummyError ? null : visibleDummyProducts.length === 0 ? <EmptyState title="Không tìm thấy sản phẩm mẫu" description="Thử từ khóa khác hoặc chuyển sang nhóm hàng khác." /> : <div className="dummy-product-grid">{visibleDummyProducts.map((product) => <article className="dummy-product-card" key={product.id}><button type="button" className="dummy-product-image dummy-product-image-button" onClick={() => { setSelectedDummyProduct(product); setSelectedDummyImageIndex(0); }} aria-label={"Xem chi tiết " + product.title}>{product.thumbnail ? <img src={product.thumbnail} alt="" loading="lazy" /> : <i className="bi bi-box-seam" aria-hidden="true" />}<span className="dummy-origin-label">API</span></button><div className="dummy-product-info"><span className="dummy-product-category">{DUMMY_CATEGORIES.find((item) => item.value === product.category)?.label || product.category}</span><h4><button type="button" className="dummy-product-title" onClick={() => { setSelectedDummyProduct(product); setSelectedDummyImageIndex(0); }}>{product.title}</button></h4><p className="dummy-brand">{product.brand || 'Không có thương hiệu'} · Mã API {product.sku || product.id}</p><div className="dummy-product-bottom"><strong>US$ {Number(product.price || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong><span className="dummy-rating"><i className="bi bi-star-fill" aria-hidden="true" /> {Number(product.rating || 0).toFixed(1)}</span></div><p className="dummy-stock">Tồn API mẫu: {Number(product.stock || 0).toLocaleString('vi-VN')} · không dùng để bán hàng</p>{canEdit && <button type="button" className="button button-secondary button-small dummy-import-button" disabled={importingId === Number(product.id) || importedIds.has(Number(product.id))} onClick={() => importDummyProduct(product)}>{importingId === Number(product.id) ? 'Đang nhập...' : importedIds.has(Number(product.id)) ? 'Đã nhập nội bộ' : <><i className="bi bi-plus-lg" aria-hidden="true" /> Nhập bản nháp</>}</button>}</div></article>)}</div>}
        {!dummyLoading && !dummyError && filteredDummyProducts.length > 0 && <div className="pagination"><span>Trang {dummyPage} / {dummyTotalPages}</span><div><button type="button" className="button button-secondary button-small" disabled={dummyPage <= 1} onClick={() => setDummyPage((current) => Math.max(1, current - 1))}><i className="bi bi-chevron-left" aria-hidden="true" /> Trước</button><button type="button" className="button button-secondary button-small" disabled={dummyPage >= dummyTotalPages} onClick={() => setDummyPage((current) => Math.min(dummyTotalPages, current + 1))}>Sau <i className="bi bi-chevron-right" aria-hidden="true" /></button></div></div>}
      </section> : <section className="panel table-panel"><div className="table-toolbar"><div><h3>Danh sách hàng hóa</h3><p>{pagination.totalItems.toLocaleString('vi-VN')} sản phẩm trong dữ liệu demo</p></div><form className="search-form" onSubmit={handleSearch}><label className="search-box"><i className="bi bi-search" aria-hidden="true" /><input aria-label="Tìm theo tên hoặc mã SKU" placeholder="Tìm tên hoặc mã SKU..." value={searchInput} onChange={(event) => setSearchInput(event.target.value)} /><button type="submit">Tìm</button></label></form></div>
        {loading ? <div className="table-loading"><span className="loader" /> Đang tải dữ liệu demo...</div> : products.length === 0 ? <EmptyState title={search ? 'Không tìm thấy sản phẩm' : 'Chưa có sản phẩm'} description={search ? 'Thử tìm bằng mã SKU hoặc một từ khóa khác.' : 'Dữ liệu nghiệp vụ trên máy chủ đang trống. Dữ liệu DummyJSON hiển thị riêng và không được nhập tự động.'} action={canEdit && !search ? <button className="button button-secondary" onClick={startCreate}><i className="bi bi-plus-lg" aria-hidden="true" />  Thêm sản phẩm</button> : null} /> : <div className="table-scroll"><table><thead><tr><th>SẢN PHẨM</th><th>MÃ SKU</th>{canSeeCost && <th>GIÁ VỐN</th>}<th>GIÁ BÁN</th><th>TỒN KHO</th><th>BẢO HÀNH</th>{canEdit && <th>THAO TÁC</th>}</tr></thead><tbody>{products.map((product) => <tr key={product.id}><td><div className="product-name-cell"><span className="product-mini-icon"><i className="bi bi-box-seam" aria-hidden="true" /></span><span><button type="button" className="product-record-open" onClick={() => { setSelectedProduct(product); setSelectedProductImageIndex(0); }} aria-label={'Xem chi tiết ' + product.name}><strong>{product.name}</strong></button><small>{product.categoryName || 'Chưa phân loại'}{product.brandName ? ` · ${product.brandName}` : ''}</small></span></div></td><td><code>{product.sku}</code></td>{canSeeCost && <td>{formatMoney(product.costPrice)}</td>}<td className="price-cell">{formatMoney(product.sellingPrice)}</td><td><span className={`stock-pill ${product.stock <= 5 ? 'stock-low' : 'stock-ok'}`}>{product.stock}</span></td><td>{product.warrantyMonths} tháng</td>{canEdit && <td><div className="row-actions"><button type="button" className="table-action" onClick={() => startEdit(product)}>Sửa</button><button type="button" className={`table-action ${product.canDelete || product.isActive ? 'table-action-danger' : ''}`} onClick={() => deactivateProduct(product)}>{product.canDelete ? 'Xóa' : product.isActive ? 'Ngừng' : 'Bật lại'}</button></div></td>}</tr>)}</tbody></table></div>}
        {!loading && products.length > 0 && <div className="pagination"><span>Trang {pagination.page} / {Math.max(1, pagination.totalPages)}</span><div><button className="button button-secondary button-small" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}><i className="bi bi-chevron-left" aria-hidden="true" /> Trước</button><button className="button button-secondary button-small" disabled={page >= pagination.totalPages} onClick={() => setPage((current) => current + 1)}>Sau <i className="bi bi-chevron-right" aria-hidden="true" /></button></div></div>}
      </section>}

      {selectedDummyProduct && viewMode === 'dummy' && (() => {
        const product = selectedDummyProduct;
        const images = [...new Set([product.thumbnail, ...(product.images || [])].filter((image) => typeof image === 'string' && image.trim()))].slice(0, 12);
        const activeImage = images[Math.min(selectedDummyImageIndex, Math.max(0, images.length - 1))] || '';
        const dimensions = product.dimensions && ['width', 'height', 'depth'].some((key) => product.dimensions[key] != null)
          ? ['width', 'height', 'depth'].filter((key) => product.dimensions[key] != null).map((key) => `${key}: ${product.dimensions[key]}`).join(' · ') : 'Không có dữ liệu kích thước';
        return <div className="product-record-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedDummyProduct(null); }}>
          <section className="product-record-modal" role="dialog" aria-modal="true" aria-labelledby="dummy-product-record-title">
            <button type="button" className="product-record-close" onClick={() => setSelectedDummyProduct(null)} aria-label="Đóng chi tiết sản phẩm API"><i className="bi bi-x-lg" aria-hidden="true" /></button>
            <div className="product-record-header"><span className="eyebrow">DUMMYJSON · CATALOG THAM KHẢO</span><h3 id="dummy-product-record-title">{product.title}</h3><p>{product.category} · {product.brand || 'Chưa có thương hiệu'} · SKU nguồn {product.sku || product.id}</p></div>
            <div className="product-record-grid">
              <div className="product-record-gallery"><div className="product-record-main-image"><span className="store-product-image-fallback" aria-hidden="true"><i className="bi bi-box-seam" /></span>{activeImage && <img src={activeImage} alt={product.title} onError={(event) => { event.currentTarget.style.visibility = 'hidden'; }} />}</div>{images.length > 1 && <div className="product-record-thumbnails">{images.map((image, index) => <button type="button" className={index === selectedDummyImageIndex ? 'selected' : ''} key={image} onClick={() => setSelectedDummyImageIndex(index)} aria-label={`Xem ảnh ${index + 1}`} aria-pressed={index === selectedDummyImageIndex}><img src={image} alt="" loading="lazy" /></button>)}</div>}</div>
              <div className="product-record-content"><div className="product-record-facts"><div><span>Giá từ API (USD)</span><strong>US$ {Number(product.price || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></div><div><span>Điểm API</span><strong>{Number(product.rating || 0).toFixed(1)} / 5</strong></div><div><span>Tồn API mẫu</span><strong>{Number(product.stock || 0).toLocaleString('vi-VN')}</strong></div><div><span>Trạng thái nguồn</span><strong>{product.availabilityStatus || 'Không rõ'}</strong></div><div><span>Khối lượng nguồn</span><strong>{product.weight ?? 'Không có dữ liệu'}</strong></div><div><span>Kích thước nguồn</span><strong>{dimensions}</strong></div><div><span>Bảo hành nguồn</span><strong>{product.warrantyInformation || 'Không có dữ liệu'}</strong></div><div><span>Số lượng đặt tối thiểu</span><strong>{product.minimumOrderQuantity ?? 'Không có dữ liệu'}</strong></div></div>
                <section className="product-record-section"><h4>Mô tả từ nguồn API</h4><p>{product.description || 'Nguồn API không cung cấp mô tả.'}</p></section>
                {(product.shippingInformation || product.returnPolicy) && <section className="product-record-section"><h4>Chính sách tham khảo của nguồn API</h4><dl>{product.shippingInformation && <div><dt>Giao hàng</dt><dd>{product.shippingInformation}</dd></div>}{product.returnPolicy && <div><dt>Đổi trả</dt><dd>{product.returnPolicy}</dd></div>}</dl><p className="product-record-source-note">Các giá trị này không phải cam kết hoặc chính sách của EMSystems.</p></section>}
                {product.tags?.length > 0 && <section className="product-record-section"><h4>Từ khóa</h4><div className="product-record-tags">{product.tags.map((tag) => <span key={tag}>{tag}</span>)}</div></section>}
                {product.reviews?.length > 0 && <section className="product-record-section"><h4>Đánh giá tham khảo</h4>{product.reviews.slice(0, 5).map((review, index) => <article className="dummy-detail-review" key={`${review.reviewerName}-${review.date}-${index}`}><div><strong>{review.reviewerName || 'Người đánh giá'}</strong><span><i className="bi bi-star-fill" aria-hidden="true" /> {Number(review.rating || 0).toFixed(1)} / 5</span></div><p>{review.comment || 'Không có nội dung đánh giá.'}</p></article>)}</section>}
                <p className="product-record-source-note">Dữ liệu của DummyJSON chỉ dùng để tham khảo. Giá USD, điểm đánh giá và tồn API không phải giá bán, đánh giá đã xác minh hoặc tồn kho EMSystems.</p>
              </div>
            </div>
            <div className="product-record-actions"><button type="button" className="button button-secondary" onClick={() => setSelectedDummyProduct(null)}>Đóng</button>{canEdit && <button type="button" className="button button-primary" disabled={importingId === Number(product.id) || importedIds.has(Number(product.id))} onClick={() => importDummyProduct(product)}>{importingId === Number(product.id) ? 'Đang nhập...' : importedIds.has(Number(product.id)) ? 'Đã nhập nội bộ' : <><i className="bi bi-plus-lg" aria-hidden="true" /> Nhập bản nháp nội bộ</>}</button>}</div>
          </section>
        </div>;
      })()}
      {selectedProduct && viewMode === 'local' && (() => {
        const product = selectedProduct;
        const imageList = [...new Set([product.imageUrl, ...(product.images || [])].filter((image) => typeof image === 'string' && image.trim()))].slice(0, 12);
        const activeImage = imageList[Math.min(selectedProductImageIndex, Math.max(0, imageList.length - 1))] || '';
        const technicalLines = String(product.technicalDetails || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 30);
        return <div className="product-record-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedProduct(null); }}>
          <section className="product-record-modal" role="dialog" aria-modal="true" aria-labelledby="product-record-title">
            <button type="button" className="product-record-close" onClick={() => setSelectedProduct(null)} aria-label="Đóng chi tiết sản phẩm"><i className="bi bi-x-lg" aria-hidden="true" /></button>
            <div className="product-record-header"><span className="eyebrow">PRODUCT RECORD · EM SYSTEMS</span><h3 id="product-record-title">{product.name}</h3><p>{product.sku} · {product.categoryName || 'Chưa phân loại'}{product.brandName ? ` · ${product.brandName}` : ''}</p></div>
            <div className="product-record-grid">
              <div className="product-record-gallery"><div className="product-record-main-image"><span className="store-product-image-fallback" aria-hidden="true"><i className="bi bi-box-seam" /></span>{activeImage && <img src={activeImage} alt={product.name} onError={(event) => { event.currentTarget.style.visibility = 'hidden'; }} />}</div>{imageList.length > 1 && <div className="product-record-thumbnails">{imageList.map((image, index) => <button type="button" className={index === selectedProductImageIndex ? 'selected' : ''} key={image} onClick={() => setSelectedProductImageIndex(index)} aria-label={`Xem ảnh ${index + 1}`} aria-pressed={index === selectedProductImageIndex}><img src={image} alt="" loading="lazy" /></button>)}</div>}</div>
              <div className="product-record-content"><div className="product-record-facts"><div><span>Giá bán</span><strong>{formatMoney(product.sellingPrice)}</strong></div>{canSeeCost && <div><span>Giá vốn</span><strong>{formatMoney(product.costPrice)}</strong></div>}<div><span>Tồn kho tổng</span><strong>{Number(product.stock || 0).toLocaleString('vi-VN')}</strong></div><div><span>Bảo hành</span><strong>{Number(product.warrantyMonths || 0)} tháng</strong></div><div><span>Trạng thái</span><strong>{product.isActive === false ? 'Ngừng kinh doanh' : 'Đang kinh doanh'}</strong></div><div><span>Đơn vị</span><strong>{product.unit || 'Cái'}</strong></div><div><span>Mức tồn tối thiểu</span><strong>{Number(product.minStock || 0).toLocaleString('vi-VN')}</strong></div><div><span>Nhà cung cấp</span><strong>{product.supplierName || 'Chưa gắn nhà cung cấp'}</strong></div></div>
                <section className="product-record-section"><h4>Mô tả</h4><p>{product.description?.trim() || 'Chưa nhập mô tả sản phẩm.'}</p></section>
                <section className="product-record-section"><h4>Thông số kỹ thuật</h4>{technicalLines.length ? <dl>{technicalLines.map((line, index) => { const separator = line.indexOf(':'); return <div key={`${line}-${index}`}><dt>{separator > 0 ? line.slice(0, separator).trim() : `Thông số ${index + 1}`}</dt><dd>{separator > 0 ? line.slice(separator + 1).trim() : line}</dd></div>; })}</dl> : <p>Chưa nhập thông số kỹ thuật đã xác minh.</p>}</section>
                {product.tags?.length > 0 && <section className="product-record-section"><h4>Từ khóa tham khảo</h4><div className="product-record-tags">{product.tags.map((tag) => <span key={tag}>{tag}</span>)}</div></section>}
                {product.externalSource === 'dummyjson' && <p className="product-record-source-note">Sản phẩm đã nhập từ DummyJSON. Giá API USD, điểm đánh giá và tình trạng tồn API không được dùng làm giá bán hoặc tồn kho EMSystems.</p>}
              </div>
            </div>
            <div className="product-record-actions"><button type="button" className="button button-secondary" onClick={() => setSelectedProduct(null)}>Đóng</button>{canEdit && <button type="button" className="button button-primary" onClick={() => startEdit(product)}><i className="bi bi-pencil-square" aria-hidden="true" /> Sửa thông tin sản phẩm</button>}</div>
          </section>
        </div>;
      })()}
      {viewMode === 'local' && <p className="page-note">Lưu ý: sản phẩm mới bắt đầu với tồn kho bằng 0; hãy dùng nghiệp vụ nhập kho để tăng số lượng. DummyJSON chỉ là dữ liệu tham khảo bên ngoài.</p>}
    </div>
  );
}

const catalogDefinitions = {
  categories: { label: 'Danh mục', eyebrow: 'PRODUCT CATEGORIES' },
  brands: { label: 'Thương hiệu', eyebrow: 'BRAND DIRECTORY' },
  suppliers: { label: 'Nhà cung cấp', eyebrow: 'SUPPLIER DIRECTORY' },
};

function emptyCatalogForm(type) {
  return type === 'suppliers'
    ? { code: '', name: '', contactName: '', phone: '', email: '', address: '' }
    : { name: '', description: '' };
}

export function CatalogsPage({ user }) {
  const [type, setType] = useState('categories');
  const [records, setRecords] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 10, totalItems: 0, totalPages: 0 });
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyCatalogForm('categories'));
  const canManage = user?.role === 'admin' || user?.role === 'manager';
  const definition = catalogDefinitions[type];

  async function loadRecords() {
    setLoading(true);
    setError('');
    try {
      const query = new URLSearchParams({ page: String(page), pageSize: '10', search });
      const result = await dataRequest(`/catalogs/${type}?${query.toString()}`);
      setRecords(result.data);
      setPagination(result.pagination);
    } catch (requestError) {
      setRecords([]);
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadRecords(); }, [type, page, search]);

  function switchType(nextType) {
    setType(nextType);
    setPage(1);
    setSearch('');
    setSearchInput('');
    setFormOpen(false);
    setEditingId(null);
    setForm(emptyCatalogForm(nextType));
    setError('');
    setSuccess('');
  }

  function startCreate() {
    setEditingId(null);
    setForm(emptyCatalogForm(type));
    setFormOpen(true);
    setError('');
    setSuccess('');
  }

  function startEdit(record) {
    setEditingId(record.id);
    setForm(type === 'suppliers' ? {
      code: record.code || '',
      name: record.name || '',
      contactName: record.contactName || '',
      phone: record.phone || '',
      email: record.email || '',
      address: record.address || '',
    } : { name: record.name || '', description: record.description || '' });
    setFormOpen(true);
    setError('');
    setSuccess('');
  }

  function changeField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const result = await dataRequest(editingId ? `/catalogs/${type}/${editingId}` : `/catalogs/${type}`, {
        method: editingId ? 'PATCH' : 'POST',
        body: form,
      });
      setSuccess(result.message);
      setFormOpen(false);
      setEditingId(null);
      setForm(emptyCatalogForm(type));
      await loadRecords();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  }

  async function deactivateRecord(record) {
    const label = type === 'suppliers' ? record.name : record.name;
    if (!window.confirm(`Ngừng sử dụng "${label}"? Lịch sử liên quan sẽ được giữ lại.`)) return;
    setError('');
    setSuccess('');
    try {
      const result = await dataRequest(`/catalogs/${type}/${record.id}/status`, {
        method: 'PATCH', body: { isActive: false },
      });
      setSuccess(result.message);
      await loadRecords();
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  function handleSearch(event) {
    event.preventDefault();
    setPage(1);
    setSearch(searchInput.trim());
  }

  const fields = type === 'suppliers'
    ? [
      { key: 'code', label: 'Mã nhà cung cấp', required: true, maxLength: 30 },
      { key: 'name', label: 'Tên nhà cung cấp', required: true, maxLength: 180 },
      { key: 'contactName', label: 'Người liên hệ', maxLength: 150 },
      { key: 'phone', label: 'Số điện thoại', maxLength: 30 },
      { key: 'email', label: 'Email', inputType: 'email', maxLength: 190 },
      { key: 'address', label: 'Địa chỉ', maxLength: 255 },
    ]
    : [
      { key: 'name', label: `Tên ${type === 'brands' ? 'thương hiệu' : 'danh mục'}`, required: true, maxLength: 120 },
      { key: 'description', label: 'Mô tả', maxLength: 500 },
    ];

  return (
    <div className="page-stack">
      <section className="welcome-row">
        <div><span className="eyebrow">{definition.eyebrow}</span><h2>Danh mục dùng chung</h2><p>Quản lý thông tin dùng khi tạo sản phẩm. Dữ liệu được lưu trong SQLite phía máy chủ.</p></div>
        {canManage && <button type="button" className="button button-primary" onClick={startCreate}><i className="bi bi-plus-lg" aria-hidden="true" /> Thêm {definition.label.toLocaleLowerCase('vi-VN')}</button>}
      </section>

      <div className="catalog-switch" role="group" aria-label="Loại danh mục cần quản lý">
        {Object.entries(catalogDefinitions).map(([key, value]) => <button key={key} type="button" className={`catalog-switch-button${type === key ? ' selected' : ''}`} onClick={() => switchType(key)}>{value.label}</button>)}
      </div>
      {error && <ErrorNotice message={error} onRetry={loadRecords} />}
      {success && <div className="notice notice-success" role="status">{success}<button type="button" className="notice-close" onClick={() => setSuccess('')} aria-label="Đóng thông báo"><i className="bi bi-x-lg" aria-hidden="true" /></button></div>}

      {formOpen && <section className="panel product-form-panel"><div className="panel-heading"><div><span className="eyebrow">{editingId ? 'EDIT RECORD' : 'NEW RECORD'}</span><h3>{editingId ? `Cập nhật ${definition.label.toLocaleLowerCase('vi-VN')}` : `Thêm ${definition.label.toLocaleLowerCase('vi-VN')}`}</h3></div><button type="button" className="icon-button" onClick={() => setFormOpen(false)} aria-label="Đóng biểu mẫu"><i className="bi bi-x-lg" aria-hidden="true" /></button></div>
        <form className={`catalog-form${type === 'suppliers' ? ' catalog-form-supplier' : ''}`} onSubmit={handleSubmit}>
          {fields.map((field) => <div className="form-field" key={field.key}><label htmlFor={`catalog-${field.key}`}>{field.label}{field.required ? ' *' : ''}</label>{field.key === 'description' || field.key === 'address' ? <textarea id={`catalog-${field.key}`} value={form[field.key]} onChange={(event) => changeField(field.key, event.target.value)} required={field.required} maxLength={field.maxLength} rows={3} /> : <input id={`catalog-${field.key}`} type={field.inputType || 'text'} value={form[field.key]} onChange={(event) => changeField(field.key, event.target.value)} required={field.required} maxLength={field.maxLength} />}</div>)}
          <div className="form-actions catalog-form-actions"><button type="button" className="button button-secondary" onClick={() => setFormOpen(false)}>Hủy</button><button type="submit" className="button button-primary" disabled={saving}>{saving ? 'Đang lưu...' : 'Lưu thay đổi'}</button></div>
        </form>
      </section>}

      <section className="panel table-panel"><div className="table-toolbar"><div><h3>{definition.label}</h3><p>{pagination.totalItems.toLocaleString('vi-VN')} bản ghi đang hoạt động</p></div><form className="search-form" onSubmit={handleSearch}><label className="search-box"><i className="bi bi-search" aria-hidden="true" /><input aria-label={`Tìm ${definition.label.toLocaleLowerCase('vi-VN')}`} placeholder={`Tìm ${definition.label.toLocaleLowerCase('vi-VN')}...`} value={searchInput} onChange={(event) => setSearchInput(event.target.value)} /><button type="submit">Tìm</button></label></form></div>
        {loading ? <div className="table-loading"><span className="loader" /> Đang tải dữ liệu...</div> : records.length === 0 ? <EmptyState title={search ? 'Không tìm thấy kết quả' : `Chưa có ${definition.label.toLocaleLowerCase('vi-VN')}`} description="Danh mục được đọc từ dữ liệu máy chủ; hệ thống không tự chèn bản ghi mới sau mỗi lần tải trang." action={canManage && !search ? <button type="button" className="button button-secondary" onClick={startCreate}><i className="bi bi-plus-lg" aria-hidden="true" />  Thêm mới</button> : null} /> : <div className="table-scroll"><table><thead><tr>{type === 'suppliers' && <th>MÃ</th>}<th>TÊN</th>{type === 'suppliers' ? <><th>NGƯỜI LIÊN HỆ</th><th>ĐIỆN THOẠI</th><th>EMAIL</th></> : <th>MÔ TẢ</th>}{canManage && <th>THAO TÁC</th>}</tr></thead><tbody>{records.map((record) => <tr key={record.id}>{type === 'suppliers' && <td><code>{record.code}</code></td>}<td><strong>{record.name}</strong></td>{type === 'suppliers' ? <><td>{record.contactName || '—'}</td><td>{record.phone || '—'}</td><td>{record.email || '—'}</td></> : <td>{record.description || '—'}</td>}{canManage && <td><div className="row-actions"><button type="button" className="table-action" onClick={() => startEdit(record)}>Sửa</button><button type="button" className="table-action table-action-danger" onClick={() => deactivateRecord(record)}>Ngừng</button></div></td>}</tr>)}</tbody></table></div>}
        {!loading && records.length > 0 && <div className="pagination"><span>Trang {pagination.page} / {Math.max(1, pagination.totalPages)}</span><div><button type="button" className="button button-secondary button-small" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}><i className="bi bi-chevron-left" aria-hidden="true" /> Trước</button><button type="button" className="button button-secondary button-small" disabled={page >= pagination.totalPages} onClick={() => setPage((current) => Math.min(pagination.totalPages, current + 1))}>Sau <i className="bi bi-chevron-right" aria-hidden="true" /></button></div></div>}
      </section>
    </div>
  );
}

export function InventoryPage({ user }) {
  const [stockRows, setStockRows] = useState([]);
  const [products, setProducts] = useState([]);
  const [branches, setBranches] = useState([]);
  const [branchId, setBranchId] = useState('');
  const [movements, setMovements] = useState([]);
  const [movementPage, setMovementPage] = useState(1);
  const [movementSearchInput, setMovementSearchInput] = useState('');
  const [movementSearch, setMovementSearch] = useState('');
  const [movementPagination, setMovementPagination] = useState({ page: 1, pageSize: 10, totalItems: 0, totalPages: 0 });
  const [movementLoading, setMovementLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [pagination, setPagination] = useState({ page: 1, pageSize: 10, totalItems: 0, totalPages: 0 });
  const [loading, setLoading] = useState(true);
  const [loadingOptions, setLoadingOptions] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [movementType, setMovementType] = useState('receipt');
  const [productId, setProductId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [note, setNote] = useState('');
  const [transfers, setTransfers] = useState([]);
  const [transferPage, setTransferPage] = useState(1);
  const [transferLoading, setTransferLoading] = useState(true);
  const [transferPagination, setTransferPagination] = useState({ page: 1, pageSize: 10, totalItems: 0, totalPages: 0 });
  const [transferFormOpen, setTransferFormOpen] = useState(false);
  const [transferSaving, setTransferSaving] = useState(false);
  const [transferFromBranchId, setTransferFromBranchId] = useState(user?.role === 'admin' ? '' : String(user?.branchId || ''));
  const [transferToBranchId, setTransferToBranchId] = useState('');
  const [transferProductId, setTransferProductId] = useState('');
  const [transferQuantity, setTransferQuantity] = useState('1');
  const [transferNote, setTransferNote] = useState('');
  const [transferItems, setTransferItems] = useState([]);
  const isAdmin = user?.role === 'admin';
  const canMoveStock = isAdmin || user?.role === 'manager';
  const canSeeCost = ['admin', 'manager', 'warehouse'].includes(user?.role);

  async function loadStock() {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: '10', search });
      if (isAdmin && branchId) params.set('branchId', branchId);
      const result = await dataRequest(`/inventory/stock?${params.toString()}`);
      setStockRows(result.data);
      setPagination(result.pagination);
    } catch (requestError) {
      setStockRows([]);
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadStock(); }, [page, search, branchId, isAdmin]);

  async function loadMovements() {
    setMovementLoading(true);
    try {
      const params = new URLSearchParams({ page: String(movementPage), pageSize: '10', search: movementSearch });
      if (isAdmin && branchId) params.set('branchId', branchId);
      const result = await dataRequest(`/inventory/movements?${params.toString()}`);
      setMovements(result.data);
      setMovementPagination(result.pagination);
    } catch (requestError) {
      setMovements([]);
      setError(requestError.message);
    } finally {
      setMovementLoading(false);
    }
  }

  useEffect(() => { loadMovements(); }, [movementPage, movementSearch, branchId, isAdmin]);

  async function loadTransfers() {
    setTransferLoading(true);
    try {
      const params = new URLSearchParams({ page: String(transferPage), pageSize: '10' });
      if (isAdmin && branchId) params.set('branchId', branchId);
      const result = await dataRequest(`/inventory/transfers?${params.toString()}`);
      setTransfers(result.data);
      setTransferPagination(result.pagination);
    } catch (requestError) {
      setTransfers([]);
      setError(requestError.message);
    } finally {
      setTransferLoading(false);
    }
  }

  useEffect(() => { loadTransfers(); }, [transferPage, branchId, isAdmin]);
  useEffect(() => {
    Promise.all([
      dataRequest('/branches'),
      dataRequest('/products?page=1&pageSize=100'),
    ]).then(([branchResult, productResult]) => {
      setBranches(branchResult.data);
      setProducts(productResult.data);
      if (productResult.data.length) setProductId(String(productResult.data[0].id));
    }).catch((requestError) => setError(requestError.message)).finally(() => setLoadingOptions(false));
  }, []);

  async function handleMovement(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const result = await dataRequest('/inventory/movements', {
        method: 'POST',
        body: {
          productId: Number(productId),
          ...(isAdmin ? { branchId: Number(branchId) } : {}),
          movementType,
          quantity: Number(quantity),
          note,
        },
      });
      setSuccess(`${result.message} Tồn mới: ${result.movement.quantityAfter}.`);
      setFormOpen(false);
      setQuantity('1');
      setNote('');
      await loadStock();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  }

  function handleSearch(event) {
    event.preventDefault();
    setPage(1);
    setSearch(searchInput.trim());
  }

  function handleMovementSearch(event) {
    event.preventDefault();
    setMovementPage(1);
    setMovementSearch(movementSearchInput.trim());
  }

  function addTransferItem() {
    const parsedProductId = Number(transferProductId);
    const parsedQuantity = Number(transferQuantity);
    if (!parsedProductId || !Number.isSafeInteger(parsedQuantity) || parsedQuantity < 1) {
      setError('Chọn sản phẩm và số lượng điều chuyển hợp lệ.');
      return;
    }
    if (transferItems.some((item) => item.productId === parsedProductId)) {
      setError('Sản phẩm đã nằm trong phiếu nháp. Hãy sửa số lượng tại dòng hiện có.');
      return;
    }
    const product = products.find((item) => item.id === parsedProductId);
    setTransferItems((current) => [...current, { productId: parsedProductId, quantity: parsedQuantity, sku: product?.sku, name: product?.name }]);
    setTransferProductId('');
    setTransferQuantity('1');
    setError('');
  }

  async function createTransfer(event) {
    event.preventDefault();
    if (!transferItems.length) {
      setError('Thêm ít nhất một sản phẩm vào phiếu điều chuyển.');
      return;
    }
    setTransferSaving(true);
    setError('');
    setSuccess('');
    try {
      const result = await dataRequest('/inventory/transfers', {
        method: 'POST',
        body: {
          ...(isAdmin ? { fromBranchId: Number(transferFromBranchId) } : {}),
          toBranchId: Number(transferToBranchId),
          note: transferNote,
          items: transferItems.map(({ productId: id, quantity: qty }) => ({ productId: id, quantity: qty })),
        },
      });
      setSuccess(`${result.message} Phiếu ${result.transferNo}.`);
      setTransferFormOpen(false);
      setTransferItems([]);
      setTransferNote('');
      setTransferToBranchId('');
      await loadTransfers();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setTransferSaving(false);
    }
  }

  async function processTransfer(transfer, action) {
    const actionLabels = { ship: 'Xuất phiếu khỏi kho nguồn', receive: 'Nhận hàng tại kho đích', cancel: 'Hủy phiếu nháp' };
    if (!window.confirm(`${actionLabels[action]} ${transfer.transferNo}?`)) return;
    setError('');
    setSuccess('');
    try {
      const result = await dataRequest(`/inventory/transfers/${transfer.id}/${action}`, { method: 'POST', body: {} });
      setSuccess(result.message);
      await Promise.all([loadTransfers(), loadStock(), loadMovements()]);
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  return (
    <div className="page-stack">
      <section className="welcome-row"><div><span className="eyebrow">INVENTORY CONTROL</span><h2>Kiểm soát tồn kho</h2><p>Nhập/xuất, điều chuyển giữa chi nhánh và nhật ký biến động; số liệu được cập nhật trong cùng thao tác demo cục bộ.</p></div><div className="inventory-heading-actions">{canMoveStock && <><button type="button" className="button button-secondary" onClick={() => { setError(''); setSuccess(''); setTransferFormOpen((current) => !current); }}><i className="bi bi-arrow-left-right" aria-hidden="true" /> Điều chuyển</button><button type="button" className="button button-primary" onClick={() => { setError(''); setSuccess(''); setFormOpen((current) => !current); }}><i className="bi bi-plus-lg" aria-hidden="true" /> Ghi nhận nhập / xuất</button></>}</div></section>
      {error && <ErrorNotice message={error} onRetry={loadStock} />}
      {success && <div className="notice notice-success" role="status">{success}<button type="button" className="notice-close" onClick={() => setSuccess('')} aria-label="Đóng thông báo"><i className="bi bi-x-lg" aria-hidden="true" /></button></div>}

      {formOpen && <section className="panel product-form-panel"><div className="panel-heading"><div><span className="eyebrow">STOCK MOVEMENT</span><h3>Ghi nhận biến động kho</h3></div><button type="button" className="icon-button" onClick={() => setFormOpen(false)} aria-label="Đóng biểu mẫu"><i className="bi bi-x-lg" aria-hidden="true" /></button></div>
        <form className="catalog-form" onSubmit={handleMovement}>
          {isAdmin && <div className="form-field"><label htmlFor="movement-branch">Chi nhánh *</label><select id="movement-branch" value={branchId} onChange={(event) => setBranchId(event.target.value)} required><option value="">Chọn chi nhánh</option>{branches.filter((item) => item.isActive).map((branch) => <option key={branch.id} value={branch.id}>{branch.code} · {branch.name}</option>)}</select></div>}
          <div className="form-field"><label htmlFor="movement-product">Sản phẩm *</label><select id="movement-product" value={productId} onChange={(event) => setProductId(event.target.value)} required disabled={loadingOptions || !products.length}><option value="">Chọn sản phẩm</option>{products.map((product) => <option key={product.id} value={product.id}>{product.sku} · {product.name}</option>)}</select></div>
          <div className="form-field"><label htmlFor="movement-type">Nghiệp vụ *</label><select id="movement-type" value={movementType} onChange={(event) => setMovementType(event.target.value)}><option value="receipt">Nhập kho (+)</option><option value="issue">Xuất kho (−)</option></select></div>
          <div className="form-field"><label htmlFor="movement-quantity">Số lượng *</label><input id="movement-quantity" type="number" min="1" max="1000000" step="1" value={quantity} onChange={(event) => setQuantity(event.target.value)} required /></div>
          <div className="form-field form-field-wide"><label htmlFor="movement-note">Ghi chú</label><textarea id="movement-note" value={note} onChange={(event) => setNote(event.target.value)} rows={2} maxLength={500} placeholder="Ví dụ: nhập hàng theo phiếu giao nhận..." /></div>
          <p className="form-hint form-field-wide">Không thể xuất vượt số lượng tồn theo dữ liệu hiện tại. Đây là kiểm tra frontend, không phải giao dịch khóa an toàn trên máy chủ.</p>
          <div className="form-actions catalog-form-actions"><button type="button" className="button button-secondary" onClick={() => setFormOpen(false)}>Hủy</button><button type="submit" className="button button-primary" disabled={saving || loadingOptions || !products.length || (isAdmin && !branchId)}>{saving ? 'Đang xử lý...' : 'Xác nhận nghiệp vụ'}</button></div>
        </form>
      </section>}

      {transferFormOpen && <section className="panel product-form-panel"><div className="panel-heading"><div><span className="eyebrow">INTER-BRANCH TRANSFER</span><h3>Tạo phiếu điều chuyển</h3><p>Phiếu tạo mới ở trạng thái nháp; tồn kho chỉ thay đổi khi xuất nguồn và nhận đích.</p></div><button type="button" className="icon-button" onClick={() => setTransferFormOpen(false)} aria-label="Đóng biểu mẫu điều chuyển"><i className="bi bi-x-lg" aria-hidden="true" /></button></div>
        <form className="catalog-form" onSubmit={createTransfer}>
          {isAdmin && <div className="form-field"><label htmlFor="transfer-from-branch">Chi nhánh nguồn *</label><select id="transfer-from-branch" value={transferFromBranchId} onChange={(event) => setTransferFromBranchId(event.target.value)} required><option value="">Chọn nguồn</option>{branches.filter((item) => item.isActive && String(item.id) !== transferToBranchId).map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select></div>}
          <div className="form-field"><label htmlFor="transfer-to-branch">Chi nhánh đích *</label><select id="transfer-to-branch" value={transferToBranchId} onChange={(event) => setTransferToBranchId(event.target.value)} required><option value="">Chọn đích</option>{branches.filter((item) => item.isActive && String(item.id) !== (isAdmin ? transferFromBranchId : String(user?.branchId || ''))).map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select></div>
          <div className="form-field"><label htmlFor="transfer-product">Sản phẩm *</label><select id="transfer-product" value={transferProductId} onChange={(event) => setTransferProductId(event.target.value)}><option value="">Chọn sản phẩm</option>{products.map((item) => <option key={item.id} value={item.id}>{item.sku} · {item.name}</option>)}</select></div>
          <div className="form-field"><label htmlFor="transfer-quantity">Số lượng *</label><div className="transfer-add-quantity"><input id="transfer-quantity" type="number" min="1" max="1000000" step="1" value={transferQuantity} onChange={(event) => setTransferQuantity(event.target.value)} /><button type="button" className="button button-secondary" onClick={addTransferItem} disabled={!transferProductId}>Thêm dòng</button></div></div>
          <div className="form-field form-field-wide"><label htmlFor="transfer-note">Ghi chú</label><textarea id="transfer-note" rows={2} maxLength={500} value={transferNote} onChange={(event) => setTransferNote(event.target.value)} placeholder="Lý do hoặc thông tin phiếu giao nhận..." /></div>
          {transferItems.length > 0 && <div className="transfer-draft-list form-field-wide"><strong>Mặt hàng trong phiếu ({transferItems.length})</strong>{transferItems.map((item) => <div className="transfer-draft-row" key={item.productId}><span><strong>{item.name}</strong><small>{item.sku}</small></span><label>Số lượng<input type="number" min="1" max="1000000" value={item.quantity} onChange={(event) => { const value = Number(event.target.value); if (Number.isSafeInteger(value) && value > 0 && value <= 1000000) setTransferItems((current) => current.map((entry) => entry.productId === item.productId ? { ...entry, quantity: value } : entry)); }} /></label><button type="button" className="table-action table-action-danger" onClick={() => setTransferItems((current) => current.filter((entry) => entry.productId !== item.productId))}>Bỏ</button></div>)}</div>}
          <p className="form-hint form-field-wide">Trước khi xuất phiếu, máy chủ kiểm tra tồn kho và ghi nhận giao dịch trong SQLite. Nhận hàng ở chi nhánh đích là bước riêng.</p>
          <div className="form-actions catalog-form-actions"><button type="button" className="button button-secondary" onClick={() => setTransferFormOpen(false)}>Hủy</button><button type="submit" className="button button-primary" disabled={transferSaving || !transferItems.length || !transferToBranchId || (isAdmin && !transferFromBranchId) || (!isAdmin && !user?.branchId)}>{transferSaving ? 'Đang tạo phiếu...' : 'Tạo phiếu nháp'}</button></div>
        </form>
      </section>}

      <section className="panel table-panel"><div className="table-toolbar"><div><h3>Phiếu điều chuyển</h3><p>{transferPagination.totalItems.toLocaleString('vi-VN')} phiếu giữa chi nhánh</p></div><button type="button" className="button button-secondary button-small" onClick={loadTransfers}><i className="bi bi-arrow-clockwise" aria-hidden="true" /> Làm mới</button></div>
        {transferLoading ? <div className="table-loading"><span className="loader" /> Đang tải phiếu điều chuyển...</div> : transfers.length === 0 ? <EmptyState title="Chưa có phiếu điều chuyển" description="Tạo phiếu nháp để chuẩn bị chuyển hàng; số lượng chỉ thay đổi khi xác nhận xuất và nhận." action={canMoveStock ? <button className="button button-secondary" type="button" onClick={() => setTransferFormOpen(true)}><i className="bi bi-plus-lg" aria-hidden="true" />  Tạo phiếu</button> : null} /> : <div className="table-scroll"><table><thead><tr><th>MÃ PHIẾU</th><th>NGUỒN</th><th>ĐÍCH</th><th>MẶT HÀNG</th><th>NGÀY TẠO</th><th>TRẠNG THÁI</th><th>THAO TÁC</th></tr></thead><tbody>{transfers.map((transfer) => { const canShip = canMoveStock && transfer.status === 'draft' && (isAdmin || Number(user?.branchId) === Number(transfer.fromBranchId)); const canReceive = canMoveStock && transfer.status === 'shipped' && (isAdmin || Number(user?.branchId) === Number(transfer.toBranchId)); const canCancel = canMoveStock && transfer.status === 'draft' && (isAdmin || Number(user?.branchId) === Number(transfer.fromBranchId)); return <tr key={transfer.id}><td><code>{transfer.transferNo}</code></td><td>{transfer.fromBranchName}</td><td>{transfer.toBranchName}</td><td>{transfer.itemCount}</td><td>{new Date(transfer.createdAt).toLocaleDateString('vi-VN')}</td><td><span className={`status-tag ${transfer.status === 'received' ? 'status-active' : transfer.status === 'cancelled' ? 'status-inactive' : 'status-low-stock'}`}>{({ draft: 'Nháp', shipped: 'Đã xuất', received: 'Đã nhận', cancelled: 'Đã hủy' })[transfer.status] || transfer.status}</span></td><td><div className="row-actions">{canShip && <button type="button" className="table-action" onClick={() => processTransfer(transfer, 'ship')}>Xuất nguồn</button>}{canReceive && <button type="button" className="table-action" onClick={() => processTransfer(transfer, 'receive')}>Nhận hàng</button>}{canCancel && <button type="button" className="table-action table-action-danger" onClick={() => processTransfer(transfer, 'cancel')}>Hủy</button>}{!canShip && !canReceive && !canCancel && <span className="muted-note">Chỉ xem</span>}</div></td></tr>; })}</tbody></table></div>}
        {!transferLoading && transfers.length > 0 && <div className="pagination"><span>Trang {transferPagination.page} / {Math.max(1, transferPagination.totalPages)}</span><div><button type="button" className="button button-secondary button-small" disabled={transferPage <= 1} onClick={() => setTransferPage((current) => Math.max(1, current - 1))}><i className="bi bi-chevron-left" aria-hidden="true" /> Trước</button><button type="button" className="button button-secondary button-small" disabled={transferPage >= transferPagination.totalPages} onClick={() => setTransferPage((current) => Math.min(transferPagination.totalPages, current + 1))}>Sau <i className="bi bi-chevron-right" aria-hidden="true" /></button></div></div>}
      </section>

      <section className="panel table-panel"><div className="table-toolbar"><div><h3>Số lượng tồn hiện tại</h3><p>{pagination.totalItems.toLocaleString('vi-VN')} sản phẩm · {isAdmin && !branchId ? 'Tổng hợp toàn chuỗi' : 'Phạm vi chi nhánh được phép'}</p></div><div className="inventory-toolbar-controls">{isAdmin && <label className="dummy-category-select"><span>Chi nhánh</span><select value={branchId} onChange={(event) => { setBranchId(event.target.value); setPage(1); }}><option value="">Toàn chuỗi</option>{branches.filter((item) => item.isActive).map((branch) => <option key={branch.id} value={branch.id}>{branch.code} · {branch.name}</option>)}</select></label>}<form className="search-form" onSubmit={handleSearch}><label className="search-box"><i className="bi bi-search" aria-hidden="true" /><input aria-label="Tìm sản phẩm kho" placeholder="Tìm tên hoặc SKU..." value={searchInput} onChange={(event) => setSearchInput(event.target.value)} /><button type="submit">Tìm</button></label></form></div></div>
        {loading ? <div className="table-loading"><span className="loader" /> Đang tổng hợp tồn kho demo...</div> : stockRows.length === 0 ? <EmptyState title="Chưa có dữ liệu tồn kho" description="Tồn kho tổng hợp từ dữ liệu demo. Tạo phiếu nhập hoặc ghi nhận nhập kho để tăng tồn." /> : <div className="table-scroll"><table><thead><tr><th>SẢN PHẨM</th><th>MÃ SKU</th><th>TỒN KHO</th>{canSeeCost && <th>GIÁ VỐN</th>}<th>GIÁ BÁN</th><th>TRẠNG THÁI</th></tr></thead><tbody>{stockRows.map((row) => <tr key={row.productId}><td><strong>{row.name}</strong></td><td><code>{row.sku}</code></td><td><span className={`stock-pill ${row.stock <= 5 ? 'stock-low' : 'stock-ok'}`}>{row.stock.toLocaleString('vi-VN')}</span></td>{canSeeCost && <td>{formatMoney(row.costPrice)}</td>}<td className="price-cell">{formatMoney(row.sellingPrice)}</td><td><span className={`status-tag ${row.stock <= 5 ? 'status-low-stock' : ''}`}>{row.stock <= 0 ? 'Hết hàng' : row.stock <= 5 ? 'Sắp hết' : 'Đủ hàng'}</span></td></tr>)}</tbody></table></div>}
        {!loading && stockRows.length > 0 && <div className="pagination"><span>Trang {pagination.page} / {Math.max(1, pagination.totalPages)}</span><div><button type="button" className="button button-secondary button-small" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}><i className="bi bi-chevron-left" aria-hidden="true" /> Trước</button><button type="button" className="button button-secondary button-small" disabled={page >= pagination.totalPages} onClick={() => setPage((current) => Math.min(pagination.totalPages, current + 1))}>Sau <i className="bi bi-chevron-right" aria-hidden="true" /></button></div></div>}
      </section>

      <section className="panel table-panel"><div className="table-toolbar"><div><h3>Nhật ký biến động kho</h3><p>{movementPagination.totalItems.toLocaleString('vi-VN')} bản ghi · có tham chiếu đến nghiệp vụ nguồn</p></div><form className="search-form" onSubmit={handleMovementSearch}><label className="search-box"><i className="bi bi-search" aria-hidden="true" /><input aria-label="Tìm nhật ký kho" placeholder="Tìm sản phẩm, SKU hoặc mã phiếu..." value={movementSearchInput} onChange={(event) => setMovementSearchInput(event.target.value)} /><button type="submit">Tìm</button></label></form></div>
        {movementLoading ? <div className="table-loading"><span className="loader" /> Đang tải nhật ký kho...</div> : movements.length === 0 ? <EmptyState title="Chưa có biến động kho" description="Lịch sử được ghi khi nhập/xuất kho, bán hàng, đổi trả hoặc điều chuyển thành công." /> : <div className="table-scroll"><table><thead><tr><th>THỜI GIAN</th><th>SẢN PHẨM</th><th>CHI NHÁNH</th><th>NGHIỆP VỤ</th><th>SỐ LƯỢNG</th><th>MÃ THAM CHIẾU</th><th>NGƯỜI THỰC HIỆN</th></tr></thead><tbody>{movements.map((movement) => <tr key={movement.id}><td>{new Date(movement.createdAt).toLocaleString('vi-VN')}</td><td><strong>{movement.productName}</strong><small className="warranty-serial-label">{movement.sku}</small></td><td>{movement.branchName}</td><td>{({ receipt: 'Nhập kho', issue: 'Xuất kho', sale: 'Bán hàng', return: 'Đổi trả', transfer_in: 'Điều chuyển vào', transfer_out: 'Điều chuyển ra', count_adjustment: 'Điều chỉnh kiểm kê', opening: 'Số dư đầu kỳ' })[movement.movementType] || movement.movementType}</td><td><strong className={movement.quantityDelta > 0 ? 'quantity-positive' : 'quantity-negative'}>{movement.quantityDelta > 0 ? '+' : ''}{movement.quantityDelta}</strong></td><td>{movement.referenceCode ? <code>{movement.referenceCode}</code> : '—'}{movement.note && <small className="warranty-serial-label">{movement.note}</small>}</td><td>{movement.createdByName || 'Hệ thống'}</td></tr>)}</tbody></table></div>}
        {!movementLoading && movements.length > 0 && <div className="pagination"><span>Trang {movementPagination.page} / {Math.max(1, movementPagination.totalPages)}</span><div><button type="button" className="button button-secondary button-small" disabled={movementPage <= 1} onClick={() => setMovementPage((current) => Math.max(1, current - 1))}><i className="bi bi-chevron-left" aria-hidden="true" /> Trước</button><button type="button" className="button button-secondary button-small" disabled={movementPage >= movementPagination.totalPages} onClick={() => setMovementPage((current) => Math.min(movementPagination.totalPages, current + 1))}>Sau <i className="bi bi-chevron-right" aria-hidden="true" /></button></div></div>}
      </section>
    </div>
  );
}

export function SalesPage({ user }) {
  const [products, setProducts] = useState([]);
  const [branches, setBranches] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [promotions, setPromotions] = useState([]);
  const [promotionCode, setPromotionCode] = useState('');
  const [sales, setSales] = useState([]);
  const [branchId, setBranchId] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [paymentReference, setPaymentReference] = useState('');
  const [productSearch, setProductSearch] = useState('');
  const [historySearchInput, setHistorySearchInput] = useState('');
  const [historySearch, setHistorySearch] = useState('');
  const [cart, setCart] = useState([]);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 10, totalItems: 0, totalPages: 0 });
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [latestInvoice, setLatestInvoice] = useState(null);
  const [returnDetails, setReturnDetails] = useState(null);
  const [returnQuantities, setReturnQuantities] = useState({});
  const [returnReason, setReturnReason] = useState('');
  const [returnSaving, setReturnSaving] = useState(false);
  const isAdmin = user?.role === 'admin';
  const canProcessReturns = isAdmin || user?.role === 'manager';

  async function loadHistory() {
    setLoadingHistory(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: '10', search: historySearch });
      if (isAdmin && branchId) params.set('branchId', branchId);
      const result = await dataRequest(`/sales?${params.toString()}`);
      setSales(result.data);
      setPagination(result.pagination);
    } catch (requestError) {
      setSales([]);
      setError(requestError.message);
    } finally {
      setLoadingHistory(false);
    }
  }

  useEffect(() => {
    Promise.all([
      dataRequest('/branches'),
      dataRequest('/pos/customers?page=1&pageSize=100'),
      dataRequest('/promotions?page=1&pageSize=100'),
    ]).then(([branchResult, customerResult, promotionResult]) => {
      setBranches(branchResult.data);
      setCustomers(customerResult.data);
      setPromotions(promotionResult.data || []);
    }).catch((requestError) => setError(requestError.message));
  }, []);

  useEffect(() => {
    setCart([]);
    if (isAdmin && !branchId) {
      setProducts([]);
      setLoadingProducts(false);
      return;
    }
    const params = new URLSearchParams({ page: '1', pageSize: '100' });
    if (isAdmin && branchId) params.set('branchId', branchId);
    setLoadingProducts(true);
    dataRequest(`/inventory/stock?${params.toString()}`).then((result) => {
      setProducts(result.data);
      setError('');
    }).catch((requestError) => {
      setProducts([]);
      setError(requestError.message);
    }).finally(() => setLoadingProducts(false));
  }, [isAdmin, branchId]);

  useEffect(() => { loadHistory(); }, [page, historySearch, branchId, isAdmin]);

  const filteredProducts = products.filter((product) => {
    const query = productSearch.trim().toLocaleLowerCase('vi-VN');
    return !query || `${product.name} ${product.sku}`.toLocaleLowerCase('vi-VN').includes(query);
  });
  const cartItems = cart.map((item) => ({ ...item, product: products.find((product) => product.productId === item.productId) }))
    .filter((item) => item.product);
  const subtotalAmount = cartItems.reduce((sum, item) => sum + item.product.sellingPrice * item.quantity, 0);
  const nowTimestamp = Date.now();
  const selectedPromotion = promotions.find((item) => item.code === promotionCode.trim().toUpperCase() && item.isActive
    && nowTimestamp >= Date.parse(item.startAt) && nowTimestamp <= Date.parse(item.endAt)
    && subtotalAmount >= Number(item.minimumOrder || 0)
    && (item.usageLimit == null || Number(item.usedCount || 0) < Number(item.usageLimit)));
  const promotionDiscount = !selectedPromotion ? 0 : selectedPromotion.discountType === 'percent'
    ? Math.floor(subtotalAmount * Number(selectedPromotion.discountValue) / 100)
    : Math.min(subtotalAmount, Number(selectedPromotion.discountValue));
  const totalAmount = Math.max(0, subtotalAmount - promotionDiscount);

  function addToCart(product) {
    setError('');
    if (product.stock < 1) {
      setError(`${product.name} hiện không có tồn kho tại chi nhánh đã chọn.`);
      return;
    }
    const existing = cart.find((item) => item.productId === product.productId);
    if (existing && existing.quantity >= product.stock) {
      setError(`Số lượng ${product.name} không thể vượt tồn kho ${product.stock}.`);
      return;
    }
    setCart((current) => {
      const match = current.find((item) => item.productId === product.productId);
      return match
        ? current.map((item) => item.productId === product.productId ? { ...item, quantity: item.quantity + 1 } : item)
        : [...current, { productId: product.productId, quantity: 1 }];
    });
  }

  function setCartQuantity(productIdValue, nextQuantity) {
    const item = cartItems.find((entry) => entry.productId === productIdValue);
    if (!item) return;
    const quantity = Number(nextQuantity);
    if (!Number.isSafeInteger(quantity) || quantity < 1) {
      setCart((current) => current.filter((entry) => entry.productId !== productIdValue));
      return;
    }
    if (quantity > item.product.stock) {
      setError(`Số lượng ${item.product.name} không thể vượt tồn kho ${item.product.stock}.`);
      return;
    }
    setError('');
    setCart((current) => current.map((entry) => entry.productId === productIdValue ? { ...entry, quantity } : entry));
  }

  async function checkout() {
    if (!cartItems.length || (isAdmin && !branchId)) return;
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const result = await dataRequest('/sales', {
        method: 'POST',
        body: {
          ...(isAdmin ? { branchId: Number(branchId) } : {}),
          customerId: customerId ? Number(customerId) : null,
          paymentMethod,
          paymentReference,
          promotionCode: promotionCode.trim().toUpperCase(),
          items: cartItems.map((item) => ({ productId: item.productId, quantity: item.quantity })),
        },
      });
      if (result.payment?.checkoutUrl) {
        window.location.assign(result.payment.checkoutUrl);
        return;
      }
      setLatestInvoice(result.sale);
      setSuccess(`${result.message} Hóa đơn ${result.sale.invoiceNo}. Tổng tiền ${formatMoney(Number(result.sale.totalAmount))}.`);
      setCart([]);
      setCustomerId('');
      setPaymentReference('');
      setPromotionCode('');
      await Promise.all([loadHistory(), (async () => {
        const params = new URLSearchParams({ page: '1', pageSize: '100' });
        if (isAdmin && branchId) params.set('branchId', branchId);
        const stockResult = await dataRequest(`/inventory/stock?${params.toString()}`);
        setProducts(stockResult.data);
      })()]);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  }

  async function openReturn(sale) {
    setError('');
    setReturnDetails(null);
    try {
      const result = await dataRequest(`/sales/${sale.id}`);
      setReturnDetails(result);
      setReturnQuantities(Object.fromEntries(result.items.map((item) => [item.id, 0])));
      setReturnReason('');
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function submitReturn(event) {
    event.preventDefault();
    if (!returnDetails) return;
    const items = returnDetails.items
      .map((item) => ({ saleItemId: item.id, quantity: Number(returnQuantities[item.id] || 0) }))
      .filter((item) => Number.isSafeInteger(item.quantity) && item.quantity > 0);
    if (!items.length) {
      setError('Chọn số lượng cần đổi trả lớn hơn 0.');
      return;
    }
    setReturnSaving(true);
    setError('');
    setSuccess('');
    try {
      const result = await dataRequest(`/sales/${returnDetails.sale.id}/returns`, {
        method: 'POST', body: { reason: returnReason, items },
      });
      setSuccess(`${result.message} Phiếu ${result.return.returnNo}; hoàn tiền ${formatMoney(Number(result.return.refundAmount))}.`);
      setReturnDetails(null);
      await loadHistory();
      const stockResult = await dataRequest(`/inventory/stock?page=1&pageSize=100${isAdmin && branchId ? `&branchId=${encodeURIComponent(branchId)}` : ''}`);
      setProducts(stockResult.data);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setReturnSaving(false);
    }
  }

  function handleHistorySearch(event) {
    event.preventDefault();
    setPage(1);
    setHistorySearch(historySearchInput.trim());
  }

  return (
    <Box className="page-stack pos-mui-page" sx={{ gap: 2.25 }}>
      <Stack className="pos-mui-heading" direction={{ xs: 'column', sm: 'row' }} alignItems={{ xs: 'flex-start', sm: 'center' }} justifyContent="space-between" gap={1.5}>
        <Box>
          <Typography variant="overline" color="primary.main" fontWeight={800}>POINT OF SALE</Typography>
          <Typography variant="h4" component="h2">Bán hàng và thanh toán</Typography>
          <Typography variant="body2" color="text.secondary">Giá bán, khuyến mãi và tồn kho được máy chủ kiểm tra trong giao dịch SQLite.</Typography>
        </Box>
        <Chip color="info" variant="outlined" label="Hóa đơn demo · dữ liệu máy chủ" />
      </Stack>
      {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}
      {success && <Alert severity="success" onClose={() => setSuccess('')}>{success}</Alert>}
      {latestInvoice && (
        <Paper variant="outlined" sx={{ p: 2, borderColor: 'success.light', backgroundColor: 'success.50' }}>
          <Stack direction="row" alignItems="center" gap={1.5}>
            <Chip color="success" label="Đã tạo" />
            <Box>
              <Typography fontWeight={750}>Hóa đơn vừa tạo: {latestInvoice.invoiceNo}</Typography>
              <Typography variant="body2" color="text.secondary">{latestInvoice.itemCount} sản phẩm · {formatMoney(Number(latestInvoice.totalAmount))} · Dữ liệu demo</Typography>
            </Box>
          </Stack>
        </Paper>
      )}

      {isAdmin && (
        <Paper variant="outlined" sx={{ p: 2, maxWidth: 560 }}>
          <FormControl fullWidth size="small">
            <InputLabel id="sale-branch-label">Chi nhánh lập hóa đơn</InputLabel>
            <Select
              labelId="sale-branch-label"
              id="sale-branch"
              label="Chi nhánh lập hóa đơn"
              value={branchId}
              onChange={(event) => { setBranchId(event.target.value); setPage(1); }}
            >
              <MenuItem value="">Chọn chi nhánh trước khi bán</MenuItem>
              {branches.filter((branch) => branch.isActive).map((branch) => (
                <MenuItem key={branch.id} value={String(branch.id)}>{branch.code} · {branch.name}</MenuItem>
              ))}
            </Select>
          </FormControl>
        </Paper>
      )}

      <section className="sales-workspace-grid">
        <Paper component="article" variant="outlined" className="panel sales-products-panel" sx={{ p: 2, minWidth: 0 }}>
          <Stack direction="row" alignItems="center" justifyContent="space-between" gap={1} sx={{ mb: 2 }}>
            <Box><Typography variant="overline" color="text.secondary" fontWeight={800}>INTERNAL CATALOG</Typography><Typography variant="h6">Chọn sản phẩm</Typography></Box>
            <Chip size="small" label={`${filteredProducts.length} mặt hàng`} />
          </Stack>
          <TextField
            className="sales-product-search pos-mui-field"
            size="small"
            fullWidth
            label="Tìm sản phẩm"
            placeholder="Tên sản phẩm hoặc SKU..."
            value={productSearch}
            onChange={(event) => setProductSearch(event.target.value)}
            sx={{ mb: 1.5 }}
          />
          {isAdmin && !branchId ? <EmptyState title="Chọn chi nhánh" description="Quản trị viên cần chọn chi nhánh bán hàng để kiểm tra tồn kho đúng địa điểm." /> : loadingProducts ? <div className="table-loading"><span className="loader" /> Đang tải sản phẩm...</div> : filteredProducts.length === 0 ? <EmptyState title="Không có sản phẩm khả dụng" description="Kiểm tra danh mục sản phẩm nội bộ và tồn kho. Dữ liệu DummyJSON không được bán hoặc ghi thành hóa đơn." /> : <div className="sale-product-list">{filteredProducts.map((product) => <div className="sale-product-row" key={product.productId}><div className="sale-product-copy"><strong>{product.name}</strong><small>{product.sku} · Tồn kho {product.stock}</small><b>{formatMoney(product.sellingPrice)}</b></div><MuiButton type="button" size="small" variant="outlined" disabled={product.stock < 1 || saving} onClick={() => addToCart(product)} startIcon={<i className="bi bi-plus-lg" aria-hidden="true" />}>Thêm</MuiButton></div>)}</div>}
        </Paper>

        <Paper component="article" variant="outlined" className="panel sales-cart-panel" sx={{ p: 2, minWidth: 0 }}>
          <Stack direction="row" alignItems="center" justifyContent="space-between" gap={1} sx={{ mb: 2 }}>
            <Box><Typography variant="overline" color="text.secondary" fontWeight={800}>CURRENT ORDER</Typography><Typography variant="h6">Giỏ hàng</Typography></Box>
            <Chip color="primary" size="small" label={`${cartItems.reduce((sum, item) => sum + item.quantity, 0)} SP`} />
          </Stack>
          {cartItems.length === 0 ? <div className="cart-empty"><span><i className="bi bi-bag" aria-hidden="true" /></span><strong>Chưa có sản phẩm</strong><p>Chọn hàng từ danh sách để tạo hóa đơn.</p></div> : <div className="cart-lines">{cartItems.map((item) => <div className="cart-line" key={item.productId}><div className="cart-line-copy"><strong>{item.product.name}</strong><small>{formatMoney(item.product.sellingPrice)} / sản phẩm</small></div><div className="quantity-stepper"><button type="button" aria-label="Giảm số lượng" onClick={() => setCartQuantity(item.productId, item.quantity - 1)}><i className="bi bi-dash-lg" aria-hidden="true" /></button><input aria-label={`Số lượng ${item.product.name}`} type="number" min="1" max={item.product.stock} value={item.quantity} onChange={(event) => setCartQuantity(item.productId, event.target.value)} /><button type="button" aria-label="Tăng số lượng" disabled={item.quantity >= item.product.stock} onClick={() => setCartQuantity(item.productId, item.quantity + 1)}><i className="bi bi-plus-lg" aria-hidden="true" /></button></div><strong className="cart-line-total">{formatMoney(item.product.sellingPrice * item.quantity)}</strong><button type="button" className="cart-remove" onClick={() => setCart((current) => current.filter((entry) => entry.productId !== item.productId))} aria-label={`Bỏ ${item.product.name}`}><i className="bi bi-x-lg" aria-hidden="true" /></button></div>)}</div>}
          <Stack spacing={1.5} className="checkout-fields">
            <FormControl fullWidth size="small">
              <InputLabel id="sale-customer-label">Khách hàng</InputLabel>
              <Select labelId="sale-customer-label" id="sale-customer" label="Khách hàng" value={customerId} onChange={(event) => setCustomerId(event.target.value)}>
                <MenuItem value="">Khách lẻ</MenuItem>
                {customers.map((customer) => <MenuItem key={customer.id} value={String(customer.id)}>{customer.fullName}{customer.phone ? ` · ${customer.phone}` : ''}</MenuItem>)}
              </Select>
            </FormControl>
            <TextField
              id="sale-promotion"
              size="small"
              fullWidth
              label="Mã khuyến mãi"
              value={promotionCode}
              onChange={(event) => setPromotionCode(event.target.value.toUpperCase())}
              inputProps={{ maxLength: 32 }}
              helperText={!promotionCode.trim() ? 'Không bắt buộc. Máy chủ sẽ kiểm tra mã khi tạo hóa đơn.' : selectedPromotion ? `Đủ điều kiện: ${selectedPromotion.code}` : 'Mã không hợp lệ, hết hạn hoặc chưa đạt điều kiện tối thiểu.'}
            />
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25}>
              <FormControl fullWidth size="small">
                <InputLabel id="sale-payment-label">Thanh toán</InputLabel>
                <Select labelId="sale-payment-label" id="sale-payment" label="Thanh toán" value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}>
                  <MenuItem value="cash">Tiền mặt</MenuItem>
                  <MenuItem value="card">Thẻ mô phỏng</MenuItem>
                  <MenuItem value="bank_transfer">Chuyển khoản mô phỏng</MenuItem>
                  <MenuItem value="e_wallet">Ví điện tử mô phỏng</MenuItem>
                  <MenuItem value="other">Khác (mô phỏng)</MenuItem>
                </Select>
              </FormControl>
              <TextField id="sale-reference" size="small" fullWidth label="Mã tham chiếu demo" value={paymentReference} onChange={(event) => setPaymentReference(event.target.value)} inputProps={{ maxLength: 100 }} />
            </Stack>
          </Stack>
          <div className="cart-total-row"><span>Tạm tính</span><strong>{formatMoney(subtotalAmount)}</strong></div>
          {promotionDiscount > 0 && <div className="cart-total-row"><span>Giảm giá {selectedPromotion?.code || ''}</span><strong>−{formatMoney(promotionDiscount)}</strong></div>}
          <div className="cart-total-row"><span>Tổng thanh toán mô phỏng</span><strong>{formatMoney(totalAmount)}</strong></div>
          <Alert severity="info" icon={false} sx={{ mt: 1, mb: 1 }}>Giá, tổng tiền, ưu đãi và số tồn được máy chủ kiểm tra lại trước khi ghi hóa đơn. Thanh toán không tiền mặt trong POS là mô phỏng.</Alert>
          <MuiButton type="button" color="primary" variant="contained" fullWidth disabled={saving || !cartItems.length || (isAdmin && !branchId)} onClick={checkout}>
            {saving ? 'Đang xử lý thanh toán...' : 'Xác nhận và tạo hóa đơn'}
          </MuiButton>
        </Paper>
      </section>

      {returnDetails && <section className="panel return-form-panel"><div className="panel-heading"><div><span className="eyebrow">SALES RETURN</span><h3>Đổi trả hóa đơn {returnDetails.sale.invoiceNo}</h3><p>Chỉ trả số lượng còn lại; số tiền hoàn là mô phỏng, tính theo giá đã lưu trên hóa đơn demo.</p></div><button type="button" className="icon-button" onClick={() => setReturnDetails(null)} aria-label="Đóng biểu mẫu đổi trả"><i className="bi bi-x-lg" aria-hidden="true" /></button></div><form onSubmit={submitReturn}>
        <div className="return-items-list">{returnDetails.items.map((item) => <div className="return-item-row" key={item.id}><div><strong>{item.productName}</strong><small>{item.sku} · Đã mua {item.soldQuantity} · Đã trả {item.returnedQuantity} · Còn được trả {item.returnableQuantity}</small><span>{formatMoney(item.unitPrice)} / sản phẩm</span></div><label>Số lượng trả<input type="number" min="0" max={item.returnableQuantity} step="1" disabled={item.returnableQuantity < 1} value={returnQuantities[item.id] ?? 0} onChange={(event) => setReturnQuantities((current) => ({ ...current, [item.id]: event.target.value }))} /></label></div>)}</div>
        <div className="form-field return-reason-field"><label htmlFor="return-reason">Lý do đổi trả *</label><textarea id="return-reason" value={returnReason} onChange={(event) => setReturnReason(event.target.value)} minLength={3} maxLength={500} rows={2} required placeholder="Mô tả ngắn gọn lý do đổi trả..." /></div>
        <div className="form-actions"><button type="button" className="button button-secondary" onClick={() => setReturnDetails(null)}>Hủy</button><button type="submit" className="button button-primary" disabled={returnSaving || !returnReason.trim() || !returnDetails.items.some((item) => Number(returnQuantities[item.id] || 0) > 0)}>{returnSaving ? 'Đang xử lý đổi trả...' : 'Xác nhận đổi trả'}</button></div>
      </form></section>}

      <Paper component="section" variant="outlined" className="panel table-panel pos-mui-history" sx={{ p: 2, minWidth: 0 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} alignItems={{ xs: 'stretch', sm: 'center' }} justifyContent="space-between" gap={1.5} sx={{ mb: 2 }}>
          <Box><Typography variant="h6">Lịch sử hóa đơn</Typography><Typography variant="body2" color="text.secondary">{pagination.totalItems.toLocaleString('vi-VN')} hóa đơn · sắp xếp và xuất CSV trong trang đang xem</Typography></Box>
          <Box component="form" onSubmit={handleHistorySearch} sx={{ display: 'flex', gap: 1, width: { xs: '100%', sm: 420 } }}>
            <TextField size="small" fullWidth label="Tìm hóa đơn" placeholder="Mã hóa đơn hoặc khách hàng..." value={historySearchInput} onChange={(event) => setHistorySearchInput(event.target.value)} />
            <MuiButton type="submit" variant="outlined">Tìm</MuiButton>
          </Box>
        </Stack>
        {loadingHistory ? <div className="table-loading"><span className="loader" /> Đang tải hóa đơn...</div> : sales.length === 0 ? <EmptyState title="Chưa có hóa đơn" description="Hóa đơn sẽ hiển thị sau khi được lưu vào SQLite trên máy chủ." /> : (
          <Suspense fallback={<div className="table-loading"><span className="loader" /> Đang nạp bảng dữ liệu...</div>}>
            <SalesHistoryGrid sales={sales} canProcessReturns={canProcessReturns} onReturn={openReturn} />
          </Suspense>
        )}
        {!loadingHistory && sales.length > 0 && <div className="pagination"><span>Trang {pagination.page} / {Math.max(1, pagination.totalPages)}</span><div><button type="button" className="button button-secondary button-small" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}><i className="bi bi-chevron-left" aria-hidden="true" /> Trước</button><button type="button" className="button button-secondary button-small" disabled={page >= pagination.totalPages} onClick={() => setPage((current) => Math.min(pagination.totalPages, current + 1))}>Sau <i className="bi bi-chevron-right" aria-hidden="true" /></button></div></div>}
      </Paper>
    </Box>
  );
}

export function BranchesPage({ user }) {
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ code: '', name: '', address: '', phone: '' });

  async function loadBranches() {
    setLoading(true);
    setError('');
    try {
      const result = await dataRequest('/branches');
      setBranches(result.data);
    } catch (requestError) {
      setBranches([]);
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { if (user?.role === 'admin') loadBranches(); else setLoading(false); }, [user?.role]);

  if (user?.role !== 'admin') {
    return <ModulePage title="Quản lý chi nhánh" phase="Chỉ quản trị viên" description="Tài khoản hiện tại không có quyền quản lý thông tin chi nhánh." />;
  }

  function openCreate() {
    setEditingId(null);
    setForm({ code: '', name: '', address: '', phone: '' });
    setFormOpen(true);
    setError('');
    setSuccess('');
  }

  function openEdit(branch) {
    setEditingId(branch.id);
    setForm({ code: branch.code || '', name: branch.name || '', address: branch.address || '', phone: branch.phone || '' });
    setFormOpen(true);
    setError('');
    setSuccess('');
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const result = await dataRequest(editingId ? `/branches/${editingId}` : '/branches', {
        method: editingId ? 'PATCH' : 'POST', body: form,
      });
      setSuccess(result.message);
      setFormOpen(false);
      await loadBranches();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  }

  async function toggleBranch(branch) {
    const nextStatus = !branch.isActive;
    if (!window.confirm(nextStatus ? `Kích hoạt chi nhánh ${branch.name}?` : `Ngừng chi nhánh ${branch.name}? Chi nhánh có nhân viên hoạt động hoặc hàng tồn sẽ bị từ chối.`)) return;
    setError('');
    setSuccess('');
    try {
      const result = await dataRequest(`/branches/${branch.id}/status`, { method: 'PATCH', body: { isActive: nextStatus } });
      setSuccess(result.message);
      await loadBranches();
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  return (
    <div className="page-stack">
      <section className="welcome-row"><div><span className="eyebrow">STORE NETWORK</span><h2>Quản lý chi nhánh</h2><p>Quản lý điểm bán và thông tin liên hệ. Không xóa cứng chi nhánh có liên kết nghiệp vụ.</p></div><button className="button button-primary" type="button" onClick={openCreate}><i className="bi bi-plus-lg" aria-hidden="true" />  Thêm chi nhánh</button></section>
      {error && <ErrorNotice message={error} onRetry={loadBranches} />}
      {success && <div className="notice notice-success" role="status">{success}<button type="button" className="notice-close" onClick={() => setSuccess('')} aria-label="Đóng thông báo"><i className="bi bi-x-lg" aria-hidden="true" /></button></div>}
      {formOpen && <section className="panel product-form-panel"><div className="panel-heading"><div><span className="eyebrow">BRANCH DETAILS</span><h3>{editingId ? 'Cập nhật chi nhánh' : 'Tạo chi nhánh'}</h3></div><button type="button" className="icon-button" onClick={() => setFormOpen(false)} aria-label="Đóng biểu mẫu"><i className="bi bi-x-lg" aria-hidden="true" /></button></div><form className="catalog-form" onSubmit={handleSubmit}>
        <div className="form-field"><label htmlFor="branch-code">Mã chi nhánh *</label><input id="branch-code" value={form.code} onChange={(event) => setForm((current) => ({ ...current, code: event.target.value }))} required maxLength={30} /></div>
        <div className="form-field"><label htmlFor="branch-name">Tên chi nhánh *</label><input id="branch-name" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} required maxLength={150} /></div>
        <div className="form-field"><label htmlFor="branch-phone">Điện thoại</label><input id="branch-phone" value={form.phone} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} maxLength={30} /></div>
        <div className="form-field"><label htmlFor="branch-address">Địa chỉ</label><input id="branch-address" value={form.address} onChange={(event) => setForm((current) => ({ ...current, address: event.target.value }))} maxLength={255} /></div>
        <div className="form-actions catalog-form-actions"><button type="button" className="button button-secondary" onClick={() => setFormOpen(false)}>Hủy</button><button type="submit" className="button button-primary" disabled={saving}>{saving ? 'Đang lưu...' : 'Lưu chi nhánh'}</button></div>
      </form></section>}
      <section className="panel table-panel"><div className="table-toolbar"><div><h3>Danh sách chi nhánh</h3><p>{branches.length.toLocaleString('vi-VN')} chi nhánh</p></div></div>
        {loading ? <div className="table-loading"><span className="loader" /> Đang tải chi nhánh...</div> : branches.length === 0 ? <EmptyState title="Chưa có chi nhánh" description="Tạo chi nhánh đầu tiên trong dữ liệu demo của trình duyệt." action={<button className="button button-secondary" onClick={openCreate}><i className="bi bi-plus-lg" aria-hidden="true" />  Thêm chi nhánh</button>} /> : <div className="table-scroll"><table><thead><tr><th>MÃ</th><th>TÊN CHI NHÁNH</th><th>ĐỊA CHỈ</th><th>ĐIỆN THOẠI</th><th>TRẠNG THÁI</th><th>THAO TÁC</th></tr></thead><tbody>{branches.map((branch) => <tr key={branch.id}><td><code>{branch.code}</code></td><td><strong>{branch.name}</strong></td><td>{branch.address || '—'}</td><td>{branch.phone || '—'}</td><td><span className={`status-tag ${branch.isActive ? 'status-active' : 'status-inactive'}`}>{branch.isActive ? 'Đang hoạt động' : 'Đã ngừng'}</span></td><td><div className="row-actions"><button type="button" className="table-action" onClick={() => openEdit(branch)}>Sửa</button><button type="button" className={`table-action${branch.isActive ? ' table-action-danger' : ''}`} onClick={() => toggleBranch(branch)}>{branch.isActive ? 'Ngừng' : 'Kích hoạt'}</button></div></td></tr>)}</tbody></table></div>}
      </section>
    </div>
  );
}

const userRoleNames = { admin: 'Quản trị viên', manager: 'Quản lý chi nhánh', sales: 'Nhân viên bán hàng', warehouse: 'Nhân viên kho', employee: 'Nhân viên', ctv: 'Cộng tác viên' };

export function UsersPage({ user }) {
  const [users, setUsers] = useState([]);
  const [branches, setBranches] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 10, totalItems: 0, totalPages: 0 });
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ username: '', email: '', fullName: '', password: '', confirmPassword: '', role: 'employee', branchId: '' });
  const [resetTarget, setResetTarget] = useState(null);
  const [resetPassword, setResetPassword] = useState('');
  const [confirmResetPassword, setConfirmResetPassword] = useState('');

  async function loadUsers() {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: '100', search });
      const result = await dataRequest(`/users?${params.toString()}`);
      setUsers(result.data);
      setPagination(result.pagination);
    } catch (requestError) {
      setUsers([]);
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { if (user?.role === 'admin') loadUsers(); else setLoading(false); }, [page, search, user?.role]);
  useEffect(() => {
    if (user?.role !== 'admin') return;
    dataRequest('/branches').then((result) => setBranches(result.data)).catch((requestError) => setError(requestError.message));
  }, [user?.role]);

  if (user?.role !== 'admin') {
    return <ModulePage title="Quản lý nhân sự" phase="Chỉ quản trị viên" description="Tài khoản hiện tại không có quyền tạo hoặc thay đổi tài khoản người dùng." />;
  }

  function openCreate() {
    setEditingId(null);
    setForm({ username: '', email: '', fullName: '', password: '', confirmPassword: '', role: 'employee', branchId: branches.find((branch) => branch.isActive)?.id ? String(branches.find((branch) => branch.isActive).id) : '' });
    setFormOpen(true);
    setError('');
    setSuccess('');
  }

  function openEdit(record) {
    if (record.role === 'admin' || record.id === user.id) return;
    setEditingId(record.id);
    setForm({ username: record.username, email: record.email, fullName: record.fullName, password: '', confirmPassword: '', role: record.role, branchId: record.branchId ? String(record.branchId) : '' });
    setFormOpen(true);
    setError('');
    setSuccess('');
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    setSuccess('');
    const payload = editingId
      ? { email: form.email, fullName: form.fullName, role: form.role, branchId: Number(form.branchId) }
      : { ...form, branchId: Number(form.branchId) };
    try {
      const result = await dataRequest(editingId ? `/users/${editingId}` : '/users', {
        method: editingId ? 'PATCH' : 'POST', body: payload,
      });
      setSuccess(result.message);
      setFormOpen(false);
      await loadUsers();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  }

  async function toggleUser(record) {
    if (record.id === user.id && record.isActive) return;
    const nextStatus = !record.isActive;
    if (!window.confirm(`${nextStatus ? 'Kích hoạt' : 'Khóa'} tài khoản ${record.username}?`)) return;
    setError('');
    setSuccess('');
    try {
      const result = await dataRequest(`/users/${record.id}/status`, { method: 'PATCH', body: { isActive: nextStatus } });
      setSuccess(result.message);
      await loadUsers();
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function submitPasswordReset(event) {
    event.preventDefault();
    if (!resetTarget) return;
    if (resetPassword.length < 12 || resetPassword.length > 200) {
      setError('Mật khẩu tạm phải dài từ 12 đến 200 ký tự.');
      return;
    }
    if (resetPassword !== confirmResetPassword) {
      setError('Mật khẩu xác nhận không khớp.');
      return;
    }
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const result = await dataRequest(`/users/${resetTarget.id}/reset-password`, {
        method: 'POST', body: { password: resetPassword, confirmPassword: confirmResetPassword },
      });
      setSuccess(result.message);
      setResetTarget(null);
      setResetPassword('');
      setConfirmResetPassword('');
      await loadUsers();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  }

  function handleSearch(event) {
    event.preventDefault();
    setPage(1);
    setSearch(searchInput.trim());
  }

  const filteredUsers = users.filter((record) => {
    const roleMatches = roleFilter === 'all' || record.role === roleFilter;
    const statusMatches = statusFilter === 'all'
      || (statusFilter === 'active' && record.isActive)
      || (statusFilter === 'inactive' && !record.isActive);
    return roleMatches && statusMatches;
  });

  return (
    <div className="page-stack">
      <section className="welcome-row"><div><span className="eyebrow">NHÂN SỰ & PHÂN QUYỀN</span><h2>Quản lý nhân viên</h2><p>Danh bạ tài khoản theo vai trò, chi nhánh và trạng thái hoạt động.</p></div><button className="button button-primary" type="button" onClick={openCreate}><i className="bi bi-person-plus" aria-hidden="true" /> Thêm nhân viên</button></section>
      <section className="staff-summary-grid" aria-label="Tổng quan danh bạ nhân viên">
        <article className="staff-summary-card"><span className="staff-summary-icon"><i className="bi bi-people" aria-hidden="true" /></span><div><small>Tổng tài khoản</small><strong>{pagination.totalItems.toLocaleString('vi-VN')}</strong><span>Khớp tìm kiếm</span></div></article>
        <article className="staff-summary-card"><span className="staff-summary-icon staff-summary-active"><i className="bi bi-person-check" aria-hidden="true" /></span><div><small>Đang hoạt động</small><strong>{users.filter((record) => record.isActive).length.toLocaleString('vi-VN')}</strong><span>Trong trang dữ liệu tải</span></div></article>
        <article className="staff-summary-card"><span className="staff-summary-icon staff-summary-warning"><i className="bi bi-key" aria-hidden="true" /></span><div><small>Cần đổi mật khẩu</small><strong>{users.filter((record) => record.mustChangePassword).length.toLocaleString('vi-VN')}</strong><span>Đang dùng mật khẩu tạm</span></div></article>
        <article className="staff-summary-card"><span className="staff-summary-icon"><i className="bi bi-building" aria-hidden="true" /></span><div><small>Chi nhánh mở</small><strong>{branches.filter((branch) => branch.isActive).length.toLocaleString('vi-VN')}</strong><span>Phân công nơi làm việc</span></div></article>
      </section>
      {error && <ErrorNotice message={error} onRetry={loadUsers} />}
      {success && <div className="notice notice-success" role="status">{success}<button type="button" className="notice-close" onClick={() => setSuccess('')} aria-label="Đóng thông báo"><i className="bi bi-x-lg" aria-hidden="true" /></button></div>}

      {resetTarget && <section className="panel product-form-panel"><div className="panel-heading"><div><span className="eyebrow">CREDENTIAL ROTATION</span><h3>Đặt lại mật khẩu · {resetTarget.username}</h3></div><button type="button" className="icon-button" onClick={() => setResetTarget(null)} aria-label="Đóng biểu mẫu"><i className="bi bi-x-lg" aria-hidden="true" /></button></div><form className="catalog-form catalog-form-supplier" onSubmit={submitPasswordReset}><div className="form-field"><label htmlFor="reset-user-password">Mật khẩu tạm mới *</label><input id="reset-user-password" type="password" autoComplete="new-password" value={resetPassword} onChange={(event) => setResetPassword(event.target.value)} minLength={12} maxLength={200} required /></div><div className="form-field"><label htmlFor="reset-user-confirm-password">Xác nhận mật khẩu *</label><input id="reset-user-confirm-password" type="password" autoComplete="new-password" value={confirmResetPassword} onChange={(event) => setConfirmResetPassword(event.target.value)} minLength={12} maxLength={200} required /></div><p className="form-hint form-field-wide">Thao tác sẽ thu hồi phiên đăng nhập hiện có của nhân viên và buộc đổi mật khẩu tạm ở lần đăng nhập kế tiếp.</p><div className="form-actions catalog-form-actions"><button type="button" className="button button-secondary" onClick={() => setResetTarget(null)}>Hủy</button><button type="submit" className="button button-primary" disabled={saving || resetPassword.length < 12 || resetPassword !== confirmResetPassword}>{saving ? 'Đang đặt lại...' : 'Đặt lại mật khẩu'}</button></div></form></section>}

      {formOpen && <section className="panel product-form-panel"><div className="panel-heading"><div><span className="eyebrow">USER PROFILE</span><h3>{editingId ? 'Cập nhật tài khoản' : 'Tạo tài khoản nhân sự'}</h3></div><button type="button" className="icon-button" onClick={() => setFormOpen(false)} aria-label="Đóng biểu mẫu"><i className="bi bi-x-lg" aria-hidden="true" /></button></div><form className="catalog-form catalog-form-supplier" onSubmit={handleSubmit}>
        {!editingId && <div className="form-field"><label htmlFor="user-username">Tên đăng nhập *</label><input id="user-username" value={form.username} onChange={(event) => setForm((current) => ({ ...current, username: event.target.value }))} minLength={3} maxLength={60} required autoComplete="off" /></div>}
        <div className="form-field"><label htmlFor="user-fullname">Họ và tên *</label><input id="user-fullname" value={form.fullName} onChange={(event) => setForm((current) => ({ ...current, fullName: event.target.value }))} minLength={2} maxLength={150} required /></div>
        <div className="form-field"><label htmlFor="user-email">Email *</label><input id="user-email" type="email" value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} maxLength={190} required /></div>
        {!editingId && <><div className="form-field"><label htmlFor="user-initial-password">Mật khẩu tạm *</label><input id="user-initial-password" type="password" autoComplete="new-password" value={form.password} onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))} minLength={12} maxLength={200} required /><small>Mật khẩu 12–200 ký tự; nhân viên phải đổi ngay lần đăng nhập đầu.</small></div><div className="form-field"><label htmlFor="user-confirm-password">Xác nhận mật khẩu tạm *</label><input id="user-confirm-password" type="password" autoComplete="new-password" value={form.confirmPassword} onChange={(event) => setForm((current) => ({ ...current, confirmPassword: event.target.value }))} minLength={12} maxLength={200} required /></div></>}
        <div className="form-hint form-field-wide">Mật khẩu chỉ được dùng để tạo verifier PBKDF2; không lưu mật khẩu rõ. Đây vẫn là tài khoản demo ở phía trình duyệt, không phải xác thực production.</div>
        <div className="form-field"><label htmlFor="user-role">Vai trò *</label><select id="user-role" value={form.role} onChange={(event) => setForm((current) => ({ ...current, role: event.target.value }))}><option value="employee">Nhân viên</option><option value="sales">Nhân viên bán hàng</option><option value="warehouse">Nhân viên kho</option><option value="manager">Quản lý chi nhánh</option><option value="ctv">Cộng tác viên</option></select></div>
        <div className="form-field"><label htmlFor="user-branch">Chi nhánh *</label><select id="user-branch" value={form.branchId} onChange={(event) => setForm((current) => ({ ...current, branchId: event.target.value }))} required><option value="">Chọn chi nhánh</option>{branches.filter((branch) => branch.isActive).map((branch) => <option key={branch.id} value={branch.id}>{branch.code} · {branch.name}</option>)}</select></div>
        <div className="form-actions catalog-form-actions"><button type="button" className="button button-secondary" onClick={() => setFormOpen(false)}>Hủy</button><button type="submit" className="button button-primary" disabled={saving || !branches.some((branch) => branch.isActive) || (!editingId && (form.password.length < 12 || form.password !== form.confirmPassword))}>{saving ? 'Đang lưu...' : editingId ? 'Lưu thay đổi' : 'Tạo tài khoản và cấp mật khẩu tạm'}</button></div>
      </form></section>}

      <section className="panel table-panel staff-directory-panel"><div className="table-toolbar staff-table-toolbar"><div><h3>Danh sách nhân viên</h3><p>Đang hiển thị {filteredUsers.length} / {users.length} hồ sơ ở trang này · {pagination.totalItems} tài khoản khớp tìm kiếm</p></div><form className="search-form" onSubmit={handleSearch}><label className="search-box"><i className="bi bi-search" aria-hidden="true" /><input aria-label="Tìm nhân viên" placeholder="Tìm tên, email hoặc username..." value={searchInput} onChange={(event) => setSearchInput(event.target.value)} /><button type="submit">Tìm</button></label></form><div className="staff-filters"><label>Vai trò<select aria-label="Lọc vai trò nhân viên" value={roleFilter} onChange={(event) => { setPage(1); setRoleFilter(event.target.value); }}><option value="all">Tất cả vai trò</option><option value="admin">Quản trị viên</option><option value="manager">Quản lý chi nhánh</option><option value="sales">Nhân viên bán hàng</option><option value="warehouse">Nhân viên kho</option><option value="employee">Nhân viên</option><option value="ctv">Cộng tác viên</option></select></label><label>Trạng thái<select aria-label="Lọc trạng thái nhân viên" value={statusFilter} onChange={(event) => { setPage(1); setStatusFilter(event.target.value); }}><option value="all">Tất cả trạng thái</option><option value="active">Đang hoạt động</option><option value="inactive">Đã khóa</option></select></label></div></div>
        {loading ? <div className="table-loading"><span className="loader" /> Đang tải danh bạ nhân viên...</div> : users.length === 0 ? <EmptyState title="Danh bạ nhân viên đang trống" description="Không tìm thấy hồ sơ trong dữ liệu trình duyệt. Hãy thử tải lại hoặc tạo tài khoản nhân viên mới." action={<button className="button button-primary" type="button" onClick={openCreate}><i className="bi bi-person-plus" aria-hidden="true" /> Thêm nhân viên</button>} /> : filteredUsers.length === 0 ? <EmptyState title="Không có nhân viên phù hợp" description="Bộ lọc vai trò hoặc trạng thái không có kết quả. Thử mở lại bộ lọc để xem toàn bộ danh bạ." action={<button className="button button-secondary" type="button" onClick={() => { setRoleFilter('all'); setStatusFilter('all'); }}>Xóa bộ lọc</button>} /> : <div className="table-scroll"><table><thead><tr><th>NHÂN VIÊN</th><th>VAI TRÒ</th><th>CHI NHÁNH</th><th>ĐĂNG NHẬP CUỐI</th><th>TRẠNG THÁI</th><th>THAO TÁC</th></tr></thead><tbody>{filteredUsers.map((record) => <tr key={record.id}><td><div className="product-name-cell"><span className="avatar user-table-avatar">{record.fullName.slice(0, 1).toUpperCase()}</span><span><strong>{record.fullName}</strong><small>{record.username} · {record.email}{record.mustChangePassword ? ' · Bắt buộc đổi mật khẩu' : ''}</small></span></div></td><td>{userRoleNames[record.role] || record.role}</td><td>{record.branchName || 'Toàn hệ thống'}</td><td>{record.lastLoginAt ? new Date(record.lastLoginAt).toLocaleString('vi-VN') : 'Chưa đăng nhập'}</td><td><span className={`status-tag ${record.isActive ? 'status-active' : 'status-inactive'}`}>{record.isActive ? 'Đang hoạt động' : 'Đã khóa'}</span></td><td><div className="row-actions">{record.role !== 'admin' && record.id !== user.id && <><button type="button" className="table-action" onClick={() => openEdit(record)}>Sửa</button><button type="button" className="table-action" onClick={() => { setResetTarget(record); setResetPassword(''); setConfirmResetPassword(''); setError(''); setSuccess(''); }}>Đặt lại mật khẩu</button></>}<button type="button" className={`table-action${record.isActive ? ' table-action-danger' : ''}`} disabled={record.id === user.id && record.isActive} onClick={() => toggleUser(record)}>{record.isActive ? 'Khóa' : 'Mở khóa'}</button></div></td></tr>)}</tbody></table></div>}
        {!loading && users.length > 0 && <div className="pagination"><span>Trang {pagination.page} / {Math.max(1, pagination.totalPages)}</span><div><button type="button" className="button button-secondary button-small" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}><i className="bi bi-chevron-left" aria-hidden="true" /> Trước</button><button type="button" className="button button-secondary button-small" disabled={page >= pagination.totalPages} onClick={() => setPage((current) => Math.min(pagination.totalPages, current + 1))}>Sau <i className="bi bi-chevron-right" aria-hidden="true" /></button></div></div>}
      </section>
      <p className="page-note">Phân quyền hiện mô phỏng phía trình duyệt. Danh bạ này chỉ dành cho quản trị viên; không sử dụng tài khoản hoặc dữ liệu thật.</p>
    </div>
  );
}

export function CustomersPage({ user }) {
  const [customers, setCustomers] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 10, totalItems: 0, totalPages: 0 });
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ fullName: '', phone: '', email: '', address: '', note: '' });
  const [history, setHistory] = useState(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const canEdit = user?.role === 'admin' || user?.role === 'manager';

  async function loadCustomers() {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: '10', search });
      const result = await dataRequest(`/customers?${params.toString()}`);
      setCustomers(result.data);
      setPagination(result.pagination);
    } catch (requestError) {
      setCustomers([]);
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadCustomers(); }, [page, search]);

  function openCreate() {
    setEditingId(null);
    setForm({ fullName: '', phone: '', email: '', address: '', note: '' });
    setFormOpen(true);
    setError('');
    setSuccess('');
    setHistory(null);
  }

  function openEdit(customer) {
    if (!canEdit) return;
    setEditingId(customer.id);
    setForm({ fullName: customer.fullName || '', phone: customer.phone || '', email: customer.email || '', address: customer.address || '', note: customer.note || '' });
    setFormOpen(true);
    setError('');
    setSuccess('');
  }

  function changeField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function saveCustomer(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const result = await dataRequest(editingId ? `/customers/${editingId}` : '/customers', {
        method: editingId ? 'PATCH' : 'POST', body: form,
      });
      setSuccess(`${result.message}${result.code ? ` Mã khách hàng: ${result.code}.` : ''}`);
      setFormOpen(false);
      await loadCustomers();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  }

  async function openHistory(customer) {
    setHistoryLoading(true);
    setError('');
    try {
      const result = await dataRequest(`/customers/${customer.id}/history`);
      setHistory(result);
      setFormOpen(false);
    } catch (requestError) {
      setHistory(null);
      setError(requestError.message);
    } finally {
      setHistoryLoading(false);
    }
  }

  function handleSearch(event) {
    event.preventDefault();
    setPage(1);
    setSearch(searchInput.trim());
  }

  return (
    <div className="page-stack">
      <section className="welcome-row"><div><span className="eyebrow">CUSTOMER RELATIONSHIPS</span><h2>Khách hàng và bảo hành</h2><p>Quản lý hồ sơ khách hàng, lịch sử mua hàng và thời hạn bảo hành từ dữ liệu đã bán.</p></div><button type="button" className="button button-primary" onClick={openCreate}><i className="bi bi-plus-lg" aria-hidden="true" />  Thêm khách hàng</button></section>
      {error && <ErrorNotice message={error} />}
      {success && <div className="notice notice-success" role="status">{success}<button type="button" className="notice-close" onClick={() => setSuccess('')} aria-label="Đóng thông báo"><i className="bi bi-x-lg" aria-hidden="true" /></button></div>}

      {formOpen && <section className="panel product-form-panel"><div className="panel-heading"><div><span className="eyebrow">CUSTOMER PROFILE</span><h3>{editingId ? 'Cập nhật hồ sơ' : 'Tạo hồ sơ khách hàng'}</h3></div><button type="button" className="icon-button" onClick={() => setFormOpen(false)} aria-label="Đóng biểu mẫu"><i className="bi bi-x-lg" aria-hidden="true" /></button></div><form className="catalog-form catalog-form-supplier" onSubmit={saveCustomer}>
        <div className="form-field"><label htmlFor="customer-name">Họ và tên *</label><input id="customer-name" value={form.fullName} onChange={(event) => changeField('fullName', event.target.value)} minLength={2} maxLength={150} required /></div>
        <div className="form-field"><label htmlFor="customer-phone">Số điện thoại</label><input id="customer-phone" value={form.phone} onChange={(event) => changeField('phone', event.target.value)} maxLength={30} /></div>
        <div className="form-field"><label htmlFor="customer-email">Email</label><input id="customer-email" type="email" value={form.email} onChange={(event) => changeField('email', event.target.value)} maxLength={190} /></div>
        <div className="form-field"><label htmlFor="customer-address">Địa chỉ</label><input id="customer-address" value={form.address} onChange={(event) => changeField('address', event.target.value)} maxLength={255} /></div>
        <div className="form-field form-field-wide"><label htmlFor="customer-note">Ghi chú</label><textarea id="customer-note" value={form.note} onChange={(event) => changeField('note', event.target.value)} rows={2} maxLength={500} /></div>
        <div className="form-actions catalog-form-actions"><button type="button" className="button button-secondary" onClick={() => setFormOpen(false)}>Hủy</button><button type="submit" className="button button-primary" disabled={saving}>{saving ? 'Đang lưu...' : 'Lưu khách hàng'}</button></div>
      </form></section>}

      {history && <section className="panel customer-history-panel"><div className="panel-heading"><div><span className="eyebrow">PURCHASE & WARRANTY HISTORY</span><h3>{history.customer.fullName}</h3><p>{history.customer.code}{history.customer.phone ? ` · ${history.customer.phone}` : ''}{history.customer.email ? ` · ${history.customer.email}` : ''}</p></div><button type="button" className="button button-secondary button-small" onClick={() => setHistory(null)}>Đóng chi tiết</button></div>
        <div className="customer-history-columns"><div><h4>Lịch sử hóa đơn ({history.sales.length})</h4>{history.sales.length ? <div className="history-record-list">{history.sales.map((sale) => <div className="history-record" key={sale.id}><div><strong>{sale.invoiceNo}</strong><small>{sale.branchName} · {new Date(sale.createdAt).toLocaleString('vi-VN')}</small></div><div className="history-record-right"><strong>{formatMoney(sale.totalAmount)}</strong><small>{sale.status === 'completed' ? 'Hoàn tất' : sale.status}</small></div></div>)}</div> : <p className="muted-note">Chưa có hóa đơn theo phạm vi quyền truy cập.</p>}</div>
          <div><h4>Bảo hành ({history.warranties.length})</h4>{history.warranties.length ? <div className="history-record-list">{history.warranties.map((warranty) => <div className="history-record" key={warranty.id}><div><strong>{warranty.productName}</strong><small>{warranty.warrantyNo} · {warranty.invoiceNo}</small></div><div className="history-record-right"><strong>{new Date(warranty.endDate).toLocaleDateString('vi-VN')}</strong><small>{warranty.status === 'active' ? 'Đang bảo hành' : warranty.status}</small></div></div>)}</div> : <p className="muted-note">Chưa có bản ghi bảo hành. Bản ghi sẽ được tạo khi bán sản phẩm có thời hạn bảo hành cho khách hàng đã chọn.</p>}</div>
        </div>
      </section>}

      <section className="panel table-panel"><div className="table-toolbar"><div><h3>Danh sách khách hàng</h3><p>{pagination.totalItems.toLocaleString('vi-VN')} hồ sơ khách hàng</p></div><form className="search-form" onSubmit={handleSearch}><label className="search-box"><i className="bi bi-search" aria-hidden="true" /><input aria-label="Tìm khách hàng" placeholder="Tìm tên, mã, điện thoại hoặc email..." value={searchInput} onChange={(event) => setSearchInput(event.target.value)} /><button type="submit">Tìm</button></label></form></div>
        {loading ? <div className="table-loading"><span className="loader" /> Đang tải khách hàng...</div> : customers.length === 0 ? <EmptyState title="Chưa có hồ sơ khách hàng" description="Hồ sơ được tạo từ thao tác người dùng; hệ thống không tự thêm khách hàng mẫu." action={<button className="button button-secondary" onClick={openCreate}><i className="bi bi-plus-lg" aria-hidden="true" />  Thêm khách hàng</button>} /> : <div className="table-scroll"><table><thead><tr><th>MÃ</th><th>KHÁCH HÀNG</th><th>ĐIỆN THOẠI</th><th>EMAIL</th><th>ĐỊA CHỈ</th><th>THAO TÁC</th></tr></thead><tbody>{customers.map((customer) => <tr key={customer.id}><td><code>{customer.code}</code></td><td><strong>{customer.fullName}</strong></td><td>{customer.phone || '—'}</td><td>{customer.email || '—'}</td><td>{customer.address || '—'}</td><td><div className="row-actions"><button type="button" className="table-action" disabled={historyLoading} onClick={() => openHistory(customer)}>Lịch sử</button>{canEdit && <button type="button" className="table-action" onClick={() => openEdit(customer)}>Sửa</button>}</div></td></tr>)}</tbody></table></div>}
        {!loading && customers.length > 0 && <div className="pagination"><span>Trang {pagination.page} / {Math.max(1, pagination.totalPages)}</span><div><button type="button" className="button button-secondary button-small" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}><i className="bi bi-chevron-left" aria-hidden="true" /> Trước</button><button type="button" className="button button-secondary button-small" disabled={page >= pagination.totalPages} onClick={() => setPage((current) => Math.min(pagination.totalPages, current + 1))}>Sau <i className="bi bi-chevron-right" aria-hidden="true" /></button></div></div>}
      </section>
      <p className="page-note">Lịch sử được lọc theo chi nhánh bằng logic frontend để minh họa vai trò, không phải biện pháp bảo mật. Bảo hành dùng hóa đơn demo nội bộ.</p>
    </div>
  );
}

const warrantyStatusNames = {
  active: 'Đang bảo hành',
  received: 'Đã tiếp nhận',
  repairing: 'Đang sửa chữa',
  completed: 'Đã hoàn tất',
  void: 'Đã hủy',
};

const warrantyTransitions = {
  active: ['active', 'received', 'void'],
  received: ['received', 'repairing', 'completed', 'void'],
  repairing: ['repairing', 'received', 'completed', 'void'],
  completed: ['completed'],
  void: ['void'],
};

export function WarrantiesPage({ user }) {
  const [warranties, setWarranties] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 10, totalItems: 0, totalPages: 0 });
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [selectedWarranty, setSelectedWarranty] = useState(null);
  const [form, setForm] = useState({ status: 'active', issueDescription: '', resolution: '' });
  const canEdit = user?.role === 'admin' || user?.role === 'manager';

  async function loadWarranties() {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: '10', search });
      if (statusFilter) params.set('status', statusFilter);
      const result = await dataRequest(`/warranties?${params.toString()}`);
      setWarranties(result.data);
      setPagination(result.pagination);
    } catch (requestError) {
      setWarranties([]);
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadWarranties(); }, [page, search, statusFilter]);

  function openEdit(warranty) {
    setSelectedWarranty(warranty);
    setForm({
      status: warranty.status,
      issueDescription: warranty.issueDescription || '',
      resolution: warranty.resolution || '',
    });
    setError('');
    setSuccess('');
  }

  async function saveWarranty(event) {
    event.preventDefault();
    if (!selectedWarranty) return;
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const result = await dataRequest(`/warranties/${selectedWarranty.id}`, {
        method: 'PATCH', body: form,
      });
      setSuccess(result.message);
      setSelectedWarranty(null);
      await loadWarranties();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  }

  function handleSearch(event) {
    event.preventDefault();
    setPage(1);
    setSearch(searchInput.trim());
  }

  const openCases = warranties.filter((item) => ['active', 'received', 'repairing'].includes(item.status)).length;

  return (
    <div className="page-stack">
      <section className="welcome-row"><div><span className="eyebrow">AFTER-SALES SERVICE</span><h2>Quản lý bảo hành</h2><p>Tiếp nhận, theo dõi sửa chữa và hoàn tất bảo hành được tạo từ hóa đơn nội bộ.</p></div><span className="environment-tag"><span /> Bản ghi demo</span></section>
      {error && <ErrorNotice message={error} />}
      {success && <div className="notice notice-success" role="status">{success}<button type="button" className="notice-close" onClick={() => setSuccess('')} aria-label="Đóng thông báo"><i className="bi bi-x-lg" aria-hidden="true" /></button></div>}

      <section className="warranty-summary-grid">
        <article className="warranty-summary-card"><span>Phiếu trong kết quả hiện tại</span><strong>{pagination.totalItems.toLocaleString('vi-VN')}</strong><small>Lọc theo trạng thái/từ khóa</small></article>
        <article className="warranty-summary-card"><span>Phiếu đang xử lý trong trang</span><strong>{openCases.toLocaleString('vi-VN')}</strong><small>Đang bảo hành, tiếp nhận hoặc sửa chữa</small></article>
        <article className="warranty-summary-card"><span>Phạm vi</span><strong>{user?.role === 'admin' ? 'Toàn chuỗi' : 'Chi nhánh'}</strong><small>Phạm vi hiển thị demo, không phải bảo mật</small></article>
      </section>

      {selectedWarranty && <section className="panel warranty-form-panel"><div className="panel-heading"><div><span className="eyebrow">WARRANTY CASE</span><h3>{selectedWarranty.warrantyNo} · {selectedWarranty.productName}</h3><p>Hóa đơn {selectedWarranty.invoiceNo}{selectedWarranty.customerName ? ` · ${selectedWarranty.customerName}` : ' · Khách lẻ'}</p></div><button type="button" className="icon-button" onClick={() => setSelectedWarranty(null)} aria-label="Đóng biểu mẫu"><i className="bi bi-x-lg" aria-hidden="true" /></button></div>
        <form className="catalog-form" onSubmit={saveWarranty}>
          <div className="form-field"><label htmlFor="warranty-status">Trạng thái *</label><select id="warranty-status" value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))}>{warrantyTransitions[selectedWarranty.status].map((status) => <option key={status} value={status}>{warrantyStatusNames[status]}</option>)}</select></div>
          <div className="form-field"><label htmlFor="warranty-serial">Số serial</label><input id="warranty-serial" value={selectedWarranty.serialNo || 'Chưa ghi nhận'} readOnly /></div>
          <div className="form-field form-field-wide"><label htmlFor="warranty-issue">Mô tả lỗi / tình trạng *</label><textarea id="warranty-issue" value={form.issueDescription} onChange={(event) => setForm((current) => ({ ...current, issueDescription: event.target.value }))} minLength={3} maxLength={1000} rows={3} required={['received', 'repairing', 'completed'].includes(form.status)} /></div>
          <div className="form-field form-field-wide"><label htmlFor="warranty-resolution">Kết quả xử lý</label><textarea id="warranty-resolution" value={form.resolution} onChange={(event) => setForm((current) => ({ ...current, resolution: event.target.value }))} minLength={3} maxLength={1000} rows={3} required={form.status === 'completed'} placeholder="Ghi kết quả sửa chữa/đổi sản phẩm khi hoàn tất..." /></div>
          <div className="form-hint form-field-wide">Máy chủ SQLite kiểm tra chuyển trạng thái, quyền chi nhánh, mô tả lỗi và kết quả xử lý trước khi lưu nhật ký.</div>
          <div className="form-actions catalog-form-actions"><button type="button" className="button button-secondary" onClick={() => setSelectedWarranty(null)}>Hủy</button><button type="submit" className="button button-primary" disabled={saving}>{saving ? 'Đang lưu...' : 'Lưu xử lý bảo hành'}</button></div>
        </form>
      </section>}

      <section className="panel table-panel"><div className="table-toolbar"><div><h3>Danh sách phiếu bảo hành</h3><p>{pagination.totalItems.toLocaleString('vi-VN')} phiếu</p></div><div className="warranty-toolbar"><label className="dummy-category-select"><span>Trạng thái</span><select value={statusFilter} onChange={(event) => { setPage(1); setStatusFilter(event.target.value); }}><option value="">Tất cả</option>{Object.entries(warrantyStatusNames).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><form className="search-form" onSubmit={handleSearch}><label className="search-box"><i className="bi bi-search" aria-hidden="true" /><input aria-label="Tìm phiếu bảo hành" placeholder="Mã phiếu, serial, sản phẩm, hóa đơn..." value={searchInput} onChange={(event) => setSearchInput(event.target.value)} /><button type="submit">Tìm</button></label></form></div></div>
        {loading ? <div className="table-loading"><span className="loader" /> Đang tải bảo hành...</div> : warranties.length === 0 ? <EmptyState title="Chưa có phiếu bảo hành phù hợp" description="Phiếu được tạo từ giao dịch bán hàng nội bộ có chọn khách hàng và thời hạn bảo hành; không dùng dữ liệu DummyJSON." /> : <div className="table-scroll"><table><thead><tr><th>MÃ BẢO HÀNH</th><th>SẢN PHẨM</th><th>KHÁCH HÀNG</th><th>HÓA ĐƠN</th><th>HẠN BẢO HÀNH</th><th>TRẠNG THÁI</th>{canEdit && <th>THAO TÁC</th>}</tr></thead><tbody>{warranties.map((item) => <tr key={item.id}><td><code>{item.warrantyNo}</code></td><td><strong>{item.productName}</strong><small className="warranty-serial-label">{item.sku}{item.serialNo ? ` · ${item.serialNo}` : ''}</small></td><td>{item.customerName || 'Khách lẻ'}</td><td><code>{item.invoiceNo}</code></td><td>{new Date(item.endDate).toLocaleDateString('vi-VN')}</td><td><span className={`status-tag ${['active','received','repairing'].includes(item.status) ? 'status-low-stock' : item.status === 'completed' ? 'status-active' : 'status-inactive'}`}>{warrantyStatusNames[item.status] || item.status}</span></td>{canEdit && <td><button type="button" className="table-action" disabled={item.status === 'completed' || item.status === 'void'} onClick={() => openEdit(item)}>Cập nhật</button></td>}</tr>)}</tbody></table></div>}
        {!loading && warranties.length > 0 && <div className="pagination"><span>Trang {pagination.page} / {Math.max(1, pagination.totalPages)}</span><div><button type="button" className="button button-secondary button-small" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}><i className="bi bi-chevron-left" aria-hidden="true" /> Trước</button><button type="button" className="button button-secondary button-small" disabled={page >= pagination.totalPages} onClick={() => setPage((current) => Math.min(pagination.totalPages, current + 1))}>Sau <i className="bi bi-chevron-right" aria-hidden="true" /></button></div></div>}
      </section>
      <p className="page-note">Bảo hành phát sinh khi bán hàng nội bộ có chọn khách hàng; việc nhận, sửa và hoàn tất tạo nhật ký audit. Bản ghi hoàn tất/hủy là trạng thái cuối.</p>
    </div>
  );
}

export function StockCountsPage({ user }) {
  const [counts, setCounts] = useState([]);
  const [branches, setBranches] = useState([]);
  const [products, setProducts] = useState([]);
  const [branchId, setBranchId] = useState(user?.role === 'admin' ? '' : String(user?.branchId || ''));
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [productSearch, setProductSearch] = useState('');
  const [selectedProducts, setSelectedProducts] = useState([]);
  const [countNote, setCountNote] = useState('');
  const [selectedCount, setSelectedCount] = useState(null);
  const [countDetail, setCountDetail] = useState(null);
  const [countInputs, setCountInputs] = useState({});
  const [detailLoading, setDetailLoading] = useState(false);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 10, totalItems: 0, totalPages: 0 });
  const isAdmin = user?.role === 'admin';
  const canManage = isAdmin || user?.role === 'manager';

  async function loadCounts() {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: '10' });
      if (isAdmin && branchId) params.set('branchId', branchId);
      const result = await dataRequest(`/inventory/counts?${params.toString()}`);
      setCounts(result.data);
      setPagination(result.pagination);
    } catch (requestError) {
      setCounts([]);
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadCounts(); }, [page, branchId, isAdmin]);
  useEffect(() => {
    Promise.all([dataRequest('/branches'), dataRequest('/products?page=1&pageSize=100')])
      .then(([branchResult, productResult]) => {
        setBranches(branchResult.data);
        setProducts(productResult.data);
      })
      .catch((requestError) => setError(requestError.message));
  }, []);

  const filteredProducts = products.filter((product) => {
    const query = productSearch.trim().toLocaleLowerCase('vi-VN');
    return !query || `${product.name} ${product.sku}`.toLocaleLowerCase('vi-VN').includes(query);
  });

  function toggleProduct(product) {
    setSelectedProducts((current) => current.some((item) => item.id === product.id)
      ? current.filter((item) => item.id !== product.id)
      : [...current, { id: product.id, sku: product.sku, name: product.name }]);
  }

  async function createCount(event) {
    event.preventDefault();
    if (isAdmin && !branchId) {
      setError('Chọn chi nhánh trước khi tạo phiếu kiểm kê.');
      return;
    }
    if (!selectedProducts.length) {
      setError('Chọn ít nhất một sản phẩm cần kiểm kê.');
      return;
    }
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const result = await dataRequest('/inventory/counts', {
        method: 'POST',
        body: {
          ...(isAdmin ? { branchId: Number(branchId) } : {}),
          note: countNote,
          items: selectedProducts.map((product) => ({ productId: product.id })),
        },
      });
      setSuccess(`${result.message} Phiếu ${result.countNo}.`);
      setCreateOpen(false);
      setSelectedProducts([]);
      setCountNote('');
      await loadCounts();
      await openCount({ id: result.id, countNo: result.countNo });
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  }

  async function openCount(record) {
    setDetailLoading(true);
    setError('');
    try {
      const result = await dataRequest(`/inventory/counts/${record.id}`);
      setSelectedCount(result.count);
      setCountDetail(result);
      setCountInputs(Object.fromEntries(result.items.map((item) => [item.productId, item.countedQuantity === null ? '' : String(item.countedQuantity)])));
      setCreateOpen(false);
    } catch (requestError) {
      setError(requestError.message);
      setCountDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }

  async function saveCountItems(event) {
    event.preventDefault();
    if (!countDetail || !selectedCount) return;
    const items = countDetail.items
      .filter((item) => String(countInputs[item.productId] ?? '').trim() !== '')
      .map((item) => ({ productId: item.productId, countedQuantity: Number(countInputs[item.productId]) }));
    if (!items.length || items.some((item) => !Number.isSafeInteger(item.countedQuantity) || item.countedQuantity < 0 || item.countedQuantity > 1000000)) {
      setError('Nhập số đếm là số nguyên từ 0 đến 1.000.000 cho ít nhất một sản phẩm.');
      return;
    }
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const result = await dataRequest(`/inventory/counts/${selectedCount.id}/items`, { method: 'PATCH', body: { items } });
      setSuccess(result.message);
      await openCount(selectedCount);
      await loadCounts();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  }

  async function completeCount() {
    if (!selectedCount) return;
    if (!window.confirm(`Chốt phiếu ${selectedCount.countNo}? Tồn kho sẽ được điều chỉnh theo số đếm đã lưu.`)) return;
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const result = await dataRequest(`/inventory/counts/${selectedCount.id}/complete`, { method: 'POST', body: {} });
      setSuccess(`${result.message} ${result.adjustmentCount} mặt hàng được điều chỉnh.`);
      setCountDetail(null);
      setSelectedCount(null);
      await loadCounts();
    } catch (requestError) {
      setError(requestError.message);
      // Nếu tồn đã thay đổi từ lúc kiểm kê, tải lại phiếu và so sánh lại thay vì ghi đè.
      await openCount(selectedCount).catch(() => {});
    } finally {
      setSaving(false);
    }
  }

  async function cancelCount(record) {
    if (!window.confirm(`Hủy phiếu kiểm kê ${record.countNo}? Tồn kho hiện tại sẽ không thay đổi.`)) return;
    setError('');
    setSuccess('');
    try {
      const result = await dataRequest(`/inventory/counts/${record.id}/cancel`, { method: 'POST', body: {} });
      setSuccess(result.message);
      if (selectedCount?.id === record.id) {
        setSelectedCount(null);
        setCountDetail(null);
      }
      await loadCounts();
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  return (
    <div className="page-stack">
      <section className="welcome-row"><div><span className="eyebrow">PHYSICAL INVENTORY</span><h2>Kiểm kê tồn kho</h2><p>Đối chiếu số đếm thực tế với snapshot hệ thống; chốt phiếu chỉ khi tồn kho không phát sinh thay đổi giữa chừng.</p></div>{canManage && <button type="button" className="button button-primary" onClick={() => { setCreateOpen((current) => !current); setSelectedCount(null); setCountDetail(null); setError(''); }}><i className="bi bi-plus-lg" aria-hidden="true" />  Tạo phiếu kiểm kê</button>}</section>
      {error && <ErrorNotice message={error} />}
      {success && <div className="notice notice-success" role="status">{success}<button type="button" className="notice-close" onClick={() => setSuccess('')} aria-label="Đóng thông báo"><i className="bi bi-x-lg" aria-hidden="true" /></button></div>}

      {createOpen && <section className="panel count-create-panel"><div className="panel-heading"><div><span className="eyebrow">NEW STOCK COUNT</span><h3>Tạo phiếu kiểm kê</h3><p>Phiếu sẽ chụp tồn kho hệ thống hiện tại khi tạo; số tồn không thay đổi cho đến khi chốt.</p></div><button type="button" className="icon-button" onClick={() => setCreateOpen(false)} aria-label="Đóng biểu mẫu"><i className="bi bi-x-lg" aria-hidden="true" /></button></div>
        <form onSubmit={createCount}>
          <div className="count-create-fields">{isAdmin && <div className="form-field"><label htmlFor="count-branch">Chi nhánh *</label><select id="count-branch" value={branchId} onChange={(event) => setBranchId(event.target.value)} required><option value="">Chọn chi nhánh</option>{branches.filter((item) => item.isActive).map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select></div>}<div className="form-field"><label htmlFor="count-note">Ghi chú</label><input id="count-note" value={countNote} onChange={(event) => setCountNote(event.target.value)} maxLength={500} placeholder="Ví dụ: kiểm kê cuối tháng" /></div></div>
          <label className="search-box count-product-search"><i className="bi bi-search" aria-hidden="true" /><input aria-label="Tìm sản phẩm kiểm kê" placeholder="Tìm sản phẩm theo tên hoặc SKU..." value={productSearch} onChange={(event) => setProductSearch(event.target.value)} /></label>
          <div className="count-product-picker">{filteredProducts.map((product) => <label className="count-product-option" key={product.id}><input type="checkbox" checked={selectedProducts.some((item) => item.id === product.id)} onChange={() => toggleProduct(product)} /><span><strong>{product.name}</strong><small>{product.sku}</small></span></label>)}</div>
          <div className="count-selected-footer"><span>Đã chọn {selectedProducts.length} sản phẩm</span><button type="button" className="text-button" onClick={() => setSelectedProducts([])}>Bỏ chọn tất cả</button></div>
          <div className="form-actions"><button type="button" className="button button-secondary" onClick={() => setCreateOpen(false)}>Hủy</button><button type="submit" className="button button-primary" disabled={saving || !selectedProducts.length || (isAdmin && !branchId)}>{saving ? 'Đang tạo...' : 'Tạo phiếu'}</button></div>
        </form>
      </section>}

      {countDetail && selectedCount && <section className="panel count-detail-panel"><div className="panel-heading"><div><span className="eyebrow">STOCK COUNT DETAILS</span><h3>{selectedCount.countNo}</h3><p>{selectedCount.branchName} · {selectedCount.status === 'counting' ? 'Đang kiểm kê' : selectedCount.status === 'completed' ? 'Đã chốt' : selectedCount.status}</p></div><button type="button" className="button button-secondary button-small" onClick={() => { setSelectedCount(null); setCountDetail(null); }}>Đóng chi tiết</button></div>
        <form onSubmit={saveCountItems}><p className="form-hint">Số đếm là số sản phẩm thực tế trên kệ. Chỉ được chỉnh khi phiếu đang kiểm kê.</p><div className="table-scroll"><table><thead><tr><th>SẢN PHẨM</th><th>SKU</th><th>TỒN HỆ THỐNG KHI TẠO</th><th>SỐ ĐẾM THỰC TẾ</th><th>CHÊNH LỆCH</th></tr></thead><tbody>{countDetail.items.map((item) => { const counted = String(countInputs[item.productId] ?? '').trim() === '' ? null : Number(countInputs[item.productId]); const delta = counted === null ? null : counted - item.systemQuantity; return <tr key={item.productId}><td><strong>{item.productName}</strong></td><td><code>{item.sku}</code></td><td>{item.systemQuantity}</td><td><input className="count-quantity-input" aria-label={`Số đếm ${item.productName}`} type="number" min="0" max="1000000" step="1" disabled={selectedCount.status !== 'counting'} value={countInputs[item.productId] ?? ''} onChange={(event) => setCountInputs((current) => ({ ...current, [item.productId]: event.target.value }))} /></td><td>{delta === null ? '—' : <strong className={delta > 0 ? 'quantity-positive' : delta < 0 ? 'quantity-negative' : ''}>{delta > 0 ? '+' : ''}{delta}</strong>}</td></tr>; })}</tbody></table></div>
          <div className="form-actions count-detail-actions">{selectedCount.status === 'counting' && <><button type="submit" className="button button-secondary" disabled={saving}>{saving ? 'Đang lưu...' : 'Lưu số đếm'}</button><button type="button" className="button button-primary" disabled={saving || countDetail.items.some((item) => String(countInputs[item.productId] ?? '').trim() === '')} onClick={completeCount}>Chốt và điều chỉnh tồn</button></>}</div>
        </form>
      </section>}

      <section className="panel table-panel"><div className="table-toolbar"><div><h3>Phiếu kiểm kê</h3><p>{pagination.totalItems.toLocaleString('vi-VN')} phiếu</p></div><div className="inventory-toolbar-controls">{isAdmin && <label className="dummy-category-select"><span>Chi nhánh</span><select value={branchId} onChange={(event) => { setBranchId(event.target.value); setPage(1); }}><option value="">Toàn chuỗi</option>{branches.filter((item) => item.isActive).map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select></label>}<button type="button" className="button button-secondary button-small" onClick={loadCounts}><i className="bi bi-arrow-clockwise" aria-hidden="true" /> Làm mới</button></div></div>
        {loading ? <div className="table-loading"><span className="loader" /> Đang tải phiếu kiểm kê...</div> : counts.length === 0 ? <EmptyState title="Chưa có phiếu kiểm kê" description="Tạo phiếu để chụp tồn hệ thống và bắt đầu đếm thực tế. Hệ thống không tự tạo sản phẩm mẫu." action={canManage ? <button type="button" className="button button-secondary" onClick={() => setCreateOpen(true)}><i className="bi bi-plus-lg" aria-hidden="true" />  Tạo phiếu kiểm kê</button> : null} /> : <div className="table-scroll"><table><thead><tr><th>MÃ PHIẾU</th><th>CHI NHÁNH</th><th>SẢN PHẨM</th><th>ĐÃ ĐẾM</th><th>NGÀY TẠO</th><th>TRẠNG THÁI</th><th>THAO TÁC</th></tr></thead><tbody>{counts.map((record) => <tr key={record.id}><td><code>{record.countNo}</code></td><td>{record.branchName}</td><td>{record.itemCount}</td><td>{record.countedItems} / {record.itemCount}</td><td>{new Date(record.createdAt).toLocaleDateString('vi-VN')}</td><td><span className={`status-tag ${record.status === 'completed' ? 'status-active' : record.status === 'cancelled' ? 'status-inactive' : 'status-low-stock'}`}>{record.status === 'counting' ? 'Đang kiểm kê' : record.status === 'completed' ? 'Đã chốt' : record.status === 'cancelled' ? 'Đã hủy' : 'Nháp'}</span></td><td><div className="row-actions"><button type="button" className="table-action" disabled={detailLoading} onClick={() => openCount(record)}>Mở</button>{canManage && ['draft','counting'].includes(record.status) && <button type="button" className="table-action table-action-danger" onClick={() => cancelCount(record)}>Hủy</button>}</div></td></tr>)}</tbody></table></div>}
        {!loading && counts.length > 0 && <div className="pagination"><span>Trang {pagination.page} / {Math.max(1, pagination.totalPages)}</span><div><button type="button" className="button button-secondary button-small" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}><i className="bi bi-chevron-left" aria-hidden="true" /> Trước</button><button type="button" className="button button-secondary button-small" disabled={page >= pagination.totalPages} onClick={() => setPage((current) => Math.min(pagination.totalPages, current + 1))}>Sau <i className="bi bi-chevron-right" aria-hidden="true" /></button></div></div>}
      </section>
      <p className="page-note">Khi chốt, logic demo so sánh tồn hiện tại với snapshot lúc lập phiếu. Nếu tồn đổi giữa chừng, hệ thống từ chối chốt để tránh ghi đè.</p>
    </div>
  );
}

export function ReportsPage({ user }) {
  const today = new Date().toISOString().slice(0, 10);
  const [dateFrom, setDateFrom] = useState(`${today.slice(0, 7)}-01`);
  const [dateTo, setDateTo] = useState(today);
  const [branchId, setBranchId] = useState('');
  const [branches, setBranches] = useState([]);
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const isAdmin = user?.role === 'admin';

  useEffect(() => {
    if (!isAdmin) return;
    dataRequest('/branches').then((result) => setBranches(result.data)).catch(() => setBranches([]));
  }, [isAdmin]);

  async function loadReport(event) {
    event?.preventDefault();
    if (!dateFrom || !dateTo || dateFrom > dateTo) {
      setError('Chọn khoảng ngày hợp lệ; ngày bắt đầu không được sau ngày kết thúc.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ dateFrom, dateTo });
      if (isAdmin && branchId) params.set('branchId', branchId);
      const result = await dataRequest(`/reports/summary?${params.toString()}`);
      setReport(result);
    } catch (requestError) {
      setReport(null);
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadReport(); }, [isAdmin]);

  const summary = report?.summary;
  const metrics = summary ? [
    { label: 'Doanh thu gộp', value: formatMoney(summary.grossRevenue), note: 'Giá trị hóa đơn hoàn tất trước hoàn tiền', kind: 'report-blue' },
    { label: 'Đã hoàn tiền', value: formatMoney(summary.refundedAmount), note: 'Phiếu đổi trả hoàn tất', kind: 'report-amber' },
    { label: 'Doanh thu thuần', value: formatMoney(summary.netRevenue), note: 'Doanh thu gộp trừ tiền hoàn', kind: 'report-teal' },
    { label: 'Lợi nhuận gộp', value: formatMoney(summary.grossProfit), note: 'Doanh thu thuần trừ giá vốn hàng đã bán ròng', kind: summary.grossProfit < 0 ? 'report-amber' : 'report-teal' },
    { label: 'Đơn hàng', value: summary.orderCount.toLocaleString('vi-VN'), note: 'Không gồm nháp hoặc đơn hủy', kind: 'report-slate' },
    { label: 'Sản phẩm tồn thấp', value: summary.lowStockProducts.toLocaleString('vi-VN'), note: 'Tồn không quá 5 đơn vị', kind: 'report-amber' },
  ] : [];

  return (
    <div className="page-stack">
      <section className="welcome-row"><div><span className="eyebrow">BUSINESS INTELLIGENCE</span><h2>Báo cáo vận hành</h2><p>Doanh thu thuần và lợi nhuận gộp ước tính tính từ hóa đơn, hoàn tiền và giá vốn trong dữ liệu demo.</p></div><span className="environment-tag"><span /> Báo cáo demo</span></section>
      <section className="panel report-filter-panel"><form onSubmit={loadReport} className="report-filters"><div className="form-field"><label htmlFor="report-date-from">Từ ngày</label><input id="report-date-from" type="date" value={dateFrom} max={dateTo || today} onChange={(event) => setDateFrom(event.target.value)} required /></div><div className="form-field"><label htmlFor="report-date-to">Đến ngày</label><input id="report-date-to" type="date" value={dateTo} min={dateFrom} max={today} onChange={(event) => setDateTo(event.target.value)} required /></div>{isAdmin && <div className="form-field"><label htmlFor="report-branch">Chi nhánh</label><select id="report-branch" value={branchId} onChange={(event) => setBranchId(event.target.value)}><option value="">Toàn chuỗi</option>{branches.filter((branch) => branch.isActive).map((branch) => <option key={branch.id} value={branch.id}>{branch.code} · {branch.name}</option>)}</select></div>}<button type="submit" className="button button-primary" disabled={loading}>{loading ? 'Đang tổng hợp...' : 'Xem báo cáo'}</button></form></section>
      {error && <ErrorNotice message={error} onRetry={() => loadReport()} />}
      {loading && !report ? <div className="table-loading"><span className="loader" /> Đang truy vấn số liệu...</div> : null}
      {summary && <>
        <section className="report-metric-grid">{metrics.map((metric) => <article className={`report-metric-card ${metric.kind}`} key={metric.label}><span>{metric.label}</span><strong>{metric.value}</strong><small>{metric.note}</small></article>)}</section>
        <section className="report-detail-grid">
          <article className="panel report-detail-panel"><div className="panel-heading"><div><span className="eyebrow">REVENUE TREND</span><h3>Doanh thu thuần theo ngày</h3></div><span className="panel-index">{report.period.dateFrom} → {report.period.dateTo}</span></div>
            {report.revenueByDay.length === 0 ? <EmptyState title="Chưa có giao dịch" description="Không có hóa đơn hợp lệ trong khoảng ngày được chọn." /> : <div className="report-trend-list">{report.revenueByDay.map((day) => { const maxRevenue = Math.max(1, ...report.revenueByDay.map((item) => item.netRevenue)); const ratio = Math.max(0, Math.min(100, day.netRevenue / maxRevenue * 100)); return <div className="report-trend-row" key={day.date}><div className="report-trend-label"><strong>{new Date(`${day.date}T00:00:00`).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })}</strong><small>{day.orderCount} đơn</small></div><div className="report-trend-track"><span style={{ width: `${ratio}%` }} /></div><strong className="report-trend-value">{formatMoney(day.netRevenue)}</strong></div>; })}</div>}
          </article>
          <article className="panel report-detail-panel"><div className="panel-heading"><div><span className="eyebrow">TOP PRODUCTS</span><h3>Sản phẩm bán ròng cao</h3></div></div>
            {report.topProducts.length === 0 ? <EmptyState title="Chưa có mặt hàng bán" description="Danh sách này dựa trên dòng hàng của hóa đơn nội bộ, sau khi trừ lượng trả." /> : <div className="report-top-list">{report.topProducts.map((product, index) => <div className="report-top-row" key={product.productId}><span className="report-rank">{String(index + 1).padStart(2, '0')}</span><div><strong>{product.productName}</strong><small>{product.netQuantity.toLocaleString('vi-VN')} sản phẩm bán ròng</small></div><b>{formatMoney(product.netSales)}</b></div>)}</div>}
            <div className="report-stock-summary"><div><span>Đang kinh doanh</span><strong>{summary.activeProducts.toLocaleString('vi-VN')}</strong></div><div><span>Tổng số lượng tồn</span><strong>{summary.totalUnits.toLocaleString('vi-VN')}</strong></div></div>
          </article>
        </section>
        <p className="page-note">Khoảng báo cáo: {report.period.dateFrom} đến {report.period.dateTo}. {report.period.branchId ? 'Đã lọc theo chi nhánh.' : 'Phạm vi toàn chuỗi.'} Tiền hoàn và lượng hàng trả được tính từ phiếu đổi trả hoàn tất; không sử dụng dữ liệu DummyJSON trong báo cáo.</p>
      </>}
    </div>
  );
}

export function ModulePage({ title, phase, description }) {
  return <section className="panel module-placeholder"><div className="module-icon"><i className="bi bi-clock-history" aria-hidden="true" /></div><span className="eyebrow">IMPLEMENTATION ROADMAP</span><h2>{title}</h2><p>{description}</p><div className="module-status"><span className="status-tag">Chưa nghiệm thu</span><span>{phase}</span></div><div className="module-divider" /><p className="module-note">Mục này là màn hình thông báo tiến độ, chưa thực hiện nghiệp vụ và không hiển thị dữ liệu giả.</p><Link className="inline-link" to="/">Quay lại tổng quan <i className="bi bi-arrow-right" aria-hidden="true" /></Link></section>;
}

const dateTimeLocalValue = (date) => {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
};

// Nhóm nghiệp vụ nhập hàng, khuyến mãi và nhật ký dùng chung để không tạo quá nhiều component nhỏ.
export function OperationsPage({ user }) {
  const [activeTab, setActiveTab] = useState('receipts');
  const [receipts, setReceipts] = useState([]);
  const [promotions, setPromotions] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [products, setProducts] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [receiptForm, setReceiptForm] = useState({
    supplierId: '', branchId: String(user?.branchId || 1), productId: '', quantity: '1', unitCost: '', note: '',
  });
  const now = new Date();
  const nextWeek = new Date(now.getTime() + 7 * 86400000);
  const [promotionForm, setPromotionForm] = useState({
    code: '', discountType: 'percent', discountValue: '10', minimumOrder: '0',
    startAt: dateTimeLocalValue(now), endAt: dateTimeLocalValue(nextWeek), usageLimit: '',
  });
  const canManage = ['admin', 'manager'].includes(user?.role);

  async function loadData() {
    setLoading(true);
    setError('');
    try {
      const results = await Promise.all([
        dataRequest('/purchase-receipts'),
        dataRequest('/promotions'),
        dataRequest('/products?page=1&pageSize=100'),
        dataRequest('/suppliers'),
        dataRequest('/branches'),
        user?.role === 'admin' ? dataRequest('/audit-logs') : Promise.resolve({ data: [] }),
      ]);
      setReceipts(results[0].data || []);
      setPromotions(results[1].data || []);
      setProducts(results[2].data || []);
      setSuppliers(results[3].data || []);
      setBranches(results[4].data || []);
      setAuditLogs(results[5].data || []);
      setReceiptForm((current) => ({
        ...current,
        supplierId: current.supplierId || String(results[3].data?.[0]?.id || ''),
        productId: current.productId || String(results[2].data?.[0]?.id || ''),
        branchId: String(user?.branchId || current.branchId || results[4].data?.[0]?.id || 1),
      }));
    } catch (requestError) {
      setError(requestError.message || 'Không tải được dữ liệu demo.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadData(); }, [user?.role, user?.branchId]);

  async function createReceipt(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const result = await dataRequest('/purchase-receipts', {
        method: 'POST',
        body: {
          supplierId: Number(receiptForm.supplierId),
          branchId: Number(receiptForm.branchId),
          note: receiptForm.note.trim(),
          items: [{
            productId: Number(receiptForm.productId),
            quantity: Number(receiptForm.quantity),
            unitCost: receiptForm.unitCost === '' ? undefined : Number(receiptForm.unitCost),
          }],
        },
      });
      setSuccess(result.message + ' Xác nhận phiếu mới làm tăng tồn kho.');
      setReceiptForm((current) => ({ ...current, quantity: '1', unitCost: '', note: '' }));
      await loadData();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  }

  async function actOnReceipt(receipt, action) {
    const actionName = action === 'confirm' ? 'xác nhận nhập kho' : 'hủy phiếu nhập';
    if (!window.confirm('Bạn có chắc muốn ' + actionName + ' ' + receipt.code + '?')) return;
    setError('');
    setSuccess('');
    try {
      const result = await dataRequest('/purchase-receipts/' + receipt.id + '/' + action, { method: 'POST' });
      setSuccess(result.message);
      await loadData();
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function createPromotion(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const result = await dataRequest('/promotions', {
        method: 'POST',
        body: {
          code: promotionForm.code.trim().toUpperCase(),
          discountType: promotionForm.discountType,
          discountValue: Number(promotionForm.discountValue),
          minimumOrder: Number(promotionForm.minimumOrder || 0),
          startAt: new Date(promotionForm.startAt).toISOString(),
          endAt: new Date(promotionForm.endAt).toISOString(),
          usageLimit: promotionForm.usageLimit === '' ? null : Number(promotionForm.usageLimit),
          isActive: true,
        },
      });
      setSuccess(result.message);
      setPromotionForm((current) => ({ ...current, code: '' }));
      await loadData();
    } catch (requestError) {
      setError(requestError.message || 'Không thể lưu khuyến mãi.');
    } finally {
      setSaving(false);
    }
  }

  async function togglePromotion(promotion) {
    if (!window.confirm((promotion.isActive ? 'Tắt' : 'Bật') + ' mã ' + promotion.code + '?')) return;
    try {
      const result = await dataRequest('/promotions/' + promotion.id, {
        method: 'PATCH', body: { isActive: !promotion.isActive },
      });
      setSuccess(result.message || 'Đã đổi trạng thái mã demo.');
      await loadData();
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  return (
    <div className="page-stack">
      <section className="welcome-row">
        <div><span className="eyebrow">OPERATIONS · SERVER DATA</span><h2>Nghiệp vụ bổ sung</h2><p>Phiếu nhập hàng, mã khuyến mãi và nhật ký hoạt động được lưu trong SQLite phía máy chủ.</p></div>
        <button className="button button-secondary" type="button" onClick={loadData} disabled={loading}><i className="bi bi-arrow-clockwise" aria-hidden="true" /> Làm mới</button>
      </section>
      <div className="catalog-switch" role="tablist" aria-label="Chọn nghiệp vụ bổ sung">
        <button className={'catalog-switch-button' + (activeTab === 'receipts' ? ' selected' : '')} type="button" role="tab" aria-selected={activeTab === 'receipts'} onClick={() => setActiveTab('receipts')}>Phiếu nhập hàng</button>
        <button className={'catalog-switch-button' + (activeTab === 'promotions' ? ' selected' : '')} type="button" role="tab" aria-selected={activeTab === 'promotions'} onClick={() => setActiveTab('promotions')}>Khuyến mãi</button>
        {user?.role === 'admin' && <button className={'catalog-switch-button' + (activeTab === 'history' ? ' selected' : '')} type="button" role="tab" aria-selected={activeTab === 'history'} onClick={() => setActiveTab('history')}>Nhật ký demo</button>}
      </div>
      {error && <ErrorNotice message={error} onRetry={loadData} />}
      {success && <div className="notice notice-success" role="status">{success}<button type="button" className="notice-close" aria-label="Đóng thông báo" onClick={() => setSuccess('')}><i className="bi bi-x-lg" aria-hidden="true" /></button></div>}
      {loading ? <div className="table-loading"><span className="loader" /> Đang tải dữ liệu demo...</div> : <>
        {activeTab === 'receipts' && <>
          {canManage && <section className="panel product-form-panel">
            <div className="panel-heading"><div><span className="eyebrow">PURCHASE RECEIPT</span><h3>Tạo phiếu nhập nháp</h3><p>Tồn kho chỉ tăng sau khi bạn xác nhận phiếu.</p></div></div>
            <form className="catalog-form catalog-form-supplier" onSubmit={createReceipt}>
              <div className="form-field"><label htmlFor="receipt-supplier">Nhà cung cấp</label><select id="receipt-supplier" value={receiptForm.supplierId} onChange={(event) => setReceiptForm((current) => ({ ...current, supplierId: event.target.value }))} required><option value="">Chọn nhà cung cấp</option>{suppliers.filter((item) => item.isActive !== false).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
              <div className="form-field"><label htmlFor="receipt-branch">Chi nhánh nhập</label><select id="receipt-branch" value={receiptForm.branchId} onChange={(event) => setReceiptForm((current) => ({ ...current, branchId: event.target.value }))} required>{branches.filter((item) => item.isActive !== false && (user?.role === 'admin' || Number(item.id) === Number(user?.branchId))).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
              <div className="form-field"><label htmlFor="receipt-product">Sản phẩm</label><select id="receipt-product" value={receiptForm.productId} onChange={(event) => setReceiptForm((current) => ({ ...current, productId: event.target.value, unitCost: '' }))} required>{products.filter((item) => item.isActive !== false).map((item) => <option key={item.id} value={item.id}>{item.sku} · {item.name}</option>)}</select></div>
              <div className="form-field"><label htmlFor="receipt-quantity">Số lượng</label><input id="receipt-quantity" type="number" min="1" step="1" value={receiptForm.quantity} onChange={(event) => setReceiptForm((current) => ({ ...current, quantity: event.target.value }))} required /></div>
              <div className="form-field"><label htmlFor="receipt-cost">Giá nhập / đơn vị (VND)</label><input id="receipt-cost" type="number" min="0" step="1" placeholder="Dùng giá vốn mẫu" value={receiptForm.unitCost} onChange={(event) => setReceiptForm((current) => ({ ...current, unitCost: event.target.value }))} /></div>
              <div className="form-field form-field-wide"><label htmlFor="receipt-note">Ghi chú</label><input id="receipt-note" value={receiptForm.note} onChange={(event) => setReceiptForm((current) => ({ ...current, note: event.target.value }))} maxLength="200" /></div>
              <div className="form-actions catalog-form-actions"><button className="button button-primary" type="submit" disabled={saving || !suppliers.length || !products.length}>{saving ? 'Đang lưu...' : 'Tạo phiếu nháp'}</button></div>
            </form>
          </section>}
          <section className="panel table-panel"><div className="table-toolbar"><div><h3>Lịch sử phiếu nhập</h3><p>{receipts.length} phiếu · Tồn kho chỉ đổi khi xác nhận</p></div></div>
            {!receipts.length ? <EmptyState title="Chưa có phiếu nhập" description="Tạo phiếu nhập nháp rồi xác nhận để tăng tồn kho demo." /> : <div className="table-scroll"><table><thead><tr><th>MÃ PHIẾU</th><th>NHÀ CUNG CẤP</th><th>CHI NHÁNH</th><th>SL DÒNG</th><th>TỔNG TIỀN</th><th>TRẠNG THÁI</th><th>THAO TÁC</th></tr></thead><tbody>{receipts.map((receipt) => <tr key={receipt.id}><td><strong>{receipt.code}</strong></td><td>{receipt.supplierName}</td><td>{receipt.branchName || branches.find((item) => item.id === receipt.branchId)?.name || '—'}</td><td>{(receipt.items || []).reduce((sum, item) => sum + Number(item.quantity || 0), 0)}</td><td>{formatMoney(receipt.totalAmount)}</td><td><span className={'status-tag ' + (receipt.status === 'confirmed' ? 'status-active' : '')}>{receipt.status === 'draft' ? 'Nháp' : receipt.status === 'confirmed' ? 'Đã nhập kho' : 'Đã hủy'}</span></td><td><div className="row-actions">{canManage && receipt.status === 'draft' && <><button type="button" className="table-action" onClick={() => actOnReceipt(receipt, 'confirm')}>Xác nhận</button><button type="button" className="table-action table-action-danger" onClick={() => actOnReceipt(receipt, 'cancel')}>Hủy</button></>}</div></td></tr>)}</tbody></table></div>}
          </section>
          <p className="page-note">Đây là dữ liệu mô phỏng. Máy chủ kiểm tra tồn kho và xử lý cập nhật trong giao dịch; chưa thay thế quy trình vận hành và đối soát của hệ thống bán lẻ thực tế.</p>
        </>}
        {activeTab === 'promotions' && <>
          {canManage && <section className="panel product-form-panel">
            <div className="panel-heading"><div><span className="eyebrow">PROMOTION RULES</span><h3>Tạo mã khuyến mãi demo</h3></div></div>
            <form className="catalog-form catalog-form-supplier" onSubmit={createPromotion}>
              <div className="form-field"><label htmlFor="promotion-code">Mã khuyến mãi</label><input id="promotion-code" value={promotionForm.code} onChange={(event) => setPromotionForm((current) => ({ ...current, code: event.target.value.toUpperCase() }))} maxLength="32" required /></div>
              <div className="form-field"><label htmlFor="promotion-type">Kiểu giảm</label><select id="promotion-type" value={promotionForm.discountType} onChange={(event) => setPromotionForm((current) => ({ ...current, discountType: event.target.value }))}><option value="percent">Phần trăm (%)</option><option value="amount">Số tiền (VND)</option></select></div>
              <div className="form-field"><label htmlFor="promotion-value">Mức giảm</label><input id="promotion-value" type="number" min="1" step="1" value={promotionForm.discountValue} onChange={(event) => setPromotionForm((current) => ({ ...current, discountValue: event.target.value }))} required /></div>
              <div className="form-field"><label htmlFor="promotion-minimum">Đơn tối thiểu (VND)</label><input id="promotion-minimum" type="number" min="0" step="1" value={promotionForm.minimumOrder} onChange={(event) => setPromotionForm((current) => ({ ...current, minimumOrder: event.target.value }))} required /></div>
              <div className="form-field"><label htmlFor="promotion-start">Bắt đầu</label><input id="promotion-start" type="datetime-local" value={promotionForm.startAt} onChange={(event) => setPromotionForm((current) => ({ ...current, startAt: event.target.value }))} required /></div>
              <div className="form-field"><label htmlFor="promotion-end">Kết thúc</label><input id="promotion-end" type="datetime-local" value={promotionForm.endAt} onChange={(event) => setPromotionForm((current) => ({ ...current, endAt: event.target.value }))} required /></div>
              <div className="form-field"><label htmlFor="promotion-usage">Giới hạn lượt dùng (tùy chọn)</label><input id="promotion-usage" type="number" min="1" step="1" value={promotionForm.usageLimit} onChange={(event) => setPromotionForm((current) => ({ ...current, usageLimit: event.target.value }))} /></div>
              <div className="form-actions catalog-form-actions"><button className="button button-primary" type="submit" disabled={saving}>{saving ? 'Đang lưu...' : 'Tạo mã demo'}</button></div>
            </form>
          </section>}
          <section className="panel table-panel"><div className="table-toolbar"><div><h3>Mã khuyến mãi</h3><p>{promotions.length} mã trong dữ liệu demo</p></div></div>
            {!promotions.length ? <EmptyState title="Chưa có mã khuyến mãi" description="Tạo mã ở phía trên; khi lập đơn demo, nhập mã để áp dụng giảm giá." /> : <div className="table-scroll"><table><thead><tr><th>MÃ</th><th>KIỂU GIẢM</th><th>MỨC GIẢM</th><th>ĐƠN TỐI THIỂU</th><th>THỜI HẠN</th><th>LƯỢT DÙNG</th><th>TRẠNG THÁI</th><th></th></tr></thead><tbody>{promotions.map((promotion) => <tr key={promotion.id}><td><strong>{promotion.code}</strong></td><td>{promotion.discountType === 'percent' ? 'Phần trăm' : 'Số tiền'}</td><td>{promotion.discountType === 'percent' ? promotion.discountValue + '%' : formatMoney(promotion.discountValue)}</td><td>{formatMoney(promotion.minimumOrder)}</td><td>{new Date(promotion.startAt).toLocaleDateString('vi-VN')} – {new Date(promotion.endAt).toLocaleDateString('vi-VN')}</td><td>{promotion.usedCount || 0}{promotion.usageLimit ? ' / ' + promotion.usageLimit : ''}</td><td><span className={'status-tag ' + (promotion.isActive ? 'status-active' : 'status-inactive')}>{promotion.isActive ? 'Đang bật' : 'Đã tắt'}</span></td><td>{canManage && <button type="button" className="table-action" onClick={() => togglePromotion(promotion)}>{promotion.isActive ? 'Tắt' : 'Bật'}</button>}</td></tr>)}</tbody></table></div>}
          </section>
          <p className="page-note">Khuyến mãi được lưu cục bộ và chỉ áp dụng trong hóa đơn demo. Không có thanh toán hoặc giảm giá tiền thật.</p>
        </>}
        {activeTab === 'history' && user?.role === 'admin' && <section className="panel table-panel"><div className="table-toolbar"><div><h3>Nhật ký hoạt động demo</h3><p>{auditLogs.length} sự kiện được ghi trong dữ liệu hiện tại</p></div></div>{!auditLogs.length ? <EmptyState title="Chưa có sự kiện" description="Các thao tác nghiệp vụ được hỗ trợ sẽ xuất hiện tại đây." /> : <div className="table-scroll"><table><thead><tr><th>THỜI GIAN</th><th>NGƯỜI DÙNG DEMO</th><th>HÀNH ĐỘNG</th><th>CHI TIẾT</th></tr></thead><tbody>{auditLogs.map((entry) => <tr key={entry.id}><td>{new Date(entry.createdAt).toLocaleString('vi-VN')}</td><td>{entry.username}</td><td>{entry.action}</td><td><code>{JSON.stringify(entry.details || {})}</code></td></tr>)}</tbody></table></div>}</section>}
      </>}
    </div>
  );
}

const SUPPORT_STATUS_LABELS = {
  new: 'Mới tiếp nhận',
  in_progress: 'Đang xử lý',
  waiting_customer: 'Chờ khách phản hồi',
  resolved: 'Đã giải quyết',
  closed: 'Đã đóng',
};

const SUPPORT_CATEGORY_LABELS = {
  payment_qr: 'QR / thanh toán',
  payment_pending: 'Đã trả tiền, đơn chưa cập nhật',
  payment_mismatch: 'Sai số tiền / nội dung',
  website_error: 'Lỗi website / kết nối',
  order_delivery: 'Đơn hàng / giao hàng',
  product: 'Sản phẩm',
  other: 'Vấn đề khác',
};

export function SupportInboxPage({ user }) {
  const [requests, setRequests] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [status, setStatus] = useState('in_progress');
  const [publicReply, setPublicReply] = useState('');
  const [internalNote, setInternalNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  async function loadRequests() {
    setLoading(true);
    setError('');
    try {
      const result = await dataRequest('/support/requests?page=1&pageSize=100');
      const rows = Array.isArray(result.data) ? result.data : [];
      setRequests(rows);
      if (selectedId && !rows.some((item) => item.id === selectedId)) setSelectedId(null);
    } catch (requestError) {
      setError(requestError.message || 'Không tải được hộp thư hỗ trợ.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadRequests(); }, []);

  const selected = requests.find((item) => item.id === selectedId) || null;
  function selectRequest(request) {
    setSelectedId(request.id);
    setStatus(request.status || 'new');
    setPublicReply(request.publicReply || '');
    setInternalNote(request.internalNote || '');
    setSuccess('');
  }

  async function saveReply(event) {
    event.preventDefault();
    if (!selected) return;
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const result = await dataRequest(`/support/requests/${selected.id}`, {
        method: 'PATCH', body: { status, publicReply, internalNote },
      });
      setSuccess(result.message || 'Đã cập nhật yêu cầu hỗ trợ.');
      await loadRequests();
    } catch (requestError) {
      setError(requestError.message || 'Không thể cập nhật yêu cầu hỗ trợ.');
    } finally {
      setSaving(false);
    }
  }

  return <div className="page-stack support-inbox-page">
    <section className="welcome-row"><div><span className="eyebrow">CUSTOMER CARE · SUPPORT DESK</span><h2>Hỗ trợ khách hàng</h2><p>Tiếp nhận sự cố QR, thanh toán, kết nối website, đơn hàng và phản hồi công khai cho khách.</p></div><button className="button button-secondary" type="button" onClick={loadRequests} disabled={loading}><i className="bi bi-arrow-clockwise" aria-hidden="true" /> Làm mới</button></section>
    {error && <ErrorNotice message={error} onRetry={loadRequests} />}
    {success && <div className="notice notice-success" role="status">{success}</div>}
    <div className="support-inbox-layout">
      <section className="panel support-inbox-list" aria-label="Danh sách yêu cầu hỗ trợ">
        <div className="table-toolbar"><div><h3>Yêu cầu mới nhất</h3><p>{requests.length} yêu cầu trong hệ thống</p></div></div>
        {loading ? <div className="table-loading"><span className="loader" /> Đang tải yêu cầu...</div>
          : !requests.length ? <EmptyState title="Chưa có yêu cầu hỗ trợ" description="Yêu cầu từ Trung tâm trợ giúp của khách hàng sẽ xuất hiện tại đây." />
            : <div className="support-inbox-items">{requests.map((request) => <button key={request.id} type="button" className={'support-inbox-item' + (selectedId === request.id ? ' is-selected' : '')} onClick={() => selectRequest(request)}>
              <span className="support-inbox-item-top"><strong>{request.caseCode}</strong><small>{new Date(request.createdAt).toLocaleString('vi-VN')}</small></span>
              <strong>{request.fullName} · {request.phone}</strong>
              <span>{SUPPORT_CATEGORY_LABELS[request.category] || 'Vấn đề khác'}{request.orderCode ? ` · ${request.orderCode}` : ''}</span>
              <small className="support-inbox-item-status">{SUPPORT_STATUS_LABELS[request.status] || request.status}</small>
            </button>)}</div>}
      </section>
      <section className="panel support-inbox-detail" aria-label="Chi tiết yêu cầu hỗ trợ">
        {!selected ? <EmptyState title="Chọn một yêu cầu" description="Thông tin đơn hàng, nội dung khách gửi và lịch sử phản hồi sẽ hiển thị ở đây." /> : <>
          <div className="panel-heading"><div><span className="eyebrow">{selected.caseCode}</span><h3>{SUPPORT_CATEGORY_LABELS[selected.category] || 'Vấn đề khác'}</h3><p>Tiếp nhận lúc {new Date(selected.createdAt).toLocaleString('vi-VN')}</p></div><span className="status-tag">{SUPPORT_STATUS_LABELS[selected.status] || selected.status}</span></div>
          <div className="support-customer-summary"><div><span>Khách hàng</span><strong>{selected.fullName}</strong></div><div><span>Điện thoại</span><strong>{selected.phone}</strong></div><div><span>Mã đơn</span><strong>{selected.orderCode || 'Không cung cấp'}</strong></div><div><span>Email</span><strong>{selected.email || 'Không cung cấp'}</strong></div></div>
          <div className="support-customer-message"><strong>Nội dung khách gửi</strong><p>{selected.message}</p></div>
          <form className="form-stack support-reply-form" onSubmit={saveReply}>
            <div className="form-field"><label htmlFor="support-status">Trạng thái xử lý</label><select id="support-status" value={status} onChange={(event) => setStatus(event.target.value)}>{Object.entries(SUPPORT_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
            <div className="form-field"><label htmlFor="support-public-reply">Phản hồi gửi cho khách</label><textarea id="support-public-reply" rows={4} maxLength={2000} value={publicReply} onChange={(event) => setPublicReply(event.target.value)} placeholder="Ví dụ: Cửa hàng đã nhận thông tin. Vui lòng không thanh toán lần hai trong khi chúng tôi đối soát..." /><small>Nội dung này khách có thể xem khi tra cứu mã hỗ trợ.</small></div>
            <div className="form-field"><label htmlFor="support-internal-note">Ghi chú nội bộ</label><textarea id="support-internal-note" rows={3} maxLength={2000} value={internalNote} onChange={(event) => setInternalNote(event.target.value)} placeholder="Thông tin bàn giao, mã giao dịch, kết quả kiểm tra nội bộ..." /></div>
            <div className="form-actions"><button className="button button-primary" type="submit" disabled={saving}>{saving ? 'Đang lưu...' : 'Lưu phản hồi và trạng thái'}</button></div>
          </form>
        </>}
      </section>
    </div>
    <p className="page-note">Yêu cầu và phản hồi được lưu trong SQLite. Không nhập mật khẩu, mã OTP, số thẻ hoặc thông tin đăng nhập ngân hàng vào ghi chú hỗ trợ.</p>
  </div>;
}

// Công cụ vận hành dành riêng cho quản trị viên: nhật ký, chẩn đoán storage và backup có kiểm tra.
export function SystemAdminPage() {
  const [diagnostics, setDiagnostics] = useState({ mode: 'server', storage: 'loading', persistent: false, recordCounts: {}, recordCount: 0, storageNotice: '' });
  const [auditLogs, setAuditLogs] = useState([]);
  const [auditSearch, setAuditSearch] = useState('');
  const [bankAccounts, setBankAccounts] = useState([]);
  const [bankFormOpen, setBankFormOpen] = useState(false);
  const [bankEditingId, setBankEditingId] = useState(null);
  const [bankForm, setBankForm] = useState({ bankCode: '', bankName: '', accountNumber: '', accountName: '' });
  const [bankSaving, setBankSaving] = useState(false);
  const [pendingBackup, setPendingBackup] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  async function loadAuditLogs() {
    setLoading(true);
    setError('');
    try {
      const [result, serverDiagnostics, bankResult] = await Promise.all([
        dataRequest('/audit-logs?page=1&pageSize=100'),
        dataRequest('/system/diagnostics'),
        dataRequest('/system/bank-accounts'),
      ]);
      setAuditLogs(Array.isArray(result.data) ? result.data : []);
      setDiagnostics(serverDiagnostics);
      const nextBankAccounts = Array.isArray(bankResult.data) ? bankResult.data : [];
      setBankAccounts(nextBankAccounts);
      // Mở sẵn biểu mẫu khi hệ thống chưa khai báo tài khoản nhận tiền đầu tiên.
      if (nextBankAccounts.length === 0) {
        setBankEditingId(null);
        setBankForm({ bankCode: '', bankName: '', accountNumber: '', accountName: '' });
        setBankFormOpen(true);
      }
    } catch (requestError) {
      setAuditLogs([]);
      setError(requestError.message || 'Không thể đọc nhật ký hệ thống demo.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadAuditLogs(); }, []);

  function openNewBankAccount() {
    setBankEditingId(null);
    setBankForm({ bankCode: '', bankName: '', accountNumber: '', accountName: '' });
    setBankFormOpen(true);
    setError('');
  }

  function openEditBankAccount(account) {
    setBankEditingId(account.id);
    setBankForm({
      bankCode: account.bankCode || '',
      bankName: account.bankName || '',
      accountNumber: account.accountNumber || '',
      accountName: account.accountName || '',
    });
    setBankFormOpen(true);
    setError('');
  }

  async function saveBankAccount(event) {
    event.preventDefault();
    setBankSaving(true);
    setError('');
    setSuccess('');
    try {
      const result = await dataRequest(
        bankEditingId ? `/system/bank-accounts/${bankEditingId}` : '/system/bank-accounts',
        { method: bankEditingId ? 'PATCH' : 'POST', body: bankForm },
      );
      setBankFormOpen(false);
      setBankEditingId(null);
      await loadAuditLogs();
      setSuccess(result.message || 'Đã lưu cấu hình tài khoản ngân hàng.');
    } catch (requestError) {
      setError(requestError.message || 'Không thể lưu tài khoản ngân hàng.');
    } finally {
      setBankSaving(false);
    }
  }

  async function setBankAccountActive(account, isActive) {
    const prompt = isActive
      ? `Chuyển tài khoản VietQR đang nhận tiền sang ${account.bankName} · ${account.accountNumber}? QR mới sẽ dùng tài khoản này.`
      : `Ngừng sử dụng ${account.bankName} · ${account.accountNumber}? Checkout VietQR sẽ tạm bị tắt nếu không còn tài khoản nào hoạt động.`;
    if (!window.confirm(prompt)) return;
    setBankSaving(true);
    setError('');
    setSuccess('');
    try {
      const result = await dataRequest(`/system/bank-accounts/${account.id}`, {
        method: 'PATCH', body: { isActive },
      });
      await loadAuditLogs();
      setSuccess(result.message || 'Đã cập nhật trạng thái tài khoản ngân hàng.');
    } catch (requestError) {
      setError(requestError.message || 'Không thể cập nhật tài khoản ngân hàng.');
    } finally {
      setBankSaving(false);
    }
  }

  async function deleteBankAccount(account) {
    if (!window.confirm(`Xóa ${account.bankName} · ${account.accountNumber} khỏi cấu hình VietQR? Các mã QR đã tạo trước đó không thay đổi.`)) return;
    setBankSaving(true);
    setError('');
    setSuccess('');
    try {
      const result = await dataRequest(`/system/bank-accounts/${account.id}`, { method: 'DELETE' });
      await loadAuditLogs();
      setSuccess(result.message || 'Đã xóa tài khoản ngân hàng.');
    } catch (requestError) {
      setError(requestError.message || 'Không thể xóa tài khoản ngân hàng.');
    } finally {
      setBankSaving(false);
    }
  }

  async function exportBackup() {
    setError('');
    setSuccess('');
    try {
      const passphrase = window.prompt('Tạo mật khẩu mã hóa backup (12–200 ký tự). Hãy lưu mật khẩu riêng; không thể khôi phục file nếu quên mật khẩu.');
      if (passphrase === null) return;
      const confirmation = window.prompt('Nhập lại mật khẩu mã hóa backup để xác nhận.');
      if (confirmation === null) return;
      if (passphrase !== confirmation) throw new Error('Hai lần nhập mật khẩu mã hóa không khớp.');
      const backup = await dataRequest('/system/backup', { method: 'POST', body: {} });
      const encrypted = await encryptBackupPayload(backup, passphrase);
      const url = URL.createObjectURL(new Blob([encrypted], { type: 'application/json;charset=utf-8' }));
      const anchor = document.createElement('a');
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      anchor.href = url;
      anchor.download = `emsystems-backup-${stamp}.emsbackup`;
      anchor.click();
      URL.revokeObjectURL(url);
      setSuccess(backup.storageSaved
        ? `Đã tạo backup AES-256-GCM với ${backup.recordCounts.products} sản phẩm và ${backup.recordCounts.sales} đơn bán hàng.`
        : 'Đã mã hóa và xuất backup; nhật ký thao tác chưa được xác nhận lưu bền vững trên máy chủ.');
      setDiagnostics(await dataRequest('/system/diagnostics'));
      loadAuditLogs();
    } catch (exportError) {
      setError(exportError.message || 'Không thể tạo bản sao lưu.');
    }
  }

  async function inspectBackup(event) {
    const file = event.target.files?.[0];
    setPendingBackup(null);
    setError('');
    setSuccess('');
    if (!file) return;
    if (file.size > 36 * 1024 * 1024) {
      setError('File sao lưu vượt giới hạn 36 MB.');
      event.target.value = '';
      return;
    }

    try {
      const envelope = JSON.parse(await file.text());
      let parsed;
      if (envelope?.format === 'emsystems-encrypted-backup') {
        const passphrase = window.prompt('Nhập mật khẩu dùng khi mã hóa file backup này.');
        if (passphrase === null) { event.target.value = ''; return; }
        parsed = await decryptBackupPayload(envelope, passphrase);
      } else if (envelope?.format === 'emsystems-data-backup') {
        if (!window.confirm('Đây là backup JSON cũ chưa mã hóa. File có thể chứa thông tin khách hàng và giao dịch. Chỉ tiếp tục nếu bạn tin cậy nguồn file.')) {
          event.target.value = '';
          return;
        }
        parsed = envelope;
      } else {
        throw new Error('Định dạng backup không hợp lệ.');
      }
      const validation = await dataRequest('/system/backup/validate', { method: 'POST', body: { backup: parsed } });
      if (!validation.valid) {
        setError(validation.error);
        event.target.value = '';
        return;
      }
      setPendingBackup({ fileName: file.name, payload: parsed, validation });
      setSuccess('File đã qua kiểm tra cấu trúc và liên kết cơ bản. Dữ liệu hiện tại vẫn chưa thay đổi.');
    } catch (readError) {
      setError(readError.message || 'Không đọc/giải mã được file backup EMSystems.');
      event.target.value = '';
    }
  }

  async function applyBackup() {
    if (!pendingBackup) return;
    const confirmed = window.confirm(
      `Khôi phục ${pendingBackup.fileName}? Dữ liệu nghiệp vụ trên máy chủ sẽ bị thay bằng bản sao lưu này. Tất cả phiên đăng nhập sẽ bị thu hồi. Hãy xuất backup hiện tại trước khi tiếp tục.`,
    );
    if (!confirmed) return;

    setBusy(true);
    setError('');
    try {
      await dataRequest('/system/backup/restore', { method: 'POST', body: { backup: pendingBackup.payload } });
      window.location.reload();
    } catch (restoreError) {
      setError(restoreError.message || 'Không thể khôi phục bản sao lưu.');
      try { setDiagnostics(await dataRequest('/system/diagnostics')); } catch { /* Keep prior diagnostics if the API is unavailable. */ }
    } finally {
      setBusy(false);
    }
  }

  const filteredLogs = auditLogs.filter((entry) => {
    const haystack = [entry.username, entry.action, JSON.stringify(entry.details || {})].join(' ').toLocaleLowerCase('vi');
    return haystack.includes(auditSearch.trim().toLocaleLowerCase('vi'));
  });
  const storageLabel = diagnostics.persistent
    ? 'SQLite phía máy chủ đang ghi được'
    : diagnostics.storage === 'unavailable'
      ? 'Không đọc được lưu trữ máy chủ'
      : 'Chưa xác minh lưu trữ máy chủ';

  return (
    <div className="page-stack system-admin-page">
      <section className="welcome-row">
        <div>
          <span className="eyebrow">SYSTEM OPERATIONS · ADMIN ONLY</span>
          <h2>Quản trị hệ thống</h2>
          <p>Theo dõi nhật ký thao tác, kiểm tra tình trạng lưu trữ và quản lý bản sao lưu dữ liệu demo.</p>
        </div>
        <button type="button" className="button button-secondary" onClick={loadAuditLogs} disabled={loading}>
          <i className="bi bi-arrow-clockwise" aria-hidden="true" /> Làm mới
        </button>
      </section>

      {error && <ErrorNotice message={error} />}
      {success && <div className="notice notice-success" role="status"><span>{success}</span><button type="button" className="notice-close" aria-label="Đóng thông báo" onClick={() => setSuccess('')}><i className="bi bi-x-lg" aria-hidden="true" /></button></div>}

      <section className="panel panel-main system-bank-panel">
        <div className="panel-heading system-bank-heading">
          <div>
            <span className="eyebrow">VIETQR · BANK TRANSFER</span>
            <h3>Tài khoản ngân hàng nhận tiền</h3>
            <p>Quản lý ngân hàng, số tài khoản và tên chủ tài khoản dùng để tự tạo mã QR tại checkout.</p>
          </div>
          <button type="button" className="button button-primary" onClick={openNewBankAccount} disabled={bankSaving}>
            <i className="bi bi-plus-lg" aria-hidden="true" /> Thêm tài khoản
          </button>
        </div>

        <div className="system-bank-active-note">
          <i className="bi bi-shield-check" aria-hidden="true" />
          <span>Chỉ một tài khoản được kích hoạt làm nơi nhận tiền VietQR. Tài khoản đang hoạt động sẽ được dùng cho các QR tạo mới; QR đã phát hành trước đó giữ nguyên thông tin cũ.</span>
        </div>

        {bankFormOpen && <form className="system-bank-form" onSubmit={saveBankAccount}>
          <div className="system-bank-form-heading">
            <div><strong>{bankEditingId ? 'Chỉnh sửa tài khoản ngân hàng' : 'Khai báo tài khoản ngân hàng mới'}</strong><p>Nhập đúng thông tin theo ngân hàng nhận tiền của EMSystems.</p></div>
            <button type="button" className="icon-button" aria-label="Đóng biểu mẫu" onClick={() => setBankFormOpen(false)}><i className="bi bi-x-lg" aria-hidden="true" /></button>
          </div>
          <div className="system-bank-form-grid">
            <div className="form-field"><label htmlFor="system-bank-code">Mã ngân hàng / BANK ID</label><input id="system-bank-code" value={bankForm.bankCode} onChange={(event) => setBankForm((current) => ({ ...current, bankCode: event.target.value.toUpperCase() }))} placeholder="Ví dụ: MB hoặc mã BIN" minLength={2} maxLength={30} autoComplete="off" required /><small>Mã ngân hàng VietQR chấp nhận, có thể là mã viết tắt hoặc BIN.</small></div>
            <div className="form-field"><label htmlFor="system-bank-name">Tên ngân hàng</label><input id="system-bank-name" value={bankForm.bankName} onChange={(event) => setBankForm((current) => ({ ...current, bankName: event.target.value }))} placeholder="Ví dụ: MB Bank" minLength={2} maxLength={100} required /></div>
            <div className="form-field"><label htmlFor="system-bank-account-number">Số tài khoản nhận tiền</label><input id="system-bank-account-number" value={bankForm.accountNumber} onChange={(event) => setBankForm((current) => ({ ...current, accountNumber: event.target.value.replace(/\D/g, '').slice(0, 19) }))} placeholder="Nhập số tài khoản" inputMode="numeric" autoComplete="off" minLength={6} maxLength={19} required /></div>
            <div className="form-field"><label htmlFor="system-bank-account-name">Tên chủ tài khoản</label><input id="system-bank-account-name" value={bankForm.accountName} onChange={(event) => setBankForm((current) => ({ ...current, accountName: event.target.value.toLocaleUpperCase('vi') }))} placeholder="Tên chính xác trên ngân hàng" minLength={2} maxLength={100} autoComplete="off" required /></div>
          </div>
          <div className="form-actions system-bank-form-actions">
            <button type="submit" className="button button-primary" disabled={bankSaving}>{bankSaving ? 'Đang lưu...' : bankEditingId ? 'Lưu thay đổi' : 'Lưu tài khoản'}</button>
            <button type="button" className="button button-secondary" onClick={() => setBankFormOpen(false)} disabled={bankSaving}>Hủy</button>
          </div>
        </form>}

        {bankAccounts.length === 0 ? <EmptyState title="Chưa có tài khoản ngân hàng" description="Thêm tài khoản nhận tiền để bật phương thức chuyển khoản VietQR ở trang thanh toán." action={<button type="button" className="button button-primary" onClick={openNewBankAccount}>Khai báo tài khoản đầu tiên</button>} /> : <div className="table-scroll system-bank-table-wrap">
          <table className="system-bank-table">
            <thead><tr><th>NGÂN HÀNG</th><th>SỐ TÀI KHOẢN</th><th>CHỦ TÀI KHOẢN</th><th>TRẠNG THÁI</th><th>THAO TÁC</th></tr></thead>
            <tbody>{bankAccounts.map((account) => <tr key={account.id}>
              <td><strong>{account.bankName}</strong><small className="system-bank-code">{account.bankCode}</small></td>
              <td><code className="system-bank-number">{account.accountNumber}</code></td>
              <td>{account.accountName}</td>
              <td>{account.isActive ? <span className="system-bank-status is-active"><i className="bi bi-check-circle-fill" aria-hidden="true" /> Đang nhận tiền</span> : <span className="system-bank-status">Chưa kích hoạt</span>}</td>
              <td><div className="row-actions system-bank-actions">
                <button type="button" className="table-action" onClick={() => openEditBankAccount(account)} disabled={bankSaving}>Sửa</button>
                {account.isActive
                  ? <button type="button" className="table-action table-action-danger" onClick={() => setBankAccountActive(account, false)} disabled={bankSaving}>Ngừng dùng</button>
                  : <button type="button" className="table-action" onClick={() => setBankAccountActive(account, true)} disabled={bankSaving}>Kích hoạt</button>}
                <button type="button" className="table-action table-action-danger" onClick={() => deleteBankAccount(account)} disabled={bankSaving}>Xóa</button>
              </div></td>
            </tr>)}</tbody>
          </table>
        </div>}
        <p className="page-note system-bank-footnote">Thông tin tài khoản được lưu trong SQLite phía máy chủ. Khóa bí mật thanh toán không được lưu ở màn hình này; payment service lấy riêng tài khoản đang kích hoạt qua kênh nội bộ có xác thực.</p>
      </section>

      {diagnostics.storageNotice ? <div className="notice notice-error" role="alert">{diagnostics.storageNotice}</div> : null}
      <section className="system-status-grid" aria-label="Tình trạng lưu trữ">
        <article className="panel system-status-card">
          <span className="system-status-icon"><i className="bi bi-database-check" aria-hidden="true" /></span>
          <div><small>Trạng thái lưu trữ</small><strong>{storageLabel}</strong><p>{diagnostics.storage === 'sqlite' ? 'Dữ liệu nghiệp vụ và cấu hình tài khoản ngân hàng được lưu trong SQLite trên máy chủ.' : 'Hãy kiểm tra trạng thái backend và tạo bản sao lưu trước khi vận hành.'}</p></div>
        </article>
        <article className="panel system-status-card">
          <span className="system-status-icon"><i className="bi bi-collection" aria-hidden="true" /></span>
          <div><small>Tổng bản ghi</small><strong>{Number(diagnostics.recordCount || 0).toLocaleString('vi-VN')}</strong><p>Schema dữ liệu: v{diagnostics.schemaVersion} · Ước lượng {diagnostics.estimatedSizeKB} KB.</p></div>
        </article>
        <article className="panel system-status-card">
          <span className="system-status-icon"><i className="bi bi-clock-history" aria-hidden="true" /></span>
          <div><small>Hoạt động gần nhất</small><strong>{diagnostics.lastActivityAt ? new Date(diagnostics.lastActivityAt).toLocaleString('vi-VN') : 'Chưa có nhật ký'}</strong><p>Thời điểm lấy từ nhật ký thao tác được lưu trong hệ thống.</p></div>
        </article>
      </section>

      <section className="panel panel-main system-backup-panel">
        <div className="panel-heading">
          <div><span className="eyebrow">BACKUP & RECOVERY</span><h3>Sao lưu và khôi phục</h3><p>File JSON có version, kiểm tra cấu trúc, ID, SKU và liên kết tồn kho trước khi khôi phục.</p></div>
          <i className="bi bi-shield-lock system-panel-icon" aria-hidden="true" />
        </div>
        <div className="system-backup-actions">
          <button type="button" className="button button-primary" onClick={exportBackup}><i className="bi bi-download" aria-hidden="true" /> Xuất bản sao lưu JSON</button>
          <label className="button button-secondary system-file-label"><i className="bi bi-file-earmark-arrow-up" aria-hidden="true" /> Chọn file để kiểm tra<input type="file" accept=".json,application/json" onChange={inspectBackup} /></label>
        </div>
        {pendingBackup && <div className="system-backup-preview">
          <div><strong>{pendingBackup.fileName}</strong><p>Tạo lúc: {pendingBackup.validation.createdAt ? new Date(pendingBackup.validation.createdAt).toLocaleString('vi-VN') : 'Không ghi trong file'} · Schema v{pendingBackup.validation.schemaVersion} · {pendingBackup.validation.recordCount.toLocaleString('vi-VN')} bản ghi</p><p>Chưa thay đổi dữ liệu hiện tại. Khôi phục sẽ ghi đè dữ liệu máy chủ và kết thúc phiên đăng nhập.</p></div>
          <button type="button" className="button button-primary" disabled={busy} onClick={applyBackup}><i className="bi bi-arrow-counterclockwise" aria-hidden="true" /> {busy ? 'Đang khôi phục…' : 'Xác nhận khôi phục'}</button>
        </div>}
        <p className="page-note">Bản sao lưu được mã hóa AES-256-GCM trước khi xuất. File chứa dữ liệu khách hàng, tài khoản ngân hàng và lịch sử giao dịch; cất file và mật khẩu ở hai nơi riêng biệt. File JSON cũ chưa mã hóa chỉ được nhập sau xác nhận cảnh báo.</p>
      </section>

      <section className="panel table-panel system-audit-panel">
        <div className="table-toolbar"><div><span className="eyebrow">AUDIT TRAIL</span><h3>Nhật ký thao tác</h3><p>Hiển thị tối đa 100 sự kiện gần nhất do các luồng nghiệp vụ hiện có ghi nhận.</p></div><label className="system-audit-search"><i className="bi bi-search" aria-hidden="true" /><input value={auditSearch} onChange={(event) => setAuditSearch(event.target.value)} placeholder="Lọc người dùng, hành động…" aria-label="Lọc nhật ký" /></label></div>
        {loading ? <div className="table-loading"><span className="loader" /> Đang tải nhật ký...</div> : filteredLogs.length === 0 ? <EmptyState title="Không có sự kiện phù hợp" description={auditLogs.length ? 'Thử đổi từ khóa lọc.' : 'Các thao tác nghiệp vụ được hỗ trợ sẽ xuất hiện khi phát sinh sự kiện.'} /> : <div className="table-scroll"><table><thead><tr><th>THỜI GIAN</th><th>NGƯỜI DÙNG DEMO</th><th>HÀNH ĐỘNG</th><th>CHI TIẾT</th></tr></thead><tbody>{filteredLogs.map((entry) => <tr key={entry.id}><td>{Number.isFinite(Date.parse(entry.createdAt)) ? new Date(entry.createdAt).toLocaleString('vi-VN') : '—'}</td><td>{entry.username || 'demo'}</td><td><code>{entry.action}</code></td><td className="system-audit-details">{Object.entries(entry.details || {}).map(([key, value]) => `${key}: ${String(value)}`).join(' · ') || '—'}</td></tr>)}</tbody></table></div>}
        <p className="page-note">Nhật ký được lưu cùng snapshot nghiệp vụ trong SQLite. Đây là nhật ký vận hành của ứng dụng, chưa phải hệ thống audit log chống giả mạo độc lập.</p>
      </section>
    </div>
  );
}

