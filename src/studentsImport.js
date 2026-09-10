const ExcelJS = require('exceljs');
const { ExcelValidationError, cellToString, readHeaderRow, findColumnIndex, normalizeGioiTinh } = require('./excelHelpers');

const REQUIRED_COLUMNS = ['Mã học sinh', 'Họ và tên', 'Lớp', 'Trạng thái'];
const OPTIONAL_COLUMNS = ['Giới tính'];

/** Suy ra Khoi (6-12) tu ten Lop dang "{Khoi}A{so}", vd "10A1" -> "10". */
function suyRaKhoi(lop) {
  if (!lop) return null;
  const m = String(lop).trim().match(/^(\d{1,2})/);
  return m ? m[1] : null;
}

/** Chon sheet phu hop: uu tien sheet co ten chua "toàn trường", neu khong co thi lay sheet dau. */
function chonSheet(workbook, tenSheetChiDinh) {
  if (tenSheetChiDinh) {
    const found = workbook.worksheets.find((ws) => ws.name === tenSheetChiDinh);
    if (found) return found;
  }
  const uuTien = workbook.worksheets.find((ws) => ws.name.toLowerCase().includes('toàn trường') && !ws.name.toLowerCase().startsWith('copy'));
  return uuTien || workbook.worksheets[0];
}

function danhSachTenSheet(workbook) {
  return workbook.worksheets.map((ws) => ws.name);
}

/**
 * Doc buffer file .xlsx danh sach hoc sinh toan truong.
 * Nem ExcelValidationError neu file sai dinh dang.
 * Tra ve { students, sheetName, sheetNames }
 */
async function parseStudentsExcelBuffer(buffer, tenSheetChiDinh) {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer);
  } catch (err) {
    throw new ExcelValidationError(['Không đọc được file. Vui lòng kiểm tra đây có đúng là file Excel (.xlsx) không.']);
  }

  const sheetNames = danhSachTenSheet(workbook);
  const sheet = chonSheet(workbook, tenSheetChiDinh);
  if (!sheet || sheet.rowCount === 0) {
    throw new ExcelValidationError(['File Excel không có sheet dữ liệu nào.']);
  }

  const headerRow = readHeaderRow(sheet);
  const missingColumns = REQUIRED_COLUMNS.filter((col) => findColumnIndex(headerRow, col) < 0);
  if (missingColumns.length > 0) {
    throw new ExcelValidationError([
      `Sheet "${sheet.name}" thiếu cột bắt buộc: ${missingColumns.join(', ')}. Cần đủ 4 cột: Mã học sinh, Họ và tên, Lớp, Trạng thái. Thử chọn sheet khác nếu file có nhiều sheet.`,
    ]);
  }

  const colIndex = {};
  [...REQUIRED_COLUMNS, ...OPTIONAL_COLUMNS].forEach((col) => {
    const idx = findColumnIndex(headerRow, col);
    if (idx >= 0) colIndex[col] = idx;
  });

  const errors = [];
  const students = [];
  const seenMaHs = new Map();

  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const values = row.values || [];
    const isBlankRow = values.every((cell) => cellToString(cell) === '');
    if (isBlankRow) continue;

    const maHs = cellToString(values[colIndex['Mã học sinh']]);
    const hoTen = cellToString(values[colIndex['Họ và tên']]);
    const lop = cellToString(values[colIndex['Lớp']]);
    const trangThaiRaw = cellToString(values[colIndex['Trạng thái']]);
    const trangThai = trangThaiRaw || (lop ? 'Đang học' : 'DO');

    if (!maHs) {
      errors.push(`Dòng ${rowNumber}: thiếu "Mã học sinh".`);
      continue;
    }
    if (!hoTen) {
      errors.push(`Dòng ${rowNumber}: thiếu "Họ và tên".`);
      continue;
    }

    const student = {
      ma_hs: maHs,
      ho_ten: hoTen,
      lop: lop || null,
      khoi: suyRaKhoi(lop),
      trang_thai_hoc: trangThai,
      gioi_tinh: colIndex['Giới tính'] !== undefined ? normalizeGioiTinh(values[colIndex['Giới tính']]) : null,
    };

    if (seenMaHs.has(maHs)) {
      // Trung ma trong cung file - lay dong sau cung (co the file da duoc cap nhat noi tiep).
      const idx = students.findIndex((s) => s.ma_hs === maHs);
      if (idx >= 0) students.splice(idx, 1);
    }
    seenMaHs.set(maHs, true);
    students.push(student);
  }

  if (errors.length > 0) {
    throw new ExcelValidationError(errors);
  }
  if (students.length === 0) {
    throw new ExcelValidationError(['File không có dòng dữ liệu hợp lệ nào.']);
  }

  return { students, sheetName: sheet.name, sheetNames };
}

module.exports = { parseStudentsExcelBuffer, REQUIRED_COLUMNS, suyRaKhoi };
