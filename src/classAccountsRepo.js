const { db } = require('./db');
const { hashPassword } = require('./auth');

/** Danh sach tai khoan role='lop' hien co, kem lop duoc gan. */
async function getAllClassAccounts() {
  const rs = await db.execute("SELECT id, username, lop, created_at FROM admins WHERE role = 'lop' ORDER BY lop");
  return rs.rows;
}

/**
 * Ghi nhan hang loat tai khoan lop tu file da duyet: neu username da ton tai (bat ke role gi)
 * thi CAP NHAT lai mat khau + lop + role='lop'; neu chua co thi tao moi. Mat khau duoc hash
 * ngay tai day, khong luu lai duoi dang van ban thuong o bat ky dau.
 */
async function commitClassAccounts(rows) {
  let soTao = 0;
  let soCapNhat = 0;

  for (const row of rows) {
    const hash = hashPassword(row.password);
    const existingRs = await db.execute({ sql: 'SELECT id FROM admins WHERE username = ?', args: [row.username] });
    const existing = existingRs.rows[0];

    if (existing) {
      await db.execute({
        sql: `UPDATE admins SET password_hash = ?, role = 'lop', lop = ? WHERE id = ?`,
        args: [hash, row.lop, existing.id],
      });
      soCapNhat += 1;
    } else {
      await db.execute({
        sql: `INSERT INTO admins (username, password_hash, role, lop) VALUES (?, ?, 'lop', ?)`,
        args: [row.username, hash, row.lop],
      });
      soTao += 1;
    }
  }

  return { soTao, soCapNhat };
}

async function deleteClassAccount(id) {
  await db.execute({ sql: "DELETE FROM admins WHERE id = ? AND role = 'lop'", args: [id] });
}

module.exports = { getAllClassAccounts, commitClassAccounts, deleteClassAccount };
