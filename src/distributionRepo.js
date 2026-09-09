const { db } = require('./db');

/** Cap nhat so luong da phat cho 1 hoc sinh x loai trang phuc, ghi log truoc/sau. */
async function setSoLuongDaPhat({ maHs, codePrefix, soLuongMoi, nguoiPhat, ghiChu }) {
  const rs = await db.execute({
    sql: 'SELECT * FROM student_uniform_summary WHERE ma_hs = ? AND code_prefix = ?',
    args: [maHs, codePrefix],
  });
  const current = rs.rows[0];
  if (!current) return { ok: false, message: 'Học sinh chưa đăng ký loại trang phục này.' };

  const clamped = Math.max(0, Math.min(soLuongMoi, current.so_luong_dang_ky));
  if (clamped === current.so_luong_da_phat) return { ok: true, unchanged: true };

  await db.execute({
    sql: `UPDATE student_uniform_summary
          SET so_luong_da_phat = ?, ngay_phat_gan_nhat = datetime('now'), nguoi_phat_gan_nhat = ?
          WHERE ma_hs = ? AND code_prefix = ?`,
    args: [clamped, nguoiPhat, maHs, codePrefix],
  });

  await db.execute({
    sql: `INSERT INTO distribution_log (ma_hs, code_prefix, so_luong_truoc, so_luong_sau, nguoi_phat, ghi_chu)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [maHs, codePrefix, current.so_luong_da_phat, clamped, nguoiPhat, ghiChu || null],
  });

  return { ok: true, soLuongDaPhat: clamped };
}

/** Toggle nhanh: da phat du (= so luong dang ky) hoac chua phat (= 0). */
async function toggleFullyDelivered({ maHs, codePrefix, delivered, nguoiPhat }) {
  const rs = await db.execute({
    sql: 'SELECT so_luong_dang_ky FROM student_uniform_summary WHERE ma_hs = ? AND code_prefix = ?',
    args: [maHs, codePrefix],
  });
  const row = rs.rows[0];
  if (!row) return { ok: false, message: 'Học sinh chưa đăng ký loại trang phục này.' };
  const target = delivered ? row.so_luong_dang_ky : 0;
  return setSoLuongDaPhat({ maHs, codePrefix, soLuongMoi: target, nguoiPhat });
}

/** Phat hang loat cho ca lop (hoac danh sach ma_hs chi dinh) voi 1 loai trang phuc. */
async function bulkMarkDelivered({ maHsList, codePrefix, nguoiPhat }) {
  let soLuot = 0;
  for (const maHs of maHsList) {
    const result = await toggleFullyDelivered({ maHs, codePrefix, delivered: true, nguoiPhat });
    if (result.ok && !result.unchanged) soLuot += 1;
  }
  return { soLuot };
}

async function getMaHsListByLop(lop) {
  const rs = await db.execute({ sql: 'SELECT ma_hs FROM students WHERE lop = ?', args: [lop] });
  return rs.rows.map((r) => r.ma_hs);
}

/** Tien do phat tong the: tong dang ky vs tong da phat, theo tung loai trang phuc. */
async function getDistributionProgressByCategory() {
  const rs = await db.execute(`
    SELECT uc.code_prefix, uc.ten_hien_thi, uc.thu_tu,
           COALESCE(SUM(sus.so_luong_dang_ky), 0) AS tong_dang_ky,
           COALESCE(SUM(sus.so_luong_da_phat), 0) AS tong_da_phat
    FROM uniform_categories uc
    LEFT JOIN student_uniform_summary sus ON sus.code_prefix = uc.code_prefix
    WHERE uc.active = 1
    GROUP BY uc.code_prefix
    ORDER BY uc.thu_tu
  `);
  return rs.rows;
}

module.exports = {
  setSoLuongDaPhat,
  toggleFullyDelivered,
  bulkMarkDelivered,
  getMaHsListByLop,
  getDistributionProgressByCategory,
};
