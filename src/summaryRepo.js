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

/** Danh sach ma_hs co it nhat 1 dong dang ky (so_luong_dang_ky > 0), kem tong so mon da dang ky. */
async function getStudentIdsWithRegistrations({ lop, khoi, q, includeDo } = {}) {
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

  const rs = await db.execute({
    sql: `
      SELECT s.ma_hs, s.ho_ten, s.lop, s.khoi, s.trang_thai_hoc, s.gioi_tinh
      FROM students s
      WHERE s.ma_hs IN (
        SELECT ma_hs FROM student_uniform_summary WHERE so_luong_dang_ky > 0 GROUP BY ma_hs
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
  upsertMeasurements,
  countStudentsMissingSize,
};
