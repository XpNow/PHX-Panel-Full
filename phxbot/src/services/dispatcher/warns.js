import { ButtonStyle } from "discord.js";
import { makeEmbed, btn, rowsFromButtons, modal, input } from "../../ui/ui.js";
import { applyBranding } from "../../ui/brand.js";

/**
 * 
 * @param {number} tsMs
 */
function formatRel(tsMs) {
  return `<t:${Math.floor(Number(tsMs) / 1000)}:R>`;
}

function safe(v) {
  return v && String(v).trim() ? String(v).trim() : "—";
}

function yn(v) {
  return v ? "✅" : "❌";
}

export function warnsView() {
  const emb = makeEmbed("Warns", "Gestionare warn-uri (Faction-Supervisor/Fondator).");
  const buttons = [
    btn("famenu:warn_add", "Adaugă warn", ButtonStyle.Primary, "➕"),
    btn("famenu:warn_remove", "Șterge warn", ButtonStyle.Secondary, "🗑️"),
    btn("famenu:warn_list", "Listă active", ButtonStyle.Secondary, "📋"),
    btn("famenu:back", "Back", ButtonStyle.Secondary, "⬅️"),
  ];
  return { emb, rows: rowsFromButtons(buttons) };
}

export function warnAddModalForm() {
  return modal("famenu:warn_add_modal", "Adaugă WARN", [
    input("org_id", "Organizație (ID)", undefined, true, "Ex: 12 (din lista Organizații)"),
    input("reason", "Motiv", undefined, true, "Ex: 2 mafii la bătaie"),
    input("drept_plata", "Drept plată (DA/NU)", undefined, true, "DA / NU"),
    input("sanctiune", "Sancțiune oferită", undefined, true, "Ex: 1/3 Mafia Warn"),
    input("durata_zile", "Durată (zile)", undefined, true, "Ex: 90 (3 luni) / 120 (4 luni)"),
  ]);
}

export function warnRemoveModal() {
  return modal("famenu:warn_remove_modal", "Șterge warn", [
    input("warn_id", "Warn ID", undefined, true, "Ex: W-3K7P9D"),
    input("reason", "Motiv (opțional)", undefined, false, "Ex: anulare"),
  ]);
}

export function buildWarnEmbed({
  orgName,
  orgRoleId,
  reason,
  dreptPlata,
  sanctiune,
  expiresAt,
  warnId,
  status = "ACTIVE",
  durationDays = null,
}) {
  const orgLabel = orgRoleId ? `<@&${orgRoleId}>` : safe(orgName);

  const isDeleted = String(status).toUpperCase() !== "ACTIVE";
  const statusText = isDeleted ? "❌ ȘTEARSĂ" : "✅ VALIDĂ";
  const expText = isDeleted ? "Expirată" : (expiresAt ? formatRel(expiresAt) : "—");

  const emb = makeEmbed("⚠️ Mafia WARN", "");

  emb.addFields(
    { name: "🏢 Organizație", value: orgLabel, inline: true },
    { name: "📌 Status", value: `**${statusText}**`, inline: true },
    { name: "⏳ Expiră", value: expText, inline: true },
  );

  const descLines = [
    `🧾 **Motiv:** ${safe(reason)}`,
    `⚖️ **Sancțiune:** ${safe(sanctiune)}`,
    `💳 **Drept plată:** ${yn(dreptPlata)}`,
    durationDays ? `📅 **Durată:** **${Number(durationDays)}** zile` : null,
  ].filter(Boolean);

  emb.setDescription(descLines.join("\n"));

  if (warnId) emb.setFooter({ text: `Warn ID: ${warnId}` });
  return emb;
}

export function generateWarnId() {

  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "W";
  for (let i = 0; i < 5; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

export async function sendWarnMessage(ctx, embed) {
  const warnChannelId = ctx.settings.warn;
  if (!warnChannelId) return { ok: false, msg: "Warn channel nu este setat." };

  try {
    const ch = await ctx.guild.channels.fetch(warnChannelId);
    if (!ch || !ch.isTextBased()) {
      console.error("[WARN] Invalid warn channel:", warnChannelId);
      return { ok: false, msg: "Warn channel invalid." };
    }
    applyBranding(embed, ctx);
    const msg = await ch.send({ embeds: [embed] });
    return { ok: true, messageId: msg.id };
  } catch (err) {
    console.error("[WARN] send failed:", err);
    return { ok: false, msg: "Nu pot trimite mesaj în warn channel." };
  }
}
