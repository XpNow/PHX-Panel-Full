import { listExpiringCooldowns, listExpiringWarns, setWarnStatus, clearCooldown } from '../db/repo.js';
import { getSetting } from '../db/db.js';
import { EmbedBuilder } from 'discord.js';
import { COLORS } from '../ui/theme.js';
import { enqueueRoleOp } from '../infra/roleQueue.js';
import { applyBranding } from '../ui/brand.js';

export function runSchedulers({ client, db }) {
  setInterval(() => tick({ client, db }).catch((err) => console.error("[SCHEDULER] tick failed:", err)), 60 * 1000);
  tick({ client, db }).catch((err) => console.error("[SCHEDULER] initial tick failed:", err));
}

function setWarnStatusLine(description, statusLine) {
  const lines = description ? description.split("\n") : [];
  const idx = lines.findIndex(line => line.startsWith("Status:"));
  if (idx >= 0) lines[idx] = statusLine;
  else lines.push(statusLine);
  return lines.join("\n");
}

function fmtRel(tsMs) {
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
async function tick({ client, db }) {
  const guildId = process.env.DISCORD_GUILD_ID;
  if (!guildId) return;
  const guild = await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) return;

  const now = Date.now();
  const expCooldowns = listExpiringCooldowns(db, now);

  const pkRole = getSetting(db, 'pk_role_id');
  const brandText = getSetting(db, 'brand_text') || 'Phoenix Faction Manager';
  const brandIconUrl = getSetting(db, 'brand_icon_url') || '';
  const brandCtx = { guild, settings: { brandText, brandIconUrl } };
  const banRole = getSetting(db, 'ban_role_id');
  const auditChannelId = getSetting(db, 'audit_channel_id');
  const auditCh = auditChannelId ? await guild.channels.fetch(auditChannelId).catch(() => null) : null;

  for (const cd of expCooldowns) {
    const member = await guild.members.fetch(cd.user_id).catch(() => null);

    let roleAction = "—";
    let roleResult = "—";

    if (!member) {
      roleAction = "User nu este în guild (doar DB curățat)";
      roleResult = "—";
    } else if (cd.kind === 'PK') {
      if (pkRole && member.roles.cache.has(pkRole)) {
        const res = await enqueueRoleOp({ member, roleId: pkRole, action: "remove", context: "scheduler:pk:expire" });
        if (!res?.ok) {
          console.error(`[SCHEDULER] PK remove failed for ${cd.user_id}:`, res?.error ?? res);
          continue;
        }
        roleAction = "✅ Rol PK eliminat";
        roleResult = fmtOpResult(res);
      } else {
        roleAction = "ℹ️ Rol PK deja lipsă";
        roleResult = "OK (skip)";
      }
    } else if (cd.kind === 'BAN') {
      if (banRole && member.roles.cache.has(banRole)) {
        const res = await enqueueRoleOp({ member, roleId: banRole, action: "remove", context: "scheduler:ban:expire" });
        if (!res?.ok) {
          console.error(`[SCHEDULER] BAN remove failed for ${cd.user_id}:`, res?.error ?? res);
          continue;
        }
        roleAction = "✅ Rol BAN eliminat";
        roleResult = fmtOpResult(res);
      } else {
        roleAction = "ℹ️ Rol BAN deja lipsă";
        roleResult = "OK (skip)";
      }
    }

    if (auditCh && auditCh.isTextBased()) {
      const descLines = [
        `**Țintă:** <@${cd.user_id}> (\`${cd.user_id}\`)`,
        `**Tip:** **${cd.kind}**`,
        `**Expira:** ${fmtRel(cd.expires_at)}`,
        `**Acțiune:** ${roleAction}`,
        `**Rezultat rol:** ${roleResult}`,
        `**DB:** ✅ intrare cooldown ștearsă (expirat)`
      ];

      const eb = new EmbedBuilder()
        .setTitle("✅ Cooldown expirat (auto)")
        .setColor(COLORS.SUCCESS)
        .setDescription(descLines.join("\n"))
        .setFooter({ text: `AUTO • ${new Date().toISOString()}` });

      applyBranding(eb, brandCtx);
      await auditCh.send({ embeds: [eb] }).catch(() => {});
    }

    clearCooldown(db, cd.user_id, cd.kind);
  }


  const warnChannelId = getSetting(db, 'warn_channel_id');
  if (warnChannelId) {
    const channel = await guild.channels.fetch(warnChannelId).catch(() => null);
    if (channel && channel.isTextBased()) {
      const expWarns = listExpiringWarns(db, now);
      for (const w of expWarns) {
        try {
          const msg = await channel.messages.fetch(w.message_id).catch(() => null);
          if (msg) {
            const embed = msg.embeds?.[0];
            const eb = new EmbedBuilder(embed?.data ?? {});
            const nextDesc = setWarnStatusLine(eb.data.description || "", "Status: 🟥 EXPIRATĂ");
            eb.setDescription(nextDesc)
              .setColor(COLORS.ERROR)
              .setFooter({ text: `EXPIRATĂ • ${new Date().toISOString()}` });
            applyBranding(eb, brandCtx);
            await msg.edit({ embeds: [eb] }).catch(() => {});
          }
          setWarnStatus(db, w.warn_id, 'EXPIRED');
        } catch {}
      }
    }
  }
}
