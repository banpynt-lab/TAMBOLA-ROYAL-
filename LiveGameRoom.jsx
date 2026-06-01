// LiveGameRoom.jsx
// Drop into your existing React project.
// Reads roomId from URL: /game?roomId=xxx  OR  /game/:roomId
// Requires: firebase/app, firebase/firestore, firebase/auth already initialised
// in your existing  src/firebase.js  (or wherever you export { db, auth })
//
// npm packages already expected in your project:
//   react, react-dom, firebase, tailwindcss
//
// No new dependencies required.

import { useEffect, useRef, useState, useCallback } from "react";
import {
  doc, collection, onSnapshot, updateDoc, getDoc,
  serverTimestamp, query, where, orderBy, limit,
  runTransaction, increment
} from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { db, auth } from "../firebase"; // ← adjust path to your firebase init file

/* ─────────────────────────────────────────
   HELPERS
───────────────────────────────────────── */
const getRoomId = () => {
  // Support both ?roomId=xxx and /:roomId route patterns
  const params = new URLSearchParams(window.location.search);
  if (params.get("roomId")) return params.get("roomId");
  const parts = window.location.pathname.split("/").filter(Boolean);
  return parts[parts.length - 1] || null;
};

const CALL_INTERVAL_MS = 4000; // auto-call cadence

// Tambola number nicknames
const NICKNAMES = {
  1:"Kelly's Eye",2:"One Little Duck",3:"Cup of Tea",4:"Knock at the Door",
  5:"Man Alive",6:"Half a Dozen",7:"Lucky Seven",8:"One Fat Lady",
  9:"Doctor's Orders",10:"(Prime Minister's Den)",11:"Legs Eleven",
  12:"One Dozen",13:"Unlucky for Some",14:"Valentine's Day",
  15:"Young and Keen",16:"Sweet Sixteen",17:"Dancing Queen",
  18:"Coming of Age",21:"Royal Salute",22:"Two Little Ducks",
  33:"All the Threes",44:"Droopy Drawers",55:"Snakes Alive",
  66:"Clickety Click",69:"Either Way Up",77:"Sunset Strip",
  88:"Two Fat Ladies",90:"Top of the Shop"
};

/* ─────────────────────────────────────────
   TICKET CELL — memoised for perf
───────────────────────────────────────── */
const TicketCell = ({ value, isCalled, isMarked, onMark }) => {
  if (!value) {
    return (
      <div className="aspect-square rounded-md bg-slate-900/60 border border-slate-800/40" />
    );
  }
  const base = "aspect-square rounded-md flex items-center justify-center cursor-pointer select-none transition-all duration-200 relative overflow-hidden border text-xs font-bold font-mono";
  let style = "bg-slate-800 border-slate-700 text-slate-300 hover:border-slate-500 hover:bg-slate-700 active:scale-90";
  if (isMarked)  style = "bg-emerald-500/25 border-emerald-400 text-emerald-300 shadow-[0_0_8px_rgba(52,211,153,0.3)] scale-105";
  else if (isCalled) style = "bg-blue-500/25 border-blue-400 text-blue-300 shadow-[0_0_6px_rgba(96,165,250,0.25)] animate-pulse-slow";

  return (
    <div className={`${base} ${style}`} onClick={() => isCalled && onMark(value)}>
      {isMarked && (
        <span className="absolute top-0.5 right-0.5 text-[7px] text-emerald-400 leading-none">✓</span>
      )}
      <span style={{ fontSize: "clamp(8px, 2.6vw, 13px)", lineHeight: 1 }}>{value}</span>
    </div>
  );
};

/* ─────────────────────────────────────────
   SINGLE TICKET CARD
───────────────────────────────────────── */
const TicketCard = ({ ticket, ticketIndex, calledSet, markedMap, onMark }) => {
  const grid   = ticket.grid || [];           // 3×9 2-D array
  const marked = markedMap[ticket.id] || new Set();

  const rowNums = (ri) => (grid[ri] || []).filter(Boolean);
  const allNums = grid.flat().filter(Boolean);
  const markedCount = allNums.filter(n => marked.has(n)).length;
  const progress    = allNums.length ? Math.round((markedCount / allNums.length) * 100) : 0;

  return (
    <div className="bg-slate-900/80 border border-slate-700/50 rounded-2xl overflow-hidden backdrop-blur-sm">
      {/* header */}
      <div className="flex items-center justify-between px-3 py-2 bg-slate-800/60 border-b border-slate-700/40">
        <span className="text-[11px] font-bold tracking-widest text-slate-400 uppercase">
          Ticket {ticketIndex + 1}
        </span>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-slate-400">{markedCount}/15</span>
          <div className="w-20 h-1.5 bg-slate-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-emerald-400 rounded-full transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      </div>

      {/* grid — critical: 9 equal columns, overflow hidden, no text bleed */}
      <div className="p-2">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(9, 1fr)",
            gap: "clamp(2px, 0.6vw, 4px)",
            width: "100%",
          }}
        >
          {[0, 1, 2].map(ri =>
            (grid[ri] || Array(9).fill(0)).map((val, ci) => (
              <TicketCell
                key={`${ri}-${ci}`}
                value={val || 0}
                isCalled={calledSet.has(val)}
                isMarked={marked.has(val)}
                onMark={(n) => onMark(ticket.id, n)}
              />
            ))
          )}
        </div>
      </div>

      {/* row win indicators */}
      <div className="flex gap-1 px-2 pb-2">
        {[0, 1, 2].map(ri => {
          const nums    = rowNums(ri);
          const rowDone = nums.length === 5 && nums.every(n => marked.has(n));
          return (
            <div
              key={ri}
              className={`flex-1 text-center text-[10px] font-bold py-0.5 rounded transition-all duration-300 ${
                rowDone
                  ? "bg-yellow-400/20 text-yellow-300 border border-yellow-400/50"
                  : "bg-slate-800/40 text-slate-600"
              }`}
            >
              {["Top", "Mid", "Bot"][ri]}
            </div>
          );
        })}
      </div>
    </div>
  );
};

/* ─────────────────────────────────────────
   NUMBER BOARD 9×10
───────────────────────────────────────── */
const NumberBoard = ({ calledSet, latestNum }) => (
  <div
    style={{
      display: "grid",
      gridTemplateColumns: "repeat(9, 1fr)",
      gap: "clamp(2px, 0.6vw, 3px)",
      width: "100%",
    }}
  >
    {Array.from({ length: 90 }, (_, i) => i + 1).map(n => {
      const isLatest = n === latestNum;
      const isCalled = calledSet.has(n);
      return (
        <div
          key={n}
          className={`
            aspect-square rounded flex items-center justify-center font-mono font-bold
            transition-all duration-300 overflow-hidden
            ${isLatest
              ? "bg-red-500 text-white scale-110 shadow-[0_0_12px_rgba(239,68,68,0.6)] z-10 relative"
              : isCalled
              ? "bg-blue-500/30 text-blue-300 border border-blue-500/30"
              : "bg-slate-800/50 text-slate-600 border border-slate-700/30"}
          `}
          style={{ fontSize: "clamp(7px, 1.9vw, 11px)" }}
        >
          {n}
        </div>
      );
    })}
  </div>
);

/* ─────────────────────────────────────────
   CALLED NUMBER DISPLAY (big ball)
───────────────────────────────────────── */
const CalledBall = ({ number, nickname, isNew }) => (
  <div className="flex flex-col items-center gap-1">
    <div
      className={`
        relative w-24 h-24 rounded-full flex items-center justify-center
        bg-gradient-to-br from-slate-800 to-slate-900
        border-2 border-red-500/60
        shadow-[0_0_30px_rgba(239,68,68,0.3),inset_0_0_20px_rgba(0,0,0,0.5)]
        transition-all duration-300
        ${isNew ? "scale-110 border-red-400 shadow-[0_0_40px_rgba(239,68,68,0.5)]" : ""}
      `}
    >
      {/* spinning ring */}
      <div
        className="absolute inset-0 rounded-full border-2 border-transparent"
        style={{
          background: "conic-gradient(from 0deg, transparent 70%, rgba(239,68,68,0.6) 100%) border-box",
          animation: "spin 3s linear infinite",
          WebkitMaskComposite: "xor",
          maskComposite: "exclude",
        }}
      />
      <span
        className="font-mono font-black text-white relative z-10"
        style={{ fontSize: number !== null ? "clamp(28px,8vw,40px)" : "28px" }}
      >
        {number ?? "—"}
      </span>
    </div>
    <span className="text-[11px] text-red-400 font-medium tracking-wide text-center min-h-[1.2em]">
      {nickname || (number ? `Number ${number}` : "Waiting…")}
    </span>
  </div>
);

/* ─────────────────────────────────────────
   WIN TOAST
───────────────────────────────────────── */
const WinToast = ({ wins, onDismiss }) => {
  if (!wins.length) return null;
  const labels = { early5: "⭐ Early Five!", topRow: "🔵 Top Row!", midRow: "🔴 Middle Row!", botRow: "🟡 Bottom Row!", fullHouse: "🎉 Full House!" };
  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 flex flex-col gap-2 w-[90%] max-w-sm pointer-events-none">
      {wins.map((w, i) => (
        <div
          key={i}
          className={`
            rounded-xl px-4 py-3 text-center text-sm font-bold backdrop-blur-sm
            border animate-bounce-once
            ${w.type === "fullHouse"
              ? "bg-emerald-500/20 border-emerald-400/50 text-emerald-300"
              : "bg-yellow-500/20 border-yellow-400/50 text-yellow-300"}
          `}
        >
          {labels[w.type] || w.type} — {w.playerName || "You"}
        </div>
      ))}
    </div>
  );
};

/* ─────────────────────────────────────────
   HOST CONTROLS
───────────────────────────────────────── */
const HostControls = ({ room, roomId, calledNums, onCall, autoOn, onToggleAuto, onEndGame, calling }) => {
  const status = room?.status;
  return (
    <div className="bg-slate-900/80 border border-slate-700/50 rounded-2xl p-4 space-y-3">
      <div className="flex items-center gap-2 mb-1">
        <div className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />
        <span className="text-xs font-bold tracking-widest text-yellow-400 uppercase">Host Controls</span>
      </div>

      {status === "lobby" && (
        <button
          onClick={async () => {
            await updateDoc(doc(db, "rooms", roomId), {
              status: "playing",
              startedAt: serverTimestamp(),
              calledNumbers: [],
            });
          }}
          className="w-full py-3 rounded-xl bg-emerald-500/20 border border-emerald-400/50 text-emerald-300 font-bold text-sm tracking-wide hover:bg-emerald-500/30 active:scale-95 transition-all"
        >
          ▶ Start Game
        </button>
      )}

      {status === "playing" && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={onCall}
              disabled={calling || calledNums.length >= 90}
              className="py-3 rounded-xl bg-red-500/20 border border-red-400/50 text-red-300 font-bold text-sm hover:bg-red-500/30 active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              🎱 Call
            </button>
            <button
              onClick={onToggleAuto}
              className={`py-3 rounded-xl border font-bold text-sm active:scale-95 transition-all ${
                autoOn
                  ? "bg-orange-500/20 border-orange-400/50 text-orange-300 hover:bg-orange-500/30"
                  : "bg-slate-700/40 border-slate-600/50 text-slate-300 hover:bg-slate-700/60"
              }`}
            >
              {autoOn ? "⏸ Pause" : "▶ Auto"}
            </button>
          </div>
          <button
            onClick={onEndGame}
            className="w-full py-2.5 rounded-xl bg-slate-800/60 border border-slate-600/40 text-slate-400 font-bold text-xs hover:border-red-500/40 hover:text-red-400 transition-all"
          >
            End Game
          </button>
        </>
      )}

      {status === "ended" && (
        <div className="text-center text-slate-400 text-sm py-2">Game has ended.</div>
      )}

      <div className="flex justify-between text-xs text-slate-500 pt-1 border-t border-slate-700/40">
        <span>{calledNums.length} called</span>
        <span>{90 - calledNums.length} remaining</span>
      </div>
    </div>
  );
};

/* ─────────────────────────────────────────
   LIVE GAME ROOM — main component
───────────────────────────────────────── */
export default function LiveGameRoom() {
  const roomId  = getRoomId();

  // ── auth
  const [user, setUser] = useState(null);
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, u => setUser(u));
    return unsub;
  }, []);

  // ── room state
  const [room,        setRoom]        = useState(null);
  const [tickets,     setTickets]     = useState([]);
  const [calledNums,  setCalledNums]  = useState([]);   // ordered array
  const [latestNum,   setLatestNum]   = useState(null);
  const [isNew,       setIsNew]       = useState(false);
  const [markedMap,   setMarkedMap]   = useState({});   // { ticketId: Set }
  const [wins,        setWins]        = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState(null);
  const [autoOn,      setAutoOn]      = useState(false);
  const [calling,     setCalling]     = useState(false);

  const autoRef     = useRef(null);
  const listenersRef = useRef(new Set()); // track unsub fns to prevent duplicates

  const calledSet = new Set(calledNums);

  // ── helpers: check wins locally
  const checkWins = useCallback((allTickets, called, marked) => {
    const calledS = new Set(called);
    const newWins = [];
    allTickets.forEach(ticket => {
      const grid   = ticket.grid || [];
      const mk     = marked[ticket.id] || new Set();
      const nums   = grid.flat().filter(Boolean);
      const mCount = nums.filter(n => calledS.has(n) && mk.has(n)).length;

      if (mCount >= 5 && !wins.find(w => w.ticketId === ticket.id && w.type === "early5")) {
        newWins.push({ type: "early5",    ticketId: ticket.id, playerName: "You" });
      }
      [0, 1, 2].forEach(ri => {
        const rowNums = (grid[ri] || []).filter(Boolean);
        const rowKey  = `${ticket.id}-r${ri}`;
        const types   = ["topRow", "midRow", "botRow"];
        if (
          rowNums.length === 5 &&
          rowNums.every(n => calledS.has(n) && mk.has(n)) &&
          !wins.find(w => w.ticketId === rowKey && w.type === types[ri])
        ) {
          newWins.push({ type: types[ri], ticketId: rowKey, playerName: "You" });
        }
      });
      if (
        nums.length === 15 &&
        nums.every(n => calledS.has(n) && mk.has(n)) &&
        !wins.find(w => w.ticketId === ticket.id && w.type === "fullHouse")
      ) {
        newWins.push({ type: "fullHouse", ticketId: ticket.id, playerName: "You" });
      }
    });
    if (newWins.length) {
      setWins(prev => [...prev, ...newWins]);
      setTimeout(() => setWins(prev => prev.slice(newWins.length)), 5000);
    }
  }, [wins]);

  // ── listen to room document
  useEffect(() => {
    if (!roomId) { setError("No room ID found in URL."); setLoading(false); return; }

    // Prevent duplicate listeners
    const key = `room-${roomId}`;
    if (listenersRef.current.has(key)) return;
    listenersRef.current.add(key);

    const unsub = onSnapshot(
      doc(db, "rooms", roomId),
      (snap) => {
        if (!snap.exists()) { setError("Room not found."); setLoading(false); return; }
        const data = { id: snap.id, ...snap.data() };
        setRoom(data);

        // Restore called numbers on refresh
        const called = Array.isArray(data.calledNumbers) ? data.calledNumbers : [];
        setCalledNums(called);
        if (called.length) {
          const latest = called[called.length - 1];
          setLatestNum(latest);
        }
        setLoading(false);
      },
      (err) => { console.error("[LiveGameRoom] room listener:", err); setError("Failed to load room."); }
    );

    return () => { unsub(); listenersRef.current.delete(key); };
  }, [roomId]);

  // ── listen to player's tickets (only their own)
  useEffect(() => {
    if (!roomId || !user) return;

    const key = `tickets-${roomId}-${user.uid}`;
    if (listenersRef.current.has(key)) return;
    listenersRef.current.add(key);

    const q = query(
      collection(db, "rooms", roomId, "tickets"),
      where("bookedBy", "==", user.uid)
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        const t = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        setTickets(t);
        // Restore marked state from Firestore if persisted, else init empty
        setMarkedMap(prev => {
          const next = { ...prev };
          t.forEach(ticket => {
            if (!next[ticket.id]) {
              // Restore from markedNumbers field if it exists, else empty Set
              next[ticket.id] = new Set(ticket.markedNumbers || []);
            }
          });
          return next;
        });
      },
      (err) => { console.error("[LiveGameRoom] tickets listener:", err); }
    );

    return () => { unsub(); listenersRef.current.delete(key); };
  }, [roomId, user]);

  // ── number called: flash animation
  useEffect(() => {
    if (!calledNums.length) return;
    const latest = calledNums[calledNums.length - 1];
    setLatestNum(latest);
    setIsNew(true);
    const t = setTimeout(() => setIsNew(false), 1200);
    return () => clearTimeout(t);
  }, [calledNums]);

  // ── re-check wins whenever called or marked changes
  useEffect(() => {
    if (tickets.length && calledNums.length) checkWins(tickets, calledNums, markedMap);
  }, [calledNums, markedMap]); // eslint-disable-line

  // ── auto-call cleanup
  useEffect(() => () => { if (autoRef.current) clearInterval(autoRef.current); }, []);

  // ── call one number (host only)
  const callNumber = useCallback(async () => {
    if (calling || !room || room.status !== "playing") return;
    const remaining = Array.from({ length: 90 }, (_, i) => i + 1)
      .filter(n => !calledSet.has(n));
    if (!remaining.length) return;

    setCalling(true);
    try {
      const n   = remaining[Math.floor(Math.random() * remaining.length)];
      const ref = doc(db, "rooms", roomId);
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists()) throw new Error("Room gone");
        const existing = snap.data().calledNumbers || [];
        if (existing.includes(n)) return; // race guard
        tx.update(ref, {
          calledNumbers: [...existing, n],
          lastCalledAt:  serverTimestamp(),
          lastNumber:    n,
        });
      });
    } catch (err) {
      console.error("[callNumber]", err);
    } finally {
      setCalling(false);
    }
  }, [calling, room, calledSet, roomId]);

  // ── toggle auto-call
  const toggleAuto = useCallback(() => {
    if (autoRef.current) {
      clearInterval(autoRef.current);
      autoRef.current = null;
      setAutoOn(false);
    } else {
      autoRef.current = setInterval(() => {
        callNumber();
      }, CALL_INTERVAL_MS);
      setAutoOn(true);
    }
  }, [callNumber]);

  // ── mark a cell (saves to Firestore for persistence)
  const handleMark = useCallback(async (ticketId, number) => {
    if (!calledSet.has(number)) return;
    setMarkedMap(prev => {
      const next  = { ...prev };
      const s     = new Set(next[ticketId] || []);
      s.has(number) ? s.delete(number) : s.add(number);
      next[ticketId] = s;

      // Persist marked numbers for reconnect restore
      updateDoc(doc(db, "rooms", roomId, "tickets", ticketId), {
        markedNumbers: Array.from(s),
      }).catch(e => console.warn("[handleMark] persist:", e));

      return next;
    });
  }, [calledSet, roomId]);

  // ── end game
  const handleEndGame = async () => {
    if (autoRef.current) { clearInterval(autoRef.current); autoRef.current = null; setAutoOn(false); }
    try {
      await updateDoc(doc(db, "rooms", roomId), {
        status:  "ended",
        endedAt: serverTimestamp(),
      });
    } catch (e) { console.error("[endGame]", e); }
  };

  // ── online/offline reconnect banner
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on  = () => setIsOnline(true);
    const off = () => setIsOnline(false);
    window.addEventListener("online",  on);
    window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);

  const isHost = user && room && user.uid === room.hostId;

  /* ── LOADING / ERROR ─────────────────── */
  if (loading) return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <div className="w-10 h-10 rounded-full border-2 border-red-500 border-t-transparent animate-spin" />
        <span className="text-slate-400 text-sm tracking-wide">Loading room…</span>
      </div>
    </div>
  );

  if (error) return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6">
      <div className="bg-slate-900 border border-red-500/30 rounded-2xl p-6 text-center max-w-sm w-full">
        <div className="text-red-400 text-4xl mb-3">⚠️</div>
        <p className="text-red-300 font-semibold mb-1">Error</p>
        <p className="text-slate-400 text-sm">{error}</p>
      </div>
    </div>
  );

  /* ── LOBBY ───────────────────────────── */
  if (room?.status === "lobby") return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <div className="bg-slate-900/80 border border-slate-700/50 rounded-2xl p-8 text-center max-w-sm w-full space-y-4">
        <div className="w-16 h-16 rounded-full bg-yellow-400/10 border-2 border-yellow-400/40 flex items-center justify-center text-3xl mx-auto">
          🎱
        </div>
        <div>
          <h1 className="text-white font-bold text-xl">{room.roomName || "Game Room"}</h1>
          <p className="text-slate-400 text-sm mt-1">Waiting for host to start…</p>
        </div>
        <div className="flex gap-2 justify-center flex-wrap">
          <span className="text-xs bg-slate-800 text-slate-400 px-3 py-1 rounded-full border border-slate-700">
            Max {room.maxPlayers} players
          </span>
          <span className="text-xs bg-slate-800 text-slate-400 px-3 py-1 rounded-full border border-slate-700">
            {room.totalTickets} tickets
          </span>
        </div>
        {isHost && (
          <button
            onClick={async () => {
              await updateDoc(doc(db, "rooms", roomId), {
                status: "playing", startedAt: serverTimestamp(), calledNumbers: [],
              });
            }}
            className="w-full py-3 rounded-xl bg-emerald-500/20 border border-emerald-400/50 text-emerald-300 font-bold text-sm hover:bg-emerald-500/30 active:scale-95 transition-all"
          >
            ▶ Start Game
          </button>
        )}
      </div>
    </div>
  );

  /* ── ENDED ───────────────────────────── */
  if (room?.status === "ended") return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <div className="bg-slate-900/80 border border-slate-700/50 rounded-2xl p-8 text-center max-w-sm w-full space-y-4">
        <div className="text-5xl">🏆</div>
        <h1 className="text-white font-bold text-xl">Game Over</h1>
        <p className="text-slate-400 text-sm">{calledNums.length} numbers were called.</p>
        <div className="flex flex-wrap gap-1 justify-center max-h-28 overflow-hidden">
          {calledNums.map(n => (
            <span key={n} className="text-[10px] font-mono bg-blue-500/20 text-blue-300 px-1.5 py-0.5 rounded border border-blue-500/20">
              {n}
            </span>
          ))}
        </div>
        <button
          onClick={() => window.history.back()}
          className="w-full py-2.5 rounded-xl bg-slate-800 border border-slate-600 text-slate-300 font-bold text-sm hover:bg-slate-700 transition-all"
        >
          ← Back
        </button>
      </div>
    </div>
  );

  /* ── MAIN GAME UI ────────────────────── */
  return (
    <div className="min-h-screen bg-slate-950 text-white">

      {/* offline banner */}
      {!isOnline && (
        <div className="fixed top-0 inset-x-0 z-50 bg-orange-500 text-white text-xs font-bold text-center py-1.5 tracking-wide">
          ⚡ Reconnecting… calls will resume when online
        </div>
      )}

      {/* win toasts */}
      <WinToast wins={wins} onDismiss={() => setWins([])} />

      <div className="max-w-md mx-auto px-3 py-4 space-y-4">

        {/* ── TOP BAR */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-black text-lg leading-tight tracking-tight">
              {room?.roomName || "Game Room"}
            </h1>
            <div className="flex items-center gap-1.5 mt-0.5">
              <div className={`w-1.5 h-1.5 rounded-full ${room?.status === "playing" ? "bg-emerald-400 animate-pulse" : "bg-slate-500"}`} />
              <span className="text-xs text-slate-400 capitalize">{room?.status}</span>
            </div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-black font-mono text-red-400 leading-none">
              {calledNums.length}
            </div>
            <div className="text-[10px] text-slate-500 uppercase tracking-wider">called</div>
          </div>
        </div>

        {/* ── CALLER BALL */}
        <div className="bg-slate-900/80 border border-slate-700/50 rounded-2xl p-4 flex items-center gap-4">
          <CalledBall
            number={latestNum}
            nickname={latestNum ? NICKNAMES[latestNum] : null}
            isNew={isNew}
          />
          <div className="flex-1 min-w-0">
            <p className="text-[10px] uppercase tracking-widest text-slate-500 mb-2">Recent calls</p>
            <div className="flex flex-wrap gap-1 max-h-14 overflow-hidden">
              {[...calledNums].reverse().slice(0, 18).map((n, i) => (
                <span
                  key={n}
                  className={`font-mono font-bold text-[10px] px-1.5 py-0.5 rounded border transition-all duration-300 ${
                    i === 0
                      ? "bg-red-500/20 border-red-400/50 text-red-300"
                      : "bg-slate-800 border-slate-700 text-slate-400"
                  }`}
                >
                  {n}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* ── HOST CONTROLS */}
        {isHost && (
          <HostControls
            room={room}
            roomId={roomId}
            calledNums={calledNums}
            onCall={callNumber}
            autoOn={autoOn}
            onToggleAuto={toggleAuto}
            onEndGame={handleEndGame}
            calling={calling}
          />
        )}

        {/* ── PLAYER TICKETS */}
        {tickets.length > 0 ? (
          <div className="space-y-3">
            <p className="text-[11px] uppercase tracking-widest text-slate-500">
              Your Tickets — tap called numbers to mark
            </p>
            {tickets.map((ticket, idx) => (
              <TicketCard
                key={ticket.id}
                ticket={ticket}
                ticketIndex={idx}
                calledSet={calledSet}
                markedMap={markedMap}
                onMark={handleMark}
              />
            ))}
          </div>
        ) : (
          <div className="bg-slate-900/60 border border-slate-700/40 rounded-2xl p-6 text-center">
            <p className="text-slate-400 text-sm">No tickets booked for this room.</p>
            <button
              onClick={() => window.location.href = `/booking?roomId=${roomId}`}
              className="mt-3 px-4 py-2 rounded-xl bg-red-500/20 border border-red-400/40 text-red-300 text-sm font-bold hover:bg-red-500/30 transition-all"
            >
              Book a Ticket
            </button>
          </div>
        )}

        {/* ── NUMBER BOARD */}
        <div className="bg-slate-900/80 border border-slate-700/50 rounded-2xl p-3">
          <p className="text-[10px] uppercase tracking-widest text-slate-500 mb-2">Number Board</p>
          <NumberBoard calledSet={calledSet} latestNum={latestNum} />
        </div>

        {/* ── CALLED NUMBERS HISTORY */}
        {calledNums.length > 0 && (
          <div className="bg-slate-900/60 border border-slate-700/40 rounded-2xl p-3">
            <p className="text-[10px] uppercase tracking-widest text-slate-500 mb-2">
              All called · {calledNums.length} / 90
            </p>
            <div className="flex flex-wrap gap-1">
              {calledNums.map((n, i) => (
                <span
                  key={n}
                  className={`font-mono text-[10px] font-bold px-1.5 py-0.5 rounded border ${
                    i === calledNums.length - 1
                      ? "bg-red-500/20 border-red-400/40 text-red-300"
                      : "bg-slate-800/60 border-slate-700/40 text-slate-400"
                  }`}
                >
                  {n}
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="h-4" />
      </div>

      {/* ── GLOBAL KEYFRAME STYLE (Tailwind can't generate these) */}
      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        @keyframes bounce-once {
          0%   { transform: translateY(-6px) scale(0.95); opacity: 0; }
          60%  { transform: translateY(2px)  scale(1.02); opacity: 1; }
          100% { transform: translateY(0)    scale(1);    opacity: 1; }
        }
        .animate-bounce-once { animation: bounce-once 0.4s cubic-bezier(.34,1.56,.64,1) forwards; }
        .animate-pulse-slow   { animation: pulse 2.5s cubic-bezier(.4,0,.6,1) infinite; }
      `}</style>
    </div>
  );
}
