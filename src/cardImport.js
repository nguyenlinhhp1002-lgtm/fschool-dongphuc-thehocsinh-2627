const ExcelJS = require('exceljs');
const { ExcelValidationError, cellToString, cellToNumber, readHeaderRowTrimmed } = require('./excelHelpers');

const REQUIRED_COLUMNS = ['StudentCode', 'Amount'];
const OPTIONAL_COLUMNS = ['StudentName', 'PaidDate', 'Đợt đăng ký'];

// Amount = 50.000 -> chi dang ky the hoc sinh; 100.000 -> the + bo day bao the.
const TIEN_CHI_THE = 50000;

/**
 * Doc buffer file "DS đăng ký Thẻ học sinh" (StudentCode, StudentName, Campus, ItemCode,
 * ItemName, Amount, PaidStatus, PaidDate, Đợt đăng ký...). Chi quan tam StudentCode, Amount,
 * PaidDate, Đợt đăng ký - cac cot khac (Campus, ItemCode, ItemName, PaidStatus) bo qua hoan toan.
 * Ten cot duoc trim khi doi chieu (phong khi file co khoang trang du, vd "Đợt đăng ký ").
 */
async function parseCardExcelBuffer(buffer) {
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
  const missingColumns = REQUIRED_COLUMNS.filter((col) => !headerRow.includes(col));
  if (missingColumns.length > 0) {
    throw new ExcelValidationError([`File thiếu cột bắt buộc: ${missingColumns.join(', ')}.`]);
  }

  const colIndex = {};
  [...REQUIRED_COLUMNS, ...OPTIONAL_COLUMNS].forEach((col) => {
    const idx = headerRow.indexOf(col);
    if (idx >= 0) colIndex[col] = idx;
  });

  const rows = [];
  const errors = [];

  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const values = row.values || [];
    const isBlankRow = values.every((cell) => cellToString(cell) === '');
    if (isBlankRow) continue;

    const maHs = cellToString(values[colIndex['StudentCode']]);
    const soTien = cellToNumber(values[colIndex['Amount']]);

    if (!maHs) {
      errors.push(`Dòng ${rowNumber}: thiếu "StudentCode".`);
      continue;
    }

    rows.push({
      rowNumber,
      maHs,
      ten: colIndex['StudentName'] !== undefined ? cellToString(values[colIndex['StudentName']]) : '',
      soTien: soTien === null ? 0 : soTien,
      coThe: true,
      coDay: soTien !== null && soTien > TIEN_CHI_THE,
      ngayDangKyRaw: colIndex['PaidDate'] !== undefined ? cellToString(values[colIndex['PaidDate']]) : '',
      dotDangKy: colIndex['Đợt đăng ký'] !== undefined ? cellToString(values[colIndex['Đợt đăng ký']]) : '',
    });
  }

  if (errors.length > 0) {
    throw new ExcelValidationError(errors);
  }
  if (rows.length === 0) {
    throw new ExcelValidationError(['File không có dòng dữ liệu hợp lệ nào.']);
  }

  return { rows };
}

module.exports = { parseCardExcelBuffer, REQUIRED_COLUMNS, OPTIONAL_COLUMNS, TIEN_CHI_THE };
