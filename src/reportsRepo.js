const { db } = require('./db');
const { getActiveCategories } = require('./categoriesRepo');
const { countStudentsMissingSize } = require('./summaryRepo');

async function getDashboardOverview() {
  const [hsRs, tongRs, thieuSize, hocSinhDangHocRs] = await Promise.all([
    db.execute(`SELECT COUNT(DISTINCT ma_hs) AS c FROM student_uniform_summary WHERE so_luong_dang_ky > 0`),
    db.execute(`SELECT COALESCE(SUM(so_luong_dang_ky),0) AS tong_mon, COALESCE(SUM(so_luong_da_phat),0) AS tong_da_phat FROM student_uniform_summary`),
    countStudentsMissingSize(),
    db.execute(`SELECT COUNT(*) AS c FROM students WHERE trang_thai_hoc = 'Đang học'`),
  ]);
  const tong = tongRs.rows[0];
  return {
    tongHocSinhDangKy: Number(hsRs.rows[0].c),
    tongHocSinhToanTruong: Number(hocSinhDangHocRs.rows[0].c),
    tongMonDangKy: Number(tong.tong_mon),
    tongMonDaPhat: Number(tong.tong_da_phat),
    tongMonChuaPhat: Number(tong.tong_mon) - Number(tong.tong_da_phat),
    tyLeDaPhat: Number(tong.tong_mon) > 0 ? Number(tong.tong_da_phat) / Number(tong.tong_mon) : 0,
    soHocSinhThieuSize: thieuSize,
  };
}

/** Tong SL dang ky / da phat theo tung loai trang phuc - dung cho bieu do trang chu. */
async function getCategoryTotals() {
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

/**
 * Bang loai trang phuc x size: { code_prefix -> Map(size -> so_luong) }.
 * batchId (neu co): chi tinh cac hoc sinh co dong gop dang ky trong dot do (xem ghi chu trong README).
 */
async function getCategorySizeMatrix({ khoi, lop, batchId } = {}) {
  let maHsFilter = null;
  if (batchId) {
    const rs = await db.execute({
      sql: 'SELECT DISTINCT ma_hs FROM registration_items WHERE batch_id = ? AND tinh_vao_so_lieu = 1',
      args: [batchId],
    });
    maHsFilter = new Set(rs.rows.map((r) => r.ma_hs));
  }

  const where = [`s.trang_thai_hoc = 'Đang học'`, 'sus.so_luong_dang_ky > 0'];
  const args = [];
  if (khoi) {
    where.push('s.khoi = ?');
    args.push(khoi);
  }
  if (lop) {
    where.push('s.lop = ?');
    args.push(lop);
  }

  const rs = await db.execute({
    sql: `SELECT sus.ma_hs, sus.code_prefix, sus.size, sus.so_luong_dang_ky
          FROM student_uniform_summary sus
          JOIN students s ON s.ma_hs = sus.ma_hs
          WHERE ${where.join(' AND ')}`,
    args,
  });

  const matrix = new Map();
  const sizesByCategory = new Map();
  for (const row of rs.rows) {
    if (maHsFilter && !maHsFilter.has(row.ma_hs)) continue;
    const sizeKey = row.size && String(row.size).trim() ? String(row.size).trim() : '(chưa có size)';
    if (!matrix.has(row.code_prefix)) {
      matrix.set(row.code_prefix, new Map());
      sizesByCategory.set(row.code_prefix, new Set());
    }
    const m = matrix.get(row.code_prefix);
    m.set(sizeKey, (m.get(sizeKey) || 0) + row.so_luong_dang_ky);
    sizesByCategory.get(row.code_prefix).add(sizeKey);
  }
  return { matrix, sizesByCategory };
}

/** Tong so luong dang ky theo loai trang phuc, gom nhom theo lop / khoi / dot dang ky. */
async function getTotalsByGroup(groupBy) {
  if (groupBy === 'batch') {
    const rs = await db.execute(`
      SELECT rb.ten_dot AS nhom, ri.code_prefix, SUM(ri.so_luong) AS so_luong
      FROM registration_items ri
      JOIN registration_batches rb ON rb.id = ri.batch_id
      WHERE ri.tinh_vao_so_lieu = 1
      GROUP BY rb.id, ri.code_prefix
      ORDER BY rb.id
    `);
    return rs.rows;
  }

  const col = groupBy === 'khoi' ? 's.khoi' : 's.lop';
  const rs = await db.execute(`
    SELECT ${col} AS nhom, sus.code_prefix, SUM(sus.so_luong_dang_ky) AS so_luong
    FROM student_uniform_summary sus
    JOIN students s ON s.ma_hs = sus.ma_hs
    WHERE s.trang_thai_hoc = 'Đang học' AND sus.so_luong_dang_ky > 0
    GROUP BY ${col}, sus.code_prefix
    ORDER BY ${col}
  `);
  return rs.rows;
}

/** Tien do phat (dang ky vs da phat) gom nhom theo lop / khoi / loai trang phuc. */
async function getProgressByGroup(groupBy) {
  const col = groupBy === 'khoi' ? 's.khoi' : groupBy === 'code' ? 'sus.code_prefix' : 's.lop';
  const rs = await db.execute(`
    SELECT ${col} AS nhom, sus.code_prefix,
           SUM(sus.so_luong_dang_ky) AS tong_dang_ky,
           SUM(sus.so_luong_da_phat) AS tong_da_phat
    FROM student_uniform_summary sus
    JOIN students s ON s.ma_hs = sus.ma_hs
    WHERE s.trang_thai_hoc = 'Đang học' AND sus.so_luong_dang_ky > 0
    GROUP BY ${col}${groupBy === 'code' ? '' : ', sus.code_prefix'}
    ORDER BY nhom
  `);
  return rs.rows;
}

module.exports = {
  getDashboardOverview,
  getCategoryTotals,
  getCategorySizeMatrix,
  getTotalsByGroup,
  getProgressByGroup,
};
