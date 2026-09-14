const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

const PORT = process.env.PORT || 3000;
const MAX_PLAYERS = 8;

app.use(express.static(__dirname));

const players = {};

const COLORS = [0xff4444, 0x44ff44, 0x4488ff, 0xffff44, 0xff44ff, 0x44ffff, 0xffffff, 0xff8800];

function spawnPoint() {
  const spots = [
    [10, 1, 10], [-10, 1, 10], [10, 1, -10], [-10, 1, -10],
    [0, 1, 14], [0, 1, -14], [14, 1, 0], [-14, 1, 0]
  ];
  return spots[Math.floor(Math.random() * spots.length)];
}

io.on("connection", (socket) => {
  if (Object.keys(players).length >= MAX_PLAYERS) {
    socket.emit("serverFull");
    socket.disconnect(true);
    return;
  }

  console.log("Player connected:", socket.id);

  socket.on("join", (name) => {
    const [x, y, z] = spawnPoint();
    players[socket.id] = {
      id: socket.id,
      name: (name || "Player").substring(0, 16),
      x, y, z,
      ry: 0,
      health: 100,
      kills: 0,
      deaths: 0,
      color: COLORS[Object.keys(players).length % COLORS.length]
    };

    socket.emit("init", { id: socket.id, players });
    socket.broadcast.emit("playerJoined", players[socket.id]);
  });

  socket.on("move", (data) => {
    const p = players[socket.id];
    if (!p || p.health <= 0) return;
    p.x = data.x;
    p.y = data.y;
    p.z = data.z;
    p.ry = data.ry;
    socket.broadcast.emit("playerMoved", { id: socket.id, x: p.x, y: p.y, z: p.z, ry: p.ry });
  });

  socket.on("shoot", (data) => {
    socket.broadcast.emit("playerShoot", { id: socket.id, origin: data.origin, dir: data.dir });
  });

  socket.on("hit", (targetId) => {
    const target = players[targetId];
    const shooter = players[socket.id];
    if (!target || !shooter || target.health <= 0) return;

    target.health -= 25;
    if (target.health <= 0) {
      target.health = 0;
      target.deaths += 1;
      shooter.kills += 1;

      const [x, y, z] = spawnPoint();
      io.emit("playerKilled", { targetId, shooterId: socket.id, kills: shooter.kills, deaths: target.deaths });

      setTimeout(() => {
        if (!players[targetId]) return;
        target.health = 100;
        target.x = x; target.y = y; target.z = z;
        io.emit("playerRespawn", { id: targetId, x, y, z, health: 100 });
      }, 2000);
    } else {
      io.emit("playerDamaged", { id: targetId, health: target.health });
    }
  });

  socket.on("disconnect", () => {
    console.log("Player disconnected:", socket.id);
    delete players[socket.id];
    io.emit("playerLeft", socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`Shooter server running on port ${PORT}`);
});
