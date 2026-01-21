# phxbot (v0.2)

Discord bot for managing Mafia/Legal organizations with cooldowns, warnings, audit logs, and Discord-native dashboard UI.

## Run locally
1. Create `.env` from `.env.example`
2. `npm install`
3. `npm run initdb`
4. `npm run register`
5. `npm start`

## Render
- Root Directory: `phxbot` (if repo has subfolder)
- Build: `npm install && npm run initdb`
- Start: `npm start`
- Env:
  - DISCORD_TOKEN
  - DISCORD_CLIENT_ID
  - DISCORD_GUILD_ID
  - DB_PATH=/data/phxbot.sqlite
- Add Persistent Disk mounted at `/data`

Config is done from `/fmenu -> Config`.
