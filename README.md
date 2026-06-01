# 🎱 Tambola Royale — Multiplayer

Real-time online Housie / Tambola using Node.js + Socket.io.

---

## Quick Start (3 steps)

### 1. Install
```bash
cd tambola-multiplayer
npm install
```

### 2. Run
```bash
node server.js
```
You'll see:
```
🎱 Tambola Royale server running on http://localhost:3000
```

### 3. Play

**Same WiFi (most common):**
- Open `http://localhost:3000` on the host device
- Find your computer's local IP (e.g. `192.168.1.5`)
  - Windows: run `ipconfig` in CMD
  - Mac/Linux: run `ifconfig` or `ip addr`
- Players on the same WiFi open `http://192.168.1.5:3000`

**Over the internet:**
- Use [ngrok](https://ngrok.com): `ngrok http 3000` → share the HTTPS URL
- Or deploy to Railway / Render / Fly.io (free tiers available)

---

## How to Play

### Host
1. Enter your name → **Create Room**
2. Share the 6-character Room Code with friends
3. Wait for players to join in the lobby
4. Press **▶️ Start Game**
5. Use **Call Number** or **Auto Call** to draw numbers
6. Monitor wins — server auto-detects Early 5, Top Row, Middle Row, Full House

### Players
1. Enter your name + Room Code → **Join Room**
2. Wait in lobby for host to start
3. Your ticket is auto-generated and numbers are auto-marked as they're called
4. Watch the win banners and chat!

---

## Features

| Feature | Detail |
|---|---|
| Real-time sync | Socket.io, <50ms latency on LAN |
| Room codes | 6-character alphanumeric, collision-free |
| Rejoin protection | Disconnect and rejoin by same name |
| Host controls | Start, Pause/Resume, Auto-call (2.5s), End, Kick |
| Win detection | Early 5 · Top Row · Middle Row · Full House |
| Auto-marking | Called numbers marked instantly on all tickets |
| Live chat | In-game chat synced across all players |
| Players overlay | See who's online/offline mid-game |
| Mobile-first | Optimized for Android Chrome portrait |

---

## Folder Structure
```
tambola-multiplayer/
├── server.js          ← Node.js + Socket.io backend
├── package.json
└── public/
    └── index.html     ← Full game client (served statically)
```

## Port
Default: **3000**. Change with environment variable:
```bash
PORT=8080 node server.js
```
