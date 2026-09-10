const ExcelJS = require('exceljs');
const { getActiveCategories, getSizeGroupsMap, buildExportColumnPlan } = require('./categoriesRepo');
const { getStudentIdsWithRegistrations, getAllSummaryGrouped, getAllMeasurementsMap } = require('./summaryRepo');
const { getBatchLabelsForAllStudents } = require('./registrationRepo');

const COT_CO_DINH_DAU = ['Mã số học sinh', 'Họ tên', 'Lớp', 'Giới tính', 'Chiều cao (cm)', 'Cân nặng (kg)', 'Vòng bụng (cm)', 'Chiều dài chân (cm)'];
const COT_CO_DINH_CUOI = ['Đợt đăng ký', 'Ghi chú'];

/** Hoc sinh nay con thieu size o >=1 loai da dang ky (SL>0, loai co size, size rong)? */
function thieuSize(summaryByCode, categories) {
  for (const cat of categories) {
    if (!cat.co_size) continue;
    const row = summaryByCode.get(cat.code_prefix);
    if (row && row.so_luong_dang_ky > 0 && (!row.size || !String(row.size).trim())) {
      return true;
    }
  }
  return false;
}

/** Gia tri size dai dien cho 1 nhom (lay gia tri KHONG rong dau tien trong cac thanh vien). */
function groupSizeValue(summaryByCode, groupCode, categories) {
  for (const cat of categories) {
    if (cat.size_group_code !== groupCode) continue;
    const s = summaryByCode.get(cat.code_prefix);
    if (s && s.size && String(s.size).trim()) return s.size;
  }
  return '';
}

/**
 * Sinh workbook "DS đăng ký có size" dung dinh dang Template moi (cot dong theo danh muc
 * active + size_groups). filter: { lop, khoi, onlyMissingSize }
 * Tra ve { buffer, header, rowCount }
 */
async function buildDsNoWorkbook(filter = {}) {
  const [categories, sizeGroupsMap] = await Promise.all([getActiveCategories(), getSizeGroupsMap()]);
  const plan = buildExportColumnPlan(categories, sizeGroupsMap);

  const [students, summaryGrouped, measurementsMap, batchLabelsMap] = await Promise.all([
    getStudentIdsWithRegistrations({ lop: filter.lop, khoi: filter.khoi, q: filter.q }),
    getAllSummaryGrouped(),
    getAllMeasurementsMap(),
    getBatchLabelsForAllStudents(),
  ]);

  const header = [...COT_CO_DINH_DAU];
  for (const item of plan) {
    if (item.kind === 'sl') header.push(item.category.cot_sl);
    else if (item.kind === 'size') header.push(item.category.cot_size);
    else if (item.kind === 'group_size') header.push(item.group.cot_size);
  }
  header.push(...COT_CO_DINH_CUOI);

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('DS dang ky co size');
  sheet.addRow(header);
  sheet.getRow(1).font = { bold: true };

  let rowCount = 0;
  for (const student of students) {
    const summaryByCode = summaryGrouped.get(student.ma_hs) || new Map();
    if (filter.onlyMissingSize && !thieuSize(summaryByCode, categories)) continue;

    const measurements = measurementsMap.get(student.ma_hs) || {};
    const cacDot = (batchLabelsMap.get(student.ma_hs) || []).join(', ');

    const row = [
      student.ma_hs,
      student.ho_ten,
      student.lop,
      student.gioi_tinh || measurements.gioi_tinh || null,
      measurements.chieu_cao_cm ?? null,
      measurements.can_nang_kg ?? null,
      measurements.vong_bung_cm ?? null,
      measurements.dai_chan_cm ?? null,
    ];
    for (const item of plan) {
      if (item.kind === 'sl') {
        const s = summaryByCode.get(item.category.code_prefix);
        row.push(s ? s.so_luong_dang_ky : 0);
      } else if (item.kind === 'size') {
        const s = summaryByCode.get(item.category.code_prefix);
        row.push(s ? s.size || '' : '');
      } else if (item.kind === 'group_size') {
        row.push(groupSizeValue(summaryByCode, item.group.code, categories));
      }
    }
    row.push(cacDot, measurements.ghi_chu ?? '');

    sheet.addRow(row);
    rowCount += 1;
  }

  sheet.columns.forEach((col) => {
    col.width = 16;
  });
  sheet.getColumn(2).width = 26;

  const buffer = await workbook.xlsx.writeBuffer();
  return { buffer, header, rowCount };
}

module.exports = { buildDsNoWorkbook, COT_CO_DINH_DAU, COT_CO_DINH_CUOI };
