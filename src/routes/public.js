const express = require('express');
const rateLimit = require('express-rate-limit');

const router = express.Router();
const asyncHandler = require('../asyncHandler');

const studentsRepo = require('../studentsRepo');
const cardRepo = require('../cardRepo');
const { buildRegistrationRows } = require('../registrationTable');

// Trang nay khong yeu cau dang nhap (danh cho GVCN/bo phan khac xem nhanh) - gioi han toc do
// truy cap de tranh bi quet/spam.
const publicLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
});
router.use(publicLimiter);

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
      result,
      lopKhoiList,
      filters: { q, lop, khoi, trangThai },
    });
  })
);

module.exports = router;
