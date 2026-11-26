// Tọa độ vùng giao mẫu dùng tính cự ly phía trình duyệt. Đây là tâm vùng ước lượng,
// không phải ranh giới hành chính/GIS chính thức; kinh doanh thật cần vùng phục vụ đã xác minh.
export const DELIVERY_AREA_CENTERS = Object.freeze({
  1: { latitude: 16.0607, longitude: 108.2154 }, // Hải Châu, Đà Nẵng
  2: { latitude: 16.0691, longitude: 108.1943 }, // Thanh Khê, Đà Nẵng
  3: { latitude: 16.1010, longitude: 108.2530 }, // Sơn Trà, Đà Nẵng
  4: { latitude: 16.0049, longitude: 108.2496 }, // Ngũ Hành Sơn, Đà Nẵng
  5: { latitude: 16.0736, longitude: 108.1517 }, // Liên Chiểu, Đà Nẵng
  6: { latitude: 21.0337, longitude: 105.7937 }, // Cầu Giấy, Hà Nội
  7: { latitude: 21.0150, longitude: 105.8236 }, // Đống Đa, Hà Nội
  8: { latitude: 21.0345, longitude: 105.8170 }, // Ba Đình, Hà Nội
  9: { latitude: 20.9947, longitude: 105.8016 }, // Thanh Xuân, Hà Nội
  10: { latitude: 21.0067, longitude: 105.8506 }, // Hai Bà Trưng, Hà Nội
});

export const DELIVERY_BRANCH_CENTERS = Object.freeze({
  1: { latitude: 16.0603, longitude: 108.2205 }, // Điểm xuất hàng Đà Nẵng (ước lượng)
  2: { latitude: 21.0333, longitude: 105.8025 }, // Điểm xuất hàng Hà Nội (ước lượng)
});

const MAX_AREA_CENTER_DISTANCE_KM = 8;
const MAX_DELIVERY_DISTANCE_KM = 20;

function validCoordinates(latitude, longitude) {
  return Number.isFinite(Number(latitude)) && Number(latitude) >= -90 && Number(latitude) <= 90
    && Number.isFinite(Number(longitude)) && Number(longitude) >= -180 && Number(longitude) <= 180;
}

export function distanceBetweenCoordinatesKm(from, to) {
  if (!from || !to || !validCoordinates(from.latitude, from.longitude)
    || !validCoordinates(to.latitude, to.longitude)) return Infinity;
  const radians = (value) => Number(value) * Math.PI / 180;
  const latitudeDelta = radians(Number(to.latitude) - Number(from.latitude));
  const longitudeDelta = radians(Number(to.longitude) - Number(from.longitude));
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(from.latitude)) * Math.cos(radians(to.latitude)) * Math.sin(longitudeDelta / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
}

export function findNearestSupportedDeliveryArea(areas, latitude, longitude) {
  if (!validCoordinates(latitude, longitude) || !Array.isArray(areas)) return null;
  let nearest = null;
  for (const area of areas) {
    if (area?.isActive === false) continue;
    const center = DELIVERY_AREA_CENTERS[Number(area.id)];
    if (!center) continue;
    const distanceKm = distanceBetweenCoordinatesKm({ latitude, longitude }, center);
    if (!nearest || distanceKm < nearest.distanceKm) nearest = { area, distanceKm };
  }
  return nearest && nearest.distanceKm <= MAX_AREA_CENTER_DISTANCE_KM ? nearest : null;
}

// Phí mô phỏng tính theo cự ly từ điểm xuất hàng; không gửi hay lưu tọa độ chính xác vào đơn.
export function calculateDeliveryQuote(branchId, latitude, longitude) {
  if (!validCoordinates(latitude, longitude)) return { available: false, reason: 'Tọa độ không hợp lệ.' };
  const origin = DELIVERY_BRANCH_CENTERS[Number(branchId)];
  if (!origin) return { available: false, reason: 'Chưa có điểm xuất hàng cho khu vực.' };
  const distanceKm = distanceBetweenCoordinatesKm(origin, { latitude, longitude });
  if (!Number.isFinite(distanceKm) || distanceKm > MAX_DELIVERY_DISTANCE_KM) {
    return { available: false, distanceKm, reason: 'Địa chỉ nằm ngoài phạm vi giao hàng đang hỗ trợ.' };
  }
  const bands = [
    { maxKm: 3, fee: 15000, eta: '1–2 giờ' },
    { maxKm: 6, fee: 18000, eta: '2–4 giờ' },
    { maxKm: 10, fee: 22000, eta: '2–4 giờ' },
    { maxKm: 15, fee: 28000, eta: '3–6 giờ' },
    { maxKm: 20, fee: 35000, eta: 'Trong ngày' },
  ];
  const band = bands.find((item) => distanceKm <= item.maxKm);
  return { available: true, distanceKm, shippingFee: band.fee, eta: band.eta };
}
