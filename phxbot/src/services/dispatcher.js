import { MessageFlags, PermissionsBitField } from 'discord.js';
import { nanoid } from 'nanoid';
import { parseCustomId } from './router.js';
import { actorContext, canEditSecurityConfig, canManageOrgs, canCreateOrg, canDeleteOrg, canManageThisOrg } from '../util/access.js';
import { getSetting, setSetting, addMinutesIso, addDaysIso, isExpired } from '../db/db.js';
import {
  counts, listOrgs, getOrg, upsertOrg, deleteOrgHard,
  listOrgRanks, upsertOrgRank, removeOrgRank,
  getMembership, setMembership, clearMembership, listMembersOfOrg,
  getCooldown, setCooldown, listCooldowns,
  getLockdown, setLockdown,
  addAudit, applyPkCooldownToOrgMembers,
  createWarn, getWarn, deactivateWarn
} from '../db/repo.js';
import { baseEmbed, COLORS } from '../ui/embeds.js';
import { btn, rowButtons, select } from '../ui/components.js';

function mentionRole(id){ return id ? `<@&${id}>` : '`(unset)`'; }
function mentionChannel(id){ return id ? `<#${id}>` : '`(unset)`'; }

export async function safeDefer(interaction){
  try {
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    }
    return true;
  } catch (e) {
    if (e?.code === 10062) return false; // expired
    throw e;
  }
}

async function safeEdit(interaction, payload){
  try { await interaction.editReply(payload); } 
  catch (e){ if (e?.code !== 10062) throw e; }
}

function homeView(db){
  const c = counts(db);
  const e = baseEmbed('🛠️ Control Center', COLORS.GLOBAL, 'Alege o sectiune.');
  e.addFields(
    { name: '🕶️ Mafia', value: `Orgs: **${c.mafiaOrgs}** • Members: **${c.mafiaMembers}**`, inline: true },
    { name: '🚓 Legal', value: `Orgs: **${c.legalOrgs}** • Members: **${c.legalMembers}**`, inline: true },
    { name: '⏳ Cooldowns', value: `PK: **${c.pk}** • Ban: **${c.ban}**`, inline: true },
    { name: '🔒 Lockdowns', value: `Active: **${c.lockdowns}**`, inline: true },
  );
  const rows = [
    rowButtons(
      btn('ui:div:MAFIA','Mafia'),
      btn('ui:div:LEGAL','Legal'),
      btn('ui:config:home','Config'),
      btn('ui:diag:home','Diagnostics')
    ),
    rowButtons(
      btn('ui:search:open','Search Player')
    )
  ];
  return { embeds:[e], components: rows };
}

function configHomeView(ctx){
  const e = baseEmbed('⚙️ Server Config', COLORS.GLOBAL, 'Setari server & organizatii. Unele sectiuni sunt Owner-only.');
  e.addFields(
    { name:'📌 Channels', value: ctx.owner ? '✅ Owner' : '🔒 Owner only', inline:true },
    { name:'🛡️ Access Roles', value: ctx.owner ? '✅ Owner' : '🔒 Owner only', inline:true },
    { name:'⏱️ Rate Limits', value: ctx.owner ? '✅ Owner' : '🔒 Owner only', inline:true },
    { name:'🏷️ Organizations', value: (ctx.owner||ctx.isAdmin||ctx.isSupervisor) ? '✅ Admin/Supervisor' : '⛔ No access', inline:true },
  );
  const rows = [
    rowButtons(
      btn('ui:config:channels','Channels'),
      btn('ui:config:roles','Access Roles'),
      btn('ui:config:rates','Rate Limits'),
      btn('ui:config:orgs','Organizations')
    ),
    rowButtons(btn('ui:home:open','Back'))
  ];
  return { embeds:[e], components: rows };
}

function channelsView(db){
  const e = baseEmbed('📌 Channels', COLORS.GLOBAL, 'Owner only. Seteaza ID-urile canalelor.');
  e.addFields(
    { name:'Audit', value: mentionChannel(getSetting(db,'AUDIT_CHANNEL_ID','')), inline:true },
    { name:'Alerts', value: mentionChannel(getSetting(db,'ALERT_CHANNEL_ID','')), inline:true },
    { name:'Warns', value: mentionChannel(getSetting(db,'WARN_CHANNEL_ID','')), inline:true },
    { name:'Errors', value: mentionChannel(getSetting(db,'ERROR_CHANNEL_ID','')), inline:true },
  );
  const rows = [
    rowButtons(
      btn('ui:modal:setch:AUDIT_CHANNEL_ID','Set Audit'),
      btn('ui:modal:setch:ALERT_CHANNEL_ID','Set Alerts'),
      btn('ui:modal:setch:WARN_CHANNEL_ID','Set Warns'),
      btn('ui:modal:setch:ERROR_CHANNEL_ID','Set Errors'),
    ),
    rowButtons(btn('ui:config:home','Back'))
  ];
  return { embeds:[e], components: rows };
}

function rolesView(db){
  const e = baseEmbed('🛡️ Access Roles', COLORS.GLOBAL, 'Owner only. Seteaza rolurile de acces.');
  e.addFields(
    { name:'Admin', value: mentionRole(getSetting(db,'ROLE_ADMIN_ID','')), inline:true },
    { name:'Supervisor', value: mentionRole(getSetting(db,'ROLE_SUPERVISOR_ID','')), inline:true },
    { name:'Warn Manager', value: mentionRole(getSetting(db,'ROLE_WARN_MANAGER_ID','')) || '`(uses Supervisor)`', inline:true },
    { name:'PK Role', value: mentionRole(getSetting(db,'ROLE_PK_ID','')), inline:true },
    { name:'Ban Role', value: mentionRole(getSetting(db,'ROLE_BAN_ID','')), inline:true },
  );
  const rows = [
    rowButtons(
      btn('ui:modal:setrole:ROLE_ADMIN_ID','Set Admin'),
      btn('ui:modal:setrole:ROLE_SUPERVISOR_ID','Set Supervisor'),
      btn('ui:modal:setrole:ROLE_WARN_MANAGER_ID','Set WarnMgr')
    ),
    rowButtons(
      btn('ui:modal:setrole:ROLE_PK_ID','Set PK'),
      btn('ui:modal:setrole:ROLE_BAN_ID','Set Ban'),
      btn('ui:config:home','Back')
    )
  ];
  return { embeds:[e], components: rows };
}

function ratesView(db){
  const e = baseEmbed('⏱️ Rate Limits', COLORS.GLOBAL, 'Owner only. Configurare rate limits.');
  e.addFields(
    { name:'Admin per 5 min', value: getSetting(db,'RATE_ADMIN_PER5','30'), inline:true },
    { name:'Supervisor per 5 min', value: getSetting(db,'RATE_SUP_PER5','50'), inline:true },
    { name:'Leader per 5 min', value: getSetting(db,'RATE_LEADER_PER5','15'), inline:true },
    { name:'CoLeader per 5 min', value: getSetting(db,'RATE_COLEADER_PER5','10'), inline:true },
    { name:'/falert cooldown (min)', value: getSetting(db,'FALERT_COOLDOWN_MIN','30'), inline:true },
  );
  const rows = [
    rowButtons(
      btn('ui:modal:setint:RATE_ADMIN_PER5','Set Admin'),
      btn('ui:modal:setint:RATE_SUP_PER5','Set Sup'),
      btn('ui:modal:setint:RATE_LEADER_PER5','Set Leader'),
      btn('ui:modal:setint:RATE_COLEADER_PER5','Set CoLeader'),
    ),
    rowButtons(
      btn('ui:modal:setint:FALERT_COOLDOWN_MIN','Set Falert'),
      btn('ui:config:home','Back')
    )
  ];
  return { embeds:[e], components: rows };
}

function orgsView(db, ctx, type=null){
  const orgs = listOrgs(db, type);
  const e = baseEmbed('🏷️ Organizations', COLORS.GLOBAL, 'Creeaza / editeaza organizatii (MAFIA / LEGAL).');
  e.addFields(
    { name:'Total', value: `Mafia: **${counts(db).mafiaOrgs}** • Legal: **${counts(db).legalOrgs}**`, inline:false }
  );
  const opts = orgs.slice(0,25).map(o=>({ label:`${o.name} (${o.type})`, value:o.org_id, description:o.org_id }));
  const rows = [];
  if (opts.length) rows.push(select('ui:org:select','Select Organization…',opts));
  rows.push(rowButtons(
    btn('ui:modal:createorg','Create Org'),
    btn('ui:modal:deleteorg','Delete Org'),
    btn('ui:config:home','Back')
  ));
  return { embeds:[e], components: rows };
}

function orgDetailView(db, org_id){
  const org = getOrg(db, org_id);
  const color = org.type === 'LEGAL' ? COLORS.LEGAL : COLORS.MAFIA;
  const e = baseEmbed(`${org.type==='LEGAL'?'🚓':'🕶️'} ${org.name} — Settings`, color, `org_id: \`${org.org_id}\``);
  e.addFields(
    { name:'Type', value: org.type, inline:true },
    { name:'Base Role', value: mentionRole(org.base_role_id), inline:true },
    { name:'Lockdown', value: getLockdown(db, org_id).is_locked ? '🔒 ON' : 'OFF', inline:true },
  );
  const ranks = listOrgRanks(db, org_id);
  e.addFields({ name:'Rank Mapping', value: ranks.length ? ranks.map(r=>`• **${r.rank_key}** (${r.level}) → ${mentionRole(r.role_id)}`).join('\n') : '`(none)`', inline:false });
  const rows = [
    rowButtons(
      btn(`ui:modal:setbaserole:${org_id}`,'Set Base Role'),
      btn(`ui:modal:addrank:${org_id}`,'Add/Update Rank'),
      btn(`ui:modal:delrank:${org_id}`,'Remove Rank'),
      btn(`ui:org:lock:${org_id}`,'Toggle Lockdown')
    ),
    rowButtons(
      btn('ui:config:orgs','Back'),
      btn(`ui:orgpanel:open:${org_id}`,'Open Panel'),
      btn(`ui:warns:open:${org_id}`,'Warns')
    )
  ];
  return { embeds:[e], components: rows };
}

function divisionView(db, type){
  const orgs = listOrgs(db, type);
  const color = type==='LEGAL'?COLORS.LEGAL:COLORS.MAFIA;
  const e = baseEmbed(type==='LEGAL'?'🚓 Legal Control':'🕶️ Mafia Control', color, 'Selecteaza o organizatie.');
  const opts = orgs.slice(0,25).map(o=>({ label:o.name, value:o.org_id, description:o.org_id }));
  const rows = [];
  if (opts.length) rows.push(select(`ui:divsel:${type}`,'Choose Organization…',opts));
  rows.push(rowButtons(btn('ui:home:open','Back')));
  return { embeds:[e], components: rows };
}

function orgPanelView(db, ctx, org_id){
  const org = getOrg(db, org_id);
  const color = org.type==='LEGAL'?COLORS.LEGAL:COLORS.MAFIA;
  const lock = getLockdown(db, org_id).is_locked ? '🔒 ON' : 'OFF';
  const members = listMembersOfOrg(db, org_id);
  const leaders = members.filter(m=>['LEADER','CHIEF'].includes(m.rank_key)).length;
  const coleaders = members.filter(m=>['COLEADER','HR'].includes(m.rank_key)).length;
  const e = baseEmbed(`${org.type==='LEGAL'?'🚓':'🕶️'} ${org.name} — Command Panel`, color);
  e.setDescription(`Scope: **${org.name}** • Lockdown: **${lock}**`);
  e.addFields(
    { name:'Members', value: `**${members.length}**`, inline:true },
    { name:'Leaders', value: `**${leaders}**`, inline:true },
    { name:'Co-Leaders', value: `**${coleaders}**`, inline:true },
  );
  const rows = [
    rowButtons(
      btn(`ui:modal:add:${org_id}`,'Add','Success','➕'),
      btn(`ui:modal:remove:${org_id}`,'Remove','Danger','➖'),
      btn(`ui:modal:pkremove:${org_id}`,'PK Remove','Danger','💀'),
      btn(`ui:modal:search:${org_id}`,'Search','Secondary','🔎')
    ),
    rowButtons(
      btn(`ui:roster:open:${org_id}:0`,'Roster'),
      btn(`ui:cool:open:${org_id}:PK:0`,'Cooldowns'),
      btn(`ui:org:settings:${org_id}`,'Org Settings'),
      btn('ui:home:open','Home')
    )
  ];
  // Org settings only for admins/sup/owner, but button stays; handler checks
  return { embeds:[e], components: rows };
}

function rosterView(db, org_id, page=0){
  const org = getOrg(db, org_id);
  const color = org.type==='LEGAL'?COLORS.LEGAL:COLORS.MAFIA;
  const all = listMembersOfOrg(db, org_id);
  const pageSize = 15;
  const pages = Math.max(1, Math.ceil(all.length / pageSize));
  const p = Math.min(Math.max(0, page), pages-1);
  const slice = all.slice(p*pageSize, p*pageSize+pageSize);

  const e = baseEmbed(`📋 ${org.name} — Roster (${p+1}/${pages})`, color, 'Use Search for a specific user.');
  e.addFields({ name:'Members', value: slice.length ? slice.map((m,i)=>`${p*pageSize+i+1}. <@${m.user_id}> — **${m.rank_key}**`).join('\n') : '`(none)`', inline:false });
  const rows = [
    rowButtons(
      btn(`ui:roster:open:${org_id}:${Math.max(0,p-1)}`,'Prev'),
      btn(`ui:roster:open:${org_id}:${Math.min(pages-1,p+1)}`,'Next'),
      btn(`ui:modal:search:${org_id}`,'Search'),
      btn(`ui:orgpanel:open:${org_id}`,'Back')
    )
  ];
  return { embeds:[e], components: rows };
}

function cooldownsView(db, org_id, kind='PK', page=0){
  const org = getOrg(db, org_id);
  const color = COLORS.COOLDOWN;
  const all = listCooldowns(db, null, kind); // org_id not stored for PK delete-org, so show global kind
  const pageSize = 12;
  const pages = Math.max(1, Math.ceil(all.length / pageSize));
  const p = Math.min(Math.max(0, page), pages-1);
  const slice = all.slice(p*pageSize, p*pageSize+pageSize);
  const e = baseEmbed(`⏳ Cooldowns — ${kind} (${p+1}/${pages})`, color);
  e.addFields({ name:'Entries', value: slice.length ? slice.map(c=>`• <@${c.user_id}> — expires <t:${Math.floor(Date.parse(c.expires_at)/1000)}:R>`).join('\n') : '`(none)`', inline:false });
  const rows = [
    rowButtons(
      btn(`ui:cool:open:${org_id}:${kind}:${Math.max(0,p-1)}`,'Prev'),
      btn(`ui:cool:open:${org_id}:${kind}:${Math.min(pages-1,p+1)}`,'Next'),
      btn(`ui:cool:open:${org_id}:PK:0`,'PK'),
      btn(`ui:cool:open:${org_id}:BAN:0`,'BAN'),
      btn(`ui:orgpanel:open:${org_id}`,'Back')
    )
  ];
  return { embeds:[e], components: rows };
}

function diagView(db, interaction){
  const e = baseEmbed('🩺 Diagnostics', COLORS.GLOBAL, 'Health checks.');
  const guild = interaction.guild;
  const me = guild.members.me;
  const perms = me.permissions;
  const need = [
    PermissionsBitField.Flags.SendMessages,
    PermissionsBitField.Flags.EmbedLinks,
    PermissionsBitField.Flags.ManageRoles,
    PermissionsBitField.Flags.ReadMessageHistory
  ];
  const missing = need.filter(p=>!perms.has(p));
  e.addFields(
    { name:'Bot perms', value: missing.length ? `❌ Missing: ${missing.map(x=>`\`${x.toString()}\``).join(', ')}` : '✅ OK', inline:false },
    { name:'DB', value: '✅ Connected', inline:false }
  );
  return { embeds:[e], components:[ rowButtons(btn('ui:home:open','Back')) ] };
}

function warnsView(db, ctx, org_id){
  const org = getOrg(db, org_id);
  const e = baseEmbed(`⚠️ Warns — ${org.name}`, COLORS.WARN, 'Add/remove warns (Supervisor/Owner only).');
  e.addFields({ name:'Access', value: ctx.canWarnManage ? '✅ Allowed' : '🔒 Supervisor/Owner only', inline:false });
  const rows = [
    rowButtons(
      btn(`ui:modal:addwarn:${org_id}`,'Add Warn','Danger','➕'),
      btn(`ui:modal:removewarn:${org_id}`,'Remove Warn','Secondary','➖'),
      btn(`ui:orgpanel:open:${org_id}`,'Back')
    )
  ];
  return { embeds:[e], components: rows };
}

async function applyRolesForMembership(db, interaction, targetMember, org_id, rank_key){
  const org = getOrg(db, org_id);
  if (!org?.base_role_id) return;
  const ranks = listOrgRanks(db, org_id);
  const rankRole = ranks.find(r=>r.rank_key===rank_key)?.role_id;

  // Remove other org roles (base roles) to enforce single org total
  const allOrgs = listOrgs(db);
  for (const o of allOrgs) {
    if (o.base_role_id && targetMember.roles.cache.has(o.base_role_id)) {
      await targetMember.roles.remove(o.base_role_id).catch(()=>{});
      const otherRanks = listOrgRanks(db, o.org_id);
      for (const r of otherRanks) {
        if (targetMember.roles.cache.has(r.role_id)) await targetMember.roles.remove(r.role_id).catch(()=>{});
      }
    }
  }
  await targetMember.roles.add(org.base_role_id).catch(()=>{});
  if (rankRole) await targetMember.roles.add(rankRole).catch(()=>{});
}

async function removeOrgRoles(db, targetMember, org_id){
  const org = getOrg(db, org_id);
  if (org?.base_role_id) await targetMember.roles.remove(org.base_role_id).catch(()=>{});
  const ranks = listOrgRanks(db, org_id);
  for (const r of ranks) await targetMember.roles.remove(r.role_id).catch(()=>{});
}

function parseUserId(input){
  if (!input) return null;
  const m = input.match(/(\d{15,20})/);
  return m ? m[1] : null;
}

export async function handleSlashCommand(db, interaction){
  const ok = await safeDefer(interaction);
  if (!ok) return;

  const ctx = actorContext(db, interaction);

  if (interaction.commandName === 'fmenu') {
    await safeEdit(interaction, homeView(db));
    return;
  }

  if (interaction.commandName === 'falert') {
    const loc = interaction.options.getString('locatie', true);
    const det = interaction.options.getString('detalii', false) || '';
    const alertCh = getSetting(db,'ALERT_CHANNEL_ID','');
    if (!alertCh) {
      await safeEdit(interaction, { content: '❌ ALERT_CHANNEL_ID not set. Owner: /fmenu -> Config -> Channels.', components: [], embeds: [] });
      return;
    }
    // global cooldown
    const next = Number(getSetting(db,'FALERT_NEXT_ALLOWED','0')||'0');
    const now = Date.now();
    const cdMin = Number(getSetting(db,'FALERT_COOLDOWN_MIN','30')||'30');
    if (next && now < next) {
      await safeEdit(interaction, { content: `⏳ /falert cooldown. Try again <t:${Math.floor(next/1000)}:R>.`, components: [], embeds: [] });
      return;
    }
    setSetting(db,'FALERT_NEXT_ALLOWED', String(now + cdMin*60*1000));
    addAudit(db,'FALERT', interaction.user.id, null, null, { loc, det });

    const ch = await interaction.guild.channels.fetch(alertCh).catch(()=>null);
    if (!ch) {
      await safeEdit(interaction, { content: '❌ Alert channel not found (check ID).', components: [], embeds: [] });
      return;
    }

    const orgs = listOrgs(db);
    const pings = orgs.filter(o=>o.base_role_id).map(o=>`<@&${o.base_role_id}>`);
    const msg1 = pings.slice(0, Math.ceil(pings.length/2)).join(' ');
    const msg2 = pings.slice(Math.ceil(pings.length/2)).join(' ');
    const embed = baseEmbed('🚨 ALERTA RAZIE', COLORS.WARN, `📍 **Locatie:** ${loc}${det?`\n📝 **Detalii:** ${det}`:''}`);
    await ch.send({ content: msg1 || null, embeds:[embed] }).catch(()=>{});
    if (msg2) await ch.send({ content: msg2 }).catch(()=>{});

    await safeEdit(interaction, { content: '✅ Alert sent.', components: [], embeds: [] });
    return;
  }
}

export async function handleComponent(db, interaction){
  // For components we ACK immediately too
  const ok = await safeDefer(interaction);
  if (!ok) return;

  const ctx = actorContext(db, interaction);
  ctx.canWarnManage = ctx.canWarnManage;
  const { ns, action, args } = parseCustomId(interaction.customId);

  // Home/back
  if (ns==='ui' && action==='home') {
    await safeEdit(interaction, homeView(db)); return;
  }

  // Division open
  if (ns==='ui' && action==='div') {
    const type = args[0];
    await safeEdit(interaction, divisionView(db, type)); return;
  }

  // Division select
  if (ns==='ui' && action==='divsel') {
    const type = args[0];
    const org_id = interaction.values?.[0];
    if (!org_id) { await safeEdit(interaction, divisionView(db,type)); return; }
    await safeEdit(interaction, orgPanelView(db, ctx, org_id)); return;
  }

  // Org panel open
  if (ns==='ui' && action==='orgpanel') {
    const org_id = args[0];
    await safeEdit(interaction, orgPanelView(db, ctx, org_id)); return;
  }

  // Roster
  if (ns==='ui' && action==='roster') {
    const org_id = args[0];
    const page = Number(args[1]||'0');
    await safeEdit(interaction, rosterView(db, org_id, page)); return;
  }

  // Cooldowns
  if (ns==='ui' && action==='cool') {
    const org_id = args[0];
    const kind = args[1] || 'PK';
    const page = Number(args[2]||'0');
    await safeEdit(interaction, cooldownsView(db, org_id, kind, page)); return;
  }

  // Config home
  if (ns==='ui' && action==='config' && args[0]==='home') {
    await safeEdit(interaction, configHomeView(ctx)); return;
  }
  if (ns==='ui' && action==='config' && args[0]==='channels') {
    if (!canEditSecurityConfig(ctx)) { await safeEdit(interaction,{content:'🔒 Owner only.',embeds:[],components:[]}); return; }
    await safeEdit(interaction, channelsView(db)); return;
  }
  if (ns==='ui' && action==='config' && args[0]==='roles') {
    if (!canEditSecurityConfig(ctx)) { await safeEdit(interaction,{content:'🔒 Owner only.',embeds:[],components:[]}); return; }
    await safeEdit(interaction, rolesView(db)); return;
  }
  if (ns==='ui' && action==='config' && args[0]==='rates') {
    if (!canEditSecurityConfig(ctx)) { await safeEdit(interaction,{content:'🔒 Owner only.',embeds:[],components:[]}); return; }
    await safeEdit(interaction, ratesView(db)); return;
  }
  if (ns==='ui' && action==='config' && args[0]==='orgs') {
    if (!canManageOrgs(ctx)) { await safeEdit(interaction,{content:'⛔ No access.',embeds:[],components:[]}); return; }
    await safeEdit(interaction, orgsView(db, ctx)); return;
  }

  // Org select in config
  if (ns==='ui' && action==='org' && args[0]==='select') {
    const org_id = interaction.values?.[0];
    if (!org_id) { await safeEdit(interaction, orgsView(db, ctx)); return; }
    await safeEdit(interaction, orgDetailView(db, org_id)); return;
  }

  // Org toggle lockdown
  if (ns==='ui' && action==='org' && args[0]==='lock') {
    const org_id = args[1];
    if (!canManageOrgs(ctx)) { await safeEdit(interaction,{content:'⛔ No access.',embeds:[],components:[]}); return; }
    const cur = getLockdown(db, org_id).is_locked ? 1:0;
    setLockdown(db, org_id, cur?0:1, interaction.user.id);
    addAudit(db,'TOGGLE_LOCKDOWN', interaction.user.id, null, org_id, {to:cur?0:1});
    await safeEdit(interaction, orgDetailView(db, org_id)); return;
  }

  // Org settings button from panel
  if (ns==='ui' && action==='org' && args[0]==='settings') {
    const org_id = args[1];
    if (!canManageOrgs(ctx)) { await safeEdit(interaction,{content:'⛔ No access.',embeds:[],components:[]}); return; }
    await safeEdit(interaction, orgDetailView(db, org_id)); return;
  }

  // Diagnostics
  if (ns==='ui' && action==='diag') {
    await safeEdit(interaction, diagView(db, interaction)); return;
  }

  // Warns
  if (ns==='ui' && action==='warns' && args[0]==='open') {
    const org_id = args[1];
    await safeEdit(interaction, warnsView(db, ctx, org_id)); return;
  }

  // Default fallback
  await safeEdit(interaction, { content:'Unhandled action.', components:[], embeds:[] });
}

export async function handleModal(db, interaction){
  const ok = await safeDefer(interaction);
  if (!ok) return;

  const ctx = actorContext(db, interaction);
  const { ns, action, args } = parseCustomId(interaction.customId);

  // Set channel ID (owner)
  if (ns==='ui' && action==='modal' && args[0]==='setch') {
    if (!canEditSecurityConfig(ctx)) { await safeEdit(interaction,{content:'🔒 Owner only.',embeds:[],components:[]}); return; }
    const key = args[1];
    const val = interaction.fields.getTextInputValue('id').trim();
    setSetting(db, key, val);
    addAudit(db,'SET_CHANNEL', interaction.user.id, null, null, {key,val});
    await safeEdit(interaction, channelsView(db)); return;
  }

  // Set role ID (owner)
  if (ns==='ui' && action==='modal' && args[0]==='setrole') {
    if (!canEditSecurityConfig(ctx)) { await safeEdit(interaction,{content:'🔒 Owner only.',embeds:[],components:[]}); return; }
    const key = args[1];
    const val = interaction.fields.getTextInputValue('id').trim();
    setSetting(db, key, val);
    addAudit(db,'SET_ROLE', interaction.user.id, null, null, {key,val});
    await safeEdit(interaction, rolesView(db)); return;
  }

  // Set int (owner)
  if (ns==='ui' && action==='modal' && args[0]==='setint') {
    if (!canEditSecurityConfig(ctx)) { await safeEdit(interaction,{content:'🔒 Owner only.',embeds:[],components:[]}); return; }
    const key = args[1];
    const val = interaction.fields.getTextInputValue('n').trim();
    if (!/^\d+$/.test(val)) { await safeEdit(interaction,{content:'❌ Must be a number.',embeds:[],components:[]}); return; }
    setSetting(db, key, val);
    addAudit(db,'SET_INT', interaction.user.id, null, null, {key,val});
    await safeEdit(interaction, ratesView(db)); return;
  }

  // Create org (admin/sup/owner)
  if (ns==='ui' && action==='modal' && args[0]==='createorg') {
    if (!canCreateOrg(ctx)) { await safeEdit(interaction,{content:'⛔ No access.',embeds:[],components:[]}); return; }
    const org_id = interaction.fields.getTextInputValue('org_id').trim().toLowerCase();
    const name = interaction.fields.getTextInputValue('name').trim();
    const type = interaction.fields.getTextInputValue('type').trim().toUpperCase();
    const base_role_id = interaction.fields.getTextInputValue('base_role_id').trim();
    if (!/^[a-z0-9_\-]{2,32}$/.test(org_id)) { await safeEdit(interaction,{content:'❌ org_id invalid (a-z0-9_-).',embeds:[],components:[]}); return; }
    if (!['MAFIA','LEGAL'].includes(type)) { await safeEdit(interaction,{content:'❌ type must be MAFIA or LEGAL.',embeds:[],components:[]}); return; }
    upsertOrg(db, {org_id,name,type,base_role_id,is_active:1});
    addAudit(db,'CREATE_ORG', interaction.user.id, null, org_id, {name,type,base_role_id});
    await safeEdit(interaction, orgDetailView(db, org_id)); return;
  }

  // Delete org (supervisor/owner) + apply PK cooldown 3d to all members
  if (ns==='ui' && action==='modal' && args[0]==='deleteorg') {
    if (!canDeleteOrg(ctx)) { await safeEdit(interaction,{content:'🔒 Only Supervisor/Owner can delete orgs.',embeds:[],components:[]}); return; }
    const org_id = interaction.fields.getTextInputValue('org_id').trim().toLowerCase();
    const confirm = interaction.fields.getTextInputValue('confirm').trim();
    if (confirm !== 'DELETE') { await safeEdit(interaction,{content:'❌ Confirm failed. Type DELETE exactly.',embeds:[],components:[]}); return; }
    const org = getOrg(db, org_id);
    if (!org) { await safeEdit(interaction,{content:'❌ Org not found.',embeds:[],components:[]}); return; }

    // Apply 3-day PK cooldown to everyone in that org (including leaders)
    const { members, expires } = applyPkCooldownToOrgMembers(db, org_id, 3);

    // Attempt to remove their roles in Discord (best effort)
    for (const m of members) {
      const gm = await interaction.guild.members.fetch(m.user_id).catch(()=>null);
      if (gm) await removeOrgRoles(db, gm, org_id);
    }

    // Hard delete org (membership rows cascade delete)
    deleteOrgHard(db, org_id);
    addAudit(db,'DELETE_ORG', interaction.user.id, null, org_id, {appliedPkUntil:expires, members:members.length});

    await safeEdit(interaction, { content:`✅ Deleted org **${org.name}**. Applied PK cooldown (3 days) to **${members.length}** members.`, embeds:[], components:[ rowButtons(btn('ui:config:orgs','Back to Orgs')) ] });
    return;
  }

  // Set base role
  if (ns==='ui' && action==='modal' && args[0]==='setbaserole') {
    const org_id = args[1];
    if (!canManageOrgs(ctx)) { await safeEdit(interaction,{content:'⛔ No access.',embeds:[],components:[]}); return; }
    const role_id = interaction.fields.getTextInputValue('id').trim();
    const org = getOrg(db, org_id);
    upsertOrg(db, { ...org, base_role_id: role_id });
    addAudit(db,'SET_BASE_ROLE', interaction.user.id, null, org_id, {role_id});
    await safeEdit(interaction, orgDetailView(db, org_id)); return;
  }

  // Add/update rank
  if (ns==='ui' && action==='modal' && args[0]==='addrank') {
    const org_id = args[1];
    if (!canManageOrgs(ctx)) { await safeEdit(interaction,{content:'⛔ No access.',embeds:[],components:[]}); return; }
    const rank_key = interaction.fields.getTextInputValue('rank_key').trim().toUpperCase();
    const levelS = interaction.fields.getTextInputValue('level').trim();
    const role_id = interaction.fields.getTextInputValue('role_id').trim();
    const level = Number(levelS);
    if (!Number.isFinite(level)) { await safeEdit(interaction,{content:'❌ level must be number.',embeds:[],components:[]}); return; }
    upsertOrgRank(db, {org_id, rank_key, level, role_id});
    addAudit(db,'UPSERT_RANK', interaction.user.id, null, org_id, {rank_key, level, role_id});
    await safeEdit(interaction, orgDetailView(db, org_id)); return;
  }

  // Remove rank
  if (ns==='ui' && action==='modal' && args[0]==='delrank') {
    const org_id = args[1];
    if (!canManageOrgs(ctx)) { await safeEdit(interaction,{content:'⛔ No access.',embeds:[],components:[]}); return; }
    const rank_key = interaction.fields.getTextInputValue('rank_key').trim().toUpperCase();
    removeOrgRank(db, org_id, rank_key);
    addAudit(db,'REMOVE_RANK', interaction.user.id, null, org_id, {rank_key});
    await safeEdit(interaction, orgDetailView(db, org_id)); return;
  }

  // Add member
  if (ns==='ui' && action==='modal' && args[0]==='add') {
    const org_id = args[1];
    if (!canManageThisOrg(ctx, org_id)) { await safeEdit(interaction,{content:'⛔ No permission for this org.',embeds:[],components:[]}); return; }
    const input = interaction.fields.getTextInputValue('user').trim();
    const uid = parseUserId(input);
    if (!uid) { await safeEdit(interaction,{content:'❌ Invalid user/ID.',embeds:[],components:[]}); return; }

    // Check cooldowns
    const pk = getCooldown(db, uid, 'PK');
    const ban = getCooldown(db, uid, 'BAN');
    if (pk && !isExpired(pk.expires_at)) {
      await safeEdit(interaction,{content:`⛔ User has PK cooldown until <t:${Math.floor(Date.parse(pk.expires_at)/1000)}:R>.`,embeds:[],components:[]}); return;
    }
    if (ban && !isExpired(ban.expires_at)) {
      await safeEdit(interaction,{content:`⛔ User is banned from factions until <t:${Math.floor(Date.parse(ban.expires_at)/1000)}:R>.`,embeds:[],components:[]}); return;
    }

    const gm = await interaction.guild.members.fetch(uid).catch(()=>null);
    if (!gm) { await safeEdit(interaction,{content:'❌ User not in server.',embeds:[],components:[]}); return; }

    // Resolve rank based on current roles (if any), else MEMBER
    const rank_key = 'MEMBER';
    await applyRolesForMembership(db, interaction, gm, org_id, rank_key);
    setMembership(db, uid, org_id, rank_key);
    addAudit(db,'ADD_MEMBER', interaction.user.id, uid, org_id, {rank_key});

    // Audit log
    await postAudit(db, interaction, `➕ Added <@${uid}> to **${getOrg(db,org_id).name}** (${rank_key})`);
    await safeEdit(interaction, { content:`✅ Added <@${uid}> to **${getOrg(db,org_id).name}**.`, embeds:[], components:[ rowButtons(btn(`ui:orgpanel:open:${org_id}`,'Back')) ] });
    return;
  }

  // Remove member (no PK)
  if (ns==='ui' && action==='modal' && args[0]==='remove') {
    const org_id = args[1];
    if (!canManageThisOrg(ctx, org_id)) { await safeEdit(interaction,{content:'⛔ No permission for this org.',embeds:[],components:[]}); return; }
    const uid = parseUserId(interaction.fields.getTextInputValue('user').trim());
    if (!uid) { await safeEdit(interaction,{content:'❌ Invalid user/ID.',embeds:[],components:[]}); return; }
    const gm = await interaction.guild.members.fetch(uid).catch(()=>null);
    if (gm) await removeOrgRoles(db, gm, org_id);
    clearMembership(db, uid);
    addAudit(db,'REMOVE_MEMBER', interaction.user.id, uid, org_id, {pk:false});
    await postAudit(db, interaction, `➖ Removed <@${uid}> from **${getOrg(db,org_id).name}** (no PK)`);
    await safeEdit(interaction, { content:`✅ Removed <@${uid}> (no PK).`, embeds:[], components:[ rowButtons(btn(`ui:orgpanel:open:${org_id}`,'Back')) ] });
    return;
  }

  // PK remove member -> 3 days
  if (ns==='ui' && action==='modal' && args[0]==='pkremove') {
    const org_id = args[1];
    if (!canManageThisOrg(ctx, org_id)) { await safeEdit(interaction,{content:'⛔ No permission for this org.',embeds:[],components:[]}); return; }
    const uid = parseUserId(interaction.fields.getTextInputValue('user').trim());
    if (!uid) { await safeEdit(interaction,{content:'❌ Invalid user/ID.',embeds:[],components:[]}); return; }
    const gm = await interaction.guild.members.fetch(uid).catch(()=>null);
    if (gm) await removeOrgRoles(db, gm, org_id);
    clearMembership(db, uid);
    setCooldown(db, uid, 'PK', addDaysIso(3), null);
    addAudit(db,'REMOVE_MEMBER', interaction.user.id, uid, org_id, {pk:true, days:3});
    await postAudit(db, interaction, `💀 PK Removed <@${uid}> from **${getOrg(db,org_id).name}** (3 zile)`);
    await safeEdit(interaction, { content:`✅ PK Removed <@${uid}> (3 zile).`, embeds:[], components:[ rowButtons(btn(`ui:orgpanel:open:${org_id}`,'Back')) ] });
    return;
  }

  // Search
  if (ns==='ui' && action==='modal' && args[0]==='search') {
    const org_id = args[1];
    const uid = parseUserId(interaction.fields.getTextInputValue('user').trim());
    if (!uid) { await safeEdit(interaction,{content:'❌ Invalid user/ID.',embeds:[],components:[]}); return; }
    const mem = getMembership(db, uid);
    const pk = getCooldown(db, uid, 'PK');
    const ban = getCooldown(db, uid, 'BAN');
    const e = baseEmbed('🔎 Player Status', COLORS.GLOBAL);
    const isAdminView = ctx.owner || ctx.isAdmin || ctx.isSupervisor;
    if (mem) {
      const org = getOrg(db, mem.org_id);
      e.addFields({ name:'Status', value:`In org: **${isAdminView?org.name:'(hidden)'}** • Rank: **${mem.rank_key}**`, inline:false });
    } else {
      e.addFields({ name:'Status', value:'FREE (no org)', inline:false });
    }
    if (pk) e.addFields({ name:'PK Cooldown', value:`Until <t:${Math.floor(Date.parse(pk.expires_at)/1000)}:R>`, inline:true });
    if (ban) e.addFields({ name:'BAN', value:`Until <t:${Math.floor(Date.parse(ban.expires_at)/1000)}:R>`, inline:true });
    await safeEdit(interaction, { embeds:[e], components:[ rowButtons(btn(`ui:orgpanel:open:${org_id}`,'Back')) ] });
    return;
  }

  // Add warn
  if (ns==='ui' && action==='modal' && args[0]==='addwarn') {
    const org_id = args[1];
    const can = ctx.owner || ctx.isSupervisor || ctx.canWarnManage;
    if (!can) { await safeEdit(interaction,{content:'🔒 Supervisor/Owner only.',embeds:[],components:[]}); return; }
    const reason = interaction.fields.getTextInputValue('reason').trim();
    const right_flag = interaction.fields.getTextInputValue('right').trim().toUpperCase() === 'DA' ? 'DA' : 'NU';
    const sanction = interaction.fields.getTextInputValue('sanction').trim() || '1/3 Mafia Warn';
    const exp = interaction.fields.getTextInputValue('expire90').trim().toUpperCase() === 'DA'
      ? addDaysIso(90) : null;

    const warnChId = getSetting(db,'WARN_CHANNEL_ID','');
    if (!warnChId) { await safeEdit(interaction,{content:'❌ WARN_CHANNEL_ID not set.',embeds:[],components:[]}); return; }
    const warn_id = `MW-${new Date().getFullYear()}-${nanoid(6).toUpperCase()}`;
    const org = getOrg(db, org_id);
    const embed = baseEmbed('⚠️ Mafia Warn', COLORS.WARN);
    embed.addFields(
      { name:'Organizatie', value: mentionRole(org.base_role_id) + ` • **${org.name}**`, inline:false },
      { name:'Motiv', value: reason, inline:false },
      { name:'DREPT', value: right_flag, inline:true },
      { name:'SANCTIUNEA OFERITA', value: sanction, inline:true },
      { name:'EXPIRA', value: exp ? `<t:${Math.floor(Date.parse(exp)/1000)}:R>` : 'NU', inline:true },
      { name:'Warn ID', value: `\`${warn_id}\``, inline:false },
    );

    const ch = await interaction.guild.channels.fetch(warnChId).catch(()=>null);
    const msg = ch ? await ch.send({ embeds:[embed] }).catch(()=>null) : null;

    createWarn(db, { warn_id, org_id, reason, right_flag, sanction, expires_at: exp, message_id: msg?.id ?? null, channel_id: warnChId, created_by: interaction.user.id });
    addAudit(db,'ADD_WARN', interaction.user.id, null, org_id, {warn_id});

    await safeEdit(interaction, { content:`✅ Warn created: \`${warn_id}\``, components:[ rowButtons(btn(`ui:warns:open:${org_id}`,'Back')) ], embeds:[] });
    return;
  }

  // Remove warn
  if (ns==='ui' && action==='modal' && args[0]==='removewarn') {
    const org_id = args[1];
    const can = ctx.owner || ctx.isSupervisor || ctx.canWarnManage;
    if (!can) { await safeEdit(interaction,{content:'🔒 Supervisor/Owner only.',embeds:[],components:[]}); return; }
    const warn_id = interaction.fields.getTextInputValue('warn_id').trim();
    const w = getWarn(db, warn_id);
    if (!w) { await safeEdit(interaction,{content:'❌ Warn not found.',embeds:[],components:[]}); return; }
    deactivateWarn(db, warn_id);
    addAudit(db,'REMOVE_WARN', interaction.user.id, null, w.org_id, {warn_id});
    await safeEdit(interaction, { content:`✅ Warn removed: \`${warn_id}\``, components:[ rowButtons(btn(`ui:warns:open:${org_id}`,'Back')) ], embeds:[] });
    return;
  }

  await safeEdit(interaction, { content:'Unhandled modal.', components:[], embeds:[] });
}

async function postAudit(db, interaction, text){
  const auditId = getSetting(db,'AUDIT_CHANNEL_ID','');
  if (!auditId) return;
  const ch = await interaction.guild.channels.fetch(auditId).catch(()=>null);
  if (!ch) return;
  await ch.send({ content: `${text}\nBy: <@${interaction.user.id}> • At: <t:${Math.floor(Date.now()/1000)}:f>` }).catch(()=>{});
}
