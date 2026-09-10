require('dotenv').config();

const path = require('path');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');

const { ensureSchema } = require('./src/db');
const { bootstrapInitialAdminIfNeeded } = require('./src/auth');
const adminRoutes = require('./src/routes/admin');
const publicRoutes = require('./src/routes/public');

const app = express();
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === 'production';

if (!process.env.SESSION_SECRET) {
  console.warn(
    '[Cảnh báo] Chưa đặt SESSION_SECRET trong .env — đang dùng giá trị mặc định KHÔNG an toàn cho production.'
  );
}

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

if (isProd) {
  // Render/Vercel deu chay app sau 1 reverse proxy huy TLS - can khai bao de Express
  // nhan dung ket noi la HTTPS, giup cookie session `secure: true` hoat dong dung.
  app.set('trust proxy', 1);
}

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        scriptSrc: ["'self'", 'https://cdnjs.cloudflare.com'],
        styleSrc: ["'self'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        connectSrc: ["'self'"],
      },
    },
  })
);

app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use(
  session({
    name: 'dongphuc.sid',
    secret: process.env.SESSION_SECRET || 'thay-doi-secret-nay-truoc-khi-chay-that',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: isProd,
      maxAge: 8 * 60 * 60 * 1000, // 8 gio
    },
  })
);

app.get('/', (req, res) => res.redirect('/admin'));
app.use('/admin', adminRoutes);
app.use('/tra-cuu', publicRoutes);

app.use((req, res) => {
  res.status(404).send('Không tìm thấy trang.');
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).send('Có lỗi hệ thống xảy ra. Vui lòng thử lại sau.');
});

ensureSchema()
  .then(bootstrapInitialAdminIfNeeded)
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Đồng phục & Thẻ học sinh 2026-2027 đang chạy tại http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Không khởi tạo được cơ sở dữ liệu:', err);
    process.exit(1);
  });
