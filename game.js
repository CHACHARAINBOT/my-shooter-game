// ===================== 3D MULTIPLAYER SHOOTER =====================

let scene, camera, renderer, socket;
let myId = null;
let myPlayer = { x: 0, y: 1, z: 0, ry: 0, health: 100 };
let otherPlayers = {}; // id -> { mesh, targetX, targetY, targetZ, targetRy, nameSprite }
let obstacles = [];
let raycaster = new THREE.Raycaster();
let keys = {};
let joined = false;

// Camera orbit (third person)
let camYaw = 0;
let camPitch = 0.35;
const CAM_DISTANCE = 6;

// Touch state
let moveVector = { x: 0, y: 0 };
let lookTouchId = null;
let lastLookX = 0, lastLookY = 0;

const ARENA_SIZE = 30;
const MOVE_SPEED = 8;

init3D();
setupUI();

function init3D() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87ceeb);
  scene.fog = new THREE.Fog(0x87ceeb, 20, 60);

  camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 500);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  document.body.appendChild(renderer.domElement);

  // Lighting
  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1.1);
  scene.add(hemi);
  const dir = new THREE.DirectionalLight(0xffffff, 0.8);
  dir.position.set(20, 30, 10);
  scene.add(dir);

  // Ground
  const groundGeo = new THREE.PlaneGeometry(ARENA_SIZE * 2, ARENA_SIZE * 2);
  const groundMat = new THREE.MeshStandardMaterial({ color: 0x3a5f3a });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  // Boundary walls (visual only)
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x555555 });
  const wallHeight = 4;
  [
    [0, wallHeight / 2, -ARENA_SIZE, ARENA_SIZE * 2, wallHeight, 1],
    [0, wallHeight / 2, ARENA_SIZE, ARENA_SIZE * 2, wallHeight, 1],
    [-ARENA_SIZE, wallHeight / 2, 0, 1, wallHeight, ARENA_SIZE * 2],
    [ARENA_SIZE, wallHeight / 2, 0, 1, wallHeight, ARENA_SIZE * 2],
  ].forEach(([x, y, z, w, h, d]) => {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat);
    wall.position.set(x, y, z);
    scene.add(wall);
    obstacles.push(wall);
  });

  // Random cover boxes
  const boxMat = new THREE.MeshStandardMaterial({ color: 0x8b5a2b });
  for (let i = 0; i < 10; i++) {
    const size = 2 + Math.random() * 2;
    const box = new THREE.Mesh(new THREE.BoxGeometry(size, size, size), boxMat);
    box.position.set(
      (Math.random() - 0.5) * ARENA_SIZE * 1.6,
      size / 2,
      (Math.random() - 0.5) * ARENA_SIZE * 1.6
    );
    scene.add(box);
    obstacles.push(box);
  }

  window.addEventListener("resize", onResize);
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function makePlayerMesh(color) {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.5, 1, 4, 8), bodyMat);
  body.position.y = 1;
  group.add(body);
  const gunMat = new THREE.MeshStandardMaterial({ color: 0x222222 });
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.15, 0.6), gunMat);
  gun.position.set(0.4, 1.1, 0.4);
  group.add(gun);
  return group;
}

// ===================== NETWORKING =====================

function connectAndJoin(name, serverUrl) {
  socket = serverUrl ? io(serverUrl) : io();

  socket.on("connect_error", () => {
    document.getElementById("joinMsg").textContent = "Could not connect to server. Check the server URL.";
  });

  socket.on("serverFull", () => {
    document.getElementById("joinMsg").textContent = "Server is full (8/8 players). Try again later.";
  });

  socket.emit("join", name);

  socket.on("init", (data) => {
    myId = data.id;
    Object.values(data.players).forEach((p) => {
      if (p.id === myId) {
        myPlayer.x = p.x; myPlayer.y = p.y; myPlayer.z = p.z;
      } else {
        addOtherPlayer(p);
      }
    });
    startGame();
  });

  socket.on("playerJoined", (p) => {
    if (p.id !== myId) addOtherPlayer(p);
  });

  socket.on("playerMoved", (p) => {
    const op = otherPlayers[p.id];
    if (op) {
      op.targetX = p.x; op.targetY = p.y; op.targetZ = p.z; op.targetRy = p.ry;
    }
  });

  socket.on("playerShoot", (data) => {
    spawnTracer(data.origin, data.dir);
  });

  socket.on("playerDamaged", (data) => {
    if (data.id === myId) updateHealth(data.health);
  });

  socket.on("playerKilled", (data) => {
    addKillFeed(data);
    if (data.targetId === myId) {
      updateHealth(0);
    }
    if (data.shooterId === myId) {
      document.getElementById("killCount").textContent = data.kills;
    }
    if (data.targetId === myId) {
      document.getElementById("deathCount").textContent = data.deaths;
    }
  });

  socket.on("playerRespawn", (data) => {
    if (data.id === myId) {
      myPlayer.x = data.x; myPlayer.y = data.y; myPlayer.z = data.z;
      updateHealth(data.health);
    } else if (otherPlayers[data.id]) {
      const op = otherPlayers[data.id];
      op.targetX = data.x; op.targetY = data.y; op.targetZ = data.z;
      op.mesh.visible = true;
    }
  });

  socket.on("playerLeft", (id) => {
    if (otherPlayers[id]) {
      scene.remove(otherPlayers[id].mesh);
      delete otherPlayers[id];
    }
  });
}

function addOtherPlayer(p) {
  const mesh = makePlayerMesh(p.color);
  mesh.position.set(p.x, 0, p.z);
  scene.add(mesh);
  otherPlayers[p.id] = {
    mesh,
    targetX: p.x, targetY: p.y, targetZ: p.z, targetRy: p.ry,
    name: p.name
  };
}

function updateHealth(hp) {
  myPlayer.health = hp;
  document.getElementById("healthFill").style.width = Math.max(0, hp) + "%";
  document.getElementById("healthText").textContent = Math.max(0, hp);
}

function addKillFeed(data) {
  const shooterName = data.shooterId === myId ? "You" : (otherPlayers[data.shooterId]?.name || "Someone");
  const targetName = data.targetId === myId ? "You" : (otherPlayers[data.targetId]?.name || "Someone");
  const el = document.createElement("div");
  el.textContent = `${shooterName} eliminated ${targetName}`;
  const feed = document.getElementById("killFeed");
  feed.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

function spawnTracer(origin, dir) {
  const points = [
    new THREE.Vector3(origin.x, origin.y, origin.z),
    new THREE.Vector3(origin.x + dir.x * 40, origin.y + dir.y * 40, origin.z + dir.z * 40)
  ];
  const geo = new THREE.BufferGeometry().setFromPoints(points);
  const mat = new THREE.LineBasicMaterial({ color: 0xffff00 });
  const line = new THREE.Line(geo, mat);
  scene.add(line);
  setTimeout(() => scene.remove(line), 80);
}

// ===================== GAME LOOP =====================

function startGame() {
  joined = true;
  document.getElementById("joinScreen").classList.add("hidden");
  document.getElementById("hud").classList.remove("hidden");
  updateHealth(100);
  clock.start();
  animate();
}

const clock = new THREE.Clock();

function animate() {
  if (!joined) return;
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.1);

  handleMovement(dt);
  updateCamera();
  interpolateOthers(dt);

  renderer.render(scene, camera);
}

function handleMovement(dt) {
  let moveX = 0, moveZ = 0;

  if (keys["w"]) moveZ -= 1;
  if (keys["s"]) moveZ += 1;
  if (keys["a"]) moveX -= 1;
  if (keys["d"]) moveX += 1;

  // Touch joystick overrides keys
  if (Math.abs(moveVector.x) > 0.05 || Math.abs(moveVector.y) > 0.05) {
    moveX = moveVector.x;
    moveZ = moveVector.y;
  }

  if (moveX !== 0 || moveZ !== 0) {
    const len = Math.hypot(moveX, moveZ);
    moveX /= len; moveZ /= len;

    // Move relative to camera yaw
    const sin = Math.sin(camYaw), cos = Math.cos(camYaw);
    const worldX = moveX * cos + moveZ * sin;
    const worldZ = moveZ * cos - moveX * sin;

    let newX = myPlayer.x + worldX * MOVE_SPEED * dt;
    let newZ = myPlayer.z + worldZ * MOVE_SPEED * dt;

    newX = Math.max(-ARENA_SIZE + 1, Math.min(ARENA_SIZE - 1, newX));
    newZ = Math.max(-ARENA_SIZE + 1, Math.min(ARENA_SIZE - 1, newZ));

    myPlayer.x = newX;
    myPlayer.z = newZ;

    myPlayer.ry = Math.atan2(worldX, worldZ);

    socket.emit("move", { x: myPlayer.x, y: myPlayer.y, z: myPlayer.z, ry: myPlayer.ry });
  }
}

function updateCamera() {
  const camX = myPlayer.x + Math.sin(camYaw) * CAM_DISTANCE * Math.cos(camPitch);
  const camZ = myPlayer.z + Math.cos(camYaw) * CAM_DISTANCE * Math.cos(camPitch);
  const camY = myPlayer.y + 2 + Math.sin(camPitch) * CAM_DISTANCE;

  camera.position.set(camX, camY, camZ);
  camera.lookAt(myPlayer.x, myPlayer.y + 1, myPlayer.z);
}

function interpolateOthers(dt) {
  Object.values(otherPlayers).forEach((op) => {
    op.mesh.position.x += (op.targetX - op.mesh.position.x) * Math.min(1, dt * 10);
    op.mesh.position.z += (op.targetZ - op.mesh.position.z) * Math.min(1, dt * 10);
    op.mesh.rotation.y = op.targetRy;
  });
}

// ===================== SHOOTING =====================

function shoot() {
  if (!joined || myPlayer.health <= 0) return;

  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  const origin = camera.position.clone();

  socket.emit("shoot", { origin: { x: origin.x, y: origin.y, z: origin.z }, dir: { x: dir.x, y: dir.y, z: dir.z } });
  spawnTracer(origin, dir);

  raycaster.set(origin, dir);
  const meshes = Object.entries(otherPlayers).map(([id, op]) => op.mesh);
  const intersects = raycaster.intersectObjects(meshes, true);

  if (intersects.length > 0) {
    const hitMesh = intersects[0].object;
    let group = hitMesh;
    while (group.parent && group.parent !== scene) group = group.parent;
    const hitId = Object.keys(otherPlayers).find((id) => otherPlayers[id].mesh === group);
    if (hitId) socket.emit("hit", hitId);
  }
}

// ===================== INPUT / UI =====================

function setupUI() {
  document.getElementById("joinBtn").addEventListener("click", () => {
    const name = document.getElementById("nameInput").value.trim() || "Player";
    const serverUrl = document.getElementById("serverInput").value.trim();
    document.getElementById("joinMsg").textContent = "Connecting...";
    connectAndJoin(name, serverUrl);
  });

  // Desktop keyboard
  window.addEventListener("keydown", (e) => { keys[e.key.toLowerCase()] = true; });
  window.addEventListener("keyup", (e) => { keys[e.key.toLowerCase()] = false; });

  // Desktop mouse look (pointer lock) + shoot
  renderer.domElement.addEventListener("click", () => {
    if (!isTouchDevice()) renderer.domElement.requestPointerLock();
    shoot();
  });

  document.addEventListener("mousemove", (e) => {
    if (document.pointerLockElement === renderer.domElement) {
      camYaw -= e.movementX * 0.003;
      camPitch = Math.max(0.05, Math.min(1.2, camPitch - e.movementY * 0.003));
    }
  });

  // ---- Touch controls ----
  const joystick = document.getElementById("joystick");
  const knob = document.getElementById("joystickKnob");
  let joyTouchId = null;
  let joyCenter = { x: 0, y: 0 };

  joystick.addEventListener("touchstart", (e) => {
    const t = e.changedTouches[0];
    joyTouchId = t.identifier;
    const rect = joystick.getBoundingClientRect();
    joyCenter = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    e.preventDefault();
  });

  joystick.addEventListener("touchmove", (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === joyTouchId) {
        let dx = t.clientX - joyCenter.x;
        let dy = t.clientY - joyCenter.y;
        const dist = Math.min(40, Math.hypot(dx, dy));
        const angle = Math.atan2(dy, dx);
        knob.style.left = 35 + Math.cos(angle) * dist + "px";
        knob.style.top = 35 + Math.sin(angle) * dist + "px";
        moveVector.x = Math.cos(angle) * (dist / 40);
        moveVector.y = Math.sin(angle) * (dist / 40);
      }
    }
    e.preventDefault();
  });

  function resetJoystick(e) {
    for (const t of e.changedTouches) {
      if (t.identifier === joyTouchId) {
        joyTouchId = null;
        moveVector = { x: 0, y: 0 };
        knob.style.left = "35px";
        knob.style.top = "35px";
      }
    }
  }
  joystick.addEventListener("touchend", resetJoystick);
  joystick.addEventListener("touchcancel", resetJoystick);

  // Fire button
  document.getElementById("fireBtn").addEventListener("touchstart", (e) => {
    e.preventDefault();
    shoot();
  });

  // Look via drag on the rest of the screen
  renderer.domElement.addEventListener("touchstart", (e) => {
    for (const t of e.changedTouches) {
      if (lookTouchId === null) {
        lookTouchId = t.identifier;
        lastLookX = t.clientX;
        lastLookY = t.clientY;
      }
    }
  });
  renderer.domElement.addEventListener("touchmove", (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === lookTouchId) {
        const dx = t.clientX - lastLookX;
        const dy = t.clientY - lastLookY;
        camYaw -= dx * 0.005;
        camPitch = Math.max(0.05, Math.min(1.2, camPitch - dy * 0.005));
        lastLookX = t.clientX;
        lastLookY = t.clientY;
      }
    }
  });
  renderer.domElement.addEventListener("touchend", (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === lookTouchId) lookTouchId = null;
    }
  });
}

function isTouchDevice() {
  return "ontouchstart" in window || navigator.maxTouchPoints > 0;
}
