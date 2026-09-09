const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { db } = require('./db');

const SALT_ROUNDS = 10;

function hashPassword(plainPassword) {
  return bcrypt.hashSync(plainPassword, SALT_ROUNDS);
}

function verifyPassword(plainPassword, passwordHash) {
  return bcrypt.compareSync(plainPassword, passwordHash);
}

async function findAdminByUsername(username) {
  const rs = await db.execute({ sql: 'SELECT * FROM admins WHERE username = ?', args: [username] });
  return rs.rows[0] || null;
}

/** Middleware: yeu cau da dang nhap, neu chua thi chuyen huong ve trang login. */
function requireAdmin(req, res, next) {
  if (req.session && req.session.adminId) {
    return next();
  }
  return res.redirect('/admin/login');
}

/** Middleware: yeu cau tai khoan co quyen day du (role='admin'), khong danh cho 'viewer'. */
function requireFullAdmin(req, res, next) {
  if (req.session && req.session.role === 'admin') {
    return next();
  }
  return res.status(403).render('admin/error', {
    title: 'Không có quyền truy cập',
    message: 'Tài khoản của bạn chỉ có quyền xem, không thể thực hiện thao tác này.',
  });
}

/** Dam bao moi session co 1 CSRF token, dung chung cho GET (render form) va POST (kiem tra). */
function ensureCsrfToken(req) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(24).toString('hex');
  }
  return req.session.csrfToken;
}

function isCsrfTokenValid(req) {
  const tokenFromForm = req.body && req.body._csrf;
  return Boolean(tokenFromForm && req.session && tokenFromForm === req.session.csrfToken);
}

function renderCsrfError(res) {
  return res.status(403).render('admin/error', {
    title: 'Lỗi xác thực',
    message: 'Phiên làm việc đã hết hạn hoặc yêu cầu không hợp lệ. Vui lòng tải lại trang và thử lại.',
  });
}

/**
 * Middleware CSRF cho route thuong (form url-encoded, req.body co san khi middleware nay chay).
 * Voi route multipart/form-data (upload file), KHONG dung middleware nay - phai goi
 * isCsrfTokenValid()/renderCsrfError() thu cong SAU khi multer da parse xong req.body.
 */
function verifyCsrfToken(req, res, next) {
  if (isCsrfTokenValid(req)) return next();
  return renderCsrfError(res);
}

module.exports = {
  hashPassword,
  verifyPassword,
  findAdminByUsername,
  requireAdmin,
  requireFullAdmin,
  ensureCsrfToken,
  verifyCsrfToken,
  isCsrfTokenValid,
  renderCsrfError,
};
