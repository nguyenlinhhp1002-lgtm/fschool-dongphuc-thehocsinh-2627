const ExcelJS = require('exceljs');
const { db } = require('./db');
const { ExcelValidationError, cellToString, cellToNumber, readHeaderRowTrimmed, findColumnIndex } = require('./excelHelpers');
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
  if (findColumnIndex(headerRow, COT_CO_BAN.maHs) < 0) {
    throw new ExcelValidationError([`File thiếu cột bắt buộc: "${COT_CO_BAN.maHs}".`]);
  }

  const idx = {};
  Object.entries(COT_CO_BAN).forEach(([key, colName]) => {
    const i = findColumnIndex(headerRow, colName);
    if (i >= 0) idx[key] = i;
  });

  // Danh muc thuoc 1 size_group dung chung cot size cua nhom (vd "Size chung"); danh muc
  // khong thuoc nhom nao dung cot size rieng cua no nhu truoc. So khop ten cot qua
  // findColumnIndex (khong phan biet hoa/thuong, khoang trang thua, dang Unicode NFC/NFD)
  // thay vi so sanh chuoi tuyet doi, vi 2 chuoi "giong het" khi nhin co the khac nhau ve byte
  // (vd file tao tren may/ung dung khac).
  const catCols = categories.map((cat) => {
    const group = cat.size_group_code ? sizeGroupsMap.get(cat.size_group_code) : null;
    const sizeColName = group ? group.cot_size : cat.cot_size;
    return {
      codePrefix: cat.code_prefix,
      tenHienThi: cat.ten_hien_thi,
      coSize: cat.co_size,
      cotSl: cat.cot_sl,
      cotSize: sizeColName,
      slIdx: findColumnIndex(headerRow, cat.cot_sl),
      sizeIdx: cat.co_size && sizeColName ? findColumnIndex(headerRow, sizeColName) : -1,
    };
  });

  // Neu ten cot trong file khong khop voi mau hien tai (file cu, danh muc da doi ten cot...),
  // cot do se bi bo qua AM THAM cho MOI dong neu khong kiem tra - canh bao ro thay vi de
  // size/so luong bi mat ma khong ai biet.
  const cotThieu = [];
  for (const cc of catCols) {
    if (cc.slIdx < 0) cotThieu.push(`"${cc.cotSl}" (SL ${cc.tenHienThi})`);
    else if (cc.coSize && cc.cotSize && cc.sizeIdx < 0) cotThieu.push(`"${cc.cotSize}" (Size ${cc.tenHienThi})`);
  }
  if (cotThieu.length > 0) {
    throw new ExcelValidationError([
      `File không khớp với mẫu hiện tại — thiếu các cột: ${[...new Set(cotThieu)].join(', ')}.`,
      'Có thể file đang dùng là bản mẫu cũ, hoặc tên cột trong "Danh mục" đã được đổi. Vui lòng tải lại file mẫu mới nhất (nút "Tải file DS đăng ký có size" ở trang này) rồi điền lại.',
    ]);
  }

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

/**
 * Nguyen tac: danh sach hoc sinh dang ky + so luong tung loai CHI duoc ghi nhan tu file
 * "Tai file dang ky" ban dau (xuat truc tiep tu he thong dong phi, chinh xac). File "DS co
 * size" chi dung de dien size/so do co the ben ngoai he thong - neu vo tinh sua so luong hay
 * thieu/thua dong khi thao tac (tai xuong -> dien tay -> tai len), KHONG duoc tu y ap dung
 * lai vao he thong. Ham nay doi chieu file voi du lieu goc, phan loai thanh 2 nhom bat thuong
 * (KHONG ap dung gi, chi de bao cao cho admin tu kiem tra doi chieu):
 *  - 'sai_so_luong': hoc sinh DA dang ky loai nay, nhung so luong trong file khac he thong.
 *  - 'khong_co_dang_ky': file co du lieu (SL hoac size) cho 1 loai ma hoc sinh CHUA dang ky.
 */
async function phanLoaiDoiChieu(rows) {
  const grouped = await getAllSummaryGrouped();
  const saiSoLuong = [];
  const khongCoDangKy = [];

  for (const item of rows) {
    const summaryByCode = grouped.get(item.maHs) || new Map();
    for (const cat of item.categories) {
      const current = summaryByCode.get(cat.codePrefix);
      if (current) {
        if (cat.soLuongFile !== null && cat.soLuongFile !== current.so_luong_dang_ky) {
          saiSoLuong.push({
            maHs: item.maHs,
            codePrefix: cat.codePrefix,
            soLuongHeThong: current.so_luong_dang_ky,
            soLuongFile: cat.soLuongFile,
            sizeFile: cat.size,
          });
        }
      } else if ((cat.soLuongFile !== null && cat.soLuongFile > 0) || cat.size) {
        khongCoDangKy.push({
          maHs: item.maHs,
          codePrefix: cat.codePrefix,
          soLuongFile: cat.soLuongFile,
          sizeFile: cat.size,
        });
      }
    }
  }

  return { saiSoLuong, khongCoDangKy };
}

/** Tap hop khoa "maHs|codePrefix" can BO QUA khi ghi nhan (thuoc 1 trong 2 nhom bat thuong o tren). */
function taoTapKhoaBoQua({ saiSoLuong, khongCoDangKy }) {
  const set = new Set();
  for (const a of saiSoLuong) set.add(`${a.maHs}|${a.codePrefix}`);
  for (const a of khongCoDangKy) set.add(`${a.maHs}|${a.codePrefix}`);
  return set;
}

/** Dem so o size (khac rong) doc duoc trong file - hien thi tren man hinh xem truoc de xac nhan da doc duoc size, khong phai import "khong lam gi". */
function demSoOCoSize(rows) {
  let count = 0;
  for (const item of rows) {
    for (const cat of item.categories) {
      if (cat.size) count += 1;
    }
  }
  return count;
}

/**
 * Ghi nhan toan bo du lieu file DS no da duyet: cap nhat so do co the (student_measurements,
 * khong lien quan danh sach/so luong dang ky nen luon ghi nhan binh thuong), va cap nhat SIZE
 * cho tung loai trang phuc DA CO SAN dong dang ky (student_uniform_summary) - dung UPDATE, KHONG
 * BAO GIO insert dong moi va KHONG BAO GIO ghi so_luong_dang_ky tu file nay (so luong dang ky chi
 * duoc ghi nhan tu file "Tai file dang ky" ban dau - xem phanLoaiDoiChieu). Cac cap (maHs,
 * codePrefix) nam trong skipKeys (thuoc 1 trong 2 nhom bat thuong) se bi bo qua hoan toan,
 * ke ca size, cho den khi admin tu kiem tra doi chieu xong.
 */
async function commitDsNoImport({ rows, adminUsername, skipKeys = new Set() }) {
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
      if (!cat.size) continue;
      if (skipKeys.has(`${item.maHs}|${cat.codePrefix}`)) continue;
      statements.push({
        sql: `UPDATE student_uniform_summary SET size = ?, updated_at = datetime('now') WHERE ma_hs = ? AND code_prefix = ?`,
        args: [cat.size, item.maHs, cat.codePrefix],
      });
    }
  }

  if (statements.length > 0) {
    await db.batch(statements, 'write');
  }
}

/** Luu lai 2 nhom bat thuong phat hien khi doi chieu (phanLoaiDoiChieu) de admin xem lai & tu kiem tra sau. */
async function ghiNhanBatThuong({ saiSoLuong, khongCoDangKy }, uploadId) {
  const statements = [];
  for (const a of saiSoLuong) {
    statements.push({
      sql: `INSERT INTO ds_no_anomalies (upload_id, ma_hs, code_prefix, loai, so_luong_he_thong, so_luong_file, size_file)
            VALUES (?, ?, ?, 'sai_so_luong', ?, ?, ?)`,
      args: [uploadId, a.maHs, a.codePrefix, a.soLuongHeThong, a.soLuongFile, a.sizeFile],
    });
  }
  for (const a of khongCoDangKy) {
    statements.push({
      sql: `INSERT INTO ds_no_anomalies (upload_id, ma_hs, code_prefix, loai, so_luong_he_thong, so_luong_file, size_file)
            VALUES (?, ?, ?, 'khong_co_dang_ky', NULL, ?, ?)`,
      args: [uploadId, a.maHs, a.codePrefix, a.soLuongFile, a.sizeFile],
    });
  }
  if (statements.length > 0) await db.batch(statements, 'write');
}

/** Danh sach bat thuong CHUA duoc admin kiem tra, moi nhat truoc, co phan trang. */
async function getDsNoAnomalies({ page = 1, pageSize = 50 } = {}) {
  const countRs = await db.execute('SELECT COUNT(*) AS c FROM ds_no_anomalies WHERE da_kiem_tra = 0');
  const total = Number(countRs.rows[0].c);
  const offset = (page - 1) * pageSize;
  const rs = await db.execute({
    sql: `SELECT a.*, s.ho_ten, s.lop
          FROM ds_no_anomalies a
          LEFT JOIN students s ON s.ma_hs = a.ma_hs
          WHERE a.da_kiem_tra = 0
          ORDER BY a.created_at DESC, a.id DESC
          LIMIT ? OFFSET ?`,
    args: [pageSize, offset],
  });
  return { rows: rs.rows, total, page, pageSize };
}

/** Danh dau 1 dong bat thuong la DA duoc admin tu kiem tra/doi chieu xong (khong tu dong sua gi ca). */
async function markDsNoAnomalyChecked(id, adminUsername) {
  await db.execute({
    sql: `UPDATE ds_no_anomalies SET da_kiem_tra = 1, nguoi_kiem_tra = ?, kiem_tra_at = datetime('now') WHERE id = ?`,
    args: [adminUsername, id],
  });
}

async function logDsNoUpload({ adminUsername, filename, tongDong, soDongCanDoiChieu }) {
  const result = await db.execute({
    sql: `INSERT INTO ds_no_uploads (nguoi_upload, ten_file, tong_dong, so_dong_can_doi_chieu) VALUES (?, ?, ?, ?)`,
    args: [adminUsername, filename, tongDong, soDongCanDoiChieu],
  });
  return Number(result.lastInsertRowid);
}

async function getDsNoUploadHistory() {
  const rs = await db.execute('SELECT * FROM ds_no_uploads ORDER BY uploaded_at DESC, id DESC LIMIT 30');
  return rs.rows;
}

module.exports = {
  parseDsNoExcelBuffer,
  phanLoaiDoiChieu,
  taoTapKhoaBoQua,
  demSoOCoSize,
  commitDsNoImport,
  ghiNhanBatThuong,
  getDsNoAnomalies,
  markDsNoAnomalyChecked,
  logDsNoUpload,
  getDsNoUploadHistory,
  COT_CO_BAN,
};
