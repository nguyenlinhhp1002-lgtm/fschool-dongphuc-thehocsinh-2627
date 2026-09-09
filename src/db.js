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
  CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('admin', 'viewer')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Danh sach hoc sinh toan truong (nguon doi chieu)
  CREATE TABLE IF NOT EXISTS students (
    ma_hs TEXT PRIMARY KEY,
    ho_ten TEXT NOT NULL,
    lop TEXT,
    khoi TEXT,
    trang_thai_hoc TEXT NOT NULL DEFAULT 'Đang học',
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

  -- Danh muc loai trang phuc (co the chinh sua)
  CREATE TABLE IF NOT EXISTS uniform_categories (
    code_prefix TEXT PRIMARY KEY,
    ten_hien_thi TEXT NOT NULL,
    cot_sl TEXT NOT NULL,
    cot_size TEXT,
    co_size INTEGER NOT NULL DEFAULT 1,
    thu_tu INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1
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

  CREATE INDEX IF NOT EXISTS idx_students_lop ON students(lop);
  CREATE INDEX IF NOT EXISTS idx_students_khoi ON students(khoi);
  CREATE INDEX IF NOT EXISTS idx_reg_items_ma_hs ON registration_items(ma_hs);
  CREATE INDEX IF NOT EXISTS idx_reg_items_batch ON registration_items(batch_id);
  CREATE INDEX IF NOT EXISTS idx_reg_items_code ON registration_items(code_prefix);
  CREATE INDEX IF NOT EXISTS idx_summary_code ON student_uniform_summary(code_prefix);
  CREATE INDEX IF NOT EXISTS idx_alias_norm ON category_aliases(ten_goc_norm);
`;

const DEFAULT_CATEGORIES = [
  { code_prefix: 'AO', ten_hien_thi: 'Áo polo', cot_sl: 'SL Áo polo', cot_size: 'Size áo polo', co_size: 1, thu_tu: 1, aliases: ['Áo polo'] },
  { code_prefix: 'QS', ten_hien_thi: 'Quần sooc', cot_sl: 'Quần sooc', cot_size: 'Size Quần sooc', co_size: 1, thu_tu: 2, aliases: ['Quần sooc'] },
  { code_prefix: 'QD', ten_hien_thi: 'Quần dài', cot_sl: 'Quần dài', cot_size: 'Size Quần dài', co_size: 1, thu_tu: 3, aliases: ['Quần dài'] },
  { code_prefix: 'QV', ten_hien_thi: 'Quần váy', cot_sl: 'Quần váy', cot_size: 'Size Quần váy', co_size: 1, thu_tu: 4, aliases: ['Quần váy'] },
  { code_prefix: 'CV', ten_hien_thi: 'Chân váy', cot_sl: 'Chân váy', cot_size: 'Size Chân váy', co_size: 1, thu_tu: 5, aliases: ['Chân váy'] },
  { code_prefix: 'AK', ten_hien_thi: 'Áo khoác', cot_sl: 'Áo khoác', cot_size: 'Size áo khoác', co_size: 1, thu_tu: 6, aliases: ['Áo khoác', 'Áo khoác mùa đông'] },
  { code_prefix: 'TT', ten_hien_thi: 'Thể thao', cot_sl: 'Thể thao', cot_size: 'Size Thể thao', co_size: 1, thu_tu: 7, aliases: ['Bộ quần áo thể thao'] },
  { code_prefix: 'VP', ten_hien_thi: 'Võ phục', cot_sl: 'Võ phục', cot_size: 'Size Võ phục', co_size: 1, thu_tu: 8, aliases: ['Bộ võ phục kèm đai'] },
  { code_prefix: 'QP', ten_hien_thi: 'QP', cot_sl: 'QP', cot_size: 'Size QP', co_size: 1, thu_tu: 9, aliases: ['Bộ trang phục Giáo dục Quốc phòng'] },
  { code_prefix: 'TN', ten_hien_thi: 'Túi ngủ', cot_sl: 'Túi ngủ', cot_size: null, co_size: 0, thu_tu: 10, aliases: ['Túi ngủ'] },
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
      sql: `INSERT INTO uniform_categories (code_prefix, ten_hien_thi, cot_sl, cot_size, co_size, thu_tu, active)
            VALUES (?, ?, ?, ?, ?, ?, 1)`,
      args: [cat.code_prefix, cat.ten_hien_thi, cat.cot_sl, cat.cot_size, cat.co_size, cat.thu_tu],
    });
    for (const alias of cat.aliases) {
      await db.execute({
        sql: `INSERT OR IGNORE INTO category_aliases (code_prefix, ten_goc, ten_goc_norm) VALUES (?, ?, ?)`,
        args: [cat.code_prefix, alias, normalizeAlias(alias)],
      });
    }
  }
}

let schemaReadyPromise = null;
/** Dam bao schema (bang + du lieu mac dinh) da san sang, chi chay 1 lan du goi nhieu lan (memoized). */
function ensureSchema() {
  if (!schemaReadyPromise) {
    schemaReadyPromise = db.executeMultiple(SCHEMA_SQL).then(seedCategoriesIfEmpty);
  }
  return schemaReadyPromise;
}

module.exports = { db, ensureSchema, normalizeAlias };
