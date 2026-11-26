# EMSystems — triển khai và phát hành

## Trạng thái hiện tại

Ứng dụng có ba tiến trình logic:
- Frontend React/Vite: build ra thư mục `dist/`.
- Business API: `server/app-api-server.mjs`, mặc định chỉ bind `127.0.0.1:5176`, dùng SQLite ở `.emsystems-data/emsystems.sqlite` (đường dẫn có thể đổi bằng `EMSYSTEMS_DB_PATH`).
- Payment sandbox API: `payment-sandbox-server.mjs`, mặc định `127.0.0.1:5175`, chỉ là sandbox.

Trong bản mới, React gọi nghiệp vụ qua `/api/app/*`; cookie phiên được đặt ở máy chủ với `HttpOnly`, các cập nhật dữ liệu và đặt đơn đi trong transaction SQLite. Bộ lưu trữ domain hiện ghi snapshot JSON vào SQLite key/value; đây là một ranh giới máy chủ hữu ích cho bản demo/triển khai nhỏ, chưa phải schema quan hệ được chuẩn hóa cho khối lượng giao dịch lớn.

**Không tuyên bố sẵn sàng nhận tiền thật.** Tạo mã QR/URL thanh toán, kiểm tra chữ ký và các bài test không thay thế merchant sandbox hoạt động, IPN HTTPS từ nhà cung cấp và E2E giao dịch. Cấu hình MoMo/VNPAY hiện phải được hoàn tất bằng thông tin do merchant cấp.

## 1. Sao lưu trước khi nâng cấp

1. Nếu bản cũ còn lưu nghiệp vụ trong `localStorage`, mở bản cũ trước khi đổi frontend và xuất bản sao lưu EMSystems JSON từ trang Quản trị hệ thống.
2. Giữ file backup ở vị trí riêng tư; file chứa dữ liệu cá nhân, lịch sử giao dịch và có thể chứa password verifier/salt. Không commit vào Git, không gửi qua chat công khai hoặc upload vào website chia sẻ.
3. Sau khi chạy phiên bản server-backed, đăng nhập tài khoản admin, vào `/admin/system`, dùng chức năng kiểm tra/khôi phục JSON nếu cần nhập snapshot cũ.
4. Bản nâng cấp không âm thầm đọc/import localStorage cũ. Điều này tránh tự động tin dữ liệu dễ sửa từ browser. Khôi phục sẽ thay dữ liệu server hiện tại và thu hồi các phiên đăng nhập.
5. Trước khôi phục, xuất backup của trạng thái server hiện tại. Kiểm thử quá trình phục hồi với bản sao riêng.

## 2. Local development

Yêu cầu Node.js đủ mới để hỗ trợ built-in `node:sqlite` (khuyến nghị Node 22.13+ hoặc Node 24 LTS phù hợp môi trường triển khai).

```powershell
cd C:\Users\Admin\Desktop\EMSystem
npm install
Copy-Item .env.example .env
npm run dev
```

Ứng dụng:
- Frontend: `http://127.0.0.1:5173`
- Business API qua Vite proxy: `/api/app/*` → `127.0.0.1:5176`
- Payment API qua Vite proxy: `/api/payments/*` → `127.0.0.1:5175`

Các lệnh xác minh:

```powershell
npm test
npm run build
npm audit
Invoke-RestMethod http://127.0.0.1:5173/api/app/healthz
Invoke-RestMethod http://127.0.0.1:5175/api/payments/health
```

Không chạy `npm run dev:web` một mình nếu API chưa được khởi động.

## 3. HTTPS/domain — Caddy trên Linux

Tên miền phải được đăng ký và bản ghi DNS A/AAAA trỏ đến máy chủ trước. Hãy mở inbound TCP 80/443 cho Caddy; không expose các cổng Node 5175/5176 công khai. Caddy có thể tự xin và gia hạn chứng chỉ khi DNS/network đủ điều kiện.

1. Build frontend bằng `npm ci && npm run build`.
2. Phân phối nội dung `dist/` vào `/var/www/emsystems/dist`, chỉ cho web user quyền đọc.
3. Copy `deploy/Caddyfile.example` vào cấu hình Caddy, đặt biến `EMSYS_DOMAIN` bằng domain thật và reload Caddy.
4. Chạy hai API bằng systemd/Process Supervisor với user hệ điều hành riêng, không chạy bằng root. Ví dụ service phải:
   - WorkingDirectory trỏ về thư mục dự án phát hành.
   - EnvironmentFile trỏ đến file cấu hình bí mật chỉ owner/service user đọc được.
   - `NODE_ENV=production`, `APP_API_PORT=5176`, `PUBLIC_APP_ORIGIN=https://<domain>`, `APP_ALLOWED_ORIGINS=https://<domain>`, `PAYMENT_FRONTEND_URL=https://<domain>`, `PAYMENT_PUBLIC_BASE_URL=https://<domain>`.
   - `EMSYSTEMS_DB_PATH=/var/lib/emsystems/emsystems.sqlite`; thư mục dữ liệu thuộc riêng service user và nằm ngoài web root.
   - Cookie production sẽ tự dùng `Secure` và tên `__Host-ems_session` khi `NODE_ENV=production`.
5. Khi cấu hình VNPAY, `VNPAY_RETURN_URL` phải khớp URL đăng ký với merchant. Đăng ký IPN công khai `https://<domain>/api/payments/vnpay/ipn`; chỉ đặt `VNPAY_IPN_CONFIGURED=true` sau khi đã kiểm tra URL trong portal. MoMo cũng cần IPN HTTPS công khai.
6. Cấu hình CSP/HTTPS headers đúng theo domain. Test callback qua đúng reverse proxy, không giả định local HTTP/return redirect là xác thực thanh toán.

Không dùng domain mẫu hoặc placeholder làm production URL.

## 4. Bí mật thanh toán

- Chỉ dùng thông tin merchant sandbox trong lúc kiểm thử.
- Giữ `.env` ngoài Git (đã có trong `.gitignore`); hạn chế quyền đọc, không in giá trị secret vào log.
- `PAYMENT_SERVICE_TOKEN` phải là chuỗi ngẫu nhiên riêng tối thiểu 32 ký tự, được giữ giống nhau giữa hai tiến trình Node trong `.env`; token này chỉ dùng nội bộ và tuyệt đối không đặt thành biến `VITE_*`. Payment service chỉ chấp nhận `APP_API_INTERNAL_URL` trỏ tới loopback để không gửi token tới host bên ngoài.
- Business API kiểm tra mã đơn, phương thức đã chọn, trạng thái chờ và tổng tiền trong snapshot SQLite trước khi payment service gọi MoMo/VNPAY. Nếu kiểm tra này lỗi, tạo giao dịch bị từ chối.
- API config chỉ trả danh sách tên biến còn thiếu; không bao giờ trả khóa ra frontend.
- Không bật thanh toán production cho đến khi có giao dịch E2E thành công, chữ ký/IPN đúng, chống xử lý lặp, kiểm tra số tiền, đối soát và quy trình hoàn tiền đã được nghiệm thu.
- Nếu Merchant Hosted QR chưa được bật cho merchant VNPAY, QR fallback chỉ mở URL thanh toán đã ký; không quảng bá nó là QR chuyển khoản VietQR.

## 5. Dữ liệu khách hàng, phiên và backup

- SQLite hiện lưu tập trung nhưng file DB không tự mã hóa. Lưu file ngoài web root, đặt quyền NTFS/Unix ACL tối thiểu, bật mã hóa ổ đĩa/volume của máy chủ và backup sang kho lưu riêng có quyền hạn hạn chế.
- Export JSON thủ công là file rõ (plaintext). Trước khi chuyển file qua thiết bị khác, dùng kho lưu được mã hóa và xác thực; giữ lịch backup luân phiên, thử khôi phục định kỳ và xác định RPO/RTO.
- `npm run backup:data` tạo snapshot SQLite nhất quán (bao gồm các transaction đã commit/WAL), sao lưu `payments.json` nếu tồn tại, ghi manifest SHA-256/kích thước và tự dọn bản cũ theo `EMSYSTEMS_BACKUP_RETENTION` (mặc định 14). Mặc định lưu dưới `.emsystems-backups/`, đã ignore trong Git; đây là backup cục bộ, chưa mã hóa và chưa phải bản sao ngoài máy.
- Khôi phục bằng `npm run restore:data -- ".emsystems-backups/<tên-bản-backup>" --confirm`. Phải dừng business API và payment service; script kiểm tra manifest/checksum, SQLite integrity, các liên kết product/branch/sale/payment, thu hồi toàn bộ session/idempotency key, phục hồi cả `payments.json` tương ứng và giữ bản dữ liệu cũ để rollback. Nếu backup thiếu payment state nhưng máy hiện có `payments.json`, script từ chối thay đổi để tránh phục hồi dữ liệu lệch cặp.
- Lập lịch backup định kỳ, sao chép mã hóa sang kho riêng và thường xuyên diễn tập restore.
- Không lưu GPS chính xác nếu không cần; không gửi PII tới API catalog ngoài. Giữ dữ liệu mua hàng cần thiết, giới hạn quyền truy cập và định kỳ xóa/anonymize theo chính sách lưu trữ phù hợp.
- Dùng HTTPS toàn bộ, bảo đảm cookie `HttpOnly; Secure; SameSite=Lax`, xác thực/rate-limit ở server, CSRF/Origin protection và log giám sát.
- Rate limiter hiện tại là trong bộ nhớ tiến trình. Khi scale nhiều API instance, chuyển rate-limit và session revocation sang kho chia sẻ; dùng database/transaction strategy đã kiểm nghiệm cho multi-instance.
- Audit log nghiệp vụ hiện lưu trong cùng snapshot dữ liệu và chưa chống giả mạo trước quản trị viên máy chủ. Cần đẩy log bảo mật quan trọng đến hệ thống log bên ngoài có quyền ghi riêng trước vận hành lớn.

## 6. E2E và tiêu chí mở bán

Bộ kiểm thử hiện tại:
- `tests/server-api.test.mjs`: kiểm tra Origin, phiên HttpOnly, dữ liệu công khai, idempotency, khởi động lại API và 12 checkout đồng thời với cùng tồn; xác minh hủy đơn chỉ hoàn tồn một lần.
- `e2e/storefront.spec.mjs`: Browser E2E Chromium cho đăng nhập/quyền, catalog/giỏ, checkout COD, hủy đơn/hoàn tồn, từ chối thanh toán online khi thiếu credential, phân quyền API, mobile, lỗi mạng và performance timing.
- Axe-core quét trang đăng nhập và storefront theo WCAG 2.1 A/AA; test hiện yêu cầu không có violation.
- `tests/payment-ipn-integration.test.mjs`: kiểm tra chữ ký IPN MoMo/VNPAY bằng khóa giả lập, từ chối chữ ký/số tiền sai và xác nhận callback hợp lệ gửi lặp không xử lý hai lần. Đây là test logic/HTTP cục bộ, không thay cho IPN HTTPS đến từ cổng thanh toán thật.
- `tests/backup-restore.test.mjs`: tạo backup vật lý, khôi phục SQLite + `payments.json`, thu hồi session/idempotency, kiểm tra integrity và các liên kết product/branch/sale/payment.

Còn phải hoàn tất trước production:
- E2E giao dịch MoMo/VNPAY bằng merchant sandbox thật và callback/IPN HTTPS công khai từ nhà cung cấp. Môi trường hiện chưa có credential merchant hoặc domain callback public đã xác minh.
- Tích hợp refund API chính thức của từng cổng và đối soát hoàn tiền. Hủy/hoàn tồn kho nội bộ không đồng nghĩa cổng đã chuyển tiền hoàn cho khách.
- Kiểm thử tải/stress rộng hơn, kiểm tra keyboard/screen reader thủ công, browser console, refresh giữa checkout/callback, retry và timeout proxy production.
- Quy trình vận hành đơn thật, vận chuyển/shipper, chăm sóc khách hàng, chính sách đổi trả/hoàn tiền, thuế/hóa đơn, monitoring và security review độc lập.

## 7. Giới hạn cần nhớ

Đây vẫn là một bước nâng cấp kiến trúc, không phải chứng nhận bảo mật. Browser E2E và callback-signature integration cục bộ đã được thêm, nhưng chưa có merchant credentials, domain/DNS production hoặc bằng chứng IPN HTTPS thật từ MoMo/VNPAY trong môi trường kiểm tra. Những điểm này phải được nghiệm thu trên môi trường phát hành thực tế.
