/** Cac ham dung chung khi doc/ghi file Excel (.xlsx) qua exceljs. */

class ExcelValidationError extends Error {
  constructor(errors) {
    super('Excel validation error');
    this.errors = Array.isArray(errors) ? errors : [errors];
  }
}

/** Chuyen 1 gia tri cell exceljs (co the la string/number/Date/richText/formula) thanh chuoi text. */
function cellToString(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return formatDateVN(value);
  if (typeof value === 'object') {
    if (Array.isArray(value.richText)) {
      return value.richText.map((rt) => rt.text).join('').trim();
    }
    if (value.result !== undefined) return cellToString(value.result);
    if (value.text !== undefined) return String(value.text).trim();
    if (value.error !== undefined) return '';
  }
  return String(value).trim();
}

/** Chuyen 1 gia tri cell thanh so, tra ve null neu khong phai so hop le. */
function cellToNumber(value) {
  const str = cellToString(value).replace(/,/g, '').trim();
  if (str === '') return null;
  const n = Number(str);
  return Number.isFinite(n) ? n : null;
}

/** Chuan hoa text de so khop khong phan biet hoa/thuong, khoang trang thua: trim + lowercase + gom khoang trang. */
function normalizeText(text) {
  return String(text || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Ngay dang dd/mm/yyyy (chuoi) -> Date, hoac null neu khong parse duoc. */
function parseDateVN(value) {
  if (value instanceof Date) return value;
  const str = cellToString(value);
  const m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const [, d, mo, y] = m;
    return new Date(Number(y), Number(mo) - 1, Number(d));
  }
  const asDate = new Date(str);
  return Number.isNaN(asDate.getTime()) ? null : asDate;
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

/** Date -> chuoi dd/mm/yyyy de hien thi. */
function formatDateVN(date) {
  if (!date) return '';
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/** Doc gia tri hang header (row 1) thanh mang chuoi, bo qua phan tu dau (exceljs 1-indexed, values[0] rong). */
function readHeaderRow(sheet) {
  const raw = sheet.getRow(1).values || [];
  return raw.map((h) => cellToString(h));
}

module.exports = {
  ExcelValidationError,
  cellToString,
  cellToNumber,
  normalizeText,
  parseDateVN,
  formatDateVN,
  readHeaderRow,
};
