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

  const buffer = await workbook.xlsx.writeBuffer();
  return { buffer, rowCount: rows.length };
}

module.exports = { buildPhatDoWorkbook };
