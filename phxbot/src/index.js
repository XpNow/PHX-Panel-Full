import 'dotenv/config';
import { Client, GatewayIntentBits, Partials, Events, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } from 'discord.js';
import { openDb } from './db/db.js';
import { handleSlashCommand, handleComponent, handleModal } from './services/dispatcher.js';
import { listActiveWarnsToExpire, deactivateWarn, addAudit } from './db/repo.js';
import { baseEmbed, COLORS } from './ui/embeds.js';

const token = process.env.DISCORD_TOKEN;
if (!token) { console.error('Missing DISCORD_TOKEN'); process.exit(1); }

const dbPath = process.env.DB_PATH || './data/phxbot.sqlite';
const db = openDb(dbPath);

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
  partials: [Partials.GuildMember]
});

client.once(Events.ClientReady, async (c) => {
  console.log(`Logged in as ${c.user.tag}`);

  // Warn expiry loop (every 2 minutes)
  setInterval(async () => {
    try {
      const due = listActiveWarnsToExpire(db);
      for (const w of due) {
        // Edit message if possible
        if (w.channel_id && w.message_id) {
          const guilds = client.guilds.cache;
          for (const [,g] of guilds) {
            const ch = await g.channels.fetch(w.channel_id).catch(()=>null);
            if (!ch) continue;
            const msg = await ch.messages.fetch(w.message_id).catch(()=>null);
            if (!msg) continue;
            const e = baseEmbed('⚠️ Mafia Warn (EXPIRAT)', COLORS.WARN);
            e.setDescription(`Warn ID: \`${w.warn_id}\` • Status: **EXPIRAT**`);
            await msg.edit({ embeds:[e] }).catch(()=>{});
          }
        }
        deactivateWarn(db, w.warn_id);
        addAudit(db,'WARN_EXPIRED','SYSTEM', null, w.org_id, {warn_id:w.warn_id});
      }
    } catch {}
  }, 120_000);
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      await handleSlashCommand(db, interaction);
      return;
    }
    if (interaction.isButton() || interaction.isStringSelectMenu()) {
      await handleComponent(db, interaction);
      return;
    }
    if (interaction.isModalSubmit()) {
      await handleModal(db, interaction);
      return;
    }

    // Open modals based on button clicks (centralized)
    if (interaction.isButton()) return;

  } catch (e) {
    console.error(e);
    // Avoid crashing; best effort reply
    try {
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content:'A aparut o eroare interna. Incearca din nou.', ephemeral:true });
      } else if (interaction.deferred) {
        await interaction.editReply({ content:'A aparut o eroare interna. Incearca din nou.', components:[], embeds:[] });
      }
    } catch {}
  }
});

// Modal factory hook: We create modals when user clicks certain buttons.
// Discord requires we respond to the BUTTON interaction with showModal.
// We'll intercept here before dispatcher handles components for modal-opening buttons:
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isButton()) return;
  const id = interaction.customId;

  const makeInput = (customId, label, placeholder, style=TextInputStyle.Short) =>
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId(customId).setLabel(label).setPlaceholder(placeholder).setStyle(style)
    );

  const show = async (modal) => {
    try { await interaction.showModal(modal); } catch (e) { console.error(e); }
  };

  // Channel setters
  if (id.startsWith('ui:modal:setch:')) {
    const key = id.split(':').at(-1);
    const modal = new ModalBuilder().setCustomId(`ui:modal:setch:${key}`).setTitle('Set Channel ID')
      .addComponents(makeInput('id','Channel ID','Paste channel ID here'));
    return show(modal);
  }

  if (id.startsWith('ui:modal:setrole:')) {
    const key = id.split(':').at(-1);
    const modal = new ModalBuilder().setCustomId(`ui:modal:setrole:${key}`).setTitle('Set Role ID')
      .addComponents(makeInput('id','Role ID','Paste role ID here'));
    return show(modal);
  }

  if (id.startsWith('ui:modal:setint:')) {
    const key = id.split(':').at(-1);
    const modal = new ModalBuilder().setCustomId(`ui:modal:setint:${key}`).setTitle('Set Value')
      .addComponents(makeInput('n','Number','Example: 30'));
    return show(modal);
  }

  if (id === 'ui:modal:createorg') {
    const modal = new ModalBuilder().setCustomId('ui:modal:createorg').setTitle('Create Organization')
      .addComponents(
        makeInput('org_id','Organization Code (optional)','Leave empty to auto-generate (ex: ballas)'),
        makeInput('name','Organization Name','Example: Ballas'),
        makeInput('type','Type','ILEGAL or LEGAL'),
        makeInput('base_role_id','Base Role ID','Role ID of the organization role (Ballas/LSPD etc.)')
      );
    return show(modal);
  }

  if (id === 'ui:modal:deleteorg') {
    const modal = new ModalBuilder().setCustomId('ui:modal:deleteorg').setTitle('Delete Organization')
      .addComponents(
        makeInput('org_id','org_id','Example: ballas'),
        makeInput('confirm','Confirm','Type DELETE to confirm')
      );
    return show(modal);
  }

  if (id.startsWith('ui:modal:setbaserole:')) {
    const org_id = id.split(':').at(-1);
    const modal = new ModalBuilder().setCustomId(`ui:modal:setbaserole:${org_id}`).setTitle('Set Base Role')
      .addComponents(makeInput('id','Role ID','Paste role id'));
    return show(modal);
  }

  if (id.startsWith('ui:modal:setlead:')) {
    const org_id = id.split(':').at(-1);
    const modal = new ModalBuilder().setCustomId(`ui:modal:setlead:${org_id}`).setTitle('Set Legal Leader Role')
      .addComponents(makeInput('id','Role ID (Leader)','Paste role id'));
    return show(modal);
  }
  if (id.startsWith('ui:modal:setcolead:')) {
    const org_id = id.split(':').at(-1);
    const modal = new ModalBuilder().setCustomId(`ui:modal:setcolead:${org_id}`).setTitle('Set Legal Co-Leader Role')
      .addComponents(makeInput('id','Role ID (Co-Leader)','Paste role id'));
    return show(modal);
  }

  if (id.startsWith('ui:modal:addrank:')) {
    const org_id = id.split(':').at(-1);
    const modal = new ModalBuilder().setCustomId(`ui:modal:addrank:${org_id}`).setTitle('Add/Update Rank')
      .addComponents(
        makeInput('rank_key','Rank name','Example: MEMBER / LEADER / COLEADER / HR'),
        makeInput('level','Priority (number)','Higher = more important (ex: 100)'),
        makeInput('role_id','Discord Role ID','Role ID that represents this rank')
      );
    return show(modal);
  }

  if (id.startsWith('ui:modal:delrank:')) {
    const org_id = id.split(':').at(-1);
    const modal = new ModalBuilder().setCustomId(`ui:modal:delrank:${org_id}`).setTitle('Remove Rank')
      .addComponents(makeInput('rank_key','rank_key','Example: COLEADER'));
    return show(modal);
  }

  if (id.startsWith('ui:modal:add:')) {
    const org_id = id.split(':').at(-1);
    const modal = new ModalBuilder().setCustomId(`ui:modal:add:${org_id}`).setTitle('Add Member')
      .addComponents(makeInput('user','User ID / @mention','Paste user id or mention'));
    return show(modal);
  }
  if (id.startsWith('ui:modal:remove:')) {
    const org_id = id.split(':').at(-1);
    const modal = new ModalBuilder().setCustomId(`ui:modal:remove:${org_id}`).setTitle('Remove Member (no PK)')
      .addComponents(makeInput('user','User ID / @mention','Paste user id or mention'));
    return show(modal);
  }
  if (id.startsWith('ui:modal:pkremove:')) {
    const org_id = id.split(':').at(-1);
    const modal = new ModalBuilder().setCustomId(`ui:modal:pkremove:${org_id}`).setTitle('PK Remove (3 days)')
      .addComponents(makeInput('user','User ID / @mention','Paste user id or mention'));
    return show(modal);
  }
  if (id.startsWith('ui:modal:search:')) {
    const org_id = id.split(':').at(-1);
    const modal = new ModalBuilder().setCustomId(`ui:modal:search:${org_id}`).setTitle('Search Player')
      .addComponents(makeInput('user','User ID / @mention','Paste user id or mention'));
    return show(modal);
  }

  if (id.startsWith('ui:modal:addwarn:')) {
    const org_id = id.split(':').at(-1);
    const modal = new ModalBuilder().setCustomId(`ui:modal:addwarn:${org_id}`).setTitle('Add Mafia Warn')
      .addComponents(
        makeInput('reason','Motiv','Example: 2 Mafii la bataie', TextInputStyle.Paragraph),
        makeInput('right','DREPT','DA / NU'),
        makeInput('sanction','Sanctiune','Example: 1/3 Mafia Warn'),
        makeInput('expire90','Expira in 90 zile','DA / NU')
      );
    return show(modal);
  }

  if (id.startsWith('ui:modal:removewarn:')) {
    const org_id = id.split(':').at(-1);
    const modal = new ModalBuilder().setCustomId(`ui:modal:removewarn:${org_id}`).setTitle('Remove Mafia Warn')
      .addComponents(makeInput('warn_id','Warn ID','Example: MW-2026-ABC123'));
    return show(modal);
  }
});

client.login(token);
