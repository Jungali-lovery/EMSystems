import { lazy, Suspense, useEffect, useState } from 'react';
import { Navigate, NavLink, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { dataRequest } from './api-client.js';
import { canAccessAdminRoute, CTV_ROLES, getPortalForRole, toCanonicalWorkspacePath } from './access-control.js';
import emsystemsLogo from './picture/emsystems-logo.webp';

// Tải từng trang khi cần để giao diện khởi động gọn và nhanh hơn.
const DashboardPage = lazy(() => import('./pages.jsx').then((module) => ({ default: module.DashboardPage })));
const LoginPage = lazy(() => import('./pages.jsx').then((module) => ({ default: module.LoginPage })));
const RegisterPage = lazy(() => import('./pages.jsx').then((module) => ({ default: module.RegisterPage })));
const ChangePasswordPage = lazy(() => import('./pages.jsx').then((module) => ({ default: module.ChangePasswordPage })));
const ForgotPasswordPage = lazy(() => import('./pages.jsx').then((module) => ({ default: module.ForgotPasswordPage })));
const ResetPasswordPage = lazy(() => import('./pages.jsx').then((module) => ({ default: module.ResetPasswordPage })));
const LegalPolicyPage = lazy(() => import('./pages.jsx').then((module) => ({ default: module.LegalPolicyPage })));
const PaymentDemoPage = lazy(() => import('./pages.jsx').then((module) => ({ default: module.PaymentDemoPage })));
const PaymentResultPage = lazy(() => import('./pages.jsx').then((module) => ({ default: module.PaymentResultPage })));
const ModulePage = lazy(() => import('./pages.jsx').then((module) => ({ default: module.ModulePage })));
const ProductsPage = lazy(() => import('./pages.jsx').then((module) => ({ default: module.ProductsPage })));
const CatalogsPage = lazy(() => import('./pages.jsx').then((module) => ({ default: module.CatalogsPage })));
const InventoryPage = lazy(() => import('./pages.jsx').then((module) => ({ default: module.InventoryPage })));
const BranchesPage = lazy(() => import('./pages.jsx').then((module) => ({ default: module.BranchesPage })));
const UsersPage = lazy(() => import('./pages.jsx').then((module) => ({ default: module.UsersPage })));
const SalesPage = lazy(() => import('./pages.jsx').then((module) => ({ default: module.SalesPage })));
const CustomersPage = lazy(() => import('./pages.jsx').then((module) => ({ default: module.CustomersPage })));
const WarrantiesPage = lazy(() => import('./pages.jsx').then((module) => ({ default: module.WarrantiesPage })));
const ReportsPage = lazy(() => import('./pages.jsx').then((module) => ({ default: module.ReportsPage })));
const StockCountsPage = lazy(() => import('./pages.jsx').then((module) => ({ default: module.StockCountsPage })));
const OperationsPage = lazy(() => import('./pages.jsx').then((module) => ({ default: module.OperationsPage })));
const StorefrontPage = lazy(() => import('./storefront.jsx').then((module) => ({ default: module.StorefrontPage })));
const TrackOrderPage = lazy(() => import('./storefront.jsx').then((module) => ({ default: module.TrackOrderPage })));
const PaymentReturnPage = lazy(() => import('./storefront.jsx').then((module) => ({ default: module.PaymentReturnPage })));
const MemberPortalPage = lazy(() => import('./storefront.jsx').then((module) => ({ default: module.MemberPortalPage })));
const StoreOrdersPage = lazy(() => import('./storefront.jsx').then((module) => ({ default: module.StoreOrdersPage })));
const HelpSupportPage = lazy(() => import('./storefront.jsx').then((module) => ({ default: module.HelpSupportPage })));
const SupportInboxPage = lazy(() => import('./pages.jsx').then((module) => ({ default: module.SupportInboxPage })));
const SystemAdminPage = lazy(() => import('./pages.jsx').then((module) => ({ default: module.SystemAdminPage })));

// Điều hướng đến các phân hệ đã có màn hình; các mục quản trị chỉ là phân vai trò demo phía trình duyệt.
const navigation = [
  { to: '/admin/dashboard', label: 'Tổng quan', icon: 'grid-1x2', end: true },
  // Đưa các công cụ quản trị lên gần đầu menu để admin không phải cuộn sidebar mới thấy Nhân viên.
  { to: '/admin/users', label: 'Nhân viên', icon: 'person-badge', adminOnly: true },
  { to: '/admin/branches', label: 'Chi nhánh', icon: 'building', adminOnly: true },
  { to: '/admin/system', label: 'Quản trị hệ thống', icon: 'shield-lock', adminOnly: true },
  { to: '/admin/products', label: 'Sản phẩm', icon: 'box-seam' },
  { to: '/admin/catalogs', label: 'Danh mục', icon: 'collection' },
  { to: '/admin/inventory', label: 'Kho hàng', icon: 'arrow-left-right' },
  { to: '/admin/stock-counts', label: 'Kiểm kê', icon: 'clipboard-check' },
  { to: '/admin/sales', label: 'Đơn hàng', icon: 'receipt' },
  { to: '/admin/operations', label: 'Nhập hàng & KM', icon: 'boxes' },
  { to: '/admin/delivery-orders', label: 'Đơn giao online', icon: 'truck' },
  { to: '/admin/support', label: 'Hỗ trợ khách hàng', icon: 'headset' },
  { to: '/admin/customers', label: 'Khách hàng', icon: 'people' },
  { to: '/admin/warranties', label: 'Bảo hành', icon: 'shield-check' },
  { to: '/admin/reports', label: 'Báo cáo', icon: 'bar-chart-line' },
];

const pageTitles = {
  '/admin/dashboard': 'Tổng quan',
  '/admin/products': 'Quản lý sản phẩm',
  '/admin/catalogs': 'Danh mục dùng chung',
  '/admin/inventory': 'Quản lý kho hàng',
  '/admin/stock-counts': 'Kiểm kê tồn kho',
  '/admin/sales': 'Đơn hàng',
  '/admin/operations': 'Nhập hàng và khuyến mãi',
  '/admin/delivery-orders': 'Đơn giao hàng online',
  '/admin/support': 'Hỗ trợ khách hàng',
  '/admin/customers': 'Khách hàng',
  '/admin/warranties': 'Quản lý bảo hành',
  '/admin/reports': 'Báo cáo',
  '/admin/branches': 'Quản lý chi nhánh',
  '/admin/users': 'Nhân viên',
  '/admin/system': 'Quản trị hệ thống',
};

const roleNames = { admin: 'Quản trị viên', manager: 'Quản lý chi nhánh', sales: 'Nhân viên bán hàng', warehouse: 'Nhân viên kho', employee: 'Nhân viên', ctv: 'Cộng tác viên', customer: 'Khách hàng' };

function AuthenticatedLayout({ user, onLogout, onResetDemoData, storageNotice, workspaceBase = '/admin', children }) {
  const location = useLocation();
  const canonicalPath = toCanonicalWorkspacePath(location.pathname);
  const title = pageTitles[canonicalPath] || 'EMSystems';
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const isSmallViewport = window.matchMedia('(max-width: 720px)').matches;

  // Đóng menu sau khi chọn trang để không che nội dung trên điện thoại.
  useEffect(() => {
    setMobileNavOpen(false);
  }, [location.pathname]);

  function toggleSidebar() {
    if (window.matchMedia('(max-width: 720px)').matches) {
      setMobileNavOpen((isOpen) => !isOpen);
    } else {
      setSidebarCollapsed((isCollapsed) => !isCollapsed);
    }
  }

  return (
    <div className={`app-layout${sidebarCollapsed ? ' sidebar-collapsed' : ''}${mobileNavOpen ? ' mobile-nav-open' : ''}`}>
      <button
        className="sidebar-backdrop"
        type="button"
        aria-label="Đóng menu điều hướng"
        tabIndex={mobileNavOpen ? 0 : -1}
        onClick={() => setMobileNavOpen(false)}
      />

      <aside id="primary-sidebar" className="sidebar">
        <NavLink to={`${workspaceBase}/dashboard`} className="brand-lockup" onClick={() => setMobileNavOpen(false)}>
          <img className="brand-symbol brand-logo-image" src={emsystemsLogo} alt="" />
          <span className="brand-text"><strong>EMSystems</strong><small>RETAIL MANAGEMENT</small></span>
        </NavLink>

        <div className="sidebar-label">KHÔNG GIAN LÀM VIỆC</div>
        <nav className="main-nav" aria-label="Điều hướng chính">
          {navigation.filter((item) => canAccessAdminRoute(user.role, item.to)).map((item) => (
            <NavLink
              key={item.to}
              to={item.to.replace(/^\/admin/, workspaceBase)}
              end={item.end}
              title={item.label}
              aria-label={item.label}
              onClick={() => setMobileNavOpen(false)}
              className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
            >
              <i className={`nav-icon bi bi-${item.icon}`} aria-hidden="true" />
              <span className="nav-label">{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <span className="sidebar-footnote">EMSystems · Dữ liệu demo trong trình duyệt</span>
          {user.role === 'admin' && <button className="text-button demo-reset-button" type="button" onClick={onResetDemoData}>Khôi phục dữ liệu mẫu</button>}
        </div>
      </aside>

      <div className="main-area">
        <header className="topbar">
          <div className="topbar-heading">
            <button
              className="sidebar-toggle"
              type="button"
              aria-controls="primary-sidebar"
              aria-expanded={isSmallViewport ? mobileNavOpen : !sidebarCollapsed}
              aria-label={isSmallViewport
                ? (mobileNavOpen ? 'Đóng menu điều hướng' : 'Mở menu điều hướng')
                : (sidebarCollapsed ? 'Mở rộng thanh bên' : 'Thu gọn thanh bên')}
              title={isSmallViewport
                ? (mobileNavOpen ? 'Đóng menu' : 'Mở menu')
                : (sidebarCollapsed ? 'Mở rộng thanh bên' : 'Thu gọn thanh bên')}
              onClick={toggleSidebar}
            >
              <i className={`bi ${isSmallViewport && mobileNavOpen ? 'bi-x-lg' : 'bi-list'}`} aria-hidden="true" />
            </button>
            <img className="topbar-brand-mark topbar-logo-image" src={emsystemsLogo} alt="" />
            <div className="topbar-title">
              <span className="eyebrow">EM SYSTEMS / WORKSPACE</span>
              <h1>{title}</h1>
            </div>
          </div>

          <div className="topbar-right">
            <span className="environment-tag">Bản demo cục bộ</span>
            <span className="topbar-date">{new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium' }).format(new Date())}</span>
            <div className="topbar-account">
              <div className="avatar topbar-avatar">{(user.fullName || user.username).slice(0, 1).toUpperCase()}</div>
              <div className="topbar-account-copy">
                <strong>{user.fullName || user.username}</strong>
                <small>{roleNames[user.role] || user.role}</small>
              </div>
            </div>
            <button className="button button-secondary topbar-logout" type="button" onClick={onLogout}>
              <i className="bi bi-box-arrow-right" aria-hidden="true" /><span className="topbar-logout-label">Đăng xuất</span>
            </button>
          </div>
        </header>

        {storageNotice && <div className="notice notice-error storage-warning" role="alert">{storageNotice}</div>}
        <main className="page-content">{children || <Outlet />}</main>
        <footer className="app-footer"><span>EMSystems</span><span>Quản lý vận hành chuỗi cửa hàng</span></footer>
      </div>
    </div>
  );
}

function ProtectedLayout({ user, ready, onLogout, onResetDemoData, storageNotice }) {
  if (!ready) return <div className="full-screen-state"><span className="loader" /> Đang kiểm tra phiên đăng nhập...</div>;
  if (!user) return <Navigate to="/login" replace />;
  return <AuthenticatedLayout user={user} onLogout={onLogout} onResetDemoData={onResetDemoData} storageNotice={storageNotice} />;
}

function AuthCheckLoading() {
  return <div className="full-screen-state"><span className="loader" /> Đang kiểm tra phiên đăng nhập...</div>;
}

function RoleGate({ user, ready = true, path, children }) {
  if (!ready) return <AuthCheckLoading />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.mustChangePassword && path !== '/change-password') return <Navigate to="/change-password" replace />;
  if (!canAccessAdminRoute(user.role, path)) return <Navigate to="/admin/dashboard" replace />;
  return children;
}

function AdminOnlyLayout({ user }) {
  // Ẩn mục quản trị cấp cao cả khi mở URL trực tiếp, không chỉ ẩn liên kết trong sidebar.
  if (user?.role !== 'admin') return <Navigate to="/admin/dashboard" replace />;
  return <Outlet />;
}

function NotFoundPage() {
  return (
    <main className="not-found-screen">
      <div className="not-found-content">
        <img className="not-found-logo" src={emsystemsLogo} alt="EMSystems" />
        <span className="not-found-code">404</span>
        <h1>Không tìm thấy trang</h1>
        <p>Đường dẫn không tồn tại</p>
        <NavLink className="button button-primary" to="/">Về cửa hàng</NavLink>
      </div>
    </main>
  );
}

function WorkspaceRoute({ area, user, ready, onLogout, onResetDemoData, storageNotice }) {
  const location = useLocation();
  if (!ready) return <AuthCheckLoading />;
  // Không tiết lộ cổng nội bộ qua chuyển hướng tới login khi chưa có phiên đăng nhập.
  if (!user) return <NotFoundPage />;
  if (area === '/admin' && user.role !== 'admin') return <NotFoundPage />;
  if (area === '/ctv' && !CTV_ROLES.includes(user.role)) return <NotFoundPage />;
  if (user.mustChangePassword) return <Navigate to="/change-password" replace />;

  const normalizedPath = location.pathname.replace(/\/+$/, '') || '/';
  if (normalizedPath === area) return <Navigate to={`${area}/dashboard`} replace />;
  const canonicalPath = toCanonicalWorkspacePath(normalizedPath);
  if (!canAccessAdminRoute(user.role, canonicalPath)) return <NotFoundPage />;

  const pageByPath = {
    '/admin/dashboard': DashboardPage,
    '/admin/products': ProductsPage,
    '/admin/catalogs': CatalogsPage,
    '/admin/inventory': InventoryPage,
    '/admin/stock-counts': StockCountsPage,
    '/admin/operations': OperationsPage,
    '/admin/delivery-orders': StoreOrdersPage,
    '/admin/support': SupportInboxPage,
    '/admin/branches': BranchesPage,
    '/admin/users': UsersPage,
    '/admin/system': SystemAdminPage,
    '/admin/sales': SalesPage,
    '/admin/customers': CustomersPage,
    '/admin/warranties': WarrantiesPage,
    '/admin/reports': ReportsPage,
    '/admin/payment-demo': PaymentDemoPage,
    '/admin/payment-result': PaymentResultPage,
    '/admin/demo-products': ProductsPage,
  };
  const Page = pageByPath[canonicalPath];
  if (!Page) return <NotFoundPage />;
  const pageProps = canonicalPath === '/admin/demo-products'
    ? { user: null, initialMode: 'dummy' }
    : { user };

  return (
    <AuthenticatedLayout
      user={user}
      onLogout={onLogout}
      onResetDemoData={onResetDemoData}
      storageNotice={storageNotice}
      workspaceBase={area}
    >
      <Page {...pageProps} />
    </AuthenticatedLayout>
  );
}

function App() {
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [storageNotice, setStorageNotice] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    dataRequest('/auth/me')
      .then((result) => setUser(result.user))
      .catch(() => setUser(null))
      .finally(() => {
        setAuthReady(true);
        setStorageNotice('');
      });
  }, []);

  useEffect(() => {
    const updateNotice = (event) => setStorageNotice(event.detail || '');
    const clearNotice = () => setStorageNotice('');
    window.addEventListener('emsystems:storage-notice', updateNotice);
    window.addEventListener('emsystems:data-reset', clearNotice);
    return () => {
      window.removeEventListener('emsystems:storage-notice', updateNotice);
      window.removeEventListener('emsystems:data-reset', clearNotice);
    };
  }, []);

  async function handleLogout() {
    try {
      await dataRequest('/auth/logout', { method: 'POST' });
    } finally {
      setUser(null);
      navigate('/', { replace: true });
    }
  }

  async function handleResetDemoData() {
    const confirmed = window.confirm('Khôi phục toàn bộ dữ liệu mẫu ban đầu? Mọi thay đổi đã lưu trên trình duyệt này sẽ bị xóa. Thao tác không thể hoàn tác.');
    if (!confirmed) return;
    try {
      await dataRequest('/system/reset-demo', { method: 'POST', body: { confirm: true } });
      window.location.reload();
    } catch (error) {
      window.alert(error.message || 'Không thể khôi phục dữ liệu mẫu trên máy chủ.');
    }
  }

  return (
    <Suspense fallback={<div className="full-screen-state"><span className="loader" /> Đang tải giao diện...</div>}>
      <Routes>
        <Route path="/" element={<StorefrontPage user={user} authReady={authReady} onLogout={handleLogout} workspacePath={user ? getPortalForRole(user.role) : '/'} roleLabel={roleNames[user?.role] || ''} />} />
        <Route path="/product/:productId" element={<StorefrontPage user={user} authReady={authReady} onLogout={handleLogout} workspacePath={user ? getPortalForRole(user.role) : '/'} roleLabel={roleNames[user?.role] || ''} />} />
        <Route path="/san-pham/:slug/:productId" element={<StorefrontPage user={user} authReady={authReady} onLogout={handleLogout} workspacePath={user ? getPortalForRole(user.role) : '/'} roleLabel={roleNames[user?.role] || ''} />} />
        <Route path="/checkout" element={<StorefrontPage initialSection="checkout" user={user} authReady={authReady} onLogout={handleLogout} workspacePath={user ? getPortalForRole(user.role) : '/'} roleLabel={roleNames[user?.role] || ''} />} />
        <Route path="/member" element={!authReady ? <AuthCheckLoading /> : !user ? <Navigate to="/login" replace /> : user.role !== 'customer' ? <NotFoundPage /> : <MemberPortalPage user={user} authReady={authReady} onLogout={handleLogout} workspacePath={getPortalForRole(user.role)} roleLabel={roleNames[user.role] || user.role} />} />
        <Route path="/track-order" element={<TrackOrderPage user={user} authReady={authReady} onLogout={handleLogout} workspacePath={user ? getPortalForRole(user.role) : '/'} roleLabel={roleNames[user?.role] || ''} />} />
        <Route path="/support" element={<HelpSupportPage user={user} />} />
        <Route path="/payment/return" element={<PaymentReturnPage user={user} authReady={authReady} onLogout={handleLogout} workspacePath={user ? getPortalForRole(user.role) : '/'} roleLabel={roleNames[user?.role] || ''} />} />
        <Route path="/login" element={!authReady ? <AuthCheckLoading /> : user ? <Navigate to={user.mustChangePassword ? '/change-password' : getPortalForRole(user.role)} replace /> : <LoginPage onLogin={setUser} />} />
        <Route path="/register" element={!authReady ? <AuthCheckLoading /> : user ? <Navigate to={getPortalForRole(user.role)} replace /> : <RegisterPage onLogin={setUser} />} />
        <Route path="/change-password" element={!authReady ? <AuthCheckLoading /> : !user ? <Navigate to="/login" replace /> : !user.mustChangePassword ? <Navigate to={getPortalForRole(user.role)} replace /> : <ChangePasswordPage onChanged={() => { setUser(null); navigate('/login', { replace: true }); }} />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/legal/:policySlug" element={<LegalPolicyPage />} />
        <Route path="/admin" element={<WorkspaceRoute area="/admin" user={user} ready={authReady} onLogout={handleLogout} onResetDemoData={handleResetDemoData} storageNotice={storageNotice} />} />
        <Route path="/admin/*" element={<WorkspaceRoute area="/admin" user={user} ready={authReady} onLogout={handleLogout} onResetDemoData={handleResetDemoData} storageNotice={storageNotice} />} />
        <Route path="/ctv" element={<WorkspaceRoute area="/ctv" user={user} ready={authReady} onLogout={handleLogout} onResetDemoData={handleResetDemoData} storageNotice={storageNotice} />} />
        <Route path="/ctv/*" element={<WorkspaceRoute area="/ctv" user={user} ready={authReady} onLogout={handleLogout} onResetDemoData={handleResetDemoData} storageNotice={storageNotice} />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  );
}

export default App;
