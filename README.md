# Quản lý & báo cáo phát – trả đồng phục học sinh

Web app Node.js + Express + EJS + SQLite (qua [`@libsql/client`](https://github.com/tursodatabase/libsql-client-ts)),
cùng kiến trúc với app "chatbot tra cứu đồ thất lạc" để dễ vận hành/deploy nhất quán.

## 1. Cài đặt

```bash
npm install
cp .env.example .env
```

Đổi `SESSION_SECRET` trong `.env` thành 1 chuỗi ngẫu nhiên bí mật trước khi chạy thật.

## 2. Tạo tài khoản đăng nhập đầu tiên

```bash
node scripts/admin-users.js add <username> [password] [role]
```

`role` là `admin` (toàn quyền, mặc định) hoặc `viewer` (chỉ xem, không upload/sửa/phát đồ).

## 3. Chạy app

```bash
npm start
```

Hoặc `npm run dev` (tự restart khi sửa code). Mở http://localhost:3000 — sẽ chuyển tới trang đăng nhập.

## 4. Luồng sử dụng chính

1. **Học sinh** → tải lên "Danh sách học sinh toàn trường" (đối chiếu mã HS → họ tên/lớp).
2. **Tải file đăng ký** → tải lên file đăng ký của từng đợt (định dạng cột cố định: RollNumber,
   Tên, Email, Món, Size, Số lượng, Đơn giá, Tổng tiền, Trạng thái thanh toán, PaymentDate, Tháng).
   Đặt/xác nhận tên đợt (vd "Đợt 2") trước khi xác nhận nhập.
3. **Cần xử lý** → xử lý các dòng không khớp mã học sinh, không rõ loại trang phục, hoặc bất
   thường (nghi là đơn gộp nhiều món).
4. **File DS đăng ký có size** → xuất file để đo & điền size ngoài hệ thống, sau đó tải file đã điền lên lại.
5. **Đăng ký & phát đồ** → bảng bố cục theo DS đăng ký có size, đánh dấu đã phát/chưa phát trực tiếp trên bảng,
   sửa size nhanh, phát hàng loạt theo lớp.
6. **Báo cáo** → tổng quan, bảng loại trang phục × size, theo lớp/khối/đợt đăng ký, tiến độ phát —
   đều xuất được ra Excel.
7. **Danh mục / Đợt đăng ký** → chỉnh sửa danh mục loại trang phục (tên gọi "Món" nhận diện được,
   tên cột khi xuất DS đăng ký có size) và danh sách đợt đăng ký mà không cần sửa code.

## 5. Quản lý tài khoản

```bash
node scripts/admin-users.js add <username> [password] [role]
node scripts/admin-users.js passwd <username> [newPassword]
node scripts/admin-users.js setrole <username> <role>
node scripts/admin-users.js remove <username>
node scripts/admin-users.js list
```

## 6. Deploy

Xem `render.yaml` — deploy lên [Render](https://render.com) (free plan). Khi deploy, nên trỏ
sang [Turso](https://turso.tech) (`TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`) để dữ liệu bền vững
trên host không có ổ đĩa riêng; bỏ trống 2 biến này khi chạy local sẽ tự dùng file SQLite
(`storage/dong-phuc.db`).

## 7. Giả định đã chọn (xem thêm mục 10 trong spec gốc)

- Size lưu dạng **text tự do** (chưa ép hệ size cụ thể — trường có thể dùng S/M/L hoặc số).
- Cột "Đợt đăng ký" khi xuất DS đăng ký có size liệt kê **tất cả** các đợt đã đóng góp số lượng cho học sinh đó.
- Chỉ làm việc qua upload/download Excel, không tích hợp API thu phí thời gian thực.
- Dòng "Món" chứa mã code thô (vd `QD3`) được gắn cờ "cần kiểm tra tay", không tự tách dòng.
