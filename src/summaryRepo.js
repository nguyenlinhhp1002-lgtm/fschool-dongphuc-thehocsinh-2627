const { db } = require('./db');

async function getSummaryRowsForStudent(maHs) {
  const rs = await db.execute({
    sql: 'SELECT * FROM student_uniform_summary WHERE ma_hs = ?',
    args: [maHs],
  });
  return rs.rows;
}

async function getMeasurements(maHs) {
  const rs = await db.execute({ sql: 'SELECT * FROM student_measurements WHERE ma_hs = ?', args: [maHs] });
  return rs.rows[0] || null;
}

/**
 * Tra ve Map<ma_hs, Map<code_prefix, summaryRow>> cho toan bo he thong - dung de dung bang
 * lon (danh sach dang ky / DS no) ma khong query tung dong.
 */
async function getAllSummaryGrouped() {
  const rs = await db.execute('SELECT * FROM student_uniform_summary');
  const map = new Map();
  for (const row of rs.rows) {
    if (!map.has(row.ma_hs)) map.set(row.ma_hs, new Map());
    map.get(row.ma_hs).set(row.code_prefix, row);
  }
  return map;
}

async function getAllMeasurementsMap() {
  const rs = await db.execute('SELECT * FROM student_measurements');
  return new Map(rs.rows.map((r) => [r.ma_hs, r]));
}

/**
 * Danh sach ma_hs co it nhat 1 dong dang ky. Mac dinh chi lay dong con so_luong_dang_ky > 0
 * (dung cho man hinh cong khai/binh thuong). Truyen includeZero=true de lay ca hoc sinh co
 * dong da bi sua ve 0 (VD admin lo sua sai qua "Sua SL") - dung cho checkbox "Hiện cả học
 * sinh có SL = 0" tren trang "Dang ky & phat do", vi cac dong nay van con trong
 * student_uniform_summary (chi UPDATE ve 0, khong xoa dong) nen admin can tim lai duoc de
 * sua lai dung so luong.
 */
async function getStudentIdsWithRegistrations({ lop, khoi, q, includeDo, includeZero } = {}) {
  const where = [];
  const args = [];
  if (!includeDo) where.push(`s.trang_thai_hoc = 'Đang học'`);
  if (lop) {
    where.push('s.lop = ?');
    args.push(lop);
  }
  if (khoi) {
    where.push('s.khoi = ?');
    args.push(khoi);
  }
  if (q) {
    where.push('(s.ma_hs LIKE ? OR s.ho_ten LIKE ?)');
    args.push(`%${q}%`, `%${q}%`);
  }
  const whereSql = where.length ? `AND ${where.join(' AND ')}` : '';
  const dieuKienSoLuong = includeZero ? '1 = 1' : 'so_luong_dang_ky > 0';

  const rs = await db.execute({
    sql: `
      SELECT s.ma_hs, s.ho_ten, s.lop, s.khoi, s.trang_thai_hoc, s.gioi_tinh
      FROM students s
      WHERE s.ma_hs IN (
        SELECT ma_hs FROM student_uniform_summary WHERE ${dieuKienSoLuong} GROUP BY ma_hs
      ) ${whereSql}
      ORDER BY s.lop, s.ho_ten
    `,
    args,
  });
  return rs.rows;
}

/** Ghi de tay Size (+ tuy chon so luong) cho 1 hoc sinh x loai trang phuc, tra ve true neu so luong co thay doi (de log). */
async function upsertSizeAndMaybeQuantity({ maHs, codePrefix, size, soLuongMoi, adminUsername }) {
  const existingRs = await db.execute({
    sql: 'SELECT * FROM student_uniform_summary WHERE ma_hs = ? AND code_prefix = ?',
    args: [maHs, codePrefix],
  });
  const existing = existingRs.rows[0];
  const soLuongCu = existing ? existing.so_luong_dang_ky : 0;
  const finalSoLuong = soLuongMoi === null || soLuongMoi === undefined ? soLuongCu : soLuongMoi;

  await db.execute({
    sql: `INSERT INTO student_uniform_summary (ma_hs, code_prefix, so_luong_dang_ky, size, updated_at)
          VALUES (?, ?, ?, ?, datetime('now'))
          ON CONFLICT(ma_hs, code_prefix) DO UPDATE SET
            so_luong_dang_ky = ?, size = ?, updated_at = datetime('now')`,
    args: [maHs, codePrefix, finalSoLuong, size, finalSoLuong, size],
  });

  await mirrorSizeToGroupSiblings({ maHs, codePrefix, size });

  if (existing && finalSoLuong !== soLuongCu) {
    await db.execute({
      sql: `INSERT INTO audit_log (bang, khoa_chinh, truong, gia_tri_cu, gia_tri_moi, nguoi_sua)
            VALUES ('student_uniform_summary', ?, 'so_luong_dang_ky', ?, ?, ?)`,
      args: [`${maHs}/${codePrefix}`, String(soLuongCu), String(finalSoLuong), adminUsername],
    });
    return true;
  }
  return false;
}

/**
 * Sua tay cot "SL" (so_luong_dang_ky) tren trang "Dang ky & phat do" - danh cho truong hop
 * can dieu chinh 1 dong da dang ky (VD sua sai luc nhap file, hoac theo yeu cau thuc te).
 * BAT BUOC co ly do (kiem tra o day, khong chi tin popup phia client) - moi lan sua THUC SU
 * thay doi gia tri deu ghi lai vao quantity_change_log (xem tab rieng "Lich su sua SL").
 * Dung UPDATE (khong INSERT dong moi) - chi ap dung cho dong da co san, khop voi cach giao
 * dien chi hien nut sua khi o SL dang > 0 (khong the "tao moi" 1 dang ky qua duong nay).
 */
async function updateQuantityDangKy({ maHs, codePrefix, soLuongMoi, lyDo, adminUsername }) {
  const trimmedLyDo = String(lyDo || '').trim();
  if (!trimmedLyDo) {
    throw new Error('Vui lòng nhập lý do khi sửa số lượng.');
  }

  const existingRs = await db.execute({
    sql: 'SELECT so_luong_dang_ky FROM student_uniform_summary WHERE ma_hs = ? AND code_prefix = ?',
    args: [maHs, codePrefix],
  });
  const existing = existingRs.rows[0];
  const soLuongCu = existing ? existing.so_luong_dang_ky : 0;
  const soLuong = Math.max(0, Math.trunc(Number(soLuongMoi)) || 0);

  if (!existing && soLuong > 0) {
    // Khong co dong nao (chua tung dang ky muc nay) - khong duoc tu "them moi" 1 dang ky qua
    // duong sua SL, chi duoc dieu chinh 1 dong DA CO SAN (xem ghi chu dau ham).
    throw new Error('Học sinh chưa có đăng ký gốc cho mục này — không thể tự thêm số lượng mới ở đây.');
  }
  if (soLuong === soLuongCu) return false;

  await db.execute({
    sql: `UPDATE student_uniform_summary SET so_luong_dang_ky = ?, updated_at = datetime('now')
          WHERE ma_hs = ? AND code_prefix = ?`,
    args: [soLuong, maHs, codePrefix],
  });

  await db.execute({
    sql: `INSERT INTO quantity_change_log (ma_hs, code_prefix, so_luong_cu, so_luong_moi, ly_do, nguoi_sua)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [maHs, codePrefix, soLuongCu, soLuong, trimmedLyDo, adminUsername || null],
  });

  return true;
}

/**
 * Hoan tac 1 lan sua SL (dua tren du lieu da ghi trong quantity_change_log) - dua so luong
 * ve dung gia tri TRUOC lan sua do. Tao 1 dong lich su MOI (khong xoa/sua dong cu) de van
 * truy vet duoc day du - dung khi admin lo sua sai (VD sua ve 0 nham) can khoi phuc lai nhanh.
 */
async function revertQuantityChange(logId, adminUsername) {
  const rs = await db.execute({ sql: 'SELECT * FROM quantity_change_log WHERE id = ?', args: [logId] });
  const entry = rs.rows[0];
  if (!entry) {
    throw new Error('Không tìm thấy dòng lịch sử này.');
  }
  await updateQuantityDangKy({
    maHs: entry.ma_hs,
    codePrefix: entry.code_prefix,
    soLuongMoi: entry.so_luong_cu,
    lyDo: `Hoàn tác lần sửa lúc ${entry.thoi_gian} (khôi phục về ${entry.so_luong_cu}, trước đó đã sửa thành ${entry.so_luong_moi})`,
    adminUsername,
  });
}

/** Lich su sua SL toan truong (moi nhat truoc), dung cho tab rieng "Lich su sua SL". */
async function getQuantityChangeHistory({ page = 1, pageSize = 50 } = {}) {
  const countRs = await db.execute('SELECT COUNT(*) AS c FROM quantity_change_log');
  const total = Number(countRs.rows[0].c);
  const offset = (page - 1) * pageSize;
  const rs = await db.execute({
    sql: `SELECT q.*, s.ho_ten, s.lop, uc.ten_hien_thi
          FROM quantity_change_log q
          LEFT JOIN students s ON s.ma_hs = q.ma_hs
          LEFT JOIN uniform_categories uc ON uc.code_prefix = q.code_prefix
          ORDER BY q.thoi_gian DESC, q.id DESC
          LIMIT ? OFFSET ?`,
    args: [pageSize, offset],
  });
  return { rows: rs.rows, total, page, pageSize };
}

/**
 * Neu loai trang phuc nay thuoc 1 size_group (vd "Size chung" dung cho Ao polo/Quan sooc/
 * Ao khoac/The thao), dong bo lai size vua luu sang cac loai khac CUNG NHOM cua hoc sinh nay
 * (chi cap nhat dong da co san - hoc sinh chua dang ky loai do thi khong tao dong moi).
 */
async function mirrorSizeToGroupSiblings({ maHs, codePrefix, size }) {
  const catRs = await db.execute({ sql: 'SELECT size_group_code FROM uniform_categories WHERE code_prefix = ?', args: [codePrefix] });
  const groupCode = catRs.rows[0] && catRs.rows[0].size_group_code;
  if (!groupCode) return;

  const siblingsRs = await db.execute({
    sql: 'SELECT code_prefix FROM uniform_categories WHERE size_group_code = ? AND code_prefix != ?',
    args: [groupCode, codePrefix],
  });
  for (const sib of siblingsRs.rows) {
    await db.execute({
      sql: `UPDATE student_uniform_summary SET size = ?, updated_at = datetime('now') WHERE ma_hs = ? AND code_prefix = ?`,
      args: [size, maHs, sib.code_prefix],
    });
  }
}

async function upsertMeasurements({ maHs, chieuCao, canNang, vongBung, daiChan, gioiTinh, ghiChu, adminUsername }) {
  await db.execute({
    sql: `INSERT INTO student_measurements (ma_hs, chieu_cao_cm, can_nang_kg, vong_bung_cm, dai_chan_cm, gioi_tinh, ghi_chu, updated_at, updated_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)
          ON CONFLICT(ma_hs) DO UPDATE SET
            chieu_cao_cm = ?, can_nang_kg = ?, vong_bung_cm = ?, dai_chan_cm = ?, gioi_tinh = ?, ghi_chu = ?,
            updated_at = datetime('now'), updated_by = ?`,
    args: [
      maHs, chieuCao, canNang, vongBung, daiChan, gioiTinh, ghiChu, adminUsername,
      chieuCao, canNang, vongBung, daiChan, gioiTinh, ghiChu, adminUsername,
    ],
  });
}

/** So hoc sinh da dang ky nhung con thieu size o it nhat 1 loai trang phuc co dang ky (SL>0, can size, size rong). */
async function countStudentsMissingSize() {
  const rs = await db.execute(`
    SELECT COUNT(DISTINCT sus.ma_hs) AS c
    FROM student_uniform_summary sus
    JOIN uniform_categories uc ON uc.code_prefix = sus.code_prefix
    WHERE sus.so_luong_dang_ky > 0 AND uc.co_size = 1 AND (sus.size IS NULL OR TRIM(sus.size) = '')
  `);
  return Number(rs.rows[0].c);
}

module.exports = {
  getSummaryRowsForStudent,
  getMeasurements,
  getAllSummaryGrouped,
  getAllMeasurementsMap,
  getStudentIdsWithRegistrations,
  upsertSizeAndMaybeQuantity,
  updateQuantityDangKy,
  revertQuantityChange,
  getQuantityChangeHistory,
  upsertMeasurements,
  countStudentsMissingSize,
};
