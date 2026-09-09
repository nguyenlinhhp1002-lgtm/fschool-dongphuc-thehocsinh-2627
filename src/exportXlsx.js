const ExcelJS = require('exceljs');

/** Sinh buffer .xlsx tu 1 bang du lieu don gian (dung cho cac nut "Xuất Excel" o man hinh bao cao). */
async function buildSimpleXlsx(sheetName, header, rows) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName.slice(0, 31));
  sheet.addRow(header);
  sheet.getRow(1).font = { bold: true };
  for (const row of rows) {
    sheet.addRow(row);
  }
  sheet.columns.forEach((col) => {
    col.width = 18;
  });
  return workbook.xlsx.writeBuffer();
}

module.exports = { buildSimpleXlsx };
