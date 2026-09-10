const { db } = require('./db');
const { buildMonMatcher } = require('./categoriesRepo');
const { getAllStudentsMap } = require('./studentsRepo');
const { parseDateVN, formatDateVN } = require('./excelHelpers');

const NGUONG_GIA_BAT_THUONG = 900000;

function taoUniqueKey(rollNumber, monRaw, paymentDate) {
  return `${rollNumber}|${monRaw}|${paymentDate}`.trim();
}

/**
 * Doi chieu tung dong tho (tu registrationImport) voi danh sach hoc sinh + danh muc trang phuc.
 * Khong dung DB o day (nhan matcher + studentsMap da nap san) de xu ly nhanh hang loat.
 */
function resolveRows(rawRows, { matchMon, studentsMap }) {
  return rawRows.map((r) => {
    const student = studentsMap.get(r.rollNumber) || null;
    const { codePrefix, matched, viaPrefixCode } = matchMon(r.monCore);
    const daThanhToan = r.trangThaiThanhToan.trim() === 'Thanh toán';
    const soLuong = Number.isFinite(r.soLuong) ? r.soLuong : 0;

    let trangThaiDongBo = 'ok';
    if (!student) trangThaiDongBo = 'loi_ma_hs';
    else if (!matched) trangThaiDongBo = 'loi_loai_trang_phuc';
    else if (viaPrefixCode) trangThaiDongBo = 'can_kiem_tra_bat_thuong';
    else if (r.donGia && r.donGia > NGUONG_GIA_BAT_THUONG) trangThaiDongBo = 'can_kiem_tra_bat_thuong';

    const tinhVaoSoLieu = Boolean(student && matched && daThanhToan && soLuong > 0);

    const parsedDate = parseDateVN(r.paymentDate);

    return {
      ...r,
      maHs: r.rollNumber,
      hoTenChinhThuc: student ? student.ho_ten : null,
      lopChinhThuc: student ? student.lop : null,
      codePrefix,
      daThanhToan,
      soLuong,
      trangThaiDongBo,
      tinhVaoSoLieu,
      ngayThanhToanIso: parsedDate ? parsedDate.toISOString().slice(0, 10) : null,
      ngayThanhToanHienThi: parsedDate ? formatDateVN(parsedDate) : r.paymentDate,
      uniqueKey: taoUniqueKey(r.rollNumber, r.monRaw, r.paymentDate),
    };
  });
}

async function resolveRegistrationRows(rawRows) {
  const [matchMon, studentsMap] = await Promise.all([buildMonMatcher(), getAllStudentsMap()]);
  return resolveRows(rawRows, { matchMon, studentsMap });
}

function tomTatKetQua(resolvedRows) {
  return {
    tongDong: resolvedRows.length,
    soDongOk: resolvedRows.filter((r) => r.trangThaiDongBo === 'ok').length,
    soDongLoiMaHs: resolvedRows.filter((r) => r.trangThaiDongBo === 'loi_ma_hs').length,
    soDongLoiLoaiTrangPhuc: resolvedRows.filter((r) => r.trangThaiDongBo === 'loi_loai_trang_phuc').length,
    soDongBatThuong: resolvedRows.filter((r) => r.trangThaiDongBo === 'can_kiem_tra_bat_thuong').length,
    soDongKhongThanhToan: resolvedRows.filter((r) => !r.daThanhToan).length,
    soDongTinhVaoSoLieu: resolvedRows.filter((r) => r.tinhVaoSoLieu).length,
  };
}

async function getExistingUniqueKeys(keys) {
  const existing = new Set();
  const chunkSize = 400;
  for (let i = 0; i < keys.length; i += chunkSize) {
    const chunk = keys.slice(i, i + chunkSize);
    const placeholders = chunk.map(() => '?').join(',');
    const rs = await db.execute({
      sql: `SELECT unique_key FROM registration_items WHERE unique_key IN (${placeholders})`,
      args: chunk,
    });
    for (const row of rs.rows) existing.add(row.unique_key);
  }
  return existing;
}

const INSERT_ITEM_SQL = `
  INSERT INTO registration_items (
    upload_id, batch_id, ma_hs, ten_raw, mon_raw, size_raw, code_prefix,
    so_luong, don_gia, tong_tien, ngay_thanh_toan, thang, email,
    trang_thai_thanh_toan, tinh_vao_so_lieu, trang_thai_dong_bo, unique_key
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

/**
 * Ghi 1 lan upload dang ky da duyet (resolved rows + nhan dot da xac nhan) vao DB:
 * - Bo qua cac dong trung unique_key (da nhap truoc do) - dem lai de bao cao.
 * - Cong don so luong (chi cac dong tinhVaoSoLieu) vao student_uniform_summary.
 */
async function commitRegistrationImport({ resolvedRows, batchId, adminUsername, filename }) {
  const tomTat = tomTatKetQua(resolvedRows);

  const uploadResult = await db.execute({
    sql: `INSERT INTO registration_uploads
            (batch_id, nguoi_upload, ten_file, tong_dong, so_dong_loi, so_dong_bat_thuong, so_dong_bo_qua_tt)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [
      batchId,
      adminUsername,
      filename,
      tomTat.tongDong,
      tomTat.soDongLoiMaHs + tomTat.soDongLoiLoaiTrangPhuc,
      tomTat.soDongBatThuong,
      tomTat.soDongKhongThanhToan,
    ],
  });
  const uploadId = Number(uploadResult.lastInsertRowid);

  const existingKeys = await getExistingUniqueKeys(resolvedRows.map((r) => r.uniqueKey));

  const statements = [];
  const aggMap = new Map();
  let soDongTrung = 0;

  for (const r of resolvedRows) {
    if (existingKeys.has(r.uniqueKey)) {
      soDongTrung += 1;
      continue;
    }
    statements.push({
      sql: INSERT_ITEM_SQL,
      args: [
        uploadId,
        batchId,
        r.maHs,
        r.ten || null,
        r.monRaw,
        r.sizeRaw || null,
        r.codePrefix,
        r.soLuong,
        r.donGia,
        r.tongTien,
        r.ngayThanhToanIso,
        r.thang || null,
        r.email || null,
        r.trangThaiThanhToan,
        r.tinhVaoSoLieu ? 1 : 0,
        r.trangThaiDongBo,
        r.uniqueKey,
      ],
    });
    if (r.tinhVaoSoLieu) {
      const key = `${r.maHs}|${r.codePrefix}`;
      aggMap.set(key, (aggMap.get(key) || 0) + r.soLuong);
    }
  }

  if (statements.length > 0) {
    await db.batch(statements, 'write');
  }

  const summaryStatements = [];
  for (const [key, qty] of aggMap.entries()) {
    const [maHs, codePrefix] = key.split('|');
    summaryStatements.push({
      sql: `INSERT INTO student_uniform_summary (ma_hs, code_prefix, so_luong_dang_ky, updated_at)
            VALUES (?, ?, ?, datetime('now'))
            ON CONFLICT(ma_hs, code_prefix) DO UPDATE SET
              so_luong_dang_ky = so_luong_dang_ky + excluded.so_luong_dang_ky,
              updated_at = datetime('now')`,
      args: [maHs, codePrefix, qty],
    });
  }
  if (summaryStatements.length > 0) {
    await db.batch(summaryStatements, 'write');
  }

  return { uploadId, soDongTrung, soDongDaGhi: statements.length, ...tomTat };
}

async function getRegistrationUploadHistory() {
  const rs = await db.execute(`
    SELECT ru.*, rb.ten_dot
    FROM registration_uploads ru
    LEFT JOIN registration_batches rb ON rb.id = ru.batch_id
    ORDER BY ru.uploaded_at DESC, ru.id DESC
    LIMIT 50
  `);
  return rs.rows;
}

/** Danh sach dong dang ky can xu ly thu cong (loi ma hs / loi loai trang phuc / bat thuong), co phan trang. */
async function getIssueRows({ page = 1, pageSize = 50 } = {}) {
  const where = `trang_thai_dong_bo != 'ok'`;
  const countRs = await db.execute(`SELECT COUNT(*) AS c FROM registration_items WHERE ${where}`);
  const total = Number(countRs.rows[0].c);
  const offset = (page - 1) * pageSize;
  const rs = await db.execute({
    sql: `SELECT ri.*, rb.ten_dot
          FROM registration_items ri
          LEFT JOIN registration_batches rb ON rb.id = ri.batch_id
          WHERE ${where}
          ORDER BY ri.created_at DESC, ri.id DESC
          LIMIT ? OFFSET ?`,
    args: [pageSize, offset],
  });
  return { rows: rs.rows, total, page, pageSize };
}

/** Cap nhat lai ma hoc sinh / loai trang phuc cho 1 dong dang ky loi (xu ly thu cong), rieng le. */
async function fixRegistrationItem(id, { maHs, codePrefix }) {
  const rs = await db.execute({ sql: 'SELECT * FROM registration_items WHERE id = ?', args: [id] });
  const item = rs.rows[0];
  if (!item) return { ok: false, message: 'Không tìm thấy dòng đăng ký.' };

  const newMaHs = maHs || item.ma_hs;
  const newCodePrefix = codePrefix || item.code_prefix;

  let student = null;
  if (newMaHs) {
    const sRs = await db.execute({ sql: 'SELECT * FROM students WHERE ma_hs = ?', args: [newMaHs] });
    student = sRs.rows[0] || null;
  }
  const daThanhToan = item.trang_thai_thanh_toan === 'Thanh toán';
  const tinhVaoSoLieu = Boolean(student && newCodePrefix && daThanhToan && item.so_luong > 0);
  const trangThaiDongBo = !student ? 'loi_ma_hs' : !newCodePrefix ? 'loi_loai_trang_phuc' : 'ok';

  await db.execute({
    sql: `UPDATE registration_items
          SET ma_hs = ?, code_prefix = ?, tinh_vao_so_lieu = ?, trang_thai_dong_bo = ?
          WHERE id = ?`,
    args: [newMaHs, newCodePrefix, tinhVaoSoLieu ? 1 : 0, trangThaiDongBo, id],
  });

  // Neu truoc do chua tinh vao so lieu, gio da tinh duoc -> cong vao summary.
  if (tinhVaoSoLieu && !item.tinh_vao_so_lieu) {
    await db.execute({
      sql: `INSERT INTO student_uniform_summary (ma_hs, code_prefix, so_luong_dang_ky, updated_at)
            VALUES (?, ?, ?, datetime('now'))
            ON CONFLICT(ma_hs, code_prefix) DO UPDATE SET
              so_luong_dang_ky = so_luong_dang_ky + excluded.so_luong_dang_ky,
              updated_at = datetime('now')`,
      args: [newMaHs, newCodePrefix, item.so_luong],
    });
  }

  return { ok: true, trangThaiDongBo };
}

/** Danh sach cac dot dang ky da dong gop so luong cho 1 hoc sinh (dung khi xuat DS no). */
async function getBatchLabelsForStudent(maHs) {
  const rs = await db.execute({
    sql: `SELECT DISTINCT rb.ten_dot, rb.id
          FROM registration_items ri
          JOIN registration_batches rb ON rb.id = ri.batch_id
          WHERE ri.ma_hs = ? AND ri.tinh_vao_so_lieu = 1
          ORDER BY rb.id`,
    args: [maHs],
  });
  return rs.rows.map((r) => r.ten_dot);
}

/** Gom nhom: voi moi hoc sinh, danh sach ten dot da dong gop (dung cho export DS no hang loat). */
async function getBatchLabelsForAllStudents() {
  const rs = await db.execute(`
    SELECT ri.ma_hs, rb.ten_dot, rb.id AS batch_id
    FROM registration_items ri
    JOIN registration_batches rb ON rb.id = ri.batch_id
    WHERE ri.tinh_vao_so_lieu = 1
    GROUP BY ri.ma_hs, rb.id
    ORDER BY ri.ma_hs, rb.id
  `);
  const map = new Map();
  for (const row of rs.rows) {
    if (!map.has(row.ma_hs)) map.set(row.ma_hs, []);
    map.get(row.ma_hs).push(row.ten_dot);
  }
  return map;
}

/** Tap hop ma_hs cua cac hoc sinh co dong gop so luong (tinh_vao_so_lieu=1) trong 1 dot dang ky. */
async function getMaHsSetForBatch(batchId) {
  const rs = await db.execute({
    sql: 'SELECT DISTINCT ma_hs FROM registration_items WHERE batch_id = ? AND tinh_vao_so_lieu = 1',
    args: [batchId],
  });
  return new Set(rs.rows.map((r) => r.ma_hs));
}

module.exports = {
  resolveRegistrationRows,
  tomTatKetQua,
  commitRegistrationImport,
  getMaHsSetForBatch,
  getRegistrationUploadHistory,
  getIssueRows,
  fixRegistrationItem,
  getBatchLabelsForStudent,
  getBatchLabelsForAllStudents,
  taoUniqueKey,
};
