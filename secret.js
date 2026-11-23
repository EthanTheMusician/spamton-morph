// =====================================================================
//  THE SECRET
//  1. After the title shows up, stay completely still (no mouse, keys,
//     scrolling or touching) for IDLE_SECONDS. "KEYGEN" in the message
//     box turns green.
//  2. Click it to get a green key (shown in the top-right corner, saved).
//  3. A very faint shell is hidden somewhere on the page. Click it while
//     holding the key: the screen fades to black and the boss fight starts.
//  4. Win -> "YOU WON!" -> press R to go back to the normal page.
//     Lose -> press R to try again.
// =====================================================================
(() => {
  const IDLE_SECONDS = 20;
  const KEY_SAVE = 'morphKey';
  const $ = id => document.getElementById(id);

  // ---------- A little pixel key (drawn here, then colored green) ----------
  const KEY_ART = [
    '.####...........',
    '#....#..........',
    '#....##########.',
    '#....#######.###',
    '.####......#..#.',
  ];
  function keyImageURL() {
    const c = document.createElement('canvas');
    c.width = 16; c.height = 8;
    const x = c.getContext('2d');
    x.fillStyle = '#3dff4e';
    KEY_ART.forEach((row, y) => [...row].forEach((ch, i) => { if (ch === '#') x.fillRect(i, y + 1, 1, 1); }));
    return c.toDataURL();
  }

  let hasKey = false;
  try { hasKey = localStorage.getItem(KEY_SAVE) === '1'; } catch (e) {}
  function showKey() {
    if (document.querySelector('.key-icon')) return;
    const img = document.createElement('img');
    img.className = 'key-icon'; img.alt = 'Key'; img.src = keyImageURL();
    document.body.appendChild(img);
  }
  if (hasKey) showKey();

  // ---------- 1 + 2: stay still, KEYGEN turns green, click it ----------
  const keygen = $('keygen');
  let lastActivity = performance.now();
  ['pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll']
    .forEach(ev => window.addEventListener(ev, () => { lastActivity = performance.now(); }, { passive: true, capture: true }));
  if (hasKey) keygen.classList.add('used');

  setInterval(() => {
    const revealed = $('reveal').classList.contains('show');
    if (!revealed || hasKey || keygen.classList.contains('ready')) return;
    if (performance.now() - lastActivity >= IDLE_SECONDS * 1000) {
      keygen.classList.add('ready');   // stays green, so moving to click it is fine
      keygen.disabled = false;
    }
  }, 250);

  keygen.onclick = () => {
    if (!keygen.classList.contains('ready')) return;
    hasKey = true;
    try { localStorage.setItem(KEY_SAVE, '1'); } catch (e) {}
    keygen.classList.remove('ready'); keygen.classList.add('used'); keygen.disabled = true;
    showKey();
  };

  // ---------- 3: the faint shell, somewhere new every visit ----------
  const shell = document.createElement('img');
  shell.className = 'shell'; shell.alt = ''; shell.src = 'assets/shell.png?v=1';
  shell.draggable = false;
  // It only ever sits in the empty black space AROUND the app (never on the
  // canvas or the buttons). The random choices are made once per visit; the
  // exact spot is worked out again whenever the page changes size (like when
  // the title appears after the first morph and pushes everything down).
  const roll = { side: Math.random() < 0.5 ? 'left' : 'right', fx: Math.random(), fy: Math.random() };
  const SW = 96, SH = 150, PAD = 10;
  function placeShell() {
    const appEl = document.querySelector('.app');
    const app = appEl.getBoundingClientRect();
    const sx = window.scrollX, sy = window.scrollY;
    const W = document.documentElement.clientWidth;
    const leftRoom = app.left - PAD * 2, rightRoom = W - app.right - PAD * 2;
    let left, top;
    if (leftRoom >= SW || rightRoom >= SW) {
      // Wide screens: the black space beside the app, anywhere from top to bottom.
      document.body.style.paddingBottom = '';
      let side = roll.side;
      if (side === 'left' && leftRoom < SW) side = 'right';
      if (side === 'right' && rightRoom < SW) side = 'left';
      const [a, b] = side === 'left' ? [PAD, app.left - SW - PAD] : [app.right + PAD, W - SW - PAD];
      left = a + roll.fx * Math.max(0, b - a);
      const pageH = Math.max(app.bottom + sy + 16, window.innerHeight);
      top = 50 + roll.fy * Math.max(0, pageH - SH - 60);    // 50: stay clear of the key icon
    } else {
      // Narrow screens (phones): the black space below the app.
      document.body.style.paddingBottom = (SH + 40) + 'px';
      left = PAD + roll.fx * Math.max(0, W - SW - PAD * 2);
      top = app.bottom + sy + 24;
    }
    shell.style.left = Math.round(left + sx) + 'px';
    shell.style.top = Math.round(top) + 'px';
  }
  document.body.appendChild(shell);
  placeShell();
  window.addEventListener('load', placeShell);
  window.addEventListener('resize', placeShell);
  if (window.ResizeObserver) new ResizeObserver(placeShell).observe(document.querySelector('.app'));

  shell.onclick = () => {
    if (!hasKey) {
      shell.classList.remove('nope'); void shell.offsetWidth; shell.classList.add('nope');
      return;
    }
    const black = $('blackout');
    black.classList.add('on');
    setTimeout(() => { startFight(); }, 2200);   // fade to black, then cut straight in
  };

  // =====================================================================
  //  4: THE BOSS FIGHT (an original bullet-dodging fight)
  //  Move: arrow keys / WASD (or drag on a touch screen)
  //  Shoot: Z, X, Space or Enter (hold it). Touch screens shoot automatically.
  // =====================================================================
  const fightEl = $('fight');
  const cv = $('fightCanvas');
  const g = cv.getContext('2d');
  const FW = cv.width, FH = cv.height;
  const BOX = { x: 170, y: 400, w: 300, h: 230 };       // the dodge box
  const BOSS_MAX = 140, PLAYER_MAX = 20;
  // The boss: an original pixel-art marionette, drawn square by square.
  // K = outline, W = white, P = pink, Y = yellow eyes
  const PUPPET = [
    '.......KKKKKK.......',
    '.....KKWWWWWWKK.....',
    '....KWWWWWWWWWWK....',
    '...KWWWWWWWWWWWWK...',
    '...KWWYYWWWWYYWWK...',
    '...KWWYKWWWWYKWWK...',
    '...KWWWWWWWWWWWWK...',
    '...KWWKWKWKWKWWWK...',
    '....KWWKWKWKWWWK....',
    '.....KKWWWWWWKK.....',
    '.......KKKKKK.......',
    '........KPPK........',
    '.....KKPPPPPPKK.....',
    '....KPPPPPPPPPPK....',
    '...KPPKPPWWPPKPPK...',
    '..KPPK.KPPPPK.KPPK..',
    '..KWK..KPWWPK..KWK..',
    '..KWK..KPPPPK..KWK..',
    '...K...KPWWPK...K...',
    '.......KPPPPK.......',
    '.......KKKKKK.......',
    '........K..K........',
    '.......KWK.KWK......',
    '.......KWK.KWK......',
    '.......KK...KK......',
  ];
  const PUPPET_COLORS = { K: '#555555', W: '#ffffff', P: '#ffaec9', Y: '#fff201' };
  const PX = 9;   // size of one puppet pixel on screen
  function drawPuppet(cx, top, flash, t) {
    const w = PUPPET[0].length * PX;
    const left = cx - w / 2;
    // strings from the top of the screen to the head and both hands
    g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 1;
    [[10, 0], [3, 17], [16, 17]].forEach(([c, r]) => {
      g.beginPath(); g.moveTo(left + (c + .5) * PX + Math.sin(t * 2 + c) * 4, 0);
      g.lineTo(left + (c + .5) * PX, top + r * PX); g.stroke();
    });
    PUPPET.forEach((row, r) => {
      // the arms and legs dangle a little
      const sway = r >= 14 ? Math.round(Math.sin(t * 3 + r * .3) * 2) : 0;
      [...row].forEach((ch, c) => {
        if (ch === '.') return;
        g.fillStyle = flash ? '#ffffff' : PUPPET_COLORS[ch];
        g.fillRect(left + c * PX + sway, top + r * PX, PX, PX);
      });
    });
  }

  const keys = new Set();
  let F = null;          // the current fight (null when not fighting)
  let raf = null;

  function newFight() {
    return {
      t: 0, state: 'intro',                 // intro -> play -> won / lost
      boss: { hp: BOSS_MAX, x: FW / 2, flash: 0, shake: 0 },
      p: { x: BOX.x + BOX.w / 2, y: BOX.y + BOX.h - 40, hp: PLAYER_MAX, inv: 0 },
      shots: [], bullets: [], lasers: [], sparks: [],
      fireCd: 0, attack: 0, attackT: 0, spawnT: 0, spin: 0,
      touch: null,
    };
  }

  function startFight() {
    F = newFight();
    document.body.style.overflow = 'hidden';
    fightEl.classList.add('on');
    $('blackout').classList.remove('on');
    $('blackout').style.transition = 'none';     // cut, don't fade back
    requestAnimationFrame(() => { $('blackout').style.transition = ''; });
    let last = performance.now();
    cancelAnimationFrame(raf);
    const loop = now => {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      if (!F) return;
      update(dt); draw();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
  }

  function endFight() {
    F = null; cancelAnimationFrame(raf);
    fightEl.classList.remove('on');
    document.body.style.overflow = '';
    keys.clear();
  }

  window.addEventListener('keydown', e => {
    if (!F) return;
    e.preventDefault(); e.stopPropagation();   // don't let the paint app see these
    const k = e.key.toLowerCase();
    keys.add(k);
    if (k === 'r' && F.state === 'won') endFight();
    else if (k === 'r' && F.state === 'lost') F = Object.assign(newFight(), { state: 'play' });
  }, true);
  window.addEventListener('keyup', e => { keys.delete(e.key.toLowerCase()); });

  // Touch / mouse drag: the player follows your finger and shoots automatically.
  function fightPoint(e) {
    const r = cv.getBoundingClientRect();
    return { x: (e.clientX - r.left) * FW / r.width, y: (e.clientY - r.top) * FH / r.height };
  }
  cv.addEventListener('pointerdown', e => {
    if (!F) return;
    if (F.state === 'won') { endFight(); return; }
    if (F.state === 'lost') { F = Object.assign(newFight(), { state: 'play' }); return; }
    F.touch = fightPoint(e); cv.setPointerCapture(e.pointerId);
  });
  cv.addEventListener('pointermove', e => { if (F && F.touch) F.touch = fightPoint(e); });
  cv.addEventListener('pointerup', () => { if (F) F.touch = null; });
  cv.addEventListener('pointercancel', () => { if (F) F.touch = null; });

  const held = (...ks) => ks.some(k => keys.has(k));
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function bullet(x, y, vx, vy, r = 6, color = '#ffaec9') {
    F.bullets.push({ x, y, vx, vy, r, color });
  }

  // The boss gets angrier (faster) as its health drops: 1 -> about 1.7
  const rage = () => 1 + 0.7 * (1 - F.boss.hp / BOSS_MAX);

  // Each attack runs for a few seconds, then the next one starts.
  const ATTACKS = [
    // 0: Pink rain
    (dt) => {
      F.spawnT -= dt;
      if (F.spawnT <= 0) {
        F.spawnT = 0.16 / rage();
        bullet(rand(BOX.x + 6, BOX.x + BOX.w - 6), BOX.y - 8, rand(-20, 20), rand(150, 210) * rage(), 6);
      }
    },
    // 1: Walls with a gap, sliding in from the sides
    (dt) => {
      F.spawnT -= dt;
      if (F.spawnT <= 0) {
        F.spawnT = 1.1 / rage();
        const fromLeft = Math.random() < 0.5;
        const gap = rand(BOX.y + 30, BOX.y + BOX.h - 60);
        for (let y = BOX.y + 8; y < BOX.y + BOX.h; y += 18) {
          if (y > gap && y < gap + 56) continue;
          bullet(fromLeft ? BOX.x - 8 : BOX.x + BOX.w + 8, y, (fromLeft ? 1 : -1) * 170 * rage(), 0, 7, '#fff201');
        }
      }
    },
    // 2: Spinning spiral from the top of the box
    (dt) => {
      F.spawnT -= dt;
      F.spin += dt * 2.3;
      if (F.spawnT <= 0) {
        F.spawnT = 0.09 / rage();
        const cx = BOX.x + BOX.w / 2, cy = BOX.y + 20;
        for (let k = 0; k < 2; k++) {
          const a = F.spin + k * Math.PI;
          const s = 120 * rage();
          if (Math.sin(a) > -0.2) bullet(cx, cy, Math.cos(a) * s, Math.abs(Math.sin(a)) * s + 30, 5, '#ffffff');
        }
      }
    },
    // 3: Aimed bursts from the top corners
    (dt) => {
      F.spawnT -= dt;
      if (F.spawnT <= 0) {
        F.spawnT = 0.85 / rage();
        const corners = [[BOX.x + 10, BOX.y - 6], [BOX.x + BOX.w - 10, BOX.y - 6]];
        const [cx, cy] = corners[Math.floor(Math.random() * 2)];
        const base = Math.atan2(F.p.y - cy, F.p.x - cx);
        for (let i = -2; i <= 2; i++) {
          const a = base + i * 0.2, s = 190 * rage();
          bullet(cx, cy, Math.cos(a) * s, Math.sin(a) * s, 6, '#ed1c24');
        }
      }
    },
    // 4: Strings: a faint warning line, then it snaps solid
    (dt) => {
      F.spawnT -= dt;
      if (F.spawnT <= 0) {
        F.spawnT = 0.7 / rage();
        const x = Math.random() < 0.5 ? F.p.x + rand(-30, 30) : rand(BOX.x + 10, BOX.x + BOX.w - 10);
        F.lasers.push({ x: clamp(x, BOX.x + 6, BOX.x + BOX.w - 6), warn: 0.7, on: 0.35 });
      }
    },
  ];
  const ATTACK_TIME = 6.5;

  function hurtPlayer(dmg) {
    if (F.p.inv > 0) return;
    F.p.hp = Math.max(0, F.p.hp - dmg);
    F.p.inv = 1.0;
    if (F.p.hp <= 0) { F.state = 'lost'; F.t = 0; }
  }

  function update(dt) {
    F.t += dt;
    const b = F.boss, p = F.p;
    b.flash = Math.max(0, b.flash - dt);
    b.shake = Math.max(0, b.shake - dt);
    b.x = FW / 2 + Math.sin(F.t * 0.9 * rage()) * 150;   // the boss sways side to side

    if (F.state === 'intro') { if (F.t > 2.2) { F.state = 'play'; F.t = 0; } return; }
    if (F.state !== 'play') { F.sparks.forEach(s => { s.x += s.vx * dt; s.y += s.vy * dt; s.life -= dt; }); return; }

    // --- player movement ---
    const speed = held('shift') ? 110 : 210;
    let mx = 0, my = 0;
    if (held('arrowleft', 'a')) mx -= 1;
    if (held('arrowright', 'd')) mx += 1;
    if (held('arrowup', 'w')) my -= 1;
    if (held('arrowdown', 's')) my += 1;
    if (F.touch) {
      const dx = F.touch.x - p.x, dy = F.touch.y - p.y, d = Math.hypot(dx, dy);
      if (d > 4) { mx = dx / d; my = dy / d; }
    } else if (mx && my) { mx *= Math.SQRT1_2; my *= Math.SQRT1_2; }
    p.x = clamp(p.x + mx * speed * dt, BOX.x + 8, BOX.x + BOX.w - 8);
    p.y = clamp(p.y + my * speed * dt, BOX.y + 8, BOX.y + BOX.h - 8);
    p.inv = Math.max(0, p.inv - dt);

    // --- shooting ---
    F.fireCd -= dt;
    if ((held('z', 'x', ' ', 'enter') || F.touch) && F.fireCd <= 0) {
      F.fireCd = 0.14;
      F.shots.push({ x: p.x, y: p.y - 10 });
    }
    F.shots.forEach(s => { s.y -= 520 * dt; });
    F.shots = F.shots.filter(s => {
      // A shot that reaches the boss's height hits if it's lined up with it.
      if (s.y < 280 && Math.abs(s.x - b.x) < 70) {
        b.hp -= 1; b.flash = 0.08; b.shake = 0.1;
        for (let i = 0; i < 3; i++) F.sparks.push({ x: s.x, y: s.y, vx: rand(-80, 80), vy: rand(-80, 20), life: 0.3 });
        if (b.hp <= 0) win();
        return false;
      }
      return s.y > -10;
    });

    // --- attacks ---
    F.attackT += dt;
    if (F.attackT > ATTACK_TIME) { F.attackT = 0; F.spawnT = 0.6; F.attack = (F.attack + 1) % ATTACKS.length; }
    if (F.attackT > 0.6) ATTACKS[F.attack](dt);     // short breather between attacks

    F.bullets.forEach(o => { o.x += o.vx * dt; o.y += o.vy * dt; });
    F.bullets = F.bullets.filter(o => {
      if (Math.hypot(o.x - p.x, o.y - p.y) < o.r + 5) { hurtPlayer(2); return false; }
      return o.x > BOX.x - 20 && o.x < BOX.x + BOX.w + 20 && o.y > BOX.y - 30 && o.y < BOX.y + BOX.h + 20;
    });
    F.lasers.forEach(l => {
      if (l.warn > 0) l.warn -= dt;
      else { l.on -= dt; if (Math.abs(l.x - p.x) < 10) hurtPlayer(3); }
    });
    F.lasers = F.lasers.filter(l => l.on > 0);
    F.sparks.forEach(s => { s.x += s.vx * dt; s.y += s.vy * dt; s.life -= dt; });
    F.sparks = F.sparks.filter(s => s.life > 0);
  }

  function win() {
    F.state = 'won'; F.t = 0; F.bullets = []; F.lasers = []; F.shots = [];
    for (let i = 0; i < 60; i++) F.sparks.push({ x: F.boss.x, y: 150, vx: rand(-260, 260), vy: rand(-260, 260), life: rand(0.6, 1.6) });
  }

  // ---------- drawing ----------
  function text(str, x, y, size, color, align = 'center') {
    g.font = `${size}px "Press Start 2P", monospace`;
    g.fillStyle = color; g.textAlign = align; g.textBaseline = 'middle';
    g.fillText(str, x, y);
  }
  function bar(x, y, w, h, frac, color, label) {
    g.fillStyle = '#333'; g.fillRect(x, y, w, h);
    g.fillStyle = color; g.fillRect(x, y, w * clamp(frac, 0, 1), h);
    g.strokeStyle = '#fff'; g.lineWidth = 2; g.strokeRect(x, y, w, h);
    text(label, x - 10, y + h / 2, 10, '#fff', 'right');
  }

  function draw() {
    const b = F.boss, p = F.p;
    g.fillStyle = '#000'; g.fillRect(0, 0, FW, FH);

    // faint strings hanging from the top
    g.strokeStyle = 'rgba(80,120,60,.35)'; g.lineWidth = 2;
    for (let i = 0; i < 9; i++) {
      const sx = 40 + i * 70 + Math.sin(F.t + i) * 6;
      g.beginPath(); g.moveTo(sx, 0); g.lineTo(sx + Math.sin(F.t * 0.7 + i) * 12, 330); g.stroke();
    }

    // the boss, fading away when defeated
    if (F.state !== 'won' || F.t < 0.5) {
      const shake = b.shake > 0 ? rand(-4, 4) : 0;
      g.save();
      g.globalAlpha = F.state === 'won' ? Math.max(0, 1 - F.t * 2) : 1;
      drawPuppet(b.x + shake, 60 + Math.sin(F.t * 1.5) * 8, b.flash > 0, F.t);
      g.restore();
    }

    // health bars
    bar(150, 16, 400, 14, b.hp / BOSS_MAX, '#fff201', 'BOSS');
    bar(BOX.x + 40, BOX.y + BOX.h + 26, BOX.w - 40, 14, p.hp / PLAYER_MAX, '#3dff4e', 'HP');

    // the box
    g.strokeStyle = '#fff'; g.lineWidth = 4;
    g.strokeRect(BOX.x - 2, BOX.y - 2, BOX.w + 4, BOX.h + 4);

    // lasers ("strings")
    F.lasers.forEach(l => {
      if (l.warn > 0) { g.fillStyle = 'rgba(61,255,78,.25)'; g.fillRect(l.x - 1, BOX.y, 2, BOX.h); }
      else { g.fillStyle = '#3dff4e'; g.fillRect(l.x - 8, BOX.y, 16, BOX.h); }
    });

    // bullets
    F.bullets.forEach(o => {
      g.fillStyle = o.color; g.beginPath(); g.arc(o.x, o.y, o.r, 0, Math.PI * 2); g.fill();
    });
    // player shots
    g.fillStyle = '#fff201';
    F.shots.forEach(s => g.fillRect(s.x - 2, s.y - 7, 4, 12));
    // sparks
    F.sparks.forEach(s => { g.fillStyle = `rgba(255,242,1,${clamp(s.life * 3, 0, 1)})`; g.fillRect(s.x - 2, s.y - 2, 4, 4); });

    // the player: a little green diamond (blinks while invincible)
    if (F.state === 'play' && !(p.inv > 0 && Math.floor(p.inv * 12) % 2)) {
      g.fillStyle = '#3dff4e';
      g.beginPath(); g.moveTo(p.x, p.y - 8); g.lineTo(p.x + 7, p.y); g.lineTo(p.x, p.y + 8); g.lineTo(p.x - 7, p.y); g.closePath(); g.fill();
    }

    // messages
    if (F.state === 'intro') {
      text('GET READY', FW / 2, BOX.y + BOX.h / 2 - 20, 20, '#fff');
      text('MOVE: ARROWS / WASD', FW / 2, BOX.y + BOX.h / 2 + 20, 10, '#9c9c9c');
      text('SHOOT: HOLD Z OR SPACE', FW / 2, BOX.y + BOX.h / 2 + 42, 10, '#9c9c9c');
    }
    if (F.state === 'won') {
      g.fillStyle = `rgba(0,0,0,${Math.min(0.85, F.t)})`; g.fillRect(0, 0, FW, FH);
      if (F.t > 0.8) {
        text('YOU WON!', FW / 2, FH / 2 - 30, 36, '#fff201');
        if (Math.floor(F.t * 2) % 2 === 0 || F.t < 1.5) text('Press R to Restart', FW / 2, FH / 2 + 30, 14, '#fff');
      }
    }
    if (F.state === 'lost') {
      g.fillStyle = 'rgba(0,0,0,.75)'; g.fillRect(0, 0, FW, FH);
      text('YOU LOST', FW / 2, FH / 2 - 30, 30, '#ed1c24');
      text('Press R to try again', FW / 2, FH / 2 + 30, 14, '#fff');
    }
  }
})();
