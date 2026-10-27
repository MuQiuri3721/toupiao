'use strict';
const { DatabaseSync } = require('node:sqlite');
const { mkdirSync } = require('node:fs');
const { dirname } = require('node:path');

function openStore(filename) {
  mkdirSync(dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, name TEXT NOT NULL,
      credits INTEGER NOT NULL DEFAULT 0 CHECK(credits>=0), createdAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      tokenHash TEXT PRIMARY KEY, userId TEXT REFERENCES users(id),
      role TEXT NOT NULL CHECK(role IN ('user','admin')), expires INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS plans (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, price INTEGER NOT NULL CHECK(price>0),
      quota INTEGER NOT NULL CHECK(quota>0), description TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY, userId TEXT NOT NULL REFERENCES users(id), planId TEXT NOT NULL,
      planName TEXT NOT NULL, price INTEGER NOT NULL, quota INTEGER NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending','paid','cancelled')),
      contact TEXT NOT NULL, phone TEXT NOT NULL, invoiceTitle TEXT NOT NULL DEFAULT '',
      taxId TEXT NOT NULL DEFAULT '', method TEXT NOT NULL, reportedAt TEXT,
      createdAt TEXT NOT NULL, paidAt TEXT
    );
    CREATE INDEX IF NOT EXISTS orders_user ON orders(userId,createdAt);
    CREATE TABLE IF NOT EXISTS ledger (
      id INTEGER PRIMARY KEY, userId TEXT NOT NULL REFERENCES users(id), delta INTEGER NOT NULL,
      reason TEXT NOT NULL, orderId TEXT UNIQUE REFERENCES orders(id), createdAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS ledger_user ON ledger(userId,id);
  `);
  // 仅首次建库写入示例套餐，重启不能恢复已被管理员下架或修改的套餐。
  if (!db.prepare("SELECT value FROM settings WHERE key='initialized'").get()) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const add = db.prepare('INSERT INTO plans VALUES (?,?,?,?,?,1)');
      add.run('basic', '基础版', 9900, 1000, '小型评选与团队决策');
      add.run('pro', '专业版', 29900, 5000, '校园赛事与中型活动');
      add.run('enterprise', '企业版', 99900, 20000, '大型活动与长期使用');
      db.prepare('INSERT INTO settings VALUES (?,?)').run('initialized', '1');
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); db.close(); throw e; }
  }
  function transaction(fn) {
    db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); db.exec('COMMIT'); return result; }
    catch (e) { db.exec('ROLLBACK'); throw e; }
  }
  return { db, transaction, close: () => db.close() };
}
module.exports = { openStore };
