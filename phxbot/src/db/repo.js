import { addDaysIso } from './db.js';

export function listOrgs(db, type=null) {
  if (type) return db.prepare('SELECT * FROM orgs WHERE type=? AND is_active=1 ORDER BY name').all(type);
  return db.prepare('SELECT * FROM orgs WHERE is_active=1 ORDER BY type, name').all();
}

export function getOrg(db, org_id) { return db.prepare('SELECT * FROM orgs WHERE org_id=?').get(org_id); }

export function upsertOrg(db, org) {
  db.prepare(`
    INSERT INTO orgs (org_id, name, type, base_role_id, leader_role_id, coleader_role_id, is_active, created_at)
    VALUES (:org_id, :name, :type, :base_role_id, :leader_role_id, :coleader_role_id, :is_active, CURRENT_TIMESTAMP)
    ON CONFLICT(org_id) DO UPDATE SET
      name=excluded.name,
      type=excluded.type,
      base_role_id=excluded.base_role_id,
      leader_role_id=excluded.leader_role_id,
      coleader_role_id=excluded.coleader_role_id,
      is_active=excluded.is_active
  `).run({
    org_id: org.org_id,
    name: org.name,
    type: org.type,
    base_role_id: org.base_role_id ?? null,
    leader_role_id: org.leader_role_id ?? null,
    coleader_role_id: org.coleader_role_id ?? null,
    is_active: org.is_active ?? 1
  });
  db.prepare('INSERT OR IGNORE INTO lockdowns(org_id,is_locked) VALUES(?,0)').run(org.org_id);
}

export function deleteOrgHard(db, org_id) { db.prepare('DELETE FROM orgs WHERE org_id=?').run(org_id); }

export function listOrgRanks(db, org_id) { return db.prepare('SELECT * FROM org_ranks WHERE org_id=? ORDER BY level DESC').all(org_id); }

export function upsertOrgRank(db, {org_id, rank_key, level, role_id}) {
  db.prepare(`
    INSERT INTO org_ranks(org_id, rank_key, level, role_id)
    VALUES(?,?,?,?)
    ON CONFLICT(org_id, rank_key) DO UPDATE SET level=excluded.level, role_id=excluded.role_id
  `).run(org_id, rank_key, level, role_id);
}

export function removeOrgRank(db, org_id, rank_key) { db.prepare('DELETE FROM org_ranks WHERE org_id=? AND rank_key=?').run(org_id, rank_key); }

export function getMembership(db, user_id) { return db.prepare('SELECT * FROM memberships WHERE user_id=?').get(user_id); }

export function setMembership(db, user_id, org_id, rank_key) {
  db.prepare(`
    INSERT INTO memberships(user_id, org_id, rank_key, joined_at, updated_at)
    VALUES(?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
    ON CONFLICT(user_id) DO UPDATE SET org_id=excluded.org_id, rank_key=excluded.rank_key, updated_at=CURRENT_TIMESTAMP
  `).run(user_id, org_id, rank_key);
}

export function clearMembership(db, user_id) { db.prepare('DELETE FROM memberships WHERE user_id=?').run(user_id); }

export function listMembersOfOrg(db, org_id) { return db.prepare('SELECT * FROM memberships WHERE org_id=? ORDER BY updated_at DESC').all(org_id); }

export function setCooldown(db, user_id, kind, expires_at, org_id=null) {
  db.prepare(`
    INSERT INTO cooldowns(user_id, kind, org_id, expires_at, created_at)
    VALUES(?,?,?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(user_id, kind) DO UPDATE SET org_id=excluded.org_id, expires_at=excluded.expires_at
  `).run(user_id, kind, org_id, expires_at);
}

export function getCooldown(db, user_id, kind) { return db.prepare('SELECT * FROM cooldowns WHERE user_id=? AND kind=?').get(user_id, kind); }
export function clearCooldown(db, user_id, kind) { db.prepare('DELETE FROM cooldowns WHERE user_id=? AND kind=?').run(user_id, kind); }

export function listCooldowns(db, org_id=null, kind=null) {
  if (org_id && kind) return db.prepare('SELECT * FROM cooldowns WHERE org_id=? AND kind=? ORDER BY expires_at').all(org_id, kind);
  if (org_id) return db.prepare('SELECT * FROM cooldowns WHERE org_id=? ORDER BY expires_at').all(org_id);
  if (kind) return db.prepare('SELECT * FROM cooldowns WHERE kind=? ORDER BY expires_at').all(kind);
  return db.prepare('SELECT * FROM cooldowns ORDER BY expires_at').all();
}

export function setLockdown(db, org_id, is_locked, actor_id) {
  db.prepare(`
    INSERT INTO lockdowns(org_id,is_locked,set_by,set_at) VALUES(?,?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(org_id) DO UPDATE SET is_locked=excluded.is_locked, set_by=excluded.set_by, set_at=CURRENT_TIMESTAMP
  `).run(org_id, is_locked?1:0, actor_id);
}
export function getLockdown(db, org_id) { return db.prepare('SELECT * FROM lockdowns WHERE org_id=?').get(org_id) || {org_id,is_locked:0}; }

export function addAudit(db, action, actor_id, target_id=null, org_id=null, details=null) {
  db.prepare('INSERT INTO audit(action,actor_id,target_id,org_id,details_json) VALUES(?,?,?,?,?)')
    .run(action, actor_id, target_id, org_id, details ? JSON.stringify(details) : null);
}

export function counts(db) {
  const mafiaOrgs = db.prepare("SELECT COUNT(*) c FROM orgs WHERE type='MAFIA' AND is_active=1").get().c;
  const legalOrgs = db.prepare("SELECT COUNT(*) c FROM orgs WHERE type='LEGAL' AND is_active=1").get().c;
  const mafiaMembers = db.prepare("SELECT COUNT(*) c FROM memberships m JOIN orgs o ON o.org_id=m.org_id WHERE o.type='MAFIA'").get().c;
  const legalMembers = db.prepare("SELECT COUNT(*) c FROM memberships m JOIN orgs o ON o.org_id=m.org_id WHERE o.type='LEGAL'").get().c;
  const pk = db.prepare("SELECT COUNT(*) c FROM cooldowns WHERE kind='PK'").get().c;
  const ban = db.prepare("SELECT COUNT(*) c FROM cooldowns WHERE kind='BAN'").get().c;
  const lockdowns = db.prepare("SELECT COUNT(*) c FROM lockdowns WHERE is_locked=1").get().c;
  return { mafiaOrgs, legalOrgs, mafiaMembers, legalMembers, pk, ban, lockdowns };
}

export function createWarn(db, warn) {
  db.prepare(`
    INSERT INTO warns(warn_id, org_id, reason, right_flag, sanction, expires_at, active, message_id, channel_id, created_by)
    VALUES(:warn_id,:org_id,:reason,:right_flag,:sanction,:expires_at,1,:message_id,:channel_id,:created_by)
  `).run(warn);
}
export function getWarn(db, warn_id) { return db.prepare('SELECT * FROM warns WHERE warn_id=?').get(warn_id); }
export function deactivateWarn(db, warn_id) { db.prepare('UPDATE warns SET active=0 WHERE warn_id=?').run(warn_id); }
export function listActiveWarnsToExpire(db) {
  return db.prepare("SELECT * FROM warns WHERE active=1 AND expires_at IS NOT NULL AND datetime(expires_at) <= datetime('now')").all();
}

export function applyPkCooldownToOrgMembers(db, org_id, days=3) {
  const members = listMembersOfOrg(db, org_id);
  const expires = addDaysIso(days);
  for (const m of members) setCooldown(db, m.user_id, 'PK', expires, null);
  return { members, expires };
}
