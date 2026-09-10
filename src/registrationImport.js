const ExcelJS = require('exceljs');
const { ExcelValidationError, cellToString, cellToNumber, readHeaderRow, findColumnIndex } = require('./excelHelpers');

const REQUIRED_COLUMNS = ['RollNumber', 'Món', 'Số lượng', 'Trạng thái thanh toán'];
const OPTIONAL_COLUMNS = ['Tên', 'Email', 'Size', 'Đơn giá', 'Tổng tiền', 'PaymentDate', 'Tháng', 'Đợt đăng ký'];

/** Tach hau to "-Size:xxx" khoi ten "Mon", tra ve { monCore, sizeSuffix }. */
function tachSizeKhoiMon(monRaw) {
  const text = String(monRaw || '').trim();
  const m = text.match(/^(.*?)\s*-\s*Size\s*:\s*(.+)$/i);
  if (m) {
    return { monCore: m[1].trim(), sizeSuffix: m[2].trim() };
  }
  return { monCore: text, sizeSuffix: null };
}

/**
 * Doc buffer file .xlsx danh sach dang ky dong phuc (dinh dang cot co dinh theo spec 3.2).
 * Chi doc du lieu tho tung dong, KHONG doi chieu ma hoc sinh / khong map loai trang phuc
 * (viec do do registrationRepo dam nhan, vi can truy van DB).
 * Nem ExcelValidationError neu file sai dinh dang.
 */
async function parseRegistrationExcelBuffer(buffer) {
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

  const headerRow = readHeaderRow(sheet);
  const missingColumns = REQUIRED_COLUMNS.filter((col) => findColumnIndex(headerRow, col) < 0);
  if (missingColumns.length > 0) {
    throw new ExcelValidationError([
      `File thiếu cột bắt buộc: ${missingColumns.join(', ')}. File đăng ký cần đúng định dạng cột chuẩn (xem hướng dẫn).`,
    ]);
  }

  const colIndex = {};
  [...REQUIRED_COLUMNS, ...OPTIONAL_COLUMNS].forEach((col) => {
    const idx = findColumnIndex(headerRow, col);
    if (idx >= 0) colIndex[col] = idx;
  });

  const rows = [];
  const errors = [];

  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const values = row.values || [];
    const isBlankRow = values.every((cell) => cellToString(cell) === '');
    if (isBlankRow) continue;

    const rollNumber = cellToString(values[colIndex['RollNumber']]);
    const monRaw = cellToString(values[colIndex['Món']]);
    const soLuong = cellToNumber(values[colIndex['Số lượng']]);
    const trangThaiTT = cellToString(values[colIndex['Trạng thái thanh toán']]);

    if (!rollNumber) {
      errors.push(`Dòng ${rowNumber}: thiếu "RollNumber".`);
      continue;
    }
    if (!monRaw) {
      errors.push(`Dòng ${rowNumber}: thiếu "Món".`);
      continue;
    }

    const { monCore, sizeSuffix } = tachSizeKhoiMon(monRaw);

    rows.push({
      rowNumber,
      rollNumber,
      ten: colIndex['Tên'] !== undefined ? cellToString(values[colIndex['Tên']]) : '',
      email: colIndex['Email'] !== undefined ? cellToString(values[colIndex['Email']]) : '',
      monRaw,
      monCore,
      sizeSuffix,
      sizeRaw: colIndex['Size'] !== undefined ? cellToString(values[colIndex['Size']]) : sizeSuffix,
      soLuong: soLuong === null ? 0 : soLuong,
      donGia: colIndex['Đơn giá'] !== undefined ? cellToNumber(values[colIndex['Đơn giá']]) : null,
      tongTien: colIndex['Tổng tiền'] !== undefined ? cellToNumber(values[colIndex['Tổng tiền']]) : null,
      trangThaiThanhToan: trangThaiTT,
      paymentDate: colIndex['PaymentDate'] !== undefined ? cellToString(values[colIndex['PaymentDate']]) : '',
      thang: colIndex['Tháng'] !== undefined ? cellToString(values[colIndex['Tháng']]) : '',
      dotDangKyTrongFile: colIndex['Đợt đăng ký'] !== undefined ? cellToString(values[colIndex['Đợt đăng ký']]) : '',
    });
  }

  if (errors.length > 0) {
    throw new ExcelValidationError(errors);
  }
  if (rows.length === 0) {
    throw new ExcelValidationError(['File không có dòng dữ liệu hợp lệ nào.']);
  }

  const dotGoiY = rows.find((r) => r.dotDangKyTrongFile)?.dotDangKyTrongFile || '';

  return { rows, dotGoiY, coCotDonGia: colIndex['Đơn giá'] !== undefined };
}

module.exports = { parseRegistrationExcelBuffer, tachSizeKhoiMon, REQUIRED_COLUMNS, OPTIONAL_COLUMNS };
