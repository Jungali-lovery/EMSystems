// Nguồn catalog demo công khai. Dữ liệu API dùng để hiển thị ảnh/thông tin tham khảo;
// giá bán, mã hàng và tồn kho thực hành vẫn do danh mục EMSystems quản lý.
const API_ROOT = 'https://dummyjson.com/products';
export const ELECTRONICS_CATEGORIES = [
  { slug: 'smartphones', label: 'Điện thoại' },
  { slug: 'laptops', label: 'Laptop' },
  { slug: 'tablets', label: 'Máy tính bảng' },
  { slug: 'mobile-accessories', label: 'Phụ kiện di động' },
];

const labelBySlug = new Map(ELECTRONICS_CATEGORIES.map((item) => [item.slug, item.label]));
let catalogCache = null;
let catalogRequest = null;

function safeDummyImage(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' && url.hostname === 'cdn.dummyjson.com' && !url.username && !url.password
      ? url.href.slice(0, 1000) : '';
  } catch { return ''; }
}

function optionalFiniteNumber(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

async function loadDummyJsonElectronics({ signal } = {}) {
  const results = await Promise.allSettled(ELECTRONICS_CATEGORIES.map(async ({ slug }) => {
    const select = 'id,title,description,category,price,discountPercentage,rating,brand,sku,thumbnail,images,stock,tags,weight,dimensions,warrantyInformation,shippingInformation,returnPolicy,availabilityStatus,minimumOrderQuantity,reviews';
    const url = `${API_ROOT}/category/${encodeURIComponent(slug)}?limit=0&select=${select}`;
    const response = await fetch(url, { signal, headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`DummyJSON/${slug} trả về HTTP ${response.status}`);
    const result = await response.json();
    if (!Array.isArray(result.products)) throw new Error(`DummyJSON/${slug} trả dữ liệu sai định dạng`);
    return result.products.map((product) => ({
      id: Number(product.id),
      title: String(product.title || '').trim(),
      description: String(product.description || ''),
      category: product.category || slug,
      categoryName: labelBySlug.get(product.category || slug) || slug,
      priceUsd: Number(product.price) || 0,
      discountPercentage: Number(product.discountPercentage) || 0,
      rating: optionalFiniteNumber(product.rating) == null ? null : Math.max(0, Math.min(5, Number(product.rating))),
      brand: String(product.brand || '').trim(),
      externalSku: String(product.sku || ''),
      thumbnail: safeDummyImage(product.thumbnail) || safeDummyImage(product.images?.[0]),
      images: Array.isArray(product.images) ? [...new Set(product.images.map(safeDummyImage).filter(Boolean))].slice(0, 12) : [],
      apiStock: Number(product.stock) || 0,
      tags: Array.isArray(product.tags) ? product.tags.filter((tag) => typeof tag === 'string').slice(0, 20) : [],
      weight: optionalFiniteNumber(product.weight),
      dimensions: product.dimensions && typeof product.dimensions === 'object' ? {
        width: optionalFiniteNumber(product.dimensions.width),
        height: optionalFiniteNumber(product.dimensions.height),
        depth: optionalFiniteNumber(product.dimensions.depth),
      } : null,
      warrantyInformation: String(product.warrantyInformation || ''),
      shippingInformation: String(product.shippingInformation || ''),
      returnPolicy: String(product.returnPolicy || ''),
      availabilityStatus: String(product.availabilityStatus || ''),
      minimumOrderQuantity: optionalFiniteNumber(product.minimumOrderQuantity) != null
        && Number.isSafeInteger(Number(product.minimumOrderQuantity)) && Number(product.minimumOrderQuantity) > 0
        ? Number(product.minimumOrderQuantity) : null,
      reviews: Array.isArray(product.reviews) ? product.reviews.slice(0, 5).map((review) => ({
        rating: Number(review.rating) || 0,
        comment: String(review.comment || '').slice(0, 500),
        date: String(review.date || ''),
        reviewerName: String(review.reviewerName || 'Khách hàng').slice(0, 80),
      })) : [],
      source: 'DummyJSON',
    }));
  }));

  const products = [];
  const errors = [];
  for (let index = 0; index < results.length; index += 1) {
    const result = results[index];
    if (result.status === 'fulfilled') products.push(...result.value);
    else if (result.reason?.name !== 'AbortError') errors.push(result.reason?.message || ELECTRONICS_CATEGORIES[index].slug);
  }

  const unique = [...new Map(products.filter((item) => item.id > 0 && item.title).map((item) => [item.id, item])).values()];
  if (!unique.length) throw new Error(errors[0] || 'DummyJSON chưa cung cấp dữ liệu sản phẩm điện tử.');
  return { products: unique, errors, categories: ELECTRONICS_CATEGORIES };
}

// Catalog công khai ít thay đổi; cache trong bộ nhớ module để không gọi 4 endpoint sau mỗi lần đặt hàng.
// Request có AbortSignal chạy riêng để route có thể tự hủy khi unmount.
export async function fetchDummyJsonElectronics({ signal } = {}) {
  if (signal) return loadDummyJsonElectronics({ signal });
  if (catalogCache) return catalogCache;
  if (catalogRequest) return catalogRequest;
  catalogRequest = loadDummyJsonElectronics()
    .then((result) => {
      catalogCache = result;
      return result;
    })
    .finally(() => {
      catalogRequest = null;
    });
  return catalogRequest;
}
