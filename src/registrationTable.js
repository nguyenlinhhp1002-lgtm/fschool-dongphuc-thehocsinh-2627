const categoriesRepo = require('./categoriesRepo');
const summaryRepo = require('./summaryRepo');

/**
 * Xay danh sach hoc sinh bo cuc theo dinh dang DS dang ky co size (moi hoc sinh x moi loai
 * trang phuc: so luong, size, trang thai phat). Dung chung cho man hinh quan tri va trang
 * cong khai (chi xem).
 */
async function buildRegistrationRows({ q, lop, khoi } = {}) {
  const [students, categories, summaryGrouped] = await Promise.all([
    summaryRepo.getStudentIdsWithRegistrations({ q, lop, khoi }),
    categoriesRepo.getActiveCategories(),
    summaryRepo.getAllSummaryGrouped(),
  ]);

  const rows = students.map((s) => {
    const summaryByCode = summaryGrouped.get(s.ma_hs) || new Map();
    const cells = categories.map((cat) => {
      const row = summaryByCode.get(cat.code_prefix);
      const soLuong = row ? row.so_luong_dang_ky : 0;
      const daPhat = row ? row.so_luong_da_phat : 0;
      return {
        codePrefix: cat.code_prefix,
        coSize: cat.co_size,
        soLuong,
        size: row ? row.size : null,
        daPhat,
        trangThaiPhat: soLuong === 0 ? null : daPhat === 0 ? 'chua_phat' : daPhat < soLuong ? 'mot_phan' : 'da_phat_du',
      };
    });
    return { student: s, cells };
  });

  return { rows, categories };
}

module.exports = { buildRegistrationRows };
