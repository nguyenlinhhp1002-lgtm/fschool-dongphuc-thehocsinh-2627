# Hướng dẫn deploy MIỄN PHÍ (Render Free + Turso)

App cần 1 tiến trình Node chạy liên tục (không hợp serverless như Vercel) và cần dữ liệu
bền vững. Cách deploy **hoàn toàn miễn phí, không cần thẻ thanh toán** — giống hệt cách đã
làm với app "fschool-do-that-lac":

- **Render Free** — chạy code Node.js. Nhược điểm: tự "ngủ" sau 15 phút không có ai truy
  cập, lần request đầu tiên sau đó phải đợi ~1 phút để "thức dậy". Chấp nhận được với app
  nội bộ, không cần phản hồi tức thời liên tục.
- **Turso** — SQLite chạy trên mây, free tier ~5GB lưu trữ / 500 triệu lượt đọc mỗi tháng,
  dư sức cho 1 trường học. Dữ liệu nằm ở đây nên **không bị mất** dù Render khởi động lại.

Đánh đổi duy nhất: admin có thể bị đăng xuất nếu để lâu không thao tác (vì phiên đăng nhập
lưu tạm trong bộ nhớ, mất khi Render "ngủ" rồi thức dậy lại) — chỉ cần đăng nhập lại, dữ
liệu đồng phục/thẻ học sinh không bị ảnh hưởng gì.

---

## Bước 1 — Tạo repo GitHub mới và đẩy code lên

1. Vào **https://github.com/new** (đăng nhập tài khoản đã dùng cho `fschool-do-that-lac`).
2. Đặt tên repo, ví dụ `dong-phuc-2026`. Để **Private** nếu không muốn công khai code.
   **Không** tick "Add a README" (repo đã có code sẵn ở máy).
3. Bấm **Create repository** — GitHub sẽ hiện URL dạng
   `https://github.com/<username>/dong-phuc-2026.git`. Gửi URL đó lại (hoặc cho phép chạy
   lệnh) để đẩy code lên:
   ```bash
   git remote add origin https://github.com/<username>/dong-phuc-2026.git
   git push -u origin master
   ```

## Bước 2 — Tạo database Turso mới (tách biệt với database của app kia)

1. Vào **https://turso.tech** (đăng nhập bằng tài khoản đã có, hoặc GitHub).
2. Dashboard → **Create Database**:
   - Tên, ví dụ `dong-phuc-2026`.
   - Region gần Việt Nam nhất (Singapore nếu có).
3. Vào database vừa tạo → **Connect** / **Quickstart**, lấy 2 giá trị:
   - **Database URL** — dạng `libsql://dong-phuc-2026-<username>.turso.io`
   - **Auth Token** — bấm **Create Token** để lấy chuỗi token dài.
4. Giữ lại 2 giá trị này cho Bước 3.

## Bước 3 — Tạo Web Service trên Render từ Blueprint (`render.yaml`)

1. Vào **https://render.com** (đăng nhập tài khoản đã có) → **New +** → **Blueprint**.
2. Chọn repo `dong-phuc-2026` (nếu chưa thấy, vào Account Settings → GitHub → cho Render
   quyền truy cập thêm repo này).
3. Render đọc `render.yaml` và hiện preview:
   - 1 Web Service, gói **Free**, build `npm install`, start `npm start`.
   - 2 biến môi trường cần điền tay: `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` (dán từ Bước 2).
   - `SESSION_SECRET` Render tự sinh ngẫu nhiên, không cần điền.
4. Bấm **Apply**.
5. Theo dõi tab **Logs** đến khi thấy dòng
   `Đồng phục & Thẻ học sinh 2026-2027 đang chạy tại...` — nghĩa là build/khởi động thành
   công (bao gồm tự tạo bảng dữ liệu trên Turso lần đầu).

## Bước 4 — Tạo tài khoản đăng nhập đầu tiên trên server thật

Tab **Shell** của service trên Render Dashboard, chạy:

```bash
node scripts/admin-users.js add <ten-dang-nhap>
```

Nhập mật khẩu khi được hỏi (vai trò mặc định là `admin` — toàn quyền).

## Bước 5 — Kiểm tra

Render cấp URL dạng `https://dong-phuc-2026.onrender.com`. Mở URL đó:
- `/admin/login` — đăng nhập bằng tài khoản Bước 4, thử tải danh sách học sinh/đăng ký thật.
- `/tra-cuu` — trang công khai (không cần đăng nhập) để chia sẻ cho GVCN/bộ phận khác — link
  này giờ vào được từ **bất kỳ thiết bị/mạng nào**, không còn giới hạn cùng Wi-Fi như chạy
  local nữa.

Lần đầu mở sau khi app "ngủ", trang load chậm ~1 phút — bình thường, đợi 1 lần rồi các
request sau nhanh trở lại cho đến lần ngủ tiếp theo.

## Cập nhật code sau này

```bash
git add -A
git commit -m "Mô tả thay đổi"
git push
```

Render tự động deploy lại khi có push mới lên `master`. Dữ liệu trên Turso không bị ảnh
hưởng vì hoàn toàn tách biệt khỏi vòng đời của Render service.

## Sao lưu dữ liệu

Turso Dashboard → database → tải xuống bản sao (export) trực tiếp trên giao diện web. Các
file Excel đã upload (danh sách học sinh, file đăng ký, DS đăng ký có size, thẻ học sinh)
cũng nên giữ lại làm bản sao lưu đơn giản.

## Nếu sau này muốn nâng cấp lên Render trả phí (bỏ giới hạn "ngủ")

Đổi `plan: free` thành `plan: starter` trong `render.yaml` (hoặc trực tiếp trên Render
Dashboard → Settings) — không cần đổi gì ở phần Turso.
