import 'dotenv/config';
import { REST, Routes, SlashCommandBuilder } from 'discord.js';

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
const guildId = process.env.DISCORD_GUILD_ID;

if (!token || !clientId || !guildId) {
  console.error('Missing DISCORD_TOKEN / DISCORD_CLIENT_ID / DISCORD_GUILD_ID in env');
  process.exit(1);
}

const commands = [
  new SlashCommandBuilder().setName('fmenu').setDescription('Open faction dashboard'),
  new SlashCommandBuilder()
    .setName('falert')
    .setDescription('Send global raid alert (factions)')
    .addStringOption(o=>o.setName('locatie').setDescription('Locatie razie').setRequired(true))
    .addStringOption(o=>o.setName('detalii').setDescription('Detalii (optional)').setRequired(false)),
].map(c=>c.toJSON());

const rest = new REST({ version: '10' }).setToken(token);

console.log('Registering slash commands (guild)...');
await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
console.log('Done.');
