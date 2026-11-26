# Việc còn lại của EMSystems

Bảng tiến độ/nghiệm thu duy nhất: [`tasks/plan.md`](./plan.md). Không tạo thêm tài liệu tiến độ song song.

## Còn lại trước khi nộp đồ án
- Click-through chi tiết các biểu mẫu CRUD quản trị còn lại: nhà cung cấp, nhân viên, bảo hành và đổi trả.
- Kiểm tra responsive sâu cho các biểu mẫu quản trị; vòng vừa rồi chỉ smoke-test storefront trên mobile.
- Kiểm thử thao tác import nhiều sản phẩm và import theo các nhóm `tablets`, `mobile-accessories` sau khi danh mục nội bộ được nâng schema v4.

## Cần có nếu triển khai thương mại thật
- Backend đáng tin cậy, database tập trung, OTP/xác thực và kiểm tra quyền phía máy chủ. Prefix `/admin` chỉ giúp phân tách luồng, không phải hàng rào bảo mật.
- Cước/ETA giao hàng thật, kiểm tra địa chỉ, tích hợp hãng vận chuyển/shipper và tracking thực.
- Cổng thanh toán thật và đối soát giao dịch chỉ khi có backend đáng tin cậy.
- Quy tắc bảo mật, backup, quyền truy cập và bảo vệ dữ liệu cá nhân trước khi nhận đơn thật.
