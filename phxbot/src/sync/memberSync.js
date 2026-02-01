import * as repo from "../db/repo.js";
import { getSetting } from "../db/db.js";
import { enqueueRoleOp } from "../infra/roleQueue.js";

const _cooldownTouch = new Map();

const _dupLeadershipRoleWarn = new Map();
const _leadershipConflictWarn = new Map();

function _canWarnOnce(map, key, windowMs) {
  const now = Date.now();
  const last = map.get(key) || 0;
  if (now - last < windowMs) return false;
  map.set(key, now);
  return true;
}


function _cdKey(userId, kind, action) {
  return `${userId}:${kind}:${action}`;
}

function _canTouchCooldown(userId, kind, action, windowMs = 1_000) {
  const k = _cdKey(userId, kind, action);
  const last = _cooldownTouch.get(k) || 0;
  const now = Date.now();
  if (now - last < windowMs) return false;
  _cooldownTouch.set(k, now);
  return true;
}

function computeRank(member, org, leaderRole, coLeaderRole) {
  if (leaderRole && member.roles.cache.has(leaderRole)) return "LEADER";
  if (coLeaderRole && member.roles.cache.has(coLeaderRole)) return "COLEADER";
  return "MEMBER";
}

function formatRel(tsMs) {
  return `<t:${Math.floor(Number(tsMs) / 1000)}:R>`;
}

function fmtOpResult(res) {
  if (!res) return "necunoscut";
  if (res.ok) {
    if (res.skipped) return "OK (skip)";
    if (res.deduped) return "OK (deduped)";
    return "OK";
  }
  return `EȘEC (${res.reason || "UNKNOWN"})`;
}

export function diffMemberOrgsFromDiscord(member, orgs) {
  const hits = [];
  for (const org of orgs) {
    if (!org?.member_role_id) continue;
    if (!member.roles.cache.has(org.member_role_id)) continue;
    hits.push(org);
  }
  return hits;
}

export async function syncMemberOrgsDiscordToDb({ db, guild, member, audit }) {
  const orgs = repo.listOrgs(db);
  const hits = diffMemberOrgsFromDiscord(member, orgs);

  const roleToOrgs = new Map();
  const pushOwner = (roleId, org, kind) => {
    if (!roleId) return;
    const k = String(roleId);
    const arr = roleToOrgs.get(k) || [];
    arr.push({ org, kind });
    roleToOrgs.set(k, arr);
  };

  for (const org of orgs) {
    if (org?.leader_role_id) pushOwner(org.leader_role_id, org, "Leader");
    if (org?.co_leader_role_id) pushOwner(org.co_leader_role_id, org, "Co-Leader");
  }

  const dupRoleIds = new Set();
  for (const [rid, owners] of roleToOrgs.entries()) {
    if ((owners?.length || 0) > 1) dupRoleIds.add(String(rid));
  }

  for (const rid of dupRoleIds) {
    if (!member.roles.cache.has(rid)) continue;
    if (!_canWarnOnce(_dupLeadershipRoleWarn, rid, 10 * 60 * 1000)) continue;
    const owners = roleToOrgs.get(rid) || [];
    await audit?.(
      "⚠️ Config: rol conducere duplicat",
      [
        `**Rol:** <@&${rid}>`,
        `**Problemă:** același rol de conducere este folosit în mai multe organizații`,
        `**Organizații:** ${owners.map(x => `**${x.org?.name ?? x.org?.id ?? "?"}** (${x.kind})`).join(", ")}`,
        `**Impact:** pot apărea alerte de conflict la setări de rank / sincronizări`
      ].join("\n")
    );
  }

  const leadershipConflicts = [];
  for (const org of orgs) {
    if (!org?.member_role_id) continue;
    const hasMain = member.roles.cache.has(org.member_role_id);
    if (hasMain) continue;

    const leadRid = org.leader_role_id ? String(org.leader_role_id) : null;
    const coRid = org.co_leader_role_id ? String(org.co_leader_role_id) : null;

    const hasLead = leadRid && !dupRoleIds.has(leadRid) && member.roles.cache.has(leadRid);
    const hasCo = coRid && !dupRoleIds.has(coRid) && member.roles.cache.has(coRid);

    if (hasLead || hasCo) leadershipConflicts.push({ org, hasLead, hasCo });
  }

  if (leadershipConflicts.length) {
    if (_canWarnOnce(_leadershipConflictWarn, member.id, 2 * 60 * 1000)) {
      await audit?.(
        "⚠️ Conflict: rol conducere fără rol org",
        [
          `**Țintă:** <@${member.id}> (\`${member.id}\`)`,
          `**Problemă:** are Leader/Co-Leader fără rolul principal al organizației`,
          `**Roluri detectate:** ${leadershipConflicts
            .map(x => `**${x.org.name}** (${x.hasLead ? "Leader" : ""}${x.hasLead && x.hasCo ? "/" : ""}${x.hasCo ? "Co-Leader" : ""})`)
            .join(", ")}`
        ].join("\n")
      );
    }
  }


  if (hits.length > 1) {
    await audit?.(
      "⚠️ Conflict: roluri multiple",
      [
        `**Țintă:** <@${member.id}> (\`${member.id}\`)`,
        `**Răspuns:** nu modific DB până se rezolvă conflictul`,
        `**Roluri detectate:** ${hits.map(o => `**${o.name}**`).join(", ")}`
      ].join("\n")
    );
    return { ok: false, conflict: true, count: hits.length };
  }

  if (hits.length === 0) {
    const prev = repo.getMembership(db, member.id);
    if (prev) repo.removeMembership(db, member.id);
    return { ok: true, action: prev ? "DB_REMOVE" : "NOOP", prevOrgId: prev?.org_id ?? null };
  }

  const org = hits[0];
  const leaderRole = org.leader_role_id || null;
  const coLeaderRole = org.co_leader_role_id || null;
  const role = computeRank(member, org, leaderRole, coLeaderRole);
  const prev = repo.getMembership(db, member.id);

  if (prev && String(prev.org_id) === String(org.id) && String(prev.role) === String(role)) {
    return { ok: true, action: "NOOP", orgId: org.id, role, prevOrgId: prev?.org_id ?? null };
  }

  repo.upsertMembership(db, member.id, org.id, role);
  return { ok: true, action: "UPSERT", orgId: org.id, role, prevOrgId: prev?.org_id ?? null };
}

export async function enforceCooldownsDbToDiscord({ db, guild, member, audit }) {
  const pkRole = getSetting(db, "pk_role_id");
  const banRole = getSetting(db, "ban_role_id");
  const now = Date.now();

  const pk = repo.getCooldown(db, member.id, "PK");
  if (pk && pk.expires_at > now && pkRole) {
    if (!member.roles.cache.has(pkRole)) {
      if (_canTouchCooldown(member.id, "PK", "add")) {
        const res = await enqueueRoleOp({ member, roleId: pkRole, action: "add", context: "cooldown:pk:enforce" });
        if (res?.ok) {
          await audit?.(
            "🔁 Cooldown sincronizat",
            [
              `**Țintă:** <@${member.id}> (\`${member.id}\`)`,
              `**Tip:** **PK**`,
              `**DB:** ✅ activ (expiră ${formatRel(pk.expires_at)})`,
              `**Discord:** ❌ rol lipsea → ✅ rol adăugat`,
              `**Rezultat:** ${fmtOpResult(res)}`
            ].join("\n")
          );
        } else if (res && !res.ok) {
          await audit?.(
            "⚠️ Cooldown drift (nu s-a putut repara)",
            [
              `**Țintă:** <@${member.id}> (\`${member.id}\`)`,
              `**Tip:** **PK**`,
              `**DB:** ✅ activ (expiră ${formatRel(pk.expires_at)})`,
              `**Discord:** ❌ rol lipsește`,
              `**Acțiune încercată:** readăugare rol`,
              `**Rezultat:** ${fmtOpResult(res)}`
            ].join("\n")
          );
        }
      }
    }
  } else {
    const pkExpired = !!(pk && Number(pk.expires_at) <= now);
    if (pkRole && member.roles.cache.has(pkRole) && (!pk || pkExpired)) {
      if (_canTouchCooldown(member.id, "PK", "remove")) {
        const res = await enqueueRoleOp({ member, roleId: pkRole, action: "remove", context: "cooldown:pk:cleanup" });
        if (res?.ok) {
          if (pk) repo.clearCooldown(db, member.id, "PK");
          await audit?.(
            "🧹 Cooldown curățat",
            [
              `**Țintă:** <@${member.id}> (\`${member.id}\`)`,
              `**Tip:** **PK**`,
              `**DB:** ${pk ? (pkExpired ? `⚠️ expirat (${formatRel(pk.expires_at)})` : "❌ lipsă") : "❌ lipsă"}`,
              `**Discord:** ✅ rol prezent → ✅ rol eliminat`,
              `**Rezultat:** ${fmtOpResult(res)}`
            ].join("\n")
          );
        }
      }
    } else if (pkExpired) {
      repo.clearCooldown(db, member.id, "PK");
    }
  }

  const ban = repo.getCooldown(db, member.id, "BAN");
  if (ban && ban.expires_at > now && banRole) {
    if (!member.roles.cache.has(banRole)) {
      if (_canTouchCooldown(member.id, "BAN", "add")) {
        const res = await enqueueRoleOp({ member, roleId: banRole, action: "add", context: "cooldown:ban:enforce" });
        if (res?.ok) {
          await audit?.(
            "🔁 Cooldown sincronizat",
            [
              `**Țintă:** <@${member.id}> (\`${member.id}\`)`,
              `**Tip:** **BAN**`,
              `**DB:** ✅ activ (expiră ${formatRel(ban.expires_at)})`,
              `**Discord:** ❌ rol lipsea → ✅ rol adăugat`,
              `**Rezultat:** ${fmtOpResult(res)}`
            ].join("\n")
          );
        } else if (res && !res.ok) {
          await audit?.(
            "⚠️ Cooldown drift (nu s-a putut repara)",
            [
              `**Țintă:** <@${member.id}> (\`${member.id}\`)`,
              `**Tip:** **BAN**`,
              `**DB:** ✅ activ (expiră ${formatRel(ban.expires_at)})`,
              `**Discord:** ❌ rol lipsește`,
              `**Acțiune încercată:** readăugare rol`,
              `**Rezultat:** ${fmtOpResult(res)}`
            ].join("\n")
          );
        }
      }
    }
  } else {
    const banExpired = !!(ban && Number(ban.expires_at) <= now);
    if (banRole && member.roles.cache.has(banRole) && (!ban || banExpired)) {
      if (_canTouchCooldown(member.id, "BAN", "remove")) {
        const res = await enqueueRoleOp({ member, roleId: banRole, action: "remove", context: "cooldown:ban:cleanup" });
        if (res?.ok) {
          if (ban) repo.clearCooldown(db, member.id, "BAN");
          await audit?.(
            "🧹 Cooldown curățat",
            [
              `**Țintă:** <@${member.id}> (\`${member.id}\`)`,
              `**Tip:** **BAN**`,
              `**DB:** ${ban ? (banExpired ? `⚠️ expirat (${formatRel(ban.expires_at)})` : "❌ lipsă") : "❌ lipsă"}`,
              `**Discord:** ✅ rol prezent → ✅ rol eliminat`,
              `**Rezultat:** ${fmtOpResult(res)}`
            ].join("\n")
          );
        }
      }
    } else if (banExpired) {
      repo.clearCooldown(db, member.id, "BAN");
    }
  }

  return { ok: true };
}
