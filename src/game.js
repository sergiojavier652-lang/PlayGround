const canvas = document.querySelector('#game');
const ctx = canvas.getContext('2d');
const W = 1280, H = 720;
const titleScreen = document.querySelector('#title-screen');
const endingScreen = document.querySelector('#ending-screen');
const endingsKey = 'luz-profundo-endings';
const TAU = Math.PI * 2;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const pick = arr => arr[Math.floor(Math.random() * arr.length)];

let state;
let lastTime = 0;
let elapsed = 0;
let dpr = 1;
let audioContext = null;
let audioEnabled = true;
let pointer = { x: 0, y: 0, down: false, active: false };
const keys = new Set();
const stars = Array.from({ length: 130 }, (_, i) => ({
  x: (i * 197.3 + rand(-20, 20) + 1280) % 1280,
  y: (i * 89.1 + rand(0, 40)) % 450,
  r: rand(.5, 1.8), phase: rand(0, TAU), speed: rand(.3, 1.5)
}));
const motes = Array.from({ length: 45 }, () => ({ x: rand(0, W), y: rand(240, 680), r: rand(1, 3), speed: rand(8, 24), phase: rand(0, TAU) }));

const actionLabels = ['ATACAR', 'ACTUAR', 'OBJETO', 'PIEDAD'];
const actionIcons = ['✦', '◎', '◇', '♡'];
const dialogueSets = {
  intro: [
    ['sorprendido', 'Ah. Llegaste.'],
    ['curioso', '¿Quieres jugar conmigo?'],
    ['normal', 'No sé qué pasa cuando cierro los ojos.'],
    ['hablando', 'Todo se queda calladito.'],
  ],
  afterHit: [
    ['dolido', 'Eso... sí que ha dolido.'],
    ['confundido', '¿Por qué has hecho eso?'],
    ['molesto', 'No era así el juego.'],
  ],
  afterMiss: [
    ['curioso', '¿Has fallado a propósito?'],
    ['feliz', '¡Casi me das!'],
    ['sorprendido', 'Uy.'],
  ],
  hurt: [
    ['asustado', 'Eso ha sido muy fuerte.'],
    ['confundido', '¿El cielo también te pega?'],
    ['triste', 'No me gusta este juego.'],
  ],
  act: [
    ['curioso', '¿Eso tiene nombre?'],
    ['feliz', 'Je. Me gusta.'],
    ['confundido', 'No entiendo, pero te escucho.'],
  ],
  low: [
    ['triste', 'Me estoy cansando...'],
    ['dolido', '¿Ya no quieres jugar?'],
    ['asustado', 'No quiero quedarme solo.'],
  ],
};

function getEndings() {
  try { return JSON.parse(localStorage.getItem(endingsKey) || '[]'); } catch { return []; }
}
function saveEnding(ending) {
  const endings = new Set(getEndings());
  endings.add(ending);
  localStorage.setItem(endingsKey, JSON.stringify([...endings]));
  updateEndingCount();
}
function updateEndingCount() {
  const count = getEndings().length;
  const node = document.querySelector('#endings-count');
  if (node) node.textContent = count;
  document.querySelector('#ending-counter').textContent = `Finales descubiertos ${count} / 4`;
}

function freshState() {
  return {
    mode: 'intro', phase: 'dialogue', dialogue: [...dialogueSets.intro], dialogueIndex: 0,
    action: 0, subIndex: 0, hp: 72, maxHp: 72, bossHp: 120, maxBossHp: 120,
    turn: 0, bond: 0, listened: false, played: false, comfort: false,
    spared: false, attacked: false, violentCount: 0, hurtCount: 0,
    bullets: [], particles: [], soul: { x: 640, y: 405, vx: 0, vy: 0, invuln: 0, blink: 0 },
    arena: { x: 384, y: 298, w: 512, h: 192 },
    attack: null, targetTime: 0, timer: 0, pattern: 0, patternName: '',
    message: '', messageTimer: 0, turnCue: 0, bossExpr: 'normal', exprTimer: 0,
    outcome: null, menuLock: 0, screenShake: 0, flash: 0, dodgeScore: 0,
    pause: false, choiceHint: '', afterDialogueToTurn: false, teaUsed: false, ribbonUsed: false,
  };
}

function boot() {
  state = freshState();
  updateEndingCount();
  resizeCanvas();
  requestAnimationFrame(loop);
}
function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
}
window.addEventListener('resize', resizeCanvas);

function beginGame() {
  state = freshState();
  titleScreen.classList.add('hidden');
  endingScreen.classList.add('hidden');
  initAudio();
  sound('start');
}
document.querySelector('#play-button').addEventListener('click', beginGame);
document.querySelector('#again-button').addEventListener('click', beginGame);
document.querySelector('#title-button').addEventListener('click', () => {
  endingScreen.classList.add('hidden');
  titleScreen.classList.remove('hidden');
  state = freshState();
});

function initAudio() {
  if (!audioEnabled || audioContext) return;
  try {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    if (audioContext.state === 'suspended') audioContext.resume();
  } catch { audioEnabled = false; }
}
function sound(kind) {
  if (!audioEnabled) return;
  initAudio();
  if (!audioContext) return;
  const now = audioContext.currentTime;
  const tones = {
    start: [[392, .15, 'sine', .06], [523.25, .3, 'sine', .045]],
    select: [[660, .07, 'sine', .025]],
    hit: [[140, .15, 'triangle', .05], [95, .18, 'sine', .025]],
    hurt: [[180, .2, 'sawtooth', .035]],
    heal: [[523, .12, 'sine', .04], [783.99, .28, 'sine', .035]],
    act: [[440, .12, 'sine', .035], [587.33, .22, 'sine', .035]],
    dodge: [[740, .05, 'sine', .025]],
    spare: [[659.25, .2, 'sine', .04], [880, .35, 'sine', .035]],
  }[kind] || [];
  for (const [freq, dur, type, vol] of tones) {
    const osc = audioContext.createOscillator(), gain = audioContext.createGain();
    osc.type = type; osc.frequency.setValueAtTime(freq, now);
    gain.gain.setValueAtTime(vol, now); gain.gain.exponentialRampToValueAtTime(.0001, now + dur);
    osc.connect(gain); gain.connect(audioContext.destination); osc.start(now); osc.stop(now + dur);
  }
}

function loop(now) {
  const dt = Math.min((now - (lastTime || now)) / 1000, .04);
  lastTime = now; elapsed += dt;
  update(dt);
  render();
  requestAnimationFrame(loop);
}

function update(dt) {
  if (!state) return;
  state.timer += dt;
  state.messageTimer = Math.max(0, state.messageTimer - dt);
  state.menuLock = Math.max(0, state.menuLock - dt);
  state.screenShake = Math.max(0, state.screenShake - dt * 30);
  state.flash = Math.max(0, state.flash - dt * 1.5);
  state.exprTimer = Math.max(0, state.exprTimer - dt);
  state.soul.invuln = Math.max(0, state.soul.invuln - dt);
  state.soul.blink += dt;
  updateParticles(dt);
  if (state.pause || titleScreen.classList.contains('hidden') === false || !endingScreen.classList.contains('hidden')) return;
  if (state.phase === 'dodge') updateDodge(dt);
  else if (state.phase === 'attack') updateAttack(dt);
  else if (state.phase === 'transition') {
    state.turnCue -= dt;
    if (state.turnCue <= 0) startBossTurn();
  }
  if (state.bossHp <= 0 && state.phase !== 'ending') endGame('dark');
  if (state.hp <= 0 && state.phase !== 'ending') endGame('consumed');
}

function updateParticles(dt) {
  for (const p of motes) {
    p.y -= p.speed * dt;
    p.x += Math.sin(elapsed * .45 + p.phase) * dt * 5;
    if (p.y < 240) { p.y = 690; p.x = rand(0, W); }
  }
  for (let i = state.particles.length - 1; i >= 0; i--) {
    const p = state.particles[i];
    p.x += (p.vx || 0) * dt; p.y += (p.vy || 0) * dt;
    p.vy = (p.vy || 0) + (p.gravity || 0) * dt;
    p.life -= dt;
    if (p.life <= 0) state.particles.splice(i, 1);
  }
}

function hitPlayer(bullet) {
  const damage = Math.max(2, Math.ceil((bullet.damage || 5) * (state.bond >= 4 ? .8 : 1)));
  state.hp = Math.max(0, state.hp - damage);
  state.hurtCount++;
  state.soul.invuln = .8;
  state.soul.vx = (state.soul.x - bullet.x) * 5;
  state.soul.vy = (state.soul.y - bullet.y) * 5;
  state.screenShake = 5; state.flash = .35;
  state.bossExpr = 'asustado'; state.exprTimer = .7;
  sound('hurt');
  addBurst(state.soul.x, state.soul.y, '#ffb2da', 7);
}

function updateAttack(dt) {
  const a = state.attack;
  if (!a) return;
  a.time += dt;
  if (a.phase === 'ready') {
    if (a.time > .38) a.phase = 'swing';
  } else if (a.phase === 'swing') {
    if (a.time > .84) a.phase = 'result';
  } else if (a.phase === 'result' && a.time > 1.7) {
    state.attack = null;
    startBossTurn();
  }
}

function moveMenu(delta) {
  if (state.menuLock > 0) return;
  if (state.phase === 'menu') {
    state.action = (state.action + delta + 4) % 4;
    sound('select');
  } else if (state.phase === 'submenu') {
    const list = getSubmenu();
    if (!list.length) return;
    state.subIndex = (state.subIndex + delta + list.length) % list.length;
    sound('select');
  }
}

function confirm() {
  if (state.pause) { state.pause = false; return; }
  if (state.phase === 'dialogue') {
    state.dialogueIndex++;
    if (state.dialogueIndex >= state.dialogue.length) {
      state.dialogue = [];
      if (state.afterDialogueToTurn) {
        state.afterDialogueToTurn = false;
        state.phase = 'transition'; state.turnCue = .35;
      } else {
        state.phase = 'menu'; state.bossExpr = state.bossHp < 45 ? 'triste' : 'normal';
      }
    }
    sound('select'); return;
  }
  if (state.phase === 'menu') {
    switch (state.action) {
      case 0: startAttack(); break;
      case 1: state.phase = 'submenu'; state.subIndex = 0; state.menuLock = .15; break;
      case 2: state.phase = 'submenu'; state.subIndex = 0; state.menuLock = .15; break;
      case 3: state.phase = 'submenu'; state.subIndex = 0; state.menuLock = .15; break;
    }
    sound('select'); return;
  }
  if (state.phase === 'submenu') chooseSubmenu();
  else if (state.phase === 'attack') attackConfirm();
}

function cancel() {
  if (state.pause) { state.pause = false; return; }
  if (state.phase === 'submenu') { state.phase = 'menu'; state.subIndex = 0; sound('select'); }
  else if (state.phase === 'dialogue') {
    state.dialogueIndex = state.dialogue.length - 1;
  }
}

function getSubmenu() {
  if (state.action === 1) return [
    { label: 'OBSERVAR', hint: 'Míralo de verdad.', id: 'notice' },
    { label: 'ESCUCHAR', hint: 'Pregúntale qué ve.', id: 'listen' },
    { label: 'JUGAR', hint: 'Invítalo a jugar.', id: 'play' },
    { label: 'ACOMPAÑAR', hint: 'Quédate a su lado.', id: 'comfort' },
  ];
  if (state.action === 2) return [
    { label: 'TÉ DE LUNA', hint: 'Recupera 24 PS.', id: 'tea', disabled: state.teaUsed },
    { label: 'CINTA ESTELAR', hint: 'Recupera 14 PS.', id: 'ribbon', disabled: state.ribbonUsed },
  ];
  if (state.action === 3) return [
    { label: 'PERDONAR', hint: state.bond >= 3 ? 'No tienes que estar solo.' : 'Primero, intenta comprenderlo.', id: 'spare', disabled: state.bond < 3 },
    { label: 'DEJARLO IR', hint: 'Termina el juego sin herirle.', id: 'release', disabled: state.bond < 5 },
  ];
  return [];
}

function chooseSubmenu() {
  const option = getSubmenu()[state.subIndex];
  if (!option || option.disabled) { sound('select'); return; }
  if (option.id === 'tea' || option.id === 'ribbon') {
    const amount = option.id === 'tea' ? 24 : 14;
    state.hp = Math.min(state.maxHp, state.hp + amount);
    state[option.id === 'tea' ? 'teaUsed' : 'ribbonUsed'] = true;
    state.bossExpr = 'curioso'; state.exprTimer = 2;
    showMessage(option.id === 'tea' ? 'El té sabe a una noche tranquila. +24 PS' : 'La cinta brilla un poquito. +14 PS');
    sound('heal');
    state.phase = 'transition'; state.turnCue = 1.05;
    return;
  }
  switch (option.id) {
    case 'notice':
      state.bond = Math.min(7, state.bond + 1);
      state.bossExpr = 'sorprendido';
      say([['normal', 'Ves a un niño pequeño.'], ['normal', 'Tiene las mangas demasiado largas.'], ['curioso', 'Y un corazón blanco en el cuello.']]);
      sound('act'); break;
    case 'listen':
      state.bond = Math.min(7, state.bond + (state.listened ? 0 : 2)); state.listened = true;
      state.bossExpr = 'confundido';
      say([['confundido', '¿Escuchar qué?'], ['triste', 'A veces hay voces en la oscuridad.'], ['normal', 'Yo les digo que se callen.']]);
      sound('act'); break;
    case 'play':
      state.bond = Math.min(7, state.bond + (state.played ? 0 : 2)); state.played = true;
      state.bossExpr = 'feliz';
      say([['feliz', '¡Sí!'], ['curioso', '¿A qué jugamos?'], ['feliz', 'Tú cuentas primero.']]);
      sound('act'); break;
    case 'comfort':
      state.bond = Math.min(7, state.bond + (state.comfort ? 0 : 2)); state.comfort = true;
      state.bossExpr = 'dolido';
      say([['asustado', '¿Te vas a quedar un ratito?'], ['triste', 'No sé estar aquí solito.'], ['normal', 'Gracias.']]);
      sound('act'); break;
    case 'spare':
      state.spared = true; state.bossExpr = 'sorprendido';
      if (state.bond >= 5 && state.listened && state.comfort) endGame('true');
      else endGame('mercy');
      sound('spare'); break;
    case 'release':
      state.spared = true; endGame(state.bond >= 6 ? 'true' : 'mercy'); sound('spare'); break;
  }
}

function say(lines) {
  state.phase = 'dialogue'; state.dialogue = lines; state.dialogueIndex = 0;
  state.afterDialogueToTurn = true;
  state.menuLock = .2;
}
function showMessage(text) {
  state.message = text; state.messageTimer = 2.4;
}

function startAttack() {
  state.phase = 'attack';
  state.attack = { phase: 'ready', time: 0, cursor: 0, direction: 1, locked: false, score: 0 };
  state.targetTime = .5;
  state.bossExpr = 'molesto';
  sound('select');
}
function attackConfirm() {
  if (!state.attack || state.attack.phase === 'result' || state.attack.locked) return;
  const a = state.attack;
  a.locked = true;
  const cursor = (Math.sin((a.time - .2) * 2.15) + 1) / 2;
  const accuracy = 1 - Math.abs(cursor - .5) * 2;
  const damage = Math.round(6 + Math.max(0, accuracy) * 25);
  state.lastAccuracy = accuracy;
  a.score = damage; a.phase = 'result'; a.time = 0;
  state.bossHp = Math.max(0, state.bossHp - damage);
  state.attacked = true; state.violentCount++;
  state.screenShake = damage >= 25 ? 8 : 3;
  state.bossExpr = damage >= 25 ? 'asustado' : 'dolido';
  addBurst(843, 230, damage >= 25 ? '#fff1be' : '#cbb1ff', 18);
  sound('hit');
}

function startBossTurn() {
  if (state.bossHp <= 0) { endGame('dark'); return; }
  state.phase = 'dodge';
  state.turn++;
  state.bullets.length = 0;
  state.dodgeScore = 0;
  state.timer = 7.4 + Math.min(state.turn * .28, 1.8);
  state.pattern = (state.turn - 1) % 4;
  state.patternName = ['Lluvia de luciérnagas', 'Sombras juguetonas', 'Órbita nocturna', 'Cielo quebrado'][state.pattern];
  state.soul.x = state.arena.x + state.arena.w / 2;
  state.soul.y = state.arena.y + state.arena.h * .72;
  state.soul.vx = 0; state.soul.vy = 0; state.soul.invuln = .5;
  state.bossExpr = state.bond >= 4 ? 'triste' : 'feliz';
  state.turnCue = .4;
  sound('select');
}

function addBullet(x, y, angle, speed, options = {}) {
  state.bullets.push({
    x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
    r: options.r || 7, life: options.life || 4.5,
    damage: options.damage || 5, color: options.color || '#eadbff',
    type: options.type || 'star', angle, spin: options.spin || 0,
    trail: options.trail !== false,
  });
}
function spawnPattern(dt) {
  const t = state.timer;
  const box = state.arena;
  const difficulty = Math.min(1 + state.turn * .07, 1.42);
  state.spawnClock = (state.spawnClock || 0) - dt;
  if (state.spawnClock > 0) return;
  if (state.pattern === 0) {
    const count = state.turn > 3 ? 3 : 2;
    for (let i = 0; i < count; i++) {
      const x = rand(box.x + 22, box.x + box.w - 22);
      addBullet(x, box.y - 12, Math.PI / 2 + rand(-.12, .12), rand(94, 135) * difficulty,
        { color: pick(['#fff1c8', '#d2bdff', '#b6e4ff']), r: 5.5, damage: 4, type: 'star' });
    }
    state.spawnClock = .46 / difficulty;
  } else if (state.pattern === 1) {
    const side = Math.floor(t * 3) % 2;
    const x = side === 0 ? box.x - 12 : box.x + box.w + 12;
    const y = box.y + 35 + (Math.sin(t * 2.2) + 1) * box.h * .32;
    const ang = Math.atan2(state.soul.y - y, state.soul.x - x) + rand(-.25, .25);
    addBullet(x, y, ang, rand(95, 135) * difficulty, { color: '#b997ef', r: 8, damage: 6, type: 'orb', spin: 3 });
    if (state.turn > 2 && Math.random() < .4) addBullet(x, box.y + box.h - (y - box.y), ang + .2, 95 * difficulty, { color: '#f3d9ff', r: 5, damage: 4, type: 'star' });
    state.spawnClock = .38 / difficulty;
  } else if (state.pattern === 2) {
    const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
    const n = state.turn > 2 ? 3 : 2;
    const base = elapsed * .95 + t * .3;
    for (let i = 0; i < n; i++) {
      const a = base + i * TAU / n;
      addBullet(cx + Math.cos(a) * (box.w * .55), cy + Math.sin(a) * (box.h * .58), a + Math.PI + .35,
        88 * difficulty, { color: i % 2 ? '#f5e1ff' : '#ad9cef', r: 6.5, damage: 5, type: 'orb', spin: 2 });
    }
    state.spawnClock = .52 / difficulty;
  } else {
    const lanes = [box.x + 44, box.x + box.w - 44];
    const lane = lanes[Math.floor(Math.random() * lanes.length)];
    const width = state.turn > 3 ? 4 : 3;
    for (let i = 0; i < width; i++) {
      const x = lane + rand(-18, 18);
      addBullet(x, box.y - 12 - i * 22, Math.PI / 2 + (x < box.x + box.w / 2 ? .14 : -.14),
        115 * difficulty, { color: i === 1 ? '#fff4d8' : '#b9a2ff', r: 5 + (i % 2), damage: 4, type: 'shard' });
    }
    if (state.turn > 4) {
      const sx = Math.random() < .5 ? box.x - 10 : box.x + box.w + 10;
      addBullet(sx, rand(box.y + 30, box.y + box.h - 20), sx < box.x ? 0 : Math.PI, 100 * difficulty,
        { color: '#f3d9ff', r: 6, damage: 5, type: 'orb' });
    }
    state.spawnClock = .68 / difficulty;
  }
}
function updateDodge(dt) {
  const soul = state.soul, box = state.arena;
  const speed = 250;
  let dx = 0, dy = 0;
  if (keys.has('ArrowLeft') || keys.has('a')) dx--;
  if (keys.has('ArrowRight') || keys.has('d')) dx++;
  if (keys.has('ArrowUp') || keys.has('w')) dy--;
  if (keys.has('ArrowDown') || keys.has('s')) dy++;
  if (pointer.active && pointer.down) {
    dx += clamp((pointer.x - soul.x) / 55, -1, 1);
    dy += clamp((pointer.y - soul.y) / 55, -1, 1);
  }
  const len = Math.hypot(dx, dy) || 1;
  soul.vx = lerp(soul.vx, dx / len * speed, 1 - Math.exp(-dt * 13));
  soul.vy = lerp(soul.vy, dy / len * speed, 1 - Math.exp(-dt * 13));
  soul.x = clamp(soul.x + soul.vx * dt, box.x + 14, box.x + box.w - 14);
  soul.y = clamp(soul.y + soul.vy * dt, box.y + 14, box.y + box.h - 14);
  if (state.turnCue > 0) state.turnCue = Math.max(0, state.turnCue - dt);
  else spawnPattern(dt);
  for (let i = state.bullets.length - 1; i >= 0; i--) {
    const b = state.bullets[i];
    b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
    if (b.spin) b.angle += b.spin * dt;
    if (b.life <= 0 || b.x < box.x - 55 || b.x > box.x + box.w + 55 || b.y < box.y - 55 || b.y > box.y + box.h + 55) {
      state.bullets.splice(i, 1); continue;
    }
    const bx = soul.x - b.x, by = soul.y - b.y;
    if (soul.invuln <= 0 && bx * bx + by * by < (b.r + 9) ** 2) hitPlayer(b);
  }
  state.timer -= dt;
  if (state.timer <= 0) finishDodge();
}

function finishDodge() {
  state.bullets.length = 0;
  const score = state.hurtCount === 0 ? 1 : 0;
  state.dodgeScore = score;
  if (score) state.bond = Math.min(7, state.bond + 1);
  state.phase = 'dialogue';
  state.dialogueIndex = 0;
  state.afterDialogueToTurn = false;
  state.bossExpr = state.bossHp < 40 ? 'triste' : score ? 'feliz' : 'confundido';
  if (state.bossHp < 40) state.dialogue = [...dialogueSets.low];
  else if (score) state.dialogue = [['feliz', '¡No me has tocado!'], ['curioso', 'Eres muy rápido.']];
  else state.dialogue = [pick(dialogueSets.hurt)];
  state.hurtCount = 0;
  state.spawnClock = 0;
  sound(score ? 'dodge' : 'select');
}

function endGame(which) {
  if (state.phase === 'ending') return;
  state.phase = 'ending'; state.outcome = which;
  const screen = endingScreen;
  screen.className = `screen final-${which}`;
  screen.classList.add('hidden');
  const endings = {
    true: {
      kind: 'FINAL VERDADERO · UN LUGAR PARA DOS', title: 'La luz que compartimos',
      text: 'No le pediste que dejara de ser la oscuridad. Solo te sentaste a su lado. Por primera vez, el niño no tuvo que inventar un juego para que alguien se quedara. Al otro lado del horizonte, el mundo empezó a amanecer.',
      quote: '¿Mañana también vienes a jugar?'
    },
    mercy: {
      kind: 'FINAL DE PIEDAD · UN ADIÓS SUAVE', title: 'Cuando cierre los ojos',
      text: 'Le ofreciste una despedida sin convertirlo en un enemigo. El niño se hizo pequeño entre tus manos, como una noche que por fin puede descansar. Unas pocas estrellas quedaron para iluminar el camino de vuelta.',
      quote: 'No tengo sueño. Bueno... un poquito.'
    },
    dark: {
      kind: 'FINAL OSCURO · SIN GANADOR', title: 'El silencio más hondo',
      text: 'La última sombra cayó. No hubo rugido ni risa; solo un niño sorprendido, que no alcanzó a entender por qué el juego había terminado. La noche se abrió sobre el mundo, vacía y sin nadie que la nombrara.',
      quote: '¿Ya gané?'
    },
    consumed: {
      kind: 'FINAL PERDIDO · OTRA NOCHE', title: 'Un sueño bajo las estrellas',
      text: 'La luz de tu corazón se apagó por un instante. El niño se quedó muy quieto, sin saber cómo arreglarlo. La noche siguió siendo noche, pero una pequeña mano sostuvo la tuya hasta que el cielo volvió a brillar.',
      quote: 'Despierta. No sé jugar solo.'
    },
  }[which];
  document.querySelector('#ending-kind').textContent = endings.kind;
  document.querySelector('#ending-title').textContent = endings.title;
  document.querySelector('#ending-text').textContent = endings.text;
  document.querySelector('#ending-quote').textContent = endings.quote;
  saveEnding(which);
  screen.classList.remove('hidden');
}

function addBurst(x, y, color, count = 10) {
  for (let i = 0; i < count; i++) {
    const a = rand(0, TAU), speed = rand(25, 115);
    state.particles.push({ x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, life: rand(.35, .9), maxLife: .9, r: rand(1.3, 3.2), color });
  }
}

function roundedRect(x, y, w, h, r, fill, stroke, line = 1) {
  ctx.beginPath(); ctx.roundRect(x, y, w, h, r);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = line; ctx.stroke(); }
}
function text(str, x, y, size, color = '#fff', font = 'VT323', align = 'left') {
  ctx.font = `${size}px '${font}', monospace`; ctx.fillStyle = color; ctx.textAlign = align;
  ctx.textBaseline = 'middle'; ctx.fillText(str, x, y);
}
function drawBackground() {
  const sky = ctx.createLinearGradient(0, 0, 0, 475);
  sky.addColorStop(0, '#101e4c'); sky.addColorStop(.52, '#28619a'); sky.addColorStop(1, '#a18cdd');
  ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(640, 425, 5, 640, 425, 520);
  glow.addColorStop(0, 'rgba(255,208,255,.52)'); glow.addColorStop(.35, 'rgba(215,151,255,.24)'); glow.addColorStop(1, 'rgba(136,101,227,0)');
  ctx.fillStyle = glow; ctx.fillRect(0, 190, W, 400);
  // soft cloud banks
  for (let row = 0; row < 3; row++) {
    const offset = (elapsed * (7 + row * 4) + row * 210) % 450;
    for (let i = -1; i < 5; i++) {
      const x = i * 360 + offset - 160, y = 110 + row * 88 + Math.sin(i * 5 + row) * 25;
      const cloud = ctx.createRadialGradient(x, y, 4, x, y, 170);
      cloud.addColorStop(0, `rgba(186,208,255,${.11 - row * .02})`); cloud.addColorStop(1, 'rgba(163,195,255,0)');
      ctx.fillStyle = cloud; ctx.beginPath(); ctx.ellipse(x, y, 190, 44 + row * 7, 0, 0, TAU); ctx.fill();
    }
  }
  for (const s of stars) {
    const alpha = .34 + .55 * (.5 + .5 * Math.sin(elapsed * s.speed + s.phase));
    ctx.globalAlpha = alpha; ctx.fillStyle = '#f5f2ff'; ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, TAU); ctx.fill();
  }
  ctx.globalAlpha = 1;
  // bright violet horizon and distant hills
  ctx.fillStyle = 'rgba(72,52,124,.35)';
  ctx.beginPath(); ctx.moveTo(0, 449); ctx.quadraticCurveTo(180, 408, 355, 448); ctx.quadraticCurveTo(550, 476, 760, 432); ctx.quadraticCurveTo(1025, 397, 1280, 449); ctx.lineTo(1280, 540); ctx.lineTo(0, 540); ctx.fill();
  ctx.save(); ctx.shadowColor = '#efa5ff'; ctx.shadowBlur = 28;
  const horizon = ctx.createLinearGradient(0, 425, 0, 468);
  horizon.addColorStop(0, 'rgba(247,184,255,.08)'); horizon.addColorStop(.55, 'rgba(232,147,255,.88)'); horizon.addColorStop(1, 'rgba(198,130,251,.08)');
  ctx.fillStyle = horizon; ctx.fillRect(0, 437, W, 25); ctx.restore();
  const ground = ctx.createLinearGradient(0, 460, 0, H);
  ground.addColorStop(0, '#7454aa'); ground.addColorStop(.32, '#543a8c'); ground.addColorStop(1, '#241c4d');
  ctx.fillStyle = ground; ctx.fillRect(0, 460, W, H - 460);
  for (const m of motes) {
    ctx.globalAlpha = .25 + .4 * (Math.sin(elapsed + m.phase) * .5 + .5);
    ctx.fillStyle = '#efddff'; ctx.beginPath(); ctx.arc(m.x, m.y, m.r, 0, TAU); ctx.fill();
  }
  ctx.globalAlpha = 1;
  const vignette = ctx.createRadialGradient(640, 350, 240, 640, 350, 780);
  vignette.addColorStop(0, 'rgba(4,4,22,0)'); vignette.addColorStop(1, 'rgba(5,4,20,.36)');
  ctx.fillStyle = vignette; ctx.fillRect(0, 0, W, H);
}

function drawChild(x, y, scale = 1, expression = 'normal') {
  const talking = state && state.phase === 'dialogue' && state.dialogue[state.dialogueIndex]?.[0] === 'hablando';
  ctx.save(); ctx.translate(x, y + Math.sin(elapsed * 2.2) * 4); ctx.scale(scale, scale);
  const tilt = expression === 'curioso' ? -.13 : expression === 'confundido' ? .12 : expression === 'triste' || expression === 'dolido' ? .04 : 0;
  ctx.rotate(tilt);
  // small shadow
  ctx.fillStyle = 'rgba(24,12,52,.35)'; ctx.beginPath(); ctx.ellipse(0, 99, 55, 11, 0, 0, TAU); ctx.fill();
  // legs and shoes
  ctx.fillStyle = '#171521'; ctx.beginPath(); ctx.roundRect(-29, 49, 23, 40, 8); ctx.roundRect(7, 49, 23, 40, 8); ctx.fill();
  ctx.fillStyle = '#090a12'; ctx.beginPath(); ctx.ellipse(-18, 89, 19, 9, -.06, 0, TAU); ctx.ellipse(20, 89, 19, 9, .06, 0, TAU); ctx.fill();
  ctx.fillStyle = '#f4efff'; ctx.fillRect(-34, 86, 11, 3); ctx.fillRect(13, 86, 11, 3);
  // cape behind body
  ctx.fillStyle = '#181722'; ctx.beginPath(); ctx.moveTo(-37, -25); ctx.quadraticCurveTo(0, -5, 40, -26); ctx.lineTo(48, 39); ctx.quadraticCurveTo(0, 58, -45, 37); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#dad3e8'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(-37, -20); ctx.quadraticCurveTo(0, -1, 40, -21); ctx.stroke();
  // sleeves and tunic
  ctx.fillStyle = '#12121c'; ctx.beginPath(); ctx.moveTo(-31, -15); ctx.quadraticCurveTo(-52, 4, -43, 41); ctx.lineTo(-27, 38); ctx.lineTo(-21, 12); ctx.lineTo(21, 12); ctx.lineTo(29, 39); ctx.lineTo(44, 37); ctx.quadraticCurveTo(51, 2, 30, -15); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#252431'; ctx.beginPath(); ctx.moveTo(-29, 35); ctx.quadraticCurveTo(0, 43, 29, 35); ctx.lineTo(27, 58); ctx.quadraticCurveTo(0, 66, -28, 57); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#faf7ff'; ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(8, -1); ctx.lineTo(0, 7); ctx.lineTo(-8, -1); ctx.closePath(); ctx.fill();
  // head and ears
  ctx.fillStyle = '#f0d7d2'; ctx.beginPath(); ctx.ellipse(0, -46, 34, 39, 0, 0, TAU); ctx.fill();
  ctx.beginPath(); ctx.ellipse(-32, -44, 6, 9, 0, 0, TAU); ctx.ellipse(32, -44, 6, 9, 0, 0, TAU); ctx.fill();
  // fluffy black hair silhouette
  ctx.fillStyle = '#111119'; ctx.beginPath(); ctx.moveTo(-35, -44); ctx.quadraticCurveTo(-44, -78, -21, -83); ctx.quadraticCurveTo(-8, -104, 7, -87); ctx.quadraticCurveTo(26, -98, 36, -72); ctx.quadraticCurveTo(45, -58, 34, -35); ctx.lineTo(24, -45); ctx.lineTo(20, -29); ctx.lineTo(8, -42); ctx.lineTo(-2, -27); ctx.lineTo(-11, -43); ctx.lineTo(-24, -33); ctx.lineTo(-25, -49); ctx.closePath(); ctx.fill();
  // expression face
  const closed = expression === 'blink' || expression === 'farewell';
  const angry = expression === 'angry' || expression === 'enfadado' || expression === 'molesto';
  const sad = ['sad', 'triste', 'dolido', 'asustado'].includes(expression);
  ctx.strokeStyle = '#342a36'; ctx.lineWidth = 2.4; ctx.lineCap = 'round';
  for (const ex of [-12, 12]) {
    if (angry) { ctx.beginPath(); ctx.moveTo(ex - 5, -58); ctx.lineTo(ex + 5, -55); ctx.stroke(); }
    if (closed) { ctx.beginPath(); ctx.moveTo(ex - 4, -48); ctx.quadraticCurveTo(ex, -44, ex + 4, -48); ctx.stroke(); }
    else {
      ctx.fillStyle = '#737a86'; ctx.beginPath(); ctx.ellipse(ex, -50, 5.2, expression === 'sorprendido' ? 8 : 6.7, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#25242c'; ctx.beginPath(); ctx.ellipse(ex, -49, 2.5, 4.3, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(ex - 1.5, -52, 1.5, 0, TAU); ctx.fill();
      if (sad) { ctx.strokeStyle = '#4d3448'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(ex - 5, -60); ctx.lineTo(ex + 4, -62); ctx.stroke(); }
    }
  }
  ctx.fillStyle = '#b78c91'; ctx.beginPath(); ctx.arc(0, -39, 1.5, 0, TAU); ctx.fill();
  ctx.strokeStyle = '#654a57'; ctx.lineWidth = 1.7; ctx.beginPath();
  if (expression === 'feliz') ctx.arc(0, -34, 5, .15, Math.PI - .15);
  else if (sad || expression === 'dolido') ctx.arc(0, -30, 4, Math.PI + .25, TAU - .25);
  else if (expression === 'hablando' || (talking && Math.sin(elapsed * 18) > .3) || expression === 'sorprendido') { ctx.fillStyle = '#7b4858'; ctx.beginPath(); ctx.ellipse(0, -34, 2.7, 3.6, 0, 0, TAU); ctx.fill(); }
  else ctx.moveTo(-3, -34), ctx.lineTo(3, -34);
  ctx.stroke();
  ctx.restore();
}

function drawBar(x, y, w, h, value, max, color, label) {
  text(label, x, y - 10, 17, '#e8ddff');
  roundedRect(x, y, w, h, h / 2, 'rgba(11,10,26,.76)', 'rgba(228,211,255,.55)', 1);
  const fill = Math.max(0, (w - 4) * value / max);
  if (fill > 0) roundedRect(x + 2, y + 2, fill, h - 4, (h - 4) / 2, color);
}
function wrapText(content, x, y, maxWidth, lineHeight, color = '#fff') {
  ctx.font = "27px 'VT323', monospace"; ctx.fillStyle = color; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  const words = content.split(' '); let line = '', lineY = y;
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) { ctx.fillText(line, x, lineY); line = word; lineY += lineHeight; }
    else line = test;
  }
  if (line) ctx.fillText(line, x, lineY);
}
function drawHud() {
  roundedRect(28, 22, 1224, 66, 15, 'rgba(8,9,29,.46)', 'rgba(221,205,255,.25)');
  text('LUZ DE LO PROFUNDO', 52, 49, 18, '#e4d8ff', 'Press Start');
  text('NIÑO DE LA OSCURIDAD', 1225, 49, 16, '#ece4ff', 'Press Start', 'right');
  drawBar(54, 654, 220, 12, state.hp, state.maxHp, '#ffb2d8', `LUZ ${state.hp} / ${state.maxHp} PS`);
  drawBar(1006, 654, 220, 12, state.bossHp, state.maxBossHp, '#d6c3ff', `OSCURIDAD ${state.bossHp} / ${state.maxBossHp}`, 'right');
  text(`VÍNCULO ${'♡'.repeat(Math.min(state.bond, 7))}${'·'.repeat(7 - Math.min(state.bond, 7))}`, 640, 674, 17, '#ffe8bd', 'VT323', 'center');
}
function drawArena() {
  const a = state.arena;
  roundedRect(a.x - 4, a.y - 4, a.w + 8, a.h + 8, 8, 'rgba(13,10,35,.28)', 'rgba(245,226,255,.92)', 3);
  ctx.save(); ctx.beginPath(); ctx.rect(a.x, a.y, a.w, a.h); ctx.clip();
  ctx.fillStyle = 'rgba(16,12,43,.76)'; ctx.fillRect(a.x, a.y, a.w, a.h);
  const floor = ctx.createLinearGradient(0, a.y, 0, a.y + a.h);
  floor.addColorStop(0, 'rgba(87,67,133,.18)'); floor.addColorStop(1, 'rgba(162,122,216,.2)');
  ctx.fillStyle = floor; ctx.fillRect(a.x, a.y, a.w, a.h);
  ctx.strokeStyle = 'rgba(219,195,255,.13)'; ctx.lineWidth = 1;
  for (let i = 1; i < 5; i++) { ctx.beginPath(); ctx.moveTo(a.x + i * a.w / 5, a.y); ctx.lineTo(a.x + i * a.w / 5, a.y + a.h); ctx.stroke(); }
  for (let i = 1; i < 3; i++) { ctx.beginPath(); ctx.moveTo(a.x, a.y + i * a.h / 3); ctx.lineTo(a.x + a.w, a.y + i * a.h / 3); ctx.stroke(); }
  for (const b of state.bullets) {
    ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.angle + elapsed * .5);
    ctx.shadowColor = b.color; ctx.shadowBlur = 13; ctx.fillStyle = b.color;
    if (b.type === 'orb') { ctx.beginPath(); ctx.arc(0, 0, b.r, 0, TAU); ctx.fill(); ctx.globalAlpha = .4; ctx.beginPath(); ctx.arc(0, 0, b.r * 1.8, 0, TAU); ctx.fill(); }
    else if (b.type === 'shard') { ctx.beginPath(); ctx.moveTo(0, -b.r * 1.7); ctx.lineTo(b.r, 0); ctx.lineTo(0, b.r * 1.7); ctx.lineTo(-b.r, 0); ctx.closePath(); ctx.fill(); }
    else { ctx.beginPath(); ctx.moveTo(0, -b.r * 1.5); ctx.lineTo(b.r * .6, 0); ctx.lineTo(0, b.r * 1.5); ctx.lineTo(-b.r * .6, 0); ctx.closePath(); ctx.fill(); }
    ctx.restore();
  }
  const soul = state.soul;
  if (soul.invuln <= 0 || Math.floor(elapsed * 16) % 2 === 0) {
    ctx.save(); ctx.translate(soul.x, soul.y); ctx.rotate(Math.PI / 4);
    ctx.shadowColor = '#ff7eb8'; ctx.shadowBlur = 16; ctx.fillStyle = '#ff5e9d';
    ctx.fillRect(-7, -7, 14, 14); ctx.fillStyle = '#fff3fa'; ctx.fillRect(-3, -3, 6, 6); ctx.restore();
  }
  ctx.restore();
  roundedRect(487, 552, 306, 30, 8, 'rgba(10,9,27,.56)', 'rgba(219,195,255,.27)');
  text(`${state.patternName}  ·  ${Math.max(0, state.timer).toFixed(1)} s`, 640, 567, 20, '#eee3ff', 'VT323', 'center');
}
function drawDialogue() {
  const line = state.dialogue[state.dialogueIndex];
  roundedRect(170, 447, 940, 148, 14, 'rgba(9,8,27,.82)', 'rgba(237,221,255,.88)', 2);
  ctx.save(); ctx.shadowColor = '#d7b6ff'; ctx.shadowBlur = 14; ctx.strokeStyle = 'rgba(193,153,255,.42)';
  ctx.strokeRect(181, 458, 918, 126); ctx.restore();
  text('NIÑO', 202, 472, 15, '#d6c3ff', 'Press Start');
  if (line) wrapText(line[1], 204, 494, 850, 32, '#fffaff');
  text('Z / ENTER  ·  CONTINUAR  ▾', 1069, 574, 16, '#c7b5e5', 'VT323', 'right');
}
function drawMenu() {
  const y = 486, w = 274, gap = 18, start = 65;
  for (let i = 0; i < 4; i++) {
    const x = start + i * (w + gap), selected = state.action === i;
    roundedRect(x, y, w, 94, 12, selected ? 'rgba(87,57,139,.86)' : 'rgba(15,12,35,.78)', selected ? '#f6dca5' : 'rgba(226,210,255,.62)', selected ? 3 : 1.5);
    text(actionIcons[i], x + 34, y + 34, 28, selected ? '#ffe4a8' : '#dbc8ff', 'VT323', 'center');
    text(actionLabels[i], x + 59, y + 35, 18, selected ? '#fff1cc' : '#eee5ff', 'Press Start');
    text(['Un golpe preciso', 'Conócelo mejor', 'Recupera fuerzas', 'Elegir su destino'][i], x + w / 2, y + 69, 19, '#c6b8dc', 'VT323', 'center');
  }
  if (state.phase === 'submenu') {
    const options = getSubmenu(), x = 340, y0 = 312, w = 600;
    roundedRect(x - 16, y0 - 20, w + 32, options.length * 52 + 39, 13, 'rgba(13,10,34,.96)', 'rgba(223,204,255,.78)', 2);
    text(state.action === 1 ? '¿QUÉ HARÁS?' : state.action === 2 ? 'OBJETOS' : 'PIEDAD', 640, y0 - 2, 17, '#ddc9ff', 'Press Start', 'center');
    options.forEach((item, i) => {
      const yy = y0 + 28 + i * 52, selected = state.subIndex === i;
      text(selected ? '›' : ' ', x + 10, yy + 2, 26, '#ffe3a3');
      text(item.label, x + 38, yy + 2, 20, item.disabled ? '#786e89' : selected ? '#fff0c8' : '#f3edff', 'Press Start');
      text(item.hint, x + w - 12, yy + 2, 19, item.disabled ? '#7b718a' : '#cbbde1', 'VT323', 'right');
    });
    text('Z / ENTER ELEGIR     X VOLVER', 640, y0 + options.length * 52 + 38, 17, '#b9a9d1', 'VT323', 'center');
  }
}
function drawAttack() {
  roundedRect(260, 408, 760, 104, 13, 'rgba(12,9,33,.93)', 'rgba(235,216,255,.86)', 2);
  text('GOLPE DE LUZ', 640, 429, 17, '#f3e8ff', 'Press Start', 'center');
  const x = 330, y = 461, w = 620, h = 16;
  roundedRect(x, y, w, h, 8, '#31234e', '#e4d7f6');
  roundedRect(x + w * .38, y + 2, w * .24, h - 4, 5, 'rgba(255,215,145,.88)');
  const cursor = (Math.sin((state.attack.time - .2) * 2.15) + 1) / 2;
  ctx.fillStyle = '#fff'; ctx.shadowColor = '#fff'; ctx.shadowBlur = 12;
  ctx.beginPath(); ctx.arc(x + 8 + cursor * (w - 16), y + h / 2, 8, 0, TAU); ctx.fill(); ctx.shadowBlur = 0;
  text(state.attack.phase === 'result' ? `LUZ: ${state.attack.score} DAÑO` : 'Z / ENTER o CLIC EN EL MOMENTO DORADO', 640, 493, 19, '#fff0cf', 'VT323', 'center');
}
function drawParticles() {
  for (const p of state.particles) {
    ctx.globalAlpha = clamp(p.life / p.maxLife, 0, 1); ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.fill();
  }
  ctx.globalAlpha = 1;
}
function canvasPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return { x: (event.clientX - rect.left) * W / rect.width, y: (event.clientY - rect.top) * H / rect.height };
}
function handleCanvasClick() {
  if (!titleScreen.classList.contains('hidden') || !endingScreen.classList.contains('hidden')) return;
  if (state.pause) { state.pause = false; return; }
  if (state.phase === 'menu' && pointer.y >= 470 && pointer.y <= 600) {
    const index = Math.floor((pointer.x - 65) / 292);
    if (index >= 0 && index < 4) {
      state.action = index;
      confirm();
      return;
    }
  }
  if (state.phase === 'submenu') {
    const options = getSubmenu();
    const index = Math.floor((pointer.y - 340) / 52);
    if (pointer.x >= 340 && pointer.x <= 940 && index >= 0 && index < options.length) {
      state.subIndex = index;
      confirm();
      return;
    }
  }
  confirm();
}

window.addEventListener('keydown', event => {
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  const controlKeys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' ', 'Enter', 'Escape', 'z', 'x', 'w', 'a', 's', 'd'];
  if (controlKeys.includes(key)) event.preventDefault();
  if (key === 'Escape') {
    if (titleScreen.classList.contains('hidden') && endingScreen.classList.contains('hidden')) state.pause = !state.pause;
    return;
  }
  if (!titleScreen.classList.contains('hidden')) {
    if (key === 'Enter' || key === 'z') beginGame();
    return;
  }
  if (!endingScreen.classList.contains('hidden')) return;
  if (['ArrowLeft', 'a', 'ArrowUp', 'w'].includes(key)) moveMenu(-1);
  else if (['ArrowRight', 'd', 'ArrowDown', 's'].includes(key)) moveMenu(1);
  else if (key === 'x') cancel();
  else if (key === 'Enter' || key === 'z' || key === ' ') {
    if (!event.repeat) confirm();
  }
  if (state.phase === 'dodge' && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'a', 'd', 'w', 's'].includes(key)) keys.add(key);
});
window.addEventListener('keyup', event => {
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  keys.delete(key);
});
window.addEventListener('blur', () => { keys.clear(); pointer.down = false; });
canvas.addEventListener('pointermove', event => {
  Object.assign(pointer, canvasPoint(event), { active: true });
});
canvas.addEventListener('pointerdown', event => {
  Object.assign(pointer, canvasPoint(event), { down: true, active: true });
  canvas.setPointerCapture?.(event.pointerId);
});
canvas.addEventListener('pointerup', event => {
  Object.assign(pointer, canvasPoint(event), { down: false, active: true });
  if (event.pointerType === 'mouse' || event.pointerType === 'pen') handleCanvasClick();
});
canvas.addEventListener('pointercancel', () => { pointer.down = false; });

function render() {
  ctx.save();
  if (state.screenShake > 0) ctx.translate(rand(-state.screenShake, state.screenShake), rand(-state.screenShake, state.screenShake));
  drawBackground();
  drawChild(640, 285, state.phase === 'dodge' ? .8 : 1, state.bossExpr);
  drawHud();
  if (state.phase === 'dodge') drawArena();
  else if (state.phase === 'dialogue') drawDialogue();
  else if (state.phase === 'menu' || state.phase === 'submenu') drawMenu();
  else if (state.phase === 'attack') drawAttack();
  if (state.messageTimer > 0) {
    roundedRect(330, 420, 620, 48, 10, 'rgba(13,10,34,.92)', 'rgba(237,221,255,.7)');
    text(state.message, 640, 444, 22, '#fff0c9', 'VT323', 'center');
  }
  drawParticles(); ctx.restore();
  if (state.pause) {
    ctx.fillStyle = 'rgba(6,5,20,.78)'; ctx.fillRect(0, 0, W, H);
    roundedRect(420, 275, 440, 160, 16, 'rgba(23,16,50,.98)', '#e3d1ff', 2);
    text('PAUSA', 640, 326, 28, '#fff0ca', 'Press Start', 'center');
    text('ESC para continuar', 640, 378, 23, '#ddd0f1', 'VT323', 'center');
  }
}

boot();
