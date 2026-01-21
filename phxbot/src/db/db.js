import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

export function openDb(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  return db;
}

export function getSetting(db, key, fallback='') {
  const row = db.prepare('SELECT value FROM settings WHERE key=?').get(key);
  return row?.value ?? fallback;
}

export function setSetting(db, key, value) {
  db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
    .run(key, String(value ?? ''));
}

export function nowIso() { return new Date().toISOString(); }
export function addMinutesIso(minutes) { return new Date(Date.now() + minutes*60*1000).toISOString(); }
export function addDaysIso(days) { return new Date(Date.now() + days*24*60*60*1000).toISOString(); }
export function isExpired(iso) { return !iso || Date.parse(iso) <= Date.now(); }
