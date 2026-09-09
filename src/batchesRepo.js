const { db } = require('./db');

async function getAllBatches() {
  const rs = await db.execute('SELECT * FROM registration_batches ORDER BY id');
  return rs.rows;
}

async function getBatchByName(tenDot) {
  const rs = await db.execute({ sql: 'SELECT * FROM registration_batches WHERE ten_dot = ?', args: [tenDot] });
  return rs.rows[0] || null;
}

async function getBatchById(id) {
  const rs = await db.execute({ sql: 'SELECT * FROM registration_batches WHERE id = ?', args: [id] });
  return rs.rows[0] || null;
}

/** Tim hoac tao moi 1 dot dang ky theo ten (dung khi upload file dang ky). */
async function findOrCreateBatch(tenDot) {
  const existing = await getBatchByName(tenDot);
  if (existing) return existing;
  const result = await db.execute({
    sql: 'INSERT INTO registration_batches (ten_dot) VALUES (?)',
    args: [tenDot],
  });
  return getBatchById(Number(result.lastInsertRowid));
}

async function createBatch({ tenDot, ngayBatDau, ngayKetThuc }) {
  await db.execute({
    sql: 'INSERT INTO registration_batches (ten_dot, ngay_bat_dau, ngay_ket_thuc) VALUES (?, ?, ?)',
    args: [tenDot, ngayBatDau || null, ngayKetThuc || null],
  });
}

async function updateBatch(id, { tenDot, ngayBatDau, ngayKetThuc }) {
  await db.execute({
    sql: 'UPDATE registration_batches SET ten_dot = ?, ngay_bat_dau = ?, ngay_ket_thuc = ? WHERE id = ?',
    args: [tenDot, ngayBatDau || null, ngayKetThuc || null, id],
  });
}

/** Doan ten dot goi y tu ten file, vd "Đợt 2 - DS đăng ký 9.9.2026.xlsx" -> "Đợt 2". */
function goiYTenDotTuFilename(filename) {
  const m = String(filename || '').match(/Đợt\s*[\d.]+/i);
  return m ? m[0].trim() : '';
}

module.exports = {
  getAllBatches,
  getBatchByName,
  getBatchById,
  findOrCreateBatch,
  createBatch,
  updateBatch,
  goiYTenDotTuFilename,
};
