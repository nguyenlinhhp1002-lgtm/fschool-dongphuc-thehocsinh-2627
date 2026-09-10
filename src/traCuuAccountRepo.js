const { db } = require('./db');
const { hashPassword } = require('./auth');

/**
 * Chi co DUY NHAT 1 tai khoan role='tra_cuu' - tai khoan chung, don gian de chia se cho
 * cac bo phan lien quan (GVCN, van phong...) dang nhap xem trang /tra-cuu ma khong can
 * cap tai khoan quan tri day du.
 */
async function getTraCuuAccount() {
  const rs = await db.execute("SELECT id, username, created_at FROM admins WHERE role = 'tra_cuu' LIMIT 1");
  return rs.rows[0] || null;
}

/** Tao moi (neu chua co) hoac cap nhat lai tai khoan tra_cuu duy nhat. Mat khau duoc hash tai day. */
async function setTraCuuAccount({ username, password }) {
  const hash = hashPassword(password);
  const existing = await getTraCuuAccount();
  if (existing) {
    await db.execute({ sql: 'UPDATE admins SET username = ?, password_hash = ? WHERE id = ?', args: [username, hash, existing.id] });
  } else {
    await db.execute({ sql: "INSERT INTO admins (username, password_hash, role) VALUES (?, ?, 'tra_cuu')", args: [username, hash] });
  }
}

module.exports = { getTraCuuAccount, setTraCuuAccount };
