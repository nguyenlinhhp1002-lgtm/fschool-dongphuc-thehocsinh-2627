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

/**
 * Chuan hoa text de so khop khong phan biet hoa/thuong, khoang trang thua, dang Unicode, hay
 * ky tu vo hinh: normalize('NFC') (vd file tao tren may khac co the luu "ế" dang ky tu to hop
 * "e" + dau, nhin giong het nhung so sanh chuoi truc tiep se KHONG khop) + bo ky tu rong/BOM
 * (zero-width space...  - \s khong bat duoc nhung van co the lot vao khi copy-paste tu noi
 * khac) + trim + lowercase + gom khoang trang.
 */
// Cac ky tu Unicode "vo hinh" hay lot vao khi copy-paste (zero-width space/joiner, BOM, soft
// hyphen) - dung ma so thap phan (khong go truc tiep ky tu) de tranh chinh file nguon bi dinh
// ky tu vo hinh that su.
const MA_KY_TU_VO_HINH = [0x200b, 0x200c, 0x200d, 0xfeff, 0x00ad];
const KY_TU_VO_HINH = new RegExp('[' + MA_KY_TU_VO_HINH.map((c) => String.fromCharCode(c)).join('') + ']', 'g');

function normalizeText(text) {
  return String(text || '')
    .normalize('NFC')
    .replace(KY_TU_VO_HINH, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/**
 * Tim vi tri 1 cot trong hang header theo ten, so khop qua normalizeText() (khong phan biet
 * hoa/thuong, khoang trang thua, dang Unicode) thay vi so sanh chuoi tuyet doi - tranh bo sot
 * cot chi vi khac 1 khoang trang/hoa-thuong/dang encode ma mat thuong khong thay duoc.
 * Tra ve -1 neu khong tim thay.
 */
function findColumnIndex(headerRow, expectedName) {
  const target = normalizeText(expectedName);
  return headerRow.findIndex((h) => normalizeText(h) === target);
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

/** Doc gia tri hang header nhung TRIM tung o (phong khi file co khoang trang du trong ten cot, vd "Đợt đăng ký "). */
function readHeaderRowTrimmed(sheet) {
  return readHeaderRow(sheet).map((h) => h.trim());
}

/** Chuan hoa Gioi tinh ve "Nam"/"Nữ" du file goc ghi kieu gi (Nam/Nữ, Male/Female, M/F...); giu nguyen neu khong nhan ra. */
function normalizeGioiTinh(value) {
  const raw = cellToString(value).trim();
  const norm = raw.toLowerCase();
  if (['nam', 'male', 'm', 'boy'].includes(norm)) return 'Nam';
  if (['nữ', 'nu', 'female', 'f', 'girl'].includes(norm)) return 'Nữ';
  return raw || null;
}

module.exports = {
  ExcelValidationError,
  cellToString,
  cellToNumber,
  normalizeText,
  parseDateVN,
  formatDateVN,
  readHeaderRow,
  readHeaderRowTrimmed,
  findColumnIndex,
  normalizeGioiTinh,
};
