// Dữ liệu mẫu ban đầu của EMSystems. Đây là dữ liệu giả để học tập, không phải dữ liệu kinh doanh thật.
// Các ID là khóa liên kết ổn định giữa sản phẩm, chi nhánh, đơn hàng và chi tiết nghiệp vụ.
// Tuyệt đối không lưu mật khẩu, API secret hoặc khóa thanh toán trong file dữ liệu phía trình duyệt.
const createdAt = new Date().toISOString();

export const initialData = {
  meta: {
    mode: 'server-backed-demo',
    schemaVersion: 7,
    seededAt: createdAt,
    warning: 'Dữ liệu mẫu được khởi tạo và lưu trong SQLite phía máy chủ.'
  },
  users: [
    { id: 1, username: 'admin', email: 'admin@emsystems.local', fullName: 'Quản trị viên demo', role: 'admin', branchId: null, isActive: true },
    { id: 2, username: 'manager', email: 'manager@emsystems.local', fullName: 'Quản lý Đà Nẵng', role: 'manager', branchId: 1, isActive: true },
    { id: 3, username: 'sales', email: 'sales@emsystems.local', fullName: 'Nhân viên bán hàng', role: 'sales', branchId: 1, isActive: true },
    { id: 4, username: 'warehouse', email: 'warehouse@emsystems.local', fullName: 'Nhân viên kho', role: 'warehouse', branchId: 1, isActive: true }
  ],
  branches: [
    { id: 1, code: 'DN-01', name: 'Chi nhánh Đà Nẵng', address: 'Hải Châu, Đà Nẵng', phone: '02363888888', isActive: true },
    { id: 2, code: 'HN-01', name: 'Chi nhánh Hà Nội', address: 'Cầu Giấy, Hà Nội', phone: '02438888888', isActive: true }
  ],
  categories: [
    { id: 1, name: 'Điện thoại', description: 'Điện thoại thông minh', isActive: true },
    { id: 2, name: 'Máy tính', description: 'Laptop và máy tính', isActive: true },
    { id: 3, name: 'Phụ kiện', description: 'Phụ kiện điện tử', isActive: true },
    { id: 4, name: 'Máy tính bảng', description: 'Máy tính bảng và thiết bị tablet', isActive: true }
  ],
  brands: [
    { id: 1, name: 'Samsung', description: 'Thiết bị điện tử', isActive: true },
    { id: 2, name: 'Apple', description: 'Thiết bị điện tử', isActive: true },
    { id: 3, name: 'ASUS', description: 'Máy tính và linh kiện', isActive: true },
    { id: 4, name: 'Xiaomi', description: 'Điện tử tiêu dùng', isActive: true },
    { id: 5, name: 'Logitech', description: 'Thiết bị ngoại vi máy tính', isActive: true },
    { id: 6, name: 'Anker', description: 'Phụ kiện và sạc điện tử', isActive: true },
    { id: 7, name: 'Oppo', description: 'Điện thoại thông minh', isActive: true },
    { id: 8, name: 'Realme', description: 'Điện thoại thông minh', isActive: true },
    { id: 9, name: 'Vivo', description: 'Điện thoại thông minh', isActive: true },
    { id: 10, name: 'Huawei', description: 'Thiết bị di động và máy tính', isActive: true },
    { id: 11, name: 'Lenovo', description: 'Máy tính và thiết bị điện tử', isActive: true },
    { id: 12, name: 'Dell', description: 'Máy tính và thiết bị điện tử', isActive: true },
    { id: 13, name: 'Beats', description: 'Tai nghe và phụ kiện âm thanh', isActive: true }
  ],
  suppliers: [
    { id: 1, code: 'SUP-001', name: 'Nhà cung cấp Điện tử Á Châu', contactName: 'Nguyễn Minh An', phone: '0905000001', email: 'supplier1@example.test', address: 'Đà Nẵng', isActive: true },
    { id: 2, code: 'SUP-002', name: 'Công ty Công nghệ Việt', contactName: 'Trần Gia Huy', phone: '0905000002', email: 'supplier2@example.test', address: 'Hà Nội', isActive: true }
  ],
  products: [
    { id: 1, sku: 'PH-SAM-S7', name: 'Samsung Galaxy S7', categoryId: 1, brandId: 1, supplierId: 1, costPrice: 14500000, sellingPrice: 16990000, warrantyMonths: 12, unit: 'Cái', minStock: 5, isActive: true, imageUrl: 'https://cdn.dummyjson.com/product-images/smartphones/samsung-galaxy-s7/thumbnail.webp', dummyJsonId: 131, externalSource: 'dummyjson' },
    { id: 2, sku: 'PH-APL-IP13P', name: 'iPhone 13 Pro', categoryId: 1, brandId: 2, supplierId: 1, costPrice: 16000000, sellingPrice: 18990000, warrantyMonths: 12, unit: 'Cái', minStock: 5, isActive: true, imageUrl: 'https://cdn.dummyjson.com/product-images/smartphones/iphone-13-pro/thumbnail.webp', dummyJsonId: 123, externalSource: 'dummyjson' },
    { id: 3, sku: 'LT-ASU-ZENPRO', name: 'Asus Zenbook Pro Dual Screen Laptop', categoryId: 2, brandId: 3, supplierId: 2, costPrice: 12500000, sellingPrice: 14990000, warrantyMonths: 12, unit: 'Cái', minStock: 3, isActive: true, imageUrl: 'https://cdn.dummyjson.com/product-images/laptops/asus-zenbook-pro-dual-screen-laptop/thumbnail.webp', dummyJsonId: 79, externalSource: 'dummyjson' },
    { id: 4, sku: 'PH-SAM-S10', name: 'Samsung Galaxy S10', categoryId: 1, brandId: 1, supplierId: 1, costPrice: 3900000, sellingPrice: 4990000, warrantyMonths: 12, unit: 'Cái', minStock: 8, isActive: true, imageUrl: 'https://cdn.dummyjson.com/product-images/smartphones/samsung-galaxy-s10/thumbnail.webp', dummyJsonId: 133, externalSource: 'dummyjson' },
    { id: 5, sku: 'PK-APL-AIRPODS', name: 'Apple Airpods', categoryId: 3, brandId: 2, supplierId: 2, costPrice: 180000, sellingPrice: 290000, warrantyMonths: 6, unit: 'Cái', minStock: 10, isActive: true, imageUrl: 'https://cdn.dummyjson.com/product-images/mobile-accessories/apple-airpods/thumbnail.webp', dummyJsonId: 100, externalSource: 'dummyjson' },
    { id: 6, sku: 'PK-APL-AIRPOWER', name: 'Apple Airpower Wireless Charger', categoryId: 3, brandId: 2, supplierId: 1, costPrice: 220000, sellingPrice: 350000, warrantyMonths: 6, unit: 'Cái', minStock: 10, isActive: true, imageUrl: 'https://cdn.dummyjson.com/product-images/mobile-accessories/apple-airpower-wireless-charger/thumbnail.webp', dummyJsonId: 102, externalSource: 'dummyjson' },
    // 24 sản phẩm bổ sung cho catalog demo. Giá bán/tồn kho là dữ liệu mẫu VNĐ, không phải báo giá thị trường.
    { id: 7, sku: 'PH-APL-I5S', name: 'iPhone 5s', categoryId: 1, brandId: 2, supplierId: 1, costPrice: 350000, sellingPrice: 590000, warrantyMonths: 3, unit: 'Cái', minStock: 4, isActive: true, imageUrl: 'https://cdn.dummyjson.com/product-images/smartphones/iphone-5s/thumbnail.webp', dummyJsonId: 121, externalSource: 'dummyjson' },
    { id: 8, sku: 'PH-APL-I6', name: 'iPhone 6', categoryId: 1, brandId: 2, supplierId: 1, costPrice: 550000, sellingPrice: 890000, warrantyMonths: 3, unit: 'Cái', minStock: 4, isActive: true, imageUrl: 'https://cdn.dummyjson.com/product-images/smartphones/iphone-6/thumbnail.webp', dummyJsonId: 122, externalSource: 'dummyjson' },
    { id: 9, sku: 'PH-APL-IPHX', name: 'iPhone X', categoryId: 1, brandId: 2, supplierId: 1, costPrice: 2900000, sellingPrice: 3490000, warrantyMonths: 6, unit: 'Cái', minStock: 4, isActive: true, imageUrl: 'https://cdn.dummyjson.com/product-images/smartphones/iphone-x/thumbnail.webp', dummyJsonId: 124, externalSource: 'dummyjson' },
    { id: 10, sku: 'PH-OPO-A57', name: 'Oppo A57', categoryId: 1, brandId: 7, supplierId: 1, costPrice: 1900000, sellingPrice: 2490000, warrantyMonths: 6, unit: 'Cái', minStock: 4, isActive: true, imageUrl: 'https://cdn.dummyjson.com/product-images/smartphones/oppo-a57/thumbnail.webp', dummyJsonId: 125, externalSource: 'dummyjson' },
    { id: 11, sku: 'PH-OPO-F19PP', name: 'Oppo F19 Pro Plus', categoryId: 1, brandId: 7, supplierId: 1, costPrice: 2600000, sellingPrice: 3290000, warrantyMonths: 6, unit: 'Cái', minStock: 4, isActive: true, imageUrl: 'https://cdn.dummyjson.com/product-images/smartphones/oppo-f19-pro-plus/thumbnail.webp', dummyJsonId: 126, externalSource: 'dummyjson' },
    { id: 12, sku: 'PH-OPO-K1', name: 'Oppo K1', categoryId: 1, brandId: 7, supplierId: 1, costPrice: 1800000, sellingPrice: 2290000, warrantyMonths: 6, unit: 'Cái', minStock: 4, isActive: true, imageUrl: 'https://cdn.dummyjson.com/product-images/smartphones/oppo-k1/thumbnail.webp', dummyJsonId: 127, externalSource: 'dummyjson' },
    { id: 13, sku: 'PH-REA-C35', name: 'Realme C35', categoryId: 1, brandId: 8, supplierId: 1, costPrice: 2100000, sellingPrice: 2690000, warrantyMonths: 6, unit: 'Cái', minStock: 4, isActive: true, imageUrl: 'https://cdn.dummyjson.com/product-images/smartphones/realme-c35/thumbnail.webp', dummyJsonId: 128, externalSource: 'dummyjson' },
    { id: 14, sku: 'PH-REA-X', name: 'Realme X', categoryId: 1, brandId: 8, supplierId: 1, costPrice: 2400000, sellingPrice: 2990000, warrantyMonths: 6, unit: 'Cái', minStock: 4, isActive: true, imageUrl: 'https://cdn.dummyjson.com/product-images/smartphones/realme-x/thumbnail.webp', dummyJsonId: 129, externalSource: 'dummyjson' },
    { id: 15, sku: 'PH-REA-XT', name: 'Realme XT', categoryId: 1, brandId: 8, supplierId: 1, costPrice: 2700000, sellingPrice: 3290000, warrantyMonths: 6, unit: 'Cái', minStock: 4, isActive: true, imageUrl: 'https://cdn.dummyjson.com/product-images/smartphones/realme-xt/thumbnail.webp', dummyJsonId: 130, externalSource: 'dummyjson' },
    { id: 16, sku: 'PH-SAM-S8', name: 'Samsung Galaxy S8', categoryId: 1, brandId: 1, supplierId: 1, costPrice: 2300000, sellingPrice: 2790000, warrantyMonths: 6, unit: 'Cái', minStock: 4, isActive: true, imageUrl: 'https://cdn.dummyjson.com/product-images/smartphones/samsung-galaxy-s8/thumbnail.webp', dummyJsonId: 132, externalSource: 'dummyjson' },
    { id: 17, sku: 'PH-VIV-S1', name: 'Vivo S1', categoryId: 1, brandId: 9, supplierId: 1, costPrice: 2200000, sellingPrice: 2790000, warrantyMonths: 6, unit: 'Cái', minStock: 4, isActive: true, imageUrl: 'https://cdn.dummyjson.com/product-images/smartphones/vivo-s1/thumbnail.webp', dummyJsonId: 134, externalSource: 'dummyjson' },
    { id: 18, sku: 'PH-VIV-V9', name: 'Vivo V9', categoryId: 1, brandId: 9, supplierId: 1, costPrice: 1250000, sellingPrice: 1690000, warrantyMonths: 6, unit: 'Cái', minStock: 4, isActive: true, imageUrl: 'https://cdn.dummyjson.com/product-images/smartphones/vivo-v9/thumbnail.webp', dummyJsonId: 135, externalSource: 'dummyjson' },
    { id: 19, sku: 'PH-VIV-X21', name: 'Vivo X21', categoryId: 1, brandId: 9, supplierId: 1, costPrice: 1500000, sellingPrice: 1990000, warrantyMonths: 6, unit: 'Cái', minStock: 4, isActive: true, imageUrl: 'https://cdn.dummyjson.com/product-images/smartphones/vivo-x21/thumbnail.webp', dummyJsonId: 136, externalSource: 'dummyjson' },
    { id: 20, sku: 'LT-APL-MBP14', name: 'Apple MacBook Pro 14 Inch Space Grey', categoryId: 2, brandId: 2, supplierId: 2, costPrice: 30000000, sellingPrice: 34990000, warrantyMonths: 12, unit: 'Cái', minStock: 2, isActive: true, imageUrl: 'https://cdn.dummyjson.com/product-images/laptops/apple-macbook-pro-14-inch-space-grey/thumbnail.webp', dummyJsonId: 78, externalSource: 'dummyjson' },
    { id: 21, sku: 'LT-HUA-MATE-XP', name: 'Huawei Matebook X Pro', categoryId: 2, brandId: 10, supplierId: 2, costPrice: 22000000, sellingPrice: 25990000, warrantyMonths: 12, unit: 'Cái', minStock: 2, isActive: true, imageUrl: 'https://cdn.dummyjson.com/product-images/laptops/huawei-matebook-x-pro/thumbnail.webp', dummyJsonId: 80, externalSource: 'dummyjson' },
    { id: 22, sku: 'LT-LEN-YOGA920', name: 'Lenovo Yoga 920', categoryId: 2, brandId: 11, supplierId: 2, costPrice: 14000000, sellingPrice: 16990000, warrantyMonths: 12, unit: 'Cái', minStock: 2, isActive: true, imageUrl: 'https://cdn.dummyjson.com/product-images/laptops/lenovo-yoga-920/thumbnail.webp', dummyJsonId: 81, externalSource: 'dummyjson' },
    { id: 23, sku: 'LT-DEL-XPS13', name: 'New DELL XPS 13 9300 Laptop', categoryId: 2, brandId: 12, supplierId: 2, costPrice: 26000000, sellingPrice: 29990000, warrantyMonths: 12, unit: 'Cái', minStock: 2, isActive: true, imageUrl: 'https://cdn.dummyjson.com/product-images/laptops/new-dell-xps-13-9300-laptop/thumbnail.webp', dummyJsonId: 82, externalSource: 'dummyjson' },
    { id: 24, sku: 'TAB-APL-IPADMINI21', name: 'iPad Mini 2021 Starlight', categoryId: 4, brandId: 2, supplierId: 2, costPrice: 8500000, sellingPrice: 9990000, warrantyMonths: 12, unit: 'Cái', minStock: 3, isActive: true, imageUrl: 'https://cdn.dummyjson.com/product-images/tablets/ipad-mini-2021-starlight/thumbnail.webp', dummyJsonId: 159, externalSource: 'dummyjson' },
    { id: 25, sku: 'TAB-SAM-S8PLUS', name: 'Samsung Galaxy Tab S8 Plus Grey', categoryId: 4, brandId: 1, supplierId: 2, costPrice: 12500000, sellingPrice: 14990000, warrantyMonths: 12, unit: 'Cái', minStock: 3, isActive: true, imageUrl: 'https://cdn.dummyjson.com/product-images/tablets/samsung-galaxy-tab-s8-plus-grey/thumbnail.webp', dummyJsonId: 160, externalSource: 'dummyjson' },
    { id: 26, sku: 'TAB-SAM-WHITE', name: 'Samsung Galaxy Tab White', categoryId: 4, brandId: 1, supplierId: 2, costPrice: 4900000, sellingPrice: 5990000, warrantyMonths: 12, unit: 'Cái', minStock: 3, isActive: true, imageUrl: 'https://cdn.dummyjson.com/product-images/tablets/samsung-galaxy-tab-white/thumbnail.webp', dummyJsonId: 161, externalSource: 'dummyjson' },
    { id: 27, sku: 'PK-APL-AIRPODSMAX', name: 'Apple AirPods Max Silver', categoryId: 3, brandId: 2, supplierId: 2, costPrice: 10500000, sellingPrice: 12990000, warrantyMonths: 12, unit: 'Cái', minStock: 3, isActive: true, imageUrl: 'https://cdn.dummyjson.com/product-images/mobile-accessories/apple-airpods-max-silver/thumbnail.webp', dummyJsonId: 101, externalSource: 'dummyjson' },
    { id: 28, sku: 'PK-APL-HOMEPOD', name: 'Apple HomePod Mini Cosmic Grey', categoryId: 3, brandId: 2, supplierId: 2, costPrice: 2300000, sellingPrice: 2990000, warrantyMonths: 6, unit: 'Cái', minStock: 3, isActive: true, imageUrl: 'https://cdn.dummyjson.com/product-images/mobile-accessories/apple-homepod-mini-cosmic-grey/thumbnail.webp', dummyJsonId: 103, externalSource: 'dummyjson' },
    { id: 29, sku: 'PK-APL-CHARGER', name: 'Apple iPhone Charger', categoryId: 3, brandId: 2, supplierId: 1, costPrice: 280000, sellingPrice: 490000, warrantyMonths: 6, unit: 'Cái', minStock: 5, isActive: true, imageUrl: 'https://cdn.dummyjson.com/product-images/mobile-accessories/apple-iphone-charger/thumbnail.webp', dummyJsonId: 104, externalSource: 'dummyjson' },
    { id: 30, sku: 'PK-BEATS-FLEX', name: 'Beats Flex Wireless Earphones', categoryId: 3, brandId: 13, supplierId: 2, costPrice: 890000, sellingPrice: 1290000, warrantyMonths: 6, unit: 'Cái', minStock: 3, isActive: true, imageUrl: 'https://cdn.dummyjson.com/product-images/mobile-accessories/beats-flex-wireless-earphones/thumbnail.webp', dummyJsonId: 107, externalSource: 'dummyjson' }
  ],
  // Tồn kho mẫu cho sản phẩm của danh mục demo; ảnh/đặc điểm API không quyết định số lượng kho.
  stock: [
    { productId: 1, branchId: 1, quantity: 11 }, { productId: 2, branchId: 1, quantity: 8 },
    { productId: 3, branchId: 1, quantity: 4 }, { productId: 4, branchId: 1, quantity: 15 },
    { productId: 5, branchId: 1, quantity: 30 }, { productId: 6, branchId: 1, quantity: 2 },
    { productId: 1, branchId: 2, quantity: 5 }, { productId: 3, branchId: 2, quantity: 7 },
    { productId: 7, branchId: 1, quantity: 10 }, { productId: 7, branchId: 2, quantity: 4 },
    { productId: 8, branchId: 1, quantity: 12 }, { productId: 9, branchId: 1, quantity: 7 },
    { productId: 10, branchId: 1, quantity: 9 }, { productId: 10, branchId: 2, quantity: 3 },
    { productId: 11, branchId: 1, quantity: 6 }, { productId: 12, branchId: 1, quantity: 8 },
    { productId: 13, branchId: 1, quantity: 10 }, { productId: 13, branchId: 2, quantity: 5 },
    { productId: 14, branchId: 1, quantity: 6 }, { productId: 15, branchId: 1, quantity: 7 },
    { productId: 16, branchId: 1, quantity: 8 }, { productId: 17, branchId: 1, quantity: 9 },
    { productId: 18, branchId: 1, quantity: 6 }, { productId: 19, branchId: 1, quantity: 7 },
    { productId: 20, branchId: 1, quantity: 4 }, { productId: 20, branchId: 2, quantity: 2 },
    { productId: 21, branchId: 1, quantity: 3 }, { productId: 22, branchId: 1, quantity: 4 },
    { productId: 23, branchId: 1, quantity: 4 }, { productId: 24, branchId: 1, quantity: 5 },
    { productId: 25, branchId: 1, quantity: 4 }, { productId: 26, branchId: 1, quantity: 5 },
    { productId: 27, branchId: 1, quantity: 6 }, { productId: 28, branchId: 1, quantity: 8 },
    { productId: 29, branchId: 1, quantity: 15 }, { productId: 30, branchId: 1, quantity: 9 }
  ],
  customers: [
    // Tài khoản thành viên mẫu chỉ dùng thử tính năng tích điểm; đăng nhập bằng số điện thoại chưa phải xác minh danh tính thật.
    { id: 1, code: 'CUS-0001', fullName: 'Nguyễn Hoàng Anh', phone: '0905123456', email: 'hoanganh@example.test', address: '12 Nguyễn Văn Linh', city: 'Đà Nẵng', district: 'Hải Châu', ward: 'Thạch Thang', isActive: true, isMember: true, loyaltyPoints: 250, memberTier: 'Bạc', memberSince: createdAt },
    { id: 2, code: 'CUS-0002', fullName: 'Lê Minh Thư', phone: '0905765432', email: 'minhthu@example.test', address: 'Thanh Khê, Đà Nẵng', isActive: true, isMember: false, loyaltyPoints: 0, memberTier: 'Chưa đăng ký' },
    { id: 3, code: 'CUS-0003', fullName: 'Trần Quốc Bảo', phone: '0911222333', email: 'quocbao@example.test', address: 'Cầu Giấy, Hà Nội', isActive: true, isMember: false, loyaltyPoints: 0, memberTier: 'Chưa đăng ký' }
  ],
  // Khu vực giao hàng demo; khách tự chọn khu vực, không yêu cầu quyền truy cập GPS.
  deliveryAreas: [
    { id: 1, city: 'Đà Nẵng', district: 'Hải Châu', branchId: 1, shippingFee: 15000, eta: '2–4 giờ', isActive: true },
    { id: 2, city: 'Đà Nẵng', district: 'Thanh Khê', branchId: 1, shippingFee: 18000, eta: '2–4 giờ', isActive: true },
    { id: 3, city: 'Đà Nẵng', district: 'Sơn Trà', branchId: 1, shippingFee: 20000, eta: '3–5 giờ', isActive: true },
    { id: 4, city: 'Đà Nẵng', district: 'Ngũ Hành Sơn', branchId: 1, shippingFee: 22000, eta: '3–5 giờ', isActive: true },
    { id: 5, city: 'Đà Nẵng', district: 'Liên Chiểu', branchId: 1, shippingFee: 25000, eta: 'Trong ngày', isActive: true },
    { id: 6, city: 'Hà Nội', district: 'Cầu Giấy', branchId: 2, shippingFee: 20000, eta: '2–4 giờ', isActive: true },
    { id: 7, city: 'Hà Nội', district: 'Đống Đa', branchId: 2, shippingFee: 22000, eta: '2–4 giờ', isActive: true },
    { id: 8, city: 'Hà Nội', district: 'Ba Đình', branchId: 2, shippingFee: 22000, eta: '2–4 giờ', isActive: true },
    { id: 9, city: 'Hà Nội', district: 'Thanh Xuân', branchId: 2, shippingFee: 25000, eta: 'Trong ngày', isActive: true },
    { id: 10, city: 'Hà Nội', district: 'Hai Bà Trưng', branchId: 2, shippingFee: 25000, eta: 'Trong ngày', isActive: true }
  ],
  sales: [
    { id: 1, invoiceNo: 'DEMO-0001', customerId: 1, customerName: 'Nguyễn Hoàng Anh', branchId: 1, cashierId: 3, status: 'completed', paymentStatus: 'completed', paymentMethod: 'cash', subtotal: 16990000, discountAmount: 0, totalAmount: 16990000, returnedAmount: 0, createdAt, items: [{ id: 1, productId: 1, productName: 'Samsung Galaxy S7', quantity: 1, unitPrice: 16990000, lineTotal: 16990000, costPrice: 14500000, netLineTotal: 16990000, returnedQuantity: 0, returnedAmount: 0 }] }
  ],
  payments: [{ id: 1, saleId: 1, method: 'cash', status: 'completed', amount: 16990000, referenceNo: 'DEMO-0001', createdAt }],
  movements: [
    { id: 1, productId: 1, productName: 'Samsung Galaxy S7', sku: 'PH-SAM-S7', branchId: 1, movementType: 'opening', quantityDelta: 12, referenceCode: 'SEED-001', note: 'Tồn kho mẫu ban đầu', createdByName: 'Hệ thống', createdAt },
    { id: 2, productId: 1, productName: 'Samsung Galaxy S7', sku: 'PH-SAM-S7', branchId: 1, movementType: 'sale', quantityDelta: -1, referenceCode: 'DEMO-0001', note: 'Hóa đơn mẫu', createdByName: 'Nhân viên bán hàng', createdAt }
  ],
  transfers: [],
  counts: [],
  purchaseReceipts: [],
  serials: [],
  promotions: [
    { id: 1, code: 'THANHVIEN5', description: 'Giảm 5% cho thành viên từ 500.000đ', discountType: 'percent', discountValue: 5, minimumOrder: 500000, startAt: createdAt, endAt: new Date(Date.now() + 180 * 86400000).toISOString(), usageLimit: null, usedCount: 0, memberOnly: true, isActive: true },
    { id: 2, code: 'TECH50', description: 'Giảm 50.000đ cho đơn từ 2.000.000đ', discountType: 'amount', discountValue: 50000, minimumOrder: 2000000, startAt: createdAt, endAt: new Date(Date.now() + 90 * 86400000).toISOString(), usageLimit: null, usedCount: 0, memberOnly: false, isActive: true }
  ],
  returns: [],
  warrantyJobs: [],
  auditLogs: [],
  notifications: [],
  bankAccounts: [],
  supportRequests: [],
  warranties: [
    { id: 1, code: 'WAR-DEMO-0001', saleId: 1, productId: 1, productName: 'Samsung Galaxy S7', customerId: 1, customerName: 'Nguyễn Hoàng Anh', branchId: 1, startDate: createdAt.slice(0, 10), endDate: new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10), status: 'active' }
  ],
  nextIds: {
    users: 5, branches: 3, categories: 5, brands: 14, suppliers: 3, products: 31, customers: 4,
    sales: 2, payments: 2, movements: 3, transfers: 1, counts: 1, warranties: 2,
    purchaseReceipts: 1, serials: 1, promotions: 3, returns: 1, warrantyJobs: 1,
    auditLogs: 1, notifications: 1, bankAccounts: 1, supportRequests: 1
  }
};

// Tạo bản sao sâu để màn hình không sửa trực tiếp mảng dữ liệu mẫu dùng chung.
export function createInitialData() {
  return JSON.parse(JSON.stringify(initialData));
}
