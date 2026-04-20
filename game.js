// ── Canvas Setup ─────────────────────────────────────────────────────────────
const canvas = document.getElementById('game-canvas');
const ctx    = canvas.getContext('2d');

// Use the CSS display size as the logical resolution
const W = 820;
const H = 560;
canvas.width  = W;
canvas.height = H;

// ── Constants ─────────────────────────────────────────────────────────────────
const BIRD_R     = 14;
const GRAVITY    = 0.30;
const FLAP_VEL   = -4.0;
const PIPE_W     = 30;
const PIPE_SPEED = 2.6;
const GAP        = 86;         // vertical gap the bird flies through (per opening)
const BOX_W      = 180;
const BOX_H      = 36;
const MAX_HP     = 100;
const SCORE_TICK = 28;         // frames between score increments
const PIPE_INTERVAL = 190;     // frames between pipe spawns

// ── Event Pool ────────────────────────────────────────────────────────────────
const GOOD_EVENTS = [
  { text: 'Use AI to find sources',   hp: 20  },
  { text: 'Use AI to explain code',   hp: 15  },
  { text: 'Use AI to find data patterns',   hp: 10  },
];
const BAD_EVENTS = [
  { text: 'Use AI to write papers',   hp: -30 },
  { text: 'Use AI as a therapist',   hp: -25 },
  { text: 'Use AI to generate art',   hp: -50 },
];

function pickRandom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// Each pipe gets one good and one bad event, randomly placed top/bottom
function makeBoxEvents() {
  const good = { ...pickRandom(GOOD_EVENTS), good: true  };
  const bad  = { ...pickRandom(BAD_EVENTS),  good: false };
  return Math.random() < 0.5 ? [good, bad] : [bad, good];
}

// ── State ─────────────────────────────────────────────────────────────────────
let bird, pipes, score, hp, gameRunning, animId, best;
let scoreTimer, pipeTimer, hitCooldown;
let frozen, freezeTimer, doubleScore, doubleTimer;

function initState() {
  bird = { x: 100, y: H / 2, vy: 0 };
  pipes = [];
  score = 0;
  hp    = MAX_HP;
  gameRunning = false;
  scoreTimer  = 0;
  pipeTimer   = 0;
  hitCooldown = 0;
  frozen      = false;
  freezeTimer = 0;
  doubleScore = false;
  doubleTimer = 0;
  best = parseInt(document.getElementById('best-display').textContent, 10) || 0;
  updateHUD();
}

// ── Pipe Factory ──────────────────────────────────────────────────────────────
function spawnPipe() {
  // topGapMid = vertical centre of the top opening
  const minMid = 60;
  const maxMid = H - 60 - GAP * 2 - 30;
  const topGapMid = minMid + Math.random() * (maxMid - minMid);
  const botGapMid = topGapMid + GAP + 30 + Math.random() * 30;

  const topGapTop = topGapMid - GAP / 2;
  const topGapBot = topGapMid + GAP / 2;
  const botGapTop = botGapMid - GAP / 2;
  const botGapBot = botGapMid + GAP / 2;

  const events = makeBoxEvents();

  pipes.push({
    x: W + 20,
    // solid regions: 0..topGapTop, topGapBot..botGapTop, botGapBot..H
    topGapTop,
    topGapBot,
    botGapTop,
    botGapBot,
    passed: false,
    boxes: [
      { midY: topGapMid, ev: events[0], hit: false },
      { midY: botGapMid, ev: events[1], hit: false },
    ],
  });
}

// ── Input ─────────────────────────────────────────────────────────────────────
function flap() {
  if (!gameRunning || frozen) return;
  bird.vy = FLAP_VEL;
}

document.addEventListener('keydown', e => {
  if (e.code === 'Space') { e.preventDefault(); flap(); }
});
canvas.addEventListener('click', flap);

// ── HUD Updates ───────────────────────────────────────────────────────────────
function updateHUD() {
  document.getElementById('score-display').textContent = score;
  document.getElementById('hp-display').textContent   = hp;
  document.getElementById('best-display').textContent  = best;

  const pct  = Math.max(0, (hp / MAX_HP) * 100);
  const fill = document.getElementById('health-fill');
  fill.style.width      = pct + '%';
  fill.style.background = pct > 60 ? '#4caf50' : pct > 30 ? '#ff9800' : '#f44336';
}

// ── Message Feed ──────────────────────────────────────────────────────────────
function addMsg(ev) {
  const feed = document.getElementById('msg-feed');
  const el   = document.createElement('div');
  el.className = 'msg-tag ' + (ev.good ? 'msg-good' : 'msg-bad');
  el.textContent = ev.text;
  feed.appendChild(el);
  setTimeout(() => el.remove(), 2200);
}

// ── Apply Event ───────────────────────────────────────────────────────────────
function applyEvent(ev) {
  addMsg(ev);
  if (ev.special === 'double') {
    doubleScore = true;
    doubleTimer = 300; // ~5 seconds at 60fps
    return;
  }
  if (ev.special === 'freeze') {
    frozen      = true;
    freezeTimer = 110;
    return;
  }
  hp = Math.min(MAX_HP, Math.max(0, hp + ev.hp));
  updateHUD();
  if (hp <= 0) endGame();
}

// ── Collision Helpers ─────────────────────────────────────────────────────────
function circleVsRect(cx, cy, r, rx, ry, rw, rh) {
  const nearX = Math.max(rx, Math.min(cx, rx + rw));
  const nearY = Math.max(ry, Math.min(cy, ry + rh));
  const dx = cx - nearX, dy = cy - nearY;
  return dx * dx + dy * dy < r * r;
}

function birdHitsBox(box, p) {
  const ex = p.x + PIPE_W / 2;
  return circleVsRect(bird.x, bird.y, BIRD_R,
    ex - BOX_W / 2, box.midY - BOX_H / 2, BOX_W, BOX_H);
}

function birdHitsPipe(p) {
  // Check left/right edges of pipe column
  const withinX = bird.x + BIRD_R > p.x && bird.x - BIRD_R < p.x + PIPE_W;
  if (!withinX) return false;
  // Solid zone 1: top wall
  if (bird.y - BIRD_R < p.topGapTop) return true;
  // Solid zone 2: middle wall between the two gaps
  if (bird.y + BIRD_R > p.topGapBot && bird.y - BIRD_R < p.botGapTop) return true;
  // Solid zone 3: bottom wall
  if (bird.y + BIRD_R > p.botGapBot) return true;
  return false;
}

// ── Game Loop ─────────────────────────────────────────────────────────────────
function gameLoop() {
  if (!gameRunning) return;

  // Freeze logic
  if (frozen) {
    if (--freezeTimer <= 0) { frozen = false; }
  } else {
    bird.vy += GRAVITY;
    bird.y  += bird.vy;
  }

  // Double-score timer
  if (doubleScore) {
    if (--doubleTimer <= 0) { doubleScore = false; }
  }

  // Score tick
  if (++scoreTimer >= SCORE_TICK) {
    scoreTimer = 0;
    score += doubleScore ? 2 : 1;
    updateHUD();
  }

  // Hit cooldown (prevents multi-triggers on one box)
  if (hitCooldown > 0) hitCooldown--;

  // Pipe spawn
  if (++pipeTimer >= PIPE_INTERVAL) {
    pipeTimer = 0;
    spawnPipe();
  }

  // Update pipes
  for (let i = pipes.length - 1; i >= 0; i--) {
    const p = pipes[i];
    if (!frozen) p.x -= PIPE_SPEED;

    // Remove off-screen pipes
    if (p.x + PIPE_W < 0) { pipes.splice(i, 1); continue; }

    // Pipe collision → crash
    if (birdHitsPipe(p)) { endGame(); return; }

    // Box collisions
    if (hitCooldown === 0) {
      for (const box of p.boxes) {
        if (!box.hit && birdHitsBox(box, p)) {
          box.hit = true;
          hitCooldown = 25;
          applyEvent(box.ev);
          if (!gameRunning) return; // endGame may have been called
        }
      }
    }
  }

  // Floor / ceiling
  if (bird.y - BIRD_R < 0 || bird.y + BIRD_R > H) { endGame(); return; }

  draw();
  animId = requestAnimationFrame(gameLoop);
}

// ── Drawing ───────────────────────────────────────────────────────────────────
function drawRoundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawBackground() {
  // Sky gradient (fills from bottom up based on HP)
  const skyHeight = H * (hp / MAX_HP);
  const sky = ctx.createLinearGradient(0, H - skyHeight, 0, H);
  sky.addColorStop(0, '#1a2a4a');
  sky.addColorStop(1, '#2d5a7a');
  ctx.fillStyle = sky;
  ctx.fillRect(0, H - skyHeight, W, skyHeight);

  // Ground
  ctx.fillStyle = '#353535';
  ctx.fillRect(0, H - 20, W, 20);
  ctx.fillStyle = '#686868';
  ctx.fillRect(0, H - 20, W, 5);
}

function drawPipe(p) {
  const { x, topGapTop, topGapBot, botGapTop, botGapBot } = p;

  // Top wall
  ctx.fillStyle = '#6b6b6b';
  ctx.fillRect(x, 0, PIPE_W, topGapTop);
  // Cap
  ctx.fillStyle = '#aeaeae';
  ctx.fillRect(x - 5, topGapTop - 14, PIPE_W + 10, 14);

  // Middle wall
  ctx.fillStyle = '#6b6b6b';
  ctx.fillRect(x, topGapBot, PIPE_W, botGapTop - topGapBot);
  // Mid caps
  ctx.fillStyle = '#aeaeae';
  ctx.fillRect(x - 5, topGapBot, PIPE_W + 10, 12);
  ctx.fillRect(x - 5, botGapTop - 12, PIPE_W + 10, 12);

  // Bottom wall
  ctx.fillStyle = '#6b6b6b';
  ctx.fillRect(x, botGapBot, PIPE_W, H - botGapBot);
  // Cap
  ctx.fillStyle = '#aeaeae';
  ctx.fillRect(x - 5, botGapBot, PIPE_W + 10, 14);
}

function drawBox(box, p) {
  if (box.hit) return;
  const ex = p.x + PIPE_W / 2;
  const bx = ex - BOX_W / 2;
  const by = box.midY - BOX_H / 2;
  const { ev } = box;

  // Background fill
  ctx.fillStyle = 'rgba(51, 51, 51, 0.92)';
  drawRoundRect(bx, by, BOX_W, BOX_H, 7);
  ctx.fill();

  // Border
  ctx.strokeStyle = '#9e9e9e';
  ctx.lineWidth   = 1.5;
  drawRoundRect(bx, by, BOX_W, BOX_H, 7);
  ctx.stroke();

  // Text
  ctx.fillStyle    = '#9e9e9e';
  ctx.font         = 'bold 12px "Courier New", monospace';
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(ev.text, ex, box.midY);
}

function drawBird() {
  const { x, y } = bird;

  // --- Waterjet (draw behind the circle) ---
  const jetLength = 18 + Math.random() * 10; // flickering effect
  const jetWidth  = BIRD_R * 0.6;

  // Outer jet (wide, pale blue)
  const jetOuter = ctx.createLinearGradient(x, y + BIRD_R, x, y + BIRD_R + jetLength);
  jetOuter.addColorStop(0,   'rgba(120, 200, 255, 0.8)');
  jetOuter.addColorStop(1,   'rgba(120, 200, 255, 0)');
  ctx.fillStyle = jetOuter;
  ctx.beginPath();
  ctx.ellipse(x, y + BIRD_R, jetWidth, jetLength, 0, 0, Math.PI * 2);
  ctx.fill();

  // Inner jet (narrow, bright white core)
  const jetInner = ctx.createLinearGradient(x, y + BIRD_R, x, y + BIRD_R + jetLength * 0.7);
  jetInner.addColorStop(0,   'rgba(255, 255, 255, 0.95)');
  jetInner.addColorStop(1,   'rgba(180, 230, 255, 0)');
  ctx.fillStyle = jetInner;
  ctx.beginPath();
  ctx.ellipse(x, y + BIRD_R, jetWidth * 0.35, jetLength * 0.7, 0, 0, Math.PI * 2);
  ctx.fill();

  // --- Circle (draw on top) ---
  ctx.fillStyle   = '#f925d2';
  ctx.strokeStyle = '#e600d7';
  ctx.beginPath();
  ctx.arc(x, y, BIRD_R, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.stroke();
}

function draw() {
  ctx.clearRect(0, 0, W, H);
  drawBackground();
  for (const p of pipes) {
    drawPipe(p);
    for (const box of p.boxes) drawBox(box, p);
  }
  drawBird();
}

// ── Start / End ───────────────────────────────────────────────────────────────
function startGame() {
  cancelAnimationFrame(animId);
  initState();
  document.getElementById('msg-feed').innerHTML = '';
  document.getElementById('overlay').classList.remove('visible');
  gameRunning = true;
  spawnPipe();
  animId = requestAnimationFrame(gameLoop);
}

function endGame() {
  gameRunning = false;
  cancelAnimationFrame(animId);

  if (score > best) {
    best = score;
    document.getElementById('best-display').textContent = best;
  }

  const isNewBest = score === best && score > 0;
  document.getElementById('overlay-title').textContent =
    hp <= 0 ? 'Out of HP!' : 'You Crashed!';
  document.getElementById('overlay-sub').textContent =
    'Score: ' + score + (isNewBest ? '  ★ New Best!' : '');
  document.getElementById('overlay-btn').textContent = 'Play Again';
  document.getElementById('overlay').classList.add('visible');

  draw(); // final frame
}

document.getElementById('overlay-btn').addEventListener('click', startGame);

// ── Init ──────────────────────────────────────────────────────────────────────
initState();
draw();