# PHX Faction Manager Bot

Bot Discord avansat pentru managementul facțiunilor pe serverul Phoenix RP.

Acest bot sincronizează **Discord ↔ baza de date**, aplică automat **cooldown-uri, grade, sancțiuni**, detectează conflicte și oferă un panou complet pentru staff.

---

## ✨ Funcționalități

### /fmenu (Lider / Co-Lider / Admin)
- Add membru (bulk)
- Remove membru (fără PK)
- Remove PK cooldown (bulk)
- Afișează membri + Roster
- Search player (ID / @ / nume)
  - status PK
  - org curentă
  - ultima org
  - cine l-a scos
  - Set Rank (Leader / Co-Leader)
  - org **ilegale**: max 2 Co-Leader

---

### /famenu (Admin)

#### Organizații
- Listă org (legal/ilegal)
- Creează / șterge org
- Org ID + membri (Discord)

#### Config
- Roluri: Admin, Faction Supervisor, Config Access
- Rol PK / BAN
- Canale audit / warn

#### Diagnostics
- Reconcile Global
- Reconcile ORG
- Reconcile Cooldowns

#### Warns
- Adaugă / șterge Mafia Warn
- Listă warn-uri active

#### Cooldowns
- Adaugă / șterge PK / BAN
- Listă cooldown-uri active

---

## 🔐 Safeguards

- Anti cooldown evade
- Anti org role evade
- Downtime recovery (Discord=truth / DB=truth)
- Watchdog periodic
- Conflict detection
- Manual role audit (cine a dat / scos roluri)

---

## ⚙️ Setup

### 1. Instalează
```bash
npm install
```

### Create .env file

```

DISCORD_TOKEN=
DISCORD_CLIENT_ID=
DISCORD_GUILD_ID=
DB_PATH=./data/phxbot.sqlite
ENV=development

# Watchdog controls
WATCHDOG_ENABLED=true
WATCHDOG_INTERVAL_MIN=30
WATCHDOG_STARTUP_DELAY_MS=5000

# Accept offline role removals (DB follows Discord on startup)
WATCHDOG_ACCEPT_OFFLINE_ROLE_REMOVAL=true

# Drift logs
WATCHDOG_DRIFT_LOGS=true
WATCHDOG_DRIFT_SAMPLE=15

# Anti-evade on rejoin (leave + rejoin)
ORG_REAPPLY_ON_JOIN=true
COOLDOWN_REAPPLY_ON_JOIN=true

FAMENU_ADMIN_IDS=
FAMENU_CONFIG_IDS=
```
