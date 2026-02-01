import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.join(process.cwd(), ".env") });


import { REST, Routes, SlashCommandBuilder, PermissionFlagsBits } from "discord.js";

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
const guildId = process.env.DISCORD_GUILD_ID;

if (!token || !clientId || !guildId) {
  console.error("Missing env. Need DISCORD_TOKEN, DISCORD_CLIENT_ID, DISCORD_GUILD_ID");
  process.exit(1);
}


function addMultiUserOptions(cmd, max = 8) {
  cmd.addUserOption(o =>
    o.setName("user")
      .setDescription("User 1")
      .setRequired(true)
  );

  for (let i = 2; i <= max; i++) {
    cmd.addUserOption(o =>
      o.setName(`user${i}`)
        .setDescription(`User ${i} (opțional)`)
        .setRequired(false)
    );
  }

  return cmd;
}

const commands = [
  new SlashCommandBuilder()
    .setName("fmenu")
    .setDescription("Meniu organizatie (Lider/Co-Lider)."),
  new SlashCommandBuilder()
    .setName("famenu")
    .setDescription("Meniu administrare.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false),

    addMultiUserOptions(
      new SlashCommandBuilder()
        .setName("add")
        .setDescription("Adaugă unul sau mai mulți membri în organizația ta.")
        .setDMPermission(false),
      8
    ),
  new SlashCommandBuilder()
    .setName("rmv")
    .setDescription("Scoate membru din organizație (opțional cu PK).")
    .addUserOption(o => o.setName("user").setDescription("User de scos").setRequired(true))
    .addBooleanOption(o => o.setName("pk").setDescription("Aplică PK? (DA/NU)").setRequired(false))
    .setDMPermission(false),

].map(c=>c.toJSON());

const rest = new REST({ version: "10" }).setToken(token);

console.log("Registering slash commands (guild)...");
await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
console.log("Done.");
