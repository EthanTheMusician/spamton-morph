// =====================================================================
//  GAME LAYER: Kromer (money), achievements, locked targets, saving.
//
//  - Progress autosaves in this browser (localStorage).
//  - A "save code" (BIGSHOT-....) holds the same progress as short text,
//    so it can be moved to another computer or restored after clearing data.
//  - app.js tells this file when things happen (Game.onMorph, Game.onText...),
//    and this file decides what gets unlocked.
// =====================================================================

const Game = (() => {
  const SAVE_KEY = 'morphSave';

  // Order matters: the save code stores these as on/off bits in this order.
  // Only ever ADD to the end of these lists, or old save codes will break.
  const TARGET_ORDER = ['bigshot', 'dance', 'hat', 'neo', 'portrait', 'closeup', 'glitch', 'laugh', 'puppet', 'face'];
  const SHAPE_ORDER = ['line', 'rect', 'roundrect', 'ellipse', 'triangle', 'righttri', 'diamond',
                       'pentagon', 'hexagon', 'arrow', 'star', 'heart'];

  // How each target is unlocked.
  const LOCKS = {
    bigshot: { type: 'start' },
    dance:   { type: 'start' },
    face:    { type: 'start' },
    laugh:   { type: 'ach', hint: 'Morph 3 times' },
    glitch:  { type: 'ach', hint: 'Press BACK 5 times in a row' },
    hat:     { type: 'ach', hint: 'Write a secret phrase...' },
    puppet:  { type: 'ach', hint: 'Unlock every other target' },
    closeup: { type: 'shop', price: 15 },
    portrait:{ type: 'shop', price: 25 },
    neo:     { type: 'shop', price: 40 },
  };

  // Achievements. hidden: shows as ??? until found. unlock: target it opens.
  const ACH = [
    { id: 'first',   name: 'FIRST DEAL',         desc: 'Do your first morph.', reward: 5,
      quip: 'A PLEASURE DOING [[Business]] WITH YOU!' },
    { id: 'repeat',  name: 'REPEAT CUSTOMER',    desc: 'Morph 3 times.', reward: 5, unlock: 'laugh',
      quip: 'YOU KEEP COMING BACK!! I LIKE THAT IN A [[Customer]].' },
    { id: 'ten',     name: 'FREQUENT FLYER',     desc: 'Morph 10 times.', reward: 10,
      quip: 'TEN [[Transactions]]! YOUR CREDIT SCORE IS [[Skyrocketing]].' },
    { id: 'loyal',   name: 'LOYALTY CARD',       desc: 'Morph 25 times.', reward: 20,
      quip: 'HERE IS A CARD. IT IS [[Loyal]]. UNLIKE MY [[Former Associates]].' },
    { id: 'rainbow', name: 'RAINBOW SALESMAN',   desc: 'Use 8 different colors in one drawing.', reward: 10,
      quip: 'SO MANY COLORS!! ARE YOU A [[Professional Artist]]?' },
    { id: 'shapes',  name: 'GEOMETRY CLASS',     desc: 'Draw 6 different kinds of shapes.', reward: 5,
      quip: 'TRIANGLES! HEXAGONS! A [[Well-Rounded]] PORTFOLIO!' },
    { id: 'rewind',  name: 'NO REFUNDS',         desc: 'Press BACK 5 times in a row.', reward: 5, unlock: 'glitch',
      quip: 'WHAT ARE YOU DOING. STOP. THERE ARE [[No Refunds]].' },
    { id: 'upload',  name: 'PERSONAL TOUCH',     desc: 'Upload your own target.', reward: 5,
      quip: 'YOUR OWN [[Merchandise]]? BOLD. I RESPECT IT.' },
    { id: 'photo',   name: 'PHOTO OP',           desc: 'Morph a picture you uploaded.', reward: 5,
      quip: 'SAY [[Cheese]]! ACTUALLY DON\'T. JUST HOLD STILL.' },
    { id: 'shop',    name: 'SHOPAHOLIC',         desc: 'Buy a target with Kromer.', reward: 5,
      quip: 'THANK YOU FOR YOUR [[Hard-Earned]] KROMER!!' },
    { id: 'blank',   name: 'BLANK CHECK',        desc: 'Morph a completely empty canvas.', reward: 10, hidden: true,
      quip: 'NOTHING? YOU GAVE ME... NOTHING? [[Bold Strategy]].' },
    { id: 'bigshot', name: 'NOW\'S YOUR CHANCE', desc: 'Write "BIG SHOT" with the text tool.', reward: 10, hidden: true, unlock: 'hat',
      quip: 'YES!! YES!!! THAT\'S THE [[Spirit]] KID!!' },
    { id: 'kromer',  name: 'FREE MONEY',         desc: 'Write "KROMER" with the text tool.', reward: 25, hidden: true,
      quip: 'YOU SAID THE MAGIC WORD. HERE. TAKE IT. [[Quickly]].' },
    { id: 'upside',  name: 'HEADS OR TAILS',     desc: 'Morph a picture you flipped or rotated upside down.', reward: 10, hidden: true,
      quip: 'WHY IS EVERYTHING [[Upside Down]]? OH WAIT. THAT\'S ME.' },
    { id: 'night',   name: 'NIGHT SHIFT',        desc: 'Morph between midnight and 4 AM.', reward: 15, hidden: true,
      quip: 'GO TO [[Sleep]]. ...AFTER ONE MORE MORPH.' },
    { id: 'collector', name: 'FULL COLLECTION',  desc: 'Unlock every other target.', reward: 50, unlock: 'puppet',
      quip: 'YOU DID IT!! NOW YOU\'RE A REAL [[BIG SHOT]]!!!' },
  ];
  const achById = Object.fromEntries(ACH.map(a => [a.id, a]));

  // ---------- Saved state ----------
  const fresh = () => ({ kromer: 0, morphs: 0, unlocked: [], ach: [], shapes: [] });
  let state = fresh();
  try {
    const saved = JSON.parse(localStorage.getItem(SAVE_KEY));
    if (saved) state = Object.assign(fresh(), saved);
  } catch (e) { /* no save yet, or storage blocked */ }

  function save() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); } catch (e) {}
    updateHud();
  }

  // Things that only count "in a row" or "in one drawing" (not saved).
  const session = { colors: new Set(), backStreak: 0 };

  // ---------- Unlocking ----------
  const isUnlocked = id => !LOCKS[id] || LOCKS[id].type === 'start' || state.unlocked.includes(id);
  const targetName = id => (TARGETS.find(t => t.id === id) || { name: id }).name;

  function unlock(id) {
    if (isUnlocked(id)) return;
    state.unlocked.push(id);
    save(); refreshCards();
    // Every target except the final one unlocked? -> FULL COLLECTION
    if (TARGET_ORDER.every(t => t === 'puppet' || isUnlocked(t))) grant('collector');
  }

  function grant(id) {
    if (state.ach.includes(id)) return;
    const a = achById[id];
    state.ach.push(id);
    state.kromer += a.reward;
    save();
    toast(a);
    if (a.unlock) unlock(a.unlock);
  }

  // ---------- Events from app.js ----------
  function onMorph(info) {
    state.morphs++;
    // 2 Kromer per morph, +1 for each extra color you used (up to +5)
    state.kromer += 2 + Math.min(5, Math.max(0, session.colors.size - 1));
    session.colors.clear();
    session.backStreak = 0;
    save();
    grant('first');
    if (state.morphs >= 3) grant('repeat');
    if (state.morphs >= 10) grant('ten');
    if (state.morphs >= 25) grant('loyal');
    if (info.blank) grant('blank');
    if (info.photo) grant('photo');
    if (info.upside) grant('upside');
    if (new Date().getHours() < 4) grant('night');
  }
  function onBack() {
    session.backStreak++;
    if (session.backStreak >= 5) grant('rewind');
  }
  function onColor(hex) {
    session.colors.add(hex.toLowerCase());
    if (session.colors.size >= 8) grant('rainbow');
  }
  function onShape(id) {
    if (!state.shapes.includes(id)) { state.shapes.push(id); save(); }
    if (state.shapes.length >= 6) grant('shapes');
  }
  function onText(text) {
    const t = text.toUpperCase().replace(/[^A-Z]/g, '');
    if (t.includes('BIGSHOT')) grant('bigshot');
    if (t.includes('KROMER')) grant('kromer');
  }
  const onUploadTarget = () => grant('upload');

  // ---------- Target cards (locked look + shop) ----------
  const cards = {};
  function decorateCard(id, card) {
    cards[id] = card;
    const lock = document.createElement('span');
    lock.className = 'lock';
    card.appendChild(lock);
    refreshCard(id);
  }
  function refreshCard(id) {
    const card = cards[id], lock = LOCKS[id];
    if (!card || !lock) return;
    const locked = !isUnlocked(id);
    card.classList.toggle('locked', locked);
    card.classList.toggle('afford', locked && lock.type === 'shop' && state.kromer >= lock.price);
    card.querySelector('.lock').textContent =
      !locked ? '' : lock.type === 'shop' ? `BUY: ${lock.price} KROMER` : lock.hint;
  }
  function refreshCards() { Object.keys(cards).forEach(refreshCard); }

  // Called when a card is clicked. Returns true if it may be selected.
  function cardClicked(id, card) {
    if (isUnlocked(id)) return true;
    const lock = LOCKS[id];
    if (lock.type === 'shop' && state.kromer >= lock.price) {
      state.kromer -= lock.price;
      save();
      unlock(id);
      grant('shop');
      return true;
    }
    card.classList.remove('nope'); void card.offsetWidth; card.classList.add('nope');  // little shake
    return false;
  }

  // ---------- HUD, collection, save code ----------
  const $ = id => document.getElementById(id);
  function updateHud() {
    if (!$('kromerCount')) return;
    $('kromerCount').textContent = state.kromer;
    $('collectionBtn').textContent = `Collection ${state.ach.length}/${ACH.length}`;
    refreshCards();
  }

  function openModal(id, open) {
    $(id).classList.toggle('open', open);
    if (open && id === 'collectionModal') renderCollection();
    if (open && id === 'saveModal') { $('saveCode').value = makeCode(); $('saveMsg').textContent = ''; $('loadCode').value = ''; }
  }
  function renderCollection() {
    const list = $('achList');
    list.innerHTML = '';
    ACH.forEach(a => {
      const got = state.ach.includes(a.id);
      const row = document.createElement('div');
      row.className = 'ach' + (got ? ' got' : '');
      const secret = a.hidden && !got;
      row.innerHTML = `<div><b></b><p></p></div><span class="rw"></span>`;
      row.querySelector('b').textContent = secret ? '???' : a.name;
      row.querySelector('p').textContent = secret ? 'A secret. Keep experimenting...' : a.desc;
      row.querySelector('.rw').textContent = got ? 'GOT' : `+${a.reward}K`;
      list.appendChild(row);
    });
    $('achCount').textContent = `${state.ach.length}/${ACH.length}`;
  }

  // Save code: BIGSHOT-<kromer>-<morphs>-<targets>-<achievements>-<shapes>-<check>
  // Numbers are written in base 36 (0-9 then A-Z) to keep it short.
  // The last part is a checksum, so typos (or "creative editing") are caught.
  const mask = (list, order) => order.reduce((m, id, i) => list.includes(id) ? m | (1 << i) : m, 0);
  const unmask = (m, order) => order.filter((id, i) => m & (1 << i));
  function checksum(s) {
    let h = 7;
    for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) % 46656;
    return h.toString(36).toUpperCase().padStart(3, '0');
  }
  function makeCode() {
    const body = [state.kromer, state.morphs, mask(state.unlocked, TARGET_ORDER),
                  mask(state.ach, ACH.map(a => a.id)), mask(state.shapes, SHAPE_ORDER)]
      .map(n => n.toString(36).toUpperCase()).join('-');
    return `BIGSHOT-${body}-${checksum(body)}`;
  }
  function loadCode(code) {
    const parts = code.toUpperCase().replace(/\s/g, '').split('-');
    if (parts.length !== 7 || parts[0] !== 'BIGSHOT') return false;
    const body = parts.slice(1, 6).join('-');
    if (checksum(body) !== parts[6]) return false;
    const n = parts.slice(1, 6).map(p => parseInt(p, 36));
    if (n.some(isNaN)) return false;
    state = { kromer: n[0], morphs: n[1], unlocked: unmask(n[2], TARGET_ORDER),
              ach: unmask(n[3], ACH.map(a => a.id)), shapes: unmask(n[4], SHAPE_ORDER) };
    save();
    return true;
  }

  // ---------- Achievement pop-ups ----------
  const queue = [];
  let showing = false;
  function toast(a) { queue.push(a); if (!showing) nextToast(); }
  function nextToast() {
    const a = queue.shift();
    const el = $('toast');
    if (!a || !el) { showing = false; return; }
    showing = true;
    el.querySelector('.tname').textContent = a.name;
    el.querySelector('.tquip').textContent = a.quip;
    el.querySelector('.treward').textContent =
      `+${a.reward} KROMER` + (a.unlock ? `  ·  UNLOCKED: ${targetName(a.unlock).toUpperCase()}` : '');
    el.classList.add('show');
    setTimeout(() => { el.classList.remove('show'); setTimeout(nextToast, 450); }, 3800);
  }

  // ---------- Setup (called by app.js once the page is built) ----------
  function init() {
    $('collectionBtn').onclick = () => openModal('collectionModal', true);
    $('saveBtn').onclick = () => openModal('saveModal', true);
    document.querySelectorAll('.modal').forEach(m => {
      m.addEventListener('click', e => { if (e.target === m || e.target.closest('.mclose')) openModal(m.id, false); });
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') document.querySelectorAll('.modal.open').forEach(m => openModal(m.id, false));
    });
    $('copyCode').onclick = async () => {
      const box = $('saveCode');
      box.select();
      try { await navigator.clipboard.writeText(box.value); $('saveMsg').textContent = 'Copied!'; }
      catch (e) { $('saveMsg').textContent = 'Select the code and copy it (Ctrl+C).'; }
    };
    $('loadBtn').onclick = () => {
      if (loadCode($('loadCode').value)) {
        $('saveCode').value = makeCode();
        $('saveMsg').textContent = 'Progress loaded!';
      } else {
        $('saveMsg').textContent = "That code doesn't work. Check for typos.";
      }
    };
    $('resetBtn').onclick = () => {
      if (!confirm('Erase ALL progress (Kromer, achievements, unlocked targets)? This cannot be undone. Save your code first if you might want it back.')) return;
      state = fresh(); save();
      $('saveCode').value = makeCode();
      $('saveMsg').textContent = 'Progress erased.';
    };
    updateHud();
  }

  return {
    init, isUnlocked, decorateCard, cardClicked,
    onMorph, onBack, onColor, onShape, onText, onUploadTarget,
    get hasPlayed() { return state.morphs > 0; },
  };
})();
