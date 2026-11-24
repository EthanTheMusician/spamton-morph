// =====================================================================
//  THE SECRET
//  1. After the title shows up, stay completely still (no mouse, keys,
//     scrolling or touching) for IDLE_SECONDS. "KEYGEN" in the message
//     box turns green.
//  2. Click it to get a green key (top-right corner). The key only lasts
//     for this visit: every visit you have to earn it again.
//  3. Once the title shows, a very faint shell is hidden around the page.
//     Click it while holding the key to unlock two secret targets:
//     NEO and Shell (saved for good).
// =====================================================================
(() => {
  const IDLE_SECONDS = 20;
  const KEY_SAVE = 'morphKey';
  const $ = id => document.getElementById(id);
  if (isUnlocked('shell')) { $('keygen').remove(); return; }   // already found: nothing left to do

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
  // (Older versions saved the key. It isn't saved anymore, so clear that out.)
  try { localStorage.removeItem(KEY_SAVE); } catch (e) {}
  function showKey() {
    if (document.querySelector('.key-icon')) return;
    const img = document.createElement('img');
    img.className = 'key-icon'; img.alt = 'Key'; img.src = keyImageURL();
    document.body.appendChild(img);
  }

  // ---------- 1 + 2: stay still, KEYGEN turns green, click it ----------
  const keygen = $('keygen');
  let lastActivity = performance.now();
  ['pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll']
    .forEach(ev => window.addEventListener(ev, () => { lastActivity = performance.now(); }, { passive: true, capture: true }));

  setInterval(() => {
    const revealed = $('reveal').classList.contains('show');
    if (revealed && !shell.classList.contains('on')) { shell.classList.add('on'); placeShell(); }
    if (!revealed || hasKey || keygen.classList.contains('ready')) return;
    if (performance.now() - lastActivity >= IDLE_SECONDS * 1000) {
      keygen.classList.add('ready');   // stays green, so moving to click it is fine
      keygen.disabled = false;
    }
  }, 250);

  keygen.onclick = () => {
    if (!keygen.classList.contains('ready')) return;
    hasKey = true;
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

  // Clicking the shell while holding the key unlocks the secret targets.
  shell.onclick = () => {
    if (!hasKey) {
      shell.classList.remove('nope'); void shell.offsetWidth; shell.classList.add('nope');
      return;
    }
    hasKey = false;
    document.querySelector('.key-icon')?.remove();
    unlockTargets(['puppet', 'shell']);   // in app.js
    setTimeout(() => { shell.remove(); keygen.remove(); }, 1500);   // the secret is done
  };
})();
