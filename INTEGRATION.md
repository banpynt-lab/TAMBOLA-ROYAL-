# LiveGameRoom — Integration Guide

## 1. File placement

```
src/
  pages/
    LiveGameRoom.jsx   ← copy here (or pages/game.jsx, etc.)
  firebase.js          ← your existing Firebase init (unchanged)
```

## 2. Required exports from your firebase.js

```js
// src/firebase.js  — must export these (already exist in your project)
export { db, auth };
```

If your file exports them differently (e.g. `export const db = ...` without a
named re-export), adjust the import at the top of LiveGameRoom.jsx:

```js
import { db, auth } from "../firebase";  // ← adjust path/names as needed
```

## 3. Route setup (React Router example)

```jsx
// App.jsx or your router file
import LiveGameRoom from "./pages/LiveGameRoom";

<Route path="/game"        element={<LiveGameRoom />} />
// or if you use path params:
<Route path="/game/:roomId" element={<LiveGameRoom />} />
```

The component auto-detects both URL styles:
- `/game?roomId=ABC123`     ← query param (used by your existing Join Room page)
- `/game/ABC123`            ← path param

## 4. Firestore fields written by this component

Component reads:
  rooms/{roomId}  →  hostId, roomName, status, maxPlayers, totalTickets,
                     calledNumbers (array), lastNumber, startedAt, endedAt

Component writes (host only):
  rooms/{roomId}  →  status, calledNumbers, lastNumber, lastCalledAt,
                     startedAt, endedAt

Component writes (player):
  rooms/{roomId}/tickets/{ticketId}  →  markedNumbers (array, new field)

## 5. markedNumbers — new field on ticket documents

This is the only NEW field added to your existing ticket documents.
It persists which numbers a player has tapped, enabling full state
restore after refresh or reconnect.

If you'd rather not write to Firestore on every tap, remove the
`updateDoc` call inside `handleMark` — marking will still work
in-session but won't survive a refresh.

## 6. Tailwind custom animation

Add to your tailwind.config.js if you want the pulse-slow utility:

```js
theme: {
  extend: {
    animation: {
      'pulse-slow': 'pulse 2.5s cubic-bezier(0.4,0,0.6,1) infinite',
    }
  }
}
```

(The component includes a fallback <style> tag so it works even
without this config change.)

## 7. Navigation to this page

From your existing Booking page, after successful booking:
```js
window.location.href = `/game?roomId=${roomId}`;
// or with React Router:
navigate(`/game?roomId=${roomId}`);
```

## 8. Nothing else changes

- Your Home, Login, Register, Host Dashboard, Create Room,
  Join Room, Booking, and QR Payment pages are untouched.
- No new npm packages required.
- No Firebase config changes.
- No existing collection structure modified.
