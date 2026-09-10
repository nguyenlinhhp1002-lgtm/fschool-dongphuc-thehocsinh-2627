const path = require('path');
const fs = require('fs');
const { createClient } = require('@libsql/client');

const storageDir = path.join(__dirname, '..', 'storage');
if (!fs.existsSync(storageDir)) {
  fs.mkdirSync(storageDir, { recursive: true });
}

// Neu co TURSO_DATABASE_URL (production, vd Render Free) thi dung Turso qua mang.
// Neu khong (may dev local) thi dung file .db local qua libsql embedded.
const url = process.env.TURSO_DATABASE_URL || `file:${path.join(storageDir, 'dong-phuc.db')}`;
const authToken = process.env.TURSO_AUTH_TOKEN;

const db = createClient({ url, authToken });

const SCHEMA_SQL = `
  -- role 'lop': tai khoan rieng cho 1 lop (GVCN...), chi xem duoc du lieu cua dung lop do (cot lop).
  CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('admin', 'viewer', 'lop')),
    lop TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Danh sach hoc sinh toan truong (nguon doi chieu)
  CREATE TABLE IF NOT EXISTS students (
    ma_hs TEXT PRIMARY KEY,
    ho_ten TEXT NOT NULL,
    lop TEXT,
    khoi TEXT,
    trang_thai_hoc TEXT NOT NULL DEFAULT 'Đang học',
    gioi_tinh TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS roster_uploads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nguoi_upload TEXT NOT NULL,
    ten_file TEXT NOT NULL,
    tong_dong INTEGER NOT NULL DEFAULT 0,
    so_them INTEGER NOT NULL DEFAULT 0,
    so_xoa INTEGER NOT NULL DEFAULT 0,
    so_doi_lop INTEGER NOT NULL DEFAULT 0,
    uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Nhom "dung chung 1 cot size" khi xuat/nhap DS dang ky co size (vd Size chung ap dung cho
  -- Ao polo/Quan sooc/Ao khoac/The thao thay vi moi loai 1 cot size rieng).
  CREATE TABLE IF NOT EXISTS size_groups (
    code TEXT PRIMARY KEY,
    ten_hien_thi TEXT NOT NULL,
    cot_size TEXT NOT NULL,
    vi_tri TEXT NOT NULL DEFAULT 'truoc' CHECK (vi_tri IN ('truoc', 'sau')),
    thu_tu INTEGER NOT NULL DEFAULT 0
  );

  -- Danh muc loai trang phuc (co the chinh sua)
  CREATE TABLE IF NOT EXISTS uniform_categories (
    code_prefix TEXT PRIMARY KEY,
    ten_hien_thi TEXT NOT NULL,
    cot_sl TEXT NOT NULL,
    cot_size TEXT,
    co_size INTEGER NOT NULL DEFAULT 1,
    thu_tu INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    size_group_code TEXT REFERENCES size_groups(code)
  );

  -- Bien the ten "Mon" (da chuan hoa, chu thuong khong dau khoang trang) khop voi 1 loai trang phuc
  CREATE TABLE IF NOT EXISTS category_aliases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code_prefix TEXT NOT NULL REFERENCES uniform_categories(code_prefix) ON DELETE CASCADE,
    ten_goc TEXT NOT NULL,
    ten_goc_norm TEXT NOT NULL UNIQUE
  );

  CREATE TABLE IF NOT EXISTS registration_batches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ten_dot TEXT NOT NULL UNIQUE,
    ngay_bat_dau TEXT,
    ngay_ket_thuc TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS registration_uploads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id INTEGER REFERENCES registration_batches(id),
    nguoi_upload TEXT NOT NULL,
    ten_file TEXT NOT NULL,
    tong_dong INTEGER NOT NULL DEFAULT 0,
    so_dong_loi INTEGER NOT NULL DEFAULT 0,
    so_dong_bat_thuong INTEGER NOT NULL DEFAULT 0,
    so_dong_bo_qua_tt INTEGER NOT NULL DEFAULT 0,
    uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Du lieu tho tung dong dang ky (giu de truy vet)
  CREATE TABLE IF NOT EXISTS registration_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    upload_id INTEGER NOT NULL REFERENCES registration_uploads(id),
    batch_id INTEGER REFERENCES registration_batches(id),
    ma_hs TEXT REFERENCES students(ma_hs),
    ten_raw TEXT,
    mon_raw TEXT NOT NULL,
    size_raw TEXT,
    code_prefix TEXT REFERENCES uniform_categories(code_prefix),
    so_luong INTEGER NOT NULL DEFAULT 0,
    don_gia REAL,
    tong_tien REAL,
    ngay_thanh_toan TEXT,
    thang TEXT,
    email TEXT,
    trang_thai_thanh_toan TEXT,
    tinh_vao_so_lieu INTEGER NOT NULL DEFAULT 0,
    trang_thai_dong_bo TEXT NOT NULL DEFAULT 'ok',
    unique_key TEXT UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- So do co the, khong gan voi loai trang phuc cu the
  CREATE TABLE IF NOT EXISTS student_measurements (
    ma_hs TEXT PRIMARY KEY REFERENCES students(ma_hs),
    chieu_cao_cm REAL,
    can_nang_kg REAL,
    vong_bung_cm REAL,
    dai_chan_cm REAL,
    gioi_tinh TEXT,
    ghi_chu TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_by TEXT
  );

  -- Tong hop so luong + size + so luong da phat theo hoc sinh x loai trang phuc
  CREATE TABLE IF NOT EXISTS student_uniform_summary (
    ma_hs TEXT NOT NULL REFERENCES students(ma_hs),
    code_prefix TEXT NOT NULL REFERENCES uniform_categories(code_prefix),
    so_luong_dang_ky INTEGER NOT NULL DEFAULT 0,
    size TEXT,
    so_luong_da_phat INTEGER NOT NULL DEFAULT 0,
    ngay_phat_gan_nhat TEXT,
    nguoi_phat_gan_nhat TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (ma_hs, code_prefix)
  );

  CREATE TABLE IF NOT EXISTS distribution_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ma_hs TEXT NOT NULL,
    code_prefix TEXT NOT NULL,
    so_luong_truoc INTEGER NOT NULL,
    so_luong_sau INTEGER NOT NULL,
    nguoi_phat TEXT,
    ghi_chu TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS ds_no_uploads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nguoi_upload TEXT NOT NULL,
    ten_file TEXT NOT NULL,
    tong_dong INTEGER NOT NULL DEFAULT 0,
    so_dong_sua_so_luong INTEGER NOT NULL DEFAULT 0,
    uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bang TEXT NOT NULL,
    khoa_chinh TEXT NOT NULL,
    truong TEXT NOT NULL,
    gia_tri_cu TEXT,
    gia_tri_moi TEXT,
    nguoi_sua TEXT,
    thoi_gian TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Lich su upload file dang ky the hoc sinh
  CREATE TABLE IF NOT EXISTS card_uploads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nguoi_upload TEXT NOT NULL,
    ten_file TEXT NOT NULL,
    tong_dong INTEGER NOT NULL DEFAULT 0,
    so_dong_loi INTEGER NOT NULL DEFAULT 0,
    uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Tung lan dang ky the/day (cong don qua nhieu dot - hoc sinh co the mat, cap lai nhieu lan)
  CREATE TABLE IF NOT EXISTS card_registration_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    upload_id INTEGER REFERENCES card_uploads(id),
    ma_hs TEXT REFERENCES students(ma_hs),
    co_the INTEGER NOT NULL DEFAULT 1,
    co_day INTEGER NOT NULL DEFAULT 0,
    so_tien REAL,
    ngay_dang_ky TEXT,
    dot_dang_ky TEXT,
    trang_thai TEXT NOT NULL DEFAULT 'dang_tien_hanh' CHECK (trang_thai IN ('dang_tien_hanh', 'da_tra')),
    nguoi_cap_nhat TEXT,
    unique_key TEXT UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_students_lop ON students(lop);
  CREATE INDEX IF NOT EXISTS idx_students_khoi ON students(khoi);
  CREATE INDEX IF NOT EXISTS idx_reg_items_ma_hs ON registration_items(ma_hs);
  CREATE INDEX IF NOT EXISTS idx_reg_items_batch ON registration_items(batch_id);
  CREATE INDEX IF NOT EXISTS idx_reg_items_code ON registration_items(code_prefix);
  CREATE INDEX IF NOT EXISTS idx_summary_code ON student_uniform_summary(code_prefix);
  CREATE INDEX IF NOT EXISTS idx_alias_norm ON category_aliases(ten_goc_norm);
  CREATE INDEX IF NOT EXISTS idx_card_items_ma_hs ON card_registration_items(ma_hs);
`;

// Cac cot them sau khi da co du lieu thuc te - dung ALTER TABLE vi CREATE TABLE IF NOT
// EXISTS khong tu them cot cho bang da ton tai san.
const COLUMN_MIGRATIONS = [
  { table: 'students', column: 'gioi_tinh', definition: 'TEXT' },
  { table: 'uniform_categories', column: 'size_group_code', definition: 'TEXT REFERENCES size_groups(code)' },
];

async function addColumnIfMissing(table, column, definition) {
  const rs = await db.execute(`PRAGMA table_info(${table})`);
  const exists = rs.rows.some((row) => row.name === column);
  if (!exists) {
    await db.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

/**
 * Them role 'lop' + cot 'lop' vao bang admins cho DB da co san tu truoc. SQLite khong cho
 * sua CHECK constraint bang ALTER TABLE, nen phai tao bang moi (dung CHECK moi) roi chuyen
 * du lieu qua - cach lam chuan cho truong hop nay. Guard bang cach doc lai dinh nghia bang
 * tu sqlite_master, chi chay khi CHECK hien tai CHUA co 'lop'.
 */
async function migrateAdminsRoleCheckIfNeeded() {
  const rs = await db.execute("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'admins'");
  const currentSql = rs.rows[0] ? rs.rows[0].sql : '';
  if (!currentSql || currentSql.includes("'lop'")) return;

  await db.batch(
    [
      {
        sql: `CREATE TABLE admins_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT NOT NULL UNIQUE,
          password_hash TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('admin', 'viewer', 'lop')),
          lop TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )`,
        args: [],
      },
      {
        sql: `INSERT INTO admins_new (id, username, password_hash, role, created_at)
              SELECT id, username, password_hash, role, created_at FROM admins`,
        args: [],
      },
      { sql: 'DROP TABLE admins', args: [] },
      { sql: 'ALTER TABLE admins_new RENAME TO admins', args: [] },
    ],
    'write'
  );
}

async function migrateColumns() {
  for (const m of COLUMN_MIGRATIONS) {
    await addColumnIfMissing(m.table, m.column, m.definition);
  }
}

// Nhom size dung chung (Size chung / Size Quan vay-Chan vay) - xem them src/db.js seedSizeGroupsIfEmpty().
const DEFAULT_SIZE_GROUPS = [
  { code: 'CHUNG', ten_hien_thi: 'Size chung', cot_size: 'Size chung', vi_tri: 'truoc', thu_tu: 1, members: ['AO', 'QS', 'AK', 'TT'] },
  { code: 'VAY_CV', ten_hien_thi: 'Size Quần váy/Chân váy', cot_size: 'Size Quần váy/Chân váy', vi_tri: 'sau', thu_tu: 2, members: ['QV', 'CV'] },
];

const DEFAULT_CATEGORIES = [
  { code_prefix: 'AO', ten_hien_thi: 'Áo polo', cot_sl: 'SL Áo polo', cot_size: 'Size áo polo', co_size: 1, thu_tu: 1, size_group_code: 'CHUNG', aliases: ['Áo polo'] },
  { code_prefix: 'QS', ten_hien_thi: 'Quần sooc', cot_sl: 'Quần sooc', cot_size: 'Size Quần sooc', co_size: 1, thu_tu: 2, size_group_code: 'CHUNG', aliases: ['Quần sooc'] },
  { code_prefix: 'AK', ten_hien_thi: 'Áo khoác', cot_sl: 'Áo khoác', cot_size: 'Size áo khoác', co_size: 1, thu_tu: 3, size_group_code: 'CHUNG', aliases: ['Áo khoác', 'Áo khoác mùa đông'] },
  { code_prefix: 'TT', ten_hien_thi: 'Thể thao', cot_sl: 'Thể thao', cot_size: 'Size Thể thao', co_size: 1, thu_tu: 4, size_group_code: 'CHUNG', aliases: ['Bộ quần áo thể thao'] },
  { code_prefix: 'QV', ten_hien_thi: 'Quần váy', cot_sl: 'Quần váy', cot_size: 'Size Quần váy', co_size: 1, thu_tu: 5, size_group_code: 'VAY_CV', aliases: ['Quần váy'] },
  { code_prefix: 'CV', ten_hien_thi: 'Chân váy', cot_sl: 'Chân váy', cot_size: 'Size Chân váy', co_size: 1, thu_tu: 6, size_group_code: 'VAY_CV', aliases: ['Chân váy'] },
  { code_prefix: 'QD', ten_hien_thi: 'Quần dài', cot_sl: 'Quần dài', cot_size: 'Size Quần dài', co_size: 1, thu_tu: 7, size_group_code: null, aliases: ['Quần dài'] },
  { code_prefix: 'VP', ten_hien_thi: 'Võ phục', cot_sl: 'Võ phục', cot_size: 'Size Võ phục', co_size: 1, thu_tu: 8, size_group_code: null, aliases: ['Bộ võ phục kèm đai'] },
  { code_prefix: 'QP', ten_hien_thi: 'QP', cot_sl: 'QP', cot_size: 'Size QP', co_size: 1, thu_tu: 9, size_group_code: null, aliases: ['Bộ trang phục Giáo dục Quốc phòng'] },
  { code_prefix: 'TN', ten_hien_thi: 'Túi ngủ', cot_sl: 'Túi ngủ', cot_size: null, co_size: 0, thu_tu: 10, size_group_code: null, aliases: ['Túi ngủ'] },
];

function normalizeAlias(text) {
  return String(text || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

async function seedCategoriesIfEmpty() {
  const rs = await db.execute('SELECT COUNT(*) AS c FROM uniform_categories');
  const count = Number(rs.rows[0].c);
  if (count > 0) return;

  for (const cat of DEFAULT_CATEGORIES) {
    await db.execute({
      sql: `INSERT INTO uniform_categories (code_prefix, ten_hien_thi, cot_sl, cot_size, co_size, thu_tu, active, size_group_code)
            VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
      args: [cat.code_prefix, cat.ten_hien_thi, cat.cot_sl, cat.cot_size, cat.co_size, cat.thu_tu, cat.size_group_code],
    });
    for (const alias of cat.aliases) {
      await db.execute({
        sql: `INSERT OR IGNORE INTO category_aliases (code_prefix, ten_goc, ten_goc_norm) VALUES (?, ?, ?)`,
        args: [cat.code_prefix, alias, normalizeAlias(alias)],
      });
    }
  }
}

/**
 * Khoi tao danh muc "size_groups" (Size chung / Size Quần váy-Chân váy) va gan size_group_code +
 * thu_tu tuong ung cho cac danh muc trang phuc DA CO SAN (tu ban truoc khi co tinh nang nay).
 * Chi chay 1 LAN DUY NHAT (khi size_groups con rong) de khong ghi de tuy chinh cua admin ve sau.
 */
async function seedSizeGroupsIfEmpty() {
  const rs = await db.execute('SELECT COUNT(*) AS c FROM size_groups');
  if (Number(rs.rows[0].c) > 0) return;

  for (const g of DEFAULT_SIZE_GROUPS) {
    await db.execute({
      sql: 'INSERT INTO size_groups (code, ten_hien_thi, cot_size, vi_tri, thu_tu) VALUES (?, ?, ?, ?, ?)',
      args: [g.code, g.ten_hien_thi, g.cot_size, g.vi_tri, g.thu_tu],
    });
  }

  for (const cat of DEFAULT_CATEGORIES) {
    await db.execute({
      sql: 'UPDATE uniform_categories SET thu_tu = ?, size_group_code = ? WHERE code_prefix = ?',
      args: [cat.thu_tu, cat.size_group_code, cat.code_prefix],
    });
  }
}

let schemaReadyPromise = null;
/** Dam bao schema (bang + du lieu mac dinh) da san sang, chi chay 1 lan du goi nhieu lan (memoized). */
function ensureSchema() {
  if (!schemaReadyPromise) {
    // seedSizeGroupsIfEmpty phai chay TRUOC seedCategoriesIfEmpty: tren DB hoan toan moi,
    // uniform_categories.size_group_code tham chieu size_groups(code) qua FOREIGN KEY, nen
    // size_groups can co san du lieu truoc khi insert danh muc (Turso/libsql remote co bat
    // che do enforce FK, khac voi file SQLite local nen loi nay khong lo ra khi test local).
    schemaReadyPromise = db
      .executeMultiple(SCHEMA_SQL)
      .then(migrateAdminsRoleCheckIfNeeded)
      .then(migrateColumns)
      .then(seedSizeGroupsIfEmpty)
      .then(seedCategoriesIfEmpty);
  }
  return schemaReadyPromise;
}

module.exports = { db, ensureSchema, normalizeAlias };
