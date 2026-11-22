// =====================================================================
//  PICTURE MORPH
//  Takes the pixels of YOUR picture and moves them (without changing
//  their colors) so that together they form the target sprite.
//
//  How the morph works, in plain words:
//   1. Shrink both pictures to the same small grid (e.g. 96 x 126 = ~12k pixels).
//   2. "Assignment": decide which of your pixels goes to which spot in the
//      sprite, so every spot gets a pixel whose color is as close as possible.
//        - First guess: sort both pictures darkest -> brightest, pair in order.
//        - Then improve: pick two spots at random; if swapping their pixels
//          makes the colors match better, swap. Repeat millions of times.
//          (A simple version of "optimal transport".)
//   3. Animate every pixel flying from where it started to where it ends up.
//
//  There is ONE visible canvas (#stage). Your drawing lives on a hidden
//  canvas ("paper") and is copied onto the stage whenever it changes.
//  Shapes are previewed on the stage while you drag, then stamped onto paper.
// =====================================================================

const stage = document.getElementById('stage');
const sctx = stage.getContext('2d');
const frameEl = document.getElementById('frame');
const progressEl = document.getElementById('progress');
const goBtn = document.getElementById('go');
const backBtn = document.getElementById('back');
const clearBtn = document.getElementById('clear');
const uploadBtn = document.getElementById('uploadBtn');
const uploadInput = document.getElementById('upload');
const textBox = document.getElementById('textBox');

const PW = stage.width, PH = stage.height;   // picture size in pixels
const paper = document.createElement('canvas');
paper.width = PW; paper.height = PH;
const pctx = paper.getContext('2d', { willReadFrequently: true });

// ---------- Settings you can play with ----------
const SWAPS_PER_PIXEL = 120;   // more = better match, slower
const SPATIAL_WEIGHT = 0.4;    // >0 makes same-colored pixels prefer short trips
const MAX_DELAY = 0.35;        // how spread out the pixels' start times are
const FILL_TOLERANCE = 60;     // how different a color can be and still get bucket-filled
const MAX_UNDO = 30;

// ---------- App state ----------
// 'draw' -> you can draw on the canvas (even on top of a finished morph)
// 'busy' -> calculating or animating
let mode = 'draw';
let sourceDirty = true;      // picture changed since last calculation?
let hasRevealed = false;     // has the secret title been shown yet?
let touched = false;         // has the user changed the starter picture?
// Saving (see SAVING near the bottom)
const SAVE_KEY = 'morphSave';
let saveTimer = null;
let loading = true;            // don't save while the saved game is being loaded

// Every morph is remembered, so BACK can undo them one at a time.
const morphHistory = [];

function setMode(m) {
  mode = m;
  const busy = m === 'busy';
  goBtn.disabled = busy;
  backBtn.disabled = busy || morphHistory.length === 0;
  clearBtn.disabled = busy;
  uploadBtn.classList.toggle('disabled', busy);
  uploadInput.disabled = busy;
  frameEl.classList.toggle('morphed', busy);
  updateUndoButtons();
}

function showPaper() { sctx.drawImage(paper, 0, 0); }

// =====================================================================
//  PAINT TOOLS
// =====================================================================

// Little line-drawing icons (24x24 SVG paths).
const ICONS = {
  pencil:   '<path d="M4 20l1-5L16 4l4 4L9 19z"/><path d="M14 6l4 4"/>',
  brush:    '<path d="M20 4c-4 2-8 6-10 10l2 2c4-2 8-6 10-10z"/><path d="M9 15c-3 0-4 2-4 5 2 0 5-1 5-4z"/>',
  spray:    '<rect x="5" y="10" width="8" height="11" rx="1"/><path d="M7 10V7h4v3"/><path d="M16 6h.01M19 4h.01M19 8h.01M17 10h.01M21 6h.01" stroke-width="2.6"/>',
  eraser:   '<path d="M3 16l9-9 6 6-6 6H7z"/><path d="M12 19h9"/><path d="M8 11l6 6"/>',
  fill:     '<path d="M4 11l7-7 8 8-7 7z"/><path d="M4 11h15"/><path d="M21 15c0 2 1 3 1 4a1 1 0 01-2 0c0-1 1-2 1-4z"/>',
  picker:   '<path d="M15 3l6 6-3 3-6-6z"/><path d="M13 7l-8 8-1 5 5-1 8-8"/>',
  text:     '<path d="M5 6V4h14v2"/><path d="M12 4v16"/><path d="M9 20h6"/>',
  line:     '<path d="M5 19L19 5"/>',
  rect:     '<rect x="4" y="6" width="16" height="12"/>',
  roundrect:'<rect x="4" y="6" width="16" height="12" rx="4"/>',
  ellipse:  '<ellipse cx="12" cy="12" rx="8" ry="6"/>',
  triangle: '<path d="M12 4l9 16H3z"/>',
  righttri: '<path d="M4 4v16h16z"/>',
  diamond:  '<path d="M12 3l9 9-9 9-9-9z"/>',
  pentagon: '<path d="M12 3l9 6.5-3.4 10.5H6.4L3 9.5z"/>',
  hexagon:  '<path d="M7 4h10l5 8-5 8H7l-5-8z"/>',
  arrow:    '<path d="M3 9h10V5l8 7-8 7v-4H3z"/>',
  star:     '<path d="M12 3l2.7 5.8 6.3.7-4.7 4.3 1.3 6.2L12 17l-5.6 3 1.3-6.2L3 9.5l6.3-.7z"/>',
  heart:    '<path d="M12 20s-8-5-8-11a4 4 0 018-1 4 4 0 018 1c0 6-8 11-8 11z"/>',
  outline:  '<rect x="4" y="5" width="16" height="14"/>',
  filled:   '<rect x="4" y="5" width="16" height="14" fill="currentColor"/>',
  both:     '<rect x="4" y="5" width="16" height="14" fill="currentColor" fill-opacity=".35"/>',
  undo:     '<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 010 10h-3"/>',
  redo:     '<path d="M15 14l5-5-5-5"/><path d="M20 9H9a5 5 0 000 10h3"/>',
  flipH:    '<path d="M12 3v18"/><path d="M9 7l-5 5 5 5z"/><path d="M15 7l5 5-5 5z"/>',
  flipV:    '<path d="M3 12h18"/><path d="M7 9l5-5 5 5z"/><path d="M7 15l5 5 5-5z"/>',
  rotate:   '<path d="M20 12a8 8 0 11-2.3-5.7"/><path d="M20 3v6h-6"/>',
  invert:   '<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 010 16z" fill="currentColor"/>',
};
const svg = p => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
  stroke-width="2" stroke-linejoin="round" stroke-linecap="round">${p}</svg>`;

const TOOLS = [['pencil', 'Pencil'], ['brush', 'Brush'], ['spray', 'Airbrush'], ['eraser', 'Eraser'],
               ['fill', 'Fill bucket'], ['picker', 'Color picker'], ['text', 'Text']];
const SHAPES = [['line', 'Line'], ['rect', 'Rectangle'], ['roundrect', 'Rounded rectangle'],
                ['ellipse', 'Oval'], ['triangle', 'Triangle'], ['righttri', 'Right triangle'],
                ['diamond', 'Diamond'], ['pentagon', 'Pentagon'], ['hexagon', 'Hexagon'],
                ['arrow', 'Arrow'], ['star', 'Star'], ['heart', 'Heart']];
const SHAPE_IDS = SHAPES.map(s => s[0]);
const isShape = id => SHAPE_IDS.includes(id);

let tool = 'brush', prevTool = 'brush';
let fillMode = 'outline';            // outline | filled | both
let color1 = '#000000', color2 = '#ffffff';

function iconButton(id, label, container, onClick) {
  const b = document.createElement('button');
  b.className = 'tool'; b.dataset.id = id;
  b.title = label; b.setAttribute('aria-label', label);
  b.innerHTML = svg(ICONS[id]);
  b.onclick = onClick;
  container.appendChild(b);
  return b;
}

const toolButtons = [];
TOOLS.forEach(([id, label]) => toolButtons.push(iconButton(id, label, document.getElementById('tools'), () => setTool(id))));
SHAPES.forEach(([id, label]) => toolButtons.push(iconButton(id, label, document.getElementById('shapes'), () => setTool(id))));

function setTool(id) {
  commitText();
  if (id === 'picker' && tool !== 'picker') prevTool = tool;
  tool = id;
  toolButtons.forEach(b => b.classList.toggle('on', b.dataset.id === id));
  stage.style.cursor = id === 'text' ? 'text' : id === 'fill' || id === 'picker' ? 'pointer' : 'crosshair';
}

const fillButtons = [['outline', 'Outline shapes'], ['filled', 'Filled shapes'], ['both', 'Outline + fill (color 2)']]
  .map(([id, label]) => iconButton(id, label, document.getElementById('fillmodes'), () => {
    fillMode = id;
    fillButtons.forEach(b => b.classList.toggle('on', b.dataset.id === id));
  }));
fillButtons[0].classList.add('on');

const actions = document.getElementById('actions');
const undoBtn = iconButton('undo', 'Undo (Ctrl+Z)', actions, () => undo());
const redoBtn = iconButton('redo', 'Redo (Ctrl+Y)', actions, () => redo());
iconButton('flipH', 'Flip left-right', actions, () => transformPaper('flipH'));
iconButton('flipV', 'Flip upside down', actions, () => transformPaper('flipV'));
iconButton('rotate', 'Rotate 180°', actions, () => transformPaper('rotate'));
iconButton('invert', 'Invert colors', actions, () => transformPaper('invert'));

// ---------- Size ----------
// One slider controls every tool; each tool scales it its own way.
const brushInput = document.getElementById('brush');
const dotPreview = document.getElementById('dotPreview');
const size = () => +brushInput.value;
const sizes = {
  pencil: () => Math.max(1, Math.round(size() / 6)),
  brush:  () => size(),
  eraser: () => size() * 1.5,
  spray:  () => size() * 1.3,
  shape:  () => Math.max(1, Math.round(size() / 3)),
  text:   () => Math.round(12 + size() * 1.6),
};
function updateDot() {
  const s = Math.max(3, Math.round(size() / 60 * 16));
  dotPreview.style.width = dotPreview.style.height = s + 'px';
}
brushInput.oninput = updateDot; updateDot();

// ---------- Colors ----------
// Left-click a color = color 1. Right-click = color 2 (used by the eraser,
// right-click drawing, and the inside of "outline + fill" shapes).
const COLORS = ['#000000', '#ffffff', '#9c9c9c', '#555555', '#ed1c24', '#ff7f27', '#fff201',
                '#22b14c', '#00a2e8', '#3f48cc', '#a349a4', '#ffaec9', '#8b4513'];
const palette = document.getElementById('palette');
const c1El = document.getElementById('c1'), c2El = document.getElementById('c2');

function updateColorUI() {
  c1El.style.background = color1;
  c2El.style.background = color2;
  pickerInput.value = color1;
}
COLORS.forEach(c => {
  const b = document.createElement('button');
  b.className = 'swatch';
  b.style.background = c;
  b.title = 'Left-click: color 1 · Right-click: color 2';
  b.setAttribute('aria-label', 'Color ' + c);
  b.onclick = () => { color1 = c; updateColorUI(); };
  b.oncontextmenu = e => { e.preventDefault(); color2 = c; updateColorUI(); };
  palette.appendChild(b);
});
// The rainbow square opens the browser's full color picker (wheel + sliders).
const picker = document.createElement('label');
picker.className = 'picker'; picker.title = 'Pick any color';
picker.innerHTML = '<input type="color" aria-label="Pick any color">';
const pickerInput = picker.querySelector('input');
pickerInput.oninput = () => { color1 = pickerInput.value; updateColorUI(); };
palette.appendChild(picker);

document.getElementById('colorPair').onclick = () => {
  [color1, color2] = [color2, color1]; updateColorUI();
};

// ---------- Undo / redo ----------
const undoStack = [], redoStack = [];
function snapshot() {          // call BEFORE changing the picture
  undoStack.push(pctx.getImageData(0, 0, PW, PH));
  if (undoStack.length > MAX_UNDO) undoStack.shift();
  redoStack.length = 0;
  touched = true;
  updateUndoButtons();
}
function changed() { sourceDirty = true; showPaper(); updateUndoButtons(); saveSoon(); }
function undo() {
  commitText();
  if (mode !== 'draw' || !undoStack.length) return;
  redoStack.push(pctx.getImageData(0, 0, PW, PH));
  pctx.putImageData(undoStack.pop(), 0, 0);
  changed();
}
function redo() {
  if (mode !== 'draw' || !redoStack.length) return;
  undoStack.push(pctx.getImageData(0, 0, PW, PH));
  pctx.putImageData(redoStack.pop(), 0, 0);
  changed();
}
function updateUndoButtons() {
  if (!undoBtn) return;
  undoBtn.disabled = mode !== 'draw' || !undoStack.length;
  redoBtn.disabled = mode !== 'draw' || !redoStack.length;
}
document.addEventListener('keydown', e => {
  if (e.target === textBox) return;
  const k = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
  else if ((e.ctrlKey || e.metaKey) && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); redo(); }
});

// ---------- Whole-picture changes ----------
function copyOf(canvas) {
  const c = document.createElement('canvas');
  c.width = canvas.width; c.height = canvas.height;
  c.getContext('2d').drawImage(canvas, 0, 0);
  return c;
}
function transformPaper(kind) {
  commitText();
  if (mode !== 'draw') return;
  snapshot();
  if (kind === 'invert') {
    const img = pctx.getImageData(0, 0, PW, PH), d = img.data;
    for (let i = 0; i < d.length; i += 4) { d[i] = 255 - d[i]; d[i + 1] = 255 - d[i + 1]; d[i + 2] = 255 - d[i + 2]; }
    pctx.putImageData(img, 0, 0);
  } else {
    const c = copyOf(paper);
    pctx.save();
    if (kind === 'flipH') { pctx.translate(PW, 0); pctx.scale(-1, 1); }
    if (kind === 'flipV') { pctx.translate(0, PH); pctx.scale(1, -1); }
    if (kind === 'rotate') { pctx.translate(PW, PH); pctx.rotate(Math.PI); }
    pctx.drawImage(c, 0, 0);
    pctx.restore();
  }
  changed();
}

// ---------- Freehand tools ----------
function freehand(a, b, color) {
  if (tool === 'pencil') {
    // Hard-edged square pixels along the line (no smoothing), like MS Paint.
    const s = sizes.pencil(), off = Math.floor(s / 2);
    pctx.fillStyle = color;
    let x0 = Math.round(a.x), y0 = Math.round(a.y);
    const x1 = Math.round(b.x), y1 = Math.round(b.y);
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      pctx.fillRect(x0 - off, y0 - off, s, s);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
    return;
  }
  const eraser = tool === 'eraser';
  pctx.strokeStyle = eraser ? color2 : color;   // the eraser paints with color 2
  pctx.lineWidth = eraser ? sizes.eraser() : sizes.brush();
  pctx.lineCap = pctx.lineJoin = eraser ? 'square' : 'round';
  if (eraser) pctx.lineJoin = 'miter';
  pctx.beginPath(); pctx.moveTo(a.x, a.y); pctx.lineTo(b.x, b.y); pctx.stroke();
}

function spray(p, color) {
  const r = sizes.spray(), n = Math.ceil(size() * 0.9);
  pctx.fillStyle = color;
  for (let i = 0; i < n; i++) {
    const ang = Math.random() * Math.PI * 2, d = Math.random() * r;
    pctx.fillRect(p.x + Math.cos(ang) * d, p.y + Math.sin(ang) * d, 1.5, 1.5);
  }
}

// ---------- Shapes ----------
// Points are in a 0..1 box, then stretched to whatever box you drag out.
function regular(n, startDeg) {
  const pts = [];
  for (let k = 0; k < n; k++) {
    const a = (startDeg + k * 360 / n) * Math.PI / 180;
    pts.push([Math.cos(a), Math.sin(a)]);
  }
  return normalize(pts);
}
function starPoints() {
  const pts = [];
  for (let k = 0; k < 10; k++) {
    const a = (-90 + k * 36) * Math.PI / 180, r = k % 2 ? 0.4 : 1;
    pts.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  return normalize(pts);
}
function normalize(pts) {
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  return pts.map(([x, y]) => [(x - x0) / (x1 - x0), (y - y0) / (y1 - y0)]);
}
const POLYS = {
  triangle: [[.5, 0], [1, 1], [0, 1]],
  righttri: [[0, 0], [1, 1], [0, 1]],
  diamond:  [[.5, 0], [1, .5], [.5, 1], [0, .5]],
  pentagon: regular(5, -90),
  hexagon:  regular(6, 0),
  arrow:    [[0, .3], [.6, .3], [.6, 0], [1, .5], [.6, 1], [.6, .7], [0, .7]],
  star:     starPoints(),
};
function shapePath(ctx, id, x, y, w, h) {
  ctx.beginPath();
  if (id === 'rect') ctx.rect(x, y, w, h);
  else if (id === 'roundrect') {
    const r = Math.min(w, h) * 0.2;
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h);
  }
  else if (id === 'ellipse') ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
  else if (id === 'heart') {
    ctx.moveTo(x + w / 2, y + h * 0.3);
    ctx.bezierCurveTo(x + w / 2, y, x, y, x, y + h * 0.3);
    ctx.bezierCurveTo(x, y + h * 0.6, x + w / 2, y + h * 0.8, x + w / 2, y + h);
    ctx.bezierCurveTo(x + w / 2, y + h * 0.8, x + w, y + h * 0.6, x + w, y + h * 0.3);
    ctx.bezierCurveTo(x + w, y, x + w / 2, y, x + w / 2, y + h * 0.3);
  }
  else POLYS[id].forEach(([px, py], i) => ctx[i ? 'lineTo' : 'moveTo'](x + px * w, y + py * h));
  ctx.closePath();
}

// Hold Shift for a perfect square/circle, or a straight 45° line.
function drawShape(ctx, a, b, shift, main, other) {
  ctx.save();
  ctx.lineWidth = sizes.shape();
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.strokeStyle = main;
  if (tool === 'line') {
    let ex = b.x, ey = b.y;
    if (shift) {
      const ang = Math.round(Math.atan2(b.y - a.y, b.x - a.x) / (Math.PI / 4)) * (Math.PI / 4);
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      ex = a.x + Math.cos(ang) * len; ey = a.y + Math.sin(ang) * len;
    }
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(ex, ey); ctx.stroke();
  } else {
    let w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
    if (shift) w = h = Math.max(w, h);
    const x = b.x < a.x ? a.x - w : a.x, y = b.y < a.y ? a.y - h : a.y;
    shapePath(ctx, tool, x, y, w, h);
    if (fillMode === 'filled') { ctx.fillStyle = main; ctx.fill(); }
    else if (fillMode === 'both') { ctx.fillStyle = other; ctx.fill(); ctx.stroke(); }
    else ctx.stroke();
  }
  ctx.restore();
}

// ---------- Fill bucket ----------
function floodFill(p, hex) {
  const x0 = Math.floor(p.x), y0 = Math.floor(p.y);
  if (x0 < 0 || y0 < 0 || x0 >= PW || y0 >= PH) return;
  const img = pctx.getImageData(0, 0, PW, PH), d = img.data;
  const fr = parseInt(hex.slice(1, 3), 16), fg = parseInt(hex.slice(3, 5), 16), fb = parseInt(hex.slice(5, 7), 16);
  const s = (y0 * PW + x0) * 4, tr = d[s], tg = d[s + 1], tb = d[s + 2];
  const seen = new Uint8Array(PW * PH);
  const stack = [y0 * PW + x0];
  while (stack.length) {
    const k = stack.pop();
    if (seen[k]) continue;
    seen[k] = 1;
    const i = k * 4;
    if (Math.abs(d[i] - tr) + Math.abs(d[i + 1] - tg) + Math.abs(d[i + 2] - tb) > FILL_TOLERANCE) continue;
    d[i] = fr; d[i + 1] = fg; d[i + 2] = fb; d[i + 3] = 255;
    const x = k % PW;
    if (x > 0) stack.push(k - 1);
    if (x < PW - 1) stack.push(k + 1);
    if (k >= PW) stack.push(k - PW);
    if (k < PW * (PH - 1)) stack.push(k + PW);
  }
  pctx.putImageData(img, 0, 0);
}

function pickColor(p) {
  const d = pctx.getImageData(Math.floor(p.x), Math.floor(p.y), 1, 1).data;
  return '#' + [d[0], d[1], d[2]].map(v => v.toString(16).padStart(2, '0')).join('');
}

// ---------- Text ----------
// Click with the text tool, type, then press Enter (or click elsewhere).
let textState = null;
function openText(p, color) {
  const r = stage.getBoundingClientRect(), k = r.width / PW;
  textState = { p, color, px: sizes.text() };
  textBox.value = '';
  textBox.style.display = 'block';
  textBox.style.left = (p.x * k) + 'px';
  textBox.style.top = (p.y * k) + 'px';
  textBox.style.fontSize = (textState.px * k) + 'px';
  textBox.style.color = color;
  setTimeout(() => textBox.focus(), 0);
}
function commitText() {
  if (!textState) return;
  const { p, color, px } = textState;
  textState = null;
  const v = textBox.value;
  textBox.style.display = 'none';
  if (!v.trim()) return;
  snapshot();
  pctx.save();
  pctx.font = `bold ${px}px Arial, sans-serif`;
  pctx.fillStyle = color; pctx.textBaseline = 'top';
  pctx.fillText(v, p.x + 2, p.y + 2);
  pctx.restore();
  changed();
}
textBox.addEventListener('keydown', e => {
  if (e.key === 'Enter') commitText();
  if (e.key === 'Escape') { textBox.value = ''; commitText(); }
});
textBox.addEventListener('blur', () => setTimeout(commitText, 0));

// ---------- Mouse / touch on the canvas ----------
let drag = null;
function canvasPoint(e) {
  const r = stage.getBoundingClientRect();
  return { x: (e.clientX - r.left) * PW / r.width, y: (e.clientY - r.top) * PH / r.height };
}
stage.addEventListener('contextmenu', e => e.preventDefault());
stage.addEventListener('pointerdown', e => {
  if (mode !== 'draw' || (e.button !== 0 && e.button !== 2)) return;
  e.preventDefault();
  if (textState) { commitText(); return; }   // first click just finishes the text
  const p = canvasPoint(e);
  const right = e.button === 2;
  const main = right ? color2 : color1, other = right ? color1 : color2;

  if (tool === 'text') { openText(p, main); return; }
  if (tool === 'picker') {
    if (right) color2 = pickColor(p); else color1 = pickColor(p);
    updateColorUI(); setTool(prevTool); return;
  }
  if (tool === 'fill') { snapshot(); floodFill(p, main); changed(); return; }

  snapshot();
  stage.setPointerCapture(e.pointerId);
  drag = { start: p, last: p, main, other };
  if (tool === 'spray') {
    spray(p, main); showPaper();
    drag.timer = setInterval(() => { spray(drag.last, main); showPaper(); }, 16);
  } else if (!isShape(tool)) { freehand(p, p, main); showPaper(); }
});
stage.addEventListener('pointermove', e => {
  if (!drag) return;
  const p = canvasPoint(e);
  if (isShape(tool)) { showPaper(); drawShape(sctx, drag.start, p, e.shiftKey, drag.main, drag.other); }
  else if (tool !== 'spray') { freehand(drag.last, p, drag.main); showPaper(); }
  drag.last = p;
});
function endDrag(e) {
  if (!drag) return;
  if (isShape(tool)) {
    drawShape(pctx, drag.start, canvasPoint(e), e.shiftKey, drag.main, drag.other);
  }
  clearInterval(drag.timer);
  drag = null;
  changed();
}
stage.addEventListener('pointerup', endDrag);
stage.addEventListener('pointercancel', endDrag);

// ---------- Starter picture, clear, upload ----------
function starterPicture() {
  pctx.save();
  pctx.fillStyle = '#ffffff'; pctx.fillRect(0, 0, PW, PH);
  pctx.fillStyle = '#000000';
  pctx.font = '40px "Press Start 2P", monospace';
  pctx.textAlign = 'center'; pctx.textBaseline = 'middle';
  ['draw', 'something,', 'then click', 'morph.'].forEach((line, i) => {
    pctx.fillText(line, PW / 2, PH / 2 + (i - 1.5) * 64);
  });
  pctx.restore();
  sourceDirty = true;
}

clearBtn.onclick = () => {
  commitText(); snapshot();
  pctx.fillStyle = '#ffffff'; pctx.fillRect(0, 0, PW, PH);
  changed();
};

function loadImageFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
uploadInput.onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  const img = await loadImageFile(f);
  commitText(); snapshot();
  pctx.fillStyle = '#ffffff'; pctx.fillRect(0, 0, PW, PH);
  fitImage(pctx, img, PW, PH, 'cover');
  e.target.value = '';
  changed();
};

// Detail (grid size) buttons
let resValue = 96;
document.querySelectorAll('#res button').forEach(b => {
  b.onclick = () => {
    resValue = +b.dataset.v; sourceDirty = true;
    document.querySelectorAll('#res button').forEach(x => x.classList.toggle('on', x === b));
  };
});

// =====================================================================
//  THE MORPH
// =====================================================================

// ---------- Choosing the target (side tab) ----------
// TARGETS comes from targets.js. Each has an id, a name and the image itself.
let targetImg = null;
const drawer = document.getElementById('drawer');
const scrim = document.getElementById('scrim');
const drawerTab = document.getElementById('drawerTab');
const targetGrid = document.getElementById('targetGrid');

function openDrawer(open) {
  drawer.classList.toggle('open', open);
  scrim.classList.toggle('on', open);
}
drawerTab.onclick = () => openDrawer(true);
document.getElementById('drawerClose').onclick = () => openDrawer(false);
scrim.onclick = () => openDrawer(false);
document.addEventListener('keydown', e => { if (e.key === 'Escape') openDrawer(false); });

let targetId = null;
function selectTarget(t, card) {
  targetId = t.id; saveSoon();
  const img = new Image();
  img.onload = () => {
    targetImg = img;
    sourceDirty = true; particles = null;   // next MORPH uses the new target
  };
  img.src = t.src;
  targetGrid.querySelectorAll('.target').forEach(c => c.classList.toggle('on', c === card));
}

// The last card in the grid is always "Upload your own".
const addCard = document.createElement('label');
addCard.className = 'target add';
addCard.innerHTML = '<b>+</b><span>Upload your own</span><input type="file" accept="image/*">';
targetGrid.appendChild(addCard);

function addTargetCard(t, custom) {
  const card = document.createElement('button');
  card.className = custom ? 'target' : 'target builtin';  // built-in names shown in CAPS
  const name = document.createElement('span');
  name.textContent = t.name;           // textContent: safe for any file name
  card.title = t.name;
  card.dataset.id = t.id;
  const img = document.createElement('img');
  img.alt = ''; img.src = t.src;
  card.append(img, name);
  card.onclick = () => {
    selectTarget(t, card); setTimeout(() => openDrawer(false), 250);
  };
  if (custom) {
    const del = document.createElement('span');
    del.className = 'del'; del.textContent = 'X'; del.title = 'Remove';
    del.onclick = e => {
      e.stopPropagation();
      const wasOn = card.classList.contains('on');
      card.remove();
      saveCustomTargets(customTargets.filter(c => c !== t));
      if (wasOn) targetGrid.firstElementChild.click();   // fall back to Default
    };
    card.appendChild(del);
  }
  targetGrid.insertBefore(card, addCard);
  return card;
}

// Uploaded targets are remembered in this browser (localStorage), so they
// are still there next time. If the browser blocks storage, they just last
// until the page is closed.
const STORE_KEY = 'morphCustomTargets';
let customTargets = [];
function saveCustomTargets(list) {
  customTargets = list;
  try { localStorage.setItem(STORE_KEY, JSON.stringify(list)); }
  catch (err) { /* storage full or blocked: keep it for this visit only */ }
}
try { customTargets = JSON.parse(localStorage.getItem(STORE_KEY)) || []; } catch (err) { customTargets = []; }

TARGETS.forEach((t, i) => {
  const card = addTargetCard(t, false);
  if (i === 0) selectTarget(t, card);
});
customTargets.forEach(t => addTargetCard(t, true));

addCard.querySelector('input').onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  e.target.value = '';
  const img = await loadImageFile(f);
  // Shrink big photos to at most 400px (the morph grid is only ~100 wide
  // anyway), flattened onto white so see-through parts act like background.
  const s = Math.min(1, 400 / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.width * s));
  c.height = Math.max(1, Math.round(img.height * s));
  const x = c.getContext('2d');
  x.fillStyle = '#ffffff'; x.fillRect(0, 0, c.width, c.height);
  x.imageSmoothingEnabled = s < 1;
  x.drawImage(img, 0, 0, c.width, c.height);
  const t = {
    id: 'custom-' + Date.now(),
    name: f.name.replace(/\.[^.]+$/, '') || f.name,   // the file's own name (minus ".png" etc.)
    src: c.toDataURL('image/png'),
  };
  saveCustomTargets([...customTargets, t]);
  const card = addTargetCard(t, true);
  selectTarget(t, card);
  card.scrollIntoView({ block: 'nearest' });
  setTimeout(() => openDrawer(false), 400);
};

// Draw an image into a box. 'cover' fills the box (cropping), 'contain' fits inside.
function fitImage(ctx, img, w, h, fit) {
  const s = fit === 'cover' ? Math.max(w / img.width, h / img.height)
                            : Math.min(w / img.width, h / img.height);
  const iw = img.width * s, ih = img.height * s;
  ctx.drawImage(img, (w - iw) / 2, (h - ih) / 2, iw, ih);
}

// Shrink a picture to a W x H grid and return its colors as [r,g,b, r,g,b, ...]
function sampleGrid(img, W, H, fit) {
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d', { willReadFrequently: true });
  // Tiny pixel-art targets get blown up with crisp pixels; big pictures are
  // shrunk smoothly (averaging colors).
  x.imageSmoothingEnabled = Math.min(W / img.width, H / img.height) < 1;
  x.imageSmoothingQuality = 'high';
  x.fillStyle = '#fff'; x.fillRect(0, 0, W, H);  // transparent -> white
  fitImage(x, img, W, H, fit);
  const d = x.getImageData(0, 0, W, H).data;
  const out = new Uint8Array(W * H * 3);
  for (let i = 0, j = 0; i < d.length; i += 4, j += 3) {
    out[j] = d[i]; out[j + 1] = d[i + 1]; out[j + 2] = d[i + 2];
  }
  return out;
}

const luma = (a, i) => 0.299 * a[i * 3] + 0.587 * a[i * 3 + 1] + 0.114 * a[i * 3 + 2];

// The morph is drawn on a small hidden canvas (W*SCALE x H*SCALE),
// then stretched onto the visible stage with crisp pixels.
let W = 0, H = 0, SCALE = 1, N = 0;
const frameCanvas = document.createElement('canvas');
const fctx = frameCanvas.getContext('2d');
function setupGrid() {
  W = resValue;
  H = Math.round(W * PH / PW);
  N = W * H;
  SCALE = Math.max(1, Math.floor(PW / W));
  frameCanvas.width = W * SCALE; frameCanvas.height = H * SCALE;
}

let S, T, assign;  // source colors, target colors, assign[targetSpot] = sourcePixel

function setProgress(f) { progressEl.firstElementChild.style.width = Math.round(f * 100) + '%'; }

async function solve() {
  setupGrid();
  S = sampleGrid(paper, W, H, 'cover');
  T = sampleGrid(targetImg, W, H, 'contain');

  // Step 1: sort both by brightness and pair them up in order.
  const order = n => Array.from({ length: n }, (_, i) => i);
  const sOrder = order(N).sort((a, b) => luma(S, a) - luma(S, b));
  const tOrder = order(N).sort((a, b) => luma(T, a) - luma(T, b));
  assign = new Int32Array(N);
  const rank = new Int32Array(N);          // where each target spot sits in tOrder
  for (let k = 0; k < N; k++) { assign[tOrder[k]] = sOrder[k]; rank[tOrder[k]] = k; }

  // Cost of putting source pixel s on target spot t (lower = better match)
  const cost = (s, t) => {
    const s3 = s * 3, t3 = t * 3;
    const dr = S[s3] - T[t3], dg = S[s3 + 1] - T[t3 + 1], db = S[s3 + 2] - T[t3 + 2];
    const dx = (s % W) - (t % W), dy = ((s / W) | 0) - ((t / W) | 0);
    return 2 * dr * dr + 4 * dg * dg + 3 * db * db + SPATIAL_WEIGHT * (dx * dx + dy * dy);
  };

  // Step 2: random swaps that improve the match, in chunks so the page
  // doesn't freeze. A pink/yellow bar under the canvas shows progress.
  progressEl.classList.add('on');
  const total = N * SWAPS_PER_PIXEL, CHUNK = 250000;
  for (let done = 0; done < total; done += CHUNK) {
    for (let k = 0; k < CHUNK; k++) {
      const a = (Math.random() * N) | 0;
      let b;
      if (k & 1) b = (Math.random() * N) | 0;                    // anywhere
      else {                                                      // similar brightness
        const r = rank[a] + (((Math.random() * 129) | 0) - 64);
        b = tOrder[r < 0 ? 0 : r >= N ? N - 1 : r];
      }
      if (a === b) continue;
      const sa = assign[a], sb = assign[b];
      if (cost(sb, a) + cost(sa, b) < cost(sa, a) + cost(sb, b)) {
        assign[a] = sb; assign[b] = sa;
      }
    }
    setProgress(Math.min(1, (done + CHUNK) / total));
    await new Promise(requestAnimationFrame);
  }
  progressEl.classList.remove('on');
  setProgress(0);
  sourceDirty = false;
}

let anim = null;
const ease = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

function buildParticles() {
  const p = {
    x0: new Float32Array(N), y0: new Float32Array(N),
    x1: new Float32Array(N), y1: new Float32Array(N),
    delay: new Float32Array(N), swirl: new Float32Array(N), col: new Uint32Array(N),
  };
  for (let t = 0; t < N; t++) {
    const s = assign[t];
    p.x0[t] = s % W; p.y0[t] = (s / W) | 0;
    p.x1[t] = t % W; p.y1[t] = (t / W) | 0;
    p.delay[t] = Math.random() * MAX_DELAY;
    p.swirl[t] = (Math.random() - 0.5) * 0.6;
    // pack color as 0xAABBGGRR (how canvas pixel memory is laid out)
    p.col[t] = 0xff000000 | (S[s * 3 + 2] << 16) | (S[s * 3 + 1] << 8) | S[s * 3];
  }
  return p;
}

function renderFrame(p, prog) {
  const FW = frameCanvas.width, FH = frameCanvas.height;
  const img = fctx.createImageData(FW, FH);
  const buf = new Uint32Array(img.data.buffer);
  buf.fill(0xff000000);   // black background
  for (let i = 0; i < N; i++) {
    let t = (prog - p.delay[i]) / (1 - MAX_DELAY);
    t = ease(t < 0 ? 0 : t > 1 ? 1 : t);
    const dx = p.x1[i] - p.x0[i], dy = p.y1[i] - p.y0[i];
    // bend the path sideways a little so it swirls instead of going straight
    const bend = Math.sin(Math.PI * t) * p.swirl[i];
    const x = p.x0[i] + dx * t - dy * bend;
    const y = p.y0[i] + dy * t + dx * bend;
    const px = Math.round(x * SCALE), py = Math.round(y * SCALE);
    if (px < 0 || py < 0 || px + SCALE > FW || py + SCALE > FH) continue;
    const c = p.col[i];
    for (let yy = 0; yy < SCALE; yy++) {
      const row = (py + yy) * FW + px;
      for (let xx = 0; xx < SCALE; xx++) buf[row + xx] = c;
    }
  }
  fctx.putImageData(img, 0, 0);
  sctx.imageSmoothingEnabled = false;
  sctx.fillStyle = '#000000'; sctx.fillRect(0, 0, PW, PH);
  sctx.drawImage(frameCanvas, 0, 0, PW, PH);
}

let particles = null;

// Put the grid size back to what a saved morph used (for replaying it backwards).
function useGrid(entry) {
  W = entry.W; H = entry.H; N = entry.N; SCALE = entry.SCALE;
  frameCanvas.width = W * SCALE; frameCanvas.height = H * SCALE;
}

function animate(entry, forward) {
  useGrid(entry);
  return new Promise(resolve => {
    const speed = +document.getElementById('speed').value;
    const duration = 7000 - speed * 550;   // ms
    const start = performance.now();
    const tick = now => {
      const k = Math.min(1, (now - start) / duration);
      renderFrame(entry.particles, forward ? k : 1 - k);
      if (k < 1) anim = requestAnimationFrame(tick);
      else { anim = null; resolve(); }
    };
    anim = requestAnimationFrame(tick);
  });
}

// Undo/redo is for drawing; each morph starts a fresh undo history
// (BACK is the way to undo a morph).
function resetUndo() { undoStack.length = 0; redoStack.length = 0; }

goBtn.onclick = async () => {
  commitText();
  if (mode !== 'draw' || !targetImg) return;
  setMode('busy');
  const before = copyOf(paper);
  if (sourceDirty || !particles) { await solve(); particles = buildParticles(); }
  const entry = { before, particles, W, H, N, SCALE };
  await animate(entry, true);
  // The finished morph becomes your new picture, so you can draw on it
  // and morph again, as many times as you like.
  pctx.drawImage(stage, 0, 0);
  morphHistory.push(entry);
  particles = null; sourceDirty = true; touched = true;
  resetUndo();
  setMode('draw');
  if (!hasRevealed) { hasRevealed = true; reveal(); }
  saveNow();
};

backBtn.onclick = async () => {
  commitText();
  if (mode !== 'draw' || morphHistory.length === 0) return;
  setMode('busy');
  const entry = morphHistory.pop();
  await animate(entry, false);
  // Restore the exact picture from before that morph (any lines drawn
  // on top of the morph since then are undone too).
  pctx.drawImage(entry.before, 0, 0);
  particles = entry.particles; sourceDirty = false;  // MORPH again reuses this match
  resetUndo();
  setMode('draw');
  showPaper();
  saveNow();
};

// =====================================================================
//  SAVING
//  Your picture, the chosen target and whether the title has been
//  revealed are kept in this browser (localStorage), so closing the tab
//  doesn't lose anything. (Uploaded targets are saved separately, above.)
// =====================================================================
function saveNow() {
  clearTimeout(saveTimer);
  if (loading || (!touched && !hasRevealed)) return;   // nothing drawn yet: nothing to save
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      revealed: hasRevealed, target: targetId, picture: paper.toDataURL('image/png'),
    }));
  } catch (err) { /* storage full or blocked: nothing we can do */ }
}
// Drawing changes the picture many times a second, so wait for a short pause.
function saveSoon() { clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 600); }

function loadSave() {
  let data = null;
  try { data = JSON.parse(localStorage.getItem(SAVE_KEY)); } catch (err) {}
  if (!data || typeof data !== 'object') { loading = false; return; }
  // Old saves from the Kromer version have no picture; they just reveal the title.
  if (data.revealed || data.morphs > 0) { hasRevealed = true; reveal(); }
  if (data.target) {
    const card = [...targetGrid.querySelectorAll('.target')].find(c => c.dataset.id === data.target);
    if (card) card.click();
  }
  if (typeof data.picture === 'string' && data.picture.startsWith('data:image/')) {
    touched = true;            // keep the starter text from drawing over it
    const img = new Image();
    img.onload = () => { pctx.drawImage(img, 0, 0, PW, PH); sourceDirty = true; showPaper(); loading = false; };
    img.onerror = () => { loading = false; };
    img.src = data.picture;
  } else loading = false;
}

// SAVE button: download the picture, or start over.
const saveModal = document.getElementById('saveModal');
const openSave = open => saveModal.classList.toggle('open', open);
document.getElementById('saveBtn').onclick = () => openSave(true);
saveModal.addEventListener('click', e => { if (e.target === saveModal || e.target.closest('.mclose')) openSave(false); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') openSave(false); });
document.getElementById('downloadBtn').onclick = () => {
  commitText();
  const a = document.createElement('a');
  a.download = 'spamton-morph.png';
  a.href = paper.toDataURL('image/png');
  a.click();
};
document.getElementById('resetBtn').onclick = () => {
  if (!confirm('Start over? This erases your saved picture and hides the title again. Uploaded targets stay.')) return;
  loading = true;
  try { localStorage.removeItem(SAVE_KEY); } catch (err) {}
  location.reload();
};

// ---------- The surprise reveal ----------
function reveal() {
  document.getElementById('title').innerHTML =
    '<span class="w">SPAMTON</span> <span class="p">PICTURE</span> <span class="y">MORPH</span>';
  document.getElementById('reveal').classList.add('show');
  drawerTab.hidden = false;   // the target picker appears now too
  window.scrollTo({ top: 0, behavior: 'smooth' });

  // Type the message out one letter at a time, like an in-game text box.
  const msg = 'Draw something or upload an image, and it will change into a Spamton reference image.';
  const typed = document.getElementById('typed');
  const startAt = performance.now() + 700;   // short pause before typing
  (function type() {
    // letters shown = time passed / 28ms, so it never falls behind
    const i = Math.max(0, Math.min(msg.length, Math.floor((performance.now() - startAt) / 28)));
    typed.textContent = msg.slice(0, i);
    if (i < msg.length) setTimeout(type, 28);
  })();
}

// ---------- Start ----------
starterPicture();
showPaper();
setTool('brush');
updateColorUI();
setMode('draw');
loadSave();
// The pixel font may arrive a moment late; redraw the starter text once it has.
document.fonts.load('40px "Press Start 2P"').then(() => {
  if (!touched) { starterPicture(); showPaper(); }
});
