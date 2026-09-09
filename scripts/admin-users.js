#!/usr/bin/env node
/**
 * Script dong lenh de quan ly tai khoan admin.
 *
 * Cach dung:
 *   node scripts/admin-users.js add <username> [password] [role]
 *   node scripts/admin-users.js passwd <username> [newPassword]
 *   node scripts/admin-users.js setrole <username> <role>
 *   node scripts/admin-users.js remove <username>
 *   node scripts/admin-users.js list
 *
 * role: "admin" (toan quyen, mac dinh) hoac "viewer" (chi xem danh sach do,
 * khong nhap/tai file/cap nhat nguoi nhan).
 *
 * Neu khong truyen password qua tham so, script se hoi nhap kin (khong hien ky tu).
 */

require('dotenv').config();
const readline = require('readline');
const { db, ensureSchema } = require('../src/db');
const { hashPassword } = require('../src/auth');

const VALID_ROLES = ['admin', 'viewer'];

function printUsage() {
  console.log(`
Cach dung:
  node scripts/admin-users.js add <username> [password] [role]
  node scripts/admin-users.js passwd <username> [newPassword]
  node scripts/admin-users.js setrole <username> <role>
  node scripts/admin-users.js remove <username>
  node scripts/admin-users.js list

role: "admin" (toan quyen, mac dinh neu bo trong) hoac "viewer" (chi xem).
`);
}

function promptHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const originalWrite = rl._writeToOutput;
    let masking = false;
    rl._writeToOutput = function (stringToWrite) {
      if (masking) {
        rl.output.write('*');
      } else {
        originalWrite.call(rl, stringToWrite);
      }
    };

    rl.question(question, (answer) => {
      rl.history = rl.history.slice(1);
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
    masking = true;
  });
}

function validatePassword(password) {
  if (!password || password.length < 8) {
    throw new Error('Mật khẩu phải có ít nhất 8 ký tự.');
  }
}

function validateRole(role) {
  if (!VALID_ROLES.includes(role)) {
    throw new Error(`Vai trò không hợp lệ: "${role}". Chỉ chấp nhận: ${VALID_ROLES.join(', ')}.`);
  }
}

async function cmdAdd(username, passwordArg, roleArg) {
  if (!username) throw new Error('Thiếu username. Ví dụ: node scripts/admin-users.js add anna');

  const role = roleArg || 'admin';
  validateRole(role);

  const existingRs = await db.execute({ sql: 'SELECT id FROM admins WHERE username = ?', args: [username] });
  if (existingRs.rows[0]) {
    throw new Error(`Tài khoản "${username}" đã tồn tại. Dùng lệnh "passwd" hoặc "setrole" nếu muốn đổi.`);
  }

  const password = passwordArg || (await promptHidden(`Nhập mật khẩu cho "${username}": `));
  validatePassword(password);

  const hash = hashPassword(password);
  await db.execute({
    sql: 'INSERT INTO admins (username, password_hash, role) VALUES (?, ?, ?)',
    args: [username, hash, role],
  });
  console.log(`✔ Đã tạo tài khoản "${username}" (vai trò: ${role}).`);
}

async function cmdPasswd(username, passwordArg) {
  if (!username) throw new Error('Thiếu username. Ví dụ: node scripts/admin-users.js passwd anna');

  const existingRs = await db.execute({ sql: 'SELECT id FROM admins WHERE username = ?', args: [username] });
  if (!existingRs.rows[0]) {
    throw new Error(`Không tìm thấy tài khoản "${username}".`);
  }

  const password = passwordArg || (await promptHidden(`Nhập mật khẩu mới cho "${username}": `));
  validatePassword(password);

  const hash = hashPassword(password);
  await db.execute({
    sql: 'UPDATE admins SET password_hash = ? WHERE username = ?',
    args: [hash, username],
  });
  console.log(`✔ Đã đổi mật khẩu cho "${username}".`);
}

async function cmdSetRole(username, role) {
  if (!username || !role) {
    throw new Error('Thiếu tham số. Ví dụ: node scripts/admin-users.js setrole anna viewer');
  }
  validateRole(role);

  const result = await db.execute({
    sql: 'UPDATE admins SET role = ? WHERE username = ?',
    args: [role, username],
  });
  if (Number(result.rowsAffected) === 0) {
    throw new Error(`Không tìm thấy tài khoản "${username}".`);
  }
  console.log(`✔ Đã đổi vai trò của "${username}" thành "${role}".`);
}

async function cmdRemove(username) {
  if (!username) throw new Error('Thiếu username. Ví dụ: node scripts/admin-users.js remove anna');

  const result = await db.execute({ sql: 'DELETE FROM admins WHERE username = ?', args: [username] });
  if (Number(result.rowsAffected) === 0) {
    throw new Error(`Không tìm thấy tài khoản "${username}".`);
  }
  console.log(`✔ Đã xoá tài khoản "${username}".`);
}

async function cmdList() {
  const rs = await db.execute('SELECT username, role, created_at FROM admins ORDER BY username');
  if (rs.rows.length === 0) {
    console.log('Chưa có tài khoản admin nào.');
    return;
  }
  console.log('\nDanh sách tài khoản:');
  rs.rows.forEach((a) => {
    console.log(`  - ${a.username} [${a.role}] (tạo lúc: ${a.created_at})`);
  });
  console.log('');
}

async function main() {
  const [, , command, ...rest] = process.argv;

  try {
    await ensureSchema();

    switch (command) {
      case 'add':
        await cmdAdd(rest[0], rest[1], rest[2]);
        break;
      case 'passwd':
        await cmdPasswd(rest[0], rest[1]);
        break;
      case 'setrole':
        await cmdSetRole(rest[0], rest[1]);
        break;
      case 'remove':
        await cmdRemove(rest[0]);
        break;
      case 'list':
        await cmdList();
        break;
      default:
        printUsage();
        process.exitCode = command ? 1 : 0;
    }
  } catch (err) {
    console.error(`✘ Lỗi: ${err.message}`);
    process.exitCode = 1;
  }
}

main();
