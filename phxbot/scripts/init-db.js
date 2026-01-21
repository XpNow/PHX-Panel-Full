import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const dbPath = process.env.DB_PATH || './data/phxbot.sqlite';
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS orgs (
  org_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('MAFIA','LEGAL')),
  base_role_id TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);

CREATE TABLE IF NOT EXISTS org_ranks (
  org_id TEXT NOT NULL,
  rank_key TEXT NOT NULL,
  level INTEGER NOT NULL,
  role_id TEXT NOT NULL,
  PRIMARY KEY (org_id, rank_key),
  FOREIGN KEY (org_id) REFERENCES orgs(org_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS memberships (
  user_id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  rank_key TEXT NOT NULL,
  joined_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  FOREIGN KEY (org_id) REFERENCES orgs(org_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS cooldowns (
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('PK','BAN')),
  org_id TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  PRIMARY KEY (user_id, kind)
);

CREATE TABLE IF NOT EXISTS lockdowns (
  org_id TEXT PRIMARY KEY,
  is_locked INTEGER NOT NULL DEFAULT 0,
  set_by TEXT,
  set_at TEXT,
  FOREIGN KEY (org_id) REFERENCES orgs(org_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS warns (
  warn_id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  right_flag TEXT NOT NULL,
  sanction TEXT NOT NULL,
  expires_at TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  message_id TEXT,
  channel_id TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);

CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  target_id TEXT,
  org_id TEXT,
  details_json TEXT,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);
`);

const defaults = [
  ['AUDIT_CHANNEL_ID',''],
  ['ALERT_CHANNEL_ID',''],
  ['WARN_CHANNEL_ID',''],
  ['ERROR_CHANNEL_ID',''],
  ['ROLE_ADMIN_ID',''],
  ['ROLE_SUPERVISOR_ID',''],
  ['ROLE_PK_ID',''],
  ['ROLE_BAN_ID',''],
  ['ROLE_WARN_MANAGER_ID',''], // optional
  ['FALERT_COOLDOWN_MIN','30'],
  ['FALERT_NEXT_ALLOWED','0'],
  ['RATE_ADMIN_PER5','30'],
  ['RATE_SUP_PER5','50'],
  ['RATE_LEADER_PER5','15'],
  ['RATE_COLEADER_PER5','10'],
];

const ins = db.prepare('INSERT OR IGNORE INTO settings(key,value) VALUES (?,?)');
db.transaction(() => { for (const [k,v] of defaults) ins.run(k,v); })();

db.close();
console.log(`DB initialized at: ${dbPath}`);
