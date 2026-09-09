const express = require('express');
const multer = require('multer');
const rateLimit = require('express-rate-limit');

const router = express.Router();

const uploadExcel = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const okExt = /\.xlsx$/i.test(file.originalname);
    if (okExt) return cb(null, true);
    cb(new Error('Chỉ chấp nhận file .xlsx'));
  },
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Bạn thử đăng nhập quá nhiều lần. Vui lòng thử lại sau 15 phút.',
});

const {
  requireAdmin,
  requireFullAdmin,
  ensureCsrfToken,
  verifyCsrfToken,
  isCsrfTokenValid,
  renderCsrfError,
  findAdminByUsername,
  verifyPassword,
} = require('../auth');
const asyncHandler = require('../asyncHandler');
const pendingStore = require('../pendingStore');
const { ExcelValidationError } = require('../excelHelpers');

const { parseStudentsExcelBuffer } = require('../studentsImport');
const studentsRepo = require('../studentsRepo');

const categoriesRepo = require('../categoriesRepo');
const batchesRepo = require('../batchesRepo');

const { parseRegistrationExcelBuffer } = require('../registrationImport');
const registrationRepo = require('../registrationRepo');

const summaryRepo = require('../summaryRepo');
const distributionRepo = require('../distributionRepo');

const { buildDsNoWorkbook } = require('../dsNoExport');
const dsNoImport = require('../dsNoImport');

const reportsRepo = require('../reportsRepo');
const { buildSimpleXlsx } = require('../exportXlsx');

/** Xay lai query string tu 1 object (bo qua gia tri rong), dung de "quay lai trang cu voi bo loc cu" sau khi POST. */
function toQueryString(params) {
  const qs = new URLSearchParams();
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') qs.set(k, v);
  });
  const str = qs.toString();
  return str ? `?${str}` : '';
}

// ---------- Dang nhap / dang xuat ----------

router.get('/login', (req, res) => {
  if (req.session.adminId) return res.redirect('/admin');
  res.render('admin/login', { csrfToken: ensureCsrfToken(req), error: null });
});

router.post(
  '/login',
  loginLimiter,
  verifyCsrfToken,
  asyncHandler(async (req, res) => {
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');

    const admin = await findAdminByUsername(username);
    const ok = admin && verifyPassword(password, admin.password_hash);
    if (!ok) {
      return res.render('admin/login', {
        csrfToken: ensureCsrfToken(req),
        error: 'Tên đăng nhập hoặc mật khẩu không đúng.',
      });
    }

    req.session.adminId = admin.id;
    req.session.username = admin.username;
    req.session.role = admin.role;
    res.redirect('/admin');
  })
);

router.post('/logout', requireAdmin, (req, res) => {
  req.session.destroy(() => res.redirect('/admin/login'));
});

// Tu day tro xuong, moi route deu yeu cau da dang nhap.
router.use(requireAdmin);

function baseLocals(req) {
  return {
    session: req.session,
    csrfToken: ensureCsrfToken(req),
  };
}

// ---------- Trang chu / Dashboard ----------

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const [overview, categoryTotals] = await Promise.all([
      reportsRepo.getDashboardOverview(),
      reportsRepo.getCategoryTotals(),
    ]);
    res.render('admin/dashboard', {
      ...baseLocals(req),
      pageTitle: 'Trang chủ',
      activeNav: 'dashboard',
      overview,
      categoryTotals,
    });
  })
);

// ---------- Danh sach hoc sinh toan truong ----------

router.get(
  '/hoc-sinh',
  asyncHandler(async (req, res) => {
    const { q = '', lop = '', khoi = '', includeDo, page } = req.query;
    const [result, lopKhoiList, history] = await Promise.all([
      studentsRepo.searchStudents({ q, lop, khoi, includeDo: includeDo === '1', page: Number(page) || 1, pageSize: 50 }),
      studentsRepo.getDistinctLopKhoi(),
      studentsRepo.getRosterUploadHistory(),
    ]);
    res.render('admin/students', {
      ...baseLocals(req),
      pageTitle: 'Danh sách học sinh toàn trường',
      activeNav: 'students',
      result,
      lopKhoiList,
      history,
      filters: { q, lop, khoi, includeDo },
      preview: null,
      ok: req.query.ok === '1',
    });
  })
);

router.post(
  '/hoc-sinh/upload',
  requireFullAdmin,
  uploadExcel.single('file'),
  asyncHandler(async (req, res) => {
    if (!isCsrfTokenValid(req)) return renderCsrfError(res);

    const renderWithError = async (errors) => {
      const [result, lopKhoiList, history] = await Promise.all([
        studentsRepo.searchStudents({ page: 1, pageSize: 50 }),
        studentsRepo.getDistinctLopKhoi(),
        studentsRepo.getRosterUploadHistory(),
      ]);
      res.render('admin/students', {
        ...baseLocals(req),
        pageTitle: 'Danh sách học sinh toàn trường',
        activeNav: 'students',
        result,
        lopKhoiList,
        history,
        filters: {},
        preview: null,
        ok: false,
        uploadErrors: errors,
      });
    };

    if (!req.file) return renderWithError(['Vui lòng chọn 1 file Excel (.xlsx) để tải lên.']);

    let parsed;
    try {
      parsed = await parseStudentsExcelBuffer(req.file.buffer, req.body.sheetName || undefined);
    } catch (err) {
      if (err instanceof ExcelValidationError) return renderWithError(err.errors);
      throw err;
    }

    const diff = await studentsRepo.previewRosterDiff(parsed.students);
    const token = pendingStore.put('roster', {
      students: parsed.students,
      diff,
      filename: req.file.originalname,
    });

    const [result, lopKhoiList, history] = await Promise.all([
      studentsRepo.searchStudents({ page: 1, pageSize: 50 }),
      studentsRepo.getDistinctLopKhoi(),
      studentsRepo.getRosterUploadHistory(),
    ]);
    res.render('admin/students', {
      ...baseLocals(req),
      pageTitle: 'Danh sách học sinh toàn trường',
      activeNav: 'students',
      result,
      lopKhoiList,
      history,
      filters: {},
      ok: false,
      preview: {
        token,
        diff,
        filename: req.file.originalname,
        sheetName: parsed.sheetName,
        sheetNames: parsed.sheetNames,
      },
    });
  })
);

router.post(
  '/hoc-sinh/upload/confirm',
  requireFullAdmin,
  verifyCsrfToken,
  asyncHandler(async (req, res) => {
    const pending = pendingStore.consume('roster', req.body.token);
    if (!pending) {
      return res.status(400).render('admin/error', {
        title: 'Phiên tải file đã hết hạn',
        message: 'Dữ liệu xem trước đã hết hạn (quá 30 phút) hoặc đã được xác nhận trước đó. Vui lòng tải file lên lại.',
      });
    }
    await studentsRepo.commitRosterUpload({
      students: pending.students,
      diff: pending.diff,
      adminUsername: req.session.username,
      filename: pending.filename,
    });
    res.redirect('/admin/hoc-sinh?ok=1');
  })
);

// ---------- Danh muc loai trang phuc ----------

router.get(
  '/danh-muc',
  asyncHandler(async (req, res) => {
    const categories = await categoriesRepo.getAllCategories();
    res.render('admin/categories', {
      ...baseLocals(req),
      pageTitle: 'Danh mục loại trang phục',
      activeNav: 'categories',
      categories,
    });
  })
);

router.post(
  '/danh-muc',
  requireFullAdmin,
  verifyCsrfToken,
  asyncHandler(async (req, res) => {
    const { codePrefix, tenHienThi, cotSl, cotSize, thuTu, aliases } = req.body;
    const coSize = req.body.coSize === '1';
    await categoriesRepo.createCategory({
      codePrefix: String(codePrefix || '').trim().toUpperCase(),
      tenHienThi: String(tenHienThi || '').trim(),
      cotSl: String(cotSl || '').trim(),
      cotSize: String(cotSize || '').trim(),
      coSize,
      thuTu: Number(thuTu) || 99,
      aliases: String(aliases || '').split(/[,\n]/).map((a) => a.trim()).filter(Boolean),
    });
    res.redirect('/admin/danh-muc');
  })
);

router.post(
  '/danh-muc/:code',
  requireFullAdmin,
  verifyCsrfToken,
  asyncHandler(async (req, res) => {
    const { tenHienThi, cotSl, cotSize, thuTu } = req.body;
    const coSize = req.body.coSize === '1';
    const active = req.body.active === '1';
    await categoriesRepo.updateCategory(req.params.code, {
      tenHienThi: String(tenHienThi || '').trim(),
      cotSl: String(cotSl || '').trim(),
      cotSize: String(cotSize || '').trim(),
      coSize,
      thuTu: Number(thuTu) || 99,
      active,
    });
    res.redirect('/admin/danh-muc');
  })
);

router.post(
  '/danh-muc/:code/alias',
  requireFullAdmin,
  verifyCsrfToken,
  asyncHandler(async (req, res) => {
    await categoriesRepo.addAlias(req.params.code, req.body.tenGoc || '');
    res.redirect('/admin/danh-muc');
  })
);

router.post(
  '/danh-muc/alias/:id/xoa',
  requireFullAdmin,
  verifyCsrfToken,
  asyncHandler(async (req, res) => {
    await categoriesRepo.removeAlias(req.params.id);
    res.redirect('/admin/danh-muc');
  })
);

// ---------- Dot dang ky ----------

router.get(
  '/dot-dang-ky',
  asyncHandler(async (req, res) => {
    const batches = await batchesRepo.getAllBatches();
    res.render('admin/batches', {
      ...baseLocals(req),
      pageTitle: 'Đợt đăng ký',
      activeNav: 'batches',
      batches,
    });
  })
);

router.post(
  '/dot-dang-ky',
  requireFullAdmin,
  verifyCsrfToken,
  asyncHandler(async (req, res) => {
    const { tenDot, ngayBatDau, ngayKetThuc } = req.body;
    if (String(tenDot || '').trim()) {
      await batchesRepo.createBatch({ tenDot: tenDot.trim(), ngayBatDau, ngayKetThuc });
    }
    res.redirect('/admin/dot-dang-ky');
  })
);

router.post(
  '/dot-dang-ky/:id',
  requireFullAdmin,
  verifyCsrfToken,
  asyncHandler(async (req, res) => {
    const { tenDot, ngayBatDau, ngayKetThuc } = req.body;
    await batchesRepo.updateBatch(req.params.id, { tenDot, ngayBatDau, ngayKetThuc });
    res.redirect('/admin/dot-dang-ky');
  })
);

// ---------- Upload file dang ky ----------

router.get(
  '/dang-ky/upload',
  asyncHandler(async (req, res) => {
    const history = await registrationRepo.getRegistrationUploadHistory();
    res.render('admin/registration-upload', {
      ...baseLocals(req),
      pageTitle: 'Tải lên file đăng ký',
      activeNav: 'registration-upload',
      history,
      preview: null,
      uploadErrors: null,
      done: req.query.done === '1',
      moi: req.query.moi || 0,
      trung: req.query.trung || 0,
    });
  })
);

router.post(
  '/dang-ky/upload',
  requireFullAdmin,
  uploadExcel.single('file'),
  asyncHandler(async (req, res) => {
    if (!isCsrfTokenValid(req)) return renderCsrfError(res);

    const renderWithError = async (errors) => {
      const history = await registrationRepo.getRegistrationUploadHistory();
      res.render('admin/registration-upload', {
        ...baseLocals(req),
        pageTitle: 'Tải lên file đăng ký',
        activeNav: 'registration-upload',
        history,
        preview: null,
        uploadErrors: errors,
      });
    };

    if (!req.file) return renderWithError(['Vui lòng chọn 1 file Excel (.xlsx) để tải lên.']);

    let parsed;
    try {
      parsed = await parseRegistrationExcelBuffer(req.file.buffer);
    } catch (err) {
      if (err instanceof ExcelValidationError) return renderWithError(err.errors);
      throw err;
    }

    const resolvedRows = await registrationRepo.resolveRegistrationRows(parsed.rows);
    const tomTat = registrationRepo.tomTatKetQua(resolvedRows);
    const token = pendingStore.put('registration', { resolvedRows, filename: req.file.originalname });

    const goiYDot = parsed.dotGoiY || batchesRepo.goiYTenDotTuFilename(req.file.originalname);
    const history = await registrationRepo.getRegistrationUploadHistory();

    res.render('admin/registration-upload', {
      ...baseLocals(req),
      pageTitle: 'Tải lên file đăng ký',
      activeNav: 'registration-upload',
      history,
      uploadErrors: null,
      preview: {
        token,
        filename: req.file.originalname,
        tomTat,
        goiYDot,
        mauLoi: resolvedRows.filter((r) => r.trangThaiDongBo !== 'ok').slice(0, 20),
      },
    });
  })
);

router.post(
  '/dang-ky/upload/confirm',
  requireFullAdmin,
  verifyCsrfToken,
  asyncHandler(async (req, res) => {
    const pending = pendingStore.consume('registration', req.body.token);
    if (!pending) {
      return res.status(400).render('admin/error', {
        title: 'Phiên tải file đã hết hạn',
        message: 'Dữ liệu xem trước đã hết hạn (quá 30 phút) hoặc đã được xác nhận trước đó. Vui lòng tải file lên lại.',
      });
    }
    const tenDot = String(req.body.tenDot || '').trim();
    if (!tenDot) {
      return res.status(400).render('admin/error', {
        title: 'Thiếu tên đợt đăng ký',
        message: 'Vui lòng đặt tên cho đợt đăng ký (vd "Đợt 2") trước khi xác nhận nhập dữ liệu.',
      });
    }
    const batch = await batchesRepo.findOrCreateBatch(tenDot);
    const result = await registrationRepo.commitRegistrationImport({
      resolvedRows: pending.resolvedRows,
      batchId: batch.id,
      adminUsername: req.session.username,
      filename: pending.filename,
    });
    res.redirect(`/admin/dang-ky/upload?done=1&moi=${result.soDongDaGhi}&trung=${result.soDongTrung}`);
  })
);

// ---------- Dong dang ky can xu ly thu cong ----------

router.get(
  '/dang-ky/loi',
  asyncHandler(async (req, res) => {
    const [issues, categories] = await Promise.all([
      registrationRepo.getIssueRows({ page: Number(req.query.page) || 1, pageSize: 50 }),
      categoriesRepo.getActiveCategories(),
    ]);
    res.render('admin/registration-issues', {
      ...baseLocals(req),
      pageTitle: 'Đăng ký cần xử lý thủ công',
      activeNav: 'registration-issues',
      issues,
      categories,
    });
  })
);

router.post(
  '/dang-ky/loi/:id/sua',
  requireFullAdmin,
  verifyCsrfToken,
  asyncHandler(async (req, res) => {
    await registrationRepo.fixRegistrationItem(req.params.id, {
      maHs: String(req.body.maHs || '').trim() || null,
      codePrefix: String(req.body.codePrefix || '').trim() || null,
    });
    res.redirect(`/admin/dang-ky/loi${toQueryString({ page: req.query.page })}`);
  })
);

// ---------- Bang danh sach dang ky / phat do (bo cuc theo DS no) ----------

router.get(
  '/dang-ky',
  asyncHandler(async (req, res) => {
    const { q = '', lop = '', khoi = '' } = req.query;
    const [students, categories, summaryGrouped, lopKhoiList] = await Promise.all([
      summaryRepo.getStudentIdsWithRegistrations({ q, lop, khoi }),
      categoriesRepo.getActiveCategories(),
      summaryRepo.getAllSummaryGrouped(),
      studentsRepo.getDistinctLopKhoi(),
    ]);

    const rows = students.map((s) => {
      const summaryByCode = summaryGrouped.get(s.ma_hs) || new Map();
      const cells = categories.map((cat) => {
        const row = summaryByCode.get(cat.code_prefix);
        const soLuong = row ? row.so_luong_dang_ky : 0;
        const daPhat = row ? row.so_luong_da_phat : 0;
        return {
          codePrefix: cat.code_prefix,
          coSize: cat.co_size,
          soLuong,
          size: row ? row.size : null,
          daPhat,
          trangThaiPhat: soLuong === 0 ? null : daPhat === 0 ? 'chua_phat' : daPhat < soLuong ? 'mot_phan' : 'da_phat_du',
        };
      });
      return { student: s, cells };
    });

    res.render('admin/registration-list', {
      ...baseLocals(req),
      pageTitle: 'Danh sách đăng ký & phát đồ',
      activeNav: 'registration-list',
      rows,
      categories,
      lopKhoiList,
      filters: { q, lop, khoi },
    });
  })
);

router.post(
  '/dang-ky/cap-nhat',
  requireFullAdmin,
  verifyCsrfToken,
  asyncHandler(async (req, res) => {
    const { maHs, codePrefix, hanhDong, giaTri, returnTo } = req.body;
    if (hanhDong === 'toggle_phat') {
      await distributionRepo.toggleFullyDelivered({
        maHs,
        codePrefix,
        delivered: giaTri === '1',
        nguoiPhat: req.session.username,
      });
    } else if (hanhDong === 'set_size') {
      await summaryRepo.upsertSizeAndMaybeQuantity({
        maHs,
        codePrefix,
        size: String(giaTri || '').trim() || null,
        soLuongMoi: null,
        adminUsername: req.session.username,
      });
    }
    res.redirect(returnTo && returnTo.startsWith('/admin/dang-ky') ? returnTo : '/admin/dang-ky');
  })
);

router.post(
  '/dang-ky/phat-hang-loat',
  requireFullAdmin,
  verifyCsrfToken,
  asyncHandler(async (req, res) => {
    const { lop, codePrefix, returnTo } = req.body;
    if (lop && codePrefix) {
      const maHsList = await distributionRepo.getMaHsListByLop(lop);
      await distributionRepo.bulkMarkDelivered({ maHsList, codePrefix, nguoiPhat: req.session.username });
    }
    res.redirect(returnTo && returnTo.startsWith('/admin/dang-ky') ? returnTo : '/admin/dang-ky');
  })
);

// ---------- DS no: xuat + upload lai ----------

router.get(
  '/ds-no',
  asyncHandler(async (req, res) => {
    const [lopKhoiList, history] = await Promise.all([
      studentsRepo.getDistinctLopKhoi(),
      dsNoImport.getDsNoUploadHistory(),
    ]);
    res.render('admin/ds-no', {
      ...baseLocals(req),
      pageTitle: 'File "DS nợ"',
      activeNav: 'ds-no',
      lopKhoiList,
      history,
      preview: null,
      uploadErrors: null,
    });
  })
);

router.get(
  '/ds-no/xuat.xlsx',
  asyncHandler(async (req, res) => {
    const { lop = '', khoi = '', onlyMissingSize } = req.query;
    const { buffer, rowCount } = await buildDsNoWorkbook({
      lop: lop || undefined,
      khoi: khoi || undefined,
      onlyMissingSize: onlyMissingSize === '1',
    });
    const today = new Date();
    const dd = String(today.getDate()).padStart(2, '0');
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const filename = `DS no - xuat ${dd}.${mm}.${today.getFullYear()}${rowCount === 0 ? ' (rong)' : ''}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
    res.send(Buffer.from(buffer));
  })
);

router.post(
  '/ds-no/upload',
  requireFullAdmin,
  uploadExcel.single('file'),
  asyncHandler(async (req, res) => {
    if (!isCsrfTokenValid(req)) return renderCsrfError(res);

    const renderWithError = async (errors) => {
      const [lopKhoiList, history] = await Promise.all([
        studentsRepo.getDistinctLopKhoi(),
        dsNoImport.getDsNoUploadHistory(),
      ]);
      res.render('admin/ds-no', {
        ...baseLocals(req),
        pageTitle: 'File "DS nợ"',
        activeNav: 'ds-no',
        lopKhoiList,
        history,
        preview: null,
        uploadErrors: errors,
      });
    };

    if (!req.file) return renderWithError(['Vui lòng chọn 1 file Excel (.xlsx) để tải lên.']);

    let parsed;
    try {
      parsed = await dsNoImport.parseDsNoExcelBuffer(req.file.buffer);
    } catch (err) {
      if (err instanceof ExcelValidationError) return renderWithError(err.errors);
      throw err;
    }

    const changes = await dsNoImport.tinhChenhLechSoLuong(parsed.rows);
    const token = pendingStore.put('dsNo', { rows: parsed.rows, filename: req.file.originalname, changes });

    const [lopKhoiList, history] = await Promise.all([
      studentsRepo.getDistinctLopKhoi(),
      dsNoImport.getDsNoUploadHistory(),
    ]);
    res.render('admin/ds-no', {
      ...baseLocals(req),
      pageTitle: 'File "DS nợ"',
      activeNav: 'ds-no',
      lopKhoiList,
      history,
      uploadErrors: null,
      preview: {
        token,
        filename: req.file.originalname,
        tongDong: parsed.rows.length,
        changes: changes.slice(0, 30),
        soThayDoi: changes.length,
      },
    });
  })
);

router.post(
  '/ds-no/upload/confirm',
  requireFullAdmin,
  verifyCsrfToken,
  asyncHandler(async (req, res) => {
    const pending = pendingStore.consume('dsNo', req.body.token);
    if (!pending) {
      return res.status(400).render('admin/error', {
        title: 'Phiên tải file đã hết hạn',
        message: 'Dữ liệu xem trước đã hết hạn (quá 30 phút) hoặc đã được xác nhận trước đó. Vui lòng tải file lên lại.',
      });
    }
    await dsNoImport.commitDsNoImport({ rows: pending.rows, adminUsername: req.session.username });
    await dsNoImport.ghiAuditSoLuong(pending.changes, req.session.username);
    await dsNoImport.logDsNoUpload({
      adminUsername: req.session.username,
      filename: pending.filename,
      tongDong: pending.rows.length,
      soDongSuaSoLuong: pending.changes.length,
    });
    res.redirect('/admin/ds-no?ok=1');
  })
);

// ---------- Bao cao & thong ke ----------

router.get(
  '/bao-cao',
  asyncHandler(async (req, res) => {
    const groupBy = ['lop', 'khoi', 'batch'].includes(req.query.nhom) ? req.query.nhom : 'lop';
    const { khoi = '', lop = '', batchId = '' } = req.query;

    const [overview, categoryTotals, sizeMatrix, totalsByGroup, progressByGroup, batches, lopKhoiList] = await Promise.all([
      reportsRepo.getDashboardOverview(),
      reportsRepo.getCategoryTotals(),
      reportsRepo.getCategorySizeMatrix({ khoi: khoi || undefined, lop: lop || undefined, batchId: batchId ? Number(batchId) : undefined }),
      reportsRepo.getTotalsByGroup(groupBy),
      reportsRepo.getProgressByGroup(groupBy === 'batch' ? 'lop' : groupBy),
      batchesRepo.getAllBatches(),
      studentsRepo.getDistinctLopKhoi(),
    ]);

    const categories = await categoriesRepo.getActiveCategories();

    res.render('admin/reports', {
      ...baseLocals(req),
      pageTitle: 'Báo cáo & thống kê',
      activeNav: 'reports',
      overview,
      categoryTotals,
      sizeMatrix,
      totalsByGroup,
      progressByGroup,
      batches,
      lopKhoiList,
      categories,
      groupBy,
      filters: { khoi, lop, batchId },
    });
  })
);

router.get(
  '/bao-cao/xuat/kich-co.xlsx',
  asyncHandler(async (req, res) => {
    const { khoi = '', lop = '', batchId = '' } = req.query;
    const { matrix } = await reportsRepo.getCategorySizeMatrix({
      khoi: khoi || undefined,
      lop: lop || undefined,
      batchId: batchId ? Number(batchId) : undefined,
    });
    const categories = await categoriesRepo.getActiveCategories();
    const rows = [];
    for (const cat of categories) {
      const sizes = matrix.get(cat.code_prefix);
      if (!sizes) continue;
      for (const [size, qty] of sizes.entries()) {
        rows.push([cat.ten_hien_thi, size, qty]);
      }
    }
    const buffer = await buildSimpleXlsx('Loai x Size', ['Loại trang phục', 'Size', 'Số lượng'], rows);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="bao-cao-loai-x-size.xlsx"');
    res.send(Buffer.from(buffer));
  })
);

router.get(
  '/bao-cao/xuat/nhom.xlsx',
  asyncHandler(async (req, res) => {
    const groupBy = ['lop', 'khoi', 'batch'].includes(req.query.nhom) ? req.query.nhom : 'lop';
    const rows = await reportsRepo.getTotalsByGroup(groupBy);
    const categories = await categoriesRepo.getActiveCategories();
    const catByCode = new Map(categories.map((c) => [c.code_prefix, c.ten_hien_thi]));
    const data = rows.map((r) => [r.nhom, catByCode.get(r.code_prefix) || r.code_prefix, r.so_luong]);
    const buffer = await buildSimpleXlsx('Tong hop', ['Nhóm', 'Loại trang phục', 'Số lượng'], data);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="bao-cao-tong-hop.xlsx"');
    res.send(Buffer.from(buffer));
  })
);

router.get(
  '/bao-cao/xuat/tien-do.xlsx',
  asyncHandler(async (req, res) => {
    const groupBy = req.query.nhom === 'khoi' ? 'khoi' : 'lop';
    const rows = await reportsRepo.getProgressByGroup(groupBy);
    const categories = await categoriesRepo.getActiveCategories();
    const catByCode = new Map(categories.map((c) => [c.code_prefix, c.ten_hien_thi]));
    const data = rows.map((r) => [r.nhom, catByCode.get(r.code_prefix) || r.code_prefix, r.tong_dang_ky, r.tong_da_phat]);
    const buffer = await buildSimpleXlsx('Tien do phat', ['Nhóm', 'Loại trang phục', 'Tổng đăng ký', 'Tổng đã phát'], data);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="bao-cao-tien-do-phat.xlsx"');
    res.send(Buffer.from(buffer));
  })
);

module.exports = router;
