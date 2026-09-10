const { db } = require('./db');
const { getAllStudentsMap } = require('./studentsRepo');

function taoUniqueKey(maHs, ngayDangKyRaw, soTien) {
  return `${maHs}|${ngayDangKyRaw}|${soTien}`.trim();
}

/** Doi chieu ma hoc sinh voi danh sach toan truong, tra ve rows kem co khop hay khong. */
async function resolveCardRows(rawRows) {
  const studentsMap = await getAllStudentsMap();
  return rawRows.map((r) => {
    const student = studentsMap.get(r.maHs) || null;
    return {
      ...r,
      hoTenChinhThuc: student ? student.ho_ten : null,
      lopChinhThuc: student ? student.lop : null,
      khopMaHs: Boolean(student),
      uniqueKey: taoUniqueKey(r.maHs, r.ngayDangKyRaw, r.soTien),
    };
  });
}

async function getExistingUniqueKeys(keys) {
  const existing = new Set();
  const chunkSize = 400;
  for (let i = 0; i < keys.length; i += chunkSize) {
    const chunk = keys.slice(i, i + chunkSize);
    const placeholders = chunk.map(() => '?').join(',');
    const rs = await db.execute({
      sql: `SELECT unique_key FROM card_registration_items WHERE unique_key IN (${placeholders})`,
      args: chunk,
    });
    for (const row of rs.rows) existing.add(row.unique_key);
  }
  return existing;
}

/**
 * Ghi nhan 1 lan upload file dang ky the (da doi chieu). Dong voi ma HS khong khop van duoc
 * luu (de admin xu ly), nhung khong tinh vao thong ke cho den khi sua lai ma HS.
 * Bo qua dong trung unique_key (ma_hs + ngay dang ky + so tien) - dem lai de bao cao.
 */
async function commitCardImport({ resolvedRows, adminUsername, filename }) {
  const soLoiMaHs = resolvedRows.filter((r) => !r.khopMaHs).length;

  const uploadResult = await db.execute({
    sql: `INSERT INTO card_uploads (nguoi_upload, ten_file, tong_dong, so_dong_loi) VALUES (?, ?, ?, ?)`,
    args: [adminUsername, filename, resolvedRows.length, soLoiMaHs],
  });
  const uploadId = Number(uploadResult.lastInsertRowid);

  const existingKeys = await getExistingUniqueKeys(resolvedRows.map((r) => r.uniqueKey));
  const statements = [];
  let soDongTrung = 0;

  for (const r of resolvedRows) {
    if (existingKeys.has(r.uniqueKey)) {
      soDongTrung += 1;
      continue;
    }
    statements.push({
      sql: `INSERT INTO card_registration_items
              (upload_id, ma_hs, co_the, co_day, so_tien, ngay_dang_ky, dot_dang_ky, trang_thai, unique_key)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'dang_tien_hanh', ?)`,
      args: [uploadId, r.maHs, r.coThe ? 1 : 0, r.coDay ? 1 : 0, r.soTien, r.ngayDangKyRaw || null, r.dotDangKy || null, r.uniqueKey],
    });
  }

  if (statements.length > 0) {
    await db.batch(statements, 'write');
  }

  return { uploadId, soDongTrung, soDongDaGhi: statements.length, soLoiMaHs, tongDong: resolvedRows.length };
}

async function getCardUploadHistory() {
  const rs = await db.execute('SELECT * FROM card_uploads ORDER BY uploaded_at DESC, id DESC LIMIT 30');
  return rs.rows;
}

/** Danh sach dong dang ky the (moi dong la 1 lan dang ky/cap lai), kem thong tin hoc sinh, co loc. */
async function searchCardItems({ q = '', lop = '', khoi = '', trangThai = '', page = 1, pageSize = 50 } = {}) {
  const where = [];
  const args = [];
  if (lop) {
    where.push('s.lop = ?');
    args.push(lop);
  }
  if (khoi) {
    where.push('s.khoi = ?');
    args.push(khoi);
  }
  if (trangThai) {
    where.push('ci.trang_thai = ?');
    args.push(trangThai);
  }
  if (q) {
    where.push('(ci.ma_hs LIKE ? OR s.ho_ten LIKE ?)');
    args.push(`%${q}%`, `%${q}%`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const countRs = await db.execute({
    sql: `SELECT COUNT(*) AS c FROM card_registration_items ci LEFT JOIN students s ON s.ma_hs = ci.ma_hs ${whereSql}`,
    args,
  });
  const total = Number(countRs.rows[0].c);

  const offset = (page - 1) * pageSize;
  const rs = await db.execute({
    sql: `
      SELECT ci.*, s.ho_ten, s.lop, s.khoi
      FROM card_registration_items ci
      LEFT JOIN students s ON s.ma_hs = ci.ma_hs
      ${whereSql}
      ORDER BY ci.created_at DESC, ci.id DESC
      LIMIT ? OFFSET ?
    `,
    args: [...args, pageSize, offset],
  });
  return { rows: rs.rows, total, page, pageSize };
}

async function updateCardItem(id, { coThe, coDay, trangThai, adminUsername }) {
  const sets = [];
  const args = [];
  if (coThe !== undefined) {
    sets.push('co_the = ?');
    args.push(coThe ? 1 : 0);
  }
  if (coDay !== undefined) {
    sets.push('co_day = ?');
    args.push(coDay ? 1 : 0);
  }
  if (trangThai !== undefined) {
    sets.push('trang_thai = ?');
    args.push(trangThai);
  }
  if (sets.length === 0) return;
  sets.push('nguoi_cap_nhat = ?');
  args.push(adminUsername);
  args.push(id);
  await db.execute({ sql: `UPDATE card_registration_items SET ${sets.join(', ')} WHERE id = ?`, args });
}

async function getCardStats() {
  const rs = await db.execute(`
    SELECT
      COUNT(*) AS tong_dong,
      COUNT(DISTINCT ma_hs) AS tong_hoc_sinh,
      SUM(CASE WHEN trang_thai = 'da_tra' THEN 1 ELSE 0 END) AS da_tra,
      SUM(CASE WHEN trang_thai = 'dang_tien_hanh' THEN 1 ELSE 0 END) AS dang_tien_hanh,
      SUM(co_day) AS tong_day
    FROM card_registration_items
  `);
  const row = rs.rows[0];
  return {
    tongDong: Number(row.tong_dong),
    tongHocSinh: Number(row.tong_hoc_sinh),
    daTra: Number(row.da_tra || 0),
    dangTienHanh: Number(row.dang_tien_hanh || 0),
    tongDay: Number(row.tong_day || 0),
  };
}

/** Thong ke dang ky the theo lop hoac khoi: tong luot, da tra, dang tien hanh, tong co day. */
async function getProgressByGroup(groupBy) {
  const col = groupBy === 'khoi' ? 's.khoi' : 's.lop';
  const rs = await db.execute(`
    SELECT ${col} AS nhom,
           COUNT(*) AS tong_luot,
           SUM(CASE WHEN ci.trang_thai = 'da_tra' THEN 1 ELSE 0 END) AS da_tra,
           SUM(CASE WHEN ci.trang_thai = 'dang_tien_hanh' THEN 1 ELSE 0 END) AS dang_tien_hanh,
           SUM(ci.co_day) AS tong_day
    FROM card_registration_items ci
    JOIN students s ON s.ma_hs = ci.ma_hs
    WHERE ${col} IS NOT NULL
    GROUP BY ${col}
    ORDER BY ${col}
  `);
  return rs.rows;
}

module.exports = {
  resolveCardRows,
  commitCardImport,
  getCardUploadHistory,
  getProgressByGroup,
  searchCardItems,
  updateCardItem,
  getCardStats,
  taoUniqueKey,
};
