import crypto from "crypto";
import { ButtonStyle, EmbedBuilder, MessageFlags } from "discord.js";

import { setSetting } from "../../db/db.js";
import * as repo from "../../db/repo.js";
import { parseUserIds, humanKind } from "../../util/access.js";
import { makeEmbed, btn, rowsFromButtons, select, modal, input } from "../../ui/ui.js";
import { COLORS } from "../../ui/theme.js";
import { applyBranding } from "../../ui/brand.js";

import {
  now,
  PK_MS,
  DAY_MS,
  LEGAL_MIN_DAYS,
  sendEphemeral,
  makeBrandedEmbed,
  audit,
  formatRel,
  parseYesNo,
  parseDurationMs,
  fetchMembersWithRetry,
  roleCheck,
  safeRoleAdd,
  safeRoleRemove,
  requireStaff,
  requireConfigManager,
  requireSupervisorOrOwner,
  requireCreateOrg,
  showModalSafe
} from "./shared.js";

function safe(v) {
  return v && String(v).trim() ? String(v).trim() : "—";
}

function yn(v) {
  return v ? "✅" : "❌";
}

function buildWarnEmbed({
  orgName,
  orgRoleId,
  reason,
  dreptPlata,
  sanctiune,
  expiresAt,
  warnId,
  status = "ACTIVE",
  durationDays = null
}) {
  const orgLabel = orgRoleId ? `<@&${orgRoleId}>` : safe(orgName);

  const isDeleted = String(status).toUpperCase() !== "ACTIVE";
  const statusText = isDeleted ? "❌ ȘTEARSĂ" : "✅ VALIDĂ";
  const expText = isDeleted
    ? "Expirată"
    : (expiresAt ? formatRel(expiresAt) : "—");

  const emb = makeEmbed("⚠️ Mafia WARN", "");

  emb.addFields(
    { name: "🏢 Organizație", value: orgLabel, inline: true },
    { name: "📌 Status", value: `**${statusText}**`, inline: true },
    { name: "⏳ Expiră", value: expText, inline: true }
  );

  const descLines = [
    `🧾 **Motiv:** ${safe(reason)}`,
    `⚖️ **Sancțiune:** ${safe(sanctiune)}`,
    `💳 **Drept plată:** ${yn(dreptPlata)}`,
    durationDays ? `📅 **Durată:** **${Number(durationDays)}** zile` : null,
  ].filter(Boolean);

  emb.setDescription(descLines.join("\n"));

  if (warnId) emb.setFooter({ text: `WARN ID: ${warnId}` });
  return emb;
}

function generateWarnId() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "W-";
  for (let i = 0; i < 6; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

function orgCreateModal() {
  return modal("famenu:createorg", "Create organizatie", [
    input("name", "Nume organizație", undefined, true, "Ex: Ballas / LSPD"),
    input("kind", "Tip (ILLEGAL sau LEGAL)", undefined, true, "ILLEGAL / LEGAL"),
    input("member_role_id", "Member role ID (rolul organizației)", undefined, true, "Rolul Ballas / LSPD"),
    input("leader_role_id", "Leader role ID", undefined, true, "Ex: Leader Organizatie / Chestor"),
    input("co_leader_role_id", "Co-Leader role ID (opțional)", undefined, false, "Ex: Co-Lider / HR"),
  ]);
}

function configAccessRolesView(ctx) {
  const emb = makeEmbed("Roluri", "Setează rolurile de acces.");
  const lines = [
    `Admin: ${ctx.settings.adminRole ? `<@&${ctx.settings.adminRole}>` : "(unset)"}`,
    `Supervisor: ${ctx.settings.supervisorRole ? `<@&${ctx.settings.supervisorRole}>` : "(unset)"}`,
    `Config: ${ctx.settings.configRole ? `<@&${ctx.settings.configRole}>` : "(unset)"}`,
    `PK Role: ${ctx.settings.pkRole ? `<@&${ctx.settings.pkRole}>` : "(unset)"}`,
    `Ban Role: ${ctx.settings.banRole ? `<@&${ctx.settings.banRole}>` : "(unset)"}`
  ];
  emb.setDescription(emb.data.description + "\n\n" + lines.join("\n"));

  const buttons = [
    btn("famenu:setrole:admin", "Set Admin", ButtonStyle.Secondary),
    btn("famenu:setrole:supervisor", "Set Fac-Supervisor", ButtonStyle.Secondary),
    btn("famenu:setrole:config", "Set Config Acc", ButtonStyle.Secondary),
    btn("famenu:setrole:pk", "Set PK", ButtonStyle.Secondary),
    btn("famenu:setrole:ban", "Set Ban", ButtonStyle.Secondary),
    btn("famenu:back", "Back", ButtonStyle.Secondary, "⬅️"),
  ];
  return { emb, rows: rowsFromButtons(buttons) };
}

function configIssues(ctx) {
  const issues = [];
  const channelChecks = [
    ["audit", ctx.settings.audit],
    ["warn", ctx.settings.warn],
    ["bot", ctx.settings.botChannel]
  ];
  for (const [label, id] of channelChecks) {
    if (!id) {
      issues.push(`Canal ${label}: lipsă`);
      continue;
    }
    const channel = ctx.guild.channels.cache.get(id);
    if (!channel) issues.push(`Canal ${label}: nu a fost găsit`);
  }

  const roleChecks = [
    ["admin", ctx.settings.adminRole],
    ["supervisor", ctx.settings.supervisorRole],
    ["pk", ctx.settings.pkRole],
    ["ban", ctx.settings.banRole]
  ];
  for (const [label, id] of roleChecks) {
    if (!id) {
      issues.push(`Rol ${label}: lipsă`);
      continue;
    }
    const role = ctx.guild.roles.cache.get(id);
    if (!role) issues.push(`Rol ${label}: nu a fost găsit`);
  }

  return issues;
}

function configChannelsView(ctx) {
  const emb = makeEmbed("Canale", "Setează canalele botului.");
  const lines = [
    `Audit: ${ctx.settings.audit ? `<#${ctx.settings.audit}>` : "(unset)"}`,
    `Warn: ${ctx.settings.warn ? `<#${ctx.settings.warn}>` : "(unset)"}`,
    `Bot Channel: ${ctx.settings.botChannel ? `<#${ctx.settings.botChannel}>` : "(unset)"}`
  ];
  emb.setDescription(emb.data.description + "\n\n" + lines.join("\n"));

  const buttons = [
    btn("famenu:setchannel:audit", "Set Logs", ButtonStyle.Secondary),
    btn("famenu:setchannel:warn", "Set Warn", ButtonStyle.Secondary),
    btn("famenu:setchannel:bot", "Set Bot Channel", ButtonStyle.Secondary),
    btn("famenu:back", "Back", ButtonStyle.Secondary, "⬅️"),
  ];
  return { emb, rows: rowsFromButtons(buttons) };
}

async function famenuHome(interaction, ctx) {
  const canStaff = requireStaff(ctx);
  const canConfig = requireConfigManager(ctx);

  if (!canStaff && !canConfig) {
    return sendEphemeral(interaction, "⛔ Acces refuzat", "Doar Owner/Admin/Supervisor (sau acces din Config) pot folosi /famenu.");
  }

  const c = repo.counts(ctx.db);
  const emb = makeEmbed("Admin", `Organizații: **${c.orgs}** · Membri: **${c.members}** · PK: **${c.pk}** · Ban: **${c.bans}**

Alege un modul:`);

  const buttons = [
    canStaff ? btn("famenu:orgs", "Organizații", ButtonStyle.Primary, "🏛️") : null,
    canConfig ? btn("famenu:config", "Config", ButtonStyle.Secondary, "⚙️") : null,
    canStaff ? btn("famenu:diag", "Diagnostic", ButtonStyle.Secondary, "🩺") : null,
    (canStaff && requireSupervisorOrOwner(ctx)) ? btn("famenu:warns", "Warns", ButtonStyle.Secondary, "⚠️") : null,
    canStaff ? btn("famenu:cooldowns", "Cooldowns", ButtonStyle.Secondary, "⏳") : null
  ];
  const rows = rowsFromButtons(buttons.filter(Boolean));
  return sendEphemeral(interaction, emb.data.title, emb.data.description, rows);
}

async function famenuConfig(interaction, ctx) {
  if (!requireConfigManager(ctx)) return sendEphemeral(interaction, "⛔ Acces refuzat", "Doar owner sau rolul de config poate modifica configurările.");
  const issues = configIssues(ctx);
  const desc = [
    "Setează roluri si canale.",
    issues.length ? `\n⚠️ Probleme detectate:\n- ${issues.join("\n- ")}` : "\n✅ Configurarea pare completă."
  ].join("\n");
  const emb = makeEmbed("Config", desc);
  const buttons = [
    btn("famenu:config:roles", "Roluri de acces", ButtonStyle.Secondary, "🔐"),
    btn("famenu:config:channels", "Canale", ButtonStyle.Secondary, "📣"),
    btn("famenu:back", "Back", ButtonStyle.Secondary, "⬅️"),
  ];
  return sendEphemeral(interaction, emb.data.title, emb.data.description, rowsFromButtons(buttons));
}

async function famenuOrgs(interaction, ctx) {
  if (!ctx.perms.staff) return sendEphemeral(interaction, "⛔ Acces refuzat", "Nu ai acces.");
  const orgs = repo.listOrgs(ctx.db);
  const desc = orgs.length
    ? orgs.map(o => {
        const count = o.member_role_id ? (ctx.guild.roles.cache.get(o.member_role_id)?.members.size ?? 0) : 0;
        return `• **${o.name}** · ${humanKind(o.kind)} · ID: \`${o.id}\` · Membri: **${count}**`;
      }).join("\n")
    : "Nu există organizații încă.";
  const emb = makeEmbed("Organizații", desc);

  const buttons = [
    requireCreateOrg(ctx) ? btn("famenu:createorg", "Create", ButtonStyle.Success, "➕") : null,
    requireSupervisorOrOwner(ctx) ? btn("famenu:deleteorg", "Delete", ButtonStyle.Danger, "🗑️") : null,
    btn("famenu:back", "Back", ButtonStyle.Secondary, "⬅️")
  ];
  return sendEphemeral(interaction, emb.data.title, emb.data.description, rowsFromButtons(buttons.filter(Boolean)));
}

function setRoleModal(which) {
  const map = {
    admin: "admin_role_id",
    supervisor: "supervisor_role_id",
    config: "config_role_id",
    pk: "pk_role_id",
    ban: "ban_role_id",
  };
  const key = map[which];
  return modal(`famenu:setrole_modal:${which}`, "Set Role ID", [
    input("role_id", "Role ID ", undefined, true, "Ex: 123")
  ]);
}

function setChannelModal(which) {
  return modal(`famenu:setchannel_modal:${which}`, "Set Channel ID", [
    input("channel_id", "Channel ID ", undefined, true, "Ex: 123")
  ]);
}

function warnsView(ctx) {
  const emb = makeEmbed("Warns", "Gestionare warn-uri (Faction-Supervisor/Fondator).");
  const buttons = [
    btn("famenu:warn_add", "Adaugă warn", ButtonStyle.Primary, "➕"),
    btn("famenu:warn_remove", "Șterge warn", ButtonStyle.Secondary, "🗑️"),
    btn("famenu:warn_list", "Listă active", ButtonStyle.Secondary, "📋"),
    btn("famenu:back", "Back", ButtonStyle.Secondary, "⬅️")
  ];
  return { emb, rows: rowsFromButtons(buttons) };
}

function cooldownAddModal() {
  return modal("famenu:cooldown_add_modal", "Adaugă cooldown", [
    input("user_id", "User ID", undefined, true, "Ex: 123 (poți lipi @mention)"),
    input("kind", "Tip (PK/BAN)", undefined, true, "PK sau BAN"),
    input("duration", "Durată (ex: 30s, 10m, 1d, 1y)", undefined, true, "30s / 10m / 1d")
  ]);
}

function cooldownRemoveModal() {
  return modal("famenu:cooldown_remove_modal", "Șterge cooldown", [
    input("user_id", "User ID", undefined, true, "Ex: 123 (poți lipi @mention)"),
    input("kind", "Tip (PK/BAN)", undefined, true, "PK sau BAN")
  ]);
}

function warnAddModalForm() {
  return modal("famenu:warn_add_modal", "Adaugă WARN", [
    input("org_id", "Organizație (ID)", undefined, true, "Ex: 12 (din lista Organizații)"),
    input("reason", "Motiv", undefined, true, "Ex: 2 mafii la bătaie"),
    input("drept_plata", "Drept plată (DA/NU)", undefined, true, "DA / NU"),
    input("sanctiune", "Sancțiune oferită", undefined, true, "Ex: 1/3 Mafia Warn"),
    input("durata_zile", "Durată (zile)", undefined, true, "Ex: 90 (3 luni) / 120 (4 luni)")
  ]);
}

function cooldownsAdminView(ctx) {
  const emb = makeEmbed("Cooldowns", "Gestionează cooldown-uri.");
  const buttons = [
    btn("famenu:cooldown_add", "Adaugă cooldown", ButtonStyle.Primary, "➕"),
    btn("famenu:cooldown_remove", "Șterge cooldown", ButtonStyle.Secondary, "🗑️"),
    btn("famenu:cooldown_list", "Cooldown-uri active", ButtonStyle.Secondary, "📋"),
    btn("famenu:back", "Back", ButtonStyle.Secondary, "⬅️")
  ];
  return { emb, rows: rowsFromButtons(buttons) };
}


function cooldownsActiveView(ctx) {
  const nowTs = now();
  const pkRows = repo.listCooldowns(ctx.db, "PK").filter(r => Number(r.expires_at) > nowTs);
  const banRows = repo.listCooldowns(ctx.db, "BAN").filter(r => Number(r.expires_at) > nowTs);

  const fmt = (r) => {
    const exp = r.expires_at ? formatRel(r.expires_at) : "—";
    return `• <@${r.user_id}> — **${r.kind}** • Expiră: ${exp}`;
  };

  const parts = [];

  const pkCap = 20;
  parts.push(`**PK (${pkRows.length})**`);
  parts.push(pkRows.length ? pkRows.slice(0, pkCap).map(fmt).join("\n") : "—");
  if (pkRows.length > pkCap) parts.push(`… și încă **${pkRows.length - pkCap}**.`);

  const banCap = 20;
  parts.push(`
**BAN (${banRows.length})**`);
  parts.push(banRows.length ? banRows.slice(0, banCap).map(fmt).join("\n") : "—");
  if (banRows.length > banCap) parts.push(`… și încă **${banRows.length - banCap}**.`);

  const emb = makeEmbed("⏳ Cooldown-uri active", parts.join("\n"));
  const buttons = [
    btn("famenu:cooldowns", "Back", ButtonStyle.Secondary, "⬅️"),
    btn("famenu:back", "Home", ButtonStyle.Secondary, "🏠")
  ];
  return { emb, rows: rowsFromButtons(buttons) };
}

function warnRemoveModal() {
  return modal("famenu:warn_remove_modal", "Șterge warn", [
    input("warn_id", "Warn ID", undefined, true, "Ex: UUID"),
    input("reason", "Motiv (opțional)", undefined, false, "Ex: anulare")
  ]);
}

function deleteOrgModal() {
  return modal("famenu:deleteorg_modal", "Delete organizatie", [
    input("org_id", "Org ID", undefined, true, "ID din lista Organizații"),
    input("reason", "Motiv (opțional)", undefined, false, "Ex: desființare")
  ]);
}
function max0(n) { return n < 0 ? 0 : n; }

async function forcePkAndRemoveOrgRoles(ctx, member, org, orgId, byUserId) {
  const pkRole = ctx.settings.pkRole;
  if (!pkRole) return { ok:false, pkOk:false, rolesOk:false, msg:"PK role nu este setat." };

  const roleIds = [org.member_role_id, org.leader_role_id, org.co_leader_role_id].filter(Boolean);

  let rolesOk = true;
  const roleErrors = [];
  for (const rid of roleIds) {
    if (member.roles.cache.has(rid)) {
      const removed = await safeRoleRemove(member, rid, `ORG DELETE remove role ${rid} for ${member.id}`);
      if (!removed) {
        rolesOk = false;
        roleErrors.push(`nu pot scoate rolul <@&${rid}>`);
      }
    }
  }

  const nowTs = now();
  const existing = repo.getCooldown(ctx.db, member.id, "PK");
  let durationMs = PK_MS;

  if (String(org.kind || "").toUpperCase() === "LEGAL") {
    const membership = repo.getMembership(ctx.db, member.id);
    if (membership?.org_id === orgId && typeof membership.since_ts === "number") {
      const stayedDays = max0(Math.floor((nowTs - membership.since_ts) / DAY_MS));
      const remainingDays = LEGAL_MIN_DAYS - stayedDays;
      if (remainingDays > 0) durationMs = remainingDays * DAY_MS;
    }
  }

  const expiresAt = (existing && existing.expires_at > nowTs) ? existing.expires_at : (nowTs + durationMs);

  repo.upsertCooldown(ctx.db, member.id, "PK", expiresAt, orgId, nowTs);
  repo.removeMembership(ctx.db, member.id);
  repo.upsertLastOrgState(ctx.db, member.id, orgId, nowTs, byUserId);

  const pkOk = await safeRoleAdd(member, pkRole, `ORG DELETE apply PK for ${member.id}`);

  const errors = [];
  if (roleErrors.length) errors.push(...roleErrors);
  if (!pkOk) errors.push(`nu pot aplica rolul PK <@&${pkRole}> (ierarhie/permisiuni/rate limit)`);

  return { ok: (pkOk && rolesOk), pkOk, rolesOk, expiresAt, errors };
}

function reconcileOrgModal() {
  return modal("famenu:reconcile_org_modal", "Reconcile organizație", [
    input("org_id", "Org ID", undefined, true, "ID din lista Organizații"),
  ]);
}

async function reconcileOrg(ctx, orgId, members, opts = {}) {
  const silent = !!opts.silent;
  const org = repo.getOrg(ctx.db, orgId);
  if (!org) return { ok:false, msg:"Organizația nu există." };
  if (!members) return { ok:false, msg:"Nu pot prelua membrii guild-ului." };

  const orgs = repo.listOrgs(ctx.db);
  const discordMembers = members.filter(m => m.roles.cache.has(org.member_role_id));
  const discordIds = new Set(discordMembers.map(m => m.id));
  const dbMembers = repo.listMembersByOrg(ctx.db, orgId);
  const dbIds = new Set(dbMembers.map(m => m.user_id));

  let added = 0;
  let removed = 0;
  const multiOrg = [];
  const leadershipWithoutOrg = [];

  const leaderRole = org.leader_role_id ? ctx.guild.roles.cache.get(org.leader_role_id) : null;
  const coLeaderRole = org.co_leader_role_id ? ctx.guild.roles.cache.get(org.co_leader_role_id) : null;
  const memberRole = org.member_role_id ? ctx.guild.roles.cache.get(org.member_role_id) : null;

  if (memberRole) {
    if (leaderRole) {
      for (const m of leaderRole.members.values()) {
        if (!m.roles.cache.has(memberRole.id)) {
          leadershipWithoutOrg.push(`<@${m.id}> are **${leaderRole.name}** fără rolul de organizație <@&${memberRole.id}>`);
        }
      }
    }
    if (coLeaderRole) {
      for (const m of coLeaderRole.members.values()) {
        if (!m.roles.cache.has(memberRole.id)) {
          leadershipWithoutOrg.push(`<@${m.id}> are **${coLeaderRole.name}** fără rolul de organizație <@&${memberRole.id}>`);
        }
      }
    }
  }

  for (const m of discordMembers.values()) {
    if (!dbIds.has(m.id)) {
      const rank = (org.leader_role_id && m.roles.cache.has(org.leader_role_id))
        ? "LEADER"
        : ((org.co_leader_role_id && m.roles.cache.has(org.co_leader_role_id)) ? "COLEADER" : "MEMBER");
      repo.upsertMembership(ctx.db, m.id, orgId, rank);
      added++;
    }
    const otherOrgs = orgs
      .filter(o => o.id !== org.id && o.member_role_id && m.roles.cache.has(o.member_role_id))
      .map(o => o.name);
    if (otherOrgs.length) {
      multiOrg.push(`<@${m.id}> → ${otherOrgs.join(", ")}`);
    }
  }
  for (const row of dbMembers) {
    if (!discordIds.has(row.user_id)) {
      repo.removeMembership(ctx.db, row.user_id);
      repo.upsertLastOrgState(ctx.db, row.user_id, orgId, now(), "RECONCILE");
      removed++;
    }
  }

  if (!silent && (added || removed)) {
    await audit(ctx, "🧾 Reconcile organizație", [
      `**Organizație:** **${org.name}** (\`${orgId}\`)`,
      `**Sursă:** roluri Discord ↔ DB`,
      `**Rezultat:** ✅ adăugați în DB: **${added}** | 🧹 scoși din DB: **${removed}**`,
      `**De către:** <@${ctx.uid}>`
    ].join("\n"), COLORS.GLOBAL);
  }
  if (!silent && multiOrg.length) {
    const sample = multiOrg.slice(0, 8).join("\n");
    const extra = multiOrg.length > 8 ? `\nși încă ${multiOrg.length - 8}` : "";
    await audit(ctx, "⚠️ Avertisment: roluri multiple", [
      `**Organizație verificată:** **${org.name}** (\`${orgId}\`)`,
      `**Problemă:** membri cu mai multe roluri de organizație (sincronizarea poate fi greșită)`,
      `**Eșantion:**`,
      `${sample}${extra}`
    ].join("\n"), COLORS.WARN);
  }

  if (!silent && leadershipWithoutOrg.length) {
    const sample = leadershipWithoutOrg.slice(0, 8).join("\n");
    const extra = leadershipWithoutOrg.length > 8 ? `\nși încă ${leadershipWithoutOrg.length - 8}` : "";
    await audit(ctx, "⚠️ Conflict roluri conducere", [
      `**Organizație:** **${org.name}** (\`${orgId}\`)`,
      `**Problemă:** rol Leader/Co-Leader fără rolul principal al organizației`,
      `**Eșantion:**`,
      `${sample}${extra}`
    ].join("\n"), COLORS.WARN);
  }

  return { ok:true, added, removed, org };
}

async function sendWarnMessage(ctx, embed) {
  const warnChannelId = ctx.settings.warn;
  if (!warnChannelId) return { ok:false, msg:"Warn channel nu este setat." };
  try {
    const ch = await ctx.guild.channels.fetch(warnChannelId);
    if (!ch || !ch.isTextBased()) {
      console.error("[WARN] Invalid warn channel:", warnChannelId);
      return { ok:false, msg:"Warn channel invalid." };
    }
    applyBranding(embed, ctx);
    const msg = await ch.send({ embeds: [embed] });
    return { ok:true, messageId: msg.id };
  } catch (err) {
    console.error("[WARN] send failed:", err);
    return { ok:false, msg:"Nu pot trimite mesaj în warn channel." };
  }
}

async function reconcileCooldownRoles(ctx, members) {
  if (!members) return { ok:false, msg:"Nu pot prelua membrii guild-ului." };
  const nowTs = now();
  const pkRole = ctx.settings.pkRole;
  const banRole = ctx.settings.banRole;
  const BAN_MS_DEFAULT = 30 * 24 * 60 * 60 * 1000;

  let pkAdded = 0;
  let pkRemoved = 0;
  let banAdded = 0;
  let banRemoved = 0;

  const pkRows = repo.listCooldowns(ctx.db, "PK");
  const banRows = repo.listCooldowns(ctx.db, "BAN");
  const pkMap = new Map(pkRows.map(r => [r.user_id, r]));
  const banMap = new Map(banRows.map(r => [r.user_id, r]));

  for (const row of pkRows) {
    const member = members.get(row.user_id);
    if (row.expires_at <= nowTs) {
      if (member && pkRole && member.roles.cache.has(pkRole)) {
        const removed = await safeRoleRemove(member, pkRole, `PK expired cleanup for ${row.user_id}`);
        if (removed) pkRemoved++;
      }
      repo.clearCooldown(ctx.db, row.user_id, "PK");
      continue;
    }
    if (member && pkRole && !member.roles.cache.has(pkRole)) {
      const added = await safeRoleAdd(member, pkRole, `PK reconcile for ${row.user_id}`);
      if (added) pkAdded++;
    }
  }

  for (const row of banRows) {
    const member = members.get(row.user_id);
    if (row.expires_at <= nowTs) {
      if (member && banRole && member.roles.cache.has(banRole)) {
        const removed = await safeRoleRemove(member, banRole, `BAN expired cleanup for ${row.user_id}`);
        if (removed) banRemoved++;
      }
      repo.clearCooldown(ctx.db, row.user_id, "BAN");
      continue;
    }
    if (member && banRole && !member.roles.cache.has(banRole)) {
      const added = await safeRoleAdd(member, banRole, `BAN reconcile for ${row.user_id}`);
      if (added) banAdded++;
    }
  }

  if (pkRole) {
    const membersWithPk = members.filter(m => m.roles.cache.has(pkRole));
    for (const m of membersWithPk.values()) {
      if (!pkMap.has(m.id)) {
        const expiresAt = nowTs + PK_MS;
        repo.upsertCooldown(ctx.db, m.id, "PK", expiresAt, null, nowTs);
        pkMap.set(m.id, { user_id: m.id });
        pkAdded++;
        await audit(ctx, "🧩 Cooldown completat (PK)", [
          `**Țintă:** <@${m.id}> (\`${m.id}\`)`,
          `**Tip:** **PK**`,
          `**Discord:** ✅ rol prezent`,
          `**DB:** ❌ lipsă → ✅ creat`,
          `**Expiră:** ${formatRel(expiresAt)}`,
          `**De către:** <@${ctx.uid}>`
        ].join("\n"), COLORS.COOLDOWN);
      }
    }
  }

  if (banRole) {
    const membersWithBan = members.filter(m => m.roles.cache.has(banRole));
    for (const m of membersWithBan.values()) {
      if (!banMap.has(m.id)) {
        const expiresAt = nowTs + BAN_MS_DEFAULT;
        repo.upsertCooldown(ctx.db, m.id, "BAN", expiresAt, null, nowTs);
        banMap.set(m.id, { user_id: m.id });
        banAdded++;
        await audit(ctx, "🧩 Cooldown completat (BAN)", [
          `**Țintă:** <@${m.id}> (\`${m.id}\`)`,
          `**Tip:** **BAN**`,
          `**Discord:** ✅ rol prezent`,
          `**DB:** ❌ lipsă → ✅ creat`,
          `**Expiră:** ${formatRel(expiresAt)}`,
          `**De către:** <@${ctx.uid}>`
        ].join("\n"), COLORS.COOLDOWN);
      }
    }
  }

  if (pkAdded || pkRemoved || banAdded || banRemoved) {
    await audit(ctx, "🔎 Reconcile cooldown-uri", [
      `**Rezultat:**`,
      `• **PK**: +${pkAdded} / -${pkRemoved}`,
      `• **BAN**: +${banAdded} / -${banRemoved}`,
      `**De către:** <@${ctx.uid}>`
    ].join("\n"), COLORS.COOLDOWN);
  }

  return { ok:true, pkAdded, pkRemoved, banAdded, banRemoved };
}

export async function handleFamenuCommand(interaction, ctx) {
  return famenuHome(interaction, ctx);
}

export async function handleFamenuComponent(interaction, ctx) {
  const id = interaction.customId;

  if (!interaction.isButton()) return;

  if (id === "famenu:back") return famenuHome(interaction, ctx);
  if (id === "famenu:config") {
    return famenuConfig(interaction, ctx);
  }
  if (id === "famenu:orgs") {
    return famenuOrgs(interaction, ctx);
  }
  if (id === "famenu:diag") {
    if (!requireStaff(ctx)) return sendEphemeral(interaction, "⛔ Acces refuzat", "Doar staff poate vedea diag.");
    const issues = configIssues(ctx);
    const desc = issues.length
      ? issues.map(x => `• ${x}`).join("\n")
      : "✅ Config OK";
    const emb = makeEmbed(
      "Diag / Config",
      `${desc}\n\n**Acțiuni:**\n• Reconcile Org (Discord ↔ DB)\n• Reconcile Cooldown-uri (roluri ↔ DB)`,
      issues.length ? COLORS.WARN : COLORS.SUCCESS
    );
    const buttons = [
      btn("famenu:reconcile_global", "Reconcile global", ButtonStyle.Secondary, "🔁"),
      btn("famenu:reconcile_org", "Reconcile org", ButtonStyle.Secondary, "🧾"),
      btn("famenu:reconcile_cooldowns", "Reconcile cooldown-uri", ButtonStyle.Secondary, "⏳"),
      btn("famenu:back", "Back", ButtonStyle.Secondary, "⬅️")
    ];
    return sendEphemeral(interaction, emb.data.title, emb.data.description, rowsFromButtons(buttons));
  }
  if (id === "famenu:warns") {
    if (!requireSupervisorOrOwner(ctx)) return sendEphemeral(interaction, "⛔ Acces refuzat", "Doar supervisor/owner pot gestiona warn-uri.");
    const view = warnsView(ctx);
    return sendEphemeral(interaction, view.emb.data.title, view.emb.data.description, view.rows);
  }
  if (id === "famenu:cooldowns") {
    if (!requireStaff(ctx)) return sendEphemeral(interaction, "⛔ Acces refuzat", "Doar Admini pot gestiona cooldown-uri.");
    const view = cooldownsAdminView(ctx);
    return sendEphemeral(interaction, view.emb.data.title, view.emb.data.description, view.rows);
  }

  if (id === "famenu:config:roles") {
    if (!requireConfigManager(ctx)) return sendEphemeral(interaction, "⛔ Acces refuzat", "Doar owner sau rolul de config.");
    const view = configAccessRolesView(ctx);
    return sendEphemeral(interaction, view.emb.data.title, view.emb.data.description, view.rows);
  }

  if (id === "famenu:config:channels") {
    if (!requireConfigManager(ctx)) return sendEphemeral(interaction, "⛔ Acces refuzat", "Doar owner sau rolul de config.");
    const view = configChannelsView(ctx);
    return sendEphemeral(interaction, view.emb.data.title, view.emb.data.description, view.rows);
  }

  if (id === "famenu:reconcile_global") {
    if (!requireStaff(ctx)) return sendEphemeral(interaction, "⛔ Acces refuzat", "Doar staff poate folosi această acțiune.");
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const { members, retryMs } = await fetchMembersWithRetry(ctx.guild, "RECONCILE GLOBAL");
    if (!members) {
      const msg = retryMs > 0
        ? `Discord rate limit. Încearcă din nou în ~${Math.ceil(retryMs / 1000)}s.`
        : "Nu pot prelua membrii guild-ului.";
      return interaction.editReply({ embeds: [makeBrandedEmbed(ctx, "Eroare", msg)] });
    }
    let added = 0;
    let removed = 0;
    for (const org of repo.listOrgs(ctx.db)) {
      const res = await reconcileOrg(ctx, org.id, members, { silent: true });
      if (res.ok) {
        added += res.added;
        removed += res.removed;
      }
    }
    const cdRes = await reconcileCooldownRoles(ctx, members);
    const summary = [
      `Organizații: +${added}/-${removed}`,
      cdRes.ok ? `Cooldowns: PK +${cdRes.pkAdded}/-${cdRes.pkRemoved} | BAN +${cdRes.banAdded}/-${cdRes.banRemoved}` : "Cooldowns: eroare"
    ].join("\n");
    return interaction.editReply({ embeds: [makeBrandedEmbed(ctx, "Reconcile global", summary)] });
  }

  if (id === "famenu:reconcile_org") {
    if (!requireStaff(ctx)) return sendEphemeral(interaction, "⛔ Acces refuzat", "Doar staff poate folosi această acțiune.");
    return showModalSafe(interaction, reconcileOrgModal());
  }

  if (id === "famenu:reconcile_cooldowns") {
    if (!requireStaff(ctx)) return sendEphemeral(interaction, "⛔ Acces refuzat", "Doar staff poate folosi această acțiune.");
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const { members, retryMs } = await fetchMembersWithRetry(ctx.guild, "RECONCILE COOLDOWNS");
    if (!members) {
      const msg = retryMs > 0
        ? `Discord rate limit. Încearcă din nou în ~${Math.ceil(retryMs / 1000)}s.`
        : "Nu pot prelua membrii guild-ului.";
      return interaction.editReply({ embeds: [makeBrandedEmbed(ctx, "Eroare", msg)] });
    }
    const res = await reconcileCooldownRoles(ctx, members);
    if (!res.ok) return interaction.editReply({ embeds: [makeBrandedEmbed(ctx, "Eroare", res.msg || "Nu pot face reconcile cooldown-uri.")] });
    const summary = `PK: +${res.pkAdded}/-${res.pkRemoved}\nBAN: +${res.banAdded}/-${res.banRemoved}`;
    return interaction.editReply({ embeds: [makeBrandedEmbed(ctx, "Reconcile cooldown-uri", summary)] });
  }

  if (id === "famenu:warn_add") {
    if (!requireSupervisorOrOwner(ctx)) return sendEphemeral(interaction, "⛔ Acces refuzat", "Doar supervisor/owner pot gestiona warn-uri.");
    return showModalSafe(interaction, warnAddModalForm());
  }
  if (id === "famenu:warn_remove") {
    if (!requireSupervisorOrOwner(ctx)) return sendEphemeral(interaction, "⛔ Acces refuzat", "Doar supervisor/owner pot gestiona warn-uri.");
    return showModalSafe(interaction, warnRemoveModal());
  }
  if (id === "famenu:warn_list") {
    if (!requireSupervisorOrOwner(ctx)) return sendEphemeral(interaction, "⛔ Acces refuzat", "Doar supervisor/owner pot gestiona warn-uri.");
    const warns = repo.listWarnsByStatus(ctx.db, "ACTIVE", 10);
    const desc = warns.length
      ? warns.map(w => {
        let payload = {};
        try { payload = JSON.parse(w.payload_json); } catch {}
        const orgLabel = payload.org_role_id ? `<@&${payload.org_role_id}>` : (payload.org_name || `Org ${w.org_id || "-"}`);
        const exp = w.expires_at ? formatRel(w.expires_at) : "—";
        return `• \`${w.warn_id}\` | ${orgLabel} | Expiră: ${exp}`;
      }).join("\n")
      : "Nu există warn-uri active.";
    const emb = makeEmbed("⚠️ Faction Warns active", desc);
    return sendEphemeral(interaction, emb.data.title, emb.data.description, rowsFromButtons([btn("famenu:back", "Back", ButtonStyle.Secondary, "⬅️")]));
  }

  if (id === "famenu:cooldown_add") {
    if (!requireStaff(ctx)) return sendEphemeral(interaction, "⛔ Acces refuzat", "Doar staff pot gestiona cooldown-uri.");
    return showModalSafe(interaction, cooldownAddModal());
  }
  if (id === "famenu:cooldown_remove") {
    if (!requireStaff(ctx)) return sendEphemeral(interaction, "⛔ Acces refuzat", "Doar staff pot gestiona cooldown-uri.");
    return showModalSafe(interaction, cooldownRemoveModal());
  }

  if (id === "famenu:cooldown_list") {
    if (!requireStaff(ctx)) return sendEphemeral(interaction, "⛔ Acces refuzat", "Doar staff pot vedea lista de cooldown-uri.");
    const view = cooldownsActiveView(ctx);
    return sendEphemeral(interaction, view.emb.data.title, view.emb.data.description, view.rows);
  }


  if (id.startsWith("famenu:setrole:")) {
    if (!requireConfigManager(ctx)) return sendEphemeral(interaction, "⛔ Acces refuzat", "Doar owner sau rolul de config.");
    const which = id.split(":")[2];
    return showModalSafe(interaction, setRoleModal(which));
  }

  if (id.startsWith("famenu:setchannel:")) {
    if (!requireConfigManager(ctx)) return sendEphemeral(interaction, "⛔ Acces refuzat", "Doar owner sau rolul de config.");
    const which = id.split(":")[2];
    return showModalSafe(interaction, setChannelModal(which));
  }

  if (id === "famenu:createorg") {
    if (!requireCreateOrg(ctx)) return sendEphemeral(interaction, "⛔ Acces refuzat", "Nu ai permisiuni.");
    return showModalSafe(interaction, orgCreateModal());
  }
  if (id === "famenu:deleteorg") {
    if (!requireSupervisorOrOwner(ctx)) return sendEphemeral(interaction, "⛔ Acces refuzat", "Doar supervisor/owner.");
    return showModalSafe(interaction, deleteOrgModal());
  }

  return sendEphemeral(interaction, "Eroare", "Acțiune necunoscută.");
}

export async function handleFamenuModal(interaction, ctx) {
  const id = interaction.customId;

  if (id === "famenu:createorg") {
    if (!requireCreateOrg(ctx)) return sendEphemeral(interaction, "⛔ Acces refuzat", "Nu ai permisiuni să creezi organizații.");
    const name = interaction.fields.getTextInputValue("name")?.trim();
    const kindRaw = interaction.fields.getTextInputValue("kind")?.trim().toUpperCase();
    const kind = (kindRaw === "LEGAL") ? "LEGAL" : "ILLEGAL";
    const member_role_id = interaction.fields.getTextInputValue("member_role_id")?.replace(/[<@&#>]/g,"").trim();
    const leader_role_id = interaction.fields.getTextInputValue("leader_role_id")?.replace(/[<@&#>]/g,"").trim();
    const co_leader_role_id = interaction.fields.getTextInputValue("co_leader_role_id")?.replace(/[<@&#>]/g,"").trim();

    if (!name || !member_role_id || !leader_role_id) {
      return sendEphemeral(interaction, "Eroare", "Completează câmpurile obligatorii (Name, Member Role ID, Leader Role ID).");
    }
    const memberCheck = roleCheck(ctx, member_role_id, "membru");
    if (!memberCheck.ok) return sendEphemeral(interaction, "Eroare", memberCheck.msg);
    const leaderCheck = roleCheck(ctx, leader_role_id, "lider");
    if (!leaderCheck.ok) return sendEphemeral(interaction, "Eroare", leaderCheck.msg);
    if (co_leader_role_id) {
      const coCheck = roleCheck(ctx, co_leader_role_id, "co-lider");
      if (!coCheck.ok) return sendEphemeral(interaction, "Eroare", coCheck.msg);
    }

    const createdId = repo.createOrg(ctx.db, {
      name,
      kind,
      member_role_id,
      leader_role_id,
      co_leader_role_id: co_leader_role_id || null
    });

    await audit(ctx, "🏷️ Organizație creată", [
      `**Nume:** ${name}`,
      `**Tip:** ${kind}`,
      `**Member role:** <@&${member_role_id}>`,
      `**Leader role:** <@&${leader_role_id}>`,
      co_leader_role_id ? `**Co-leader role:** <@&${co_leader_role_id}>` : null,
      `**De către:** <@${ctx.uid}>`
    ].filter(Boolean).join("\n"), COLORS.SUCCESS);

    return sendEphemeral(interaction, "Organizație creată", `**${name}** (${kind}) a fost creată cu ID: \`${createdId}\``);
  }

  if (id.startsWith("famenu:setrole_modal:")) {
    if (!requireConfigManager(ctx)) return sendEphemeral(interaction, "⛔ Acces refuzat", "Doar owner sau rolul de config.");
    const which = id.split(":")[2];
    const raw = interaction.fields.getTextInputValue("role_id")?.trim();
    const roleId = raw?.replace(/[<@&#>]/g,"").trim();
    if (roleId && !roleCheck(ctx, roleId, "rol").ok) return sendEphemeral(interaction, "Eroare", "Role ID invalid.");
    setSetting(ctx.db, `${which}_role_id`, roleId || "");
    const map = { admin: "adminRole", supervisor: "supervisorRole", config: "configRole", pk: "pkRole", ban: "banRole" };
    const k = map[which];
    if (k) ctx.settings[k] = roleId || null;
    await audit(ctx, "⚙️ Config rol", `**${which}:** ${roleId ? `<@&${roleId}>` : "—"}\n**De către:** <@${ctx.uid}>`, COLORS.GLOBAL);
    const view = configAccessRolesView(ctx);
    return sendEphemeral(interaction, view.emb.data.title, view.emb.data.description, view.rows);
  }

  if (id.startsWith("famenu:setchannel_modal:")) {
    if (!requireConfigManager(ctx)) return sendEphemeral(interaction, "⛔ Acces refuzat", "Doar owner sau rolul de config.");
    const which = id.split(":")[2];
    const raw = interaction.fields.getTextInputValue("channel_id")?.trim();
    const channelId = raw?.replace(/[<#>]/g,"").trim();
    setSetting(ctx.db, `${which}_channel_id`, channelId || "");
    const map = { audit: "audit", warn: "warn", bot: "botChannel" };
    const k = map[which];
    if (k) ctx.settings[k] = channelId || null;
    await audit(ctx, "⚙️ Config canal", `**${which}:** ${channelId ? `<#${channelId}>` : "—"}\n**De către:** <@${ctx.uid}>`, COLORS.GLOBAL);
    const view = configChannelsView(ctx);
    return sendEphemeral(interaction, view.emb.data.title, view.emb.data.description, view.rows);
  }

  if (id === "famenu:deleteorg_modal") {
    if (!requireSupervisorOrOwner(ctx)) return sendEphemeral(interaction, "⛔ Acces refuzat", "Doar supervisor/owner.");
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const orgId = Number(interaction.fields.getTextInputValue("org_id")?.trim());
    const reason = interaction.fields.getTextInputValue("reason")?.trim();

    if (!orgId) {
      return interaction.editReply({ embeds: [makeBrandedEmbed(ctx, "Eroare", "Org ID invalid.")] });
    }

    const org = repo.getOrg(ctx.db, orgId);
    if (!org) {
      return interaction.editReply({ embeds: [makeBrandedEmbed(ctx, "Eroare", "Org ID inexistent.")] });
    }

    if (!ctx.settings.pkRole) {
      return interaction.editReply({
        embeds: [makeBrandedEmbed(ctx, "Config lipsă", "PK role nu este setat. Setează-l în /famenu → Config → Roluri.")]
      });
    }

    const { members, retryMs } = await fetchMembersWithRetry(ctx.guild, "DELETE ORG");
    if (!members) {
      const msg = retryMs > 0
        ? `Discord rate limit. Încearcă din nou în ~${Math.ceil(retryMs / 1000)}s.`
        : "Nu pot prelua membrii guild-ului.";
      return interaction.editReply({ embeds: [makeBrandedEmbed(ctx, "Eroare", msg)] });
    }

    const roleIds = [org.member_role_id, org.leader_role_id, org.co_leader_role_id].filter(Boolean);
    const orgMembers = members.filter(m => roleIds.some(rid => m.roles.cache.has(rid)));
    const nowTs = now();

    const details = [];
    let pkApplied = 0;
    let pkFailed = 0;
    let roleIssues = 0;

    for (const m of orgMembers.values()) {
      const res = await forcePkAndRemoveOrgRoles(ctx, m, org, orgId, ctx.uid);

      const exp = res.expiresAt ? Number(res.expiresAt) : null;
      const days = exp ? Math.max(1, Math.ceil((exp - nowTs) / DAY_MS)) : null;

      let pkPart;
      if (res.pkOk) {
        pkPart = `PK: ✅ ${days}z (${formatRel(exp)})`;
      } else {
        const pkHint = (res.errors || []).find(e => String(e).toUpperCase().includes('PK')) || res.msg || 'eroare necunoscută';
        pkPart = `PK: ❌ ${pkHint}`;
      }

      const rolePart = res.rolesOk ? 'Roluri org: ✅' : 'Roluri org: ⚠️';
      const showHints = (!res.pkOk || !res.rolesOk) && (res.errors && res.errors.length);
      const hints = showHints ? res.errors.slice(0, 2) : [];
      const hintText = hints.length ? ` — ${hints.join('; ')}` : '';

      details.push(`• <@${m.id}> — ${pkPart} • ${rolePart}${hintText}`);
      if (res.pkOk) pkApplied++; else pkFailed++;
      if (!res.rolesOk) roleIssues++;
    }

    const dbRows = repo.listMembersByOrg(ctx.db, orgId);
    const discordIdSet = new Set(orgMembers.map(m => m.id));
    let dbOnly = 0;
    for (const row of dbRows) {
      if (!discordIdSet.has(row.user_id)) dbOnly++;
      repo.removeMembership(ctx.db, row.user_id);
      repo.upsertLastOrgState(ctx.db, row.user_id, orgId, now(), ctx.uid);
    }

    repo.deleteOrg(ctx.db, orgId);

    const maxLines = 30;
    const preview = details.slice(0, maxLines).join("\n");
    const remaining = Math.max(0, details.length - maxLines);
    const detailBlock = details.length
      ? `

**Detalii membri:**
${preview}${remaining ? `
… și încă **${remaining}** membri.` : ""}`
      : "";

    const auditDesc = [
      `**Org:** **${org.name}** (\`${orgId}\`)`,
      `**Tip:** ${humanKind(org.kind || org.type)}`,
      `**Membri afectați (Discord):** **${orgMembers.length}**`,
      dbOnly ? `**Intrări DB fără rol (curățate):** **${dbOnly}**` : null,
      `**PK aplicat:** **${pkApplied}**`,
      pkFailed ? `**PK eșuat:** **${pkFailed}**` : null,
      roleIssues ? `**Roluri org cu probleme:** **${roleIssues}**` : null,
      reason ? `**Motiv:** ${reason}` : null,
      `**De către:** <@${ctx.uid}>`
    ].filter(Boolean).join("\n") + detailBlock;

    await audit(ctx, "🗑️ Organizație ștearsă", auditDesc, COLORS.ERROR);

    const replyDesc = [
      `**${org.name}** a fost ștearsă.`,
      `Membri afectați (Discord): **${orgMembers.length}**.`,
      dbOnly ? `Intrări curățate doar din DB: **${dbOnly}**.` : null,
      `PK aplicat: **${pkApplied}**${pkFailed ? ` (eșuat: ${pkFailed})` : ''}.`,
      roleIssues ? `Roluri org cu probleme: **${roleIssues}**.` : null,
      reason ? `Motiv: ${reason}` : null,
      `Detalii: vezi audit-ul.`
    ].filter(Boolean).join("\n");

    return interaction.editReply({
      embeds: [makeBrandedEmbed(ctx, "Organizație ștearsă", replyDesc)]
    });
  }

  if (id === "famenu:reconcile_org_modal") {
    if (!requireStaff(ctx)) return sendEphemeral(interaction, "⛔ Acces refuzat", "Doar staff.");
    const orgId = Number(interaction.fields.getTextInputValue("org_id")?.trim());
    if (!orgId) return sendEphemeral(interaction, "Eroare", "Org ID invalid.");
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const { members, retryMs } = await fetchMembersWithRetry(ctx.guild, "RECONCILE ORG");
    if (!members) {
      const msg = retryMs > 0
        ? `Discord rate limit. Încearcă din nou în ~${Math.ceil(retryMs / 1000)}s.`
        : "Nu pot prelua membrii guild-ului.";
      return interaction.editReply({ embeds: [makeBrandedEmbed(ctx, "Eroare", msg)] });
    }
    const res = await reconcileOrg(ctx, orgId, members);
    if (!res.ok) return interaction.editReply({ embeds: [makeBrandedEmbed(ctx, "Eroare", res.msg || "Nu pot face reconcile.")] });
    const org = repo.getOrg(ctx.db, orgId);
    const summary = `Org: **${org?.name ?? orgId}**\nAdăugate în DB: **${res.added}**\nȘterse din DB: **${res.removed}**`;
    return interaction.editReply({ embeds: [makeBrandedEmbed(ctx, "Reconcile org", summary)] });
  }

  if (id === "famenu:warn_add_modal") {
    if (!requireSupervisorOrOwner(ctx)) return sendEphemeral(interaction, "⛔ Acces refuzat", "Doar supervisor/owner pot gestiona warn-uri.");

    const orgId = Number(interaction.fields.getTextInputValue("org_id")?.trim());
    const reason = interaction.fields.getTextInputValue("reason")?.trim();
    const dreptPlataRaw = interaction.fields.getTextInputValue("drept_plata")?.trim();
    const sanctiune = interaction.fields.getTextInputValue("sanctiune")?.trim();

    const durataRaw = interaction.fields.getTextInputValue("durata_zile")?.trim();
    const durataZile = parseInt(String(durataRaw || ""), 10);

    const dreptPlata = parseYesNo(dreptPlataRaw);

    if (!orgId) return sendEphemeral(interaction, "Eroare", "Org ID invalid.");
    if (!reason) return sendEphemeral(interaction, "Eroare", "Motivul este obligatoriu.");
    if (dreptPlata === null) return sendEphemeral(interaction, "Eroare", "Drept plată trebuie să fie DA/NU.");
    if (!sanctiune) return sendEphemeral(interaction, "Eroare", "Sancțiunea este obligatorie.");

    if (!Number.isFinite(durataZile) || durataZile <= 0) {
      return sendEphemeral(interaction, "Eroare", "Durata (zile) trebuie să fie un număr > 0 (ex: 90).");
    }

    const durataFinala = Math.min(365, durataZile);

    if (!ctx.settings.warn) {
      return sendEphemeral(interaction, "Config lipsă", "Warn channel nu este setat în /famenu → Config → Canale.");
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const warnId = generateWarnId();
    const createdAt = now();

    const expiresAt = createdAt + durataFinala * 24 * 60 * 60 * 1000;

    const org = repo.getOrg(ctx.db, orgId);
    if (!org) {
      return interaction.editReply({ embeds: [makeBrandedEmbed(ctx, "Eroare", "Org ID invalid.")] });
    }

    const payload = {
      org_id: orgId,
      org_name: org.name,
      org_role_id: org.member_role_id,
      reason,
      drept_plata: dreptPlata,
      sanctiune,
      durata_zile: durataFinala,
      created_by: ctx.uid
    };

    repo.createWarn(ctx.db, {
      warn_id: warnId,
      org_id: orgId,
      message_id: null,
      created_by: ctx.uid,
      created_at: createdAt,
      expires_at: expiresAt,
      status: "ACTIVE",
      payload_json: JSON.stringify(payload)
    });

    const warnEmbed = buildWarnEmbed({
      orgName: org.name,
      orgRoleId: org.member_role_id,
      reason,
      dreptPlata,
      sanctiune,
      expiresAt,
      warnId,
      status: "ACTIVE",
      durationDays: durataFinala
    });

    const msgRes = await sendWarnMessage(ctx, warnEmbed);
    if (!msgRes.ok) {
      return interaction.editReply({ embeds: [makeBrandedEmbed(ctx, "Eroare", msgRes.msg || "Nu pot trimite warn.")] });
    }

    repo.updateWarnMessageId(ctx.db, warnId, msgRes.messageId);

    await audit(ctx, "⚠️ WARN aplicat", [
      `**Organizație:** **${org.name}** (\`${orgId}\`)`,
      `**Warn ID:** \`${warnId}\``,
      `**Motiv:** ${reason}`,
      `**Drept plată:** **${dreptPlata ? "DA" : "NU"}**`,
      `**Sancțiune:** ${sanctiune}`,
      `**Durată:** **${durataFinala}** zile`,
      `**Expiră:** ${formatRel(expiresAt)}`,
      `**De către:** <@${ctx.uid}>`
    ].join("\n"), COLORS.WARN);

    return interaction.editReply({
      embeds: [makeBrandedEmbed(ctx, "Warn creat", `Warn \`${warnId}\` pentru **${org.name}** (expiră ${formatRel(expiresAt)}).`)]
    });
  }

  if (id === "famenu:warn_remove_modal") {
    if (!requireSupervisorOrOwner(ctx)) return sendEphemeral(interaction, "⛔ Acces refuzat", "Doar supervisor/owner pot gestiona warn-uri.");
    const warnId = interaction.fields.getTextInputValue("warn_id")?.trim();
    const removeReason = interaction.fields.getTextInputValue("reason")?.trim();

    if (!warnId) return sendEphemeral(interaction, "Eroare", "Warn ID invalid.");

    const warn = repo.getWarn(ctx.db, warnId);
    if (!warn) return sendEphemeral(interaction, "Eroare", "Warn ID inexistent.");

    repo.setWarnStatus(ctx.db, warnId, "REMOVED");

    if (warn.message_id && ctx.settings.warn) {
      const ch = await ctx.guild.channels.fetch(ctx.settings.warn).catch(() => null);
      if (ch && ch.isTextBased()) {
        const msg = await ch.messages.fetch(warn.message_id).catch(() => null);
        if (msg) {
          let payload = {};
          try { payload = JSON.parse(warn.payload_json || "{}"); } catch {}

          const durationDays =
            Number(payload.durata_zile) ||
            (payload.expira_90 ? 90 : null);

          const orgName = payload.org_name || (repo.getOrg(ctx.db, warn.org_id)?.name ?? String(warn.org_id));
          const orgRoleId = payload.org_role_id || (repo.getOrg(ctx.db, warn.org_id)?.member_role_id ?? null);

          const eb = buildWarnEmbed({
            orgName,
            orgRoleId,
            reason: payload.reason,
            dreptPlata: !!payload.drept_plata,
            sanctiune: payload.sanctiune,
            expiresAt: warn.expires_at,
            warnId,
            status: "REMOVED",
            durationDays
          });

          eb.setColor(COLORS.ERROR);
          eb.setFooter({ text: `ȘTERS • ${removeReason || "fără motiv"}` });

          applyBranding(eb, ctx);

          await msg.edit({ embeds: [eb] }).catch((err) => {
            console.error("[WARN] edit message failed:", err);
          });
        }
      }
    }

    await audit(ctx, "🧹 WARN șters", [
      `**Warn ID:** \`${warnId}\``,
      `**Motiv ștergere:** ${removeReason || "—"}`,
      `**De către:** <@${ctx.uid}>`
    ].join("\n"), COLORS.ERROR);

    return sendEphemeral(interaction, "Warn șters", `Warn \`${warnId}\` a fost marcat ca **REMOVED**.`);
  }

  if (id === "famenu:cooldown_add_modal") {
    if (!requireStaff(ctx)) return sendEphemeral(interaction, "⛔ Acces refuzat", "Doar staff pot gestiona cooldown-uri.");
    const userId = interaction.fields.getTextInputValue("user_id")?.replace(/[<@!>]/g,"").trim();
    const kindRaw = interaction.fields.getTextInputValue("kind")?.trim().toUpperCase();
    const durationRaw = interaction.fields.getTextInputValue("duration")?.trim();

    if (!userId || !/^\d{15,25}$/.test(userId)) return sendEphemeral(interaction, "Eroare", "User invalid.");
    if (!["PK","BAN"].includes(kindRaw)) return sendEphemeral(interaction, "Eroare", "Kind invalid. Folosește PK/BAN.");
    const ms = parseDurationMs(durationRaw);
    if (!ms) return sendEphemeral(interaction, "Eroare", "Durata invalidă. Ex: 3d / 12h / 90d");
    if (!ctx.settings.pkRole && kindRaw === "PK") return sendEphemeral(interaction, "Config lipsă", "PK role nu este setat.");
    if (!ctx.settings.banRole && kindRaw === "BAN") return sendEphemeral(interaction, "Config lipsă", "BAN role nu este setat.");

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const m = await ctx.guild.members.fetch(userId).catch(()=>null);
    if (!m) return interaction.editReply({ embeds: [makeBrandedEmbed(ctx, "Eroare", "Nu pot găsi userul în guild.")] });

    const expiresAt = now() + ms;
    repo.upsertCooldown(ctx.db, userId, kindRaw, expiresAt, null, null);

    const roleId = kindRaw === "PK" ? ctx.settings.pkRole : ctx.settings.banRole;
    await safeRoleAdd(m, roleId, `[Cooldown ${kindRaw}] manual set via famenu`);

    await audit(ctx, "⏳ Cooldown adăugat", [
      `**User:** <@${userId}>`,
      `**Tip:** **${kindRaw}**`,
      `**Expiră:** ${formatRel(expiresAt)}`,
      `**De către:** <@${ctx.uid}>`
    ].join("\n"), COLORS.WARN);

    return interaction.editReply({ embeds: [makeBrandedEmbed(ctx, "Cooldown adăugat", `User: <@${userId}> | Tip: **${kindRaw}** | Expiră: ${formatRel(expiresAt)}`)] });
  }

  if (id === "famenu:cooldown_remove_modal") {
    if (!requireStaff(ctx)) return sendEphemeral(interaction, "⛔ Acces refuzat", "Doar staff pot gestiona cooldown-uri.");
    const userId = interaction.fields.getTextInputValue("user_id")?.replace(/[<@!>]/g,"").trim();
    const kindRaw = interaction.fields.getTextInputValue("kind")?.trim().toUpperCase();

    if (!userId || !/^\d{15,25}$/.test(userId)) return sendEphemeral(interaction, "Eroare", "User invalid.");
    if (!["PK","BAN"].includes(kindRaw)) return sendEphemeral(interaction, "Eroare", "Kind invalid. Folosește PK/BAN.");

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const m = await ctx.guild.members.fetch(userId).catch(()=>null);

    repo.clearCooldown(ctx.db, userId, kindRaw);

    const roleId = kindRaw === "PK" ? ctx.settings.pkRole : ctx.settings.banRole;
    if (m && roleId) await safeRoleRemove(m, roleId, `[Cooldown ${kindRaw}] manual remove via famenu`);

    await audit(ctx, "🧹 Cooldown șters", [
      `**User:** <@${userId}>`,
      `**Tip:** **${kindRaw}**`,
      m ? "" : "⚠️ Nu am găsit userul în guild",
      `**De către:** <@${ctx.uid}>`
    ].filter(Boolean).join("\n"), COLORS.SUCCESS);

    return sendEphemeral(interaction, "Cooldown șters", `User: <@${userId}> | Tip: **${kindRaw}**`);
  }

  return sendEphemeral(interaction, "Eroare", "Modal necunoscut.");
}
