const { db, normalizeAlias } = require('./db');

async function getAllCategories() {
  const catsRs = await db.execute('SELECT * FROM uniform_categories ORDER BY thu_tu, code_prefix');
  const aliasRs = await db.execute('SELECT * FROM category_aliases ORDER BY id');
  const aliasesByCode = new Map();
  for (const a of aliasRs.rows) {
    if (!aliasesByCode.has(a.code_prefix)) aliasesByCode.set(a.code_prefix, []);
    aliasesByCode.get(a.code_prefix).push(a);
  }
  return catsRs.rows.map((c) => ({ ...c, aliases: aliasesByCode.get(c.code_prefix) || [] }));
}

async function getActiveCategories() {
  const rs = await db.execute('SELECT * FROM uniform_categories WHERE active = 1 ORDER BY thu_tu, code_prefix');
  return rs.rows;
}

async function getCategoryByCode(codePrefix) {
  const rs = await db.execute({ sql: 'SELECT * FROM uniform_categories WHERE code_prefix = ?', args: [codePrefix] });
  return rs.rows[0] || null;
}

async function getAllSizeGroups() {
  const rs = await db.execute('SELECT * FROM size_groups ORDER BY thu_tu, code');
  return rs.rows;
}

async function getSizeGroupsMap() {
  const groups = await getAllSizeGroups();
  return new Map(groups.map((g) => [g.code, g]));
}

/**
 * Sap xep thu tu cot khi xuat/nhap "DS đăng ký có size": cac danh muc LIEN TIEP cung 1
 * size_group_code duoc gom lai, dung 1 cot size chung (dat truoc hoac sau khoi cot SL cua
 * nhom, theo size_groups.vi_tri); danh muc khong thuoc nhom nao van hien thi cot SL + cot
 * Size rieng nhu truoc. `categories` phai da sap theo thu_tu.
 * Tra ve mang { kind: 'sl'|'size'|'group_size', category?, group? }.
 */
function buildExportColumnPlan(categories, sizeGroupsMap) {
  const plan = [];
  let i = 0;
  while (i < categories.length) {
    const cat = categories[i];
    const group = cat.size_group_code ? sizeGroupsMap.get(cat.size_group_code) : null;

    if (group) {
      const members = [];
      while (i < categories.length && categories[i].size_group_code === group.code) {
        members.push(categories[i]);
        i += 1;
      }
      if (group.vi_tri === 'truoc') plan.push({ kind: 'group_size', group });
      members.forEach((m) => plan.push({ kind: 'sl', category: m }));
      if (group.vi_tri === 'sau') plan.push({ kind: 'group_size', group });
    } else {
      plan.push({ kind: 'sl', category: cat });
      if (cat.co_size) plan.push({ kind: 'size', category: cat });
      i += 1;
    }
  }
  return plan;
}

/**
 * Doi chieu 1 chuoi "Mon" (da bo hau to -Size:...) sang 1 loai trang phuc.
 * 1) Khop chinh xac (sau chuan hoa) voi alias da khai bao.
 * 2) Neu khong khop va chuoi trong giong 1 ma code tho (vd "QD3", "QS2" - 2 chu cai + so),
 *    thu khop tien to 2 ky tu dau voi code_prefix.
 * Tra ve { codePrefix, matched, viaPrefixCode }.
 */
async function matchMonToCategory(monText) {
  const norm = normalizeAlias(monText);
  if (!norm) return { codePrefix: null, matched: false, viaPrefixCode: false };

  const aliasRs = await db.execute({
    sql: 'SELECT code_prefix FROM category_aliases WHERE ten_goc_norm = ?',
    args: [norm],
  });
  if (aliasRs.rows[0]) {
    return { codePrefix: aliasRs.rows[0].code_prefix, matched: true, viaPrefixCode: false };
  }

  const maCodeMatch = String(monText || '').trim().match(/^([A-Za-zÀ-ỹ]{2})\d+$/);
  if (maCodeMatch) {
    const prefix = maCodeMatch[1].toUpperCase();
    const cat = await getCategoryByCode(prefix);
    if (cat) {
      return { codePrefix: cat.code_prefix, matched: true, viaPrefixCode: true };
    }
  }

  return { codePrefix: null, matched: false, viaPrefixCode: false };
}

/**
 * Nap toan bo danh muc + alias 1 lan, tra ve 1 ham khop dong bo (khong query DB tung dong) -
 * dung khi xu ly file dang ky co the co hang tram/nghin dong.
 */
async function buildMonMatcher() {
  const cats = await getAllCategories();
  const aliasNormToCode = new Map();
  const codeSet = new Set();
  for (const c of cats) {
    codeSet.add(c.code_prefix);
    for (const a of c.aliases) {
      aliasNormToCode.set(a.ten_goc_norm, c.code_prefix);
    }
  }
  return function matchMon(monText) {
    const norm = normalizeAlias(monText);
    if (!norm) return { codePrefix: null, matched: false, viaPrefixCode: false };
    if (aliasNormToCode.has(norm)) {
      return { codePrefix: aliasNormToCode.get(norm), matched: true, viaPrefixCode: false };
    }
    const maCodeMatch = String(monText || '').trim().match(/^([A-Za-zÀ-ỹ]{2})\d+$/);
    if (maCodeMatch) {
      const prefix = maCodeMatch[1].toUpperCase();
      if (codeSet.has(prefix)) {
        return { codePrefix: prefix, matched: true, viaPrefixCode: true };
      }
    }
    return { codePrefix: null, matched: false, viaPrefixCode: false };
  };
}

async function createCategory({ codePrefix, tenHienThi, cotSl, cotSize, coSize, thuTu, sizeGroupCode, aliases }) {
  await db.execute({
    sql: `INSERT INTO uniform_categories (code_prefix, ten_hien_thi, cot_sl, cot_size, co_size, thu_tu, active, size_group_code)
          VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
    args: [codePrefix, tenHienThi, cotSl, coSize ? cotSize : null, coSize ? 1 : 0, thuTu || 99, sizeGroupCode || null],
  });
  for (const alias of aliases || []) {
    if (!alias.trim()) continue;
    await db.execute({
      sql: 'INSERT OR IGNORE INTO category_aliases (code_prefix, ten_goc, ten_goc_norm) VALUES (?, ?, ?)',
      args: [codePrefix, alias.trim(), normalizeAlias(alias)],
    });
  }
}

async function updateCategory(codePrefix, { tenHienThi, cotSl, cotSize, coSize, thuTu, active, sizeGroupCode }) {
  await db.execute({
    sql: `UPDATE uniform_categories
          SET ten_hien_thi = ?, cot_sl = ?, cot_size = ?, co_size = ?, thu_tu = ?, active = ?, size_group_code = ?
          WHERE code_prefix = ?`,
    args: [tenHienThi, cotSl, coSize ? cotSize : null, coSize ? 1 : 0, thuTu, active ? 1 : 0, sizeGroupCode || null, codePrefix],
  });
}

async function addAlias(codePrefix, tenGoc) {
  const norm = normalizeAlias(tenGoc);
  if (!norm) return { ok: false, message: 'Tên không được để trống.' };
  const rs = await db.execute({
    sql: 'INSERT OR IGNORE INTO category_aliases (code_prefix, ten_goc, ten_goc_norm) VALUES (?, ?, ?)',
    args: [codePrefix, tenGoc.trim(), norm],
  });
  if (Number(rs.rowsAffected) === 0) {
    return { ok: false, message: 'Tên này đã được gán cho 1 loại trang phục khác.' };
  }
  return { ok: true };
}

async function removeAlias(id) {
  await db.execute({ sql: 'DELETE FROM category_aliases WHERE id = ?', args: [id] });
}

module.exports = {
  getAllCategories,
  getActiveCategories,
  getCategoryByCode,
  getAllSizeGroups,
  getSizeGroupsMap,
  buildExportColumnPlan,
  matchMonToCategory,
  buildMonMatcher,
  createCategory,
  updateCategory,
  addAlias,
  removeAlias,
};
