const { db } = require('./db');

/** So sanh danh sach hoc sinh moi (tu file) voi danh sach dang co trong DB. */
async function previewRosterDiff(newStudents) {
  const existingRs = await db.execute('SELECT ma_hs, ho_ten, lop FROM students');
  const existingMap = new Map(existingRs.rows.map((r) => [r.ma_hs, r]));
  const newMap = new Map(newStudents.map((s) => [s.ma_hs, s]));

  const them = newStudents.filter((s) => !existingMap.has(s.ma_hs));
  const xoa = existingRs.rows.filter((r) => !newMap.has(r.ma_hs));
  const doiLop = newStudents.filter((s) => {
    const old = existingMap.get(s.ma_hs);
    return old && (old.lop || null) !== (s.lop || null);
  });

  return {
    them,
    xoa,
    doiLop,
    tongMoi: newStudents.length,
    tongCu: existingRs.rows.length,
  };
}

/** Ghi de toan bo danh sach hoc sinh bang danh sach moi (giu lai lich su cac bang khac, chi thao tac bang students). */
async function commitRosterUpload({ students, diff, adminUsername, filename }) {
  const statements = [];
  for (const row of diff.xoa) {
    statements.push({ sql: 'DELETE FROM students WHERE ma_hs = ?', args: [row.ma_hs] });
  }
  for (const s of students) {
    statements.push({
      sql: `INSERT INTO students (ma_hs, ho_ten, lop, khoi, trang_thai_hoc, gioi_tinh, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
            ON CONFLICT(ma_hs) DO UPDATE SET
              ho_ten = excluded.ho_ten,
              lop = excluded.lop,
              khoi = excluded.khoi,
              trang_thai_hoc = excluded.trang_thai_hoc,
              gioi_tinh = COALESCE(excluded.gioi_tinh, gioi_tinh),
              updated_at = datetime('now')`,
      args: [s.ma_hs, s.ho_ten, s.lop, s.khoi, s.trang_thai_hoc, s.gioi_tinh || null],
    });
  }
  await db.batch(statements, 'write');

  await db.execute({
    sql: `INSERT INTO roster_uploads (nguoi_upload, ten_file, tong_dong, so_them, so_xoa, so_doi_lop)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [adminUsername, filename, students.length, diff.them.length, diff.xoa.length, diff.doiLop.length],
  });
}

async function getRosterUploadHistory() {
  const rs = await db.execute('SELECT * FROM roster_uploads ORDER BY uploaded_at DESC, id DESC LIMIT 30');
  return rs.rows;
}

async function getStudentCount() {
  const rs = await db.execute(`SELECT COUNT(*) AS c FROM students WHERE trang_thai_hoc = 'Đang học'`);
  return Number(rs.rows[0].c);
}

async function lookupStudent(maHs) {
  if (!maHs) return null;
  const rs = await db.execute({ sql: 'SELECT * FROM students WHERE ma_hs = ?', args: [maHs] });
  return rs.rows[0] || null;
}

async function getAllStudentsMap() {
  const rs = await db.execute('SELECT * FROM students');
  return new Map(rs.rows.map((r) => [r.ma_hs, r]));
}

/** Danh sach hoc sinh co tim kiem/loc/phan trang, dung cho man hinh quan ly danh sach. */
async function searchStudents({ q, lop, khoi, includeDo, page = 1, pageSize = 50 }) {
  const where = [];
  const args = [];
  if (!includeDo) {
    where.push(`trang_thai_hoc = 'Đang học'`);
  }
  if (lop) {
    where.push('lop = ?');
    args.push(lop);
  }
  if (khoi) {
    where.push('khoi = ?');
    args.push(khoi);
  }
  if (q) {
    where.push('(ma_hs LIKE ? OR ho_ten LIKE ?)');
    args.push(`%${q}%`, `%${q}%`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const countRs = await db.execute({ sql: `SELECT COUNT(*) AS c FROM students ${whereSql}`, args });
  const total = Number(countRs.rows[0].c);

  const offset = (page - 1) * pageSize;
  const rowsRs = await db.execute({
    sql: `SELECT * FROM students ${whereSql} ORDER BY lop, ho_ten LIMIT ? OFFSET ?`,
    args: [...args, pageSize, offset],
  });

  return { rows: rowsRs.rows, total, page, pageSize };
}

async function getDistinctLopKhoi() {
  const rs = await db.execute(`SELECT DISTINCT lop, khoi FROM students WHERE lop IS NOT NULL ORDER BY khoi, lop`);
  return rs.rows;
}

module.exports = {
  previewRosterDiff,
  commitRosterUpload,
  getRosterUploadHistory,
  getStudentCount,
  lookupStudent,
  getAllStudentsMap,
  searchStudents,
  getDistinctLopKhoi,
};
