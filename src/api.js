// Shared business adapter; the HTTP API injects server-side data and session context.
// The browser is not trusted for prices, stock, payment state or order lifecycle.
import { createInitialData } from './data/initialData.js';
import { createPasswordCredential, verifyDemoCredential } from './demo-auth.js';
import { canAccessDataRequest } from './access-control.js';
import { calculateDeliveryQuote, findNearestSupportedDeliveryArea } from './services/delivery.js';

const DATA_KEY = 'emsystems.demo.data.v1';
// Phiên v3 thêm thời hạn tuyệt đối/nhàn rỗi và vô hiệu hóa các phiên cũ hơn.
const LEGACY_SESSION_KEYS = Object.freeze([
  'emsystems.demo.session.v1',
  'emsystems.demo.session.v2',
]);
const SESSION_KEY = 'emsystems.demo.session.v3';
const SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000;
const SESSION_IDLE_LIMIT_MS = 30 * 60 * 1000;
const MEMBER_SESSION_KEY = 'emsystems.demo.member.session.v1';
const PHONE_VERIFIED_SESSION_KEY = 'emsystems.phone.verified';
const CORRUPT_BACKUP_KEY = 'emsystems.demo.corrupt-backup.v1';
const BACKUP_FORMAT = 'emsystems-data-backup';
const BACKUP_VERSION = 1;
const MAX_BACKUP_CHARS = 25 * 1024 * 1024;
const ALLOW_MOCK_PAYMENT = process.env.EMSYSTEMS_ALLOW_MOCK_PAYMENT === 'true'
  && process.env.NODE_ENV !== 'production';
const BACKUP_COLLECTIONS = [
  'users', 'branches', 'categories', 'brands', 'suppliers', 'products', 'stock',
  'customers', 'sales', 'payments', 'movements', 'transfers', 'counts', 'warranties',
  'purchaseReceipts', 'serials', 'promotions', 'returns', 'warrantyJobs', 'auditLogs',
  'notifications', 'deliveryAreas', 'productReviews', 'bankAccounts', 'supportRequests',
  'dataConsents', 'notificationOutbox',
];
let memoryFallback = null;
let storageNotice = '';

function clearStaffSession() {
  try {
    window.sessionStorage.removeItem(SESSION_KEY);
    for (const key of LEGACY_SESSION_KEYS) window.sessionStorage.removeItem(key);
  } catch {
    // Nếu browser chặn sessionStorage, getSessionUser sẽ fail-closed thay vì tự tạo phiên.
  }
}

const ensureArrays = (data) => {
  const oldSchemaVersion = Number(data.meta?.schemaVersion) || 1;
  for (const key of [
    'users', 'branches', 'categories', 'brands', 'suppliers', 'products', 'stock',
    'customers', 'sales', 'payments', 'movements', 'transfers', 'counts', 'warranties',
    'purchaseReceipts', 'serials', 'promotions', 'returns', 'warrantyJobs', 'auditLogs', 'notifications', 'deliveryAreas', 'productReviews', 'bankAccounts', 'supportRequests', 'dataConsents', 'notificationOutbox'
  ]) {
    if (!Array.isArray(data[key])) data[key] = [];
  }
  // Phục hồi bảng tài khoản demo chỉ khi bảng trống hoàn toàn. Không merge seed vào danh bạ đã có dữ liệu.
  // Tránh hệ thống bị khóa khỏi màn hình nhân viên khi bản localStorage/backup cũ thiếu hết user.
  if (data.users.length === 0) data.users = createInitialData().users;
  // Migration một lần: thêm khu vực giao hàng, ưu đãi mẫu và trường thành viên mà không xóa dữ liệu người dùng.
  if (oldSchemaVersion < 2) {
    const seed = createInitialData();
    if (!data.deliveryAreas.length) data.deliveryAreas = seed.deliveryAreas;
    if (!data.promotions.length) data.promotions = seed.promotions;
    data.customers = data.customers.map((customer, index) => ({
      ...customer,
      isMember: customer.isMember === true || (index === 0 && customer.phone === '0905123456'),
      loyaltyPoints: Number.isSafeInteger(Number(customer.loyaltyPoints))
        ? Number(customer.loyaltyPoints)
        : (index === 0 && customer.phone === '0905123456' ? 250 : 0),
      memberTier: customer.memberTier || (index === 0 && customer.phone === '0905123456' ? 'Bạc' : 'Chưa đăng ký'),
      memberSince: customer.memberSince || (index === 0 && customer.phone === '0905123456' ? new Date().toISOString() : null),
    }));
    data.meta = { ...(data.meta || {}), mode: 'server-backed-demo', schemaVersion: 2 };
  }
  if (oldSchemaVersion < 3) {
    // Migrate sáu hàng mẫu sang đúng model có ảnh trong catalog DummyJSON.
    // Chỉ đổi các bản ghi còn giữ nguyên tên mẫu cũ để không ghi đè sản phẩm đã được người dùng tùy chỉnh.
    const mappings = [
      { oldSku: 'PH-SAM-S24', oldName: 'Samsung Galaxy S24', sku: 'PH-SAM-S7', name: 'Samsung Galaxy S7', dummyJsonId: 131, brandId: 1, imageUrl: 'https://cdn.dummyjson.com/product-images/smartphones/samsung-galaxy-s7/thumbnail.webp' },
      { oldSku: 'PH-APL-IP15', oldName: 'Apple iPhone 15', sku: 'PH-APL-IP13P', name: 'iPhone 13 Pro', dummyJsonId: 123, brandId: 2, imageUrl: 'https://cdn.dummyjson.com/product-images/smartphones/iphone-13-pro/thumbnail.webp' },
      { oldSku: 'LT-ASU-VB15', oldName: 'ASUS Vivobook 15', sku: 'LT-ASU-ZENPRO', name: 'Asus Zenbook Pro Dual Screen Laptop', dummyJsonId: 79, brandId: 3, imageUrl: 'https://cdn.dummyjson.com/product-images/laptops/asus-zenbook-pro-dual-screen-laptop/thumbnail.webp' },
      { oldSku: 'PH-XIA-RED13', oldName: 'Xiaomi Redmi Note 13', sku: 'PH-SAM-S10', name: 'Samsung Galaxy S10', dummyJsonId: 133, brandId: 1, imageUrl: 'https://cdn.dummyjson.com/product-images/smartphones/samsung-galaxy-s10/thumbnail.webp' },
      { oldSku: 'PK-LOG-M185', oldName: 'Logitech M185', sku: 'PK-APL-AIRPODS', name: 'Apple Airpods', dummyJsonId: 100, brandId: 2, imageUrl: 'https://cdn.dummyjson.com/product-images/mobile-accessories/apple-airpods/thumbnail.webp' },
      { oldSku: 'PK-ANK-20W', oldName: 'Anker USB-C 20W', sku: 'PK-APL-AIRPOWER', name: 'Apple Airpower Wireless Charger', dummyJsonId: 102, brandId: 2, imageUrl: 'https://cdn.dummyjson.com/product-images/mobile-accessories/apple-airpower-wireless-charger/thumbnail.webp' },
    ];
    for (const mapping of mappings) {
      const product = data.products.find((item) => item.sku === mapping.oldSku);
      if (!product || product.name !== mapping.oldName || product.externalSource === 'dummyjson') continue;
      Object.assign(product, {
        sku: mapping.sku, name: mapping.name, brandId: mapping.brandId,
        dummyJsonId: mapping.dummyJsonId, externalSource: 'dummyjson',
        imageUrl: product.imageUrl || mapping.imageUrl,
      });
    }
    data.meta = { ...(data.meta || {}), mode: 'server-backed-demo', schemaVersion: 3 };
  }
  if (oldSchemaVersion < 4) {
    if (!data.categories.some((item) => String(item.name || '').trim().toLocaleLowerCase('vi') === 'máy tính bảng')) {
      const id = Math.max(0, ...data.categories.map((item) => Number(item.id) || 0)) + 1;
      data.categories.push({ id, name: 'Máy tính bảng', description: 'Máy tính bảng và thiết bị tablet', isActive: true });
    }
    data.meta = { ...(data.meta || {}), mode: 'server-backed-demo', schemaVersion: 4 };
  }
  if (oldSchemaVersion < 5) {
    // Unified-login accounts may link a customer profile by customerId; existing profiles are preserved.
    data.users = data.users.map((user) => ({ ...user, role: user.role || 'employee' }));
    data.meta = { ...(data.meta || {}), mode: 'server-backed-demo', schemaVersion: 5 };
  }
  if (oldSchemaVersion < 6) {
    data.meta = { ...(data.meta || {}), mode: 'server-backed-demo', schemaVersion: 6 };
  }
  if (oldSchemaVersion < 7) {
    // Add the expanded 30-product catalog once while preserving current inventory, edits and sales history.
    const seed = createInitialData();
    const normalizeName = (value) => String(value || '').trim().toLocaleLowerCase('vi');
    const lookupMaps = {};
    const lookupCollections = [
      ['categories', seed.categories, (row) => normalizeName(row.name)],
      ['brands', seed.brands, (row) => normalizeName(row.name)],
      ['suppliers', seed.suppliers, (row) => normalizeName(row.name)],
      ['branches', seed.branches, (row) => normalizeName(row.code || row.name)],
    ];
    for (const [key, seedRows, identify] of lookupCollections) {
      const rows = data[key];
      const idMap = new Map();
      let nextId = Math.max(0, ...rows.map((row) => Number(row.id) || 0)) + 1;
      for (const seedRow of seedRows) {
        let existing = rows.find((row) => identify(row) === identify(seedRow));
        if (!existing) {
          existing = { ...seedRow, id: nextId++ };
          rows.push(existing);
        }
        idMap.set(Number(seedRow.id), Number(existing.id));
      }
      lookupMaps[key] = idMap;
    }

    const productIds = new Map();
    const addedSeedProductIds = new Set();
    let nextProductId = Math.max(0, ...data.products.map((row) => Number(row.id) || 0)) + 1;
    for (const seedProduct of seed.products) {
      const sku = normalizeName(seedProduct.sku);
      const existing = data.products.find((row) => normalizeName(row.sku) === sku);
      if (existing) {
        productIds.set(Number(seedProduct.id), Number(existing.id));
        continue;
      }
      const product = {
        ...seedProduct,
        id: nextProductId++,
        categoryId: lookupMaps.categories.get(Number(seedProduct.categoryId)) ?? seedProduct.categoryId,
        brandId: lookupMaps.brands.get(Number(seedProduct.brandId)) ?? seedProduct.brandId,
        supplierId: lookupMaps.suppliers.get(Number(seedProduct.supplierId)) ?? seedProduct.supplierId,
      };
      data.products.push(product);
      productIds.set(Number(seedProduct.id), Number(product.id));
      addedSeedProductIds.add(Number(seedProduct.id));
    }

    for (const seedStock of seed.stock) {
      if (!addedSeedProductIds.has(Number(seedStock.productId))) continue;
      const productId = productIds.get(Number(seedStock.productId));
      const branchId = lookupMaps.branches.get(Number(seedStock.branchId)) ?? seedStock.branchId;
      if (data.stock.some((row) => Number(row.productId) === productId && Number(row.branchId) === Number(branchId))) continue;
      data.stock.push({ ...seedStock, productId, branchId });
    }
    data.meta = { ...(data.meta || {}), mode: 'server-backed-demo', schemaVersion: 7 };
  }
  if (!data.nextIds || typeof data.nextIds !== 'object') data.nextIds = {};
  for (const key of [
    'users', 'branches', 'categories', 'brands', 'suppliers', 'products', 'customers',
    'sales', 'payments', 'movements', 'transfers', 'counts', 'warranties',
    'purchaseReceipts', 'serials', 'promotions', 'returns', 'warrantyJobs', 'auditLogs', 'notifications', 'productReviews', 'bankAccounts', 'supportRequests'
  ]) {
    const maximum = Math.max(0, ...data[key].map((item) => Number(item?.id) || 0));
    data.nextIds[key] = Math.max(Number(data.nextIds[key]) || 1, maximum + 1);
  }
  return data;
};

function announceStorageNotice(message) {
  storageNotice = message;
  try {
    window.dispatchEvent(new CustomEvent('emsystems:storage-notice', { detail: message }));
  } catch {
    // Không để lỗi thông báo làm hỏng thao tác dữ liệu.
  }
}

function readData() {
  // Nếu localStorage bị từ chối ghi, giữ phiên bộ nhớ nhất quán thay vì đọc lại bản cũ trên đĩa.
  if (memoryFallback) return JSON.parse(JSON.stringify(memoryFallback));
  try {
    const raw = window.localStorage.getItem(DATA_KEY);
    if (raw === null) {
      const initial = ensureArrays(createInitialData());
      window.localStorage.setItem(DATA_KEY, JSON.stringify(initial));
      return initial;
    }
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)
        || !Array.isArray(parsed.products) || !Array.isArray(parsed.stock)
        || !Array.isArray(parsed.branches) || !Array.isArray(parsed.users)) {
        throw new Error('Cấu trúc dữ liệu không đúng.');
      }
      const normalized = ensureArrays(parsed);
      const normalizedRaw = JSON.stringify(normalized);
      if (normalizedRaw !== raw) window.localStorage.setItem(DATA_KEY, normalizedRaw);
      return normalized;
    } catch {
      // Giữ bản lỗi để người dùng có thể kiểm tra, sau đó khởi tạo dữ liệu mẫu an toàn.
      try { window.localStorage.setItem(CORRUPT_BACKUP_KEY, raw); } catch { /* Có thể trình duyệt hết dung lượng. */ }
      const initial = ensureArrays(createInitialData());
      window.localStorage.setItem(DATA_KEY, JSON.stringify(initial));
      announceStorageNotice('Dữ liệu máy chủ bị lỗi định dạng. Đã giữ bản dữ liệu lỗi và khởi tạo dữ liệu mẫu; cần kiểm tra bản sao lưu trước khi tiếp tục.');
      return initial;
    }
  } catch (error) {
    if (!memoryFallback) memoryFallback = ensureArrays(createInitialData());
    announceStorageNotice('Không thể đọc dữ liệu máy chủ. Dữ liệu tạm trong bộ nhớ không được bảo đảm lưu bền vững; hãy kiểm tra kết nối API.');
    return JSON.parse(JSON.stringify(memoryFallback));
  }
}

function writeData(data) {
  const safeData = ensureArrays(data);
  const serialized = JSON.stringify(safeData);
  try {
    window.localStorage.setItem(DATA_KEY, serialized);
    memoryFallback = null;
    if (storageNotice) announceStorageNotice('');
    return true;
  } catch {
    // Giữ bản tạm để giao diện không đọc lại dữ liệu cũ, nhưng phải báo rõ dữ liệu chưa bền vững.
    memoryFallback = JSON.parse(serialized);
    announceStorageNotice('Không ghi được dữ liệu máy chủ. Thay đổi chỉ lưu tạm trong bộ nhớ và có thể mất khi tải lại; hãy kiểm tra kết nối API.');
    return false;
  }
}

export function resetDemoData() {
  const initial = ensureArrays(createInitialData());
  try {
    window.localStorage.setItem(DATA_KEY, JSON.stringify(initial));
    window.localStorage.removeItem(CORRUPT_BACKUP_KEY);
    clearStaffSession();
    try { window.sessionStorage.removeItem(MEMBER_SESSION_KEY); } catch { /* Không giữ phiên thành viên khi đặt lại dữ liệu. */ }
    memoryFallback = null;
    storageNotice = '';
    window.dispatchEvent(new CustomEvent('emsystems:data-reset'));
  } catch {
    memoryFallback = initial;
    announceStorageNotice('Không ghi được dữ liệu máy chủ; dữ liệu mẫu chỉ được đặt lại trong bộ nhớ tạm.');
    return false;
  }
  return true;
}

export function getStorageNotice() {
  return storageNotice;
}

export function getStoredDemoData() {
  return readData();
}

function getRecordCounts(data) {
  return Object.fromEntries(BACKUP_COLLECTIONS.map((key) => [key, Array.isArray(data?.[key]) ? data[key].length : 0]));
}

/** Xuất snapshot có version để nhận diện và kiểm tra trước khi khôi phục. */
export function createDataBackup() {
  const data = readData();
  const user = getSessionUser(data);
  if (!user || user.role !== 'admin') throw createError('Chỉ quản trị viên demo được xuất bản sao lưu.', 403);
  const createdAt = new Date().toISOString();
  recordActivity(data, user, 'system.backup_exported', {
    schemaVersion: Number(data.meta?.schemaVersion) || 1,
    recordCount: BACKUP_COLLECTIONS.reduce((sum, key) => sum + (data[key]?.length || 0), 0),
  });
  const storageSaved = writeData(data);
  const snapshot = JSON.parse(JSON.stringify(data));
  return {
    format: BACKUP_FORMAT,
    backupVersion: BACKUP_VERSION,
    product: 'EMSystems',
    createdAt,
    schemaVersion: Number(snapshot.meta?.schemaVersion) || 1,
    storageSaved,
    recordCounts: getRecordCounts(snapshot),
    data: snapshot,
  };
}

/** Kiểm tra cấu trúc và các ràng buộc tối thiểu trước khi dữ liệu được ghi đè. */
export function validateDataBackup(backup) {
  const fail = (error) => ({ valid: false, error });
  if (!backup || typeof backup !== 'object' || Array.isArray(backup)) return fail('File sao lưu phải chứa một đối tượng JSON.');
  if (backup.format !== BACKUP_FORMAT) return fail('Không đúng định dạng sao lưu EMSystems.');
  if (backup.backupVersion !== BACKUP_VERSION) return fail('Phiên bản file sao lưu không được hỗ trợ.');
  if (!backup.data || typeof backup.data !== 'object' || Array.isArray(backup.data)) return fail('File sao lưu không có dữ liệu hợp lệ.');

  let serialized;
  try { serialized = JSON.stringify(backup); } catch { return fail('Không thể đọc cấu trúc file sao lưu.'); }
  if (serialized.length > MAX_BACKUP_CHARS) return fail('File sao lưu vượt giới hạn 25 MB.');

  const data = {
    ...backup.data,
    productReviews: Array.isArray(backup.data.productReviews) ? backup.data.productReviews : [],
    bankAccounts: Array.isArray(backup.data.bankAccounts) ? backup.data.bankAccounts : [],
    supportRequests: Array.isArray(backup.data.supportRequests) ? backup.data.supportRequests : [],
  };
  if (!data.meta || typeof data.meta !== 'object' || Array.isArray(data.meta)) return fail('File sao lưu thiếu metadata schema.');
  const schemaVersion = Number(data.meta.schemaVersion);
  const currentSchemaVersion = Number(createInitialData().meta?.schemaVersion) || 1;
  if (!Number.isSafeInteger(schemaVersion) || schemaVersion < 1 || schemaVersion > currentSchemaVersion) {
    return fail(`Schema ${String(data.meta.schemaVersion)} không được hỗ trợ (phiên bản hiện tại: ${currentSchemaVersion}).`);
  }
  if (!data.nextIds || typeof data.nextIds !== 'object' || Array.isArray(data.nextIds)) return fail('File sao lưu thiếu bộ đếm ID tiếp theo.');

  for (const key of BACKUP_COLLECTIONS) {
    if (!Array.isArray(data[key])) return fail(`Thiếu bảng dữ liệu bắt buộc: ${key}.`);
    if (data[key].length > 250000) return fail(`Bảng ${key} vượt giới hạn bản ghi cho phép.`);
    if (data[key].some((row) => !row || typeof row !== 'object' || Array.isArray(row))) return fail(`Bảng ${key} có bản ghi sai cấu trúc.`);
  }

  const entityCollections = [
    'users', 'branches', 'categories', 'brands', 'suppliers', 'products', 'customers',
    'sales', 'payments', 'movements', 'transfers', 'counts', 'warranties',
    'purchaseReceipts', 'promotions', 'returns', 'warrantyJobs', 'auditLogs', 'notifications', 'deliveryAreas', 'productReviews', 'bankAccounts', 'supportRequests',
  ];
  for (const key of entityCollections) {
    const ids = new Set();
    for (const row of data[key]) {
      const id = Number(row.id);
      if (!Number.isSafeInteger(id) || id <= 0 || ids.has(id)) return fail(`Bảng ${key} có ID thiếu, không hợp lệ hoặc bị trùng.`);
      ids.add(id);
    }
  }

  if (!data.users.some((user) => user.role === 'admin' && user.isActive !== false)) {
    return fail('Bản sao lưu phải có ít nhất một tài khoản quản trị viên đang hoạt động để tránh khóa quyền quản trị sau khi khôi phục.');
  }

  const activeBankAccounts = data.bankAccounts.filter((account) => account.isActive === true);
  if (activeBankAccounts.length > 1) return fail('Chỉ được có một tài khoản ngân hàng VietQR đang kích hoạt.');
  const bankAccountKeys = new Set();
  for (const account of data.bankAccounts) {
    const bankCode = String(account.bankCode || '').trim().toUpperCase();
    const accountNumber = String(account.accountNumber || '').trim();
    const key = `${bankCode}:${accountNumber}`;
    if (!/^[A-Z0-9-]{2,30}$/.test(bankCode) || !/^\d{6,19}$/.test(accountNumber)
      || String(account.bankName || '').trim().length < 2
      || String(account.accountName || '').trim().length < 2) {
      return fail('Tài khoản ngân hàng trong file sao lưu có thông tin không hợp lệ.');
    }
    if (bankAccountKeys.has(key)) return fail('File sao lưu có tài khoản ngân hàng bị khai báo trùng.');
    bankAccountKeys.add(key);
  }

  const productIds = new Set(data.products.map((row) => Number(row.id)));
  const branchIds = new Set(data.branches.map((row) => Number(row.id)));
  const skus = new Set();
  for (const product of data.products) {
    const sku = String(product.sku || '').trim().toLocaleLowerCase('vi');
    if (!sku || skus.has(sku)) return fail('SKU sản phẩm đang trống hoặc bị trùng.');
    skus.add(sku);
    for (const field of ['costPrice', 'sellingPrice']) {
      if (!Number.isSafeInteger(Number(product[field])) || Number(product[field]) < 0) {
        return fail(`Sản phẩm ${sku} có ${field} không hợp lệ.`);
      }
    }
  }

  const stockKeys = new Set();
  for (const row of data.stock) {
    const productId = Number(row.productId);
    const branchId = Number(row.branchId);
    const quantity = Number(row.quantity);
    const key = `${productId}:${branchId}`;
    if (!productIds.has(productId) || !branchIds.has(branchId)) return fail('Tồn kho có liên kết sản phẩm hoặc chi nhánh không tồn tại.');
    if (!Number.isSafeInteger(quantity) || quantity < 0) return fail('Tồn kho chứa số lượng không hợp lệ.');
    if (stockKeys.has(key)) return fail('Có nhiều dòng tồn kho cho cùng sản phẩm và chi nhánh.');
    stockKeys.add(key);
  }

  for (const sale of data.sales) {
    if (!branchIds.has(Number(sale.branchId))) return fail('Đơn bán hàng có chi nhánh không tồn tại.');
    if (!Array.isArray(sale.items)) return fail('Đơn bán hàng có danh sách mặt hàng không hợp lệ.');
    if (sale.items.some((item) => !item || !productIds.has(Number(item.productId)))) return fail('Đơn bán hàng tham chiếu sản phẩm không tồn tại.');
  }

  const recordCounts = getRecordCounts(data);
  const recordCount = Object.values(recordCounts).reduce((sum, count) => sum + count, 0);
  return {
    valid: true,
    error: '',
    createdAt: typeof backup.createdAt === 'string' ? backup.createdAt : '',
    schemaVersion,
    recordCount,
    recordCounts,
  };
}

/** Khôi phục có xác nhận ở UI; ghi snapshot trước, không nhận JSON thiếu bảng hoặc sai liên kết. */
export function restoreDataBackup(backup) {
  const previousData = JSON.parse(JSON.stringify(readData()));
  const actor = getSessionUser(previousData);
  if (!actor || actor.role !== 'admin') throw createError('Chỉ quản trị viên demo được khôi phục bản sao lưu.', 403);
  const validation = validateDataBackup(backup);
  if (!validation.valid) throw createError(validation.error, 400);

  const restoredData = ensureArrays(JSON.parse(JSON.stringify(backup.data)));
  recordActivity(restoredData, actor, 'system.backup_restored', {
    backupCreatedAt: validation.createdAt || null,
    backupSchemaVersion: validation.schemaVersion,
    recordCount: validation.recordCount,
  });
  if (!writeData(restoredData)) {
    memoryFallback = previousData;
    announceStorageNotice('Không thể ghi dữ liệu sao lưu vào máy chủ. Dữ liệu trước khi khôi phục đã được giữ trong bộ nhớ phiên; không tải lại trang.');
    throw createError('Không thể lưu bản khôi phục bền vững. Dữ liệu hiện tại chưa bị thay bằng bản sao lưu.', 507);
  }

  clearStaffSession();
  try { window.sessionStorage.removeItem(MEMBER_SESSION_KEY); } catch { /* Bản khôi phục không giữ phiên thành viên cũ. */ }
  window.dispatchEvent(new CustomEvent('emsystems:data-restored'));
  return { ok: true, recordCount: validation.recordCount, schemaVersion: Number(restoredData.meta?.schemaVersion) || validation.schemaVersion };
}

/** Chẩn đoán cục bộ cho vận hành demo; không giả lập trạng thái máy chủ hoặc bảo mật. */
export function getSystemDiagnostics() {
  const data = readData();
  let raw = null;
  let storageReadable = true;
  try { raw = window.localStorage.getItem(DATA_KEY); } catch { storageReadable = false; }
  const recordCounts = getRecordCounts(data);
  return {
    mode: 'server-backed-demo',
    storage: !storageReadable ? 'unavailable' : memoryFallback ? 'memory-only' : raw !== null ? 'sqlite' : 'uninitialized',
    persistent: storageReadable && !memoryFallback && raw !== null,
    estimatedSizeKB: raw == null ? 0 : Math.round((raw.length * 2 / 1024) * 10) / 10,
    schemaVersion: Number(data.meta?.schemaVersion) || 1,
    lastActivityAt: data.auditLogs[0]?.createdAt || null,
    recordCounts,
    recordCount: Object.values(recordCounts).reduce((sum, count) => sum + count, 0),
    storageNotice,
  };
}

export function formatMoney(value) {
  return new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency: 'VND',
    maximumFractionDigits: 0,
  }).format(Number(value) || 0);
}

function createError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

// Ảnh sản phẩm chỉ nhận HTTPS hoặc đường dẫn nội bộ; không lưu javascript:/data: hay URL giao thức khác.
function normalizeProductImageUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw.startsWith('/') && !raw.startsWith('//') && !raw.includes('\\')) return raw.slice(0, 1000);
  try {
    const parsed = new URL(raw);
    if (parsed.protocol === 'https:' && parsed.hostname) return parsed.href.slice(0, 1000);
  } catch { /* URL không hợp lệ được từ chối bên dưới. */ }
  throw createError('URL ảnh sản phẩm phải dùng HTTPS hoặc đường dẫn nội bộ bắt đầu bằng /.');
}

function normalizeProductImages(value, fallbackImage = '') {
  if (value !== undefined && value !== null && !Array.isArray(value)) {
    throw createError('Danh sách ảnh sản phẩm phải là một mảng URL.');
  }
  const rawImages = Array.isArray(value) ? value : [];
  if (rawImages.length > 12) throw createError('Mỗi sản phẩm chỉ được có tối đa 12 ảnh.');
  const images = [...new Set(rawImages.map(normalizeProductImageUrl).filter(Boolean))];
  const primaryImage = normalizeProductImageUrl(fallbackImage);
  if (primaryImage && !images.includes(primaryImage)) images.unshift(primaryImage);
  return images.slice(0, 12);
}

function optionalProductNumber(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

// Chuẩn hóa ngày theo múi giờ máy đang chạy để dashboard không lệch ngày ở khu vực UTC+7.
function localDateKey(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function nextId(data, collection) {
  const id = Math.max(Number(data.nextIds[collection]) || 1, ...data[collection].map((item) => Number(item.id) + 1 || 1));
  data.nextIds[collection] = id + 1;
  return id;
}

function recordActivity(data, user, action, details = {}) {
  data.auditLogs.unshift({
    id: nextId(data, 'auditLogs'),
    userId: user?.id ?? null,
    username: user?.username || 'demo',
    action,
    details,
    createdAt: new Date().toISOString(),
  });
  // Giới hạn nhật ký để tránh snapshot SQLite phình không kiểm soát trong bản demo.
  if (data.auditLogs.length > 5000) data.auditLogs.length = 5000;
}

function recordDataConsent(data, { userId = null, customerId = null, saleId = null, supportRequestId = null, source, processing, marketing = false, channels = {}, locationConsent = false }) {
  if (!Array.isArray(data.dataConsents)) data.dataConsents = [];
  data.dataConsents.unshift({
    id: nextId(data, 'dataConsents'), version: '2026-11-09-v1',
    userId, customerId, saleId, supportRequestId, source,
    processingConsent: processing === true,
    marketingConsent: marketing === true,
    locationConsent: locationConsent === true,
    notificationChannels: {
      email: channels.email === true,
      sms: channels.sms === true,
      zaloZns: channels.zaloZns === true,
    },
    createdAt: new Date().toISOString(),
  });
}

function enqueueCustomerNotification(data, sale, eventType, statusText) {
  const preferences = sale.notificationPreferences || {};
  const details = {
    customerName: sale.delivery?.recipientName || sale.customerName || 'Quý khách',
    orderCode: sale.invoiceNo,
    amountText: `${Number(sale.totalAmount || 0).toLocaleString('vi-VN')}đ`,
    statusText,
  };
  const messageByEvent = {
    order_placed: `EMSystems đã tiếp nhận đơn hàng ${sale.invoiceNo}. Cửa hàng sẽ xác nhận trước khi giao.`,
    payment_confirmed: `Thanh toán đơn ${sale.invoiceNo} đã được máy chủ xác minh thành công.`,
    shipping_started: `Đơn ${sale.invoiceNo} đã được bàn giao cho đơn vị giao hàng.`,
    delivered: `Đơn ${sale.invoiceNo} đã được cập nhật giao thành công. Cảm ơn bạn đã mua sắm tại EMSystems.`,
  };
  const targets = [
    { channel: 'email', target: sale.delivery?.email, enabled: preferences.email === true && Boolean(process.env.RESEND_API_KEY && process.env.EMSYSTEMS_EMAIL_FROM && process.env.EMSYSTEMS_PUBLIC_URL) },
    { channel: 'sms', target: sale.delivery?.phone, enabled: preferences.sms === true && Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_SMS_FROM) },
    { channel: 'zalo_zns', target: sale.delivery?.phone, enabled: preferences.zaloZns === true && Boolean((process.env.ZALO_ZNS_ACCESS_TOKEN || (process.env.ZALO_ZNS_APP_ID && process.env.ZALO_ZNS_APP_SECRET && process.env.ZALO_ZNS_REFRESH_TOKEN)) && process.env.ZALO_ZNS_TEMPLATE_ID_ORDER) },
  ];
  for (const item of targets) {
    if (!item.enabled || !item.target) continue;
    const dedupeKey = `${sale.id}:${eventType}:${item.channel}`;
    if (data.notificationOutbox.some((entry) => entry.dedupeKey === dedupeKey)) continue;
    data.notificationOutbox.unshift({
      id: nextId(data, 'notificationOutbox'), dedupeKey,
      eventType, channel: item.channel, target: item.target,
      subject: eventType === 'order_placed' ? 'EMSystems đã tiếp nhận đơn hàng' : 'Cập nhật đơn hàng EMSystems',
      message: messageByEvent[eventType] || 'Đơn hàng của bạn vừa được cập nhật.',
      templateId: null, templateData: details,
      status: 'pending', attemptCount: 0, nextAttemptAt: null,
      createdAt: new Date().toISOString(),
    });
  }
  if (data.notificationOutbox.length > 5000) {
    const inFlight = data.notificationOutbox.filter((entry) => ['pending', 'sending'].includes(entry.status));
    const terminal = data.notificationOutbox.filter((entry) => !['pending', 'sending'].includes(entry.status))
      .slice(0, Math.max(0, 5000 - inFlight.length));
    data.notificationOutbox = [...inFlight, ...terminal];
  }
}

function getSessionUser(data) {
  try {
    // Xóa phiên đời cũ; chúng không có thời hạn phiên v3.
    for (const key of LEGACY_SESSION_KEYS) window.sessionStorage.removeItem(key);
    const session = JSON.parse(window.sessionStorage.getItem(SESSION_KEY) || 'null');
    if (!session || session.authVersion !== 3 || !Number.isSafeInteger(Number(session.userId))) return null;
    const now = Date.now();
    const issuedAt = Number(session.issuedAt);
    const lastActivityAt = Number(session.lastActivityAt);
    const invalidTimes = !Number.isFinite(issuedAt) || !Number.isFinite(lastActivityAt)
      || issuedAt <= 0 || lastActivityAt < issuedAt || lastActivityAt > now + 60_000;
    const expiredAbsolute = !invalidTimes && now - issuedAt >= SESSION_MAX_AGE_MS;
    const expiredIdle = !invalidTimes && now - lastActivityAt >= SESSION_IDLE_LIMIT_MS;
    if (invalidTimes || expiredAbsolute || expiredIdle) {
      window.sessionStorage.removeItem(SESSION_KEY);
      recordActivity(data, null, 'auth.session_expired', {
        reason: invalidTimes ? 'invalid_session_timestamps' : expiredAbsolute ? 'absolute_timeout' : 'idle_timeout',
      });
      writeData(data);
      return null;
    }
    const user = data.users.find((item) => item.id === Number(session.userId) && item.isActive !== false) || null;
    if (!user) {
      // Thu hồi phiên khi tài khoản đã bị khóa/xóa; không để phiên cũ sống lại nếu tài khoản được mở khóa sau đó.
      window.sessionStorage.removeItem(SESSION_KEY);
      return null;
    }
    if (Number(session.credentialVersion ?? 1) !== Number(user.credentialVersion ?? 1)) {
      // Thu hồi các phiên đã được cấp trước khi mật khẩu/credential của tài khoản thay đổi.
      window.sessionStorage.removeItem(SESSION_KEY);
      return null;
    }
    // Rolling idle timeout; maximum absolute age vẫn tính từ issuedAt và không thể được gia hạn.
    window.sessionStorage.setItem(SESSION_KEY, JSON.stringify({ ...session, lastActivityAt: now }));
    return user;
  } catch {
    clearStaffSession();
    return null;
  }
}

function getSessionMember(data) {
  try {
    const session = JSON.parse(window.sessionStorage.getItem(MEMBER_SESSION_KEY) || 'null');
    if (!session || !Number.isSafeInteger(Number(session.customerId))) return null;
    return data.customers.find((item) => item.id === Number(session.customerId) && item.isMember === true && item.isActive !== false) || null;
  } catch {
    return null;
  }
}

function safeMember(customer) {
  if (!customer) return null;
  return {
    id: customer.id,
    code: customer.code,
    fullName: customer.fullName,
    phone: customer.phone,
    email: customer.email || '',
    address: customer.address || '',
    city: customer.city || '',
    district: customer.district || '',
    ward: customer.ward || '',
    isMember: customer.isMember === true,
    loyaltyPoints: Number(customer.loyaltyPoints || 0),
    memberTier: customer.memberTier || 'Đồng',
    memberSince: customer.memberSince || null,
  };
}

function normalizeVietnamPhone(value) {
  let phone = String(value || '').trim().replace(/[\s().-]/g, '');
  if (phone.startsWith('+84')) phone = '0' + phone.slice(3);
  else if (phone.startsWith('84') && phone.length === 11) phone = '0' + phone.slice(2);
  return /^0[35789]\d{8}$/.test(phone) ? phone : '';
}

function requirePhoneVerificationForSession(phone) {
  if (process.env.EMSYSTEMS_REQUIRE_PHONE_VERIFICATION !== 'true') return;
  let verifiedPhone = '';
  let verifiedAt = 0;
  try {
    verifiedPhone = normalizeVietnamPhone(window.sessionStorage.getItem(PHONE_VERIFIED_SESSION_KEY));
    verifiedAt = Number(window.sessionStorage.getItem(`${PHONE_VERIFIED_SESSION_KEY}.at`));
  }
  catch { /* Fail closed if the server-managed session store is unavailable. */ }
  if (!verifiedPhone || verifiedPhone !== phone || !Number.isFinite(verifiedAt)
    || Date.now() - verifiedAt > 10 * 60_000 || verifiedAt > Date.now() + 60_000) {
    throw createError('Cần xác minh OTP số điện thoại trước khi tiếp tục.', 403);
  }
}

function requireDataProcessingConsent(body) {
  if (process.env.EMSYSTEMS_REQUIRE_DATA_CONSENT !== 'true') return;
  const controllerConfigured = Boolean(
    String(process.env.EMSYSTEMS_LEGAL_OPERATOR_NAME || '').trim()
    && String(process.env.EMSYSTEMS_LEGAL_REGISTERED_ADDRESS || '').trim()
    && String(process.env.EMSYSTEMS_LEGAL_EMAIL || process.env.EMSYSTEMS_LEGAL_HOTLINE || '').trim(),
  );
  if (!controllerConfigured) throw createError('Chủ thể kiểm soát dữ liệu chưa cấu hình tên pháp lý, địa chỉ và đầu mối liên hệ. Tạm khóa thao tác thu thập dữ liệu cho đến khi hoàn tất.', 503);
  if (body.dataProcessingConsent !== true) throw createError('Bạn cần xác nhận đồng ý xử lý dữ liệu cá nhân để tiếp tục.', 400);
}

function tierForPoints(points) {
  const total = Number(points) || 0;
  if (total >= 2000) return 'Kim cương';
  if (total >= 800) return 'Vàng';
  if (total >= 200) return 'Bạc';
  return 'Đồng';
}
function creditLoyaltyPoints(customer, points) {
  // Điểm phát sinh là số nguyên; điểm thu hồi quá số dư thành khoản nợ để bù trừ ở lần cộng sau.
  const credit = Math.max(0, Math.trunc(Number(points) || 0));
  const debt = Math.max(0, Math.trunc(Number(customer.loyaltyPointsDebt) || 0));
  const covered = Math.min(debt, credit);
  customer.loyaltyPointsDebt = debt - covered;
  customer.loyaltyPoints = Math.max(0, Math.trunc(Number(customer.loyaltyPoints) || 0)) + credit - covered;
  customer.memberTier = tierForPoints(customer.loyaltyPoints);
}

function debitLoyaltyPoints(customer, points) {
  const debit = Math.max(0, Math.trunc(Number(points) || 0));
  const balance = Math.max(0, Math.trunc(Number(customer.loyaltyPoints) || 0));
  const taken = Math.min(balance, debit);
  customer.loyaltyPoints = balance - taken;
  customer.loyaltyPointsDebt = Math.max(0, Math.trunc(Number(customer.loyaltyPointsDebt) || 0)) + debit - taken;
  customer.memberTier = tierForPoints(customer.loyaltyPoints);
}

function getDeliveryArea(data, areaId) {
  return data.deliveryAreas.find((item) => item.id === Number(areaId) && item.isActive !== false) || null;
}

function safeUser(user) {
  if (!user) return null;
  const { password, passwordHash, passwordCredential, ...safe } = user;
  const seededCredential = ['admin', 'manager', 'sales', 'warehouse']
    .includes(String(user.username || '').trim().toLocaleLowerCase('vi'));
  return {
    ...safe,
    credentialConfigured: Boolean(passwordCredential || seededCredential),
    mustChangePassword: user.mustChangePassword === true,
  };
}

function paginated(items, query) {
  const page = Math.max(1, Number(query.get('page')) || 1);
  const pageSize = Math.max(1, Math.min(100, Number(query.get('pageSize')) || 10));
  const search = (query.get('search') || query.get('q') || '').trim().toLocaleLowerCase('vi');
  const filtered = items.filter((item) => !search || JSON.stringify(item).toLocaleLowerCase('vi').includes(search));
  return {
    data: filtered.slice((page - 1) * pageSize, page * pageSize),
    pagination: { page, pageSize, totalItems: filtered.length, totalPages: Math.ceil(filtered.length / pageSize) },
  };
}

function enrichProduct(data, product) {
  const category = data.categories.find((item) => item.id === Number(product.categoryId));
  const brand = data.brands.find((item) => item.id === Number(product.brandId));
  const supplier = data.suppliers.find((item) => item.id === Number(product.supplierId));
  return {
    ...product,
    categoryName: category?.name || product.categoryName || '',
    brandName: brand?.name || product.brandName || '',
    supplierName: supplier?.name || product.supplierName || '',
  };
}

// Public storefront must use a display DTO, never the whole internal product row (cost/supplier fields).
function toPublicStoreProduct(data, product, inStockByBranch, quantity) {
  const enriched = enrichProduct(data, product);
  const allowedFields = [
    'id', 'sku', 'name', 'categoryId', 'categoryName', 'brandId', 'brandName', 'sellingPrice',
    'warrantyMonths', 'unit', 'imageUrl', 'images', 'description', 'technicalDetails', 'tags',
    'weight', 'dimensions', 'warrantyInformation', 'shippingInformation', 'returnPolicy',
    'availabilityStatus', 'minimumOrderQuantity', 'externalSource', 'dummyJsonId', 'externalSku',
  ];
  const result = Object.fromEntries(allowedFields
    .filter((key) => Object.hasOwn(enriched, key))
    .map((key) => [key, enriched[key]]));
  result.images = Array.isArray(result.images) ? result.images.slice(0, 12) : [];
  result.tags = Array.isArray(result.tags) ? result.tags.filter((tag) => typeof tag === 'string').slice(0, 20) : [];
  // Public catalog only exposes availability. Exact counts by branch are internal inventory data.
  return { ...result, inStock: quantity > 0, availableStock: quantity > 0, inStockByBranch };
}

function publicReview(review) {
  return {
    id: review.id,
    rating: review.rating,
    title: review.title,
    body: review.body,
    reviewerName: review.reviewerName,
    createdAt: review.createdAt,
    verifiedPurchase: review.verifiedPurchase === true,
  };
}

function productReviewSummary(data, productId) {
  const reviews = data.productReviews
    .filter((review) => Number(review.productId) === Number(productId) && review.status === 'published' && review.verifiedPurchase === true)
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
  const average = reviews.length
    ? Math.round((reviews.reduce((sum, review) => sum + Number(review.rating), 0) / reviews.length) * 10) / 10
    : null;
  return { rating: average, reviewCount: reviews.length, reviews: reviews.slice(0, 5).map(publicReview) };
}

function getStockRow(data, product, branchId, quantity, role = 'admin') {
  const branch = data.branches.find((item) => item.id === Number(branchId));
  const enriched = enrichProduct(data, product);
  const result = {
    ...enriched,
    productId: product.id,
    branchId: Number(branchId),
    branchName: branch?.name || 'Không rõ chi nhánh',
    stock: Number(quantity) || 0,
    quantity: Number(quantity) || 0,
  };
  // POS cần giá bán và tồn kho, không cần giá vốn hoặc quan hệ nhà cung cấp.
  if (!['admin', 'manager', 'warehouse'].includes(String(role || '').toLowerCase())) {
    delete result.costPrice;
    delete result.supplierId;
    delete result.supplierName;
    delete result.externalPriceUsd;
    delete result.externalSku;
    delete result.priceNeedsManualSetup;
  }
  return result;
}

function stockQuantity(data, productId, branchId) {
  const rows = data.stock.filter((item) => item.productId === Number(productId) && item.branchId === Number(branchId));
  if (rows.length > 1) throw createError('Dữ liệu kho có nhiều dòng trùng sản phẩm/chi nhánh; cần kiểm tra trước khi tiếp tục.', 409);
  if (!rows.length) return 0;

  const quantity = Number(rows[0].quantity);
  if (!Number.isSafeInteger(quantity) || quantity < 0) {
    throw createError('Số tồn kho đang sai định dạng; hãy kiểm tra dữ liệu kho trước khi tiếp tục.', 409);
  }
  return quantity;
}

// Mọi biến động tồn đều kiểm tra quan hệ và số nguyên an toàn trước khi ghi nhật ký.
function changeStock(data, user, productId, branchId, delta, type, referenceCode, note = '') {
  const product = data.products.find((item) => item.id === Number(productId));
  const branch = data.branches.find((item) => item.id === Number(branchId));
  if (!product) throw createError('Không tìm thấy sản phẩm.', 404);
  if (!branch) throw createError('Không tìm thấy chi nhánh của biến động kho.', 404);

  const rows = data.stock.filter((item) => item.productId === product.id && item.branchId === branch.id);
  if (rows.length > 1) throw createError('Dữ liệu kho có dòng trùng sản phẩm/chi nhánh; chưa áp dụng biến động.', 409);
  let row = rows[0];
  const numericDelta = Number(delta);
  const currentQuantity = row ? Number(row.quantity) : 0;

  if (!Number.isSafeInteger(numericDelta)
    || !Number.isSafeInteger(currentQuantity) || currentQuantity < 0
    || !Number.isSafeInteger(currentQuantity + numericDelta)
    || currentQuantity + numericDelta < 0) {
    throw createError('Tồn kho không đủ hoặc số lượng không hợp lệ.', 409);
  }
  if (!row && numericDelta < 0) throw createError('Chi nhánh chưa có tồn kho sản phẩm này.', 409);
  if (!row) {
    row = { productId: product.id, branchId: branch.id, quantity: 0 };
    data.stock.push(row);
  }
  row.quantity = currentQuantity + numericDelta;
  data.movements.unshift({
    id: nextId(data, 'movements'),
    productId: product.id,
    productName: product.name,
    sku: product.sku,
    branchId: Number(branchId),
    movementType: type,
    quantityDelta: Number(delta),
    referenceCode: referenceCode || '',
    note: note || '',
    createdByName: user?.fullName || 'Hệ thống demo',
    createdAt: new Date().toISOString(),
  });
  if (row.quantity <= Number(product.minStock ?? 5)) {
    const exists = data.notifications.some((item) => item.type === 'low_stock' && item.reference === `${product.id}:${branchId}` && !item.readAt);
    if (!exists) data.notifications.unshift({
      id: nextId(data, 'notifications'),
      type: 'low_stock',
      message: `${product.name} sắp hết hàng (${row.quantity} sản phẩm).`,
      branchId: Number(branchId),
      reference: `${product.id}:${branchId}`,
      createdAt: new Date().toISOString(),
      readAt: null,
    });
  }
  return row.quantity;
}

function branchAllowed(user, branchId) {
  return user?.role === 'admin' || Number(user?.branchId) === Number(branchId);
}

function requireManager(user) {
  if (!['admin', 'manager'].includes(user?.role)) throw createError('Chức năng này chỉ dành cho quản trị viên hoặc quản lý.', 403);
}

function listProducts(data, user, query) {
  const products = data.products.map((item) => {
    const enriched = enrichProduct(data, item);
    const stock = data.stock.filter((row) => row.productId === item.id && branchAllowed(user, row.branchId))
      .reduce((sum, row) => sum + Number(row.quantity || 0), 0);
    // CTV chỉ cần dữ liệu mặt hàng để giới thiệu/bán; không được trả giá vốn hay thông tin nhà cung cấp.
    if (user.role === 'ctv') {
      const { costPrice, supplierId, supplierName, externalPriceUsd, ...ctvProduct } = enriched;
      return { ...ctvProduct, stock, canDelete: false };
    }
    // Chỉ cho phép xóa cứng khi sản phẩm chưa có lịch sử bán và mọi chi nhánh đều hết tồn.
    return {
      ...enriched,
      stock,
      canDelete: !data.sales.some((sale) => (sale.items || []).some((line) => line.productId === item.id))
        && data.stock.filter((row) => row.productId === item.id).every((row) => Number(row.quantity || 0) === 0),
    };
  });
  return paginated(products, query);
}

function reportSummary(data, user, query) {
  const dateFrom = query.get('dateFrom') || '';
  const dateTo = query.get('dateTo') || '';
  const branchFilter = query.get('branchId') ? Number(query.get('branchId')) : null;
  if ((dateFrom && Number.isNaN(Date.parse(dateFrom))) || (dateTo && Number.isNaN(Date.parse(dateTo))) || (dateFrom && dateTo && dateFrom > dateTo)) {
    throw createError('Khoảng ngày báo cáo không hợp lệ.', 400);
  }
  const scopedSales = data.sales.filter((sale) => {
    if (!branchAllowed(user, sale.branchId)) return false;
    if (branchFilter && user.role === 'admin' && sale.branchId !== branchFilter) return false;
    if (sale.status !== 'completed' || !['completed', 'partially_refunded', 'refunded'].includes(sale.paymentStatus)) return false;
    const date = localDateKey(sale.createdAt);
    return (!dateFrom || date >= dateFrom) && (!dateTo || date <= dateTo);
  });
  const revenue = scopedSales.reduce((sum, sale) => sum + Number(sale.totalAmount || 0), 0);
  const refunded = data.returns.filter((item) => item.status === 'completed' && scopedSales.some((sale) => sale.id === item.saleId)).reduce((sum, item) => sum + Number(item.refundAmount || 0), 0);
  // Giá vốn chỉ tính số lượng còn bán ròng; hàng đã đổi trả được loại khỏi giá vốn ước tính.
  const cost = scopedSales.reduce((sum, sale) => sum + (sale.items || []).reduce((subtotal, item) => {
    const product = data.products.find((row) => row.id === item.productId);
    const netQuantity = Math.max(0, Number(item.quantity || 0) - Number(item.returnedQuantity || 0));
    return subtotal + Number(item.costPrice ?? product?.costPrice ?? 0) * netQuantity;
  }, 0), 0);
  const perDay = new Map();
  const productTotals = new Map();
  for (const sale of scopedSales) {
    const date = localDateKey(sale.createdAt);
    const current = perDay.get(date) || { date, revenue: 0, refundedAmount: 0, orderCount: 0 };
    current.revenue += Number(sale.totalAmount || 0);
    current.orderCount += 1;
    perDay.set(date, current);
    for (const item of sale.items || []) {
      const tally = productTotals.get(item.productId) || {
        productId: item.productId,
        productName: item.productName || data.products.find((product) => product.id === item.productId)?.name || 'Sản phẩm',
        quantity: 0,
        netQuantity: 0,
        netSales: 0,
      };
      const netQuantity = Math.max(0, Number(item.quantity || 0) - Number(item.returnedQuantity || 0));
      const originalLineAmount = Number(item.netLineTotal ?? item.lineTotal ?? (Number(item.unitPrice || 0) * Number(item.quantity || 0)));
      const netLineSales = Math.max(0, originalLineAmount - Number(item.returnedAmount || 0));
      tally.quantity += netQuantity;
      tally.netQuantity += netQuantity;
      tally.netSales += netLineSales;
      productTotals.set(item.productId, tally);
    }
  }
  for (const item of data.returns.filter((entry) => entry.status === 'completed')) {
    const sale = scopedSales.find((row) => row.id === item.saleId);
    if (sale) {
      const date = localDateKey(sale.createdAt);
      const current = perDay.get(date);
      if (current) current.refundedAmount += Number(item.refundAmount || 0);
    }
  }
  const relevantStock = data.stock.filter((item) => branchAllowed(user, item.branchId) && (!branchFilter || user.role !== 'admin' || item.branchId === branchFilter));
  const lowStock = relevantStock.filter((item) => item.quantity <= Number(data.products.find((product) => product.id === item.productId)?.minStock ?? 5)).map((item) => ({
    ...item, productName: data.products.find((product) => product.id === item.productId)?.name || '',
  }));
  const revenueByDay = [...perDay.values()].map((item) => ({
    date: item.date,
    orderCount: item.orderCount,
    netRevenue: item.revenue - item.refundedAmount,
  })).sort((a, b) => a.date.localeCompare(b.date));
  return {
    period: { dateFrom: dateFrom || null, dateTo: dateTo || null, branchId: branchFilter },
    summary: {
      orderCount: scopedSales.length,
      grossRevenue: revenue,
      refundedAmount: refunded,
      netRevenue: revenue - refunded,
      costOfGoods: cost,
      grossProfit: revenue - refunded - cost,
      averageOrderValue: scopedSales.length ? Math.round((revenue - refunded) / scopedSales.length) : 0,
      activeProducts: data.products.filter((item) => item.isActive).length,
      lowStockProducts: lowStock.length,
      totalUnits: relevantStock.reduce((sum, item) => sum + Number(item.quantity || 0), 0),
    },
    revenueByDay,
    topProducts: [...productTotals.values()].sort((a, b) => b.netQuantity - a.netQuantity).slice(0, 10),
    lowStock,
  };
}

function decorateTransfer(data, transfer) {
  return {
    ...transfer,
    transferNo: transfer.transferNo || transfer.code,
    fromBranchName: data.branches.find((item) => item.id === transfer.fromBranchId)?.name || '—',
    toBranchName: data.branches.find((item) => item.id === transfer.toBranchId)?.name || '—',
    itemCount: (transfer.items || []).length,
  };
}

function decorateCount(data, count) {
  return {
    ...count,
    countNo: count.countNo || count.code,
    branchName: data.branches.find((item) => item.id === count.branchId)?.name || '—',
    itemCount: count.items?.length || 0,
    countedItems: (count.items || []).filter((item) => item.countedQuantity !== null && item.countedQuantity !== undefined).length,
  };
}

// Giữ giao diện React hiện tại nhưng mọi tuyến dữ liệu đều được xử lý cục bộ, không có máy chủ API.
export async function dataRequest(path, options = {}) {
  const url = new URL(String(path || '/'), window.location.origin);
  const route = url.pathname.replace(/^\/api(?=\/)/, '').replace(/\/$/, '') || '/';
  const method = String(options.method || 'GET').toUpperCase();
  const query = url.searchParams;
  let body = options.body || {};
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) body = {};

  // Dữ liệu đăng nhập chỉ là vai trò demo trong sessionStorage; không có mật khẩu được lưu.
  let data = readData();
  // Giữ snapshot đầu request để có thể hoàn tác nếu không ghi bền vững được; tránh retry tạo đơn/kho trùng trong cùng phiên.
  const dataBeforeRequest = JSON.parse(JSON.stringify(data));
  if (route === '/config/public') return {
    turnstileMode: 'mock', turnstileSiteKey: '', dataMode: 'server-sqlite',
    phoneVerificationRequired: process.env.EMSYSTEMS_REQUIRE_PHONE_VERIFICATION === 'true',
    dataConsentRequired: process.env.EMSYSTEMS_REQUIRE_DATA_CONSENT === 'true',
    dataConsentReady: process.env.EMSYSTEMS_REQUIRE_DATA_CONSENT !== 'true' || Boolean(
      String(process.env.EMSYSTEMS_LEGAL_OPERATOR_NAME || '').trim()
      && String(process.env.EMSYSTEMS_LEGAL_REGISTERED_ADDRESS || '').trim()
      && String(process.env.EMSYSTEMS_LEGAL_EMAIL || process.env.EMSYSTEMS_LEGAL_HOTLINE || '').trim(),
    ),
    emailResetAvailable: Boolean(process.env.RESEND_API_KEY && process.env.EMSYSTEMS_EMAIL_FROM && process.env.EMSYSTEMS_PUBLIC_URL) || process.env.EMSYSTEMS_MOCK_COMMUNICATION === 'true',
    notificationChannels: {
      email: Boolean(process.env.RESEND_API_KEY && process.env.EMSYSTEMS_EMAIL_FROM && process.env.EMSYSTEMS_PUBLIC_URL),
      sms: Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_SMS_FROM),
      zaloZns: Boolean((process.env.ZALO_ZNS_ACCESS_TOKEN || (process.env.ZALO_ZNS_APP_ID && process.env.ZALO_ZNS_APP_SECRET && process.env.ZALO_ZNS_REFRESH_TOKEN)) && process.env.ZALO_ZNS_TEMPLATE_ID_ORDER),
    },
    legalBusiness: {
      operatorName: String(process.env.EMSYSTEMS_LEGAL_OPERATOR_NAME || '').trim(),
      taxCode: String(process.env.EMSYSTEMS_LEGAL_TAX_CODE || '').trim(),
      businessRegistration: String(process.env.EMSYSTEMS_LEGAL_BUSINESS_REGISTRATION || '').trim(),
      businessRegistrationDate: String(process.env.EMSYSTEMS_LEGAL_BUSINESS_REGISTRATION_DATE || '').trim(),
      businessRegistrationIssuer: String(process.env.EMSYSTEMS_LEGAL_BUSINESS_REGISTRATION_ISSUER || '').trim(),
      registeredAddress: String(process.env.EMSYSTEMS_LEGAL_REGISTERED_ADDRESS || '').trim(),
      representativeName: String(process.env.EMSYSTEMS_LEGAL_REPRESENTATIVE_NAME || '').trim(),
      representativeTitle: String(process.env.EMSYSTEMS_LEGAL_REPRESENTATIVE_TITLE || '').trim(),
      hotline: String(process.env.EMSYSTEMS_LEGAL_HOTLINE || '').trim(),
      email: String(process.env.EMSYSTEMS_LEGAL_EMAIL || '').trim(),
      ecommerceNoticeId: String(process.env.EMSYSTEMS_ECOMMERCE_NOTICE_ID || '').trim(),
      ecommerceBadgeUrl: String(process.env.EMSYSTEMS_ECOMMERCE_BADGE_URL || '').trim(),
    },
    einvoice: {
      provider: String(process.env.EMSYSTEMS_EINVOICE_PROVIDER || 'none').trim().toLowerCase(),
      configured: false,
    },
  };

  const persist = (value) => {
    if (writeData(data)) return { ...value, storageSaved: true };

    // Hoàn tác đúng request thất bại nhưng giữ trạng thái trước request trong bộ nhớ tạm.
    memoryFallback = dataBeforeRequest;
    const originalMessage = typeof value?.message === 'string' ? value.message : 'Thao tác chưa được lưu.';
    throw createError(`CHƯA LƯU: ${originalMessage} Dữ liệu chưa được ghi lại; đã hoàn tác thao tác này trong phiên hiện tại. Hãy giải phóng dung lượng/quyền ghi rồi thử lại.`, 507);
  };

  const onlinePaymentMethods = ['momo_sandbox', 'vnpay_sandbox', 'vietqr_transfer'];
  const releaseUnpaidWebOrder = (sale, { paymentStatus = 'cancelled', reason = 'staff_cancelled', by = 'system', recordEvent = true } = {}) => {
    if (!sale || sale.fulfillmentStatus === 'cancelled') return false;
    if (!sale.inventoryReservationReleased) {
      for (const line of sale.items || []) {
        changeStock(data, null, line.productId, sale.branchId, line.quantity, 'web_order_cancel_release', sale.invoiceNo, reason);
      }
      sale.inventoryReservationReleased = true;
    }
    if (sale.memberCustomerId && Number(sale.loyaltyPointsUsed || 0) > 0 && !sale.loyaltyPointsRestored) {
      const member = data.customers.find((item) => item.id === sale.memberCustomerId && item.isMember);
      if (member) creditLoyaltyPoints(member, Number(sale.loyaltyPointsUsed));
      sale.loyaltyPointsRestored = true;
    }
    if (sale.promotionCode && !sale.promotionUsageReleased) {
      const promotion = data.promotions.find((item) => item.code === sale.promotionCode);
      if (promotion) promotion.usedCount = Math.max(0, Number(promotion.usedCount || 0) - 1);
      sale.promotionUsageReleased = true;
    }
    const cancelledAt = new Date().toISOString();
    sale.status = 'cancelled';
    sale.fulfillmentStatus = 'cancelled';
    sale.paymentStatus = paymentStatus;
    sale.cancelledAt = cancelledAt;
    sale.cancellationReason = reason;
    sale.statusHistory = [...(sale.statusHistory || []), { status: 'cancelled', createdAt: cancelledAt, by }];
    const payment = data.payments.find((item) => item.saleId === sale.id && item.method === sale.paymentMethod);
    if (payment && payment.status === 'pending') {
      payment.status = paymentStatus === 'expired' ? 'expired' : paymentStatus === 'failed' ? 'failed' : 'cancelled';
      payment.cancelledAt = cancelledAt;
    }
    if (recordEvent) {
      recordActivity(data, null, reason === 'payment_timeout' ? 'store.order_payment_expired' : 'store.order_cancelled', {
        saleId: sale.id, invoiceNo: sale.invoiceNo, reason,
      });
    }
    return true;
  };

  const applyGatewaySettlement = (settlement) => {
    const sale = data.sales.find((item) => item.isWebOrder && item.invoiceNo === settlement.orderId);
    if (!sale) throw createError('Không tìm thấy đơn hàng tương ứng với giao dịch thanh toán.', 404);
    const expectedProvider = sale.paymentMethod === 'momo_sandbox' ? 'momo' : sale.paymentMethod === 'vnpay_sandbox' ? 'vnpay' : '';
    if (!expectedProvider || settlement.provider !== expectedProvider || Number(settlement.amount) !== Number(sale.totalAmount)) {
      throw createError('Nhà cung cấp hoặc số tiền thanh toán không khớp với đơn hàng.', 409);
    }
    const paymentRecord = data.payments.find((item) => item.saleId === sale.id && item.method === sale.paymentMethod);
    if (!paymentRecord) throw createError('Không tìm thấy bản ghi thanh toán của đơn hàng.', 409);
    if (settlement.status === 'pending') return { status: 'pending', order: { invoiceNo: sale.invoiceNo, paymentStatus: sale.paymentStatus } };

    const settledAt = new Date().toISOString();
    if (settlement.status === 'paid') {
      if (sale.paymentStatus === 'completed') {
        return { status: 'paid', order: { invoiceNo: sale.invoiceNo, paymentStatus: sale.paymentStatus, totalAmount: sale.totalAmount } };
      }
      if (sale.paymentStatus === 'paid_after_cancellation' && sale.paymentException) {
        return { status: 'manual_review', order: { invoiceNo: sale.invoiceNo, paymentStatus: sale.paymentStatus, totalAmount: sale.totalAmount } };
      }
      if (sale.fulfillmentStatus === 'cancelled' || ['cancelled', 'expired', 'failed', 'paid_after_cancellation'].includes(sale.paymentStatus)) {
        // Never resurrect an expired/cancelled order after a late gateway success.
        sale.paymentStatus = 'paid_after_cancellation';
        sale.paymentException = {
          type: 'paid_after_cancellation', amount: Number(settlement.amount),
          transactionId: settlement.transactionId || null, detectedAt: settledAt,
          resolution: 'manual_review_required',
        };
        paymentRecord.status = 'paid-after-cancellation';
        paymentRecord.transactionId = settlement.transactionId || null;
        paymentRecord.completedAt = settledAt;
        recordActivity(data, null, 'store.payment_received_after_order_cancelled', {
          saleId: sale.id, invoiceNo: sale.invoiceNo, provider: settlement.provider,
          paymentId: settlement.paymentId, amount: Number(settlement.amount),
        });
        return { status: 'manual_review', order: { invoiceNo: sale.invoiceNo, paymentStatus: sale.paymentStatus, totalAmount: sale.totalAmount } };
      }
      if (sale.paymentStatus !== 'pending_payment') throw createError('Đơn hàng không còn ở trạng thái chờ thanh toán.', 409);
      sale.paymentStatus = 'completed';
      sale.paymentConfirmedAt = settledAt;
      paymentRecord.status = 'completed-online';
      paymentRecord.transactionId = settlement.transactionId || null;
      paymentRecord.completedAt = settledAt;
      enqueueCustomerNotification(data, sale, 'payment_confirmed', 'Đã thanh toán');
      recordActivity(data, null, 'store.online_payment_confirmed', {
        saleId: sale.id, provider: settlement.provider, paymentId: settlement.paymentId, amount: sale.totalAmount,
      });
      return { status: 'paid', order: { invoiceNo: sale.invoiceNo, paymentStatus: sale.paymentStatus, totalAmount: sale.totalAmount } };
    }

    if (settlement.status === 'failed') {
      if (paymentRecord.status === 'failed') {
        return { status: 'failed', order: { invoiceNo: sale.invoiceNo, paymentStatus: sale.paymentStatus, totalAmount: sale.totalAmount } };
      }
      if (sale.paymentStatus === 'pending_payment' && sale.fulfillmentStatus !== 'cancelled') {
        releaseUnpaidWebOrder(sale, { paymentStatus: 'failed', reason: 'payment_failed', by: 'payment-sandbox' });
      }
      paymentRecord.status = 'failed';
      paymentRecord.failedAt = settledAt;
      recordActivity(data, null, 'store.online_payment_failed', { saleId: sale.id, provider: settlement.provider, paymentId: settlement.paymentId });
      return { status: 'failed', order: { invoiceNo: sale.invoiceNo, paymentStatus: sale.paymentStatus, totalAmount: sale.totalAmount } };
    }
    throw createError('Trạng thái thanh toán sandbox chưa được hỗ trợ.', 409);
  };

  // These routes are dispatched only by the business API after checking the shared payment-service token.
  if (route === '/internal/orders/expire-pending' && method === 'POST') {
    const cutoff = Date.now() - 15 * 60_000;
    const expired = data.sales.filter((sale) => sale.isWebOrder === true
      && onlinePaymentMethods.includes(sale.paymentMethod)
      && sale.paymentStatus === 'pending_payment'
      && sale.fulfillmentStatus === 'pending_confirmation'
      && Date.parse(sale.createdAt) <= cutoff);
    for (const sale of expired) releaseUnpaidWebOrder(sale, { paymentStatus: 'expired', reason: 'payment_timeout', by: 'system' });
    if (expired.length) persist({ message: `Đã tự động hết hạn ${expired.length} đơn chưa thanh toán.` });
    return { expiredCount: expired.length, invoiceNos: expired.map((sale) => sale.invoiceNo) };
  }
  if (route === '/internal/payment-settlement' && method === 'POST') {
    const paymentId = String(body.paymentId || '').trim();
    const orderId = String(body.orderId || '').trim();
    const provider = String(body.provider || '').trim();
    const status = String(body.status || '').trim();
    const amount = Number(body.amount);
    if (!/^[A-Za-z0-9_-]{20,100}$/.test(paymentId) || !/^WEB-[0-9]{5,12}$/.test(orderId)
      || !['momo', 'vnpay'].includes(provider) || !['paid', 'failed'].includes(status)
      || !Number.isSafeInteger(amount) || amount < 1000) {
      throw createError('Thông tin IPN nội bộ không hợp lệ.', 400);
    }
    const result = applyGatewaySettlement({ paymentId, orderId, provider, status, amount, transactionId: body.transactionId });
    persist({ ok: true });
    return { ...result, synchronized: true };
  }
  if (route === '/internal/notifications/claim' && method === 'POST') {
    const limit = Math.max(1, Math.min(25, Math.trunc(Number(body.limit) || 10)));
    const now = Date.now();
    const claimed = [];
    for (const entry of data.notificationOutbox) {
      const due = entry.status === 'pending'
        || (entry.status === 'sending' && Date.parse(entry.lockedAt || '') <= now - 2 * 60_000);
      if (!due || (entry.nextAttemptAt && Date.parse(entry.nextAttemptAt) > now)
        || Number(entry.attemptCount || 0) >= 5) continue;
      entry.status = 'sending';
      entry.lockedAt = new Date(now).toISOString();
      entry.attemptCount = Number(entry.attemptCount || 0) + 1;
      claimed.push({
        id: entry.id, channel: entry.channel, target: entry.target,
        subject: entry.subject, message: entry.message,
        templateId: entry.templateId, templateData: entry.templateData,
      });
      if (claimed.length >= limit) break;
    }
    if (claimed.length) persist({ message: 'Đã nhận các thông báo cần gửi.' });
    return { notifications: claimed };
  }
  if (route === '/internal/notifications/complete' && method === 'POST') {
    const id = Number(body.id);
    const entry = data.notificationOutbox.find((item) => item.id === id && item.status === 'sending');
    if (!entry) throw createError('Không tìm thấy thông báo đang được xử lý.', 404);
    if (body.success === true) {
      entry.status = 'sent';
      entry.sentAt = new Date().toISOString();
      entry.lastError = null;
    } else {
      entry.status = Number(entry.attemptCount || 0) >= 5 ? 'failed' : 'pending';
      const delayMs = Math.min(60 * 60_000, 30_000 * (2 ** Math.max(0, Number(entry.attemptCount || 1) - 1)));
      entry.nextAttemptAt = new Date(Date.now() + delayMs).toISOString();
      entry.lastError = 'provider_delivery_failed';
    }
    entry.lockedAt = null;
    persist({ ok: true });
    return { ok: true, status: entry.status };
  }

  // Mặt tiền cửa hàng và khu vực giao hàng đều xem được trước khi đăng nhập.
  if (route === '/store/products' && method === 'GET') {
    const products = data.products.filter((item) => item.isActive !== false && Number(item.sellingPrice) > 0).map((item) => {
      const productStockRows = data.stock.filter((row) => row.productId === item.id);
      const quantity = productStockRows.reduce((sum, row) => sum + Number(row.quantity || 0), 0);
      const inStockByBranch = Object.fromEntries(productStockRows.map((row) => [String(row.branchId), Number(row.quantity || 0) > 0]));
      return { ...toPublicStoreProduct(data, item, inStockByBranch, quantity), ...productReviewSummary(data, item.id) };
    }).filter((item) => item.inStock);
    return paginated(products, query);
  }
  const productReviewsRoute = route.match(/^\/store\/products\/(\d+)\/reviews$/);
  if (productReviewsRoute && method === 'GET') {
    const productId = Number(productReviewsRoute[1]);
    const product = data.products.find((item) => item.id === productId && item.isActive !== false && Number(item.sellingPrice) > 0);
    if (!product) throw createError('Không tìm thấy sản phẩm đang mở bán.', 404);
    const reviews = data.productReviews
      .filter((review) => Number(review.productId) === productId && review.status === 'published' && review.verifiedPurchase === true)
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
      .map(publicReview);
    return { ...paginated(reviews, query), summary: productReviewSummary(data, productId) };
  }
  if (route === '/store/delivery-areas' && method === 'GET') {
    return { data: data.deliveryAreas.filter((area) => area.isActive !== false).map((area) => ({
      ...area,
      branchName: data.branches.find((branch) => branch.id === area.branchId)?.name || 'Chi nhÃ¡nh',
    })) };
  }
  if (route === '/store/branches' && method === 'GET') {
    return { data: data.branches.filter((branch) => branch.isActive !== false).map(({ id, code, name, address, phone }) => ({ id, code, name, address, phone })) };
  }
  if (route === '/store/promotions' && method === 'GET') {
    const now = Date.now();
    return { data: data.promotions.filter((promo) => promo.isActive !== false
      && Number.isFinite(Date.parse(promo.startAt)) && Number.isFinite(Date.parse(promo.endAt))
      && now >= Date.parse(promo.startAt) && now <= Date.parse(promo.endAt)
      && (promo.usageLimit == null || Number(promo.usedCount || 0) + Number(promo.reservedCount || 0) < Number(promo.usageLimit)))
      .map((promo) => ({
        code: promo.code, description: promo.description || '',
        discountType: promo.discountType, discountValue: promo.discountValue,
        minimumOrder: Number(promo.minimumOrder || 0), memberOnly: promo.memberOnly === true,
        endAt: promo.endAt,
      })) };
  }

  // Legacy member authentication by phone alone is unsafe: require the shared account/password flow.
  if ((route === '/store/member/register' || route === '/store/member/login') && method === 'POST') {
    throw createError('Đăng nhập hoặc tạo thẻ chỉ bằng số điện thoại đã bị vô hiệu hóa. Hãy dùng tài khoản EMSystems có mật khẩu.', 410);
  }

  if (route === '/store/member/register' && method === 'POST') {
    const fullName = String(body.fullName || '').trim();
    const phone = normalizeVietnamPhone(body.phone);
    const email = String(body.email || '').trim().toLowerCase();
    if (fullName.length < 2 || fullName.length > 100) throw createError('Họ tên phải từ 2 đến 100 ký tự.');
    if (!phone) throw createError('Số điện thoại Việt Nam chưa đúng định dạng.');
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw createError('Email chưa đúng định dạng.');
    let customer = data.customers.find((item) => normalizeVietnamPhone(item.phone) === phone);
    if (customer?.isActive === false) throw createError('Hồ sơ khách hàng này đã ngừng hoạt động; hãy liên hệ cửa hàng để được hỗ trợ.', 409);
    if (customer?.isMember) throw createError('Số điện thoại này đã đăng ký thành viên. Hãy đăng nhập thành viên.', 409);
    if (!customer) {
      customer = {
        id: nextId(data, 'customers'),
        code: `CUS-${String(data.nextIds.customers - 1).padStart(4, '0')}`,
        fullName, phone, email, address: '', city: '', district: '', ward: '',
        isActive: true, isMember: true, loyaltyPoints: 0, memberTier: 'Đồng',
        memberSince: new Date().toISOString(),
      };
      data.customers.unshift(customer);
    } else {
      Object.assign(customer, { fullName, phone, email, isMember: true, loyaltyPoints: Number(customer.loyaltyPoints || 0), memberTier: tierForPoints(customer.loyaltyPoints), memberSince: new Date().toISOString() });
    }
    try { window.sessionStorage.setItem(MEMBER_SESSION_KEY, JSON.stringify({ customerId: customer.id })); } catch { /* Phiên thành viên chỉ dành cho demo. */ }
    recordActivity(data, null, 'store.member_registered', { customerId: customer.id });
    return persist({ member: safeMember(customer), message: 'Đã tạo thẻ thành viên demo. Không có mật khẩu hoặc OTP được xác minh.' });
  }

  if (route === '/store/member/login' && method === 'POST') {
    const phone = normalizeVietnamPhone(body.phone);
    if (!phone) throw createError('Nhập số điện thoại hợp lệ để tìm thẻ thành viên demo.');
    const member = data.customers.find((item) => item.isMember === true && item.isActive !== false && normalizeVietnamPhone(item.phone) === phone);
    if (!member) throw createError('Chưa tìm thấy thành viên với số điện thoại này. Hãy đăng ký thẻ thành viên demo.', 404);
    try { window.sessionStorage.setItem(MEMBER_SESSION_KEY, JSON.stringify({ customerId: member.id })); } catch { /* Phiên thành viên chỉ dành cho demo. */ }
    return { member: safeMember(member), message: 'Đã mở phiên thành viên demo; số điện thoại chưa được xác minh bằng OTP.' };
  }
  if (route === '/store/member/logout' && method === 'POST') {
    try { window.sessionStorage.removeItem(MEMBER_SESSION_KEY); } catch { /* Không chặn đăng xuất. */ }
    return { ok: true };
  }
  if (route === '/store/member/me' && method === 'GET') {
    const member = getSessionMember(data);
    if (!member) throw createError('Chưa đăng nhập thẻ thành viên demo.', 401);
    return { member: safeMember(member) };
  }
  if (route === '/store/member/orders' && method === 'GET') {
    const member = getSessionMember(data);
    if (!member) throw createError('Đăng nhập thành viên để xem lịch sử đơn của mình.', 401);
    const orders = data.sales.filter((sale) => sale.isWebOrder && sale.memberCustomerId === member.id)
      .map((sale) => ({
        id: sale.id, invoiceNo: sale.invoiceNo, status: sale.fulfillmentStatus || sale.status,
        paymentStatus: sale.paymentStatus, totalAmount: sale.totalAmount,
        createdAt: sale.createdAt, delivery: sale.delivery,
        loyaltyPointsEarned: Number(sale.loyaltyPointsEarned || 0),
      }));
    return paginated(orders, query);
  }

  if (route === '/store/orders/track' && method === 'GET') {
    const orderCode = String(query.get('orderCode') || '').trim().toUpperCase();
    const phone = normalizeVietnamPhone(query.get('phone'));
    if (!orderCode || !phone) throw createError('Nhập mã đơn hàng và số điện thoại đặt hàng.', 400);
    const sale = data.sales.find((item) => item.isWebOrder && item.invoiceNo === orderCode && normalizeVietnamPhone(item.delivery?.phone || item.customerPhone) === phone);
    if (!sale) throw createError('Không tìm thấy đơn hàng khớp mã đơn và số điện thoại.', 404);
    return {
      order: {
        invoiceNo: sale.invoiceNo,
        status: sale.fulfillmentStatus || sale.status,
        paymentStatus: sale.paymentStatus,
        paymentMethod: sale.paymentMethod || 'cash_on_delivery',
        totalAmount: sale.totalAmount,
        createdAt: sale.createdAt,
        deliveredAt: sale.deliveredAt || null,
        delivery: sale.delivery,
        loyaltyPointsEarned: Number(sale.loyaltyPointsEarned || 0),
        isMemberOrder: Boolean(sale.memberCustomerId),
        memberPointsNotice: sale.memberCustomerId ? 'Điểm chỉ được cộng sau khi giao hàng thành công.' : 'Đơn khách vãng lai không được tích điểm thành viên.',
      },
    };
  }

  // Khách được gửi yêu cầu trợ giúp mà không cần tài khoản; mã hỗ trợ + số điện thoại là khóa tra cứu.
  if (route === '/store/support/requests' && method === 'POST') {
    requireDataProcessingConsent(body);
    const fullName = String(body.fullName || '').trim();
    const phone = normalizeVietnamPhone(body.phone);
    const email = String(body.email || '').trim().toLowerCase();
    const orderCode = String(body.orderCode || '').trim().toUpperCase();
    const category = String(body.category || 'other').trim();
    const message = String(body.message || '').trim();
    const allowedCategories = ['payment_qr', 'payment_pending', 'payment_mismatch', 'website_error', 'order_delivery', 'product', 'other'];
    if (fullName.length < 2 || fullName.length > 100) throw createError('Họ tên liên hệ phải từ 2 đến 100 ký tự.');
    if (!phone) throw createError('Số điện thoại liên hệ chưa đúng định dạng.');
    if (email && (email.length > 190 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) throw createError('Email chưa đúng định dạng.');
    if (orderCode && !/^WEB-[0-9]{5,12}$/.test(orderCode)) throw createError('Mã đơn hàng không đúng định dạng.');
    if (orderCode) {
      const relatedOrder = data.sales.find((item) => item.isWebOrder === true && item.invoiceNo === orderCode
        && normalizeVietnamPhone(item.delivery?.phone || item.customerPhone) === phone);
      if (!relatedOrder) throw createError('Không tìm thấy đơn hàng khớp mã đơn và số điện thoại.', 404);
    }
    if (!allowedCategories.includes(category)) throw createError('Nhóm vấn đề hỗ trợ không hợp lệ.');
    if (message.length < 10 || message.length > 2000) throw createError('Mô tả vấn đề phải từ 10 đến 2.000 ký tự.');
    const id = nextId(data, 'supportRequests');
    const now = new Date().toISOString();
    const request = {
      id, caseCode: `HT-${String(id).padStart(5, '0')}`,
      orderCode: orderCode || null, fullName, phone, email: email || null,
      category, message, status: 'new', publicReply: '', internalNote: '',
      createdAt: now, updatedAt: now,
    };
    data.supportRequests.unshift(request);
    recordDataConsent(data, {
      supportRequestId: id, source: 'customer_support_request',
      processing: body.dataProcessingConsent === true,
    });
    recordActivity(data, null, 'store.support_request_created', { supportRequestId: id, caseCode: request.caseCode, category });
    return persist({ data: { id, caseCode: request.caseCode, status: request.status, createdAt: now }, message: 'Đã gửi yêu cầu hỗ trợ. Hãy lưu mã hỗ trợ để tra cứu phản hồi.' });
  }

  if (route === '/store/support/track' && method === 'GET') {
    const caseCode = String(query.get('caseCode') || '').trim().toUpperCase();
    const phone = normalizeVietnamPhone(query.get('phone'));
    if (!/^HT-[0-9]{5,8}$/.test(caseCode) || !phone) throw createError('Nhập mã hỗ trợ và đúng số điện thoại liên hệ.', 400);
    const request = data.supportRequests.find((item) => item.caseCode === caseCode && normalizeVietnamPhone(item.phone) === phone);
    if (!request) throw createError('Không tìm thấy yêu cầu hỗ trợ khớp mã và số điện thoại.', 404);
    return { ticket: {
      caseCode: request.caseCode, orderCode: request.orderCode || null,
      category: request.category, message: request.message, status: request.status,
      publicReply: request.publicReply || '', createdAt: request.createdAt, updatedAt: request.updatedAt,
    } };
  }

  if (route === '/store/orders/cancel' && method === 'POST') {
    const orderCode = String(body.orderCode || '').trim().toUpperCase();
    const phone = normalizeVietnamPhone(body.phone);
    const reason = String(body.reason || 'Khách hàng yêu cầu hủy đơn qua trang tra cứu').slice(0, 200);
    if (!orderCode || !phone) throw createError('Vui lòng cung cấp mã đơn hàng và số điện thoại.', 400);
    const sale = data.sales.find((item) => item.isWebOrder && item.invoiceNo === orderCode && normalizeVietnamPhone(item.delivery?.phone || item.customerPhone) === phone);
    if (!sale) throw createError('Không tìm thấy đơn hàng khớp thông tin.', 404);
    if (sale.fulfillmentStatus === 'cancelled') throw createError('Đơn hàng này đã được hủy trước đó.', 409);
    if (['preparing', 'shipping', 'delivered'].includes(sale.fulfillmentStatus)) {
      throw createError('Đơn hàng đã được xuất kho hoặc đang giao, không thể tự hủy trên web. Vui lòng liên hệ hotline.', 409);
    }
    if (sale.paymentStatus === 'completed') {
      throw createError('Đơn hàng đã thanh toán online thành công. Vui lòng liên hệ hỗ trợ để thực hiện thủ tục hoàn tiền.', 409);
    }
    if (!sale.inventoryReservationReleased) {
      for (const line of sale.items || []) {
        changeStock(data, null, line.productId, sale.branchId, line.quantity, 'web_order_cancelled_by_customer', sale.invoiceNo, 'Khách hàng hủy đơn online');
      }
      sale.inventoryReservationReleased = true;
    }
    if (sale.memberCustomerId && Number(sale.loyaltyPointsUsed || 0) > 0 && !sale.loyaltyPointsRestored) {
      const member = data.customers.find((item) => item.id === sale.memberCustomerId && item.isMember);
      if (member) creditLoyaltyPoints(member, Number(sale.loyaltyPointsUsed));
      sale.loyaltyPointsRestored = true;
    }
    if (sale.promotionCode && !sale.promotionUsageReleased) {
      const promo = data.promotions.find((item) => item.code === sale.promotionCode);
      if (promo && Number(promo.usedCount) > 0) promo.usedCount = Math.max(0, Number(promo.usedCount) - 1);
      sale.promotionUsageReleased = true;
    }
    sale.status = 'cancelled';
    sale.fulfillmentStatus = 'cancelled';
    sale.paymentStatus = 'cancelled';
    sale.cancelledAt = new Date().toISOString();
    sale.cancelReason = reason;
    recordActivity(data, null, 'store.order_cancelled_by_customer', { invoiceNo: sale.invoiceNo, reason });
    return persist({ ok: true, message: 'Đã hủy đơn hàng thành công và giải phóng kho hàng.' });
  }

  if (route === '/store/warranty/check' && method === 'GET') {
    const keyword = String(query.get('keyword') || query.get('phone') || '').trim();
    if (!keyword) throw createError('Vui lòng nhập số điện thoại hoặc mã bảo hành.', 400);
    const phone = normalizeVietnamPhone(keyword);
    const code = keyword.toUpperCase();
    const matched = data.warranties.filter((w) => {
      if (code && w.code && w.code.toUpperCase() === code) return true;
      if (phone) {
        const customer = data.customers.find((c) => c.id === w.customerId);
        if (customer && normalizeVietnamPhone(customer.phone) === phone) return true;
      }
      return false;
    }).map((w) => {
      const branch = data.branches.find((b) => b.id === w.branchId);
      const product = data.products.find((p) => p.id === w.productId);
      const endTimestamp = Date.parse(w.endDate);
      const now = Date.now();
      const daysRemaining = Number.isNaN(endTimestamp) ? 0 : Math.max(0, Math.ceil((endTimestamp - now) / 86400000));
      const isExpired = daysRemaining <= 0;
      return {
        id: w.id,
        code: w.code,
        productName: w.productName || product?.name || 'Sản phẩm',
        productSku: product?.sku || '-',
        customerName: w.customerName || 'Khách hàng',
        branchName: branch?.name || 'Hệ thống EMSystems',
        startDate: w.startDate,
        endDate: w.endDate,
        status: isExpired ? 'expired' : (w.status || 'active'),
        daysRemaining,
      };
    });
    return { data: matched, count: matched.length };
  }

  if (route === '/store/orders' && method === 'POST') {
    const paymentMethod = String(body.paymentMethod || 'cash_on_delivery');
    if (!['cash_on_delivery', 'momo_sandbox', 'vnpay_sandbox', 'vietqr_transfer'].includes(paymentMethod)) {
      throw createError('Phương thức thanh toán không được hỗ trợ.');
    }
    const fullName = String(body.fullName || '').trim();
    const phone = normalizeVietnamPhone(body.phone);
    const email = String(body.email || '').trim().toLowerCase();
    const streetAddress = String(body.address || '').trim();
    const ward = String(body.ward || '').trim();
    const note = String(body.note || '').trim();
    const deliveryArea = getDeliveryArea(data, body.deliveryAreaId);
    let deliveryQuote = null;
    if (body.deliveryCoordinates !== undefined && body.deliveryCoordinates !== null) {
      const coordinates = body.deliveryCoordinates;
      if (!coordinates || typeof coordinates !== 'object' || Array.isArray(coordinates)) {
        throw createError('Tọa độ giao hàng không hợp lệ. Hãy định vị lại hoặc chọn khu vực thủ công.');
      }
      const latitude = Number(coordinates.latitude);
      const longitude = Number(coordinates.longitude);
      const nearestArea = findNearestSupportedDeliveryArea(data.deliveryAreas, latitude, longitude);
      if (!nearestArea || Number(nearestArea.area.id) !== Number(deliveryArea?.id)) {
        throw createError('Vị trí không khớp khu vực giao hàng đã chọn. Hãy định vị lại hoặc chọn khu vực thủ công.', 409);
      }
      deliveryQuote = calculateDeliveryQuote(deliveryArea?.branchId, latitude, longitude);
      if (!deliveryQuote.available) throw createError(deliveryQuote.reason || 'Vị trí nằm ngoài phạm vi giao hàng hỗ trợ.', 409);
    }
    const member = getSessionMember(data);
    const deliveryBranch = deliveryArea
      ? data.branches.find((branch) => branch.id === Number(deliveryArea.branchId) && branch.isActive !== false)
      : null;
    if (fullName.length < 2 || fullName.length > 100) throw createError('Họ tên người nhận phải từ 2 đến 100 ký tự.');
    if (!phone) throw createError('Số điện thoại nhận hàng chưa đúng định dạng. Ví dụ: 0905123456.');
    requirePhoneVerificationForSession(phone);
    requireDataProcessingConsent(body);
    if (body.deliveryCoordinates && process.env.EMSYSTEMS_REQUIRE_DATA_CONSENT === 'true' && body.locationConsent !== true) {
      throw createError('Cần đồng ý riêng với việc sử dụng vị trí để tính phí giao hàng.', 400);
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw createError('Email chưa đúng định dạng.');
    if (streetAddress.length < 5 || streetAddress.length > 220) throw createError('Nhập số nhà, tên đường hoặc địa chỉ cụ thể từ 5 đến 220 ký tự.');
    if (ward.length < 2 || ward.length > 100) throw createError('Nhập phường/xã để shipper tìm đúng địa chỉ.');
    if (!deliveryArea || !deliveryBranch) throw createError('Khu vực giao hàng chưa được hỗ trợ hoặc chi nhánh phục vụ đã ngừng hoạt động. Hãy chọn khu vực khác.', 409);
    if (member && normalizeVietnamPhone(member.phone) !== phone) throw createError('Số điện thoại đặt hàng cần trùng số thẻ thành viên để áp dụng ưu đãi và tích điểm.');
    const incoming = Array.isArray(body.items) ? body.items : [];
    if (!incoming.length || incoming.length > 30) throw createError('Giỏ hàng cần từ 1 đến 30 dòng sản phẩm.');
    if (incoming.some((line) => !line || typeof line !== 'object' || Array.isArray(line))) throw createError('Mỗi dòng giỏ hàng phải có mã sản phẩm và số lượng hợp lệ.');
    if (new Set(incoming.map((line) => Number(line.productId))).size !== incoming.length) throw createError('Không được lặp sản phẩm trong giỏ hàng.');
    let subtotal = 0;
    const saleItems = incoming.map((line, index) => {
      const product = data.products.find((item) => item.id === Number(line.productId));
      const quantity = Number(line.quantity);
      if (!product || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 50) throw createError('Có sản phẩm hoặc số lượng trong giỏ hàng không hợp lệ.');
      if (product.isActive === false) throw createError(`${product.name} chưa được cửa hàng mở bán.`, 409);
      if (!Number.isSafeInteger(Number(product.sellingPrice)) || Number(product.sellingPrice) <= 0) throw createError(`${product.name} chưa được cửa hàng định giá bằng VNĐ nên chưa thể đặt hàng.`, 409);
      if (stockQuantity(data, product.id, deliveryArea.branchId) < quantity) throw createError(`${product.name} không đủ tồn tại ${deliveryArea.district}. Hãy giảm số lượng hoặc chọn khu vực khác.`, 409);
      const unitPrice = Number(product.sellingPrice);
      const unitCost = Number(product.costPrice ?? 0);
      const lineTotal = unitPrice * quantity;
      if (!Number.isSafeInteger(unitCost) || unitCost < 0
        || !Number.isSafeInteger(lineTotal) || !Number.isSafeInteger(subtotal + lineTotal)) {
        throw createError('Giá vốn hoặc tổng tiền trong giỏ hàng vượt giới hạn tính toán an toàn.');
      }
      subtotal += lineTotal;
      return { id: index + 1, productId: product.id, productName: product.name, quantity, unitPrice, costPrice: unitCost, lineTotal, returnedQuantity: 0, returnedAmount: 0 };
    });

    const promotionCode = String(body.promotionCode || '').trim().toUpperCase();
    let promotion = null;
    let promotionDiscount = 0;
    if (promotionCode) {
      promotion = data.promotions.find((item) => String(item.code || '').trim().toUpperCase() === promotionCode && item.isActive !== false);
      const now = Date.now();
      const startAt = Date.parse(promotion?.startAt);
      const endAt = Date.parse(promotion?.endAt);
      const discountValue = Number(promotion?.discountValue);
      const discountType = promotion?.discountType;
      const minimumOrder = Number(promotion?.minimumOrder ?? 0);
      const usedCount = Number(promotion?.usedCount ?? 0);
      const reservedCount = Number(promotion?.reservedCount ?? 0);
      if (!promotion || !Number.isFinite(startAt) || !Number.isFinite(endAt)
        || now < startAt || now > endAt
        || (promotion.memberOnly === true && !member)
        || !Number.isSafeInteger(minimumOrder) || minimumOrder < 0 || subtotal < minimumOrder
        || !Number.isSafeInteger(discountValue) || discountValue <= 0
        || !['percent', 'amount'].includes(discountType)
        || (discountType === 'percent' && discountValue > 100)
        || !Number.isSafeInteger(usedCount) || usedCount < 0
        || !Number.isSafeInteger(reservedCount) || reservedCount < 0
        || (promotion.usageLimit != null
          && (!Number.isSafeInteger(Number(promotion.usageLimit)) || Number(promotion.usageLimit) < 1
            || usedCount + reservedCount >= Number(promotion.usageLimit)))) {
        throw createError('Mã ưu đãi không hợp lệ, hết lượt hoặc đơn hàng/khách hàng chưa đủ điều kiện.');
      }
      promotionDiscount = discountType === 'percent'
        ? Math.floor(subtotal * discountValue / 100)
        : Math.min(subtotal, discountValue);
      if (!Number.isSafeInteger(promotionDiscount) || promotionDiscount < 0 || promotionDiscount > subtotal) {
        throw createError('Giá trị giảm giá không hợp lệ.');
      }
    }
    const maxPointsDiscount = Math.max(0, subtotal - promotionDiscount);
    const availablePoints = Math.max(0, Math.trunc(Number(member?.loyaltyPoints || 0)));
    const pointsRedeemed = member && body.usePoints === true
      ? Math.min(availablePoints, Math.floor(maxPointsDiscount / 100))
      : 0;
    const pointsDiscount = pointsRedeemed * 100;
    const totalDiscount = promotionDiscount + pointsDiscount;
    const shippingFee = deliveryQuote ? Number(deliveryQuote.shippingFee) : Number(deliveryArea.shippingFee);
    if (!Number.isSafeInteger(shippingFee) || shippingFee < 0) throw createError('Phí giao hàng của khu vực chưa hợp lệ.');
    const deliveryEta = deliveryQuote?.eta || deliveryArea.eta;
    const totalAmount = subtotal - totalDiscount + shippingFee;
    if (!Number.isSafeInteger(totalDiscount) || totalDiscount < 0 || totalDiscount > subtotal
      || !Number.isSafeInteger(totalAmount) || totalAmount < 0) throw createError('Tổng đơn hàng vượt giới hạn tính toán an toàn.');
    if (paymentMethod === 'vietqr_transfer' && (totalAmount < 1000 || totalAmount > 100_000_000)) {
      throw createError('Tổng tiền đơn VietQR phải từ 1.000đ đến 100.000.000đ. Hãy chọn phương thức khác nếu đơn nằm ngoài giới hạn này.');
    }
    let discountAllocated = 0;
    saleItems.forEach((line, index) => {
      const lineDiscount = index === saleItems.length - 1
        ? totalDiscount - discountAllocated
        : (subtotal ? Math.floor(totalDiscount * line.lineTotal / subtotal) : 0);
      discountAllocated += lineDiscount;
      line.netLineTotal = line.lineTotal - lineDiscount;
    });

    // Liên kết hồ sơ khách hàng để giao hàng; chỉ phiên thành viên đang đăng nhập mới được nhận điểm.
    let customer = data.customers.find((item) => normalizeVietnamPhone(item.phone) === phone);
    if (customer?.isActive === false) throw createError('Hồ sơ khách hàng này đã ngừng hoạt động; không thể tạo đơn mới bằng số điện thoại đó.', 409);
    if (!customer) {
      customer = {
        id: nextId(data, 'customers'),
        code: `CUS-${String(data.nextIds.customers - 1).padStart(4, '0')}`,
        fullName, phone, email, address: streetAddress, city: deliveryArea.city,
        district: deliveryArea.district, ward, isActive: true, isMember: false,
        loyaltyPoints: 0, memberTier: 'Chưa đăng ký', memberSince: null,
      };
      data.customers.unshift(customer);
    } else {
      Object.assign(customer, { fullName, phone, email: email || customer.email || '', address: streetAddress, city: deliveryArea.city, district: deliveryArea.district, ward });
    }
    const id = nextId(data, 'sales');
    const createdAt = new Date().toISOString();
    const sale = {
      id, invoiceNo: `WEB-${String(id).padStart(5, '0')}`,
      orderChannel: 'web', isWebOrder: true, customerId: customer.id,
      memberCustomerId: member?.id || null, customerName: fullName, customerPhone: phone,
      branchId: Number(deliveryArea.branchId), cashierId: null,
      status: 'pending_confirmation', fulfillmentStatus: 'pending_confirmation',
      paymentStatus: paymentMethod === 'cash_on_delivery' ? 'pending_cod' : 'pending_payment',
      paymentMethod,
      paymentProvider: paymentMethod === 'momo_sandbox' ? 'momo'
        : paymentMethod === 'vnpay_sandbox' ? 'vnpay'
          : paymentMethod === 'vietqr_transfer' ? 'vietqr' : 'cod',
      subtotal, discountAmount: totalDiscount, promotionDiscountAmount: promotionDiscount,
      pointsDiscountAmount: pointsDiscount, loyaltyPointsUsed: pointsRedeemed,
      loyaltyPointsEarned: 0, loyaltyPointsAwarded: false, loyaltyPointsRestored: false,
      promotionCode: promotion?.code || null, promotionUsageReleased: false,
      shippingFee, totalAmount, returnedAmount: 0,
      createdAt, note,
      paymentExpiresAt: paymentMethod === 'cash_on_delivery' ? null : new Date(Date.parse(createdAt) + 15 * 60_000).toISOString(),
      inventoryReservationReleased: false,
      notificationPreferences: {
        email: body.notificationPreferences?.email === true,
        sms: body.notificationPreferences?.sms === true,
        zaloZns: body.notificationPreferences?.zaloZns === true,
      },
      delivery: {
        recipientName: fullName, phone, email, city: deliveryArea.city,
        district: deliveryArea.district, ward, address: streetAddress,
        note, areaId: deliveryArea.id, areaName: `${deliveryArea.district}, ${deliveryArea.city}`,
        shippingFee, eta: deliveryEta,
        estimatedDistanceKm: deliveryQuote ? Math.round(deliveryQuote.distanceKm * 10) / 10 : null,
      },
      items: saleItems,
    };
    // Trừ tồn để giữ chỗ đơn giao tận nhà; nếu đơn bị hủy, bước hủy sẽ hoàn lại tồn đúng một lần.
    for (const line of saleItems) changeStock(data, null, line.productId, sale.branchId, -line.quantity, 'web_order_reserved', sale.invoiceNo, 'Giữ hàng cho đơn giao tận nhà');
    if (member && pointsRedeemed > 0) member.loyaltyPoints = Math.max(0, Number(member.loyaltyPoints || 0) - pointsRedeemed);
    if (promotion) promotion.usedCount = Number(promotion.usedCount || 0) + 1;
    data.sales.unshift(sale);
    recordDataConsent(data, {
      customerId: customer.id, saleId: sale.id, source: 'guest_or_member_checkout',
      processing: body.dataProcessingConsent === true,
      marketing: body.marketingConsent === true,
      channels: sale.notificationPreferences,
      locationConsent: body.locationConsent === true && Boolean(body.deliveryCoordinates),
    });
    enqueueCustomerNotification(data, sale, 'order_placed', 'Đã tiếp nhận đơn');
    data.payments.unshift({
      id: nextId(data, 'payments'), saleId: id, method: paymentMethod,
      status: 'pending', amount: sale.totalAmount, referenceNo: sale.invoiceNo, createdAt,
    });
    recordActivity(data, null, 'store.order_placed', { saleId: id, invoiceNo: sale.invoiceNo, member: Boolean(member) });
    const persistenceResult = persist({ ok: true });
    return {
      storageSaved: persistenceResult.storageSaved !== false,
      message: persistenceResult.storageSaved === false
        ? persistenceResult.message
        : 'Đã ghi nhận đơn giao hàng demo. Cửa hàng cần xác nhận đơn trước khi shipper giao hàng.',
      order: {
        id: sale.id, invoiceNo: sale.invoiceNo, status: sale.fulfillmentStatus,
        paymentStatus: sale.paymentStatus, paymentMethod: sale.paymentMethod, paymentProvider: sale.paymentProvider,
        subtotal, discountAmount: totalDiscount,
        promotionDiscountAmount: promotionDiscount, pointsDiscountAmount: pointsDiscount,
        shippingFee, totalAmount: sale.totalAmount, createdAt, eta: deliveryEta,
        estimatedDistanceKm: deliveryQuote ? Math.round(deliveryQuote.distanceKm * 10) / 10 : null,
        memberCustomerId: sale.memberCustomerId, pointsExpectedOnDelivery: member ? Math.floor(Math.max(0, subtotal - totalDiscount) / 10000) : 0,
        notice: member ? 'Điểm dự kiến chỉ cộng sau khi giao thành công.' : 'Bạn đặt hàng không đăng nhập thành viên nên đơn này không được tích điểm.',
      },
    };
  }

  // Chỉ đồng bộ trạng thái thanh toán online sau khi payment server xác thực token, chữ ký/IPN và số tiền.
  if (route === '/store/orders/sync-payment' && method === 'POST') {
    const paymentId = String(body.paymentId || '').trim();
    const token = String(body.paymentToken || '').trim();
    const statusResponse = body.verifiedPaymentStatus;
    if (!/^[A-Za-z0-9_-]{20,100}$/.test(paymentId) || !/^[a-f0-9]{64}$/i.test(token)
      || !statusResponse || typeof statusResponse !== 'object' || Array.isArray(statusResponse)) {
      throw createError('Thông tin kiểm tra thanh toán không hợp lệ.', 400);
    }
    if (!/^[0-9]{10,20}[a-f0-9]{20,40}$/i.test(paymentId)
      || statusResponse.paymentId !== paymentId
      || !/^WEB-[0-9]{5,12}$/.test(String(statusResponse.orderId || ''))
      || !['momo', 'vnpay'].includes(statusResponse.provider)
      || !['pending', 'paid', 'failed'].includes(statusResponse.status)
      || !Number.isSafeInteger(Number(statusResponse.amount))) {
      throw createError('Dữ liệu xác minh từ payment server không hợp lệ.', 409);
    }
    const result = applyGatewaySettlement({
      paymentId, orderId: statusResponse.orderId, provider: statusResponse.provider,
      amount: Number(statusResponse.amount), status: statusResponse.status,
      transactionId: statusResponse.transactionId || null,
    });
    if (statusResponse.status !== 'pending') persist({ ok: true });
    return result;
  }

  if (route === '/auth/register' && method === 'POST') {
    const username = String(body.username || '').trim();
    const normalizedUsername = username.toLocaleLowerCase('vi');
    const fullName = String(body.fullName || '').trim();
    const email = String(body.email || '').trim().toLowerCase();
    const phone = normalizeVietnamPhone(body.phone);
    const password = String(body.password || '');
    const confirmPassword = String(body.confirmPassword || '');
    if (!/^[a-zA-Z0-9._-]{3,60}$/.test(username)) throw createError('Tên đăng nhập phải dài 3–60 ký tự và chỉ dùng chữ, số, dấu chấm, gạch ngang hoặc gạch dưới.', 400);
    if (fullName.length < 2 || fullName.length > 150) throw createError('Họ tên phải dài từ 2 đến 150 ký tự.', 400);
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 190) throw createError('Email chưa đúng định dạng.', 400);
    if (!phone) throw createError('Số điện thoại Việt Nam chưa đúng định dạng.', 400);
    requirePhoneVerificationForSession(phone);
    requireDataProcessingConsent(body);
    if (password.length < 12 || password.length > 200) throw createError('Mật khẩu phải dài từ 12 đến 200 ký tự.', 400);
    if (password !== confirmPassword) throw createError('Mật khẩu xác nhận không khớp.', 400);
    if (data.users.some((item) => String(item.username || '').trim().toLocaleLowerCase('vi') === normalizedUsername)) throw createError('Tên đăng nhập đã tồn tại.', 409);
    if (data.users.some((item) => String(item.email || '').trim().toLowerCase() === email)) throw createError('Email đã được sử dụng.', 409);
    if (data.users.some((item) => item.role === 'customer' && normalizeVietnamPhone(item.phone) === phone)) throw createError('Số điện thoại đã được liên kết với một tài khoản khách hàng.', 409);

    let customer = data.customers.find((item) => normalizeVietnamPhone(item.phone) === phone);
    if (customer?.isActive === false) throw createError('Hồ sơ khách hàng này đã ngừng hoạt động; hãy liên hệ cửa hàng.', 409);
    if (customer && data.users.some((item) => item.role === 'customer' && Number(item.customerId) === Number(customer.id))) throw createError('Hồ sơ này đã có tài khoản đăng nhập.', 409);
    if (!customer) {
      customer = {
        id: nextId(data, 'customers'),
        code: `CUS-${String(data.nextIds.customers - 1).padStart(4, '0')}`,
        fullName, phone, email, address: '', city: '', district: '', ward: '',
        isActive: true, isMember: true, loyaltyPoints: 0, memberTier: 'Đồng',
        memberSince: new Date().toISOString(),
      };
      data.customers.unshift(customer);
    } else {
      Object.assign(customer, {
        fullName, phone, email, isMember: true,
        loyaltyPoints: Number(customer.loyaltyPoints || 0),
        memberTier: customer.memberTier || tierForPoints(customer.loyaltyPoints),
        memberSince: customer.memberSince || new Date().toISOString(),
      });
    }

    let passwordCredential;
    try {
      passwordCredential = await createPasswordCredential(password);
    } catch {
      throw createError('Không thể thiết lập verifier mật khẩu trong trình duyệt này. Hãy dùng trình duyệt hỗ trợ Web Crypto.', 503);
    }
    const user = {
      id: nextId(data, 'users'), username, email, fullName, phone,
      role: 'customer', branchId: null, customerId: customer.id,
      isActive: true, passwordCredential, credentialVersion: 1,
      mustChangePassword: false, createdAt: new Date().toISOString(),
    };
    customer.userId = user.id;
    data.users.unshift(user);
    recordDataConsent(data, {
      userId: user.id, customerId: customer.id, source: 'customer_registration',
      processing: body.dataProcessingConsent === true,
      marketing: body.marketingConsent === true,
    });
    recordActivity(data, user, 'auth.customer_registered', { customerId: customer.id, role: 'customer' });

    try {
      clearStaffSession();
      window.sessionStorage.removeItem(MEMBER_SESSION_KEY);
      const issuedAt = Date.now();
      window.sessionStorage.setItem(SESSION_KEY, JSON.stringify({ userId: user.id, authVersion: 3, credentialVersion: 1, issuedAt, lastActivityAt: issuedAt }));
      window.sessionStorage.setItem(MEMBER_SESSION_KEY, JSON.stringify({ customerId: customer.id }));
      window.sessionStorage.removeItem(PHONE_VERIFIED_SESSION_KEY);
      window.sessionStorage.removeItem(`${PHONE_VERIFIED_SESSION_KEY}.at`);
    } catch {
      clearStaffSession();
      try { window.sessionStorage.removeItem(MEMBER_SESSION_KEY); } catch { /* Fail closed if browser storage is unavailable. */ }
      data.users = data.users.filter((item) => item.id !== user.id);
      if (customer.userId === user.id) delete customer.userId;
      throw createError('Trình duyệt không thể tạo phiên đăng nhập. Hãy cho phép sessionStorage rồi thử lại.', 503);
    }
    const storageSaved = writeData(data);
    return { user: safeUser(user), storageSaved, message: 'Đăng nhập thành công.' };
  }

  if (route === '/auth/login' && method === 'POST') {
    const identifier = String(body.username || body.identifier || '').trim();
    const normalizedIdentifier = identifier.toLocaleLowerCase('vi');
    const phoneIdentifier = normalizeVietnamPhone(identifier);
    const password = String(body.password || '');
    if (!identifier || !password) throw createError('Nhập tài khoản và mật khẩu.', 400);
    const user = data.users.find((item) => item.isActive !== false && (
      String(item.username || '').trim().toLocaleLowerCase('vi') === normalizedIdentifier
      || String(item.email || '').trim().toLowerCase() === normalizedIdentifier
      || (item.role === 'customer' && phoneIdentifier && normalizeVietnamPhone(item.phone) === phoneIdentifier)
    ));
    if (user?.role === 'customer') {
      const linkedCustomer = data.customers.find((item) => Number(item.id) === Number(user.customerId) && item.isMember === true && item.isActive !== false);
      if (!linkedCustomer) throw createError('Tài khoản khách hàng hiện không hoạt động.', 403);
    }
    // Vai trò được lấy từ hồ sơ tài khoản sau khi kiểm tra thông tin, không do giao diện chọn.
    const credentialValid = await verifyDemoCredential(user?.username || normalizedIdentifier, password, user).catch(() => false);
    if (!user || !credentialValid) {
      recordActivity(data, null, 'auth.login_failed', {
        attemptedUsername: normalizedIdentifier.slice(0, 60),
        reason: user ? 'invalid_credentials' : 'unknown_or_inactive_account',
      });
      writeData(data);
      throw createError('Tên đăng nhập hoặc mật khẩu không đúng.', 401);
    }
    user.credentialVersion = Math.max(1, Number(user.credentialVersion) || 1);
    try {
      clearStaffSession();
      window.sessionStorage.removeItem(MEMBER_SESSION_KEY);
      const issuedAt = Date.now();
      window.sessionStorage.setItem(SESSION_KEY, JSON.stringify({
        userId: user.id,
        authVersion: 3,
        credentialVersion: Number(user.credentialVersion) || 1,
        issuedAt,
        lastActivityAt: issuedAt,
      }));
      if (user.role === 'customer') window.sessionStorage.setItem(MEMBER_SESSION_KEY, JSON.stringify({ customerId: Number(user.customerId) }));
    } catch {
      clearStaffSession();
      try { window.sessionStorage.removeItem(MEMBER_SESSION_KEY); } catch { /* Fail closed if browser storage is unavailable. */ }
      recordActivity(data, null, 'auth.login_failed', {
        attemptedUsername: normalizedIdentifier.slice(0, 60),
        reason: 'session_storage_unavailable',
      });
      writeData(data);
      throw createError('Trình duyệt không thể tạo phiên đăng nhập. Hãy cho phép sessionStorage rồi thử lại.', 503);
    }
    user.lastLoginAt = new Date().toISOString();
    recordActivity(data, user, 'auth.login_succeeded', { role: user.role });
    const storageSaved = writeData(data);
    return { user: safeUser(user), storageSaved, message: 'Đăng nhập thành công.' };
  }
  if (route === '/auth/change-password' && method === 'POST') {
    const user = getSessionUser(data);
    if (!user) throw createError('Phiên đăng nhập đã hết hạn; hãy đăng nhập lại.', 401);
    const currentPassword = String(body.currentPassword || '');
    const newPassword = String(body.newPassword || '');
    const confirmPassword = String(body.confirmPassword || '');
    if (newPassword.length < 12 || newPassword.length > 200) throw createError('Mật khẩu mới phải dài từ 12 đến 200 ký tự.', 400);
    if (newPassword !== confirmPassword) throw createError('Mật khẩu xác nhận không khớp.', 400);
    if (newPassword === currentPassword) throw createError('Mật khẩu mới phải khác mật khẩu hiện tại.', 400);
    const currentValid = await verifyDemoCredential(user.username, currentPassword, user).catch(() => false);
    if (!currentValid) {
      recordActivity(data, user, 'auth.password_change_failed', { reason: 'invalid_current_password' });
      writeData(data);
      throw createError('Mật khẩu hiện tại không đúng.', 401);
    }
    try {
      user.passwordCredential = await createPasswordCredential(newPassword);
    } catch {
      throw createError('Không thể cập nhật verifier mật khẩu. Dữ liệu hiện tại chưa được thay đổi.', 503);
    }
    user.credentialVersion = (Number(user.credentialVersion) || 1) + 1;
    user.mustChangePassword = false;
    user.passwordChangedAt = new Date().toISOString();
    recordActivity(data, user, 'auth.password_changed', { credentialVersion: user.credentialVersion });
    const saved = persist({ ok: true, message: 'Đã đổi mật khẩu. Vì an toàn, tất cả phiên cũ đã bị thu hồi; hãy đăng nhập lại bằng mật khẩu mới.' });
    clearStaffSession();
    return saved;
  }
  if (route === '/auth/logout' && method === 'POST') {
    const user = getSessionUser(data);
    if (user) {
      recordActivity(data, user, 'auth.logout');
      writeData(data);
    }
    clearStaffSession();
    try { window.sessionStorage.removeItem(MEMBER_SESSION_KEY); } catch { /* Don't block logout. */ }
    return { ok: true };
  }
  if (route === '/auth/me') {
    const user = getSessionUser(data);
    if (!user) throw createError('Chưa có phiên demo. Hãy đăng nhập lại.', 401);
    return { user: safeUser(user) };
  }
  if (route === '/auth/password-reset/request' && method === 'POST') {
    const email = String(body.email || body.identifier || '').trim().toLowerCase();
    if (!email) throw createError('Vui lòng nhập email hoặc tên đăng nhập.', 400);
    const targetUser = data.users.find((u) => u.isActive !== false && (String(u.email || '').trim().toLowerCase() === email || String(u.username || '').trim().toLowerCase() === email));
    if (!Array.isArray(data.passwordResets)) data.passwordResets = [];
    if (!targetUser) {
      return { ok: true, message: 'Nếu thông tin khớp với tài khoản, hướng dẫn khôi phục đã được tạo.' };
    }
    const token = Array.from(globalThis.crypto.getRandomValues(new Uint8Array(24)), (b) => b.toString(16).padStart(2, '0')).join('');
    data.passwordResets = data.passwordResets.filter((r) => r.userId !== targetUser.id);
    data.passwordResets.push({
      token,
      userId: targetUser.id,
      expiresAt: Date.now() + 30 * 60 * 1000,
    });
    recordActivity(data, targetUser, 'auth.password_reset_requested', { userId: targetUser.id });
    writeData(data);
    return {
      ok: true,
      message: 'Đã tạo liên kết khôi phục mật khẩu demo.',
      demoResetUrl: `/reset-password#token=${token}`,
      demoToken: token,
    };
  }
  if (route === '/auth/password-reset/confirm' && method === 'POST') {
    const token = String(body.token || '').trim();
    const password = String(body.password || '');
    const confirmPassword = String(body.confirmPassword || '');
    if (!token) throw createError('Thiếu mã token khôi phục mật khẩu.', 400);
    if (password.length < 12 || password.length > 200) throw createError('Mật khẩu mới phải dài từ 12 đến 200 ký tự.', 400);
    if (password !== confirmPassword) throw createError('Mật khẩu xác nhận không khớp.', 400);
    if (!Array.isArray(data.passwordResets)) data.passwordResets = [];
    const record = data.passwordResets.find((r) => r.token === token && Number(r.expiresAt) > Date.now());
    if (!record) throw createError('Liên kết đặt lại mật khẩu đã hết hạn hoặc không hợp lệ. Vui lòng yêu cầu lại.', 400);
    const targetUser = data.users.find((u) => u.id === record.userId && u.isActive !== false);
    if (!targetUser) throw createError('Tài khoản không tồn tại hoặc đã ngừng hoạt động.', 404);
    targetUser.credential = await createPasswordCredential(password);
    targetUser.credentialVersion = (Number(targetUser.credentialVersion) || 1) + 1;
    targetUser.mustChangePassword = false;
    data.passwordResets = data.passwordResets.filter((r) => r.token !== token);
    recordActivity(data, targetUser, 'auth.password_reset_completed', { userId: targetUser.id });
    writeData(data);
    return { ok: true, message: 'Đã đặt lại mật khẩu thành công. Hãy đăng nhập bằng mật khẩu mới.' };
  }
  if (route === '/auth/phone-verification/start' && method === 'POST') {
    const phone = normalizeVietnamPhone(body.phone);
    if (!phone) throw createError('Số điện thoại chưa hợp lệ.', 400);
    const mockCode = '123456';
    if (!Array.isArray(data.phoneOtps)) data.phoneOtps = [];
    data.phoneOtps = data.phoneOtps.filter((item) => item.phone !== phone);
    data.phoneOtps.push({ phone, code: mockCode, expiresAt: Date.now() + 5 * 60 * 1000 });
    return { ok: true, message: 'Đã gửi mã xác thực qua SMS.', demoCode: mockCode };
  }
  if (route === '/auth/phone-verification/check' && method === 'POST') {
    const phone = normalizeVietnamPhone(body.phone);
    const code = String(body.code || '').trim();
    if (!phone || !code) throw createError('Vui lòng nhập số điện thoại và mã OTP.', 400);
    const valid = code === '123456' || (Array.isArray(data.phoneOtps) && data.phoneOtps.some((item) => item.phone === phone && item.code === code && item.expiresAt > Date.now()));
    if (!valid) throw createError('Mã OTP không đúng hoặc đã hết hạn.', 400);
    return { ok: true, verified: true };
  }
  if (route.startsWith('/auth/')) {
    throw createError('Đường dẫn xác thực không tồn tại.', 404);
  }
  if (route === '/health') return { mode: 'server-backed-demo', storage: 'sqlite', backend: true };

  const user = getSessionUser(data);
  if (!user) {
    throw createError('Vui lòng đăng nhập vào phiên demo.', 401);
  }
  if (user?.mustChangePassword) {
    throw createError('Tài khoản đang dùng mật khẩu tạm. Hãy đổi mật khẩu trước khi sử dụng các phân hệ.', 403);
  }
  if (productReviewsRoute && method === 'POST') {
    if (user.role !== 'customer' || !Number.isSafeInteger(Number(user.customerId))) {
      throw createError('Chỉ tài khoản khách hàng đã đăng nhập mới được đánh giá sản phẩm.', 403);
    }
    const productId = Number(productReviewsRoute[1]);
    const product = data.products.find((item) => item.id === productId && item.isActive !== false && Number(item.sellingPrice) > 0);
    if (!product) throw createError('Không tìm thấy sản phẩm đang mở bán.', 404);
    const customer = data.customers.find((item) => item.id === Number(user.customerId) && item.isMember === true && item.isActive !== false);
    if (!customer) throw createError('Hồ sơ khách hàng không còn hoạt động.', 403);
    const hasDeliveredPurchase = data.sales.some((sale) => sale.isWebOrder === true
      && Number(sale.customerId) === Number(customer.id)
      && ['delivered', 'completed'].includes(sale.fulfillmentStatus || sale.status)
      && Array.isArray(sale.items) && sale.items.some((line) => Number(line.productId) === productId && Number(line.quantity) > 0));
    if (!hasDeliveredPurchase) throw createError('Chỉ được đánh giá sau khi đơn hàng có sản phẩm này đã giao thành công.', 403);
    if (data.productReviews.some((review) => Number(review.customerId) === customer.id && Number(review.productId) === productId)) {
      throw createError('Bạn đã đánh giá sản phẩm này rồi.', 409);
    }
    const rating = Number(body.rating);
    const title = String(body.title || '').trim();
    const reviewBody = String(body.body || '').trim();
    if (!Number.isSafeInteger(rating) || rating < 1 || rating > 5) throw createError('Điểm đánh giá phải là số nguyên từ 1 đến 5.', 400);
    if (title.length < 3 || title.length > 120) throw createError('Tiêu đề đánh giá phải từ 3 đến 120 ký tự.', 400);
    if (reviewBody.length < 10 || reviewBody.length > 2000) throw createError('Nội dung đánh giá phải từ 10 đến 2.000 ký tự.', 400);
    const review = {
      id: nextId(data, 'productReviews'),
      productId,
      customerId: customer.id,
      rating,
      title,
      body: reviewBody,
      reviewerName: String(customer.fullName || 'Khách hàng').slice(0, 80),
      verifiedPurchase: true,
      status: 'published',
      createdAt: new Date().toISOString(),
    };
    data.productReviews.unshift(review);
    recordActivity(data, user, 'store.product_review_created', { productId, reviewId: review.id, rating });
    return persist({ review: publicReview(review), summary: productReviewSummary(data, productId), message: 'Đã lưu đánh giá từ đơn hàng đã giao thành công.' });
  }
  if (user && !canAccessDataRequest(user.role, route, method)) {
    recordActivity(data, user, 'auth.permission_denied', { route, method });
    writeData(data);
    throw createError('Tài khoản không có quyền truy cập dữ liệu hoặc thao tác này.', 403);
  }

  if (route === '/support/requests' && method === 'GET') {
    return paginated([...data.supportRequests].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)), query);
  }
  const supportRequestMatch = route.match(/^\/support\/requests\/(\d+)$/);
  if (supportRequestMatch && method === 'PATCH') {
    const request = data.supportRequests.find((item) => item.id === Number(supportRequestMatch[1]));
    if (!request) throw createError('Không tìm thấy yêu cầu hỗ trợ.', 404);
    const allowedStatuses = ['new', 'in_progress', 'waiting_customer', 'resolved', 'closed'];
    if (body.status !== undefined && !allowedStatuses.includes(String(body.status))) throw createError('Trạng thái yêu cầu hỗ trợ không hợp lệ.');
    const publicReply = body.publicReply === undefined ? request.publicReply : String(body.publicReply || '').trim();
    const internalNote = body.internalNote === undefined ? request.internalNote : String(body.internalNote || '').trim();
    if (publicReply.length > 2000 || internalNote.length > 2000) throw createError('Phản hồi và ghi chú nội bộ không được vượt 2.000 ký tự.');
    Object.assign(request, {
      status: body.status === undefined ? request.status : String(body.status),
      publicReply,
      internalNote,
      updatedAt: new Date().toISOString(),
      assignedTo: user.id,
    });
    recordActivity(data, user, 'support.request_updated', { supportRequestId: request.id, status: request.status });
    return persist({ data: request, message: 'Đã cập nhật yêu cầu hỗ trợ.' });
  }

  // These operations are intentionally reachable only through the authenticated server API.
  // They must run only inside the authenticated server API request context.
  if (route.startsWith('/system/')) {
    if (user.role !== 'admin') throw createError('Chỉ quản trị viên mới được thực hiện thao tác hệ thống.', 403);
    if (route === '/system/bank-accounts' && method === 'GET') {
      return {
        data: [...data.bankAccounts].sort((a, b) => Number(b.isActive) - Number(a.isActive) || Number(b.id) - Number(a.id)),
      };
    }
    if (route === '/system/bank-accounts' && method === 'POST') {
      const bankCode = String(body.bankCode || '').trim().toUpperCase();
      const bankName = String(body.bankName || '').trim();
      const accountNumber = String(body.accountNumber || '').trim();
      const accountName = String(body.accountName || '').trim().replace(/\s+/g, ' ').toLocaleUpperCase('vi');
      if (!/^[A-Z0-9-]{2,30}$/.test(bankCode)) throw createError('Mã ngân hàng VietQR chỉ được chứa chữ, số hoặc dấu gạch nối (2–30 ký tự).');
      if (bankName.length < 2 || bankName.length > 100 || /[<>\r\n]/.test(bankName)) throw createError('Tên ngân hàng phải từ 2 đến 100 ký tự.');
      if (!/^\d{6,19}$/.test(accountNumber)) throw createError('Số tài khoản phải có từ 6 đến 19 chữ số.');
      if (accountName.length < 2 || accountName.length > 100 || /[<>\r\n]/.test(accountName)) throw createError('Tên chủ tài khoản phải từ 2 đến 100 ký tự.');
      if (data.bankAccounts.some((item) => String(item.bankCode).toUpperCase() === bankCode && item.accountNumber === accountNumber)) {
        throw createError('Tài khoản ngân hàng này đã được khai báo.', 409);
      }
      const shouldActivate = body.isActive === true || (!data.bankAccounts.some((item) => item.isActive) && body.isActive !== false);
      if (shouldActivate) data.bankAccounts.forEach((item) => { item.isActive = false; });
      const createdAt = new Date().toISOString();
      const account = {
        id: nextId(data, 'bankAccounts'), bankCode, bankName, accountNumber, accountName,
        isActive: shouldActivate, createdAt, updatedAt: createdAt,
      };
      data.bankAccounts.unshift(account);
      recordActivity(data, user, 'system.bank_account_created', { bankAccountId: account.id, bankCode, isActive: account.isActive });
      return persist({
        data: account,
        message: account.isActive ? 'Đã lưu và kích hoạt tài khoản nhận VietQR.' : 'Đã lưu tài khoản ngân hàng. Tài khoản chưa được kích hoạt.',
      });
    }
    const bankAccountMatch = route.match(/^\/system\/bank-accounts\/(\d+)$/);
    if (bankAccountMatch && method === 'PATCH') {
      const account = data.bankAccounts.find((item) => item.id === Number(bankAccountMatch[1]));
      if (!account) throw createError('Không tìm thấy tài khoản ngân hàng.', 404);
      const bankCode = String(body.bankCode ?? account.bankCode).trim().toUpperCase();
      const bankName = String(body.bankName ?? account.bankName).trim();
      const accountNumber = String(body.accountNumber ?? account.accountNumber).trim();
      const accountName = String(body.accountName ?? account.accountName).trim().replace(/\s+/g, ' ').toLocaleUpperCase('vi');
      if (!/^[A-Z0-9-]{2,30}$/.test(bankCode)) throw createError('Mã ngân hàng VietQR chỉ được chứa chữ, số hoặc dấu gạch nối (2–30 ký tự).');
      if (bankName.length < 2 || bankName.length > 100 || /[<>\r\n]/.test(bankName)) throw createError('Tên ngân hàng phải từ 2 đến 100 ký tự.');
      if (!/^\d{6,19}$/.test(accountNumber)) throw createError('Số tài khoản phải có từ 6 đến 19 chữ số.');
      if (accountName.length < 2 || accountName.length > 100 || /[<>\r\n]/.test(accountName)) throw createError('Tên chủ tài khoản phải từ 2 đến 100 ký tự.');
      if (data.bankAccounts.some((item) => item.id !== account.id
        && String(item.bankCode).toUpperCase() === bankCode && item.accountNumber === accountNumber)) {
        throw createError('Tài khoản ngân hàng này đã được khai báo.', 409);
      }
      if (body.isActive === true) data.bankAccounts.forEach((item) => { item.isActive = item.id === account.id; });
      Object.assign(account, { bankCode, bankName, accountNumber, accountName, updatedAt: new Date().toISOString() });
      if (body.isActive === false) account.isActive = false;
      recordActivity(data, user, 'system.bank_account_updated', { bankAccountId: account.id, bankCode, isActive: account.isActive });
      return persist({
        data: account,
        message: account.isActive ? 'Đã cập nhật và sử dụng tài khoản này cho VietQR.' : 'Đã cập nhật tài khoản ngân hàng.',
      });
    }
    if (bankAccountMatch && method === 'DELETE') {
      const index = data.bankAccounts.findIndex((item) => item.id === Number(bankAccountMatch[1]));
      if (index < 0) throw createError('Không tìm thấy tài khoản ngân hàng.', 404);
      const [removed] = data.bankAccounts.splice(index, 1);
      recordActivity(data, user, 'system.bank_account_deleted', { bankAccountId: removed.id, bankCode: removed.bankCode, wasActive: removed.isActive === true });
      return persist({ message: 'Đã xóa tài khoản ngân hàng khỏi cấu hình VietQR.' });
    }
    if (route === '/system/diagnostics' && method === 'GET') {
      const diagnostics = getSystemDiagnostics();
      return { ...diagnostics, mode: 'server', storage: 'sqlite', persistent: true };
    }
    if (route === '/system/backup' && method === 'POST') return createDataBackup();
    if (route === '/system/backup/validate' && method === 'POST') {
      return validateDataBackup(body.backup);
    }
    if (route === '/system/backup/restore' && method === 'POST') {
      return restoreDataBackup(body.backup);
    }
    if (route === '/system/reset-demo' && method === 'POST') {
      if (body.confirm !== true) throw createError('Cần xác nhận đặt lại dữ liệu demo.', 400);
      if (!resetDemoData()) throw createError('Không thể đặt lại dữ liệu trên máy chủ.', 507);
      return { ok: true, message: 'Đã khôi phục dữ liệu mẫu trên máy chủ. Tất cả phiên đăng nhập phải xác thực lại.' };
    }
    throw createError('Không tìm thấy thao tác hệ thống.', 404);
  }

  // Chỉ nhân viên demo có quyền quản lý mới được nhập catalog API vào danh mục nội bộ.
  // Sản phẩm mới luôn là bản nháp: giá bán = 0, inactive và tồn kho = 0 cho tới khi nhân viên cấu hình.
  if (route === '/catalogs/dummyjson/import' && method === 'POST') {
    requireManager(user);
    const incoming = Array.isArray(body.products) ? body.products : [body.product || body];
    if (!incoming.length || incoming.length > 100) throw createError('Chọn từ 1 đến 100 sản phẩm API để nhập.');
    const allowedCategories = {
      smartphones: { categoryName: 'Điện thoại' },
      laptops: { categoryName: 'Máy tính' },
      tablets: { categoryName: 'Máy tính bảng' },
      'mobile-accessories': { categoryName: 'Phụ kiện' },
    };
    const normalized = incoming.map((entry) => {
      const dummyJsonId = Number(entry.id ?? entry.dummyJsonId);
      const title = String(entry.title || entry.name || '').trim();
      const categorySlug = String(entry.category || '');
      const category = allowedCategories[categorySlug];
      const categoryRecord = category
        ? data.categories.find((item) => String(item.name || '').trim().toLocaleLowerCase('vi') === category.categoryName.toLocaleLowerCase('vi'))
        : null;
      const priceUsd = Number(entry.priceUsd ?? entry.price);
      const imageUrl = String(entry.thumbnail || entry.imageUrl || '');
      let imageIsSafe = false;
      try {
        const parsed = new URL(imageUrl);
        imageIsSafe = parsed.protocol === 'https:' && parsed.hostname === 'cdn.dummyjson.com';
      } catch { /* Thiếu URL ảnh vẫn có thể nhập và gắn ảnh sau. */ }
      const images = Array.isArray(entry.images) ? entry.images.filter((url) => {
        try {
          const parsed = new URL(String(url));
          return parsed.protocol === 'https:' && parsed.hostname === 'cdn.dummyjson.com';
        } catch { return false; }
      }).slice(0, 12) : [];
      if (!Number.isSafeInteger(dummyJsonId) || dummyJsonId <= 0 || title.length < 2 || title.length > 180
        || !category || !Number.isFinite(priceUsd) || priceUsd < 0 || priceUsd > 10000000) {
        throw createError('Sản phẩm API có mã, tên, danh mục hoặc giá mẫu không hợp lệ.');
      }
      if (!categoryRecord) throw createError(`Chưa có danh mục nội bộ “${category?.categoryName || categorySlug}”. Hãy tạo danh mục trước khi nhập API.`);
      return {
        dummyJsonId, title, categorySlug, category, categoryRecord, priceUsd,
        brand: String(entry.brand || '').trim().slice(0, 100),
        externalSku: String(entry.sku || '').trim().slice(0, 80),
        description: String(entry.description || '').trim().slice(0, 2000),
        imageUrl: imageIsSafe ? imageUrl : '',
        images,
        rating: optionalProductNumber(entry.rating) == null ? null : Math.max(0, Math.min(5, Number(entry.rating))),
        tags: Array.isArray(entry.tags) ? entry.tags.filter((tag) => typeof tag === 'string').map((tag) => tag.slice(0, 80)).slice(0, 20) : [],
        weight: optionalProductNumber(entry.weight),
        dimensions: entry.dimensions && typeof entry.dimensions === 'object' ? {
          width: optionalProductNumber(entry.dimensions.width),
          height: optionalProductNumber(entry.dimensions.height),
          depth: optionalProductNumber(entry.dimensions.depth),
        } : null,
        warrantyInformation: String(entry.warrantyInformation || '').trim().slice(0, 240),
        shippingInformation: String(entry.shippingInformation || '').trim().slice(0, 240),
        returnPolicy: String(entry.returnPolicy || '').trim().slice(0, 240),
        availabilityStatus: String(entry.availabilityStatus || '').trim().slice(0, 80),
        minimumOrderQuantity: optionalProductNumber(entry.minimumOrderQuantity) != null
          && Number.isSafeInteger(Number(entry.minimumOrderQuantity)) && Number(entry.minimumOrderQuantity) > 0
          ? Number(entry.minimumOrderQuantity) : null,
        reviews: Array.isArray(entry.reviews) ? entry.reviews.slice(0, 5).map((review) => ({
          rating: Math.max(0, Math.min(5, Number(review.rating) || 0)),
          comment: String(review.comment || '').trim().slice(0, 500),
          date: String(review.date || '').slice(0, 40),
          reviewerName: String(review.reviewerName || 'Khách hàng').trim().slice(0, 80),
        })) : [],
      };
    });
    const created = [];
    const skipped = [];
    for (const entry of normalized) {
      const existing = data.products.find((item) => item.externalSource === 'dummyjson' && Number(item.dummyJsonId) === entry.dummyJsonId);
      if (existing) {
        skipped.push({ dummyJsonId: entry.dummyJsonId, productId: existing.id });
        continue;
      }
      const matchedBrand = data.brands.find((item) => String(item.name || '').toLocaleLowerCase('vi') === entry.brand.toLocaleLowerCase('vi'));
      const id = nextId(data, 'products');
      const item = {
        id, sku: `EXT-DJ-${entry.dummyJsonId}`, name: entry.title,
        categoryId: entry.categoryRecord.id, categoryName: entry.categoryRecord.name,
        brandId: matchedBrand?.id || null, brandName: entry.brand,
        supplierId: null, supplierName: '',
        costPrice: 0, sellingPrice: 0, warrantyMonths: 12, unit: 'Cái', minStock: 5,
        isActive: false, imageUrl: entry.imageUrl, images: entry.images,
        description: entry.description, rating: entry.rating,
        technicalDetails: '', tags: entry.tags, weight: entry.weight, dimensions: entry.dimensions,
        warrantyInformation: entry.warrantyInformation, shippingInformation: entry.shippingInformation,
        returnPolicy: entry.returnPolicy, availabilityStatus: entry.availabilityStatus,
        minimumOrderQuantity: entry.minimumOrderQuantity, reviews: entry.reviews,
        externalSource: 'dummyjson', dummyJsonId: entry.dummyJsonId,
        externalSku: entry.externalSku, externalCategory: entry.categorySlug,
        externalPriceUsd: entry.priceUsd, priceNeedsManualSetup: true,
      };
      data.products.unshift(item);
      for (const branch of data.branches) data.stock.push({ productId: id, branchId: branch.id, quantity: 0 });
      created.push({ id, dummyJsonId: entry.dummyJsonId, sku: item.sku, name: item.name });
      recordActivity(data, user, 'catalog.dummyjson_imported', { productId: id, dummyJsonId: entry.dummyJsonId });
    }
    return persist({
      message: `Đã nhập ${created.length} sản phẩm mới; bỏ qua ${skipped.length} mã đã có trong catalog nội bộ.`,
      created, skipped,
      nextSteps: 'Các sản phẩm nhập vào đang tắt, giá bán 0 VNĐ và tồn kho 0. Hãy đặt giá bán bằng VNĐ, nhập hàng vào kho rồi mới kích hoạt.',
    });
  }

  if (route === '/store/orders' && method === 'GET') {
    if (!['admin', 'manager', 'sales', 'warehouse'].includes(user.role)) throw createError('Vai trò này không thể xử lý đơn giao hàng.', 403);
    const orders = data.sales.filter((sale) => sale.isWebOrder && branchAllowed(user, sale.branchId)).map((sale) => ({
      ...sale,
      branchName: data.branches.find((branch) => branch.id === sale.branchId)?.name || '—',
    }));
    return paginated(orders, query);
  }
  const bankTransferConfirmationId = route.match(/^\/store\/orders\/(\d+)\/payment-confirmation$/);
  if (bankTransferConfirmationId && method === 'POST') {
    requireManager(user);
    const sale = data.sales.find((item) => item.id === Number(bankTransferConfirmationId[1])
      && item.isWebOrder && branchAllowed(user, item.branchId));
    if (!sale) throw createError('Không tìm thấy đơn giao hàng.', 404);
    if (sale.paymentMethod !== 'vietqr_transfer' || sale.paymentStatus !== 'pending_payment'
      || sale.fulfillmentStatus === 'cancelled') {
      throw createError('Đơn không phải VietQR đang chờ xác nhận hoặc đã được xử lý.', 409);
    }
    const receivedAmount = Number(body.receivedAmount);
    const transactionReference = String(body.transactionReference || '').trim();
    if (!Number.isSafeInteger(receivedAmount) || receivedAmount !== Number(sale.totalAmount)) {
      throw createError('Số tiền nhận phải khớp chính xác tổng tiền đơn hàng.');
    }
    if (!/^[A-Za-z0-9._/-]{4,100}$/.test(transactionReference)) {
      throw createError('Nhập mã tham chiếu giao dịch ngân hàng hợp lệ (4–100 ký tự).');
    }
    if (data.payments.some((item) => item.method === 'vietqr_transfer'
      && String(item.transactionId || '').toLowerCase() === transactionReference.toLowerCase())) {
      throw createError('Mã giao dịch ngân hàng này đã được dùng để đối soát một đơn khác.', 409);
    }
    const payment = data.payments.find((item) => item.saleId === sale.id
      && item.method === 'vietqr_transfer' && item.status === 'pending');
    if (!payment) throw createError('Không tìm thấy giao dịch VietQR đang chờ xác nhận.', 409);

    const confirmedAt = new Date().toISOString();
    sale.paymentStatus = 'completed';
    sale.paymentConfirmedAt = confirmedAt;
    sale.paymentConfirmedBy = user.id;
    payment.status = 'completed-bank-transfer-manual';
    payment.transactionId = transactionReference;
    payment.completedAt = confirmedAt;
    recordActivity(data, user, 'store.vietqr_transfer_manually_confirmed', {
      saleId: sale.id, invoiceNo: sale.invoiceNo, amount: sale.totalAmount, transactionReference,
    });
    return persist({ message: 'Đã ghi nhận đối soát chuyển khoản thủ công. Đơn có thể được cửa hàng tiếp tục xử lý.' });
  }
  const storeOrderStatusId = route.startsWith('/store/orders/') && route.endsWith('/status') ? Number(route.split('/')[3]) : null;
  if (Number.isSafeInteger(storeOrderStatusId) && storeOrderStatusId > 0 && method === 'PATCH') {
    if (!['admin', 'manager', 'sales', 'warehouse'].includes(user.role)) throw createError('Vai trò này không thể xử lý đơn giao hàng.', 403);
    const sale = data.sales.find((item) => item.id === storeOrderStatusId && item.isWebOrder && branchAllowed(user, item.branchId));
    if (!sale) throw createError('Không tìm thấy đơn giao hàng.', 404);
    const current = sale.fulfillmentStatus || sale.status;
    const nextStatus = String(body.status || '');
    const onlinePayment = ['momo_sandbox', 'vnpay_sandbox', 'vietqr_transfer'].includes(sale.paymentMethod);
    if (onlinePayment && sale.paymentStatus === 'pending_payment' && nextStatus === 'cancelled'
      && !['admin', 'manager'].includes(user.role)) {
      throw createError('Chỉ Admin hoặc Quản lý được hủy đơn đang chờ thanh toán online.', 403);
    }
    if (onlinePayment && sale.paymentStatus === 'pending_payment' && nextStatus !== 'cancelled') {
      throw createError('Đơn đang chờ cổng thanh toán xác nhận. Không thể xử lý hoặc hủy đơn ở thời điểm này.', 409);
    }
    if (onlinePayment && sale.paymentStatus !== 'completed' && nextStatus !== 'cancelled') {
      throw createError('Chỉ được xử lý giao hàng sau khi thanh toán online được xác minh thành công.', 409);
    }
    if (onlinePayment && sale.paymentStatus === 'completed' && nextStatus === 'cancelled') {
      throw createError('Đơn đã thanh toán online. Cần quy trình hoàn tiền trước khi hủy đơn.', 409);
    }
    const transitions = {
      pending_confirmation: ['confirmed', 'cancelled'],
      confirmed: ['preparing', 'cancelled'],
      preparing: ['shipping', 'cancelled'],
      shipping: ['delivered'],
    };
    if (!transitions[current]?.includes(nextStatus)) throw createError('Trạng thái đơn không cho phép chuyển theo bước này.', 409);
    if (nextStatus === 'cancelled') {
      if (sale.paymentStatus === 'pending_payment') {
        releaseUnpaidWebOrder(sale, { paymentStatus: 'cancelled', reason: 'staff_cancelled', by: user.username, recordEvent: false });
      } else {
        for (const line of sale.items || []) changeStock(data, user, line.productId, sale.branchId, line.quantity, 'web_order_cancel_release', sale.invoiceNo, 'Hoàn tồn đơn bị hủy');
        if (sale.memberCustomerId && Number(sale.loyaltyPointsUsed || 0) > 0 && !sale.loyaltyPointsRestored) {
          const member = data.customers.find((item) => item.id === sale.memberCustomerId && item.isMember);
          if (member) creditLoyaltyPoints(member, Number(sale.loyaltyPointsUsed));
          sale.loyaltyPointsRestored = true;
        }
        if (sale.promotionCode && !sale.promotionUsageReleased) {
          const promotion = data.promotions.find((item) => item.code === sale.promotionCode);
          if (promotion) promotion.usedCount = Math.max(0, Number(promotion.usedCount || 0) - 1);
          sale.promotionUsageReleased = true;
        }
        sale.status = 'cancelled';
        sale.paymentStatus = 'cancelled';
        const payment = data.payments.find((item) => item.saleId === sale.id && item.method === sale.paymentMethod && item.status === 'pending');
        if (payment) payment.status = 'cancelled';
      }
    } else if (nextStatus === 'delivered') {
      sale.status = 'completed';
      sale.paymentStatus = 'completed';
      sale.deliveredAt = new Date().toISOString();
      const payment = data.payments.find((item) => item.saleId === sale.id && item.method === 'cash_on_delivery');
      if (payment) {
        payment.status = 'completed-cod';
        payment.completedAt = sale.deliveredAt;
      }
      if (sale.memberCustomerId && !sale.loyaltyPointsAwarded) {
        const member = data.customers.find((item) => item.id === sale.memberCustomerId && item.isMember);
        if (member) {
          const eligibleAmount = Math.max(0, Number(sale.subtotal || 0) - Number(sale.discountAmount || 0));
          const points = Math.floor(eligibleAmount / 10000);
          creditLoyaltyPoints(member, points);
          sale.loyaltyPointsEarned = points;
        }
        sale.loyaltyPointsAwarded = true;
      }
      // Bảo hành chỉ phát sinh khi đơn đã giao, gắn với hồ sơ khách hàng và sản phẩm có thời hạn bảo hành.
      for (const line of sale.items || []) {
        const product = data.products.find((item) => item.id === line.productId);
        if (sale.customerId && product && Number(product.warrantyMonths) > 0
          && !data.warranties.some((warranty) => warranty.saleId === sale.id && warranty.productId === line.productId)) {
          data.warranties.unshift({
            id: nextId(data, 'warranties'),
            code: 'WAR-' + String(data.nextIds.warranties - 1).padStart(5, '0'),
            saleId: sale.id, productId: line.productId, productName: product.name,
            customerId: sale.customerId, customerName: sale.customerName, branchId: sale.branchId,
            startDate: sale.createdAt.slice(0, 10),
            endDate: new Date(Date.parse(sale.deliveredAt) + Number(product.warrantyMonths) * 30 * 86400000).toISOString().slice(0, 10),
            status: 'active',
          });
        }
      }
    }
    sale.fulfillmentStatus = nextStatus;
    sale.statusHistory = [...(sale.statusHistory || []), { status: nextStatus, createdAt: new Date().toISOString(), by: user.username }];
    if (nextStatus === 'shipping') enqueueCustomerNotification(data, sale, 'shipping_started', 'Đang giao hàng');
    if (nextStatus === 'delivered') enqueueCustomerNotification(data, sale, 'delivered', 'Đã giao thành công');
    recordActivity(data, user, 'store.order_status_changed', { saleId: sale.id, from: current, to: nextStatus });
    return persist({ message: nextStatus === 'delivered' ? 'Đã xác nhận giao thành công; điểm thành viên đã được xử lý một lần.' : nextStatus === 'cancelled' ? 'Đơn bị hủy; tồn kho đã được hoàn lại.' : 'Đã cập nhật trạng thái giao hàng.', data: sale });
  }

  if (route === '/dashboard/summary' && method === 'GET') {
    const now = new Date();
    const today = localDateKey(now);
    const month = today.slice(0, 7);
    const sales = data.sales.filter((sale) => branchAllowed(user, sale.branchId) && sale.status === 'completed' && ['completed', 'partially_refunded', 'refunded'].includes(sale.paymentStatus));
    const todaySales = sales.filter((sale) => localDateKey(sale.createdAt) === today);
    const monthSales = sales.filter((sale) => localDateKey(sale.createdAt).slice(0, 7) === month);
    const relevantStock = data.stock.filter((item) => branchAllowed(user, item.branchId));
    return { summary: {
      revenueToday: todaySales.reduce((sum, sale) => sum + Number(sale.totalAmount || 0) - Number(sale.returnedAmount || 0), 0),
      revenueMonth: monthSales.reduce((sum, sale) => sum + Number(sale.totalAmount || 0) - Number(sale.returnedAmount || 0), 0),
      ordersToday: todaySales.length,
      totalProducts: data.products.filter((item) => item.isActive).length,
      activeProducts: data.products.filter((item) => item.isActive).length,
      lowStockProducts: relevantStock.filter((item) => item.quantity <= Number(data.products.find((p) => p.id === item.productId)?.minStock ?? 5)).length,
      totalUnits: relevantStock.reduce((sum, item) => sum + Number(item.quantity || 0), 0),
    } };
  }
  if (route === '/reports/summary' && method === 'GET') return reportSummary(data, user, query);

  // Endpoint POS chỉ trả về trường cần cho việc chọn khách hàng khi lập hóa đơn.
  // Trang CRM đầy đủ vẫn chỉ dành cho admin/quản lý/nhân viên bán hàng.
  if (route === '/pos/customers' && method === 'GET') {
    const customers = data.customers.filter((customer) => customer.isActive !== false).map((customer) => ({
      id: customer.id,
      code: customer.code,
      fullName: customer.fullName,
      phone: customer.phone || '',
      isMember: customer.isMember === true,
      memberTier: customer.memberTier || 'Đồng',
    }));
    return paginated(customers, query);
  }

  // Danh mục dùng chung và dữ liệu nền.
  const catalogMatch = route.match(/^\/catalogs\/(categories|brands|suppliers)(?:\/(\d+)(?:\/(status))?)?$/);
  const simpleCollectionMatch = route.match(/^\/(products|categories|brands|suppliers|branches|users|customers|warranties|sales|promotions|serials|purchase-receipts|notifications|audit-logs)(?:\/(\d+))?(?:\/(status|returns|history|confirm|cancel|reset-password))?$/);
  const catalogAliases = { categories: 'categories', brands: 'brands', suppliers: 'suppliers' };

  if (catalogMatch) {
    const [, key, idText, action] = catalogMatch;
    const collection = catalogAliases[key];
    if (method === 'GET' && !idText) return paginated(data[collection], query);
    if (method === 'POST' && !idText) {
      requireManager(user);
      const name = String(body.name || '').trim();
      if (!name) throw createError('Tên danh mục không được để trống.');
      if (data[collection].some((item) => item.name.toLocaleLowerCase('vi') === name.toLocaleLowerCase('vi'))) throw createError('Tên đã tồn tại.', 409);
      const newItem = { ...body, id: nextId(data, collection), name, isActive: body.isActive !== false };
      delete newItem.password;
      data[collection].unshift(newItem);
      recordActivity(data, user, `${key}.created`, { id: newItem.id });
      return persist({ data: newItem, message: 'Đã lưu vào dữ liệu demo.' });
    }
    if (idText) {
      const item = data[collection].find((row) => row.id === Number(idText));
      if (!item) throw createError('Không tìm thấy bản ghi.', 404);
      if (method === 'GET') return item;
      if (method === 'PATCH' || method === 'PUT') {
        requireManager(user);
        if (action === 'status') {
          if (typeof body.isActive !== 'boolean') throw createError('Trạng thái danh mục phải là true/false.');
          item.isActive = body.isActive;
        } else {
          if (Object.hasOwn(body, 'id') && Number(body.id) !== item.id) throw createError('Không được thay đổi ID bản ghi.', 400);
          const name = String(body.name ?? item.name ?? '').trim();
          const description = String(body.description ?? item.description ?? '').trim().slice(0, 500);
          if (name.length < 2 || name.length > 120) throw createError('Tên danh mục/thương hiệu cần từ 2 đến 120 ký tự.');
          if (data[collection].some((row) => row.id !== item.id && String(row.name || '').trim().toLocaleLowerCase('vi') === name.toLocaleLowerCase('vi'))) {
            throw createError('Tên danh mục/thương hiệu đã tồn tại.', 409);
          }
          if (collection === 'suppliers') {
            const code = String(body.code ?? item.code ?? '').trim().toUpperCase();
            const email = String(body.email ?? item.email ?? '').trim().toLowerCase();
            if (!/^[A-Z0-9._-]{2,30}$/.test(code) || name.length > 180) throw createError('Mã hoặc tên nhà cung cấp không hợp lệ.');
            if (data.suppliers.some((row) => row.id !== item.id && String(row.code || '').toUpperCase() === code)) throw createError('Mã nhà cung cấp đã tồn tại.', 409);
            if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw createError('Email nhà cung cấp chưa đúng định dạng.');
            Object.assign(item, {
              code, name, description,
              contactName: String(body.contactName ?? item.contactName ?? '').trim().slice(0, 150),
              phone: String(body.phone ?? item.phone ?? '').trim().slice(0, 30),
              email, address: String(body.address ?? item.address ?? '').trim().slice(0, 255),
            });
          } else {
            if (body.isActive !== undefined && typeof body.isActive !== 'boolean') throw createError('Trạng thái phải là true/false.');
            Object.assign(item, {
              name, description,
              ...(body.isActive === undefined ? {} : { isActive: body.isActive }),
            });
          }
        }
        recordActivity(data, user, key + '.updated', { id: item.id });
        return persist({ data: item, message: 'Đã cập nhật dữ liệu demo.' });
      }
      if (method === 'DELETE') {
        requireManager(user);
        if (collection === 'categories' && data.products.some((p) => Number(p.categoryId) === item.id)) throw createError('Danh mục đang được sản phẩm sử dụng; hãy ngừng hoạt động thay vì xóa.');
        if (collection === 'brands' && data.products.some((p) => Number(p.brandId) === item.id)) throw createError('Thương hiệu đang được sản phẩm sử dụng; hãy ngừng hoạt động thay vì xóa.');
        if (collection === 'suppliers' && data.products.some((p) => Number(p.supplierId) === item.id)) throw createError('Nhà cung cấp đang được sản phẩm sử dụng; hãy ngừng hoạt động thay vì xóa.');
        data[collection] = data[collection].filter((row) => row.id !== item.id);
        return persist({ message: 'Đã xóa bản ghi demo.' });
      }
    }
  }

  // Dữ liệu sản phẩm, chi nhánh, nhân viên và khách hàng.
  if (simpleCollectionMatch) {
    const [, keyRaw, idText, action] = simpleCollectionMatch;
    const key = keyRaw === 'purchase-receipts' ? 'purchaseReceipts'
      : keyRaw === 'audit-logs' ? 'auditLogs'
        : keyRaw;
    const collection = data[key];
    if (!collection) throw createError('Phân hệ dữ liệu chưa được tạo.', 501);

    // Chặn sửa/xóa trực tiếp các bản ghi giao dịch; những thay đổi này phải qua đúng quy trình trạng thái.
    if (key === 'users' && user.role !== 'admin') {
      throw createError('Chỉ quản trị viên được xem hoặc quản lý danh bạ tài khoản nhân viên.', 403);
    }
    // Nhật ký kiểm toán là dữ liệu chỉ đọc; không cho sửa/xóa qua CRUD tổng quát hoặc endpoint theo ID.
    if (key === 'auditLogs') {
      if (user.role !== 'admin') throw createError('Chỉ quản trị viên được xem nhật ký demo.', 403);
      if (method !== 'GET') throw createError('Nhật ký thao tác là dữ liệu chỉ đọc; không thể sửa hoặc xóa trực tiếp.', 409);
    }
    if (key === 'branches' && method !== 'GET' && user.role !== 'admin') {
      throw createError('Chỉ quản trị viên được quản lý chi nhánh.', 403);
    }
    if (key === 'sales' && method !== 'GET'
      && !(route === '/sales' && method === 'POST')
      && !(action === 'returns' && method === 'POST')) {
      throw createError('Không sửa hoặc xóa hóa đơn trực tiếp; hãy dùng luồng thanh toán/đổi trả.', 409);
    }
    if (key === 'purchaseReceipts' && method !== 'GET'
      && !(route === '/purchase-receipts' && method === 'POST')
      && !(method === 'POST' && ['confirm', 'cancel'].includes(action))) {
      throw createError('Phiếu nhập phải được xác nhận/hủy qua thao tác chuyên biệt.', 409);
    }
    if (key === 'warranties' && method === 'DELETE') {
      throw createError('Không xóa cứng lịch sử bảo hành; hãy chuyển trạng thái sang đã hủy nếu phù hợp.', 409);
    }

    if (method === 'GET' && !idText) {
      if (key === 'products') return listProducts(data, user, query);
      if (key === 'users') return paginated(collection.filter((row) => row.role !== 'customer').map(safeUser), query);
      if (key === 'warranties') {
        const enriched = collection.filter((item) => branchAllowed(user, item.branchId)).map((item) => {
          const product = data.products.find((record) => record.id === item.productId);
          const sale = data.sales.find((record) => record.id === item.saleId);
          const serial = data.serials.find((record) => Number(record.warrantyId) === Number(item.id)
            || (Number(record.productId) === Number(item.productId) && record.saleItemId != null
              && (sale?.items || []).some((line) => Number(line.id) === Number(record.saleItemId)
                && Number(line.productId) === Number(record.productId))));
          return {
            ...item,
            warrantyNo: item.warrantyNo || item.code || `WAR-${String(item.id).padStart(5, '0')}`,
            invoiceNo: item.invoiceNo || sale?.invoiceNo || '—',
            serialNo: item.serialNo || serial?.serial || '',
            sku: item.sku || product?.sku || '—',
            branchName: data.branches.find((branch) => branch.id === item.branchId)?.name || '—',
            customerName: item.customerName || data.customers.find((customer) => customer.id === item.customerId)?.fullName || 'Khách lẻ',
            productName: item.productName || product?.name || '—',
          };
        });
        return paginated(enriched, query);
      }
      if (key === 'sales') {
        const enriched = collection.filter((sale) => branchAllowed(user, sale.branchId)).map((sale) => ({
          ...sale,
          branchName: data.branches.find((b) => b.id === sale.branchId)?.name || '—',
          cashierName: data.users.find((entry) => entry.id === sale.cashierId)?.fullName || '—',
          itemCount: sale.items?.reduce((sum, item) => sum + Number(item.quantity || 0), 0) || 0,
          ...(['sales', 'employee', 'ctv'].includes(user.role) ? {
            items: (sale.items || []).map(({ costPrice, unitCost, ...line }) => line),
          } : {}),
        }));
        return paginated(enriched, query);
      }
      if (key === 'customers') return paginated(collection.map((customer) => ({ ...customer, saleCount: data.sales.filter((sale) => sale.customerId === customer.id).length })), query);
      if (key === 'purchaseReceipts') return paginated(collection.filter((item) => branchAllowed(user, item.branchId)), query);
      if (key === 'serials' || key === 'notifications') return paginated(collection.filter((item) => item.branchId == null || branchAllowed(user, item.branchId)), query);
      if (key === 'auditLogs') {
      if (user.role !== 'admin') throw createError('Chỉ quản trị viên xem nhật ký demo.', 403);
      return paginated(collection, query);
    }
      return paginated(collection, query);
    }
    if (method === 'POST' && !idText && ['products', 'branches', 'users', 'customers', 'promotions', 'serials', 'purchaseReceipts'].includes(key)) {
      if (['products', 'branches', 'users', 'promotions', 'purchaseReceipts'].includes(key)) requireManager(user);
      const item = { ...body, id: nextId(data, key), isActive: body.isActive !== false };
      if (key === 'products') {
        item.sku = String(item.sku || '').trim().toUpperCase();
        item.name = String(item.name || '').trim();
        item.costPrice = Number(item.costPrice);
        item.sellingPrice = Number(item.sellingPrice);
        item.categoryId = item.categoryId ? Number(item.categoryId) : null;
        item.brandId = item.brandId ? Number(item.brandId) : null;
        item.supplierId = item.supplierId ? Number(item.supplierId) : null;
        item.description = String(item.description || '').trim().slice(0, 3000);
        item.technicalDetails = String(item.technicalDetails || '').trim().slice(0, 5000);
        item.imageUrl = normalizeProductImageUrl(item.imageUrl);
        item.images = normalizeProductImages(item.images, item.imageUrl);
        item.imageUrl = item.imageUrl || item.images[0] || '';
        if (!item.sku || !item.name || !Number.isSafeInteger(item.costPrice) || item.costPrice < 0 || !Number.isSafeInteger(item.sellingPrice) || item.sellingPrice < 0) throw createError('SKU, tên và giá sản phẩm không hợp lệ.');
        if (data.products.some((p) => p.sku.toLocaleLowerCase('vi') === item.sku.toLocaleLowerCase('vi'))) throw createError('SKU đã tồn tại.', 409);
        if (item.categoryId && !data.categories.some((r) => r.id === item.categoryId)) throw createError('Danh mục không tồn tại.');
        if (item.brandId && !data.brands.some((r) => r.id === item.brandId)) throw createError('Thương hiệu không tồn tại.');
        if (item.supplierId && !data.suppliers.some((r) => r.id === item.supplierId)) throw createError('Nhà cung cấp không tồn tại.');
      }
      if (key === 'branches' && (!String(item.code || '').trim() || !String(item.name || '').trim())) throw createError('Mã và tên chi nhánh là bắt buộc.');
      if (key === 'users') {
        item.username = String(body.username || '').trim();
        item.fullName = String(body.fullName || '').trim();
        item.email = String(body.email || '').trim().toLowerCase();
        item.role = String(body.role || 'employee');
        item.branchId = Number(body.branchId);
        const initialPassword = String(body.password || '');
        const confirmation = String(body.confirmPassword || '');
        delete item.password;
        delete item.confirmPassword;
        delete item.passwordHash;
        if (!/^[a-zA-Z0-9._-]{3,60}$/.test(item.username)
          || item.fullName.length < 2
          || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item.email)
          || !['admin', 'manager', 'sales', 'warehouse', 'employee', 'ctv'].includes(item.role)) {
          throw createError('Tên đăng nhập, email, họ tên hoặc vai trò không hợp lệ.');
        }
        if (data.users.some((row) => row.username.toLowerCase() === item.username.toLowerCase())) throw createError('Tên đăng nhập đã tồn tại.', 409);
        if (data.users.some((row) => String(row.email || '').toLowerCase() === item.email)) throw createError('Email đã tồn tại.', 409);
        const branch = data.branches.find((row) => row.id === item.branchId && row.isActive !== false);
        if (!branch) throw createError('Nhân viên cần được gán một chi nhánh đang hoạt động.');
        if (initialPassword.length < 12 || initialPassword.length > 200 || initialPassword !== confirmation) {
          throw createError('Mật khẩu ban đầu phải dài 12–200 ký tự và hai ô mật khẩu phải khớp.');
        }
        try { item.passwordCredential = await createPasswordCredential(initialPassword); } catch {
          throw createError('Không thể tạo verifier mật khẩu; hồ sơ chưa được lưu.', 503);
        }
        item.credentialVersion = 1;
        item.mustChangePassword = true;
        item.passwordCreatedAt = new Date().toISOString();
      }
      if (key === 'customers') {
        item.fullName = String(body.fullName || '').trim().slice(0, 150);
        const rawPhone = String(body.phone || '').trim();
        const phone = rawPhone ? normalizeVietnamPhone(rawPhone) : '';
        const email = String(body.email || '').trim().toLowerCase();
        if (item.fullName.length < 2) throw createError('Họ tên khách hàng cần ít nhất 2 ký tự.');
        if (rawPhone && !phone) throw createError('Số điện thoại phải là số di động Việt Nam hợp lệ hoặc để trống.');
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw createError('Email khách hàng chưa đúng định dạng.');
        if (phone && data.customers.some((row) => normalizeVietnamPhone(row.phone) === phone)) {
          throw createError('Số điện thoại đã gắn với hồ sơ khách hàng khác.', 409);
        }
        if (email && data.customers.some((row) => String(row.email || '').trim().toLowerCase() === email)) {
          throw createError('Email đã gắn với hồ sơ khách hàng khác.', 409);
        }
        item.phone = phone;
        item.email = email;
        item.address = String(body.address || '').trim().slice(0, 255);
        item.note = String(body.note || '').trim().slice(0, 500);
        item.isMember = false;
        item.loyaltyPoints = 0;
        item.memberTier = 'Chưa đăng ký';
        item.memberSince = null;
      }
      if (key === 'serials') {
        item.serial = String(body.serial || body.imei || '').trim();
        item.productId = Number(body.productId);
        item.branchId = Number(body.branchId || user.branchId);
        if (!item.serial || !data.products.some((p) => p.id === item.productId)) throw createError('Serial/IMEI hoặc sản phẩm không hợp lệ.');
        if (data.serials.some((s) => String(s.serial).toLowerCase() === item.serial.toLowerCase())) throw createError('Serial/IMEI đã tồn tại.', 409);
      }
      if (key === 'purchaseReceipts') {
        const supplier = data.suppliers.find((s) => s.id === Number(body.supplierId) && s.isActive !== false);
        item.branchId = Number(body.branchId ?? user.branchId);
        const receiptBranch = data.branches.find((branch) => branch.id === item.branchId && branch.isActive !== false);
        item.supplierId = supplier?.id;
        if (!supplier || !receiptBranch || !Array.isArray(body.items) || !body.items.length || body.items.length > 100) {
          throw createError('Nhà cung cấp, chi nhánh hoặc danh sách hàng không hợp lệ.');
        }
        if (!branchAllowed(user, item.branchId)) throw createError('Không thể nhập vào chi nhánh khác.', 403);
        const seenProductIds = new Set();
        item.items = body.items.map((line) => {
          const product = data.products.find((p) => p.id === Number(line.productId));
          const quantity = Number(line.quantity);
          const unitCost = Number(line.unitCost ?? product?.costPrice);
          if (product && seenProductIds.has(product.id)) throw createError('Không nhập lặp một sản phẩm trong cùng phiếu.');
          if (product) seenProductIds.add(product.id);
          const lineTotal = quantity * unitCost;
          if (!product || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 1000000
            || !Number.isSafeInteger(unitCost) || unitCost < 0 || !Number.isSafeInteger(lineTotal)) {
            throw createError('Dòng nhập hàng có sản phẩm, số lượng hoặc giá vốn không hợp lệ.');
          }
          return { productId: product.id, productName: product.name, quantity, unitCost, lineTotal };
        });
        item.code = `GRN-${String(item.id).padStart(4, '0')}`;
        item.supplierName = supplier.name;
        item.totalAmount = item.items.reduce((sum, line) => sum + line.lineTotal, 0);
        if (!Number.isSafeInteger(item.totalAmount)) throw createError('Tổng giá trị phiếu nhập vượt giới hạn tính toán an toàn.');
        item.status = 'draft';
      }
      if (key === 'promotions') {
        item.code = String(body.code || '').trim().toUpperCase();
        item.discountType = body.discountType === 'amount' ? 'amount' : 'percent';
        item.discountValue = Number(body.discountValue);
        item.minimumOrder = Number(body.minimumOrder || 0);
        item.usageLimit = body.usageLimit == null || body.usageLimit === '' ? null : Number(body.usageLimit);
        item.usedCount = 0;
        item.reservedCount = 0;
        const startTime = Date.parse(body.startAt);
        const endTime = Date.parse(body.endAt);
        if (!item.code || !Number.isSafeInteger(item.discountValue) || item.discountValue <= 0
          || (item.discountType === 'percent' && item.discountValue > 100)
          || !Number.isSafeInteger(item.minimumOrder) || item.minimumOrder < 0
          || (item.usageLimit !== null && (!Number.isSafeInteger(item.usageLimit) || item.usageLimit < 1))) {
          throw createError('Mã, mức giảm, đơn tối thiểu hoặc giới hạn lượt dùng không hợp lệ.');
        }
        if (data.promotions.some((p) => p.code === item.code)) throw createError('Mã khuyến mãi đã tồn tại.', 409);
        if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || startTime >= endTime) throw createError('Ngày bắt đầu và kết thúc không hợp lệ.');
      }
      if (key === 'customers' && !item.code) item.code = `CUS-${String(item.id).padStart(4, '0')}`;
      if (key === 'products') {
        item.categoryName = data.categories.find((v) => v.id === item.categoryId)?.name || '';
        item.brandName = data.brands.find((v) => v.id === item.brandId)?.name || '';
        item.supplierName = data.suppliers.find((v) => v.id === item.supplierId)?.name || '';
        // Tạo dòng tồn bằng 0 cho các chi nhánh để báo cáo kho không thiếu bản ghi.
        for (const branch of data.branches) data.stock.push({ productId: item.id, branchId: branch.id, quantity: 0 });
      }
      if (key === 'branches') {
        for (const product of data.products) data.stock.push({ productId: product.id, branchId: item.id, quantity: 0 });
      }
      if (key === 'purchaseReceipts') item.status = 'draft';
      collection.unshift(item);
      recordActivity(data, user, `${key}.created`, { id: item.id });
      return persist({ data: key === 'users' ? safeUser(item) : item, id: item.id, message: key === 'users' ? 'Đã tạo tài khoản demo với verifier mật khẩu; nhân viên phải đổi mật khẩu tạm ở lần đăng nhập đầu.' : 'Đã lưu vào dữ liệu demo.' });
    }
    if (idText) {
      const id = Number(idText);
      const item = collection.find((row) => row.id === id);
      if (!item || (key === 'users' && item.role === 'customer')) throw createError('Không tìm thấy bản ghi.', 404);
      if (key === 'users' && action === 'reset-password' && method === 'POST') {
        if (user.role !== 'admin') throw createError('Chỉ quản trị viên được đặt lại mật khẩu nhân viên.', 403);
        if (item.role === 'admin') throw createError('Không đặt lại mật khẩu tài khoản quản trị qua luồng nhân viên. Hãy đổi mật khẩu từ chính tài khoản đó.', 403);
        const password = String(body.password || '');
        const confirmation = String(body.confirmPassword || '');
        if (password.length < 12 || password.length > 200 || password !== confirmation) {
          throw createError('Mật khẩu tạm phải dài 12–200 ký tự và hai ô phải khớp.');
        }
        try { item.passwordCredential = await createPasswordCredential(password); } catch {
          throw createError('Không thể tạo verifier mật khẩu; tài khoản chưa được thay đổi.', 503);
        }
        item.credentialVersion = (Number(item.credentialVersion) || 1) + 1;
        item.mustChangePassword = true;
        item.passwordChangedAt = new Date().toISOString();
        recordActivity(data, user, 'users.password_reset', {
          targetUserId: item.id, targetUsername: item.username, mustChangePassword: true,
        });
        return persist({ data: safeUser(item), message: 'Đã đặt mật khẩu tạm và thu hồi các phiên cũ. Nhân viên phải đổi mật khẩu khi đăng nhập lại.' });
      }
      if (key === 'customers' && action === 'history' && method === 'GET') {
        return { customer: item, sales: data.sales.filter((sale) => sale.customerId === item.id && branchAllowed(user, sale.branchId)), warranties: data.warranties.filter((warranty) => warranty.customerId === item.id && branchAllowed(user, warranty.branchId)) };
      }
      if (method === 'GET') {
        if (key === 'users') return safeUser(item);
        if (key === 'sales') return {
          ...item,
          sale: item,
          items: (item.items || []).map((line) => {
            const product = data.products.find((entry) => entry.id === line.productId);
            const returnedQuantity = Number(line.returnedQuantity || 0);
            return {
              ...line,
              id: line.id || line.productId,
              sku: product?.sku || '',
              soldQuantity: Number(line.quantity || 0),
              returnedQuantity,
              returnableQuantity: Math.max(0, Number(line.quantity || 0) - returnedQuantity),
            };
          }),
        };
        return item;
      }
      if (key === 'warranties' && (method === 'PATCH' || method === 'PUT') && !action) {
        requireManager(user);
        if (!branchAllowed(user, item.branchId)) throw createError('Không có phiếu bảo hành trong phạm vi chi nhánh.', 404);
        const nextStatus = String(body.status ?? item.status);
        const transitions = {
          active: ['active', 'received', 'void'],
          received: ['received', 'repairing', 'completed', 'void'],
          repairing: ['repairing', 'received', 'completed', 'void'],
          completed: ['completed'],
          void: ['void'],
        };
        if (!transitions[item.status]?.includes(nextStatus)) {
          throw createError('Trạng thái bảo hành không được phép chuyển theo bước này.', 409);
        }
        const issueDescription = String(body.issueDescription ?? item.issueDescription ?? '').trim().slice(0, 1000);
        const resolution = String(body.resolution ?? item.resolution ?? '').trim().slice(0, 1000);
        if (['received', 'repairing'].includes(nextStatus) && issueDescription.length < 3) {
          throw createError('Cần ghi mô tả tình trạng/lỗi ít nhất 3 ký tự khi tiếp nhận hoặc sửa chữa.');
        }
        if (nextStatus === 'completed' && resolution.length < 3) {
          throw createError('Cần ghi kết quả xử lý ít nhất 3 ký tự trước khi hoàn tất bảo hành.');
        }
        Object.assign(item, { status: nextStatus, issueDescription, resolution, updatedAt: new Date().toISOString() });
        recordActivity(data, user, 'warranty.updated', { warrantyId: item.id, status: nextStatus });
        return persist({ data: item, message: 'Đã cập nhật trạng thái và lịch sử xử lý bảo hành demo.' });
      }
      if ((method === 'PATCH' || method === 'PUT') && action === 'status') {
        requireManager(user);
        if (key === 'warranties') {
          throw createError('Phiếu bảo hành cần cập nhật trạng thái cùng mô tả xử lý, không dùng thao tác bật/tắt chung.', 409);
        }
        if (typeof body.isActive !== 'boolean') throw createError('Trạng thái phải là true/false.');
        if (key === 'users' && id === Number(user.id) && body.isActive === false) {
          throw createError('Không thể tự khóa tài khoản đang đăng nhập.', 409);
        }
        if (key === 'users' && body.isActive === false && item.role === 'admin'
          && !data.users.some((candidate) => candidate.id !== item.id && candidate.role === 'admin' && candidate.isActive !== false)) {
          throw createError('Phải giữ ít nhất một tài khoản quản trị viên đang hoạt động.', 409);
        }
        item.isActive = body.isActive;
        if (key === 'users') {
          recordActivity(data, user, body.isActive ? 'users.activated' : 'users.deactivated', {
            targetUserId: item.id, targetUsername: item.username,
          });
        }
        return persist({ data: key === 'users' ? safeUser(item) : item, message: 'Đã cập nhật trạng thái.' });
      }
      if (method === 'PATCH' || method === 'PUT') {
        if (['products', 'branches', 'users', 'promotions'].includes(key)) requireManager(user);
        if (key === 'users') {
          if (Object.hasOwn(body, 'password') || Object.hasOwn(body, 'passwordHash')) {
            throw createError('Phiên bản demo không quản lý mật khẩu; chỉ lưu hồ sơ và vai trò mô phỏng.', 400);
          }
          const nextUsername = String(body.username ?? item.username ?? '').trim();
          const nextEmail = String(body.email ?? item.email ?? '').trim().toLowerCase();
          const nextFullName = String(body.fullName ?? item.fullName ?? '').trim();
          const nextRole = body.role ?? item.role;
          const nextBranchId = body.branchId === null || body.branchId === '' ? null : Number(body.branchId ?? item.branchId);
          if (!/^[a-zA-Z0-9._-]{3,60}$/.test(nextUsername)
            || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nextEmail)
            || nextFullName.length < 2
            || !['admin', 'manager', 'sales', 'warehouse', 'employee', 'ctv'].includes(nextRole)) {
            throw createError('Tên đăng nhập, email, họ tên hoặc vai trò không hợp lệ.');
          }
          if (data.users.some((row) => row.id !== id && row.username.toLowerCase() === nextUsername.toLowerCase())) {
            throw createError('Tên đăng nhập đã tồn tại.', 409);
          }
          if (data.users.some((row) => row.id !== id && String(row.email || '').toLowerCase() === nextEmail)) {
            throw createError('Email đã tồn tại.', 409);
          }
          if (id === Number(user.id)
            && ((nextRole !== item.role) || (nextBranchId !== (item.branchId ?? null)))) {
            throw createError('Không thể tự đổi vai trò hoặc chi nhánh của tài khoản đang đăng nhập.', 403);
          }
          if (item.role === 'admin' && (nextRole !== 'admin' || item.isActive === false)
            && !data.users.some((candidate) => candidate.id !== item.id && candidate.role === 'admin' && candidate.isActive !== false)) {
            throw createError('Phải giữ ít nhất một tài khoản quản trị viên đang hoạt động.', 409);
          }
          if (nextRole !== 'admin') {
            const branch = data.branches.find((row) => row.id === nextBranchId && row.isActive !== false);
            if (!branch) throw createError('Nhân viên cần được gán một chi nhánh đang hoạt động.');
          }
          Object.assign(item, {
            username: nextUsername, email: nextEmail, fullName: nextFullName,
            role: nextRole, branchId: nextRole === 'admin' ? (nextBranchId || null) : nextBranchId,
          });
          recordActivity(data, user, 'users.updated', {
            targetUserId: item.id, targetUsername: item.username, role: item.role, branchId: item.branchId,
          });
        } else if (key === 'promotions') {
          const code = String(body.code ?? item.code ?? '').trim().toUpperCase();
          const discountType = body.discountType ?? item.discountType;
          const discountValue = Number(body.discountValue ?? item.discountValue);
          const minimumOrder = Number(body.minimumOrder ?? item.minimumOrder ?? 0);
          const usageLimitRaw = body.usageLimit === undefined ? item.usageLimit : body.usageLimit;
          const usageLimit = usageLimitRaw == null || usageLimitRaw === '' ? null : Number(usageLimitRaw);
          const startAt = body.startAt ?? item.startAt;
          const endAt = body.endAt ?? item.endAt;
          const startTime = Date.parse(startAt);
          const endTime = Date.parse(endAt);
          const usedCount = Number(item.usedCount || 0);
          const reservedCount = Number(item.reservedCount || 0);
          if (!/^[A-Z0-9_-]{2,32}$/.test(code)
            || !['percent', 'amount'].includes(discountType)
            || !Number.isSafeInteger(discountValue) || discountValue <= 0
            || (discountType === 'percent' && discountValue > 100)
            || !Number.isSafeInteger(minimumOrder) || minimumOrder < 0
            || (usageLimit !== null && (!Number.isSafeInteger(usageLimit) || usageLimit < 1))
            || !Number.isSafeInteger(usedCount) || usedCount < 0
            || !Number.isSafeInteger(reservedCount) || reservedCount < 0
            || (usageLimit !== null && usedCount + reservedCount > usageLimit)
            || !Number.isFinite(startTime) || !Number.isFinite(endTime) || startTime >= endTime) {
            throw createError('Mã, mức giảm, thời gian hoặc giới hạn lượt sử dụng khuyến mãi không hợp lệ.');
          }
          if (data.promotions.some((row) => row.id !== id && String(row.code || '').toUpperCase() === code)) {
            throw createError('Mã khuyến mãi đã tồn tại.', 409);
          }
          if (body.isActive !== undefined && typeof body.isActive !== 'boolean') throw createError('Trạng thái khuyến mãi phải là true/false.');
          Object.assign(item, {
            code, discountType, discountValue, minimumOrder, usageLimit,
            startAt, endAt,
            description: String(body.description ?? item.description ?? '').trim().slice(0, 500),
            ...(body.isActive === undefined ? {} : { isActive: body.isActive }),
          });
        } else if (key === 'customers') {
          const nextName = String(body.fullName ?? item.fullName ?? '').trim().slice(0, 150);
          const rawPhone = String(body.phone ?? item.phone ?? '').trim();
          const phone = rawPhone ? normalizeVietnamPhone(rawPhone) : '';
          const email = String(body.email ?? item.email ?? '').trim().toLowerCase();
          if (nextName.length < 2) throw createError('Họ tên khách hàng cần ít nhất 2 ký tự.');
          if (rawPhone && !phone) throw createError('Số điện thoại phải là số di động Việt Nam hợp lệ hoặc để trống.');
          if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw createError('Email khách hàng chưa đúng định dạng.');
          if (phone && data.customers.some((row) => row.id !== id && normalizeVietnamPhone(row.phone) === phone)) {
            throw createError('Số điện thoại đã gắn với hồ sơ khách hàng khác.', 409);
          }
          if (email && data.customers.some((row) => row.id !== id && String(row.email || '').trim().toLowerCase() === email)) {
            throw createError('Email đã gắn với hồ sơ khách hàng khác.', 409);
          }
          Object.assign(item, {
            fullName: nextName, phone, email,
            address: String(body.address ?? item.address ?? '').trim().slice(0, 255),
            note: String(body.note ?? item.note ?? '').trim().slice(0, 500),
          });
        } else if (key === 'products') {
          if (Object.hasOwn(body, 'id') && Number(body.id) !== id) throw createError('Không được thay đổi ID sản phẩm.', 400);
          const sku = String(body.sku ?? item.sku ?? '').trim().toUpperCase();
          const name = String(body.name ?? item.name ?? '').trim();
          const costPrice = Number(body.costPrice ?? item.costPrice);
          const sellingPrice = Number(body.sellingPrice ?? item.sellingPrice);
          const warrantyMonths = Number(body.warrantyMonths ?? item.warrantyMonths ?? 0);
          const relationId = (value, previous) => value === undefined ? (previous ?? null) : (value === null || value === '' ? null : Number(value));
          const categoryId = relationId(body.categoryId, item.categoryId);
          const brandId = relationId(body.brandId, item.brandId);
          const supplierId = relationId(body.supplierId, item.supplierId);
          const description = String(body.description ?? item.description ?? '').trim().slice(0, 3000);
          const technicalDetails = String(body.technicalDetails ?? item.technicalDetails ?? '').trim().slice(0, 5000);
          const imageUrl = normalizeProductImageUrl(body.imageUrl === undefined ? item.imageUrl : body.imageUrl);
          const images = normalizeProductImages(body.images === undefined ? item.images : body.images, imageUrl);
          if (sku.length < 2 || sku.length > 60 || name.length < 2 || name.length > 180
            || !Number.isSafeInteger(costPrice) || costPrice < 0
            || !Number.isSafeInteger(sellingPrice) || sellingPrice < 0
            || !Number.isSafeInteger(warrantyMonths) || warrantyMonths < 0 || warrantyMonths > 120) {
            throw createError('SKU, tên, giá hoặc thời hạn bảo hành không hợp lệ.');
          }
          if (body.isActive !== undefined && typeof body.isActive !== 'boolean') throw createError('Trạng thái bán của sản phẩm phải là true/false.');
          if (data.products.some((row) => row.id !== id && String(row.sku || '').toLowerCase() === sku.toLowerCase())) throw createError('SKU đã tồn tại.', 409);
          if (categoryId !== null && (!Number.isSafeInteger(categoryId) || !data.categories.some((row) => row.id === categoryId))) throw createError('Danh mục không tồn tại.');
          if (brandId !== null && (!Number.isSafeInteger(brandId) || !data.brands.some((row) => row.id === brandId))) throw createError('Thương hiệu không tồn tại.');
          if (supplierId !== null && (!Number.isSafeInteger(supplierId) || !data.suppliers.some((row) => row.id === supplierId))) throw createError('Nhà cung cấp không tồn tại.');
          Object.assign(item, {
            sku, name, costPrice, sellingPrice, warrantyMonths, categoryId, brandId, supplierId,
            description, technicalDetails, imageUrl: imageUrl || images[0] || '', images,
            categoryName: data.categories.find((row) => row.id === categoryId)?.name || '',
            brandName: data.brands.find((row) => row.id === brandId)?.name || '',
            supplierName: data.suppliers.find((row) => row.id === supplierId)?.name || '',
            ...(body.isActive === undefined ? {} : { isActive: body.isActive }),
          });
        } else if (key === 'branches') {
          if (Object.hasOwn(body, 'id') && Number(body.id) !== id) throw createError('Không được thay đổi ID chi nhánh.', 400);
          const code = String(body.code ?? item.code ?? '').trim().toUpperCase();
          const name = String(body.name ?? item.name ?? '').trim();
          if (!/^[A-Z0-9._-]{2,30}$/.test(code) || name.length < 2 || name.length > 150) throw createError('Mã hoặc tên chi nhánh không hợp lệ.');
          if (data.branches.some((row) => row.id !== id && String(row.code || '').toUpperCase() === code)) throw createError('Mã chi nhánh đã tồn tại.', 409);
          if (body.isActive !== undefined && typeof body.isActive !== 'boolean') throw createError('Trạng thái chi nhánh phải là true/false.');
          Object.assign(item, {
            code, name,
            address: String(body.address ?? item.address ?? '').trim().slice(0, 255),
            phone: String(body.phone ?? item.phone ?? '').trim().slice(0, 30),
            ...(body.isActive === undefined ? {} : { isActive: body.isActive }),
          });
        } else Object.assign(item, body);
        recordActivity(data, user, `${key}.updated`, { id });
        return persist({ data: key === 'users' ? safeUser(item) : item, message: 'Đã cập nhật dữ liệu demo.' });
      }
      if (method === 'DELETE') {
        requireManager(user);
        if (key === 'products') {
          const hasHistory = data.sales.some((sale) => (sale.items || []).some((line) => line.productId === id))
            || data.movements.some((movement) => movement.productId === id)
            || data.transfers.some((transfer) => (transfer.items || []).some((line) => line.productId === id))
            || data.counts.some((count) => (count.items || []).some((line) => line.productId === id))
            || data.purchaseReceipts.some((receipt) => (receipt.items || []).some((line) => line.productId === id))
            || data.warranties.some((warranty) => warranty.productId === id)
            || data.returns.some((record) => (record.items || []).some((line) => line.productId === id))
            || data.serials.some((serial) => serial.productId === id);
          if (hasHistory || data.stock.some((stock) => stock.productId === id && Number(stock.quantity) > 0)) {
            throw createError('Sản phẩm đã có lịch sử nghiệp vụ hoặc đang tồn kho; hãy ngừng kinh doanh thay vì xóa để giữ quan hệ dữ liệu.', 409);
          }
          data.stock = data.stock.filter((stock) => stock.productId !== id);
        }
        if (key === 'customers') {
          const hasHistory = data.sales.some((sale) => sale.customerId === id)
            || data.warranties.some((warranty) => warranty.customerId === id);
          if (hasHistory || item.isMember === true || Number(item.loyaltyPoints || 0) > 0) {
            throw createError('Khách hàng/thành viên đã có lịch sử hoặc số dư điểm; hãy ngừng hoạt động thay vì xóa hồ sơ.', 409);
          }
        }
        if (key === 'branches') {
          const hasReferences = data.users.some((record) => Number(record.branchId) === id)
            || data.stock.some((stock) => stock.branchId === id && Number(stock.quantity) > 0)
            || data.movements.some((movement) => movement.branchId === id)
            || data.sales.some((sale) => sale.branchId === id)
            || data.transfers.some((transfer) => transfer.fromBranchId === id || transfer.toBranchId === id)
            || data.counts.some((count) => count.branchId === id)
            || data.purchaseReceipts.some((receipt) => receipt.branchId === id)
            || data.warranties.some((warranty) => warranty.branchId === id)
            || data.serials.some((serial) => serial.branchId === id)
            || data.deliveryAreas.some((area) => area.branchId === id);
          if (hasReferences) throw createError('Chi nhánh đang được tài khoản, kho hoặc giao dịch sử dụng; hãy ngừng hoạt động thay vì xóa.', 409);
          data.stock = data.stock.filter((stock) => stock.branchId !== id);
        }
        if (key === 'users') {
          if (id === Number(user.id)) throw createError('Không thể xóa tài khoản đang đăng nhập.', 409);
          if (item.role === 'admin' && item.isActive !== false
            && !data.users.some((candidate) => candidate.id !== item.id && candidate.role === 'admin' && candidate.isActive !== false)) {
            throw createError('Không thể xóa tài khoản quản trị viên đang hoạt động cuối cùng.', 409);
          }
          const hasReferences = data.sales.some((sale) => sale.cashierId === id)
            || data.transfers.some((transfer) => transfer.createdBy === id)
            || data.counts.some((count) => count.createdBy === id)
            || data.auditLogs.some((entry) => entry.userId === id);
          if (hasReferences) throw createError('Tài khoản đã tạo giao dịch hoặc nhật ký; hãy khóa thay vì xóa.', 409);
        }
        data[key] = collection.filter((row) => row.id !== id);
        recordActivity(data, user, key + '.deleted', { id });
        return persist({ message: 'Đã xóa bản ghi demo.' });
      }
    }
  }

  // Lịch sử riêng của khách hàng.
  const customerHistory = route.match(/^\/customers\/(\d+)\/history$/);
  if (customerHistory && method === 'GET') {
    const id = Number(customerHistory[1]);
    const customer = data.customers.find((item) => item.id === id);
    if (!customer) throw createError('Không tìm thấy khách hàng.', 404);
    const sales = data.sales.filter((sale) => sale.customerId === id && branchAllowed(user, sale.branchId)).map((sale) => {
      if (!['sales', 'employee'].includes(user.role)) return sale;
      return {
        ...sale,
        items: (sale.items || []).map(({ costPrice, unitCost, ...line }) => line),
      };
    });
    return { customer, sales, warranties: data.warranties.filter((warranty) => warranty.customerId === id && branchAllowed(user, warranty.branchId)) };
  }

  // Tồn kho tổng hợp và lịch sử nhập/xuất.
  if (route === '/inventory/stock' && method === 'GET') {
    const requestedBranch = query.get('branchId') ? Number(query.get('branchId')) : null;
    const stockRows = [];
    for (const product of data.products) {
      const branchRows = data.stock.filter((row) => row.productId === product.id
        && branchAllowed(user, row.branchId)
        && (!requestedBranch || (user.role === 'admin' && row.branchId === requestedBranch)));
      if (requestedBranch && user.role !== 'admin') continue;
      if (branchRows.length) {
        if (requestedBranch || user.role !== 'admin') {
          for (const row of branchRows) stockRows.push(getStockRow(data, product, row.branchId, row.quantity, user.role));
        } else {
          stockRows.push(getStockRow(data, product, null, branchRows.reduce((sum, row) => sum + row.quantity, 0), user.role));
        }
      } else if (!requestedBranch && user.role === 'admin') {
        stockRows.push(getStockRow(data, product, data.branches[0]?.id, 0, user.role));
      }
    }
    return paginated(stockRows, query);
  }
  if (route === '/inventory/movements' && method === 'GET') {
    const requestedBranch = query.get('branchId') ? Number(query.get('branchId')) : null;
    const rows = data.movements.filter((item) => branchAllowed(user, item.branchId) && (!requestedBranch || (user.role === 'admin' && item.branchId === requestedBranch))).map((item) => ({
      ...item,
      branchName: data.branches.find((b) => b.id === item.branchId)?.name || '—',
      sku: item.sku || data.products.find((p) => p.id === item.productId)?.sku || '',
    }));
    return paginated(rows, query);
  }
  if (route === '/inventory/movements' && method === 'POST') {
    requireManager(user);
    const productId = Number(body.productId);
    const branchId = Number(body.branchId ?? user.branchId);
    const quantity = Number(body.quantity);
    const kind = body.movementType;
    const branch = data.branches.find((item) => item.id === branchId && item.isActive !== false);
    if (!Number.isSafeInteger(productId) || productId <= 0
      || !Number.isSafeInteger(branchId) || branchId <= 0 || !branch
      || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 1000000
      || !['receipt', 'issue'].includes(kind)) {
      throw createError('Sản phẩm, chi nhánh, loại biến động hoặc số lượng không hợp lệ.');
    }
    if (!branchAllowed(user, branchId)) throw createError('Không thể điều chỉnh tồn kho ở chi nhánh khác.', 403);
    const delta = kind === 'receipt' ? quantity : -quantity;
    const before = stockQuantity(data, productId, branchId);
    const after = changeStock(data, user, productId, branchId, delta, kind, `MOV-${nextId(data, 'movements')}`, String(body.note || '').trim().slice(0, 500));
    const movement = data.movements[0];
    recordActivity(data, user, `stock.${kind}`, { productId, branchId, delta });
    return persist({ message: 'Đã cập nhật tồn kho demo.', movement: { ...movement, quantityBefore: before, quantityAfter: after }, data: movement });
  }

  // Điều chuyển: nháp không đổi kho, xuất nguồn trừ kho một lần, nhận đích cộng một lần.
  if (route === '/inventory/transfers' && method === 'GET') {
    const branch = query.get('branchId') ? Number(query.get('branchId')) : null;
    const rows = data.transfers.filter((item) => (branchAllowed(user, item.fromBranchId) || branchAllowed(user, item.toBranchId))
      && (!branch || (user.role === 'admin' && (item.fromBranchId === branch || item.toBranchId === branch)))).map((item) => decorateTransfer(data, item));
    return paginated(rows, query);
  }
  if (route === '/inventory/transfers' && method === 'POST') {
    requireManager(user);
    const fromBranchId = Number(body.fromBranchId ?? user.branchId);
    const toBranchId = Number(body.toBranchId);
    const fromBranch = data.branches.find((branch) => branch.id === fromBranchId && branch.isActive !== false);
    const toBranch = data.branches.find((branch) => branch.id === toBranchId && branch.isActive !== false);
    const items = Array.isArray(body.items) ? body.items : [];
    if (!Number.isSafeInteger(fromBranchId) || !Number.isSafeInteger(toBranchId)
      || !fromBranch || !toBranch || !branchAllowed(user, fromBranchId)
      || fromBranchId === toBranchId || !items.length || items.length > 100
      || items.some((line) => !line || typeof line !== 'object' || Array.isArray(line))) {
      throw createError('Nguồn, đích hoặc mặt hàng điều chuyển không hợp lệ.');
    }
    const seen = new Set();
    const lines = items.map((line) => {
      const productId = Number(line.productId);
      const quantity = Number(line.quantity);
      if (seen.has(productId)) throw createError('Không nhập trùng sản phẩm trong một phiếu.');
      seen.add(productId);
      const product = data.products.find((item) => item.id === productId && item.isActive);
      if (!product || !Number.isSafeInteger(quantity) || quantity < 1 || stockQuantity(data, productId, fromBranchId) < quantity) throw createError('Sản phẩm không hợp lệ hoặc tồn kho nguồn không đủ.');
      return { productId, productName: product.name, quantity };
    });
    const id = nextId(data, 'transfers');
    const transfer = { id, transferNo: `TR-${String(id).padStart(4, '0')}`, fromBranchId, toBranchId, items: lines, note: String(body.note || ''), status: 'draft', createdBy: user.id, createdAt: new Date().toISOString() };
    data.transfers.unshift(transfer);
    recordActivity(data, user, 'transfer.created', { transferId: id });
    const saved = decorateTransfer(data, transfer);
    return persist({ message: 'Đã tạo phiếu nháp.', transferNo: saved.transferNo, data: saved });
  }
  const transferAction = route.match(/^\/inventory\/transfers\/(\d+)\/(ship|receive|cancel)$/);
  if (transferAction && method === 'POST') {
    const transfer = data.transfers.find((item) => item.id === Number(transferAction[1]));
    const action = transferAction[2];
    if (!transfer || !(branchAllowed(user, transfer.fromBranchId) || branchAllowed(user, transfer.toBranchId))) throw createError('Không tìm thấy phiếu điều chuyển.', 404);
    if (action === 'ship') {
      requireManager(user);
      if (transfer.status !== 'draft' || !branchAllowed(user, transfer.fromBranchId)) throw createError('Phiếu không ở trạng thái có thể xuất nguồn.', 409);
      for (const line of transfer.items) if (stockQuantity(data, line.productId, transfer.fromBranchId) < line.quantity) throw createError('Tồn kho nguồn đã thay đổi; không thể xuất phiếu.', 409);
      for (const line of transfer.items) changeStock(data, user, line.productId, transfer.fromBranchId, -line.quantity, 'transfer_out', transfer.transferNo, transfer.note);
      transfer.status = 'shipped';
      transfer.shippedAt = new Date().toISOString();
    } else if (action === 'receive') {
      requireManager(user);
      if (transfer.status !== 'shipped' || !branchAllowed(user, transfer.toBranchId)) throw createError('Chỉ chi nhánh đích nhận được phiếu đã xuất.', 409);
      for (const line of transfer.items) changeStock(data, user, line.productId, transfer.toBranchId, line.quantity, 'transfer_in', transfer.transferNo, transfer.note);
      transfer.status = 'received';
      transfer.receivedAt = new Date().toISOString();
    } else {
      requireManager(user);
      if (transfer.status !== 'draft' || !branchAllowed(user, transfer.fromBranchId)) throw createError('Chỉ hủy phiếu nháp từ kho nguồn.', 409);
      transfer.status = 'cancelled';
      transfer.cancelledAt = new Date().toISOString();
    }
    recordActivity(data, user, `transfer.${action}`, { transferId: transfer.id });
    const messages = { ship: 'Đã xuất hàng khỏi kho nguồn.', receive: 'Đã nhận hàng vào kho đích.', cancel: 'Đã hủy phiếu nháp.' };
    return persist({ message: messages[action], data: decorateTransfer(data, transfer) });
  }

  // Kiểm kê chụp snapshot tồn kho; chỉ chốt nếu tồn chưa bị thay đổi giữa chừng.
  if (route === '/inventory/counts' && method === 'GET') return paginated(data.counts.filter((count) => branchAllowed(user, count.branchId)).map((count) => decorateCount(data, count)), query);
  if (route === '/inventory/counts' && method === 'POST') {
    requireManager(user);
    const branchId = Number(body.branchId ?? user.branchId);
    const branch = data.branches.find((item) => item.id === branchId && item.isActive !== false);
    if (!Number.isSafeInteger(branchId) || branchId <= 0 || !branch) throw createError('Chi nhánh kiểm kê không tồn tại hoặc đã ngừng hoạt động.');
    if (!branchAllowed(user, branchId)) throw createError('Không thể kiểm kê chi nhánh khác.', 403);
    const incoming = Array.isArray(body.items) ? body.items : [];
    if (!incoming.length || incoming.length > 100) throw createError('Chọn từ 1 đến 100 sản phẩm cần kiểm kê.');
    if (incoming.some((item) => !item || typeof item !== 'object' || Array.isArray(item))) throw createError('Dòng kiểm kê phải chứa mã sản phẩm hợp lệ.');
    const productIds = [...new Set(incoming.map((item) => Number(item.productId)))];
    if (productIds.length !== incoming.length) throw createError('Không được chọn trùng sản phẩm.');
    const items = productIds.map((productId) => {
      const product = data.products.find((item) => item.id === productId);
      if (!product) throw createError('Có sản phẩm không còn tồn tại.');
      return { productId, productName: product.name, sku: product.sku, systemQuantity: stockQuantity(data, productId, branchId), countedQuantity: null };
    });
    const id = nextId(data, 'counts');
    const count = { id, countNo: `CNT-${String(id).padStart(4, '0')}`, branchId, note: String(body.note || ''), status: 'counting', items, createdBy: user.id, createdAt: new Date().toISOString() };
    data.counts.unshift(count);
    recordActivity(data, user, 'stock_count.created', { countId: id });
    return persist({ message: 'Đã tạo phiếu kiểm kê.', id, countNo: count.countNo, count: decorateCount(data, count) });
  }
  const countAction = route.match(/^\/inventory\/counts\/(\d+)(?:\/(items|complete|cancel))?$/);
  if (countAction) {
    const count = data.counts.find((item) => item.id === Number(countAction[1]));
    if (!count || !branchAllowed(user, count.branchId)) throw createError('Không tìm thấy phiếu kiểm kê.', 404);
    const action = countAction[2];
    if (method === 'GET') return {
      count: decorateCount(data, count),
      items: count.items.map((item) => ({ ...item, productName: data.products.find((p) => p.id === item.productId)?.name || item.productName, sku: data.products.find((p) => p.id === item.productId)?.sku || item.sku })),
    };
    if (action === 'items' && method === 'PATCH') {
      if (count.status !== 'counting') throw createError('Chỉ sửa phiếu đang kiểm kê.', 409);
      const incoming = Array.isArray(body.items) ? body.items : [];
      for (const line of incoming) {
        const item = count.items.find((entry) => entry.productId === Number(line.productId));
        const quantity = Number(line.countedQuantity);
        if (!item || !Number.isSafeInteger(quantity) || quantity < 0 || quantity > 1000000) throw createError('Số đếm không hợp lệ.');
        item.countedQuantity = quantity;
      }
      return persist({ message: 'Đã lưu số đếm.', count: decorateCount(data, count) });
    }
    if (action === 'complete' && method === 'POST') {
      requireManager(user);
      if (count.status !== 'counting' || count.items.some((item) => item.countedQuantity == null)) throw createError('Cần nhập số đếm cho tất cả sản phẩm trước khi chốt.', 409);
      for (const item of count.items) {
        if (stockQuantity(data, item.productId, count.branchId) !== item.systemQuantity) throw createError('Tồn kho đã đổi sau khi lập phiếu; không chốt để tránh ghi đè số liệu.');
      }
      let adjustmentCount = 0;
      for (const item of count.items) {
        const delta = item.countedQuantity - item.systemQuantity;
        if (delta) {
          changeStock(data, user, item.productId, count.branchId, delta, 'count_adjustment', count.countNo, count.note);
          adjustmentCount += 1;
        }
      }
      count.status = 'completed';
      count.completedAt = new Date().toISOString();
      recordActivity(data, user, 'stock_count.completed', { countId: count.id });
      return persist({ message: 'Đã chốt phiếu kiểm kê.', adjustmentCount, count: decorateCount(data, count) });
    }
    if (action === 'cancel' && method === 'POST') {
      requireManager(user);
      if (count.status !== 'counting') throw createError('Chỉ hủy phiếu chưa chốt.', 409);
      count.status = 'cancelled';
      return persist({ message: 'Đã hủy phiếu kiểm kê.' });
    }
  }

  // Nhập hàng chỉ cập nhật tồn khi xác nhận; thao tác trùng bị từ chối theo trạng thái.
  if (route === '/purchase-receipts' && method === 'GET') return paginated(data.purchaseReceipts.filter((item) => branchAllowed(user, item.branchId)), query);
  const receiptAction = route.match(/^\/purchase-receipts\/(\d+)\/(confirm|cancel)$/);
  if (receiptAction && method === 'POST') {
    requireManager(user);
    const receipt = data.purchaseReceipts.find((item) => item.id === Number(receiptAction[1]));
    if (!receipt || !branchAllowed(user, receipt.branchId)) throw createError('Không tìm thấy phiếu nhập.', 404);
    if (receipt.status !== 'draft') throw createError('Phiếu nhập này đã được xử lý.', 409);
    if (receiptAction[2] === 'confirm') {
      for (const line of receipt.items) changeStock(data, user, line.productId, receipt.branchId, line.quantity, 'receipt', receipt.code, 'Nhập theo phiếu');
      receipt.status = 'confirmed';
      receipt.confirmedAt = new Date().toISOString();
    } else receipt.status = 'cancelled';
    recordActivity(data, user, `purchase_receipt.${receiptAction[2]}`, { receiptId: receipt.id });
    return persist({ data: receipt, message: receiptAction[2] === 'confirm' ? 'Đã xác nhận nhập hàng.' : 'Đã hủy phiếu nháp.' });
  }

  // Bán hàng tính lại giá từ danh mục, khóa logic tồn kho và ghi nhận thanh toán mô phỏng.
  if (route === '/sales' && method === 'POST') {
    if (!['admin', 'manager', 'sales', 'employee'].includes(user.role)) throw createError('Vai trò này không được tạo đơn hàng.', 403);
    const branchId = Number(body.branchId ?? user.branchId);
    if (!Number.isSafeInteger(branchId) || branchId <= 0) throw createError('Hãy chọn một chi nhánh hợp lệ trước khi tạo hóa đơn.');
    const branch = data.branches.find((item) => item.id === branchId && item.isActive !== false);
    if (!branch) throw createError('Chi nhánh không tồn tại hoặc đã ngừng hoạt động.', 409);
    if (!branchAllowed(user, branchId)) throw createError('Không thể bán hàng tại chi nhánh khác.', 403);
    const paymentMethod = String(body.paymentMethod || 'cash');
    if (!['cash', 'card', 'bank_transfer', 'e_wallet', 'other'].includes(paymentMethod)) {
      throw createError('Phương thức thanh toán demo không hợp lệ.');
    }
    const customerWasSelected = body.customerId !== undefined && body.customerId !== null && body.customerId !== '';
    const customer = customerWasSelected
      ? data.customers.find((item) => item.id === Number(body.customerId) && item.isActive !== false)
      : null;
    if (customerWasSelected && !customer) throw createError('Khách hàng được chọn không tồn tại hoặc đã ngừng hoạt động.', 404);
    const incoming = Array.isArray(body.items) ? body.items : [];
    if (!incoming.length || incoming.length > 50) throw createError('Đơn hàng cần 1–50 dòng sản phẩm.');
    if (incoming.some((line) => !line || typeof line !== 'object' || Array.isArray(line))) throw createError('Mỗi dòng hóa đơn phải có mã sản phẩm và số lượng hợp lệ.');
    if (new Set(incoming.map((line) => Number(line.productId))).size !== incoming.length) throw createError('Không được thêm trùng sản phẩm vào cùng hóa đơn.');
    let subtotal = 0;
    const saleItems = incoming.map((line, index) => {
      const product = data.products.find((item) => item.id === Number(line.productId) && item.isActive);
      const quantity = Number(line.quantity);
      const unitPrice = Number(product?.sellingPrice);
      const unitCost = Number(product?.costPrice ?? 0);
      if (!product || !Number.isSafeInteger(quantity) || quantity < 1
        || !Number.isSafeInteger(unitPrice) || unitPrice <= 0
        || !Number.isSafeInteger(unitCost) || unitCost < 0
        || stockQuantity(data, product.id, branchId) < quantity) {
        throw createError(`Sản phẩm ${product?.name || ''} chưa được định giá hợp lệ hoặc tồn kho không đủ.`, 409);
      }
      const lineTotal = unitPrice * quantity;
      if (!Number.isSafeInteger(lineTotal) || !Number.isSafeInteger(subtotal + lineTotal)) {
        throw createError('Tổng tiền vượt giới hạn tính toán an toàn; hãy giảm số lượng hoặc tách hóa đơn.');
      }
      subtotal += lineTotal;
      return { id: index + 1, productId: product.id, productName: product.name, quantity, unitPrice, costPrice: unitCost, lineTotal };
    });
    let discountAmount = 0;
    let promotion = null;
    if (body.promotionCode) {
      const code = String(body.promotionCode).trim().toUpperCase();
      promotion = data.promotions.find((item) => String(item.code || '').trim().toUpperCase() === code && item.isActive !== false);
      const now = Date.now();
      const startAt = Date.parse(promotion?.startAt);
      const endAt = Date.parse(promotion?.endAt);
      const discountType = promotion?.discountType;
      const discountValue = Number(promotion?.discountValue);
      const minimumOrder = Number(promotion?.minimumOrder ?? 0);
      const usedCount = Number(promotion?.usedCount ?? 0);
      const reservedCount = Number(promotion?.reservedCount ?? 0);
      if (!promotion || !Number.isFinite(startAt) || !Number.isFinite(endAt)
        || now < startAt || now > endAt
        || !Number.isSafeInteger(minimumOrder) || minimumOrder < 0 || subtotal < minimumOrder
        || !Number.isSafeInteger(discountValue) || discountValue <= 0
        || !['percent', 'amount'].includes(discountType)
        || (discountType === 'percent' && discountValue > 100)
        || (promotion.memberOnly === true && customer?.isMember !== true)
        || !Number.isSafeInteger(usedCount) || usedCount < 0
        || !Number.isSafeInteger(reservedCount) || reservedCount < 0
        || (promotion.usageLimit != null
          && (!Number.isSafeInteger(Number(promotion.usageLimit)) || Number(promotion.usageLimit) < 1
            || usedCount + reservedCount >= Number(promotion.usageLimit)))) {
        throw createError('Mã khuyến mãi không hợp lệ, hết hạn, hết lượt hoặc khách hàng chưa đủ điều kiện.');
      }
      discountAmount = discountType === 'percent'
        ? Math.floor(subtotal * discountValue / 100)
        : Math.min(subtotal, discountValue);
      if (!Number.isSafeInteger(discountAmount) || discountAmount < 0 || discountAmount > subtotal) {
        throw createError('Giá trị giảm giá không hợp lệ.');
      }
    }
    const totalAmount = subtotal - discountAmount;
    if (!Number.isSafeInteger(totalAmount) || totalAmount < 0) throw createError('Tổng thanh toán không hợp lệ.');
    const id = nextId(data, 'sales');
    const isCash = paymentMethod === 'cash';
    let discountAllocated = 0;
    saleItems.forEach((line, index) => {
      const lineDiscount = index === saleItems.length - 1
        ? discountAmount - discountAllocated
        : (subtotal ? Math.floor(discountAmount * line.lineTotal / subtotal) : 0);
      discountAllocated += lineDiscount;
      line.netLineTotal = line.lineTotal - lineDiscount;
      line.returnedQuantity = 0;
      line.returnedAmount = 0;
    });
    const sale = {
      id, invoiceNo: `DEMO-${String(id).padStart(4, '0')}`, customerId: customer?.id || null,
      customerName: customer?.fullName || 'Khách lẻ', branchId, cashierId: user.id,
      status: isCash ? 'completed' : 'draft', paymentStatus: isCash ? 'completed' : 'pending',
      paymentMethod: isCash ? 'cash' : paymentMethod, paymentReference: String(body.paymentReference || '').trim().slice(0, 100),
      subtotal, discountAmount, promotionCode: promotion?.code || null, promotionUsageReserved: false, totalAmount,
      returnedAmount: 0, loyaltyPointsEarned: 0, loyaltyPointsAwarded: false,
      loyaltyPointsReversed: 0, createdAt: new Date().toISOString(), items: saleItems,
    };
    data.sales.unshift(sale);
    if (isCash) {
      for (const line of saleItems) changeStock(data, user, line.productId, branchId, -line.quantity, 'sale', sale.invoiceNo);
      data.payments.unshift({ id: nextId(data, 'payments'), saleId: id, method: 'cash', status: 'completed', amount: sale.totalAmount, referenceNo: sale.invoiceNo, createdAt: sale.createdAt });
      for (const line of saleItems) {
        const product = data.products.find((item) => item.id === line.productId);
        if (customer && product && Number(product.warrantyMonths) > 0
          && !data.warranties.some((warranty) => warranty.saleId === id && warranty.productId === line.productId)) {
          data.warranties.unshift({ id: nextId(data, 'warranties'), code: `WAR-${String(data.nextIds.warranties - 1).padStart(5, '0')}`, saleId: id, productId: line.productId, productName: product.name, customerId: customer.id, customerName: customer.fullName, branchId, startDate: sale.createdAt.slice(0, 10), endDate: new Date(Date.now() + Number(product.warrantyMonths) * 30 * 86400000).toISOString().slice(0, 10), status: 'active' });
        }
      }
      if (customer?.isMember) {
        const points = Math.floor(Math.max(0, subtotal - discountAmount) / 10000);
        creditLoyaltyPoints(customer, points);
        sale.loyaltyPointsEarned = points;
        sale.loyaltyPointsAwarded = true;
      }
      if (promotion) promotion.usedCount += 1;
      recordActivity(data, user, 'sale.completed', { saleId: id, totalAmount: sale.totalAmount });
      return persist({ sale, payment: null, message: 'Đã ghi nhận đơn tiền mặt trong dữ liệu demo.' });
    }
    // Đơn chờ thanh toán giữ một lượt ưu đãi; khi thất bại thì nhả lượt để đơn khác có thể dùng.
    if (promotion) {
      promotion.reservedCount = Number(promotion.reservedCount || 0) + 1;
      sale.promotionUsageReserved = true;
    }
    // Thanh toán thẻ/chuyển khoản/ví chỉ là mô phỏng: chưa trừ tồn và chưa tính doanh thu.
    const signature = `local-demo-${id}`;
    data.payments.unshift({ id: nextId(data, 'payments'), saleId: id, method: paymentMethod, status: 'pending', amount: sale.totalAmount, referenceNo: sale.invoiceNo, createdAt: sale.createdAt });
    recordActivity(data, user, 'sale.payment_pending', { saleId: id });
    return persist({ sale, payment: { checkoutUrl: `/payment-demo?orderCode=${encodeURIComponent(sale.invoiceNo)}&signature=${encodeURIComponent(signature)}` }, message: 'Đơn đang chờ thao tác thanh toán mô phỏng; chưa thu tiền và chưa trừ tồn kho.' });
  }

  const saleReturn = route.match(/^\/sales\/(\d+)\/returns$/);
  if (saleReturn && method === 'POST') {
    requireManager(user);
    const sale = data.sales.find((item) => item.id === Number(saleReturn[1]) && branchAllowed(user, item.branchId));
    if (!sale || sale.status !== 'completed' || !['completed', 'partially_refunded'].includes(sale.paymentStatus)) throw createError('Chỉ hóa đơn đã thanh toán và còn số lượng được đổi trả.', 409);
    const incoming = Array.isArray(body.items) ? body.items : [];
    if (!incoming.length || incoming.length > 50) throw createError('Chọn từ 1 đến 50 dòng sản phẩm cần trả.');
    if (incoming.some((entry) => !entry || typeof entry !== 'object' || Array.isArray(entry))) throw createError('Mỗi dòng đổi trả phải có mã dòng hóa đơn và số lượng hợp lệ.');
    let refundAmount = 0;
    const returnItems = incoming.map((entry) => {
      const original = sale.items.find((line) => line.id === Number(entry.saleItemId) || line.productId === Number(entry.productId));
      const quantity = Number(entry.quantity);
      const previouslyReturned = data.returns.filter((record) => record.saleId === sale.id && record.status === 'completed')
        .flatMap((record) => record.items).filter((line) => line.saleItemId === original?.id).reduce((sum, line) => sum + line.quantity, 0);
      if (!original || !Number.isSafeInteger(quantity) || quantity < 1 || previouslyReturned + quantity > original.quantity) throw createError('Số lượng đổi trả vượt quá số lượng đã bán.');
      const netLineTotal = Number(original.netLineTotal ?? original.lineTotal);
      const alreadyRefundedQuantity = Number(original.returnedQuantity || 0);
      const alreadyRefundedAmount = Number(original.returnedAmount || 0);
      const amount = alreadyRefundedQuantity + quantity >= original.quantity
        ? netLineTotal - alreadyRefundedAmount
        : Math.floor(netLineTotal / original.quantity * quantity);
      refundAmount += amount;
      return { saleItemId: original.id, productId: original.productId, productName: original.productName, quantity, refundAmount: amount };
    });
    if (new Set(returnItems.map((item) => item.saleItemId)).size !== returnItems.length) throw createError('Không lặp dòng sản phẩm trong một phiếu trả.');
    const id = nextId(data, 'returns');
    const record = { id, returnNo: `RET-${String(id).padStart(4, '0')}`, saleId: sale.id, branchId: sale.branchId, items: returnItems, reason: String(body.reason || ''), refundAmount, status: 'completed', processedBy: user.id, createdAt: new Date().toISOString() };
    for (const line of returnItems) {
      changeStock(data, user, line.productId, sale.branchId, line.quantity, 'return', record.returnNo, record.reason);
      const original = sale.items.find((item) => item.id === line.saleItemId);
      original.returnedQuantity = Number(original.returnedQuantity || 0) + line.quantity;
      original.returnedAmount = Number(original.returnedAmount || 0) + line.refundAmount;
    }
    data.returns.unshift(record);
    sale.returnedAmount = Number(sale.returnedAmount || 0) + refundAmount;
    const refundableItemsAmount = Math.max(0, Number(sale.subtotal || 0) - Number(sale.discountAmount || 0));
    if (sale.loyaltyPointsAwarded) {
      const eligibleAmount = Math.max(0, Number(sale.subtotal || 0) - Number(sale.discountAmount || 0));
      const returnedEligibleAmount = (sale.items || []).reduce((sum, line) => sum + Number(line.returnedAmount || 0), 0);
      const targetReversedPoints = eligibleAmount > 0
        ? Math.min(Number(sale.loyaltyPointsEarned || 0), Math.floor(Number(sale.loyaltyPointsEarned || 0) * Math.min(1, returnedEligibleAmount / eligibleAmount)))
        : Number(sale.loyaltyPointsEarned || 0);
      const alreadyReversed = Math.max(0, Number(sale.loyaltyPointsReversed || 0));
      const pointsToReverse = Math.max(0, targetReversedPoints - alreadyReversed);
      if (pointsToReverse > 0) {
        const memberId = sale.memberCustomerId || sale.customerId;
        const member = data.customers.find((item) => item.id === memberId && item.isMember === true);
        if (member) debitLoyaltyPoints(member, pointsToReverse);
        sale.loyaltyPointsReversed = targetReversedPoints;
        recordActivity(data, user, 'loyalty.points_reversed_for_return', { saleId: sale.id, points: pointsToReverse });
      }
    }
    sale.paymentStatus = sale.returnedAmount >= refundableItemsAmount ? 'refunded' : 'partially_refunded';
    data.payments.unshift({ id: nextId(data, 'payments'), saleId: sale.id, method: 'refund-demo', status: 'simulated', amount: -refundAmount, referenceNo: record.returnNo, createdAt: record.createdAt });
    recordActivity(data, user, 'sale.returned', { saleId: sale.id, returnId: id, refundAmount });
    return persist({ return: record, message: 'Đã ghi phiếu đổi trả và hoàn tiền mô phỏng; không có giao dịch ngân hàng thật.' });
  }

  // Thanh toán mô phỏng không kết nối ngân hàng/ví. Chỉ nút xác nhận demo mới hoàn tất đơn.
  const paymentAction = route.match(/^\/payments\/mock\/([^/]+)\/complete$/);
  if (paymentAction && method === 'POST') {
    if (!ALLOW_MOCK_PAYMENT) throw createError('Not found.', 404);
    const orderCode = decodeURIComponent(paymentAction[1]);
    const sale = data.sales.find((item) => item.invoiceNo === orderCode && branchAllowed(user, item.branchId));
    if (!sale) throw createError('Không tìm thấy hóa đơn demo.', 404);
    if (sale.paymentStatus !== 'pending' || sale.status !== 'draft') throw createError('Đơn này đã được xử lý hoặc không còn chờ thanh toán.', 409);
    const payment = data.payments.find((item) => item.saleId === sale.id
      && item.referenceNo === sale.invoiceNo && item.status === 'pending');
    if (!payment) throw createError('Không tìm thấy giao dịch đang chờ khớp hóa đơn; dữ liệu thanh toán demo không nhất quán.', 409);
    if (body.success !== true) {
      sale.status = 'cancelled';
      sale.paymentStatus = 'failed';
      if (sale.promotionUsageReserved && sale.promotionCode) {
        const promotion = data.promotions.find((item) => item.code === sale.promotionCode);
        if (promotion) promotion.reservedCount = Math.max(0, Number(promotion.reservedCount || 0) - 1);
        sale.promotionUsageReserved = false;
      }
      const payment = data.payments.find((item) => item.saleId === sale.id && item.status === 'pending');
      if (payment) payment.status = 'cancelled';
      recordActivity(data, user, 'payment.simulation_failed', { saleId: sale.id });
      return persist({ status: 'cancelled', message: 'Đã mô phỏng giao dịch thất bại/hủy. Không thu tiền và không trừ tồn kho.' });
    }
    for (const line of sale.items) {
      if (stockQuantity(data, line.productId, sale.branchId) < line.quantity) throw createError('Tồn kho đã thay đổi; không thể hoàn tất đơn demo.', 409);
    }
    for (const line of sale.items) changeStock(data, user, line.productId, sale.branchId, -line.quantity, 'sale', sale.invoiceNo);
    sale.status = 'completed';
    sale.paymentStatus = 'completed';
    payment.status = 'simulated-completed';
    for (const line of sale.items) {
      const product = data.products.find((item) => item.id === line.productId);
      if (sale.customerId && product && Number(product.warrantyMonths) > 0
        && !data.warranties.some((warranty) => warranty.saleId === sale.id && warranty.productId === line.productId)) {
        data.warranties.unshift({ id: nextId(data, 'warranties'), code: `WAR-${String(data.nextIds.warranties - 1).padStart(5, '0')}`, saleId: sale.id, productId: line.productId, productName: product.name, customerId: sale.customerId, customerName: sale.customerName, branchId: sale.branchId, startDate: sale.createdAt.slice(0, 10), endDate: new Date(Date.now() + Number(product.warrantyMonths) * 30 * 86400000).toISOString().slice(0, 10), status: 'active' });
      }
    }
    const customer = data.customers.find((item) => item.id === sale.customerId && item.isMember === true);
    if (customer && !sale.loyaltyPointsAwarded) {
      const points = Math.floor(Math.max(0, Number(sale.subtotal || 0) - Number(sale.discountAmount || 0)) / 10000);
      creditLoyaltyPoints(customer, points);
      sale.loyaltyPointsEarned = points;
      sale.loyaltyPointsAwarded = true;
    }
    if (sale.promotionCode) {
      const promotion = data.promotions.find((item) => item.code === sale.promotionCode);
      if (promotion) {
        if (sale.promotionUsageReserved) {
          promotion.reservedCount = Math.max(0, Number(promotion.reservedCount || 0) - 1);
        }
        promotion.usedCount = Number(promotion.usedCount || 0) + 1;
      }
      sale.promotionUsageReserved = false;
    }
    recordActivity(data, user, 'payment.simulation_completed', { saleId: sale.id, amount: sale.totalAmount });
    return persist({ status: 'simulated-completed', message: 'Đã hoàn tất trạng thái thanh toán mô phỏng. Không có tiền thật được chuyển.' });
  }
  const paymentStatus = route.match(/^\/payments\/([^/]+)\/status$/);
  if (paymentStatus && method === 'GET') {
    const orderCode = decodeURIComponent(paymentStatus[1]);
    const sale = data.sales.find((item) => item.invoiceNo === orderCode && (!user || branchAllowed(user, item.branchId)));
    if (!sale) throw createError('Không tìm thấy hóa đơn demo.', 404);
    return { invoiceNo: sale.invoiceNo, paymentStatus: sale.paymentStatus, saleStatus: sale.status, amount: sale.totalAmount, mode: 'simulation-only' };
  }

  // Bảo hành và lịch sử hoạt động.
  if (route === '/warranties' && method === 'GET') return paginated(data.warranties
    .filter((item) => branchAllowed(user, item.branchId))
    .map((item) => {
      const product = data.products.find((record) => record.id === item.productId);
      const sale = data.sales.find((record) => record.id === item.saleId);
      const serial = data.serials.find((record) => Number(record.warrantyId) === Number(item.id)
        || (Number(record.productId) === Number(item.productId) && record.saleItemId != null
          && (sale?.items || []).some((line) => Number(line.id) === Number(record.saleItemId)
            && Number(line.productId) === Number(record.productId))));
      return {
        ...item,
        warrantyNo: item.warrantyNo || item.code || `WAR-${String(item.id).padStart(5, '0')}`,
        invoiceNo: item.invoiceNo || sale?.invoiceNo || '—',
        serialNo: item.serialNo || serial?.serial || '',
        sku: item.sku || product?.sku || '—',
        branchName: data.branches.find((branch) => branch.id === item.branchId)?.name || '—',
        productName: item.productName || product?.name || '',
        customerName: item.customerName || data.customers.find((customer) => customer.id === item.customerId)?.fullName || 'Khách lẻ',
      };
    }), query);
  const warrantyId = route.match(/^\/warranties\/(\d+)$/);
  if (warrantyId && method === 'PATCH') {
    requireManager(user);
    const warranty = data.warranties.find((item) => item.id === Number(warrantyId[1]) && branchAllowed(user, item.branchId));
    if (!warranty) throw createError('Không tìm thấy thông tin bảo hành.', 404);
    const transitions = {
      active: ['active', 'received', 'void'],
      received: ['received', 'repairing', 'completed', 'void'],
      repairing: ['repairing', 'received', 'completed', 'void'],
      completed: ['completed'],
      void: ['void'],
    };
    const status = body.status === undefined ? warranty.status : String(body.status);
    if (!transitions[warranty.status]?.includes(status)) {
      throw createError('Chuyển trạng thái bảo hành không hợp lệ. Hãy xử lý theo đúng quy trình tiếp nhận → sửa chữa → hoàn tất.', 409);
    }
    const issueDescription = String(body.issueDescription ?? warranty.issueDescription ?? '').trim();
    const resolution = String(body.resolution ?? warranty.resolution ?? '').trim();
    if (issueDescription.length > 1000 || resolution.length > 1000) {
      throw createError('Mô tả lỗi và kết quả xử lý không được vượt 1.000 ký tự.');
    }
    if (['received', 'repairing', 'completed'].includes(status) && issueDescription.length < 3) {
      throw createError('Cần ghi mô tả lỗi hoặc tình trạng tối thiểu 3 ký tự.');
    }
    if (status === 'completed' && resolution.length < 3) {
      throw createError('Cần ghi kết quả sửa chữa tối thiểu 3 ký tự trước khi hoàn tất.');
    }
    Object.assign(warranty, {
      status,
      issueDescription,
      resolution,
      updatedAt: new Date().toISOString(),
      processedBy: user.id,
    });
    recordActivity(data, user, 'warranty.updated', { warrantyId: warranty.id, status });
    return persist({ data: warranty, message: 'Đã cập nhật bảo hành demo.' });
  }
  if (route === '/notifications' && method === 'GET') return paginated(data.notifications.filter((item) => item.branchId == null || branchAllowed(user, item.branchId)), query);
  if (route === '/audit-logs' && method === 'GET') {
    if (user.role !== 'admin') throw createError('Chỉ quản trị viên xem nhật ký demo.', 403);
    return paginated(data.auditLogs, query);
  }

  throw createError('Phân hệ hoặc thao tác chưa được triển khai trong bộ dữ liệu trình duyệt.', 501);
}
