import { getSetting } from '../db/db.js';
import { getMembership, listOrgs, listOrgRanks } from '../db/repo.js';

export function isOwner(interaction) {
  return interaction.guild && interaction.guild.ownerId === interaction.user.id;
}

function hasRole(member, roleId) {
  if (!roleId) return false;
  return member?.roles?.cache?.has(roleId) || false;
}

export function actorContext(db, interaction) {
  const member = interaction.member;
  const owner = isOwner(interaction);

  const adminRole = getSetting(db,'ROLE_ADMIN_ID','');
  const supRole = getSetting(db,'ROLE_SUPERVISOR_ID','');
  const warnMgrRole = getSetting(db,'ROLE_WARN_MANAGER_ID','');

  const isAdmin = owner || hasRole(member, adminRole);
  const isSupervisor = owner || hasRole(member, supRole);
  const canWarnManage = owner || hasRole(member, warnMgrRole) || hasRole(member, supRole);

  const membership = getMembership(db, interaction.user.id);

  return { owner, isAdmin, isSupervisor, canWarnManage, membership };
}

export const canCreateOrg = (ctx) => ctx.owner || ctx.isAdmin || ctx.isSupervisor;
export const canDeleteOrg = (ctx) => ctx.owner || ctx.isSupervisor;
export const canEditSecurityConfig = (ctx) => ctx.owner;
export const canManageOrgs = (ctx) => ctx.owner || ctx.isAdmin || ctx.isSupervisor;

export function canManageThisOrg(ctx, org_id){
  if (ctx.owner || ctx.isAdmin || ctx.isSupervisor) return true;
  const rk = ctx.membership?.rank_key;
  return ctx.membership?.org_id === org_id && ['LEADER','COLEADER','CHIEF','HR'].includes(rk);
}

export async function inferOrgByBaseRole(db, guildMember){
  const orgs = listOrgs(db);
  for (const o of orgs) {
    if (o.base_role_id && guildMember.roles.cache.has(o.base_role_id)) return o;
  }
  return null;
}

export function resolveRankFromRoles(db, org_id, guildMember){
  const ranks = listOrgRanks(db, org_id);
  let best = null;
  for (const r of ranks) {
    if (guildMember.roles.cache.has(r.role_id)) {
      if (!best || r.level > best.level) best = r;
    }
  }
  return best?.rank_key || 'MEMBER';
}
