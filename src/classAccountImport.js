const ExcelJS = require('exceljs');
const { ExcelValidationError, cellToString, findColumnIndex } = require('./excelHelpers');

const REQUIRED_COLUMNS = ['Lớp', 'Account', 'Pass'];

/**
 * Doc buffer file danh sach tai khoan tra cuu theo lop (cot Lop, Account, Pass - cac cot khac
 * nhu EMAIL/SĐT/ky hieu bo qua hoan toan). Mat khau CHI duoc doc de hash ngay khi ghi nhan
 * (xem classAccountsRepo.commitClassAccounts) - khong bao gio hien thi lai o bat ky man hinh nao.
 */
async function parseClassAccountsBuffer(buffer) {
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

  const headerRow = sheet.getRow(1).values.map((h) => cellToString(h));
  const missingColumns = REQUIRED_COLUMNS.filter((col) => findColumnIndex(headerRow, col) < 0);
  if (missingColumns.length > 0) {
    throw new ExcelValidationError([`File thiếu cột bắt buộc: ${missingColumns.join(', ')}.`]);
  }

  const colIndex = {
    lop: findColumnIndex(headerRow, 'Lớp'),
    account: findColumnIndex(headerRow, 'Account'),
    pass: findColumnIndex(headerRow, 'Pass'),
  };

  const rows = [];
  const errors = [];
  const seenUsername = new Set();

  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const values = row.values || [];
    const isBlankRow = values.every((cell) => cellToString(cell) === '');
    if (isBlankRow) continue;

    const lop = cellToString(values[colIndex.lop]);
    const account = cellToString(values[colIndex.account]);
    const pass = cellToString(values[colIndex.pass]);

    if (!lop && !account && !pass) continue;
    if (!lop) {
      errors.push(`Dòng ${rowNumber}: thiếu "Lớp".`);
      continue;
    }
    if (!account) {
      errors.push(`Dòng ${rowNumber}: thiếu "Account".`);
      continue;
    }
    if (!pass) {
      errors.push(`Dòng ${rowNumber}: thiếu "Pass".`);
      continue;
    }
    const usernameNorm = account.trim().toLowerCase();
    if (seenUsername.has(usernameNorm)) {
      errors.push(`Dòng ${rowNumber}: tài khoản "${account}" bị trùng với 1 dòng khác trong file.`);
      continue;
    }
    seenUsername.add(usernameNorm);

    rows.push({ rowNumber, lop: lop.trim(), username: account.trim(), password: pass });
  }

  if (errors.length > 0) {
    throw new ExcelValidationError(errors);
  }
  if (rows.length === 0) {
    throw new ExcelValidationError(['File không có dòng dữ liệu hợp lệ nào.']);
  }

  return { rows };
}

module.exports = { parseClassAccountsBuffer, REQUIRED_COLUMNS };
