const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

// Pynbeit: Wad static files na ka folder ba don u server.js (ym na public)
app.use(express.static(__dirname));

app.get("/", (req, res) => {
  // Pynbeit: Wad index.html beit na root
  res.sendFile(path.join(__dirname, "index.html"));
});

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);
  socket.on("message", (data) => { io.emit("message", data); });
  socket.on("disconnect", () => { console.log("User disconnected"); });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => { console.log(`Server running on port ${PORT}`); });
