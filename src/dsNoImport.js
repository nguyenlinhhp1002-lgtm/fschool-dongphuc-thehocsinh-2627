const ExcelJS = require('exceljs');
const { db } = require('./db');
const { ExcelValidationError, cellToString, cellToNumber, readHeaderRowTrimmed } = require('./excelHelpers');
const { getActiveCategories, getSizeGroupsMap } = require('./categoriesRepo');
const { getAllSummaryGrouped, getAllMeasurementsMap } = require('./summaryRepo');

const COT_CO_BAN = {
  maHs: 'Mã số học sinh',
  chieuCao: 'Chiều cao (cm)',
  canNang: 'Cân nặng (kg)',
  vongBung: 'Vòng bụng (cm)',
  daiChan: 'Chiều dài chân (cm)',
  gioiTinh: 'Giới tính',
  ghiChu: 'Ghi chú',
};

/**
 * Doc buffer file DS no da dien, doi chieu ten cot (khong dua vao vi tri) voi danh muc
 * trang phuc dang active. Tra ve danh sach dong tho + vi tri cac cot tim thay.
 */
async function parseDsNoExcelBuffer(buffer) {
  const [categories, sizeGroupsMap] = await Promise.all([getActiveCategories(), getSizeGroupsMap()]);

  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer);
  } catch (err) {
    throw new ExcelValidationError(['Không đọc được file. Vui lòng kiểm tra đây có đúng là file Excel (.xlsx) không.']);
  }

  const sheet = workbook.worksheets[0];
  if (!sheet || sheet.rowCount === 0) {
    throw new ExcelValidationError(['File Excel không có sheet dữ liệu nào.']);
  }

  const headerRow = readHeaderRowTrimmed(sheet);
  if (!headerRow.includes(COT_CO_BAN.maHs)) {
    throw new ExcelValidationError([`File thiếu cột bắt buộc: "${COT_CO_BAN.maHs}".`]);
  }

  const idx = {};
  Object.entries(COT_CO_BAN).forEach(([key, colName]) => {
    const i = headerRow.indexOf(colName);
    if (i >= 0) idx[key] = i;
  });

  // Danh muc thuoc 1 size_group dung chung cot size cua nhom (vd "Size chung"); danh muc
  // khong thuoc nhom nao dung cot size rieng cua no nhu truoc.
  const catCols = categories.map((cat) => {
    const group = cat.size_group_code ? sizeGroupsMap.get(cat.size_group_code) : null;
    const sizeColName = group ? group.cot_size : cat.cot_size;
    return {
      codePrefix: cat.code_prefix,
      coSize: cat.co_size,
      slIdx: headerRow.indexOf(cat.cot_sl),
      sizeIdx: cat.co_size && sizeColName ? headerRow.indexOf(sizeColName) : -1,
    };
  });

  const rows = [];
  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const values = row.values || [];
    const isBlankRow = values.every((cell) => cellToString(cell) === '');
    if (isBlankRow) continue;

    const maHs = cellToString(values[idx.maHs]);
    if (!maHs) continue;

    const item = {
      rowNumber,
      maHs,
      chieuCao: idx.chieuCao !== undefined ? cellToNumber(values[idx.chieuCao]) : null,
      canNang: idx.canNang !== undefined ? cellToNumber(values[idx.canNang]) : null,
      vongBung: idx.vongBung !== undefined ? cellToNumber(values[idx.vongBung]) : null,
      daiChan: idx.daiChan !== undefined ? cellToNumber(values[idx.daiChan]) : null,
      gioiTinh: idx.gioiTinh !== undefined ? cellToString(values[idx.gioiTinh]) || null : null,
      ghiChu: idx.ghiChu !== undefined ? cellToString(values[idx.ghiChu]) || null : null,
      categories: [],
    };

    for (const cc of catCols) {
      if (cc.slIdx < 0) continue;
      const slValue = cellToNumber(values[cc.slIdx]);
      const sizeValue = cc.sizeIdx >= 0 ? cellToString(values[cc.sizeIdx]) : '';
      item.categories.push({
        codePrefix: cc.codePrefix,
        soLuongFile: slValue,
        size: sizeValue || null,
      });
    }

    rows.push(item);
  }

  if (rows.length === 0) {
    throw new ExcelValidationError(['File không có dòng dữ liệu hợp lệ nào (thiếu "Mã số học sinh" ở mọi dòng).']);
  }

  return { rows, categories: catCols };
}

/** So sanh voi du lieu he thong dang co, tra ve danh sach thay doi so luong (de admin xem truoc khi xac nhan). */
async function tinhChenhLechSoLuong(rows) {
  const grouped = await getAllSummaryGrouped();
  const changes = [];
  for (const item of rows) {
    const summaryByCode = grouped.get(item.maHs) || new Map();
    for (const cat of item.categories) {
      if (cat.soLuongFile === null) continue;
      const current = summaryByCode.get(cat.codePrefix);
      const soLuongHeThong = current ? current.so_luong_dang_ky : 0;
      if (cat.soLuongFile !== soLuongHeThong) {
        changes.push({
          maHs: item.maHs,
          codePrefix: cat.codePrefix,
          soLuongCu: soLuongHeThong,
          soLuongMoi: cat.soLuongFile,
        });
      }
    }
  }
  return changes;
}

/**
 * Ghi nhan toan bo du lieu file DS no da duyet: cap nhat so do co the (student_measurements),
 * cap nhat size + (neu co) ghi de so luong cho tung loai trang phuc (student_uniform_summary),
 * log lai moi thay doi so luong vao audit_log.
 */
async function commitDsNoImport({ rows, adminUsername }) {
  const statements = [];

  for (const item of rows) {
    statements.push({
      sql: `INSERT INTO student_measurements (ma_hs, chieu_cao_cm, can_nang_kg, vong_bung_cm, dai_chan_cm, gioi_tinh, ghi_chu, updated_at, updated_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)
            ON CONFLICT(ma_hs) DO UPDATE SET
              chieu_cao_cm = ?, can_nang_kg = ?, vong_bung_cm = ?, dai_chan_cm = ?, gioi_tinh = ?, ghi_chu = ?,
              updated_at = datetime('now'), updated_by = ?`,
      args: [
        item.maHs, item.chieuCao, item.canNang, item.vongBung, item.daiChan, item.gioiTinh, item.ghiChu, adminUsername,
        item.chieuCao, item.canNang, item.vongBung, item.daiChan, item.gioiTinh, item.ghiChu, adminUsername,
      ],
    });

    for (const cat of item.categories) {
      if (cat.soLuongFile === null && !cat.size) continue;
      statements.push({
        sql: `INSERT INTO student_uniform_summary (ma_hs, code_prefix, so_luong_dang_ky, size, updated_at)
              VALUES (?, ?, ?, ?, datetime('now'))
              ON CONFLICT(ma_hs, code_prefix) DO UPDATE SET
                so_luong_dang_ky = COALESCE(?, so_luong_dang_ky),
                size = COALESCE(?, size),
                updated_at = datetime('now')`,
        args: [
          item.maHs, cat.codePrefix, cat.soLuongFile ?? 0, cat.size,
          cat.soLuongFile, cat.size,
        ],
      });
    }
  }

  if (statements.length > 0) {
    await db.batch(statements, 'write');
  }
}

// Ghi audit_log rieng cho cac thay doi so luong PHAT HIEN TRUOC KHI GHI (goi truoc commitDsNoImport).
async function ghiAuditSoLuong(changes, adminUsername) {
  if (changes.length === 0) return;
  const statements = changes.map((c) => ({
    sql: `INSERT INTO audit_log (bang, khoa_chinh, truong, gia_tri_cu, gia_tri_moi, nguoi_sua)
          VALUES ('student_uniform_summary', ?, 'so_luong_dang_ky', ?, ?, ?)`,
    args: [`${c.maHs}/${c.codePrefix}`, String(c.soLuongCu), String(c.soLuongMoi), adminUsername],
  }));
  await db.batch(statements, 'write');
}

async function logDsNoUpload({ adminUsername, filename, tongDong, soDongSuaSoLuong }) {
  await db.execute({
    sql: `INSERT INTO ds_no_uploads (nguoi_upload, ten_file, tong_dong, so_dong_sua_so_luong) VALUES (?, ?, ?, ?)`,
    args: [adminUsername, filename, tongDong, soDongSuaSoLuong],
  });
}

async function getDsNoUploadHistory() {
  const rs = await db.execute('SELECT * FROM ds_no_uploads ORDER BY uploaded_at DESC, id DESC LIMIT 30');
  return rs.rows;
}

module.exports = {
  parseDsNoExcelBuffer,
  tinhChenhLechSoLuong,
  commitDsNoImport,
  ghiAuditSoLuong,
  logDsNoUpload,
  getDsNoUploadHistory,
  COT_CO_BAN,
};
