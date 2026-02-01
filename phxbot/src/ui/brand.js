export function getBranding(ctx) {
  const text = String(ctx?.settings?.brandText || process.env.BRAND_TEXT || "Phoenix Faction Manager").trim();
  let iconUrl = String(ctx?.settings?.brandIconUrl || process.env.BRAND_ICON_URL || "").trim();

  if (!iconUrl && ctx?.guild?.iconURL) {
    try {
      iconUrl = ctx.guild.iconURL({ size: 64, extension: "png" }) || "";
    } catch {}
  }

  return { text, iconUrl };
}

function normalizeFooterText(t) {
  return String(t || "").trim();
}

export function applyBranding(embed, ctxOrBranding) {
  if (!embed) return embed;

  const branding = (ctxOrBranding && (ctxOrBranding.text || ctxOrBranding.iconUrl))
    ? ctxOrBranding
    : getBranding(ctxOrBranding);

  const brandText = normalizeFooterText(branding.text || "Phoenix Faction Manager");
  const brandIconUrl = String(branding.iconUrl || "").trim();
  if (!brandText) return embed;

  const defaultBrandText = normalizeFooterText(process.env.BRAND_TEXT || "Phoenix Faction Manager");

  const existingText = normalizeFooterText(embed?.data?.footer?.text);
  const alreadyHasBrand = existingText && existingText.includes(brandText);

  let nextText = brandText;
  if (existingText) {
    if (existingText === defaultBrandText || existingText === brandText) {
      nextText = brandText;
    } else if (alreadyHasBrand) {
      nextText = existingText;
    } else {
      nextText = `${existingText} • ${brandText}`;
    }
  }

  const existingIcon =
    embed?.data?.footer?.icon_url ||
    embed?.data?.footer?.iconURL ||
    "";

  const iconURL = (existingIcon || brandIconUrl || "").trim();

  embed.setFooter({
    text: nextText,
    ...(iconURL ? { iconURL } : {})
  });

  return embed;
}
