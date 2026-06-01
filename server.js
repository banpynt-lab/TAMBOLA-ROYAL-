/**
 * TAMBOLA ROYALE — Multiplayer Server
 * ------------------------------------
 * Run:  node server.js
 * Then open http://localhost:3000 on any device on the same network
 */

const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const path       = require('path');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: '*' },
  pingTimeout: 20000,
  pingInterval: 10000
});

const PORT = process.env.PORT || 3000;

/* ── Static files ─────────────────────────────────────── */
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (_, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

/* ══════════════════════════════════════════════════════════
   ROOM STORE
   rooms[code] = {
     code, hostId, hostName,
     players: { socketId: { id, name, ticketIdx, connected, joinedAt } },
     tickets: [ [[grid 3x9]] ],        ← one per player (pre-generated)
     bag: [1..90 shuffled],
     called: [],
     state: 'lobby' | 'playing' | 'paused' | 'ended',
     autoTimer: null,
     wins: { early5:[], topRow:[], midRow:[], fullHouse:[] }
   }
══════════════════════════════════════════════════════════ */
const rooms = {};

/* ── Ticket generation (same algorithm as client) ─────── */
const COL_RANGES = [[1,9],[10,19],[20,29],[30,39],[40,49],[50,59],[60,69],[70,79],[80,90]];

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function range(lo, hi) { return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i); }

function tryGen() {
  const grid    = Array.from({ length: 3 }, () => new Array(9).fill(0));
  const rowCnt  = [0, 0, 0];

  for (let ci = 0; ci < 9; ci++) {
    const [lo, hi] = COL_RANGES[ci];
    const pool     = shuffle(range(lo, hi));
    const elig     = [0, 1, 2].filter(ri => rowCnt[ri] < 5);
    if (!elig.length) continue;
    const want   = Math.min(elig.length, pool.length, (ci >= 3 && elig.length >= 2 && Math.random() < 0.38) ? 2 : 1);
    const chosen = shuffle([...elig]).slice(0, want);
    chosen.forEach((ri, i) => { grid[ri][ci] = pool[i]; rowCnt[ri]++; });
  }

  for (let ri = 0; ri < 3; ri++) {
    let safety = 0;
    while (rowCnt[ri] < 5 && safety++ < 25) {
      const cands = [];
      for (let ci = 0; ci < 9; ci++) {
        if (grid[ri][ci] !== 0) continue;
        const [lo, hi] = COL_RANGES[ci];
        const usedInCol = new Set([grid[0][ci], grid[1][ci], grid[2][ci]].filter(Boolean));
        const pool2     = range(lo, hi).filter(n => !usedInCol.has(n));
        if (pool2.length) cands.push({ ci, pool: pool2 });
      }
      if (!cands.length) return null;
      const { ci, pool: p } = cands[Math.floor(Math.random() * cands.length)];
      grid[ri][ci] = p[Math.floor(Math.random() * p.length)];
      rowCnt[ri]++;
    }
  }

  const flat = grid.flat().filter(Boolean);
  if (flat.length !== 15 || new Set(flat).size !== 15 || rowCnt.some(c => c !== 5)) return null;
  return grid;
}

function generateTicket() {
  for (let i = 0; i < 300; i++) {
    const g = tryGen();
    if (g) return g;
  }
  return null;
}

/* ── Room utilities ───────────────────────────────────── */
function makeCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  do { code = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join(''); }
  while (rooms[code]);
  return code;
}

function roomPublic(room) {
  return {
    code:      room.code,
    hostId:    room.hostId,
    hostName:  room.hostName,
    state:     room.state,
    called:    room.called,
    players:   Object.values(room.players).map(p => ({
      id: p.id, name: p.name, connected: p.connected, ticketIdx: p.ticketIdx
    })),
    tickets:   room.tickets,
    wins:      room.wins
  };
}

function broadcastRoom(room) {
  io.to(room.code).emit('room:update', roomPublic(room));
}

function stopAuto(room) {
  if (room.autoTimer) { clearInterval(room.autoTimer); room.autoTimer = null; }
}

function callNext(room) {
  if (!room.bag.length || room.state !== 'playing') { stopAuto(room); return; }
  const idx = Math.floor(Math.random() * room.bag.length);
  const n   = room.bag.splice(idx, 1)[0];
  room.called.push(n);

  // server-side win check
  checkWins(room, n);

  broadcastRoom(room);
  io.to(room.code).emit('room:called', { number: n, called: room.called });

  if (!room.bag.length) {
    room.state = 'ended';
    stopAuto(room);
    broadcastRoom(room);
  }
}

function checkWins(room, latestNum) {
  Object.values(room.players).forEach(player => {
    const ticket = room.tickets[player.ticketIdx];
    if (!ticket) return;
    const calledSet = new Set(room.called);
    const flat      = ticket.flat().filter(Boolean);

    // Early 5
    if (!room.wins.early5.includes(player.id)) {
      const marked = flat.filter(n => calledSet.has(n)).length;
      if (marked >= 5) {
        room.wins.early5.push(player.id);
        io.to(room.code).emit('room:win', { type: 'early5', playerName: player.name, number: latestNum });
      }
    }
    // Top row
    if (!room.wins.topRow.includes(player.id)) {
      const top = ticket[0].filter(Boolean);
      if (top.length && top.every(n => calledSet.has(n))) {
        room.wins.topRow.push(player.id);
        io.to(room.code).emit('room:win', { type: 'topRow', playerName: player.name, number: latestNum });
      }
    }
    // Middle row
    if (!room.wins.midRow.includes(player.id)) {
      const mid = ticket[1].filter(Boolean);
      if (mid.length && mid.every(n => calledSet.has(n))) {
        room.wins.midRow.push(player.id);
        io.to(room.code).emit('room:win', { type: 'midRow', playerName: player.name, number: latestNum });
      }
    }
    // Full house
    if (!room.wins.fullHouse.includes(player.id)) {
      if (flat.length === 15 && flat.every(n => calledSet.has(n))) {
        room.wins.fullHouse.push(player.id);
        io.to(room.code).emit('room:win', { type: 'fullHouse', playerName: player.name, number: latestNum });
      }
    }
  });
}

/* ══════════════════════════════════════════════════════════
   SOCKET EVENTS
══════════════════════════════════════════════════════════ */
io.on('connection', socket => {
  console.log(`[+] connected  ${socket.id}`);

  /* ── CREATE ROOM ───────────────────────────────────── */
  socket.on('room:create', ({ playerName }, cb) => {
    const code   = makeCode();
    const ticket = generateTicket();
    if (!ticket) return cb({ error: 'Ticket generation failed' });

    rooms[code] = {
      code, hostId: socket.id, hostName: playerName,
      players: {
        [socket.id]: { id: socket.id, name: playerName, ticketIdx: 0, connected: true, joinedAt: Date.now() }
      },
      tickets: [ticket],
      bag:     shuffle(range(1, 90)),
      called:  [],
      state:   'lobby',
      autoTimer: null,
      wins:    { early5: [], topRow: [], midRow: [], fullHouse: [] }
    };

    socket.join(code);
    socket.data = { code, name: playerName };
    console.log(`[Room] created ${code} by ${playerName}`);
    cb({ ok: true, code, room: roomPublic(rooms[code]), myTicketIdx: 0 });
  });

  /* ── JOIN ROOM ─────────────────────────────────────── */
  socket.on('room:join', ({ code, playerName }, cb) => {
    code = code.toUpperCase().trim();
    const room = rooms[code];
    if (!room)                    return cb({ error: 'Room not found. Check the code.' });
    if (room.state === 'ended')   return cb({ error: 'This game has already ended.' });

    // Rejoin check — same name already in room?
    const existing = Object.values(room.players).find(p => p.name.toLowerCase() === playerName.toLowerCase());
    if (existing) {
      // Reassign socket id (rejoin)
      const oldId = existing.id;
      if (oldId !== socket.id) {
        room.players[socket.id] = { ...existing, id: socket.id, connected: true };
        delete room.players[oldId];
        if (room.hostId === oldId) room.hostId = socket.id;
      }
      existing.connected = true;
      socket.join(code);
      socket.data = { code, name: playerName };
      broadcastRoom(room);
      return cb({ ok: true, code, room: roomPublic(room), myTicketIdx: room.players[socket.id].ticketIdx, rejoined: true });
    }

    if (room.state === 'playing') return cb({ error: 'Game is in progress. Cannot join now.' });

    const ticket    = generateTicket();
    if (!ticket)    return cb({ error: 'Ticket generation failed.' });
    const ticketIdx = room.tickets.length;
    room.tickets.push(ticket);
    room.players[socket.id] = { id: socket.id, name: playerName, ticketIdx, connected: true, joinedAt: Date.now() };

    socket.join(code);
    socket.data = { code, name: playerName };
    broadcastRoom(room);
    io.to(code).emit('room:chat', { system: true, text: `${playerName} joined the room!` });
    console.log(`[Room] ${playerName} joined ${code}`);
    cb({ ok: true, code, room: roomPublic(room), myTicketIdx: ticketIdx });
  });

  /* ── HOST: START ───────────────────────────────────── */
  socket.on('host:start', ({ code }, cb) => {
    const room = rooms[code];
    if (!room || room.hostId !== socket.id) return cb?.({ error: 'Not authorised' });
    if (Object.keys(room.players).length < 1) return cb?.({ error: 'Need at least one player' });
    room.state = 'playing';
    broadcastRoom(room);
    io.to(code).emit('room:chat', { system: true, text: 'Game started! 🎉' });
    cb?.({ ok: true });
  });

  /* ── HOST: PAUSE / RESUME ──────────────────────────── */
  socket.on('host:pause', ({ code }) => {
    const room = rooms[code];
    if (!room || room.hostId !== socket.id) return;
    stopAuto(room);
    room.state = room.state === 'paused' ? 'playing' : 'paused';
    broadcastRoom(room);
    io.to(code).emit('room:chat', { system: true, text: room.state === 'paused' ? 'Game paused ⏸' : 'Game resumed ▶️' });
  });

  /* ── HOST: CALL NUMBER ─────────────────────────────── */
  socket.on('host:call', ({ code }, cb) => {
    const room = rooms[code];
    if (!room || room.hostId !== socket.id) return cb?.({ error: 'Not host' });
    if (room.state !== 'playing') return cb?.({ error: 'Game not active' });
    callNext(room);
    cb?.({ ok: true });
  });

  /* ── HOST: AUTO CALL ───────────────────────────────── */
  socket.on('host:auto', ({ code, interval = 3000 }) => {
    const room = rooms[code];
    if (!room || room.hostId !== socket.id) return;
    if (room.autoTimer) {
      stopAuto(room);
      io.to(code).emit('host:autoState', { on: false });
    } else {
      room.autoTimer = setInterval(() => callNext(room), Math.max(1500, interval));
      io.to(code).emit('host:autoState', { on: true });
    }
  });

  /* ── HOST: END GAME ────────────────────────────────── */
  socket.on('host:end', ({ code }) => {
    const room = rooms[code];
    if (!room || room.hostId !== socket.id) return;
    stopAuto(room);
    room.state = 'ended';
    broadcastRoom(room);
    io.to(code).emit('room:chat', { system: true, text: 'Game ended by host.' });
  });

  /* ── HOST: KICK ────────────────────────────────────── */
  socket.on('host:kick', ({ code, targetId }) => {
    const room = rooms[code];
    if (!room || room.hostId !== socket.id) return;
    if (targetId === socket.id) return;
    io.to(targetId).emit('room:kicked');
    delete room.players[targetId];
    broadcastRoom(room);
  });

  /* ── CHAT ──────────────────────────────────────────── */
  socket.on('room:chat', ({ code, text }) => {
    const room = rooms[code];
    if (!room) return;
    const player = room.players[socket.id];
    if (!player) return;
    const msg = text.trim().slice(0, 120);
    if (!msg) return;
    io.to(code).emit('room:chat', { name: player.name, text: msg, ts: Date.now() });
  });

  /* ── DISCONNECT ────────────────────────────────────── */
  socket.on('disconnect', () => {
    console.log(`[-] disconnected ${socket.id}`);
    const { code } = socket.data || {};
    const room = rooms[code];
    if (!room) return;
    const player = room.players[socket.id];
    if (player) { player.connected = false; }

    // If host disconnects, auto-pause
    if (room.hostId === socket.id && room.state === 'playing') {
      stopAuto(room);
      room.state = 'paused';
      io.to(code).emit('room:chat', { system: true, text: 'Host disconnected — game paused.' });
    }

    broadcastRoom(room);

    // Clean up empty rooms after 5 minutes
    setTimeout(() => {
      if (!rooms[code]) return;
      const connected = Object.values(rooms[code].players).filter(p => p.connected).length;
      if (connected === 0) { stopAuto(rooms[code]); delete rooms[code]; console.log(`[Room] cleaned up ${code}`); }
    }, 5 * 60 * 1000);
  });
});

server.listen(PORT, () => {
  console.log(`\n🎱 Tambola Royale server running on http://localhost:${PORT}\n`);
});
