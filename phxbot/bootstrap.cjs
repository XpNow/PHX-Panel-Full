const path = require("path");
const dotenv = require("dotenv");

dotenv.config({ path: path.join(__dirname, ".env") });

console.log("[BOOT] CWD:", process.cwd());
console.log("[BOOT] ENV loaded:", {
  hasToken: !!process.env.DISCORD_TOKEN,
  hasGuild: !!process.env.DISCORD_GUILD_ID,
  hasClient: !!process.env.DISCORD_CLIENT_ID,
  dbPath: process.env.DB_PATH || "./data/phxbot.sqlite"
});

process.on("unhandledRejection", (e) => console.error("[UNHANDLED_REJECTION]", e));
process.on("uncaughtException", (e) => console.error("[UNCAUGHT_EXCEPTION]", e));

(async () => {
  await import("./src/index.js");
})();
