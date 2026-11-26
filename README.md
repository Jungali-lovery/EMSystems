# EMSystems

EMSystems là ứng dụng quản lý chuỗi cửa hàng điện tử dùng **React + Vite + JavaScript JSX + CSS thuần**. Frontend gửi nghiệp vụ qua Node.js API (`server/app-api-server.mjs`, cổng `5176`); dữ liệu nghiệp vụ, phiên đăng nhập và khóa chống đơn trùng được lưu phía máy chủ trong SQLite (`.emsystems-data/emsystems.sqlite` mặc định). Payment sandbox là service riêng ở cổng `5175`. Đây là nền tảng server-backed cho demo/kiểm thử, chưa phải chứng nhận sẵn sàng production.

Biểu tượng giao diện dùng **Bootstrap Icons** (`bootstrap-icons`), được đóng gói cùng ứng dụng. Khi thêm biểu tượng mới, dùng class dạng `bi bi-search` hoặc `bi bi-box-seam`; không thay bằng emoji hệ điều hành hoặc ký tự hình học.

## Chạy ứng dụng

Yêu cầu Node.js `>=22.13.0`.

```powershell
cd C:\Users\Admin\Desktop\EMSystem
npm install
npm run dev
```

Mở địa chỉ local mà Vite in ra trong terminal. Các lệnh kiểm tra:

`npm test` chạy test Node.js + Browser E2E Chromium. Cài browser một lần bằng `npx playwright install chromium` nếu máy chưa có.

| Lệnh | Tác dụng |
|---|---|
| `npm test` | Unit + Browser E2E bằng Playwright: role, catalog/giỏ, checkout, hủy đơn, phân quyền API, mobile, accessibility và lỗi mạng |
| `npm run test:unit` | Chạy unit/integration tests Node.js cho dữ liệu, API, thanh toán và backup |
| `npm run test:e2e` | Chạy browser E2E Chromium với database và payment state cô lập |
| `npx playwright install chromium` | Cài browser cần thiết sau khi clone repo |
| `npm run build` | Build bản frontend production |
| `npm run check:resources` | Kiểm tra tên tài nguyên UTF-8/NFC và xung đột hoa-thường trước build |
| `npm run preview` | Xem thử bản build production |
| `npm run backup:data` | Snapshot SQLite + payment state, mã hóa AES-256-GCM, manifest SHA-256 và retention backup |
| `npm run restore:data -- ".emsystems-backups/<tên-bản-backup>" --confirm` | Khôi phục SQLite + payment state; cần dừng API/payment service, script tự thu hồi session/idempotency và giữ bản trước restore để rollback |
| `npm run release` | Build và đóng gói release ZIP sạch; loại `.env`, DB, payment state, backup, node_modules và test output; tạo manifest SHA-256 |
| `npm run dev` | Chạy Vite, business API (`5176`) và payment sandbox (`5175`) |
| `npm run dev:web` | Chỉ chạy Vite frontend |
| `npm run dev:api` | Chỉ chạy business API và SQLite |

## Dữ liệu demo và SQLite phía máy chủ

- Dữ liệu mẫu ban đầu đặt tại `src/data/initialData.js`, có ID ổn định cho liên kết giữa sản phẩm, chi nhánh, khách hàng, đơn hàng và chi tiết nghiệp vụ.
- Khi business API nhận request nghiệp vụ đầu tiên, dữ liệu seed từ `src/data/initialData.js` được khởi tạo và lưu vào SQLite snapshot ở `.emsystems-data/emsystems.sqlite`. Dữ liệu không còn bị giới hạn trong profile trình duyệt. Cart và wishlist vẫn là tiện ích cục bộ trong `localStorage`, không phải nguồn sự thật của giá/tồn/đơn.
- Trước khi nâng cấp từ bản cũ chỉ dùng localStorage, mở bản cũ và xuất backup JSON từ Quản trị hệ thống. Sau đó chạy API mới, đăng nhập admin và dùng trang `/admin/system` để kiểm tra/khôi phục backup nếu cần. Không import tự động dữ liệu client cũ vì có thể đã bị sửa.
- Nút **Khôi phục dữ liệu mẫu** yêu cầu xác nhận và đặt lại dữ liệu demo phía máy chủ; các phiên đăng nhập sẽ bị thu hồi.
- SQLite tồn tại độc lập với trình duyệt và được giữ qua restart API. File DB không tự mã hóa và không thay thế backup ngoài máy; cần cất backup ở kho riêng tư. Trong scale nhiều instance, cần rà soát cơ chế transaction, rate limit và vận hành trước khi triển khai.

## MoMo và VNPAY Sandbox

- Trang thanh toán riêng là `/checkout`, gồm các phương thức `COD`, `MoMo Sandbox` và `VNPAY QR Sandbox`. Trang chủ chỉ có tóm tắt giỏ hàng khi có sản phẩm; nút Giỏ hàng trên header, nút Mua ngay và nút Tiến hành thanh toán dẫn tới `/checkout`. VNPAY gọi API `vnp_Command=genqr` ở server để xin `qrcontent` từ Merchant Hosted QR; khi VNPAY trả `code=00`, giao diện render nội dung QR đó. Nếu tính năng Merchant Hosted QR chưa được bật cho merchant, hệ thống tạo QR dự phòng chứa URL VNPAY đã ký để khách mở trang checkout của VNPAY. Giao dịch chỉ được xác nhận sau khi callback/IPN hợp lệ.
- Sao chép `.env.example` thành `.env`, rồi điền **thông tin merchant sandbox** do MoMo/VNPAY cấp. VNPAY cấp `TMN Code` và `Hash Secret` riêng khi đăng ký merchant tại [VNPAY Sandbox](https://sandbox.vnpayment.vn/devreg/). API `genqr`/Merchant Hosted QR có thể cần bật quyền riêng cho merchant; nếu API không trả `code=00`, giao diện dùng QR URL dự phòng và hiển thị cảnh báo. Cần yêu cầu VNPAY cấp/tài liệu hóa tính năng Merchant Hosted QR để có QR payload gốc. Không dùng thông tin production và không commit `.env` lên Git.
- `PAYMENT_PUBLIC_BASE_URL` phải là URL **HTTPS công khai** chuyển tiếp tới `127.0.0.1:5175` để cổng gọi ngược về máy dev. Việc tạo URL VNPAY chỉ cần `VNPAY_TMN_CODE` và `VNPAY_HASH_SECRET`; callback HTTPS/IPN được kiểm tra riêng, nên thiếu IPN không chặn sinh URL nhưng giao dịch sẽ vẫn chờ xác nhận. Đối với VNPAY, khai báo IPN tại `https://<domain-cong-khai>/api/payments/vnpay/ipn`, kiểm tra đã lưu chính xác ở portal merchant rồi mới đặt `VNPAY_IPN_CONFIGURED=true`. Với MoMo, URL IPN được gửi trong yêu cầu tạo giao dịch; để có thể nhận IPN phải dùng endpoint công khai.
- Chạy `npm run dev` để mở frontend tại `http://127.0.0.1:5173` và payment sandbox service tại `http://127.0.0.1:5175`. API cấu hình `/api/payments/config` tách `canCreate` (đủ khóa để tạo yêu cầu/URL) khỏi `ready` (đủ callback/IPN để xác nhận thanh toán); chỉ trả tên biến còn thiếu, không trả giá trị khóa bí mật.
- Server xác minh chữ ký HMAC của callback/IPN, mã merchant, mã giao dịch và số tiền trước khi đồng bộ kết quả vào đơn. Trang Return không tự xác nhận giao dịch chỉ dựa trên redirect từ trình duyệt.
- Payment service xác minh mã đơn, phương thức, trạng thái và số tiền với business API/SQLite bằng token nội bộ ngẫu nhiên (`PAYMENT_SERVICE_TOKEN`, tối thiểu 32 ký tự). Token chỉ nằm trong `.env`, không đặt `VITE_*`; `APP_API_INTERNAL_URL` phải là loopback. Thiếu token thì không tạo giao dịch.
- Payment status nhận credential qua header `X-Payment-Token`. URL Return mang `paymentId` trong query và `paymentToken` trong URL fragment (`#...`); fragment không được gửi lên HTTP server/access log, đồng thời cho phép tab mới trên iOS/Android xác minh mà không phụ thuộc `sessionStorage`. Token cũng được giữ trong `sessionStorage` để phục vụ luồng cùng tab.
- Đơn web dùng MoMo/VNPAY/VietQR giữ tồn trong 15 phút. Business API chạy sweep mỗi phút để hết hạn đơn, hoàn tồn/điểm/lượt mã ưu đãi idempotent; Admin/Quản lý có thể hủy đơn đang chờ. IPN MoMo/VNPAY được payment service đẩy server-to-server vào SQLite; retry đồng bộ chạy mỗi 30 giây nếu Business API tạm thời lỗi. Giao dịch báo thành công sau khi đơn đã hủy/hết hạn chuyển sang `paid_after_cancellation` để đối soát/hoàn tiền thủ công, không khôi phục đơn tự động.
- API catalog công khai chỉ trả cờ khả dụng theo chi nhánh (`availableStock`, `inStockByBranch` dạng boolean), không tiết lộ số lượng thực. Số lượng chính xác chỉ trả từ API nhân viên có xác thực. Bốn GET công khai catalog/chi nhánh/khu vực giao/khuyến mãi dùng kết nối SQLite WAL chỉ đọc riêng, không chiếm transaction ghi hoặc gọi `persistContext`.
- Route hoàn tất thanh toán mô phỏng `/payments/mock/*/complete` mặc định trả `404`. Chỉ bật bằng `EMSYSTEMS_ALLOW_MOCK_PAYMENT=true` trong môi trường phát triển/kiểm thử; `NODE_ENV=production` luôn khóa route bất kể cờ này.
- API chỉ tin `X-Forwarded-For` khi socket peer là loopback; IP client lấy từ hop IP hợp lệ cuối cùng. Login có rate limit riêng theo IP và username. Caddy cần là reverse proxy duy nhất được phép truy cập business API qua loopback.
- Khôi phục mật khẩu: `/forgot-password` gửi yêu cầu qua Resend khi `RESEND_API_KEY`, `EMSYSTEMS_EMAIL_FROM` và `EMSYSTEMS_PUBLIC_URL` được cấu hình. Token ngẫu nhiên chỉ lưu hash trong bảng SQLite `password_reset_tokens`, hết hạn sau 30 phút, dùng một lần; đặt lại mật khẩu tăng `credentialVersion` và thu hồi toàn bộ phiên. Response không tiết lộ email có tồn tại hay không. Email sender domain phải được xác minh trước khi bật.
- OTP số điện thoại: Twilio Verify dùng `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID`. Khi đặt `EMSYSTEMS_REQUIRE_PHONE_VERIFICATION=true`, đăng ký và checkout yêu cầu OTP đã duyệt, gắn với session cookie HttpOnly, số E.164 và thời hạn tối đa 10 phút. Nếu Twilio chưa cấu hình/gửi lỗi thì luồng bị chặn, không fallback sang OTP giả. Dev mặc định tắt gate này.
- Đồng ý xử lý dữ liệu: `EMSYSTEMS_REQUIRE_DATA_CONSENT=true` bắt buộc xác nhận tại đăng ký/checkout; lựa chọn tiếp thị, dùng GPS và nhận Email/SMS/ZNS được lưu riêng. Nếu khách không đồng ý GPS, vẫn có thể tự chọn khu vực giao. Consent được ghi trong collection `dataConsents` với phiên bản và thời điểm; nội dung chính sách hiện là dự thảo cần người bán rà soát pháp lý.
- Thông báo giao dịch: outbox `notificationOutbox` enqueue theo sự kiện nhận đơn, thanh toán đã xác minh, bắt đầu giao và giao thành công; có dedupe, claim-lock, retry exponential và tối đa 5 lần. Kênh chỉ enqueue khi khách chủ động chọn và provider tương ứng đã được cấu hình. Email dùng Resend; SMS/OTP dùng Twilio; Zalo ZNS dùng OA access token + template đã duyệt (`ZALO_ZNS_TEMPLATE_ID_ORDER`). Mapping biến ZNS mẫu hiện gồm `customerName`, `orderCode`, `amountText`, `statusText`; cần khớp template thực tế và gửi thử trước khi mở. Khi có `ZALO_ZNS_APP_ID`, `ZALO_ZNS_APP_SECRET`, `ZALO_ZNS_REFRESH_TOKEN`, server tự refresh OA token qua OAuth khi sắp hết hạn, khóa refresh đồng thời và lưu cặp token đã xoay trong file riêng quyền hạn chế (`EMSYSTEMS_ZALO_TOKEN_STATE_FILE`). Access token OA có vòng đời khoảng 25 giờ và refresh token khoảng 3 tháng; refresh token mới phải được lưu trước khi tiếp tục dùng. Chưa có trang quản lý tùy chọn thông báo sau checkout hoặc chiến dịch tiếp thị.
- Giám sát: `EMSYSTEMS_ALERT_WEBHOOK_URL` (HTTPS) nhận cảnh báo 5xx tối giản có cooldown 5 phút, không kèm request body/PII. Đây là webhook alert, không phải Sentry/APM/tracing hoặc uptime monitor. Hãy cấu hình uptime probe độc lập tới `/api/app/healthz` và `/api/payments/health`.
- Backup ngoài máy: `npm run backup:cloud` tạo backup AES-256-GCM local rồi upload chỉ `.enc` + `manifest.json` qua S3 SigV4 tới Cloudflare R2 hoặc Amazon S3. Các biến cấu hình là `EMSYSTEMS_S3_ENDPOINT`, `EMSYSTEMS_S3_BUCKET`, `EMSYSTEMS_S3_REGION`, `EMSYSTEMS_S3_ACCESS_KEY_ID`, `EMSYSTEMS_S3_SECRET_ACCESS_KEY`, `EMSYSTEMS_S3_PREFIX`. `deploy/emsystems-backup-cloud.timer` chạy hằng ngày lúc 03:15 khi được cài trên Linux. Cần bucket lifecycle/versioning, quyền hạn chế và diễn tập download/restore; script hiện chưa tự tải hoặc xóa object cloud cũ.
- Hóa đơn điện tử: `EMSYSTEMS_EINVOICE_PROVIDER=none` và API luôn báo `configured=false`; phiếu/HTML hiện có không phải hóa đơn điện tử hợp pháp. Chưa tích hợp MISA/VNPT/Viettel vì cần xác định pháp nhân/mã số thuế, loại người bán, nghĩa vụ/điều kiện áp dụng, hợp đồng, tài khoản API sandbox/production và quy trình ký/phát hành/điều chỉnh hóa đơn.
- Tên hai ảnh giao diện là `emsystems-logo.webp` và `emsystems-tech-background.webp` (ASCII); ảnh được resize còn 512×512 và 1440×810, mã hóa WebP để giảm dung lượng. `npm run build` tự chạy kiểm tra tên tài nguyên trong `src/` và `public/` trước khi bundle.
- Backup lưu trữ bằng AES-256-GCM; đặt `EMSYSTEMS_BACKUP_ENCRYPTION_KEY` thành 64 ký tự hex (32 byte), tạo bằng `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. Giữ khóa ngoài thư mục backup và lưu recovery copy trong secret manager. Backup JSON tải từ Admin được mã hóa AES-256-GCM bằng mật khẩu riêng (PBKDF2-SHA256 310.000 vòng); quên mật khẩu thì không thể giải mã. Restore cần đúng khóa trong `.env`.
- Không còn mật khẩu demo/verifier hardcode trong source. Trên database mới hoặc tài khoản seed chưa có credential, đặt `EMSYSTEMS_BOOTSTRAP_ADMIN_PASSWORD` (12–200 ký tự) để cấp mật khẩu riêng cho admin; sau khi áp dụng, xóa biến này khỏi `.env`. Tài khoản đã có `passwordCredential` không bị ghi đè. Các tài khoản seed khác chưa có credential cần được cấp mật khẩu an toàn trước khi đăng nhập.
- Yêu cầu Node.js tối thiểu là `22.13.0`. Backend đang dùng SQLite; các module Express/MySQL và schema MySQL legacy đã được loại bỏ khỏi source.
- **Giới hạn quan trọng:** đây vẫn là tích hợp sandbox/dev, chưa phải cổng thanh toán production. Nghiệp vụ được xử lý ở business API với SQLite, transaction và idempotency key; merchant credentials/callback HTTPS cần được cấu hình và xác minh ở môi trường đích. Chưa có luồng hoàn tiền tự động cho khoản thanh toán đến muộn sau khi đơn hủy; trạng thái này phải được nhân viên đối soát thủ công. Trước vận hành thật cần giao dịch E2E với merchant sandbox, diễn tập restore, đối soát/hoàn tiền và security review.

## Cửa hàng và khu vực quản trị

- Cửa hàng khách mua sắm: `/`. Người dùng xem sản phẩm, ảnh, tìm/lọc catalog và khuyến mãi. Biểu mẫu giỏ hàng/thông tin giao nhận/phương thức thanh toán nằm trên trang riêng `/checkout`; trang chủ chỉ có tóm tắt giỏ hàng khi có sản phẩm, không lặp lại biểu mẫu checkout.
- Cổng đăng nhập duy nhất: `/login`, giao diện chỉ có biểu mẫu **Đăng nhập** (tài khoản + mật khẩu). Hệ thống tự nhận diện tài khoản theo username, email hoặc số điện thoại của tài khoản khách; vai trò lấy từ hồ sơ đã xác thực, người dùng không chọn vai trò ở màn hình login.
- Sau đăng nhập: `admin` vào `/admin`; các tài khoản nhân viên (`manager`, `sales`, `warehouse`, `employee`) vào `/ctv` và chỉ thấy các phân hệ được ma trận quyền cho phép; tài khoản cấp `ctv` cũng vào `/ctv` nhưng chỉ có dashboard và catalog sản phẩm ở chế độ đọc (không xem giá vốn/nhà cung cấp, không vào POS hoặc danh bạ nhân viên); tài khoản `customer` trở về cửa hàng `/`. Tạo tài khoản khách tại `/register`, cần mật khẩu; hồ sơ thành viên được liên kết với tài khoản khách. Danh bạ `/admin/users` chỉ liệt kê tài khoản nội bộ, không đưa khách hàng vào danh sách nhân viên.
- `/admin` chỉ dành cho role `admin`; `/ctv` chỉ dành cho các vai trò nội bộ được cấp quyền. Route guard React điều khiển trải nghiệm; business API cũng kiểm tra phiên và quyền theo endpoint. Trang 404 vẫn là route SPA, không nhất thiết là HTTP 404. Không coi việc ẩn route là bảo mật duy nhất; reverse proxy/API vẫn cần bảo vệ đúng khi deploy.
- Tra cứu đơn: `/track-order`. Bản server-backed tìm đơn từ SQLite bằng mã đơn và số điện thoại; khi phát hành cần kiểm soát chống dò mã, giới hạn tốc độ và chính sách quyền riêng tư.
- Màn hình quản trị vận hành: `/admin/system` (admin-only). Tại đây có chẩn đoán SQLite/server API, xuất file `.emsbackup` được mã hóa, kiểm tra file trước khi khôi phục và tìm nhật ký thao tác gần nhất.
- Quyền điều hướng được khai báo tập trung tại `src/access-control.js`. `RoleGate` dùng cùng chính sách cho sidebar và URL trực tiếp; các handler trong `src/api.js` vẫn kiểm tra những quyền nghiệp vụ quan trọng riêng.
- Backup dùng định dạng `emsystems-data-backup` phiên bản 1. Trước khi khôi phục, hệ thống kiểm tra schema, bảng bắt buộc, ID trùng, SKU, dòng tồn kho và các liên kết cơ bản giữa tồn kho/đơn hàng/sản phẩm/chi nhánh. Khôi phục yêu cầu xác nhận rõ ràng, ghi lại sự kiện và kết thúc các phiên đăng nhập đang có. Nên xuất backup hiện tại trước khi khôi phục.
- File backup xuất từ Admin dùng AES-256-GCM với mật khẩu riêng (PBKDF2-SHA256, 310.000 vòng); cần mật khẩu để giải mã và restore. File backup máy chủ dùng khóa `EMSYSTEMS_BACKUP_ENCRYPTION_KEY` 32 byte; thiếu khóa thì lệnh backup/restore từ chối chạy, không fallback sang plaintext.
- Backup máy chủ dùng `npm run backup:data`, mặc định ở `.emsystems-backups/` với retention 14 bản. Trên Linux có template systemd timer `deploy/emsystems-backup-cloud.timer` để tạo backup mã hóa và tải lên S3/R2 mỗi ngày; trên Windows cần Task Scheduler chạy `npm run backup:cloud`. Cloud upload và restore phải được cấu hình/diễn tập trên bucket thật; không coi cấu hình mẫu là đã có bản sao ngoài máy.
- API thành viên legacy đăng nhập/đăng ký chỉ bằng số điện thoại đã bị vô hiệu hóa (`410`); hãy dùng tài khoản EMSystems có mật khẩu. Phiếu trả hàng đang ghi hoàn tiền mô phỏng (`refund-demo`), chưa gọi API hoàn tiền MoMo/VNPAY và không đồng nghĩa cổng đã chuyển tiền trả khách.
- Phiên nhân viên dùng session ID opaque trong cookie `HttpOnly; SameSite=Lax`, được lưu phía máy chủ, xoay sau login và bị thu hồi sau logout/reset/restore. API từ chối mutation thiếu Origin hoặc Origin không allowlist, giới hạn body và rate-limit login/đặt hàng. Đây là các lớp bảo vệ mới, không phải chứng nhận bảo mật; audit log vẫn nằm cùng kho dữ liệu, và phải thực hiện security review trước khi lưu thông tin thật.

## Ma trận vai trò demo

| Phân hệ | Admin | Quản lý | Bán hàng | Kho | Nhân viên | CTV |
|---|---:|---:|---:|---:|---:|---:|
| Tổng quan | Có | Có | Có | Có | Có | Có |
| Sản phẩm | Có | Có | — | Xem/tra cứu | — | Chỉ xem |
| Danh mục | Có | Có | — | — | — | — |
| Kho / kiểm kê / nhập hàng | Có | Có | — | Có | — | — |
| Đơn hàng POS | Có | Có | Có | Theo dõi đơn giao | Có | — |
| Khách hàng | Có | Có | Có | — | — | — |
| Bảo hành | Có | Có | Tiếp nhận/xem | Xem | — | — |
| Báo cáo | Có | Có | — | — | — | — |
| Chi nhánh / nhân viên / quản trị hệ thống | Có | — | — | — | — | — |

Đây là chính sách hiển thị/điều hướng của bản demo, không thay thế kiểm soát truy cập phía máy chủ.

## Tài khoản vai trò mẫu

Trang `/login` dùng chung cho các vai trò demo; biểu mẫu chỉ ghi **Đăng nhập**, nhận username/email/số điện thoại và mật khẩu. Hệ thống tự phân luồng theo role sau xác thực; người dùng không chọn vai trò trên form. Admin tạo tài khoản nhân viên/CTV bằng mật khẩu tạm 12–200 ký tự; tài khoản mới buộc đổi mật khẩu ở `/change-password`. Đặt lại mật khẩu nhân viên tăng `credentialVersion` để thu hồi phiên cũ; thao tác quản trị tài khoản được ghi nhật ký. Khách hàng tạo tài khoản có mật khẩu tại `/register`. Không công bố thông tin đăng nhập demo trong giao diện cửa hàng hoặc tài liệu phát hành công khai.

Xác thực hiện được thực hiện qua business API, không nhận role từ giao diện. Cookie phiên là HttpOnly và trạng thái phiên được giữ trong SQLite. Không tái sử dụng mật khẩu demo, bật HTTPS và Secure cookie khi deploy; thực hiện review quyền endpoint, chính sách mật khẩu, phục hồi tài khoản và audit log trước khi phát hành.

## Cửa hàng điện tử và DummyJSON

- Trang chủ công khai là route `/`. Khách xem sản phẩm/ảnh API, tìm kiếm/lọc danh mục, xem ưu đãi, thêm sản phẩm vào giỏ và đặt giao hàng trước khi đăng nhập.
- `src/services/dummyjson.js` gọi 4 endpoint công khai `https://dummyjson.com/products/category/{smartphones|laptops|tablets|mobile-accessories}` và đọc `thumbnail`, `images`, `brand`, `category`, `rating` cùng metadata sản phẩm. Kết quả kiểm thử trình duyệt đã nhận HTTP 200 cho cả 4 nhóm và tải được ảnh.
- Dữ liệu bên ngoài chỉ dùng cho ảnh/tên/mô tả và thông tin tham khảo. **Giá bán VNĐ, SKU nội bộ và tồn kho theo chi nhánh do EMSystems lưu ở SQLite phía máy chủ.** Giá USD và stock từ DummyJSON không được dùng để tính đơn hay trừ kho; review mẫu từ API ngoài không được hiển thị như review đã xác minh của khách EMSystems.
- Nhân viên có quyền quản lý có thể mở `/admin/products`, chuyển qua tab DummyJSON và chọn **Nhập bản nháp**. Hệ thống bỏ qua trùng `dummyJsonId`, tạo mã nội bộ `EXT-DJ-{id}`; bản nhập mặc định `sellingPrice=0`, `isActive=false`, tồn kho 0 ở các chi nhánh. Phải cấu hình giá VNĐ, nhập hàng và bật bán rồi mới xuất hiện ở cửa hàng.
- Catalog công khai được cache trong bộ nhớ JavaScript để tránh gọi lại cả 4 endpoint sau mỗi lần checkout. Khi API không truy cập được, cửa hàng dùng thumbnail dự phòng lưu trong seed và hiển thị tình trạng kết nối.
- Giỏ hàng được lưu trong `localStorage` bằng khóa `emsystems.store.cart.v1`. Checkout không bắt buộc đăng nhập, nhưng bắt buộc họ tên người nhận, số điện thoại Việt Nam hợp lệ, khu vực giao hàng, phường/xã, địa chỉ cụ thể; email và ghi chú giao hàng không bắt buộc.
- Khu vực giao hàng demo có phí vận chuyển và ETA mẫu cho một số quận/huyện tại Đà Nẵng và Hà Nội. Khách tự chọn khu vực hoặc chủ động đồng ý rồi dùng định vị GPS để ước tính cự ly/phí; vẫn chưa có bản đồ tuyến đường, dữ liệu shipper thật hoặc đồng bộ hãng vận chuyển. Phí/ETA chỉ để minh họa và cần được cửa hàng xác nhận trước khi kinh doanh thật.
- Checkout hỗ trợ COD demo và MoMo/VNPAY sandbox. Đặt hàng sinh mã `WEB-xxxxx`, giữ tồn kho theo chi nhánh phụ trách khu vực và lưu thông tin giao hàng. Khách có thể tra cứu tại `/track-order` bằng mã đơn và số điện thoại. Với đơn online, cửa hàng chỉ được xử lý giao hàng sau khi sandbox đã xác nhận thanh toán.
- Thẻ EM Club gắn với tài khoản khách có mật khẩu đăng nhập ở `/login` và đăng ký ở `/register`. Endpoint đăng nhập/đăng ký chỉ bằng số điện thoại cũ đã bị khóa (HTTP 410) vì có thể cho phép chiếm đoạt thẻ. OTP Twilio Verify được hỗ trợ và có thể bắt buộc bằng `EMSYSTEMS_REQUIRE_PHONE_VERIFICATION=true`; chỉ tuyên bố đã xác minh khi provider đã cấu hình và giao dịch OTP thành công.
- Quy tắc điểm mẫu: mỗi 10.000đ chi tiêu hợp lệ được 1 điểm sau khi trạng thái đơn thành **Đã giao thành công**; 100 điểm có thể giảm 10.000đ ở checkout demo. Điểm chưa được cộng khi đơn còn chờ, đang giao hoặc bị hủy. Đơn thành viên hủy sẽ hoàn lại điểm đã sử dụng; đơn khách vãng lai không được tích điểm.
- Ưu đãi mẫu: `THANHVIEN5` (mã dành cho thành viên, có ngưỡng đơn tối thiểu) và `TECH50` (giảm tiền cho đơn đạt ngưỡng). Backend tính lại mã, điểm, giá và tồn bên trong transaction SQLite; vẫn cần rà soát kỹ nghiệp vụ và đối soát trước khi dùng cho tiền thật.
- Nhân viên demo quản lý đơn online ở `/admin/delivery-orders` với các bước chờ xác nhận → xác nhận → chuẩn bị hàng → bàn giao shipper → đã giao. Hủy đơn hoàn lại tồn, điểm đã dùng và lượt sử dụng khuyến mãi một lần. Trường điện thoại có liên kết gọi trên thiết bị hỗ trợ, nhưng ứng dụng không tự gọi shipper.
- Khách vãng lai vẫn đặt được đơn. Checkout và màn hình xác nhận hiển thị rõ rằng đơn không đăng nhập thẻ thành viên sẽ không được tích điểm.

## Nghiệp vụ mô phỏng

- Sản phẩm, danh mục, thương hiệu, nhà cung cấp, chi nhánh, hồ sơ vai trò, khách hàng, đơn hàng, tồn và nghiệp vụ được lưu qua business API trong SQLite; giỏ hàng/wishlist phía client chỉ phục vụ trải nghiệm.
- Nhập/xuất kho ghi nhật ký biến động. Phiếu điều chuyển đi qua trạng thái nháp → xuất nguồn → nhận đích; không trừ/cộng kho hai lần khi lặp thao tác.
- Đơn tiền mặt là giao dịch demo nội bộ. Giá bán được lấy từ dữ liệu sản phẩm; số lượng kiểm tra trước khi thay đổi tồn. Đổi trả có giới hạn theo số lượng còn lại, khôi phục hàng và ghi khoản hoàn tiền giả lập.
- Giao dịch POS/chuyển khoản thủ công và thanh toán sandbox không thu tiền thật. Đơn web online giữ tồn tạm thời trong TTL 15 phút; đơn hết hạn/hủy/thanh toán thất bại hoàn tồn, điểm và lượt mã ưu đãi một lần. VietQR cần đối soát tài khoản ngân hàng thủ công.
- Dashboard và báo cáo đọc dữ liệu demo, ước tính doanh thu thuần/giá vốn/lợi nhuận. Kết quả không thay thế sổ sách kế toán.
- Khôi phục mật khẩu qua email đã có backend token hash một lần/30 phút, nhưng chỉ gửi email thật khi Resend đã cấu hình và xác minh sender domain. CAPTCHA/anti-bot challenge chưa được tích hợp; rate-limit không thay thế CAPTCHA.

## Deploy Linux và thư mục legacy

Backend nghiệp vụ hiện chạy ở `server/app-api-server.mjs`, còn `server/payment-gateway-utils.mjs` được payment sandbox dùng để kiểm tra chữ ký. Các module MySQL/JSON backend legacy và thư mục `database/` đã bị loại khỏi source. Trong môi trường dev, Vite proxy `/api/app/*` tới cổng `5176` và `/api/payments/*` tới cổng `5175`.

Tham khảo [`deploy/README.md`](./deploy/README.md) để cài systemd, backup timer, env secrets, Caddy, journald và kiểm tra sau triển khai. Các file `deploy/*.service`/`*.timer` là template; chúng chưa được cài hoặc xác minh trên VPS. Caddy `request_body` trong ví dụ yêu cầu v2.10.0+ (directive đang ở trạng thái experimental). Các GET catalog công khai đã tách khỏi writer transaction, nhưng kho nghiệp vụ vẫn còn lưu trong một JSON snapshot lớn ở `app_kv`; việc tách riêng 25 thực thể thành các bảng quan hệ có index, retention và migration dữ liệu vẫn là hạng mục kiến trúc bắt buộc trước khi mở rộng tải.

## Pháp lý và phát hành công khai

Các trang `/legal/operating`, `/legal/privacy`, `/legal/returns`, `/legal/shipping` là nội dung dự thảo hiển thị công khai. Footer lấy thông tin từ `EMSYSTEMS_LEGAL_*`, `EMSYSTEMS_ECOMMERCE_NOTICE_ID` và `EMSYSTEMS_ECOMMERCE_BADGE_URL`; không có giá trị thật thì UI hiển thị “Chưa khai báo”, không tự tạo mã số thuế/logo xác nhận. Biểu trưng chỉ được tải từ HTTPS `online.gov.vn` khi đã cấu hình cả mã tiếp nhận và URL ảnh; đây là biểu trưng thông báo, không phải giấy phép/chứng nhận chất lượng. Chủ thể kinh doanh phải xác định thủ tục thông báo/đăng ký áp dụng, hoàn thiện nội dung và xác minh với cơ quan có thẩm quyền trước khi mở bán.

Khung pháp luật đã thay đổi trong năm 2026: Luật Bảo vệ dữ liệu cá nhân 91/2025/QH15 và Nghị định 356/2025/NĐ-CP có hiệu lực từ 01/01/2026; Luật Thương mại điện tử 122/2025/QH15 và Nghị định 248/2026/NĐ-CP có hiệu lực từ 01/07/2026. Thủ tục hành chính công khai của Bộ Công Thương hiện ghi “Thông báo website thương mại điện tử bán hàng” (mã 2.000243), cấp thực hiện cấp tỉnh, và yêu cầu chủ sở hữu thông báo trước khi bán; hồ sơ hiện liệt kê giao diện website, loại hàng hóa/dịch vụ, thông tin chủ sở hữu/người đại diện, đăng ký kinh doanh hoặc mã số thuế cá nhân, tên miền và địa chỉ. Cần xác nhận cơ quan tiếp nhận/thủ tục áp dụng theo mô hình hoạt động và địa bàn tại thời điểm nộp; không dựa riêng vào checklist cũ theo Nghị định 52/2013 và 85/2021. Tham khảo [thủ tục 2.000243 trên Cổng Dịch vụ công Bộ Công Thương](https://dichvucong.moit.gov.vn/VdxpTTHCOnlineDetail.aspx?DocId=340), [Luật 122/2025/QH15](https://vanban.chinhphu.vn/?classid=1&docid=216503&pageid=27160&typegroupid=3) và [Nghị định 248/2026/NĐ-CP](https://vanban.chinhphu.vn/?docid=218747&orggroupid=2&pageid=27160).

Khung hóa đơn điện tử đã chuyển sang Luật Quản lý thuế 108/2025/QH15, Nghị định 254/2026/NĐ-CP và Thông tư 91/2026/TT-BTC (cùng có hiệu lực từ 01/07/2026); Nghị định 254/2026 thay thế khung Nghị định 123/2020 và Nghị định 70/2025 từ ngày này. Việc có phải dùng hóa đơn điện tử khởi tạo từ máy tính tiền hay hóa đơn có mã/không mã phụ thuộc loại hình người bán, ngành nghề, phương thức bán và điều kiện hệ thống theo quy định hiện hành. Riêng hộ/cá nhân kinh doanh, Nghị định 141/2026 sửa ngưỡng tại Nghị định 68/2026: doanh thu năm trên 1 tỷ đồng phải dùng hóa đơn điện tử có mã hoặc hóa đơn điện tử từ máy tính tiền kết nối cơ quan thuế; mức từ 1 tỷ đồng trở xuống có nhu cầu có thể đăng ký nếu đáp ứng điều kiện. Không suy rộng ngưỡng hộ kinh doanh này sang mọi doanh nghiệp. Hệ thống hiện **chưa tích hợp hoặc kết nối với giải pháp hóa đơn điện tử/cơ quan thuế**, chưa ký/phát hành hóa đơn điện tử và chưa có đối soát mã cơ quan thuế. Không dùng bản in HTML hiện tại như hóa đơn thuế. Tham khảo [Luật Quản lý thuế 108/2025/QH15](https://vanban.chinhphu.vn/?docid=216541&orggroupid=1&pageid=27160), [Nghị định 254/2026/NĐ-CP](https://vanban.chinhphu.vn/?docid=218689&pageid=27160&typegroupid=4), [Thông tư 91/2026/TT-BTC](https://vanban.chinhphu.vn/?docid=219006&pageid=27160) và [Nghị định 141/2026/NĐ-CP](https://xaydungchinhsach.chinhphu.vn/toan-van-nghi-dinh-so-141-2026-nd-cp-nang-nguong-doanh-thu-khong-phai-chiu-thue-len-1-ty-dong-119260504154326455.htm).

## Tài liệu tiến độ

Nguồn kế hoạch duy nhất: [`tasks/plan.md`](./tasks/plan.md).
