// Ma trận quyền hiển thị theo vai trò của bản demo EMSystems.
// Đây là lớp điều hướng/UX; mọi kiểm tra quan trọng vẫn cần được thực thi ở backend khi triển khai thật.
export const CTV_ROLES = Object.freeze(['manager', 'sales', 'warehouse', 'employee', 'ctv']);
const ALL_ROLES = ['admin', 'manager', 'sales', 'warehouse', 'employee', 'ctv'];

// Một biểu mẫu đăng nhập; vai trò được đọc từ hồ sơ đã xác thực, không do người dùng chọn.
// Theo mô hình Bindestroy: admin vào /admin, nhóm vận hành vào /ctv, khách hàng ở cửa hàng.
export function getPortalForRole(role) {
  const normalizedRole = String(role || '').trim().toLowerCase();
  if (normalizedRole === 'admin') return '/admin';
  if (CTV_ROLES.includes(normalizedRole)) return '/ctv';
  if (normalizedRole === 'customer') return '/';
  return '/';
}

export function canAccessPortal(role, portal) {
  const normalizedRole = String(role || '').trim().toLowerCase();
  const normalizedPortal = String(portal || '').trim().toLowerCase().replace(/\/+$/, '') || '/';
  if (normalizedPortal === '/admin') return normalizedRole === 'admin';
  if (normalizedPortal === '/ctv') return CTV_ROLES.includes(normalizedRole);
  return normalizedPortal === '/' && normalizedRole === 'customer';
}

export function toCanonicalWorkspacePath(pathname) {
  const normalizedPath = String(pathname || '/').split('?')[0].replace(/\/+$/, '') || '/';
  if (normalizedPath === '/ctv') return '/admin/dashboard';
  if (normalizedPath.startsWith('/ctv/')) return `/admin${normalizedPath.slice('/ctv'.length)}`;
  if (normalizedPath === '/admin') return '/admin/dashboard';
  return normalizedPath;
}

export const ADMIN_ROUTE_ACCESS = Object.freeze({
  '/admin/dashboard': ALL_ROLES,
  '/admin/products': ['admin', 'manager', 'warehouse', 'ctv'],
  '/admin/catalogs': ['admin', 'manager'],
  '/admin/inventory': ['admin', 'manager', 'warehouse'],
  '/admin/stock-counts': ['admin', 'manager', 'warehouse'],
  '/admin/operations': ['admin', 'manager', 'warehouse'],
  '/admin/delivery-orders': ['admin', 'manager', 'sales', 'warehouse'],
  '/admin/support': ['admin', 'manager', 'sales', 'employee'],
  '/admin/sales': ['admin', 'manager', 'sales', 'employee'],
  '/admin/customers': ['admin', 'manager', 'sales'],
  '/admin/warranties': ['admin', 'manager', 'sales', 'warehouse'],
  '/admin/reports': ['admin', 'manager'],
  '/admin/branches': ['admin'],
  '/admin/users': ['admin'],
  '/admin/system': ['admin'],
  '/admin/demo-products': ['admin', 'manager'],
  '/admin/payment-demo': ['admin', 'manager', 'sales', 'warehouse', 'employee'],
  '/admin/payment-result': ['admin', 'manager', 'sales', 'warehouse', 'employee'],
});

export function canAccessAdminRoute(role, pathname) {
  const segments = String(pathname || '').split('?')[0].split('/').filter(Boolean);
  const normalizedPath = segments.length ? `/${segments.join('/')}` : '/';
  const allowedRoles = ADMIN_ROUTE_ACCESS[normalizedPath];
  return Boolean(allowedRoles && allowedRoles.includes(String(role || '').toLowerCase()));
}

export function getAllowedAdminNavigation(role, navigation) {
  return (Array.isArray(navigation) ? navigation : []).filter((item) => canAccessAdminRoute(role, item.to));
}

/**
 * Quyền truy cập lớp dữ liệu local demo. Không thay thế authorization phía server;
 * mục đích là đồng bộ quyền đọc dữ liệu với vai trò và chặn lời gọi API nội bộ trái quyền.
 */
export function canAccessDataRequest(role, pathname, method = 'GET') {
  const normalizedRole = String(role || '').trim().toLowerCase();
  const normalizedPath = String(pathname || '/').split('?')[0].replace(/\/$/, '') || '/';
  const normalizedMethod = String(method || 'GET').toUpperCase();
  const is = (...roles) => roles.includes(normalizedRole);
  const matches = (pattern) => pattern.test(normalizedPath);

  if (matches(/^\/system\/(diagnostics|backup(?:\/validate|\/restore)?|reset-demo|bank-accounts)(\/|$)/)) return normalizedRole === 'admin';
  if (matches(/^\/(users|audit-logs)(\/|$)/)) return normalizedRole === 'admin';
  if (matches(/^\/support\/requests(\/|$)/)) return is('admin', 'manager', 'sales', 'employee');
  if (matches(/^\/reports(\/|$)/)) return is('admin', 'manager');
  if (matches(/^\/products(\/|$)/)) {
    return normalizedMethod === 'GET'
      ? is('admin', 'manager', 'warehouse', 'ctv')
      : is('admin', 'manager', 'warehouse');
  }
  if (matches(/^\/(categories|brands|suppliers)(\/|$)/)) return is('admin', 'manager', 'warehouse');
  if (matches(/^\/catalogs\/dummyjson\/import$/)) return is('admin', 'manager');
  if (matches(/^\/catalogs\/(categories|brands|suppliers)(\/|$)/)) return is('admin', 'manager', 'warehouse');

  // POS chỉ cần mã, họ tên, số điện thoại và trạng thái thành viên; không cần email/địa chỉ/ghi chú.
  if (normalizedPath === '/pos/customers') {
    return normalizedMethod === 'GET' && is('admin', 'manager', 'sales', 'employee');
  }
  if (matches(/^\/customers(\/|$)/)) return is('admin', 'manager', 'sales');

  // Danh sách chi nhánh dùng trong POS và biểu mẫu nội bộ; thao tác quản lý chi nhánh chỉ dành cho admin.
  if (matches(/^\/branches(\/|$)/)) {
    return normalizedMethod === 'GET'
      ? is('admin', 'manager', 'sales', 'warehouse', 'employee')
      : normalizedRole === 'admin';
  }

  if (normalizedPath === '/inventory/stock') {
    return normalizedMethod === 'GET'
      ? is('admin', 'manager', 'sales', 'warehouse', 'employee')
      : is('admin', 'manager', 'warehouse');
  }
  if (matches(/^\/inventory\/(movements|transfers|counts)(\/|$)/)) return is('admin', 'manager', 'warehouse');
  if (matches(/^\/purchase-receipts(\/|$)/)) return is('admin', 'manager', 'warehouse');
  if (matches(/^\/serials(\/|$)/)) return is('admin', 'manager', 'warehouse');

  if (normalizedPath === '/sales') return is('admin', 'manager', 'sales', 'employee');
  if (matches(/^\/sales\/\d+\/returns$/)) return is('admin', 'manager');
  if (matches(/^\/sales\/\d+$/)) {
    // Xem chi tiết có giá vốn chỉ dành cho admin/quản lý; thao tác sửa trực tiếp
    // phải đi tới guard nghiệp vụ để trả lỗi 409 (hóa đơn chỉ sửa qua quy trình).
    if (normalizedMethod === 'GET') return is('admin', 'manager');
    return is('admin', 'manager', 'sales', 'employee');
  }
  if (matches(/^\/sales(\/|$)/)) return is('admin', 'manager', 'sales', 'employee');

  if (matches(/^\/warranties(\/|$)/)) return is('admin', 'manager', 'sales', 'warehouse');
  if (matches(/^\/store\/orders(\/|$)/)) return is('admin', 'manager', 'sales', 'warehouse');
  if (matches(/^\/promotions(\/|$)/)) {
    return normalizedMethod === 'GET'
      ? is('admin', 'manager', 'sales', 'warehouse', 'employee')
      : is('admin', 'manager');
  }
  if (normalizedPath === '/notifications') return normalizedMethod === 'GET' && is('admin', 'manager', 'sales', 'warehouse', 'employee');
  if (normalizedPath === '/dashboard/summary') return is(...ALL_ROLES);
  if (matches(/^\/payments\/[^/]+\/status$/)) return is('admin', 'manager', 'sales', 'warehouse', 'employee');
  if (matches(/^\/payments\/mock\/[^/]+\/complete$/)) return is('admin', 'manager', 'sales', 'employee');

  // Fail closed: mọi endpoint nội bộ mới phải được thêm vào ma trận trước khi sử dụng.
  return false;
}
