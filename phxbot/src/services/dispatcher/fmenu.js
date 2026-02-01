import { ActionRowBuilder, ButtonStyle, MessageFlags } from "discord.js";
import * as repo from "../../db/repo.js";
import { hasRole, parseUserIds, humanKind } from "../../util/access.js";
import { makeEmbed, btn, rowsFromButtons, select, modal, input } from "../../ui/ui.js";
import { COLORS } from "../../ui/theme.js";

import {
  now,
  PK_MS,
  DAY_MS,
  LEGAL_MIN_DAYS,
  sendEphemeral,
  makeBrandedEmbed,
  audit,
  formatRel,
  roleCheck,
  withUserLock,
  safeRoleAdd,
  safeRoleRemove,
  getOrgRank,
  canManageTargetRank,
  canSetRank,
  showModalSafe,
  fetchMembersWithRetry
} from "./shared.js";

const ROSTER_CACHE_MS = 30 * 1000;
const rosterCache = new Map();

function resolveManageableOrgs(ctx) {
  const orgs = repo.listOrgs(ctx.db);
  const manageable = [];
  for (const o of orgs) {
    const hasMemberRole = hasRole(ctx.member, o.member_role_id);
    const isLeader = hasRole(ctx.member, o.leader_role_id);
    const isCo = o.co_leader_role_id ? hasRole(ctx.member, o.co_leader_role_id) : false;
    if (hasMemberRole && (isLeader || isCo)) {
      manageable.push({ org: o, role: isLeader ? "LEADER" : "COLEADER" });
    }
  }
  return manageable;
}

async function resolveOrgForAddSlash(interaction, ctx) {
  const manageable = resolveManageableOrgs(ctx);
  if (manageable.length === 1) return manageable[0].org.id;

  if (manageable.length === 0) {
    const msg = ctx.perms.staff
      ? "Nu ai o organizație setată ca Lider/Co-Lider. Pentru a adăuga membri în orice organizație folosește **/famenu**."
      : "Nu ai permisiuni de Lider/Co-Lider pentru a folosi această comandă.";
    await interaction.editReply({ embeds: [makeBrandedEmbed(ctx, "⛔ Acces refuzat", msg)] });
    return null;
  }

  await interaction.editReply({
    embeds: [makeBrandedEmbed(ctx, "Alege organizația", "Ai acces la mai multe organizații. Comanda /add nu poate ghici unde să adauge. Folosește **/fmenu** și apasă **Add membru** din organizația corectă.")]
  });
  return null;
}

async function resolveOrgForRmvSlash(interaction, ctx, targetMember) {
  const orgs = repo.listOrgs(ctx.db);
  const mem = repo.getMembership(ctx.db, String(targetMember.id));
  let orgId = mem?.org_id ? Number(mem.org_id) : null;

  if (!orgId) {
    const hits = orgs.filter(o => o?.member_role_id && hasRole(targetMember, o.member_role_id));
    if (hits.length === 1) orgId = hits[0].id;
    else if (hits.length > 1) {
      await interaction.editReply({
        embeds: [makeBrandedEmbed(ctx, "Eroare", "Userul pare să fie în mai multe organizații (roluri multiple). Folosește **/fmenu** și scoate-l din organizația corectă.")]
      });
      return null;
    }
  }

  if (!orgId) {
    await interaction.editReply({ embeds: [makeBrandedEmbed(ctx, "Eroare", "Userul nu este într-o organizație (nu există membership și nu are rol de organizație).")] });
    return null;
  }

  const org = repo.getOrg(ctx.db, orgId);
  if (!org) {
    await interaction.editReply({ embeds: [makeBrandedEmbed(ctx, "Eroare", "Organizația userului nu există în DB (posibil configurare ștearsă). Folosește **/famenu** pentru verificare.")] });
    return null;
  }

  if (!ctx.perms.staff) {
    const manageable = resolveManageableOrgs(ctx).some(m => m.org.id === orgId);
    if (!manageable) {
      await interaction.editReply({ embeds: [makeBrandedEmbed(ctx, "⛔ Acces refuzat", "Userul nu este în organizația ta. El este în: **" + ((org && org.name) ? org.name : orgId) + "**.") ]});
      return null;
    }
  }

  return orgId;
}

async function fetchTargetMember(ctx, userId) {
  if (!userId) return null;
  return await ctx.guild.members.fetch(String(userId)).catch(() => null);
}

async function fmenuHome(interaction, ctx) {
  const manageable = resolveManageableOrgs(ctx);

  if (manageable.length === 0) {
    const orgs = repo.listOrgs(ctx.db);
    const hasMemberRole = orgs.some(o => hasRole(ctx.member, o.member_role_id));
    if (hasMemberRole) {
      return sendEphemeral(
        interaction,
        "⛔ Nu ai permisiuni",
        "⛔ Nu ai permisiuni de Lider/Co-Lider pentru a folosi /fmenu."
      );
    }
    if (ctx.perms.staff) {
      return sendEphemeral(
        interaction,
        "Nu ai rol de organizație",
        "Nu ești setat într-o organizație încă. Pentru configurare (organizații, roluri, canale) folosește **/famenu**."
      );
    }
    return sendEphemeral(
      interaction,
      "⛔ Nu ai permisiuni",
      "Ai nevoie de rolurile de **Lider** sau **Co-Lider** (și rolul organizației) ca să folosești **/fmenu**."
    );
  }

  if (manageable.length === 1) {
    return orgPanelView(interaction, ctx, manageable[0].org.id);
  }

  const options = manageable.map(m => ({
    label: `${m.org.name} (${humanKind(m.org.kind)})`,
    value: String(m.org.id),
    description: "Deschide meniul organizației"
  }));

  const emb = makeEmbed("Selectează organizația", "Ai acces la mai multe organizații. Alege una pentru a continua.");
  const menu = select("fmenu:pickorg", "Selectează organizația…", options);
  const row = new ActionRowBuilder().addComponents(menu);
  return sendEphemeral(interaction, emb.data.title, emb.data.description, [row]);
}

async function orgPanelView(interaction, ctx, orgId) {
  const org = repo.getOrg(ctx.db, orgId);
  if (!org) {
    return sendEphemeral(interaction, "Eroare", "Organizația nu a fost găsită (posibil coruptă).");
  }

  const manageable = resolveManageableOrgs(ctx).find(m => m.org.id === orgId);
  if (!manageable && !ctx.perms.staff) {
    return sendEphemeral(interaction, "⛔ Acces refuzat", "Nu ai acces la această organizație.");
  }

  const dbCount = repo.listMembersByOrg(ctx.db, orgId).length;
  const memberRole = org.member_role_id ? ctx.guild.roles.cache.get(org.member_role_id) : null;
  const discordCount = memberRole ? memberRole.members.size : 0;
  const emb = makeEmbed(
    `${org.name}`,
    `Tip: **${humanKind(org.kind)}**\nMembri (Discord): **${discordCount}**\nMembri (DB): **${dbCount}**\n\nAlege o acțiune:`
  );

  const actorRank = getOrgRank(ctx.member, org);
  const canSetRanks = ctx.perms.staff || actorRank === "LEADER";
  const buttons = [
    btn(`org:${orgId}:remove_pk`, "Remove (PK)", ButtonStyle.Danger, "💀"),
    btn(`org:${orgId}:add`, "Add membru", ButtonStyle.Success, "➕"),
    btn(`org:${orgId}:remove`, "Remove membru", ButtonStyle.Secondary, "➖"),
    btn(`org:${orgId}:roster`, "Roster", ButtonStyle.Secondary, "📋"),
    btn(`org:${orgId}:search`, "Search", ButtonStyle.Secondary, "🔎"),
    canSetRanks ? btn(`org:${orgId}:setrank`, "Set rank", ButtonStyle.Secondary, "🪪") : null,
    btn(`fmenu:back`, "Back", ButtonStyle.Secondary, "⬅️"),
  ];

  const rows = rowsFromButtons(buttons.filter(Boolean));
  return sendEphemeral(interaction, emb.data.title, emb.data.description, rows);
}

function addMembersModal(orgId) {
  return modal(`org:${orgId}:add_modal`, "Add membri", [
    input("users", "User ID-uri (multi-line)", 2, true, "Ex:\n123..."),
  ]);
}

function removeMembersModal(orgId, pk) {
  return modal(`org:${orgId}:${pk?'remove_pk':'remove'}_modal`, pk ? "Remove (PK)" : "Remove", [
    input("users", "User ID-uri (multi-line)", 2, true, "Ex:\n123..."),
  ]);
}

function searchModal(orgId) {
  return modal(`org:${orgId}:search_modal`, "Search player", [
    input("user", "User ID", undefined, true, "Ex: 123..."),
  ]);
}

function setRankModal(orgId) {
  return modal(`org:${orgId}:setrank_modal`, "Setează rank", [
    input("user", "User ID", undefined, true, "Ex: 123..."),
    input("rank", "Rank (MEMBER/LEADER/COLEADER)", undefined, true, "Ex: COLEADER")
  ]);
}

function normalizeDesiredRank(raw) {
  const s = String(raw || "").trim().toUpperCase();
  if (!s) return null;

  const cleaned = s
    .replace(/\s+/g, "_")
    .replace(/-/g, "_")
    .replace(/[^A-Z0-9_]/g, "")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");

  if (cleaned === "MEMBRU" || cleaned === "MEMBER") return "MEMBER";
  if (cleaned === "LIDER" || cleaned === "LEADER") return "LEADER";

  if (
    cleaned === "COLEADER" ||
    cleaned === "CO_LEADER" ||
    cleaned === "COLIDER" ||
    cleaned === "CO_LIDER" ||
    cleaned === "CO_LDR" ||
    cleaned === "CO_LEAD"
  ) return "COLEADER";

  return null;
}

function prettyRank(rank) {
  if (rank === "COLEADER") return "CO-LEADER";
  return String(rank || "—");
}

async function addToOrg(ctx, targetMember, orgId, role) {
  return withUserLock(targetMember.id, async () => {  const org = repo.getOrg(ctx.db, orgId);
  if (!org) {
    console.error(`[ADD] Org not found for orgId ${orgId}`);
    return { ok:false, msg:"Organizația nu există." };
  }

  const orgs = repo.listOrgs(ctx.db);
  const otherOrgRoles = orgs
    .filter(o => o.id !== org.id && o.member_role_id && targetMember.roles.cache.has(o.member_role_id))
    .map(o => o.name);
  if (otherOrgRoles.length && !ctx.perms.staff) {
    return { ok:false, msg:`Userul are deja rol(uri) de organizație: ${otherOrgRoles.join(", ")}.` };
  }

  const existing = repo.getMembership(ctx.db, targetMember.id);
  if (existing) {
    if (existing.org_id === orgId) {
      return { ok:false, msg:"Userul este deja în această organizație." };
    }
    const existingOrg = repo.getOrg(ctx.db, existing.org_id);
    return { ok:false, msg:`Userul este deja într-o altă organizație (${existingOrg?.name ?? existing.org_id}).` };
  }

  const pk = repo.getCooldown(ctx.db, targetMember.id, "PK");
  const ban = repo.getCooldown(ctx.db, targetMember.id, "BAN");
  if (ban && ban.expires_at > now()) {
    console.error(`[ADD] User ${targetMember.id} blocked by BAN cooldown`);
    return { ok:false, msg:"Userul este banat de la organizații (BAN)."};
  }
  if (pk && pk.expires_at > now()) {
    console.error(`[ADD] User ${targetMember.id} blocked by PK cooldown`);
    return { ok:false, msg:"Userul este în cooldown (PK)."};
  }

  if (ctx.settings.pkRole) await safeRoleRemove(targetMember, ctx.settings.pkRole, `Cleanup PK for ${targetMember.id}`);
  if (ctx.settings.banRole) await safeRoleRemove(targetMember, ctx.settings.banRole, `Cleanup BAN for ${targetMember.id}`);

  const orgRoleCheck = roleCheck(ctx, org.member_role_id, "membru");
  if (!orgRoleCheck.ok) return { ok:false, msg: orgRoleCheck.msg };
  const added = await safeRoleAdd(targetMember, org.member_role_id, `Add org role for ${targetMember.id}`);
  if (!added) return { ok:false, msg:"Nu pot adăuga rolul organizației (permisiuni lipsă)." };
  repo.upsertMembership(ctx.db, targetMember.id, orgId, role || "MEMBER");
  await audit(ctx, "➕ Membru adăugat", [
    `**Țintă:** <@${targetMember.id}> (\`${targetMember.id}\`)`,
    `**Organizație:** **${org.name}** (\`${orgId}\`)`,
    `**De către:** <@${ctx.uid}>`
  ].join("\n"), COLORS.SUCCESS);
  return { ok:true };
  });
}

async function removeFromOrg(ctx, targetMember, orgId, byUserId) {
  return withUserLock(targetMember.id, async () => {  const org = repo.getOrg(ctx.db, orgId);
  if (!org) {
    console.error(`[REMOVE] Org not found for orgId ${orgId}`);
    return { ok:false, msg:"Organizația nu există." };
  }
  const canManage = canManageTargetRank(ctx, org, targetMember);
  if (!canManage.ok) return { ok:false, msg: canManage.msg };
  const orgRoleCheck = roleCheck(ctx, org.member_role_id, "membru");
  if (!orgRoleCheck.ok) return { ok:false, msg: orgRoleCheck.msg };
  if (!targetMember.roles.cache.has(org.member_role_id)) {
    return { ok:false, msg:"Userul nu este membru în această organizație." };
  }
  const removed = await safeRoleRemove(targetMember, org.member_role_id, `Remove org role for ${targetMember.id}`);
  if (!removed) return { ok:false, msg:"Nu pot elimina rolul organizației (permisiuni lipsă)." };
  repo.removeMembership(ctx.db, targetMember.id);
  repo.upsertLastOrgState(ctx.db, targetMember.id, orgId, now(), byUserId);
  await audit(ctx, "🚪 Membru scos", [
    `**Țintă:** <@${targetMember.id}> (\`${targetMember.id}\`)`,
    `**Organizație:** **${org.name}** (\`${orgId}\`)`,
    `**De către:** <@${byUserId}>`
  ].join("\n"), COLORS.GLOBAL);
  return { ok:true };
  });
}

async function applyPk(ctx, targetMember, orgId, byUserId) {
  return withUserLock(targetMember.id, async () => {  const pkRole = ctx.settings.pkRole;
  if (!pkRole) {
    console.error("[PK] pk_role_id missing in settings");
    return { ok:false, msg:"PK role nu este setat." };
  }

  const existingPk = repo.getCooldown(ctx.db, targetMember.id, "PK");
  if (existingPk && existingPk.expires_at > now()) {
    return { ok:false, msg:"Userul este deja în cooldown (PK)." };
  }

  const org = repo.getOrg(ctx.db, orgId);
  if (org) {
    const inOrg = [org.member_role_id, org.leader_role_id, org.co_leader_role_id]
      .filter(Boolean)
      .some(rid => targetMember.roles.cache.has(rid));
    if (!inOrg) {
      await audit(ctx, "⛔ PK refuzat", [
        `**Țintă:** <@${targetMember.id}> (\`${targetMember.id}\`)`,
        `**Organizație:** **${org.name}** (\`${orgId}\`)`,
        `**Motiv:** userul nu are rolul organizației`,
        `**De către:** <@${byUserId}>`
      ].join("\n"), COLORS.ERROR);
      return { ok:false, msg:"Userul nu este în această organizație. Nu pot aplica PK." };
    }
    const canManage = canManageTargetRank(ctx, org, targetMember);
    if (!canManage.ok) return { ok:false, msg: canManage.msg };
    const roleIds = [org.member_role_id, org.leader_role_id, org.co_leader_role_id].filter(Boolean);
    for (const roleId of roleIds) {
      if (!targetMember.roles.cache.has(roleId)) continue;
      const check = roleCheck(ctx, roleId, "organizație");
      if (!check.ok) return { ok:false, msg: check.msg };
      const removed = await safeRoleRemove(targetMember, roleId, `PK remove org role ${roleId} for ${targetMember.id}`);
      if (!removed) return { ok:false, msg:"Nu pot elimina rolurile organizației (permisiuni lipsă)." };
    }
  } else {
    console.error(`[PK] Org not found for orgId ${orgId}`);
  }
  let durationMs = PK_MS;
  let stayedDays = null;
  if (org?.kind === "LEGAL") {
    const membership = repo.getMembership(ctx.db, targetMember.id);
    if (membership?.org_id === orgId && typeof membership.since_ts === "number") {
      stayedDays = Math.max(0, Math.floor((now() - membership.since_ts) / DAY_MS));
      const remainingDays = LEGAL_MIN_DAYS - stayedDays;
      if (remainingDays > 0) {
        durationMs = remainingDays * DAY_MS;
      }
    }
  }

  const expiresAt = now() + durationMs;
  repo.upsertCooldown(ctx.db, targetMember.id, "PK", expiresAt, orgId, now());
  repo.removeMembership(ctx.db, targetMember.id);
  repo.upsertLastOrgState(ctx.db, targetMember.id, orgId, now(), byUserId);

  const addedPk = await safeRoleAdd(targetMember, pkRole, `Apply PK for ${targetMember.id}`);
  if (!addedPk) return { ok:false, msg:"Nu pot aplica rolul PK (permisiuni lipsă)." };
  await audit(ctx, "⏳ Remove + PK", [
    `**Țintă:** <@${targetMember.id}> (\`${targetMember.id}\`)`,
    `**Organizație:** **${org?.name ?? orgId}** (\`${orgId}\`)`,
    ...(stayedDays !== null ? [
      `**Regulă LEGAL:** durată ajustată la minimul de ${LEGAL_MIN_DAYS} zile`,
      `**Stat în org:** **${stayedDays}** zile`,
      `**Durată PK:** **${Math.ceil(durationMs / DAY_MS)}** zile`
    ] : []),
    `**Expiră:** ${formatRel(expiresAt)}`,
    `**De către:** <@${byUserId}>`
  ].join("\n"), COLORS.COOLDOWN);
  return { ok:true };
  });
}

async function setMemberRank(ctx, targetMember, orgId, desiredRank) {
  return withUserLock(targetMember.id, async () => {  const org = repo.getOrg(ctx.db, orgId);
  if (!org) {
    console.error(`[RANK] Org not found for orgId ${orgId}`);
    return { ok:false, msg:"Organizația nu există." };
  }
  if (!ctx.perms.staff && getOrgRank(ctx.member, org) !== "LEADER") {
    return { ok:false, msg:"Doar liderul poate schimba rank-urile în organizație." };
  }
  const rankCheck = canSetRank(ctx, org, desiredRank, targetMember);
  if (!rankCheck.ok) return { ok:false, msg: rankCheck.msg };

  const memberRoleCheck = roleCheck(ctx, org.member_role_id, "membru");
  if (!memberRoleCheck.ok) return { ok:false, msg: memberRoleCheck.msg };
  if (!targetMember.roles.cache.has(org.member_role_id)) {
    const addedMember = await safeRoleAdd(targetMember, org.member_role_id, `Ensure org role for ${targetMember.id}`);
    if (!addedMember) return { ok:false, msg:"Nu pot adăuga rolul organizației (permisiuni lipsă)." };
    repo.upsertMembership(ctx.db, targetMember.id, orgId, "MEMBER");
  }

  const leaderRoleCheck = org.leader_role_id ? roleCheck(ctx, org.leader_role_id, "leader") : null;
  const coLeaderRoleCheck = org.co_leader_role_id ? roleCheck(ctx, org.co_leader_role_id, "co-leader") : null;
  if (org.leader_role_id && !leaderRoleCheck?.ok) return { ok:false, msg: leaderRoleCheck.msg };
  if (org.co_leader_role_id && !coLeaderRoleCheck?.ok) return { ok:false, msg: coLeaderRoleCheck.msg };

  if (desiredRank === "LEADER") {
    if (org.co_leader_role_id) {
      await safeRoleRemove(targetMember, org.co_leader_role_id, `Unset co-leader for ${targetMember.id}`);
    }
    const added = await safeRoleAdd(targetMember, org.leader_role_id, `Set leader for ${targetMember.id}`);
    if (!added) return { ok:false, msg:"Nu pot seta rolul de Leader (permisiuni lipsă)." };
  } else if (desiredRank === "COLEADER") {
    if (!org.co_leader_role_id) return { ok:false, msg:"Rolul de Co-Leader nu este setat." };
    if (!ctx.perms.staff && String(org.kind).toUpperCase() !== "LEGAL") {
      await fetchMembersWithRetry(ctx.guild, "RANK_CAP");

      const alreadyCo = targetMember.roles.cache.has(org.co_leader_role_id);
      let discordCount = 0;
      const coLeaderRole = ctx.guild.roles.cache.get(org.co_leader_role_id);
      if (coLeaderRole) {
        discordCount = coLeaderRole.members.filter(m => !m.user?.bot).size;
      }

      const dbCount = repo
        .listMembersByOrg(ctx.db, orgId)
        .filter(r => {
          const role = String(r.role || "").toUpperCase();
          return role === "COLEADER" || role === "CO_LEADER";
        }).length;

      const current = Math.max(discordCount, dbCount);
      if (!alreadyCo && current >= 2) {
        return { ok:false, msg:"În organizațiile **ilegale** sunt permise maxim **2** roluri de **Co-Leader**." };
      }
    }
if (org.leader_role_id) {
      await safeRoleRemove(targetMember, org.leader_role_id, `Unset leader for ${targetMember.id}`);
    }
    const added = await safeRoleAdd(targetMember, org.co_leader_role_id, `Set co-leader for ${targetMember.id}`);
    if (!added) return { ok:false, msg:"Nu pot seta rolul de Co-Leader (permisiuni lipsă)." };
  } else {
    if (org.leader_role_id) {
      await safeRoleRemove(targetMember, org.leader_role_id, `Unset leader for ${targetMember.id}`);
    }
    if (org.co_leader_role_id) {
      await safeRoleRemove(targetMember, org.co_leader_role_id, `Unset co-leader for ${targetMember.id}`);
    }
  }

  repo.upsertMembership(ctx.db, targetMember.id, orgId, desiredRank);

  await audit(ctx, "🎖️ Rank actualizat", [
    `**Țintă:** <@${targetMember.id}> (\`${targetMember.id}\`)`,
    `**Organizație:** **${org.name}** (\`${orgId}\`)`,
    `**Rank nou:** **${prettyRank(desiredRank)}**`,
    `**De către:** <@${ctx.uid}>`
  ].join("\n"), COLORS.GLOBAL);
  return { ok:true };
  });
}

async function rosterView(interaction, ctx, orgId, useEditReply = false) {
  const org = repo.getOrg(ctx.db, orgId);
  if (!org) {
    const emb = makeEmbed("Eroare", "Organizația nu există.");
    return useEditReply
      ? interaction.editReply({ embeds: [emb] })
      : sendEphemeral(interaction, emb.data.title, emb.data.description);
  }

  if (!org.member_role_id) {
    const emb = makeEmbed("Eroare", "Organizația nu are setat rolul de membru.");
    return useEditReply
      ? interaction.editReply({ embeds: [emb] })
      : sendEphemeral(interaction, emb.data.title, emb.data.description);
  }

  const memberRole = ctx.guild.roles.cache.get(org.member_role_id);
  if (!memberRole) {
    const emb = makeEmbed("Eroare", "Rolul de membru nu există pe server.");
    return useEditReply
      ? interaction.editReply({ embeds: [emb] })
      : sendEphemeral(interaction, emb.data.title, emb.data.description);
  }

  const cached = rosterCache.get(orgId);
  if (cached && Date.now() - cached.ts < ROSTER_CACHE_MS) {
    const emb = makeEmbed(cached.title, cached.desc);
    const buttons = [btn(`org:${orgId}:back`, "Back", ButtonStyle.Secondary, "⬅️")];
    return useEditReply
      ? interaction.editReply({ embeds: [emb], components: rowsFromButtons(buttons) })
      : sendEphemeral(interaction, emb.data.title, emb.data.description, rowsFromButtons(buttons));
  }

  const leaderRole = org.leader_role_id ? ctx.guild.roles.cache.get(org.leader_role_id) : null;
  const coLeaderRole = org.co_leader_role_id ? ctx.guild.roles.cache.get(org.co_leader_role_id) : null;

  const entries = [];
  for (const m of memberRole.members.values()) {
    let label = "Membru";
    if (leaderRole && m.roles.cache.has(leaderRole.id)) label = leaderRole.name;
    else if (coLeaderRole && m.roles.cache.has(coLeaderRole.id)) label = coLeaderRole.name;

    entries.push({
      id: m.id,
      label,
      order: label === leaderRole?.name ? 0 : label === coLeaderRole?.name ? 1 : 2
    });
  }

  entries.sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));

  const lines = entries.map(e => `• <@${e.id}> — **${e.label}**`);
  const shown = lines.slice(0, 100);
  const extra = lines.length > 100
    ? `\n... și încă ${lines.length - 100} membri`
    : "";

  const countLine = `**Membri:** **${lines.length}**`;
  const listPart = shown.length ? `${shown.join("\n")}${extra}` : "Nu există membri în organizație.";
  const desc = `${countLine}\n\n${listPart}`;

  const title = `Roster — ${org.name}`;
  rosterCache.set(orgId, { ts: Date.now(), title, desc });

  const emb = makeEmbed(title, desc, COLORS.GLOBAL);
  const buttons = [btn(`org:${orgId}:back`, "Back", ButtonStyle.Secondary, "⬅️")];

  if (useEditReply) {
    return interaction.editReply({ embeds: [emb], components: rowsFromButtons(buttons) });
  }
  return sendEphemeral(interaction, emb.data.title, emb.data.description, rowsFromButtons(buttons));
}

async function searchResult(interaction, ctx, orgId, userId) {
  const target = await ctx.guild.members.fetch(userId).catch(()=>null);
  const pk = repo.getCooldown(ctx.db, userId, "PK");
  const ban = repo.getCooldown(ctx.db, userId, "BAN");
  const member = repo.getMembership(ctx.db, userId);
  const last = repo.getLastOrgState(ctx.db, userId);

  const lines = [];
  lines.push(`User: ${target ? `<@${userId}>` : `\`${userId}\``}`);
  if (ban && ban.expires_at > now()) lines.push(`Status: **BAN** (expiră <t:${Math.floor(ban.expires_at/1000)}:R>)`);
  else if (pk && pk.expires_at > now()) lines.push(`Status: **PK cooldown** (expiră <t:${Math.floor(pk.expires_at/1000)}:R>)`);
  else lines.push("Status: **Free**");
  if (member) {
    lines.push(`În organizație: **Da**`);
  } else {
    lines.push("În organizație: **Nu**");
  }
  if (last?.last_left_at) {
    lines.push(`Ultima plecare din org: <t:${Math.floor(last.last_left_at/1000)}:R>`);
  } else {
    lines.push("Ultima plecare din org: —");
  }

  if (ctx.perms.staff) {
    if (member) {
      const org = repo.getOrg(ctx.db, member.org_id);
      lines.push(`Org curentă: **${org?.name ?? member.org_id}**`);
    }
    if (last?.last_org_id) {
      const lastOrg = repo.getOrg(ctx.db, last.last_org_id);
      lines.push(`Ultima org: **${lastOrg?.name ?? last.last_org_id}**`);
    }
    if (last?.last_removed_by) {
      lines.push(`Scos de: <@${last.last_removed_by}>`);
    }
  }

  const emb = makeEmbed("Search", lines.join("\n"));
  const buttons = [btn(`org:${orgId}:back`, "Back", ButtonStyle.Secondary, "⬅️")];
  return sendEphemeral(interaction, emb.data.title, emb.data.description, rowsFromButtons(buttons));
}

function collectUsersFromOptions(interaction, max = 8) {
  const keys = ["user", ...Array.from({ length: max - 1 }, (_, i) => `user${i + 2}`)];
  const users = keys.map(k => interaction.options.getUser(k)).filter(Boolean);

  const seen = new Set();
  return users.filter(u => (seen.has(u.id) ? false : (seen.add(u.id), true)));
}

function compactResultLines(lines, maxLines = 10) {
  if (!Array.isArray(lines) || lines.length === 0) return "—";
  if (lines.length <= maxLines) return lines.join("\n");
  const head = lines.slice(0, maxLines);
  return `${head.join("\n")}\n… și încă **${lines.length - maxLines}**`;
}

async function slashAddCommand(interaction, ctx) {
  const users = collectUsersFromOptions(interaction, 8);

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const orgId = await resolveOrgForAddSlash(interaction, ctx);
  if (!orgId) return;

  const org = repo.getOrg(ctx.db, orgId);
  const orgName = org?.name ?? String(orgId);

  let ok = 0, fail = 0;
  const lines = [];

  for (const user of users) {
    const targetMember = await fetchTargetMember(ctx, user.id);
    if (!targetMember) {
      fail++;
      lines.push(`❌ <@${user.id}> — nu este în guild`);
      continue;
    }

    const res = await addToOrg(ctx, targetMember, orgId, "MEMBER");
    if (!res.ok) {
      fail++;
      lines.push(`❌ <@${user.id}> — ${res.msg || "adăugarea a eșuat"}`);
      continue;
    }

    ok++;
    lines.push(`✅ <@${user.id}> — adăugat`);
  }

  const title = ok > 1 ? "Membri adăugați" : "Membru adăugat";
  const desc = [
    `🏢 Organizație: **${orgName}**`,
    `✅ Reușit: **${ok}** • ❌ Eșuat: **${fail}**`,
    "",
    compactResultLines(lines, 10),
  ].join("\n");

  return interaction.editReply({ embeds: [makeBrandedEmbed(ctx, title, desc)] });
}

async function slashRmvCommand(interaction, ctx) {
  const user = interaction.options.getUser("user", true);
  const pk = interaction.options.getBoolean("pk") || false;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const targetMember = await fetchTargetMember(ctx, user.id);
  if (!targetMember) {
    return interaction.editReply({ embeds: [makeBrandedEmbed(ctx, "Eroare", "Nu pot găsi userul în guild.")] });
  }

  const orgId = await resolveOrgForRmvSlash(interaction, ctx, targetMember);
  if (!orgId) return;

  const res = pk
    ? await applyPk(ctx, targetMember, orgId, ctx.uid)
    : await removeFromOrg(ctx, targetMember, orgId, ctx.uid);

  if (!res.ok) {
    return interaction.editReply({ embeds: [makeBrandedEmbed(ctx, "Eroare", res.msg || "Acțiunea a eșuat.")] });
  }

  const org = repo.getOrg(ctx.db, orgId);
  const title = pk ? "Remove (PK)" : "Membru scos";
  const extra = pk ? "\nPK aplicat conform regulilor organizației." : "";
  return interaction.editReply({ embeds: [makeBrandedEmbed(ctx, title, `User: <@${user.id}> | Org: **${org?.name ?? orgId}**${extra}`)] });
}

export async function handleFmenuCommand(interaction, ctx) {
  return fmenuHome(interaction, ctx);
}

export async function handleAddCommand(interaction, ctx) {
  return slashAddCommand(interaction, ctx);
}

export async function handleRmvCommand(interaction, ctx) {
  return slashRmvCommand(interaction, ctx);
}

export async function handleFmenuComponent(interaction, ctx) {
  const id = interaction.customId;

  if (interaction.isStringSelectMenu()) {
    if (id === "fmenu:pickorg") {
      const orgId = Number(interaction.values[0]);
      return orgPanelView(interaction, ctx, orgId);
    }
    return;
  }

  if (!interaction.isButton()) return;

  if (id.startsWith("fmenu:open:")) {
    const orgId = Number(id.split(":")[2]);
    return orgPanelView(interaction, ctx, orgId);
  }

  if (id === "fmenu:back") return fmenuHome(interaction, ctx);

  if (id.startsWith("org:")) {
    const parts = id.split(":");
    const orgId = Number(parts[1]);
    const action = parts[2];

    if (action === "back") return orgPanelView(interaction, ctx, orgId);
    if (action === "add") return showModalSafe(interaction, addMembersModal(orgId));
    if (action === "remove") return showModalSafe(interaction, removeMembersModal(orgId, false));
    if (action === "remove_pk") return showModalSafe(interaction, removeMembersModal(orgId, true));
    if (action === "roster") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      return rosterView(interaction, ctx, orgId, true);
    }
    if (action === "search") return showModalSafe(interaction, searchModal(orgId));
    if (action === "setrank") return showModalSafe(interaction, setRankModal(orgId));
  }

  return sendEphemeral(interaction, "Eroare", "Acțiune necunoscută.");
}

export async function handleFmenuModal(interaction, ctx) {
  const id = interaction.customId;

  if (id.endsWith(":add_modal")) {
    const orgId = Number(id.split(":")[1]);
    const users = parseUserIds(interaction.fields.getTextInputValue("users"));
    if (!users.length) return sendEphemeral(interaction, "Eroare", "Nu am găsit User ID-uri valide.");
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    let ok = 0, bad = 0;
    const errors = [];
    for (const uid of users) {
      const m = await ctx.guild.members.fetch(uid).catch((err) => {
        console.error(`[ADD] fetch member failed for ${uid}:`, err);
        return null;
      });
      if (!m) { bad++; errors.push("Nu pot găsi userul în guild."); continue; }
      const res = await addToOrg(ctx, m, orgId, "MEMBER");
      if (res.ok) ok++;
      else {
        bad++;
        if (res.msg) errors.push(res.msg);
      }
    }
    const note = bad > 0 && errors.length ? `\nMotiv principal: ${errors[0]}` : "";
    return interaction.editReply({ embeds: [makeBrandedEmbed(ctx, "Rezultat", `Adăugați: **${ok}** | Eșuați: **${bad}**${note}`)] });
  }

  if (id.endsWith(":remove_modal") || id.endsWith(":remove_pk_modal")) {
    const parts = id.split(":");
    const orgId = Number(parts[1]);
    const pk = id.includes(":remove_pk_modal");
    const users = parseUserIds(interaction.fields.getTextInputValue("users"));
    if (!users.length) return sendEphemeral(interaction, "Eroare", "Nu am găsit User ID-uri valide.");
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    let ok = 0, bad = 0;
    const errors = [];
    for (const uid of users) {
      const m = await ctx.guild.members.fetch(uid).catch((err) => {
        console.error(`[RMV] fetch member failed for ${uid}:`, err);
        return null;
      });
      if (!m) { bad++; errors.push("Nu pot găsi userul în guild."); continue; }

      const res = pk
        ? await applyPk(ctx, m, orgId, ctx.uid)
        : await removeFromOrg(ctx, m, orgId, ctx.uid);

      if (res.ok) ok++;
      else {
        bad++;
        if (res.msg) errors.push(res.msg);
      }
    }
    const note = bad > 0 && errors.length ? `\nMotiv principal: ${errors[0]}` : "";
    const title = pk ? "Rezultat (Remove + PK)" : "Rezultat (Remove)";
    return interaction.editReply({ embeds: [makeBrandedEmbed(ctx, title, `Scoși: **${ok}** | Eșuați: **${bad}**${note}`)] });
  }

  if (id.endsWith(":search_modal")) {
    const orgId = Number(id.split(":")[1]);
    const q = interaction.fields.getTextInputValue("user")?.trim();
    if (!q) return sendEphemeral(interaction, "Eroare", "Query lipsă.");
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    return searchResult(interaction, ctx, orgId, q);
  }

  if (id.endsWith(":setrank_modal")) {
    const orgId = Number(id.split(":")[1]);
    const user = interaction.fields.getTextInputValue("user")?.trim();
    const rankRaw = interaction.fields.getTextInputValue("rank")?.trim();
    const rank = normalizeDesiredRank(rankRaw);
    const uid = user?.replace(/[<@!>]/g, "").trim();
    if (!uid || !/^\d{15,25}$/.test(uid)) return sendEphemeral(interaction, "Eroare", "User invalid.");
    if (!rank) return sendEphemeral(interaction, "Eroare", "Rank invalid. Folosește MEMBER/LEADER/COLEADER.");

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const member = await ctx.guild.members.fetch(uid).catch(()=>null);
    if (!member) return interaction.editReply({ embeds: [makeBrandedEmbed(ctx, "Eroare", "Nu pot găsi userul în guild.")] });

    const res = await setMemberRank(ctx, member, orgId, rank, ctx.uid);
    if (!res.ok) return interaction.editReply({ embeds: [makeBrandedEmbed(ctx, "Eroare", res.msg || "Acțiunea a eșuat.")] });

    const org = repo.getOrg(ctx.db, orgId);
    return interaction.editReply({ embeds: [makeBrandedEmbed(ctx, "Rank setat", `User: <@${uid}> | Org: **${org?.name ?? orgId}** | Rank: **${prettyRank(rank)}**`)] });
  }

  return sendEphemeral(interaction, "Eroare", "Modal necunoscut.");
}
