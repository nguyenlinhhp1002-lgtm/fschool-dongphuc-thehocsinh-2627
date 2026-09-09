const crypto = require('crypto');

/**
 * Bo nho tam (trong RAM, khong ben vung) de giu ket qua parse file Excel giua buoc
 * "xem truoc" va buoc "xac nhan" (vd xem diff danh sach hoc sinh truoc khi ghi de).
 * Khong dung session vi du lieu co the lon (hang nghin dong) vuot qua gioi han cookie.
 * Chi phu hop quy mo vai admin dung dong thoi (dung yeu cau cua he thong nay).
 */
const store = new Map();
const TTL_MS = 30 * 60 * 1000; // 30 phut

function put(namespace, data) {
  const token = crypto.randomBytes(16).toString('hex');
  const key = `${namespace}:${token}`;
  store.set(key, { data, expiresAt: Date.now() + TTL_MS });
  return token;
}

function peek(namespace, token) {
  const key = `${namespace}:${token}`;
  const entry = store.get(key);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    store.delete(key);
    return null;
  }
  return entry.data;
}

function consume(namespace, token) {
  const data = peek(namespace, token);
  store.delete(`${namespace}:${token}`);
  return data;
}

// Don rac dinh ky cac entry het han.
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    if (entry.expiresAt < now) store.delete(key);
  }
}, 10 * 60 * 1000).unref();

module.exports = { put, peek, consume };
