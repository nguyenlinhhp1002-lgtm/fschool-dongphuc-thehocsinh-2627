const express = require('express');
const rateLimit = require('express-rate-limit');

const router = express.Router();
const asyncHandler = require('../asyncHandler');

const studentsRepo = require('../studentsRepo');
const cardRepo = require('../cardRepo');
const { buildRegistrationRows } = require('../registrationTable');
const { ensureCsrfToken } = require('../auth');

// Trang nay gioi han toc do truy cap de tranh bi quet/spam.
const publicLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
});
router.use(publicLimiter);

// Yeu cau dang nhap (qua /admin/login) moi xem duoc trang tra cuu - tranh de link cong khai
// lo thong tin hoc sinh cho nguoi khong lien quan. Tai khoan 'admin'/'viewer' (quan tri) va
// 'tra_cuu' (tai khoan don gian, dung chung, chi de xem trang nay) deu xem duoc; rieng 'lop'
// da co trang /admin/lop cua minh nen khong can/khong duoc dung chung tai khoan nay (tranh
// lo du lieu cac lop khac qua trang tra cuu toan truong).
router.use((req, res, next) => {
  const allowedRoles = ['admin', 'viewer', 'tra_cuu'];
  if (req.session && req.session.adminId && allowedRoles.includes(req.session.role)) {
    return next();
  }
  return res.redirect('/admin/login');
});

router.get('/', (req, res) => res.redirect('/tra-cuu/dong-phuc'));

router.get(
  '/dong-phuc',
  asyncHandler(async (req, res) => {
    const { q = '', lop = '', khoi = '' } = req.query;
    const [{ rows, categories }, lopKhoiList] = await Promise.all([
      buildRegistrationRows({ q, lop, khoi }),
      studentsRepo.getDistinctLopKhoi(),
    ]);
    res.render('public/dong-phuc', {
      pageTitle: 'Tra cứu đăng ký đồng phục',
      activeTab: 'dong-phuc',
      csrfToken: ensureCsrfToken(req),
      rows,
      categories,
      lopKhoiList,
      filters: { q, lop, khoi },
    });
  })
);

router.get(
  '/the-hoc-sinh',
  asyncHandler(async (req, res) => {
    const { q = '', lop = '', khoi = '', trangThai = '' } = req.query;
    const [result, lopKhoiList] = await Promise.all([
      cardRepo.searchCardItems({ q, lop, khoi, trangThai, page: 1, pageSize: 10000 }),
      studentsRepo.getDistinctLopKhoi(),
    ]);
    res.render('public/the-hoc-sinh', {
      pageTitle: 'Tra cứu đăng ký thẻ học sinh',
      activeTab: 'the-hoc-sinh',
      csrfToken: ensureCsrfToken(req),
      result,
      lopKhoiList,
      filters: { q, lop, khoi, trangThai },
    });
  })
);

module.exports = router;
