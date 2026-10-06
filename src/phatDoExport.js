const ExcelJS = require('exceljs');
const { buildRegistrationRows } = require('./registrationTable');

const THAM_SO_TRANG_THAI = {
  da_phat_du: 'Đã phát',
  chua_phat: 'Chưa phát',
};

function nhanTrangThai(cell) {
  if (cell.soLuong === 0) return '';
  if (cell.trangThaiPhat === 'mot_phan') return `${cell.daPhat}/${cell.soLuong}`;
  return THAM_SO_TRANG_THAI[cell.trangThaiPhat] || '';
}

/**
 * Xuat "DS dang ky & phat do" ra Excel, cau truc giong het bang tren tab "Dang ky & phat do":
 * Ma HS / Ho ten / Lop, roi voi moi loai trang phuc la nhom cot SL - Size (neu co) - Trang thai.
 * Cuoi dong them 3 cot tong hop theo hoc sinh: Tong SL / Da phat / Chua phat de doi chieu nhanh.
 * filter: { q, lop, khoi, includeZero } - dung chung bo loc voi man hinh.
 */
async function buildPhatDoWorkbook(filter = {}) {
  const { rows, categories } = await buildRegistrationRows(filter);

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('DS dang ky & phat do');

  // --- Dong tieu de 1 (ten nhom) + dong 2 (SL / Size / Trang thai) ---
  const hang1 = ['Mã HS', 'Họ tên', 'Lớp'];
  const hang2 = ['', '', ''];
  const nhomCot = []; // { tuCot, denCot } de merge o dong 1
  let cot = 4;
  for (const cat of categories) {
    const soCot = cat.co_size ? 3 : 2;
    nhomCot.push({ tuCot: cot, denCot: cot + soCot - 1 });
    hang1.push(cat.ten_hien_thi);
    for (let i = 1; i < soCot; i += 1) hang1.push('');
    hang2.push('SL');
    if (cat.co_size) hang2.push('Size');
    hang2.push('Trạng thái');
    cot += soCot;
  }
  const cotTong = cot;
  hang1.push('Tổng', '', '');
  hang2.push('Tổng SL', 'Đã phát', 'Chưa phát');

  sheet.addRow(hang1);
  sheet.addRow(hang2);
  for (let c = 1; c <= 3; c += 1) sheet.mergeCells(1, c, 2, c);
  for (const { tuCot, denCot } of nhomCot) sheet.mergeCells(1, tuCot, 1, denCot);
  sheet.mergeCells(1, cotTong, 1, cotTong + 2);

  [1, 2].forEach((r) => {
    const row = sheet.getRow(r);
    row.font = { bold: true };
    row.alignment = { horizontal: 'center', vertical: 'middle' };
  });

  // --- Du lieu ---
  for (const r of rows) {
    const dong = [r.student.ma_hs, r.student.ho_ten, r.student.lop];
    let tongSl = 0;
    let tongDaPhat = 0;
    for (const cell of r.cells) {
      dong.push(cell.soLuong === 0 ? '' : cell.soLuong);
      if (cell.coSize) dong.push(cell.soLuong === 0 ? '' : cell.size || '');
      dong.push(nhanTrangThai(cell));
      tongSl += cell.soLuong;
      tongDaPhat += Math.min(cell.daPhat, cell.soLuong);
    }
    dong.push(tongSl, tongDaPhat, tongSl - tongDaPhat);
    sheet.addRow(dong);
  }

  sheet.columns.forEach((c) => {
    c.width = 11;
  });
  sheet.getColumn(1).width = 14;
  sheet.getColumn(2).width = 26;
  sheet.getColumn(3).width = 8;
  sheet.views = [{ state: 'frozen', xSplit: 3, ySplit: 2 }];

  themSheetTongHop(workbook, rows, categories);

  const buffer = await workbook.xlsx.writeBuffer();
  return { buffer, rowCount: rows.length };
}

const KHONG_CO_SIZE = '(chưa có size)';
const KHONG_THEO_DOI_SIZE = '(không theo dõi size)';

/** Thu tu size: chu so/nho truoc, "(chua co size)" cuoi; so sanh tu nhien (S < M < L ... theo bang chu cai neu khong phai so). */
const THU_TU_SIZE_CHU = ['XXS', 'XS', 'S', 'M', 'L', 'XL', '2XL', 'XXL', '3XL', 'XXXL', '4XL', '5XL'];

function soSanhSize(a, b) {
  if (a === KHONG_CO_SIZE) return b === KHONG_CO_SIZE ? 0 : 1;
  if (b === KHONG_CO_SIZE) return -1;
  const ia = THU_TU_SIZE_CHU.indexOf(a.toUpperCase());
  const ib = THU_TU_SIZE_CHU.indexOf(b.toUpperCase());
  if (ia >= 0 && ib >= 0) return ia - ib;
  if (ia >= 0) return -1; // size chu (S/M/L...) truoc size so/khac
  if (ib >= 0) return 1;
  return a.localeCompare(b, 'vi', { numeric: true });
}

/**
 * Sheet 2 "Tong hop theo size": voi moi loai trang phuc, tung size la 1 dong gom Tong SL / Da phat /
 * Chua phat, cuoi moi loai co dong "Tong". Tinh tu CHINH danh sach dang loc o sheet 1 nen so lieu
 * luon khop voi bang chi tiet (cung bo loc Ma HS/ten, Lop, Khoi).
 */
function themSheetTongHop(workbook, rows, categories) {
  const sheet = workbook.addWorksheet('Tong hop theo size');
  sheet.addRow(['Loại trang phục', 'Size', 'Tổng SL', 'Đã phát', 'Chưa phát']);
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).alignment = { horizontal: 'center' };

  let tongTatCa = { sl: 0, daPhat: 0 };
  categories.forEach((cat, idx) => {
    const theoSize = new Map();
    rows.forEach((r) => {
      const cell = r.cells[idx];
      if (cell.soLuong === 0) return;
      const size = cat.co_size ? (cell.size && String(cell.size).trim() ? String(cell.size).trim() : KHONG_CO_SIZE) : KHONG_THEO_DOI_SIZE;
      const acc = theoSize.get(size) || { sl: 0, daPhat: 0 };
      acc.sl += cell.soLuong;
      acc.daPhat += Math.min(cell.daPhat, cell.soLuong);
      theoSize.set(size, acc);
    });
    if (theoSize.size === 0) return;

    let tongLoai = { sl: 0, daPhat: 0 };
    [...theoSize.keys()].sort(soSanhSize).forEach((size) => {
      const { sl, daPhat } = theoSize.get(size);
      sheet.addRow([cat.ten_hien_thi, size, sl, daPhat, sl - daPhat]);
      tongLoai = { sl: tongLoai.sl + sl, daPhat: tongLoai.daPhat + daPhat };
    });
    const dongTong = sheet.addRow([`Tổng ${cat.ten_hien_thi}`, '', tongLoai.sl, tongLoai.daPhat, tongLoai.sl - tongLoai.daPhat]);
    dongTong.font = { bold: true };
    tongTatCa = { sl: tongTatCa.sl + tongLoai.sl, daPhat: tongTatCa.daPhat + tongLoai.daPhat };
  });

  const dongCuoi = sheet.addRow(['TỔNG CỘNG', '', tongTatCa.sl, tongTatCa.daPhat, tongTatCa.sl - tongTatCa.daPhat]);
  dongCuoi.font = { bold: true };

  sheet.getColumn(1).width = 30;
  sheet.getColumn(2).width = 22;
  [3, 4, 5].forEach((c) => {
    sheet.getColumn(c).width = 12;
  });
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
}

module.exports = { buildPhatDoWorkbook, themSheetTongHop };
