/* Talk Cards by Dr. Asma Khattala
   Daily English speaking practice with spaced repetition, Pre-A1 to C2. Plain JavaScript, no libraries.
   Built from the engine of Maria's Talk Cards (~/Downloads/anki): flip card, Again / Good, the 1-2-4-8-16-32-64
   day ladder, warm-up, tricky ones, recorded voice with word highlighting, device voice as fallback.
   Same web address as Maria's app: every localStorage key here starts with "epp:" and no other key is touched. */
(() => {
'use strict';

const $ = (s, r = document) => r.querySelector(s);
const PARAMS = new URLSearchParams(location.search);
const DEV = PARAMS.get('dev') === '1';
const CONFIG = Object.assign({ apiUrl: '', appUrl: 'https://asmaasma1111.github.io/epp-talk-cards/' }, window.EPP_CONFIG || {});
const KEY = { state: 'epp:state', outbox: 'epp:outbox', classes: 'epp:classes', dev: 'epp:devOffset' };
const INTERVAL = [0, 1, 2, 4, 8, 16, 32, 64];          // days until next review, by box (Maria's ladder)
const SPEEDS = { slow: 0.75, standard: 0.85, normal: 0.95 };
const CLIP_SPEEDS = { slow: 0.88, standard: 1, normal: 1.12 };
const NEW_MAX = 4;          // new cards a day (ask cards count)
const DUE_LIMIT = 30;       // no new cards on a day with this many due
const EXTRA = 4;            // "Learn 4 more"
const GOAL = 600;           // 10 minutes of active practice, in seconds
const CARD_CAP = 120;       // active seconds counted per card, at most
const QUICK_FLIP = 3000;    // flipped in under 3 s: a sign of tapping through
const BATCH = 200;          // events per request
const REC_MAX = 120;        // a recording stops by itself after 2 minutes
const STAR_FLIGHT = 560;
const SHARE_TITLE = 'Talk Cards by Dr. Asma Khattala';
const SHARE_TEXT = 'Daily English speaking practice with spaced repetition, from Pre-A1 to C2.';
const SIZES = { S: 0.88, M: 1, L: 1.16 };
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const ARABIC = /[؀-ۿ]/;

/* ---------- storage (always wrapped) ---------- */
function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }
function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }

/* ---------- local calendar dates (dev mode can move the date) ---------- */
let devOffset = DEV ? (parseInt(lsGet(KEY.dev) || '0', 10) || 0) : 0;
const pad = n => String(n).padStart(2, '0');
const fmt = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
function today() { const d = new Date(); d.setDate(d.getDate() + devOffset); return fmt(d); }
function addDays(ds, n) { const [y, m, d] = ds.split('-').map(Number); const x = new Date(y, m - 1, d); x.setDate(x.getDate() + n); return fmt(x); }
const asDate = ds => { const [y, m, d] = ds.split('-').map(Number); return new Date(y, m - 1, d); };
const nowTs = () => Date.now() + devOffset * 864e5;
function uuid() {
  try { if (crypto.randomUUID) return crypto.randomUUID(); } catch (e) {}
  const b = new Uint8Array(16);
  try { crypto.getRandomValues(b); } catch (e) { for (let i = 0; i < 16; i++) b[i] = Math.random() * 256 | 0; }
  b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
  const h = Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
const esc = s => String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const div = (cls, text) => { const d = document.createElement('div'); if (cls) d.className = cls; if (text != null) d.textContent = text; return d; };
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

/* ---------- catalogue: levels/index.json + one file per level ---------- */
const LEVELS = [], LEVEL = {}, SETS = [], SET = {}, CARD = {};
const ALWAYS = new Set();      // levels that are always open: the optional starter and the first main level
function buildCatalog(index, files) {
  let order = 0;
  index.levels.forEach(L => {
    const f = files[L.id] || {};
    const lv = { id: L.id, code: L.code, name: L.name, optional: !!L.optional, help: L.help || 'none', idx: LEVELS.length,
                 cando: Array.isArray(f.cando) ? f.cando : [], candoAr: Array.isArray(f.cando_ar) ? f.cando_ar : [],
                 more: !!f.more_coming, sets: [] };
    (Array.isArray(f.sets) ? f.sets : []).forEach(s => {
      if (!s || !s.id || SET[s.id] || !Array.isArray(s.cards)) return;
      const set = { id: s.id, level: L.id, idx: lv.sets.length, title: s.title || '', ans: [], ask: [] };
      s.cards.forEach((c, i) => {
        if (!c || !c.q) return;
        const base = { set: s.id, level: L.id, n: i + 1 };
        const a = { ...base, id: `${s.id}:${i + 1}`, kind: 'ans', talk: !!c.talk, ar: c.ar || '', q: c.q,
                    steps: Array.isArray(c.steps) ? c.steps : [], a: (Array.isArray(c.a) ? c.a : [c.a]).filter(Boolean),
                    ex: c.ex || '', useful: Array.isArray(c.useful) ? c.useful : [], simple: c.simple || '', order: order++ };
        CARD[a.id] = a; set.ans.push(a.id);
        if (c.ask && !c.talk) {      // "Your turn to ask!": the cue on the front, the question on the back
          const k = { ...base, id: `${s.id}:k${i + 1}`, kind: 'ask', talk: false, cue: c.ask, q: c.q, order: order++ };
          CARD[k.id] = k; set.ask.push(k.id);
        }
      });
      if (!set.ans.length) return;
      lv.sets.push(set.id); SETS.push(set); SET[set.id] = set;
    });
    LEVELS.push(lv); LEVEL[lv.id] = lv;
  });
  const firstMain = LEVELS.findIndex(l => !l.optional);
  LEVELS.forEach((l, i) => { if (i <= firstMain) ALWAYS.add(l.id); });
}
const kindOf = c => (c.kind === 'ask' ? 'ask' : c.talk ? 'talk' : 'answer');

/* ---------- saved state: one key, epp:state ---------- */
function defaults() {
  return {
    app: 'epp-talk-cards', v: 1,
    sid: uuid(),                                  // this phone; the teacher's Sheet matches it, or the name + class
    setup: 'welcome',                             // welcome -> about -> start -> done
    me: { first: '', family: '', cls: '', solo: true, joined: false },
    level: LEVELS[0] ? LEVELS[0].id : 'pre-a1',   // current level: new cards come from here
    open: [],                                     // levels opened by finishing the one before (they stay open)
    passed: [],                                   // set ids that are done
    cards: {},                                    // id -> {box, due, again:[days], aTs, clean, intro, up, hints}
    stars: { total: 0, today: 0, day: '' },
    bonus: '',                                    // day the 10-minute bonus star was given
    active: {},                                   // day -> active seconds
    days: [],                                     // days with at least one card answered
    certs: {},                                    // level id -> {date, stars}
    prize: '',                                    // "target|prize" already celebrated
    lastTs: 0,                                    // time of the last card answered
    settings: { speed: 'standard', sfx: true, size: 'M', newPerDay: NEW_MAX }
  };
}
let st;
function merge(s) {
  const d = defaults();
  if (!s || typeof s !== 'object') return d;
  const obj = (v, def) => (v && typeof v === 'object' && !Array.isArray(v) ? v : def);
  const o = { ...d, ...s, app: d.app, me: { ...d.me, ...obj(s.me, {}) }, settings: { ...d.settings, ...obj(s.settings, {}) },
              stars: { ...d.stars, ...obj(s.stars, {}) }, cards: obj(s.cards, {}), active: obj(s.active, {}), certs: obj(s.certs, {}) };
  ['open', 'passed', 'days'].forEach(k => { if (!Array.isArray(o[k])) o[k] = []; });
  if (!/^[A-Za-z0-9-]{8,40}$/.test(String(o.sid))) o.sid = uuid();
  if (!LEVEL[o.level]) o.level = d.level;
  if (!['welcome', 'about', 'start', 'done'].includes(o.setup)) o.setup = 'welcome';
  o.settings.newPerDay = Math.min(NEW_MAX, Math.max(1, Number(o.settings.newPerDay) || NEW_MAX));
  if (!SIZES[o.settings.size]) o.settings.size = 'M';
  if (!SPEEDS[o.settings.speed]) o.settings.speed = 'standard';
  return o;
}
function load() { try { st = merge(JSON.parse(lsGet(KEY.state) || 'null')); } catch (e) { st = defaults(); } }
function save() { lsSet(KEY.state, JSON.stringify(st)); }
const peek = id => st.cards[id] || { box: 0, due: '', again: [] };
function cardRec(id) { if (!st.cards[id]) st.cards[id] = { box: 0, due: '', again: [] }; return st.cards[id]; }

/* ---------- levels and sets ---------- */
const levelOpen = id => ALWAYS.has(id) || st.open.includes(id);
const isPassed = sid => st.passed.includes(sid);
// Sets open one after another: the first set of a level, and any set whose set before it is done.
const setOpen = set => set.idx === 0 || isPassed(LEVEL[set.level].sets[set.idx - 1]);
const levelDone = id => LEVEL[id].sets.length > 0 && LEVEL[id].sets.every(isPassed);
const setsDone = id => LEVEL[id].sets.filter(isPassed).length;
function currentSet(id) { const l = LEVEL[id]; return SET[l.sets.find(s => !isPassed(s)) || l.sets[l.sets.length - 1]] || null; }
const nextLevel = id => LEVELS[LEVEL[id].idx + 1] || null;
function lockText(id) {
  const p = LEVELS[LEVEL[id].idx - 1];
  if (!p) return '';
  const n = p.sets.length, d = setsDone(p.id), code = LEVEL[id].code;
  if (!n) return `${p.code} sets are coming soon`;
  return n === 1 ? `Finish the ${p.code} set to open ${code} (${d} of 1 done)`
    : `Finish all ${n} ${p.code} sets to open ${code} (${d} of ${n} done)`;
}

/* ---------- which cards are in play ---------- */
// Reviews come from every open set of every open level; ask cards join once their set is done.
function eligible() {
  const out = [];
  LEVELS.forEach(lv => {
    if (!levelOpen(lv.id)) return;
    lv.sets.forEach(sid => {
      const s = SET[sid];
      if (!setOpen(s)) return;
      out.push(...s.ans);
      if (isPassed(sid)) out.push(...s.ask);
    });
  });
  return out;
}
// New-card order: waiting ask cards of done sets first (so they are not starved), then the current level's answer cards.
function newOrder() {
  const out = [];
  LEVELS.forEach(lv => {
    if (!levelOpen(lv.id)) return;
    lv.sets.forEach(sid => { if (isPassed(sid)) SET[sid].ask.forEach(id => { if (peek(id).box === 0) out.push(id); }); });
  });
  const lv = LEVEL[st.level];
  if (lv && levelOpen(lv.id)) lv.sets.forEach(sid => {
    if (setOpen(SET[sid])) SET[sid].ans.forEach(id => { if (peek(id).box === 0) out.push(id); });
  });
  return out;
}
function introducedToday() { const t = today(); return Object.values(st.cards).filter(c => c.intro === t).length; }
function dueIds() {
  const t = today();
  return eligible().filter(id => { const c = peek(id); return c.box >= 1 && c.due && c.due <= t; })
    .sort((a, b) => (peek(a).due < peek(b).due ? -1 : peek(a).due > peek(b).due ? 1 : CARD[a].order - CARD[b].order));
}
function newCap() { return dueIds().length >= DUE_LIMIT ? 0 : Math.max(0, st.settings.newPerDay - introducedToday()); }
function buildQueue() { return [...dueIds(), ...newOrder().slice(0, newCap())]; }
function extraIds() { return dueIds().length >= DUE_LIMIT ? [] : newOrder().slice(0, EXTRA); }
function trickyIds() {
  const t = today(), from = addDays(t, -6);
  return eligible().filter(id => (peek(id).again || []).some(d => d >= from && d <= t))
    .sort((a, b) => (peek(b).aTs || 0) - (peek(a).aTs || 0)).slice(0, 8);
}
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function moreIds() { return shuffle(eligible().filter(id => peek(id).box >= 1)).slice(0, 6); }
function learnedCount() { return Object.keys(st.cards).filter(id => CARD[id] && st.cards[id].box >= 1).length; }

/* ---------- scheduling (Maria's ladder) ---------- */
function applyGood(id) {
  const c = cardRec(id), t = today();
  if (c.box === 0 && !c.intro) c.intro = t;
  const againToday = S.again.has(id) || (c.again || []).includes(t);
  if (againToday) { c.box = 1; c.due = addDays(t, 1); }
  else if (c.up !== t) { c.box = Math.min(7, c.box + 1); c.due = addDays(t, INTERVAL[c.box]); c.up = t; }
  if (CARD[id].kind === 'ans') c.clean = !S.hint.has(id);
  addStar();
  checkPass(CARD[id].set, S.celeb);
}
function applyAgain(id) {
  const c = cardRec(id), t = today();
  if (c.box === 0 && !c.intro) c.intro = t;
  c.box = 1; c.due = addDays(t, 1);
  (c.again = c.again || []).push(t);
  if (c.again.length > 20) c.again.splice(0, c.again.length - 20);
  c.aTs = nowTs();
}
// A set is done when every answer card (talk card included) has been answered Good and its last Good was without
// help (the Arabic line on Pre-A1 and A1 is not help). Finishing the last set of a level gives a certificate and
// opens the next level.
function checkPass(setId, celeb) {
  const set = SET[setId];
  if (!set || isPassed(setId) || !levelOpen(set.level) || !setOpen(set)) return;
  if (!set.ans.every(id => { const c = peek(id); return c.box >= 1 && c.clean === true; })) return;
  st.passed.push(setId);
  const lv = LEVEL[set.level];
  const next = SET[lv.sets[set.idx + 1]];
  if (next && !isPassed(next.id)) celeb.push({ type: 'set', set: next.id });
  if (levelDone(lv.id) && !st.certs[lv.id]) {
    st.certs[lv.id] = { date: today(), stars: st.stars.total };
    Sync.queue({ t: 'c', id: uuid(), ts: nowTs(), level: lv.code, stars: st.stars.total });
    celeb.push({ type: 'cert', level: lv.id });
    const nl = nextLevel(lv.id);
    if (nl) {
      const was = levelOpen(nl.id);
      if (!st.open.includes(nl.id)) st.open.push(nl.id);
      if (!was) celeb.push({ type: 'level', level: nl.id, from: lv.id });
      else if (st.level === lv.id) celeb.push({ type: 'next', level: nl.id, from: lv.id });
    }
  }
}
// On Start: any set that already meets the rule (for example after a restore) is marked done.
function sweepPasses() {
  const celeb = [];
  SETS.forEach(s => checkPass(s.id, celeb));
  if (celeb.length) save();
  return celeb;
}

/* ---------- stars, minutes, days ---------- */
function starsToday() { return st.stars.day === today() ? st.stars.today : 0; }
function addStar(n = 1) {
  const t = today();
  if (st.stars.day !== t) { st.stars.day = t; st.stars.today = 0; }
  st.stars.today += n; st.stars.total += n;
  checkPrize();
}
function cachedClasses() {
  try { const o = JSON.parse(lsGet(KEY.classes) || 'null'); return o && Array.isArray(o.list) ? o.list : []; } catch (e) { return []; }
}
function prizeInfo() {
  if (st.me.solo || !st.me.cls) return null;
  const c = cachedClasses().find(x => x.name === st.me.cls);
  return c && c.target > 0 && c.prize ? c : null;
}
function checkPrize() {
  const p = prizeInfo();
  if (!p || !S) return;
  const k = `${p.target}|${p.prize}`;
  if (st.prize !== k && st.stars.total >= p.target) { st.prize = k; S.celeb.push({ type: 'prize', target: p.target, prize: p.prize }); }
}
const activeToday = () => st.active[today()] || 0;
function addActive(secs) {
  const t = today();
  st.active[t] = (st.active[t] || 0) + secs;
  const keys = Object.keys(st.active).sort();
  if (keys.length > 60) keys.slice(0, keys.length - 60).forEach(k => delete st.active[k]);
}
function markDay() {
  const t = today();
  if (!st.days.includes(t)) { st.days.push(t); st.days.sort(); if (st.days.length > 400) st.days.splice(0, st.days.length - 400); }
}
function streak() {
  const set = new Set(st.days);
  let d = today(), n = 0;
  if (!set.has(d)) d = addDays(d, -1);
  while (set.has(d)) { n++; d = addDays(d, -1); }
  return n;
}
// Active time: a card on screen, at most 2 minutes per card, paused while the app is in the background.
const Clock = {
  acc: 0, since: null, on: false,
  start() { this.acc = 0; this.on = true; this.since = document.hidden ? null : performance.now(); },
  pause() { if (this.since != null) { this.acc += performance.now() - this.since; this.since = null; } },
  resume() { if (this.on && this.since == null) this.since = performance.now(); },
  secs() { if (!this.on) return 0; return Math.min(CARD_CAP, (this.acc + (this.since != null ? performance.now() - this.since : 0)) / 1000); },
  stop() { const s = this.secs(); this.on = false; this.since = null; this.acc = 0; return s; }
};
function checkGoal() {
  if (st.bonus !== today() && activeToday() >= GOAL) { st.bonus = today(); addStar(); goalBanner(); }
}

/* ---------- recorded voice: audio/voice.json, deck "epp" ---------- */
// {v:2, decks: {epp: {voice, placeholder, clips: {"exact line text": {f: file, d: seconds, w: [[start, end] per token]}}}}}
let VOICE = null;
const deckVoice = () => (VOICE && VOICE.decks && VOICE.decks.epp) || null;
const clipFor = text => { const d = deckVoice(); return d && d.clips ? d.clips[text] : null; };
const voiceEl = new Audio();
voiceEl.preload = 'auto';
const clipUrls = new Map();      // file -> Promise<blob URL>; blob URLs play offline on iOS
function getClip(file) {
  if (!clipUrls.has(file)) {
    clipUrls.set(file, fetch('audio/' + file).then(r => { if (!r.ok) throw new Error(r.status); return r.blob(); })
      .then(b => URL.createObjectURL(new Blob([b], { type: 'audio/mp4' }))));
    if (clipUrls.size > 40) {
      const [old, p] = clipUrls.entries().next().value;
      clipUrls.delete(old); p.then(u => URL.revokeObjectURL(u)).catch(() => {});
    }
  }
  const p = clipUrls.get(file);
  p.catch(() => clipUrls.delete(file));
  return p;
}
let unlockUrl = null;
function unlockVoice() {           // iOS: the first play() must happen inside a tap
  if (unlockVoice.done || !deckVoice()) return;
  unlockVoice.done = true;
  try { voiceEl.src = unlockUrl || 'audio/_unlock.m4a'; voiceEl.play().catch(() => {}); } catch (e) {}
}

/* ---------- device voice (fallback for any line without a clip) ---------- */
const NOVELTY = /^(Albert|Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Good News|Jester|Organ|Superstar|Trinoids|Whisper|Wobble|Zarvox|Junior|Ralph|Fred|Kathy|Eddy|Flo|Grandma|Grandpa|Reed|Rocko|Sandy|Shelley)\b/i;
const hasSpeech = 'speechSynthesis' in window;
function enVoices() {
  if (!hasSpeech) return [];
  try { return speechSynthesis.getVoices().filter(v => (v.lang || '').replace('_', '-').toLowerCase() === 'en-us'); } catch (e) { return []; }
}
function pickVoice() {
  const vs = enVoices(); if (!vs.length) return null;
  return vs.find(v => /premium/i.test(v.name)) || vs.find(v => /enhanced/i.test(v.name)) ||
    vs.find(v => /^samantha/i.test(v.name)) || vs.find(v => v.default && !NOVELTY.test(v.name)) ||
    vs.find(v => !NOVELTY.test(v.name)) || vs[0];
}

/* ---------- speech with word highlighting (Maria's engine) ---------- */
const Speech = {
  token: 0, timers: [], hlEl: null, host: null, endClip: null,
  rate() { return SPEEDS[st.settings.speed] || 0.85; },
  stop() {
    this.token++;
    this.timers.forEach(t => { clearTimeout(t.id); t.resolve && t.resolve(); });
    this.timers = [];
    if (this.endClip) { try { voiceEl.pause(); } catch (e) {} this.endClip(); }
    if (hasSpeech) { try { if (speechSynthesis.speaking || speechSynthesis.pending) speechSynthesis.cancel(); } catch (e) {} }
    this.unhl();
    if (this.host) { this.host.classList.remove('speaking'); this.host = null; }
  },
  later(fn, ms) { const t = { id: setTimeout(() => { this.timers = this.timers.filter(x => x !== t); fn(); }, ms) }; this.timers.push(t); return t; },
  sleep(ms) { return new Promise(resolve => { const t = this.later(resolve, ms); t.resolve = resolve; }); },
  hl(el) { if (this.hlEl === el) return; this.unhl(); if (el) { el.classList.add('hl'); this.hlEl = el; } },
  unhl() { if (this.hlEl) { this.hlEl.classList.remove('hl'); this.hlEl = null; } },
  async play(plan, delay = 0, host = null) {
    this.stop();
    const tok = this.token;
    if (!plan || !plan.length || Rec.state === 'rec') return;   // never speak over her recording
    await this.sleep(delay);
    if (tok !== this.token || Rec.state === 'rec') return;
    if (host) { host.classList.add('speaking'); this.host = host; }
    for (const seg of plan) {
      if (tok !== this.token) return;
      if (seg.pause) { if (seg.el) this.hl(seg.el); await this.sleep(seg.pause); this.unhl(); continue; }
      if (seg.clip) await this.clip(seg, tok);
      else await this.say(seg, tok);
    }
    if (tok === this.token && this.host) { this.host.classList.remove('speaking'); this.host = null; }
  },
  clip(seg, tok) {
    return new Promise(resolve => {
      let ticker = 0, finished = false;
      const done = () => {
        if (finished) return; finished = true;
        clearInterval(ticker);
        voiceEl.onended = voiceEl.onerror = null;
        if (this.endClip === done) this.endClip = null;
        this.unhl(); resolve();
      };
      this.endClip = done;
      getClip(seg.clip).then(url => {
        if (finished || tok !== this.token) return done();
        const r = CLIP_SPEEDS[st.settings.speed] || 1;
        voiceEl.onended = done; voiceEl.onerror = done;
        voiceEl.src = url;
        voiceEl.defaultPlaybackRate = r; voiceEl.playbackRate = r;
        voiceEl.preservesPitch = true; voiceEl.webkitPreservesPitch = true;
        this.later(done, (seg.dur / r + 3) * 1000);
        const tick = () => {
          if (finished) return;
          const t = voiceEl.currentTime;
          let w = null;
          for (const x of seg.words) if (x.start <= t + 0.03) w = x;
          if (w && t <= w.end + 0.25) this.hl(w.el); else this.unhl();
        };
        voiceEl.play().then(() => { if (!finished) { tick(); ticker = setInterval(tick, 30); } }).catch(done);
      }).catch(done);
    });
  },
  say(seg, tok) {
    if (!hasSpeech) return Promise.resolve();
    return new Promise(resolve => {
      const words = seg.words || [];
      const rate = this.rate();
      const local = [];
      let boundary = false, finished = false;
      const T = (fn, ms) => { const t = this.later(fn, ms); local.push(t); return t; };
      const done = () => {
        if (finished) return; finished = true;
        local.forEach(t => clearTimeout(t.id));
        this.timers = this.timers.filter(t => !local.includes(t));
        this.unhl(); resolve();
      };
      const fallback = elapsed => {
        let at = 0;
        words.forEach(w => {
          const start = at; at += (w.end - w.start + 1) * 72 / rate;
          T(() => { if (!boundary && !finished) this.hl(w.el); }, Math.max(0, start - elapsed));
        });
      };
      const u = new SpeechSynthesisUtterance(seg.text);
      u.lang = 'en-US';
      const v = pickVoice(); if (v) u.voice = v;
      u.rate = rate; u.pitch = 1; u.volume = 1;
      window.__eppUtterance = u;    // keep a reference so Safari does not drop events
      u.onstart = () => {
        if (tok !== this.token) return;
        if (words.length === 1) this.hl(words[0].el);
        T(() => { if (!boundary && !finished) fallback(500); }, 500);
      };
      u.onboundary = e => {
        if (tok !== this.token || finished) return;
        if (e.name && e.name !== 'word') return;
        boundary = true;
        let w = null;
        for (const x of words) if (x.start <= e.charIndex) w = x;
        if (w) this.hl(w.el);
      };
      u.onend = done; u.onerror = done;
      T(done, (seg.text.length * 72 / rate + 2500) * 2);
      try {
        if (speechSynthesis.speaking || speechSynthesis.pending) speechSynthesis.cancel();
        speechSynthesis.resume();
        speechSynthesis.speak(u);
      } catch (e) { done(); }
    });
  }
};

// Turn one line of card text into word spans plus a speech plan (Maria's renderText, unchanged).
// "___" = blank (dotted line, pause), "M-A-R-I-A." = spelling. Arabic is shown, never spoken.
function renderText(el, text, speak) {
  el.textContent = '';
  const plan = [];
  if (ARABIC.test(text)) { el.classList.add('ar'); el.dir = 'rtl'; el.lang = 'ar'; el.textContent = text; return null; }
  el.classList.remove('ar'); el.dir = 'ltr';
  text.split(' / ').forEach((lineText, li) => {
    const line = document.createElement('div'); line.className = 'line';
    if (li > 0) plan.push({ pause: 550 });
    const dev = [];
    const els = [];
    let seg = { text: '', words: [] };
    const flush = () => { if (seg.words.length) dev.push(seg); seg = { text: '', words: [] }; };
    const word = tok => {
      const s = document.createElement('span'); s.className = 'w'; s.textContent = tok; line.append(s); els.push(s);
      const start = seg.text ? seg.text.length + 1 : 0;
      seg.text += (seg.text ? ' ' : '') + tok;
      seg.words.push({ el: s, start, end: start + tok.length });
    };
    lineText.split(/\s+/).filter(Boolean).forEach((tok, ti) => {
      if (ti > 0) line.append(' ');
      const spell = tok.match(/^([A-Z](?:-[A-Z])+)([.,!?]*)$/);
      if (spell) {
        flush();
        const wrap = document.createElement('span'); wrap.className = 'spell';
        spell[1].split('-').forEach((L, i) => {
          if (i) wrap.append('-');
          const s = document.createElement('span'); s.className = 'w'; s.textContent = L; wrap.append(s); els.push(s);
          if (i) dev.push({ pause: 320 });
          dev.push({ text: L, words: [{ el: s, start: 0, end: 1 }] });
        });
        if (spell[2]) wrap.append(spell[2]);
        line.append(wrap);
        return;
      }
      const blank = tok.match(/^(.*?)___(.*)$/);
      if (blank) {
        if (blank[1]) word(blank[1]);
        flush();
        const b = document.createElement('span'); b.className = 'blank'; line.append(b); els.push(b);
        dev.push({ pause: 750, el: b });
        if (blank[2]) line.append(blank[2]);
        return;
      }
      word(tok);
    });
    flush();
    el.append(line);
    const rec = clipFor(lineText);
    if (rec) {
      const timed = rec.w && rec.w.length === els.length;
      const words = timed ? els.map((e, i) => rec.w[i] && { el: e, start: rec.w[i][0], end: rec.w[i][1] }).filter(Boolean) : [];
      plan.push({ clip: rec.f, dur: rec.d, words });
      const last = els[els.length - 1];
      if (timed && last && last.classList.contains('blank') && !rec.w[els.length - 1]) plan.push({ pause: 750, el: last });
    } else plan.push(...dev);
  });
  while (plan.length && plan[plan.length - 1].pause && !plan[plan.length - 1].el) plan.pop();
  return speak ? plan : null;
}

/* ---------- sound effects (Web Audio, no files; Maria's) ---------- */
const SFX = {
  ctx: null, out: null, noise: null, busyUntil: 0,
  init() {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
        this.ctx = new AC();
        this.out = this.ctx.createGain();
        this.out.gain.value = 0.3;
        this.out.connect(this.ctx.destination);
      }
      if (this.ctx.state !== 'running') this.ctx.resume();
      const b = this.ctx.createBuffer(1, 1, 22050), s = this.ctx.createBufferSource();
      s.buffer = b; s.connect(this.ctx.destination); s.start(0);
    } catch (e) {}
  },
  ready() {
    if (!st.settings.sfx || !this.ctx) return false;
    if (this.ctx.state !== 'running') { try { this.ctx.resume(); } catch (e) {} }
    return true;
  },
  hold(sec) { this.busyUntil = Math.max(this.busyUntil, performance.now() + sec * 1000); },
  tone(f, at, dur, peak, type = 'sine', attack = 0.012) {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain(), t = c.currentTime + 0.02 + at;
    o.type = type; o.frequency.setValueAtTime(f, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.out);
    o.start(t); o.stop(t + dur + 0.05);
  },
  bell(f, at, dur, peak) { this.tone(f, at, dur, peak, 'sine'); this.tone(f, at, dur * 0.8, peak * 0.2, 'triangle'); },
  flip() {
    if (!this.ready()) return;
    const c = this.ctx;
    if (!this.noise) {
      const len = Math.floor(c.sampleRate * 0.2), b = c.createBuffer(1, len, c.sampleRate), d = b.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noise = b;
    }
    const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain(), t = c.currentTime + 0.01;
    s.buffer = this.noise;
    f.type = 'bandpass'; f.Q.value = 0.8;
    f.frequency.setValueAtTime(700, t); f.frequency.exponentialRampToValueAtTime(3200, t + 0.15);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.7, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
    s.connect(f); f.connect(g); g.connect(this.out);
    s.start(t); s.stop(t + 0.18);
    this.hold(0.18);
  },
  good() { if (!this.ready()) return; this.bell(1318.5, 0, 0.32, 0.5); this.bell(1760, 0.1, 0.65, 0.5); this.hold(0.8); },
  again() { if (!this.ready()) return; this.tone(440, 0, 0.24, 0.3); this.tone(329.6, 0.15, 0.34, 0.3); this.hold(0.52); },
  star(at = 0) { if (!this.ready()) return; this.tone(2093, at, 0.09, 0.3, 'sine', 0.006); this.tone(4186, at, 0.06, 0.05, 'sine', 0.004); this.hold(at + 0.13); },
  unlock() { if (!this.ready()) return; [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => this.bell(f, i * 0.12, i === 3 ? 0.9 : 0.4, 0.42)); this.hold(1.3); }
};
function speechDelay(min = 0) { return Math.max(min, Math.max(0, SFX.busyUntil - performance.now()) + 250); }

/* ---------- her recordings, kept on this phone only (IndexedDB), never sent ---------- */
// Dr. Asma, 8 Oct 2026: students can go back and hear their answers. Only the length goes to the teacher.
const REC_KEEP = 300;            // the newest 300 recordings stay; older ones are removed automatically
const RecStore = {
  db: null, failed: false,
  open() {
    if (this.db) return Promise.resolve(this.db);
    if (this.failed || !window.indexedDB) return Promise.reject(new Error('no storage'));
    return new Promise((res, rej) => {
      let r;
      try { r = indexedDB.open('epp-recordings', 1); } catch (e) { this.failed = true; return rej(e); }
      const t = setTimeout(() => { this.failed = true; rej(new Error('timeout')); }, 5000);
      r.onupgradeneeded = () => { const os = r.result.createObjectStore('recs', { keyPath: 'id' }); os.createIndex('ts', 'ts'); };
      r.onsuccess = () => { clearTimeout(t); this.db = r.result; res(this.db); };
      r.onerror = () => { clearTimeout(t); this.failed = true; rej(r.error); };
    });
  },
  run(mode, fn) {
    return this.open().then(db => new Promise((res, rej) => {
      const tx = db.transaction('recs', mode), os = tx.objectStore('recs');
      let out; const r = fn(os); if (r) r.onsuccess = () => { out = r.result; };
      tx.oncomplete = () => res(out); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error);
    }));
  },
  async add(rec) { await this.run('readwrite', os => os.put(rec)); await this.trim(); },
  async all() { const a = await this.run('readonly', os => os.getAll()); return (a || []).sort((x, y) => y.ts - x.ts); },
  del(id) { return this.run('readwrite', os => os.delete(id)); },
  clear() { return this.run('readwrite', os => os.clear()); },
  async trim() {
    const a = await this.all();
    if (a.length > REC_KEEP) await this.run('readwrite', os => { a.slice(REC_KEEP).forEach(r => os.delete(r.id)); });
  }
};
function recText(c) { return c ? (c.kind === 'ask' ? c.q : c.q) : ''; }
async function keepRecording(cardId, blob, secs) {
  const c = CARD[cardId]; if (!c || !blob || !blob.size) return;
  try {
    const data = await blob.arrayBuffer();     // stored as bytes: works in every browser's storage
    await RecStore.add({ id: uuid(), ts: nowTs(), day: today(), card: cardId, level: c.level, set: c.set,
                         kind: c.kind, q: recText(c), secs: Math.round(secs * 10) / 10, mime: blob.type || 'audio/mp4', data });
    if (!st.recNoted) { st.recNoted = true; save(); toast('Saved in My recordings, on this phone only.'); }
  } catch (e) {
    if (!keepRecording.warned) { keepRecording.warned = true; toast('This browser cannot keep recordings, but you can still listen right away.'); }
  }
}

/* ---------- her own voice: record, stop, play back ---------- */
const Rec = {
  ok: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder),
  off: false,                     // permission denied: hidden for the rest of this visit
  state: 'idle',                  // idle | asking | rec | saving | ready
  mr: null, stream: null, url: null, startAt: 0, timer: 0, auto: 0, player: null, noted: false,
  mime() {
    for (const t of ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm']) { try { if (MediaRecorder.isTypeSupported(t)) return t; } catch (e) {} }
    return '';
  },
  async toggle() {
    if (this.state === 'rec') return this.stop();
    if (this.state === 'asking' || this.state === 'saving' || !S) return;
    if (!this.ok || this.off) return;
    Speech.stop(); this.stopPlay();
    const card = S.cur;
    this.state = 'asking'; this.render();
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
    catch (e) {
      this.state = 'idle'; this.off = true; this.render();
      toast(e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')
        ? 'The microphone is blocked, so recording is off. You can still practice out loud.'
        : 'Recording does not work on this device. You can still practice out loud.');
      return;
    }
    if (!S || S.cur !== card || this.state !== 'asking') { stream.getTracks().forEach(t => t.stop()); if (this.state === 'asking') this.state = 'idle'; this.render(); return; }
    const type = this.mime();
    let mr;
    try { mr = type ? new MediaRecorder(stream, { mimeType: type }) : new MediaRecorder(stream); }
    catch (e) { try { mr = new MediaRecorder(stream); } catch (e2) { stream.getTracks().forEach(t => t.stop()); this.state = 'idle'; this.off = true; this.render(); toast('Recording does not work on this device.'); return; } }
    this.clearClip();
    const chunks = [];
    mr.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
    mr.onstop = () => {
      if (this.mr !== mr) return;                         // an older recording finishing late
      this.mr = null;
      const blob = new Blob(chunks, { type: mr.mimeType || type || 'audio/mp4' });
      keepRecording(card, blob, this.lastSecs || 0);
      if (S && S.cur === card && blob.size) { this.url = URL.createObjectURL(blob); this.state = 'ready'; }
      else this.state = 'idle';
      this.render();
    };
    this.mr = mr; this.stream = stream;
    mr.start();
    this.startAt = performance.now(); this.state = 'rec';
    this.timer = setInterval(() => this.render(), 250);
    this.auto = setTimeout(() => this.stop(), REC_MAX * 1000);
    this.render();
  },
  stop() {
    if (this.state !== 'rec') return;
    this.lastSecs = (performance.now() - this.startAt) / 1000;
    if (S) S.recSecs += this.lastSecs;                                // only the length goes to the teacher
    clearInterval(this.timer); clearTimeout(this.auto);
    this.state = 'saving';
    try { this.mr.stop(); } catch (e) { this.state = 'idle'; }
    if (this.stream) this.stream.getTracks().forEach(t => t.stop());  // iOS: release the mic so sound returns to the speaker
    this.stream = null;
    this.render();
  },
  play() {
    if (!this.url) return;
    Speech.stop(); this.stopPlay();
    const a = new Audio(this.url); this.player = a;
    a.onended = a.onerror = () => { if (this.player === a) this.player = null; this.render(); };
    a.play().catch(() => { this.player = null; this.render(); });
    this.render();
  },
  stopPlay() { if (this.player) { try { this.player.pause(); } catch (e) {} this.player = null; } },
  clearClip() { if (this.url) { URL.revokeObjectURL(this.url); this.url = null; } },
  reset() {                       // a new card: the old recording is forgotten
    if (this.state === 'rec') this.stop();
    this.stopPlay(); this.clearClip();
    this.mr = null;
    this.state = 'idle';
    this.render();
  },
  render() {
    const bar = $('#recBar'), btn = $('#recBtn'), play = $('#playBtn'), lbl = $('#recLabel');
    if (!bar) return;
    bar.hidden = !this.ok || this.off;
    btn.classList.toggle('on', this.state === 'rec');
    btn.querySelector('use').setAttribute('href', this.state === 'rec' ? '#i-stop' : '#i-mic');
    if (this.state === 'rec') {
      const s = Math.floor((performance.now() - this.startAt) / 1000);
      lbl.textContent = `Stop ${Math.floor(s / 60)}:${pad(s % 60)}`;
      btn.setAttribute('aria-label', 'Stop recording');
    } else {
      lbl.textContent = this.state === 'asking' ? 'Starting' : this.url ? 'Record again' : 'Record';
      btn.setAttribute('aria-label', this.url ? 'Record again' : 'Record my answer');
    }
    play.hidden = !this.url;
    play.classList.toggle('on', !!this.player);
  }
};

/* ---------- screens ---------- */
const SCREENS = ['welcome', 'about', 'startlvl', 'home', 'levels', 'session', 'done', 'settings', 'recs'];
let screen = '';
function show(name) {
  SCREENS.forEach(s => { $('#' + s).hidden = s !== name; });
  if (screen !== name) { const el = $('#' + name); if (el) el.scrollTop = 0; }
  screen = name;
  document.body.dataset.screen = name;
  if ((name === 'home' || name === 'done') && reloadForUpdate.pending) setTimeout(reloadForUpdate, 300);
}
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, 3200);
}
function applySize() { document.documentElement.dataset.size = st.settings.size; }

/* ---------- first launch ---------- */
function showSetup() {
  if (st.setup === 'about') return showAbout();
  if (st.setup === 'start') {
    $('#startHi').textContent = st.me.first ? `${st.me.first}, where would you like to start?` : 'Where would you like to start?';
    return show('startlvl');
  }
  show('welcome');
}
let classList = null;      // classes from the teacher's Sheet, this visit
function fillClassSelect(sel, current, withSolo) {
  sel.textContent = '';
  const add = (v, t) => { const o = document.createElement('option'); o.value = v; o.textContent = t; sel.append(o); };
  if (!withSolo) add('', 'Choose your class');
  (classList || []).forEach(c => add(c.name, c.name));
  if (withSolo) add('__solo', 'On my own (nothing is sent)');
  if (current && (classList || []).some(c => c.name === current)) sel.value = current;
  else if (withSolo && (!current || st.me.solo)) sel.value = '__solo';
}
async function showAbout() {
  $('#fFirst').value = st.me.first; $('#fFamily').value = st.me.family;
  $('#aboutError').textContent = '';
  show('about');
  const field = $('#classField'), sel = $('#fClass'), note = $('#classNote');
  if (!CONFIG.apiUrl) { field.hidden = true; $('#aboutBtn').hidden = true; return; }
  field.hidden = false; $('#aboutBtn').hidden = false;
  sel.disabled = true; sel.textContent = ''; note.textContent = 'Loading your classes';
  const list = await loadClasses();
  if (screen !== 'about') return;
  if (!list || !list.length) {
    field.hidden = true; $('#aboutBtn').hidden = true;
    note.textContent = '';
    $('#aboutError').textContent = list ? 'Your teacher has no classes open yet. You can practice on your own and add your class later in Settings.'
      : 'The class list could not load (no internet?). You can practice on your own now and add your class later in Settings.';
    return;
  }
  sel.disabled = false; note.textContent = 'Ask your teacher if you cannot find your class.';
  fillClassSelect(sel, st.me.cls, false);
}
const cleanName = v => String(v || '').replace(/\s+/g, ' ').trim().slice(0, 30);
function aboutSubmit(solo) {
  const first = cleanName($('#fFirst').value), family = cleanName($('#fFamily').value);
  const cls = solo ? '' : $('#fClass').value;
  const err = $('#aboutError');
  if (first.length < 2) { err.textContent = 'Please write your first name.'; $('#fFirst').focus(); return; }
  if (!solo) {
    if (family.length < 2) { err.textContent = 'Please write your family name, so your teacher knows who you are.'; $('#fFamily').focus(); return; }
    if (!cls) { err.textContent = 'Please choose your class.'; $('#fClass').focus(); return; }
  }
  st.me = { first, family, cls, solo, joined: false };
  st.setup = 'start'; save();
  if (!solo && !hasProgress()) {
    const btn = $('#aboutBtn'), was = btn.textContent;
    btn.disabled = true; btn.textContent = 'One moment';
    Sync.join(true).then(back => {
      btn.disabled = false; btn.textContent = was;
      if (back && st.setup === 'done') { toast(`Welcome back, ${st.me.first}! Your progress is back.`); renderHome(); }
      else if (screen === 'about') showSetup();
    });
    return;
  }
  if (!solo) Sync.join();
  showSetup();
}
function chooseStart(id) {
  st.level = id; st.setup = 'done'; save();
  renderHome();
}

/* ---------- home ---------- */
function ringSet(el, secs) {
  const r = Number(el.getAttribute('r')), C = 2 * Math.PI * r;
  el.style.strokeDasharray = `${C}`;
  el.style.strokeDashoffset = `${C * (1 - Math.min(1, secs / GOAL))}`;
}
function liveActive() { return activeToday() + (S && S.cur ? Clock.secs() : 0); }
function updateRings() {
  const secs = liveActive(), m = Math.min(10, Math.floor(secs / 60)), done = secs >= GOAL;
  ringSet($('#homeRing'), secs); ringSet($('#sessRing'), secs);
  $('#homeMins').textContent = done ? Math.floor(secs / 60) : m;
  $('#homeGoalText').textContent = done ? 'minutes today: goal reached!' : 'of 10 minutes today';
  $('#homeGoal').classList.toggle('reached', done);
  $('#miniGoal').classList.toggle('reached', done);
  $('#sessMins').textContent = m;
  $('#miniGoal').setAttribute('aria-label', `${m} of 10 minutes today`);
}
function renderHome() {
  if (st.setup !== 'done') return showSetup();
  const lv = LEVEL[st.level];
  $('#levelChip').innerHTML = `<b>${esc(lv.code)}</b> ${esc(lv.name)} <svg aria-hidden="true"><use href="#i-chev"/></svg>`;
  $('#hiName').textContent = `Hi, ${st.me.first || 'there'}`;
  const due = dueIds().length, fresh = Math.min(newCap(), newOrder().length);
  $('#startSub').textContent = due || fresh ? `${due} due · ${fresh} new` : (due >= DUE_LIMIT ? `${due} due` : 'Nothing due today. You can still practice.');
  updateRings();
  $('#starTotal').textContent = st.stars.total;
  $('#starToday').textContent = `${st.stars.total === 1 ? 'star' : 'stars'} · ${starsToday()} today`;
  const p = prizeInfo();
  $('#prizeBox').hidden = !p;
  if (p) {
    $('#prizeFill').style.width = Math.min(100, st.stars.total / p.target * 100) + '%';
    $('#prizeText').innerHTML = st.stars.total >= p.target
      ? `<b>${p.target} stars!</b> Your prize: ${esc(p.prize)}. Show your teacher.`
      : `<b>${st.stars.total} / ${p.target}</b> stars to: ${esc(p.prize)}`;
  }
  // level ladder
  $('#ladder').innerHTML = LEVELS.map(l => {
    const cls = l.id === st.level ? 'current' : st.certs[l.id] ? 'done' : levelOpen(l.id) ? 'open' : 'locked';
    return `<span class="rung ${cls}">${!levelOpen(l.id) ? '<svg aria-hidden="true"><use href="#i-lock"/></svg>' : ''}${esc(l.code)}</span>`;
  }).join('');
  // sets of the current level
  $('#setsTitle').textContent = `${lv.code} ${lv.name}`;
  $('#setsCount').textContent = lv.sets.length ? `${setsDone(lv.id)} of ${plural(lv.sets.length, 'set')} done` : '';
  $('#moreNote').hidden = !lv.more;
  const list = $('#setList'); list.textContent = '';
  if (!lv.sets.length) list.append(div('empty', 'The sets for this level are coming soon.'));
  lv.sets.forEach(sid => {
    const s = SET[sid], done = isPassed(sid), open = setOpen(s);
    const can = open && setPracticeIds(sid).length > 0;
    const b = document.createElement(can ? 'button' : 'div');
    b.className = 'set-row ' + (done ? 'done' : open ? 'current' : 'locked');
    if (can) b.dataset.set = sid;
    const status = done ? 'Done' : open ? 'Now' : '';
    b.innerHTML = `<span class="set-n">${done ? '<svg aria-hidden="true"><use href="#i-tick"/></svg>' : open ? s.idx + 1 : '<svg aria-hidden="true"><use href="#i-lock"/></svg>'}</span>
      <span class="set-t">${esc(s.title)}${can ? '<small>Tap to practice</small>' : ''}</span><span class="set-s">${status}</span>`;
    b.setAttribute('aria-label', `Set ${s.idx + 1}: ${s.title}${done ? ', done' : open ? ', now' : ', locked'}${can ? ', tap to practice' : ''}`);
    list.append(b);
  });
  renderSync();
  const standalone = (navigator.standalone === true) || (window.matchMedia && matchMedia('(display-mode: standalone)').matches);
  $('#homeTip').hidden = !(isIOS() && !standalone && !st.tipDone);
  show('home');
}

/* ---------- levels ---------- */
function renderLevels() {
  const box = $('#levelList'); box.textContent = '';
  LEVELS.forEach(l => {
    const open = levelOpen(l.id), cur = l.id === st.level, cert = st.certs[l.id];
    const c = div('lv-card' + (open ? '' : ' locked') + (cur ? ' current' : ''));
    const tag = cur ? '<span class="lv-tag cur">Current</span>' : cert ? '<span class="lv-tag ok">Done</span>' : l.optional ? '<span class="lv-tag">Optional</span>' : '';
    let html = `<div class="lv-head"><b class="lv-code">${esc(l.code)}</b><span class="lv-name">${esc(l.name)}</span>${tag}</div>`;
    if (l.cando[0]) html += `<p class="lv-cando">${esc(l.cando[0])}</p>`;
    if (l.help === 'ar-first' && l.candoAr[0]) html += `<p class="lv-cando ar" lang="ar" dir="rtl">${esc(l.candoAr[0])}</p>`;
    const meta = [];
    if (l.sets.length) meta.push(`${setsDone(l.id)} of ${plural(l.sets.length, 'set')} done`); else meta.push('Sets coming soon');
    if (l.more) meta.push('More sets coming');
    html += `<p class="lv-meta">${meta.join(' · ')}</p>`;
    if (!open) html += `<p class="lv-lock"><svg aria-hidden="true"><use href="#i-lock"/></svg>${esc(lockText(l.id))}</p>`;
    const btns = [];
    if (open && !cur) btns.push(`<button class="btn btn-soft small" data-choose="${l.id}">Study ${esc(l.code)}</button>`);
    if (cert) btns.push(`<button class="btn btn-soft small" data-cert="${l.id}"><svg aria-hidden="true"><use href="#i-award"/></svg>Certificate</button>`);
    if (btns.length) html += `<div class="lv-btns">${btns.join('')}</div>`;
    c.innerHTML = html;
    box.append(c);
  });
  show('levels');
}
function chooseLevel(id) {
  if (!levelOpen(id)) return toast(lockText(id));
  st.level = id; save();
  toast(`Now studying ${LEVEL[id].code} ${LEVEL[id].name}`);
  renderHome();
}

/* ---------- session ---------- */
let S = null;
const scheduled = mode => mode === 'normal' || mode === 'more';
let tickT = 0;
function newSession(mode, ids, warm = []) {
  S = { mode, queue: ids.slice(), all: new Set(ids), good: new Set(), again: new Set(), hint: new Set(), rated: new Set(),
        cur: null, flipped: false, seenBack: false, flipping: false, busy: false, celeb: [], frontPlan: null, backPlan: null,
        shownAt: 0, flipMs: null, warm: new Set(warm), helpNow: false, recSecs: 0,
        start: nowTs(), level: st.level, count: 0, secs: 0 };
  $('#session').classList.toggle('practice', !scheduled(mode));
  $('#starNum').textContent = starsToday();
  show('session');
  progress();
  clearInterval(tickT); tickT = setInterval(updateRings, 1000);
  nextCard();
}
// Warm-up: two learned cards that are not due, one from the newest set she has learned cards in and one older.
// Good leaves their schedule alone; Again sends the card back to be relearned.
function warmUpIds(skip) {
  const t = today();
  const pool = eligible().filter(id => {
    const c = peek(id);
    return !CARD[id].talk && c.box >= 1 && !(c.due && c.due <= t) && !skip.has(id);
  });
  if (!pool.length) return [];
  const rank = id => LEVEL[CARD[id].level].idx * 1000 + SET[CARD[id].set].idx;
  const latest = Math.max(...pool.map(rank));
  const pick = a => a[Math.floor(Math.random() * a.length)];
  const recent = pool.filter(id => rank(id) === latest), older = pool.filter(id => rank(id) < latest);
  return [pick(recent), ...(older.length ? [pick(older)] : [])];
}
function startNormal() {
  prime();
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  const begin = () => {
    const ids = buildQueue();
    if (!ids.length) return showDone(null);
    const warm = warmUpIds(new Set(ids));
    newSession('normal', [...warm, ...ids], warm);
  };
  const celeb = sweepPasses();
  const next = () => { if (!celeb.length) return begin(); showCelebration(celeb.shift(), next); };
  next();
}
function prime() { SFX.init(); primeSpeech(); unlockVoice(); }
function primeSpeech() {
  if (!hasSpeech || primeSpeech.done) return;
  primeSpeech.done = true;
  try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; u.lang = 'en-US'; speechSynthesis.speak(u); } catch (e) {}
}
function progress() {
  const p = S.all.size ? S.good.size / S.all.size : 0;
  $('#progFill').style.width = (p * 100) + '%';
}
function nextCard() {
  Speech.stop(); Rec.reset();
  if (!S) return;
  if (!S.queue.length) return endSession(false);
  S.cur = S.queue.shift();
  S.flipped = S.seenBack = S.flipping = S.busy = false;
  S.helpNow = false; S.recSecs = 0;
  renderCard(CARD[S.cur]);
  S.shownAt = performance.now(); S.flipMs = null;
  Clock.start();
}
function endSession(toHome) {
  Speech.stop(); Rec.reset(); Clock.stop();
  clearInterval(tickT);
  if (!S) return renderHome();
  const s = S; S = null;
  if (s.count > 0) Sync.queue({ t: 's', id: uuid(), start: s.start, end: nowTs(), day: today(), level: LEVEL[s.level].code,
                                mode: s.mode, cards: s.count, secs: Math.round(s.secs) });
  save();
  Sync.flush();
  if (toHome || s.mode === 'set') renderHome(); else showDone(s);
}

function iconBtn(cls, icon, label) {
  const b = document.createElement('button');
  b.className = cls; b.setAttribute('aria-label', label);
  b.innerHTML = `<svg aria-hidden="true"><use href="#${icon}"/></svg>`;
  return b;
}
function turnIcon() {
  const t = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  t.setAttribute('class', 'turn-icon'); t.setAttribute('aria-hidden', 'true'); t.innerHTML = '<use href="#i-turn"/>';
  return t;
}
function arLine(text, cls = 'arline') { const d = div(cls, text); d.lang = 'ar'; d.dir = 'rtl'; d.classList.add('ar'); return d; }
function exLine(text) {          // examples for a blank, in brackets; Arabic examples read right to left
  const d = div('ex', `(${text})`); d.dir = 'auto';
  if (ARABIC.test(text)) { d.lang = 'ar'; d.classList.add('ar'); }
  return d;
}
const speakCue = (c, lv) => !ARABIC.test(c.cue) && (lv.help === 'en-help' || lv.help === 'none');   // B1 and above

function renderCard(c) {
  const card = $('#card'), front = $('#front'), back = $('#back');
  card.classList.add('no-anim'); card.classList.remove('flipped');
  void card.offsetWidth; card.classList.remove('no-anim');
  front.textContent = ''; back.textContent = '';
  const lv = LEVEL[c.level];
  card.dataset.kind = c.kind === 'ask' ? 'ask' : c.talk ? 'talk' : 'ans';
  const warm = S.warm.has(c.id);

  // front
  const label = div('label' + (c.kind === 'ask' ? ' ask' : c.talk ? ' talk' : warm ? ' warm' : ''));
  label.textContent = c.kind === 'ask' ? 'اسألي السؤال' : c.talk ? 'Talk time!' : warm ? 'Remember?' : 'Answer!';
  if (c.kind === 'ask') { label.lang = 'ar'; label.dir = 'rtl'; label.classList.add('ar'); }
  const fArea = div('text-area'), fTxt = div('txt'); fArea.append(fTxt);
  const plan = [];
  if (c.kind === 'ask') {
    if (ARABIC.test(c.cue)) fTxt.append(arLine(c.cue, 'cue ar-cue'));
    else { const cue = div('cue'); fTxt.append(cue); const p = renderText(cue, c.cue, true); if (speakCue(c, lv) && p) plan.push(...p); }
  } else {
    const q = div('q'); fTxt.append(q);
    plan.push(...(renderText(q, c.q, true) || []));
    if (c.steps.length) {         // talk card: one numbered line per step, never joined
      const ol = document.createElement('ol'); ol.className = 'steps';
      c.steps.forEach(step => {
        const li = document.createElement('li'), t = div('step'); li.append(t); ol.append(li);
        const p = renderText(t, step, true);
        if (p && p.length) plan.push({ pause: 450 }, ...p);
      });
      fTxt.append(ol);
    }
  }
  S.frontPlan = plan.length ? plan : null;
  const fFoot = div('foot');
  if (S.frontPlan) {
    const sp = iconBtn('round speak', 'i-speaker', 'Listen again');
    sp.addEventListener('click', e => { e.stopPropagation(); prime(); Speech.play(S.frontPlan, 0, fTxt); });
    fFoot.append(sp);
  } else fFoot.append(div('spacer'));
  // Help: the Arabic line, only when she taps مساعدة (Pre-A1 to A2; Dr. Asma, 8 Oct 2026: "clean" cards);
  // a simpler English version at B1 ("Help"); none from B2. At Pre-A1 and A1 the Arabic does not count as help.
  let help = null;
  if (c.kind === 'ans') {
    if ((lv.help === 'ar-first' || lv.help === 'ar-help') && c.ar) help = { text: c.ar, ar: true, free: lv.help === 'ar-first' };
    else if (lv.help === 'en-help' && c.simple) help = { text: c.simple, ar: false };
  }
  if (help) {
    const hb = document.createElement('button');
    hb.className = 'help-btn';
    if (help.ar) { hb.lang = 'ar'; hb.dir = 'rtl'; hb.textContent = 'مساعدة'; } else hb.textContent = 'Help';
    hb.addEventListener('click', e => {
      e.stopPropagation();
      let h;
      if (help.ar) h = arLine(help.text, 'help-line');
      else {
        h = div('help-line simple');
        const p = renderText(h, help.text, true);
        if (p && p.length) setTimeout(() => { if (S && S.cur === c.id && !S.flipped) Speech.play(p, 0, h); }, 50);
      }
      fArea.append(h);
      hb.classList.add('used'); hb.disabled = true;
      S.helpNow = true;
      if (scheduled(S.mode) && !help.free) { S.hint.add(c.id); const r = cardRec(c.id); r.hints = (r.hints || 0) + 1; save(); }
      fit(front);
      h.scrollIntoView({ block: 'nearest' });
    });
    fFoot.append(hb);
  }
  fFoot.append(turnIcon());
  front.append(label, fArea, fFoot);

  // back
  const bLabel = div('label back-label', c.kind === 'ask' ? 'The question' : c.a.length > 1 ? 'Two ways to answer' : 'Model answer');
  const bArea = div('text-area'), bTxt = div('txt'); bArea.append(bTxt);
  const bplan = [];
  if (c.kind === 'ask') {
    const q = div('ans'), t = div('ans-text'); q.append(t); bTxt.append(q);
    bplan.push(...(renderText(t, c.q, true) || []));
  } else {
    c.a.forEach((ans, i) => {
      if (i > 0) { bTxt.append(div('or', 'or')); bplan.push({ pause: 650 }); }
      const multi = Array.isArray(ans), lines = multi ? ans : [ans];
      const box = div('ans' + (multi ? ' talk-ans' : ''));
      if (multi) {                // a spoken paragraph: one sentence after another, not numbered
        const para = div('para'), exs = [];
        lines.forEach((ln, j) => {
          const t = document.createElement('span'); t.className = 'sent';
          para.append(t); if (j < lines.length - 1) para.append(' ');
          if (j > 0) bplan.push({ pause: 350 });
          bplan.push(...(renderText(t, ln, true) || []));
          const ex = Array.isArray(c.ex) ? c.ex[j] : (String(ln).includes('___') ? c.ex : '');
          if (ex) exs.push(ex);
        });
        box.append(para); exs.forEach(x => box.append(exLine(x)));
        bTxt.append(box);
        return;
      }
      lines.forEach((ln, j) => {
        const row = div('ans-line'), t = div('ans-text');
        if (multi) row.append(div('n', String(j + 1)));
        row.append(t); box.append(row);
        if (j > 0) bplan.push({ pause: 450 });
        bplan.push(...(renderText(t, ln, true) || []));
        // examples: a string goes under each line with a blank; an array lines up with the answer lines
        const ex = Array.isArray(c.ex) ? (multi ? c.ex[j] : c.ex[i]) : (String(ln).includes('___') ? c.ex : '');
        if (ex) box.append(exLine(ex));
      });
      bTxt.append(box);
    });
  }
  while (bplan.length && bplan[bplan.length - 1].pause && !bplan[bplan.length - 1].el) bplan.pop();
  S.backPlan = bplan;
  if (c.kind === 'ans' && c.useful.length) {
    const u = div('useful');
    u.append(div('useful-h', 'Useful expressions'));
    const chips = div('chips');
    c.useful.forEach(x => { const s = document.createElement('span'); s.className = 'chip-u'; s.dir = 'auto'; s.textContent = x; chips.append(s); });
    u.append(chips); bArea.append(u);
  }
  const bFoot = div('foot');
  const sp2 = iconBtn('round speak', 'i-speaker', 'Listen again');
  sp2.addEventListener('click', e => { e.stopPropagation(); prime(); Speech.play(S.backPlan, 0, bTxt); });
  bFoot.append(sp2, div('spacer'));
  back.append(bLabel, bArea, bFoot);

  if (DEV) {
    const r = peek(c.id);
    front.append(div('dev-info', `${c.id} · box ${r.box} · due ${r.due || '-'}`));
  }
  [...(S.frontPlan || []), ...(S.backPlan || [])].forEach(seg => { if (seg.clip) getClip(seg.clip).catch(() => {}); });
  fit(front); fit(back);
  setActions('front');
  const wrap = $('#cardWrap');
  wrap.classList.remove('enter'); void wrap.offsetWidth; wrap.classList.add('enter');
  if (S.frontPlan) Speech.play(S.frontPlan, speechDelay(), fTxt);
}

// Biggest text size that fits the card face (the text size setting scales it).
function fit(face) {
  const area = face.querySelector('.text-area'), txt = face.querySelector('.txt');
  if (!area || !txt) return;
  area.classList.remove('scroll');
  const k = SIZES[st.settings.size] || 1;
  const wide = area.clientWidth >= 520;
  let size = Math.round((wide ? 46 : 36) * k);
  const min = Math.round(17 * k);
  txt.style.fontSize = size + 'px';
  const over = () => area.scrollHeight > area.clientHeight + 1 || area.scrollWidth > area.clientWidth + 1;
  while (over() && size > min) { size -= 2; txt.style.fontSize = size + 'px'; }
  if (over()) area.classList.add('scroll');
}
function setActions(side) {
  $('#flipBtn').hidden = side !== 'front';
  $('#rateRow').hidden = side !== 'back';
}
function flip() {
  if (!S || S.busy || S.flipping) return;
  S.flipping = true;
  if (Rec.state === 'rec') Rec.stop();      // she keeps her recording to compare with the model
  Speech.stop();
  SFX.flip();
  const toBack = !S.flipped; S.flipped = toBack;
  if (toBack && S.flipMs == null) S.flipMs = Math.round(performance.now() - S.shownAt);
  $('#card').classList.toggle('flipped', toBack);
  const dur = reduced() ? 220 : 600;
  if (!reduced()) liftAnim();
  setActions('none');
  setTimeout(() => { if (!S) return; S.flipping = false; setActions(toBack ? 'back' : 'front'); }, dur + 20);
  if (toBack && !S.seenBack) { S.seenBack = true; Speech.play(S.backPlan, speechDelay(dur + 40), $('#back .txt')); }
}
function liftAnim() {
  const ease = { duration: 600, easing: 'ease-in-out' };
  try {
    $('#cardLift').animate([{ transform: 'none' }, { transform: 'translateY(-12px) scale(1.03)' }, { transform: 'none' }], ease);
    $('#cardShadow').animate([
      { transform: 'translate(0, 12px) scale(1)', opacity: 1 },
      { transform: 'translate(18px, 30px) scale(.66, .94)', opacity: .5 },
      { transform: 'translate(0, 12px) scale(1)', opacity: 1 }
    ], ease);
  } catch (e) {}
}

function rate(good) {
  if (!S || S.busy || S.flipping || !S.flipped) return;
  S.busy = true;
  Speech.stop();
  if (Rec.state === 'rec') Rec.stop();
  const id = S.cur, c = CARD[id];
  const isNew = peek(id).box === 0;
  const first = !S.rated.has(id);
  const warm = S.mode === 'normal' && S.warm.has(id);
  const secs = Math.round(Clock.stop());
  S.rated.add(id); S.count++; S.secs += secs;
  addActive(secs); markDay(); st.lastTs = nowTs();
  Sync.queue({ t: 'r', id: uuid(), ts: nowTs(), day: today(), level: LEVEL[c.level].code, set: c.set, card: id, kind: kindOf(c),
               mode: warm ? 'warm' : S.mode, first, good, help: S.helpNow, new: isNew && scheduled(S.mode) && !warm,
               secs, rec: Math.round(S.recSecs), flip: S.flipMs == null ? 0 : S.flipMs });
  if (good) {
    SFX.good();
    if (scheduled(S.mode)) { if (warm) addStar(); else applyGood(id); flyStar(); }
    else { sparkle(); SFX.star(0.3); }
    S.good.add(id);
  } else {
    SFX.again();
    if (scheduled(S.mode)) applyAgain(id);
    S.again.add(id);
    S.queue.splice(Math.min(3, S.queue.length), 0, id);   // back after 3 other cards
  }
  checkGoal();
  save();
  progress(); updateRings();
  const celebrate = S.celeb.length > 0;
  setTimeout(() => {
    if (!S) return;
    if (celebrate) runCelebrations(nextCard); else nextCard();
  }, celebrate ? STAR_FLIGHT + 260 : 380);
}

function flyStar() {
  const from = $('#goodBtn .ic-tick').getBoundingClientRect(), to = $('#starCount .star').getBoundingClientRect();
  const done = () => { $('#starNum').textContent = starsToday(); const sc = $('#starCount'); sc.classList.remove('bump'); void sc.offsetWidth; sc.classList.add('bump'); };
  SFX.star(STAR_FLIGHT / 1000);
  if (reduced()) { setTimeout(done, STAR_FLIGHT); return; }
  const x0 = from.left + from.width / 2, y0 = from.top + from.height / 2;
  const x1 = to.left + to.width / 2, y1 = to.top + to.height / 2;
  const s = document.createElement('div'); s.className = 'fly-star';
  s.innerHTML = '<svg class="star" viewBox="0 0 24 24"><use href="#i-star"/></svg>';
  document.body.append(s);
  const a = s.animate([
    { transform: `translate(${x0}px, ${y0}px) scale(1)` },
    { transform: `translate(${(x0 + x1) / 2 - 40}px, ${Math.min(y0, y1) + (y0 - y1) * 0.25}px) scale(1.5)`, offset: 0.45 },
    { transform: `translate(${x1}px, ${y1}px) scale(.7)` }
  ], { duration: STAR_FLIGHT, easing: 'ease-in' });
  a.onfinish = () => { s.remove(); done(); };
}
function sparkle() {
  if (reduced()) return;
  const r = $('#goodBtn').getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
  for (let i = 0; i < 8; i++) {
    const s = document.createElement('div'); s.className = 'spark';
    s.innerHTML = '<svg class="star" viewBox="0 0 24 24"><use href="#i-star"/></svg>';
    document.body.append(s);
    const ang = i / 8 * Math.PI * 2, d = 70 + (i % 2) * 24;
    s.animate([
      { transform: `translate(${x}px, ${y}px) scale(.4)`, opacity: 1 },
      { transform: `translate(${x + Math.cos(ang) * d}px, ${y + Math.sin(ang) * d}px) scale(1)`, opacity: 0 }
    ], { duration: 520, easing: 'ease-out' }).onfinish = () => s.remove();
  }
}
function goalBanner() {
  const b = $('#goalBanner');
  b.hidden = false; b.classList.remove('show'); void b.offsetWidth; b.classList.add('show');
  SFX.unlock();
  $('#starNum').textContent = starsToday();
  clearTimeout(goalBanner.t); goalBanner.t = setTimeout(() => { b.hidden = true; }, 3400);
}

/* ---------- celebrations ---------- */
function runCelebrations(then) {
  if (!S || !S.celeb.length) return then();
  const c = S.celeb.shift();
  showCelebration(c, () => runCelebrations(then));
}
function showCelebration(c, then) {
  Speech.stop();
  if (c.type === 'cert') return showCertificate(c.level, then);
  const ov = $('#celebrate'), badge = $('#celBadge'), btn = $('#celBtn');
  badge.className = 'cel-badge';
  $('#celSub').textContent = '';
  let after = null;
  if (c.type === 'set') {
    const s = SET[c.set];
    badge.textContent = s.idx + 1;
    $('#celKicker').textContent = 'New set!';
    $('#celTitle').textContent = s.title;
    $('#celSub').textContent = `${LEVEL[s.level].code} · Set ${s.idx + 1} of ${LEVEL[s.level].sets.length}. Its cards start next time.`;
    btn.textContent = "Let's go!";
  } else if (c.type === 'level' || c.type === 'next') {
    const l = LEVEL[c.level];
    badge.classList.add('code'); badge.textContent = l.code;
    $('#celKicker').textContent = c.type === 'level' ? 'New level!' : 'Next level';
    $('#celTitle').textContent = c.type === 'level' ? `Level ${l.code} is open!` : `On to ${l.code}!`;
    $('#celSub').textContent = l.name;
    btn.textContent = "Let's go!";
    after = () => { st.level = l.id; save(); };
  } else {
    badge.classList.add('gift');
    badge.innerHTML = '<svg class="star" viewBox="0 0 24 24"><use href="#i-star"/></svg>';
    $('#celKicker').textContent = `${c.target} stars!`;
    $('#celTitle').textContent = c.prize;
    $('#celSub').textContent = 'Show your teacher to get your prize.';
    btn.textContent = 'Yay!';
  }
  ov.hidden = false;
  badge.style.animation = 'none'; void badge.offsetWidth; badge.style.animation = '';
  if (c.type === 'prize') { SFX.good(); SFX.star(0.75); } else { SFX.unlock(); }
  confetti();
  btn.disabled = true;
  setTimeout(() => { btn.disabled = false; }, 900);
  btn.onclick = () => { ov.hidden = true; stopConfetti(); if (after) after(); then(); };
}
let confettiRun = 0;
function stopConfetti() { confettiRun++; const cv = $('#confetti'); cv.getContext('2d').clearRect(0, 0, cv.width, cv.height); }
function confetti() {
  if (reduced()) return;
  const run = ++confettiRun;
  const cv = $('#confetti'), ctx = cv.getContext('2d'), dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = innerWidth, H = innerHeight;
  cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const cols = ['#B25B3C', '#2F9E5E', '#E7B04A', '#E9C8B5', '#2B2724'];
  const P = Array.from({ length: 130 }, (_, i) => {
    const left = i % 2 === 0;
    return { x: left ? W * 0.1 : W * 0.9, y: H * 0.85, vx: (left ? 1 : -1) * (3 + Math.random() * 8), vy: -(11 + Math.random() * 11),
             r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.35, w: 8 + Math.random() * 7, h: 5 + Math.random() * 5,
             c: cols[i % cols.length], round: Math.random() < 0.3 };
  });
  const t0 = performance.now();
  const frame = now => {
    if (run !== confettiRun) return;
    const t = now - t0;
    ctx.clearRect(0, 0, W, H);
    ctx.globalAlpha = t > 2600 ? Math.max(0, 1 - (t - 2600) / 700) : 1;
    P.forEach(p => {
      p.vy += 0.38; p.vx *= 0.985; p.x += p.vx; p.y += p.vy; p.r += p.vr;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c;
      if (p.round) { ctx.beginPath(); ctx.arc(0, 0, p.h * 0.7, 0, Math.PI * 2); ctx.fill(); }
      else ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.r * 1.7)) + 1);
      ctx.restore();
    });
    if (t < 3300) requestAnimationFrame(frame); else ctx.clearRect(0, 0, W, H);
  };
  requestAnimationFrame(frame);
}

/* ---------- star certificate (a PNG drawn on a canvas) ---------- */
const STAR_PATH = 'M12 2.8l2.75 5.6 6.15.9-4.45 4.35 1.05 6.1L12 16.85 6.5 19.75l1.05-6.1L3.1 9.3l6.15-.9z';
function roundRect(x, a, b, w, h, r) { x.beginPath(); x.moveTo(a + r, b); x.arcTo(a + w, b, a + w, b + h, r); x.arcTo(a + w, b + h, a, b + h, r); x.arcTo(a, b + h, a, b, r); x.arcTo(a, b, a + w, b, r); x.closePath(); }
async function drawCertificate(levelId) {
  const lv = LEVEL[levelId], cert = st.certs[levelId] || { date: today(), stars: st.stars.total };
  try {
    await Promise.all(['700 40px "Atkinson Hyperlegible"', '400 40px "Atkinson Hyperlegible"', '700 40px "Noto Naskh Arabic"']
      .map(f => document.fonts.load(f, f.includes('Naskh') ? 'ب' : 'A')));
  } catch (e) {}
  const W = 1600, H = 1130, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const x = cv.getContext('2d');
  const EN = '"Atkinson Hyperlegible", "Noto Naskh Arabic", sans-serif';
  x.fillStyle = '#FAF7F2'; x.fillRect(0, 0, W, H);
  x.strokeStyle = '#B25B3C'; x.lineWidth = 12; roundRect(x, 44, 44, W - 88, H - 88, 40); x.stroke();
  x.strokeStyle = '#E7DFD5'; x.lineWidth = 3; roundRect(x, 78, 78, W - 156, H - 156, 26); x.stroke();
  x.textAlign = 'center'; x.textBaseline = 'alphabetic';
  x.fillStyle = '#B25B3C'; x.font = `700 34px ${EN}`;
  try { x.letterSpacing = '6px'; } catch (e) {}
  x.fillText('TALK CARDS', W / 2, 180);
  try { x.letterSpacing = '0px'; } catch (e) {}
  x.fillStyle = '#2B2724'; x.font = `700 96px ${EN}`; x.fillText('Star Certificate', W / 2, 300);
  x.fillStyle = '#6E655D'; x.font = `400 40px ${EN}`; x.fillText('This certificate is awarded to', W / 2, 390);
  const name = `${st.me.first} ${st.me.family}`.trim() || 'A Talk Cards student';
  let fs = 92;
  x.font = `700 ${fs}px ${EN}`;
  while (x.measureText(name).width > W - 360 && fs > 40) { fs -= 4; x.font = `700 ${fs}px ${EN}`; }
  x.direction = ARABIC.test(name) ? 'rtl' : 'ltr';
  x.fillStyle = '#2B2724'; x.fillText(name, W / 2, 510);
  x.direction = 'ltr';
  x.strokeStyle = '#E7DFD5'; x.lineWidth = 3; x.beginPath(); x.moveTo(W / 2 - 420, 548); x.lineTo(W / 2 + 420, 548); x.stroke();
  x.fillStyle = '#6E655D'; x.font = `400 40px ${EN}`; x.fillText('for completing', W / 2, 625);
  x.fillStyle = '#B25B3C'; x.font = `700 72px ${EN}`; x.fillText(`Level ${lv.code} · ${lv.name}`, W / 2, 720);
  // stars
  const label = `${cert.stars} ${cert.stars === 1 ? 'star' : 'stars'}`;
  x.font = `700 52px ${EN}`;
  const tw = x.measureText(label).width, sx = W / 2 - (tw + 76) / 2;
  x.save(); x.translate(sx, 772); x.scale(2.8, 2.8);
  const p = new Path2D(STAR_PATH);
  x.fillStyle = '#E7B04A'; x.fill(p); x.lineWidth = 1.2; x.strokeStyle = '#2B2724'; x.lineJoin = 'round'; x.stroke(p);
  x.restore();
  x.fillStyle = '#2B2724'; x.textAlign = 'left'; x.fillText(label, sx + 80, 827); x.textAlign = 'center';
  x.fillStyle = '#6E655D'; x.font = `400 36px ${EN}`;
  x.fillText(asDate(cert.date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }), W / 2, 905);
  x.fillStyle = '#2B2724'; x.font = `700 32px ${EN}`; x.fillText('Designed by Dr. Asma Khattala', W / 2, 1000);
  return cv;
}
let certCanvas = null, certLevel = null;
async function showCertificate(levelId, then) {
  certLevel = levelId;
  certCanvas = await drawCertificate(levelId);
  const img = $('#certImg');
  img.src = certCanvas.toDataURL('image/png');
  img.alt = `Star certificate: ${LEVEL[levelId].code} ${LEVEL[levelId].name}`;
  $('#certificate').hidden = false;
  SFX.unlock(); confetti();
  $('#certDone').onclick = () => { $('#certificate').hidden = true; stopConfetti(); if (then) then(); };
}
function isIOS() { return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); }
function certFile() {
  return new Promise(resolve => certCanvas.toBlob(b => {
    const name = `talk-cards-${LEVEL[certLevel].code.toLowerCase()}-certificate.png`;
    try { resolve(new File([b], name, { type: 'image/png' })); } catch (e) { b.name = name; resolve(b); }
  }, 'image/png'));
}
function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
async function certSave() {
  if (!certCanvas) return;
  const f = await certFile();
  if (isIOS() && navigator.canShare && navigator.canShare({ files: [f] })) { navigator.share({ files: [f] }).catch(() => {}); return; }
  download(f, f.name); toast('Certificate saved.');
}
async function certShare() {
  if (!certCanvas) return;
  const f = await certFile();
  const text = `I finished Level ${LEVEL[certLevel].code} on Talk Cards!`;
  if (navigator.canShare && navigator.canShare({ files: [f] })) {
    try { await navigator.share({ files: [f], title: SHARE_TITLE, text }); } catch (e) {}
    return;
  }
  download(f, f.name); toast('Saved. Share the picture from your files.');
}

/* ---------- done + practice rounds ---------- */
function showDone(s) {
  const mins = Math.floor(activeToday() / 60);
  const practice = s && !scheduled(s.mode);
  $('#doneTitle').textContent = practice ? 'Nice practice!' : s && s.mode === 'more' ? 'Well done!' : 'All done for today!';
  const parts = [];
  if (s && s.count) parts.push(plural(s.count, 'card'));
  parts.push(activeToday() >= GOAL ? `${mins} minutes today: goal reached!` : `${mins} of 10 minutes today`);
  $('#doneSum').textContent = parts.join(' · ');
  $('#doneStars').textContent = starsToday();
  $('#trickyBtn').hidden = !trickyIds().length;
  $('#moreBtn').hidden = !eligible().some(id => peek(id).box >= 1);
  const ex = extraIds().length;
  $('#extraBtn').hidden = !ex;
  $('#extraBtn').textContent = `Learn ${ex || EXTRA} more`;
  show('done');
}
// Practicing one set from Home: every card of it she has already learned. No schedule change, no stars.
function setPracticeIds(setId) {
  const set = SET[setId];
  return [...set.ans, ...(isPassed(setId) ? set.ask : [])].filter(id => peek(id).box >= 1);
}
function startRound(mode) {
  prime();
  const ids = mode === 'tricky' ? trickyIds() : mode === 'practice' ? moreIds() : extraIds();
  if (ids.length) newSession(mode, ids);
}
function startSetPractice(setId) { prime(); const ids = setPracticeIds(setId); if (ids.length) newSession('set', ids); }

/* ---------- tracking: an outbox on the phone, sent to the teacher's Sheet ---------- */
function readOutbox() { try { const a = JSON.parse(lsGet(KEY.outbox) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
function writeOutbox(a) { if (a.length > 5000) a = a.slice(a.length - 5000); lsSet(KEY.outbox, JSON.stringify(a)); }
async function api(body, ms = 20000) {
  if (!CONFIG.apiUrl) throw new Error('no_api');
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const t = ctl ? setTimeout(() => ctl.abort(), ms) : 0;
  try {
    const r = await fetch(CONFIG.apiUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                                           body: JSON.stringify(body), cache: 'no-store', redirect: 'follow', signal: ctl ? ctl.signal : undefined });
    if (!r.ok) throw new Error('http_' + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}
async function loadClasses() {
  if (!CONFIG.apiUrl) return null;
  try {
    const r = await api({ action: 'classes', sid: st.sid }, 12000);
    if (r && r.ok && Array.isArray(r.classes)) {
      const list = r.classes.map(c => ({ name: String(c.name || ''), target: Math.max(0, Number(c.target) || 0), prize: String(c.prize || '') })).filter(c => c.name);
      lsSet(KEY.classes, JSON.stringify({ at: Date.now(), list }));
      classList = list;
      return list;
    }
  } catch (e) {}
  return null;
}
// Her whole progress for the teacher's Sheet (not this phone's id or her name: the Sheet has those already).
function stateForSheet() {
  const { sid, me, setup, recNoted, tipDone, ...rest } = st;
  return JSON.stringify(rest);
}
const hasProgress = () => Object.keys(st.cards).length > 0 || st.stars.total > 0 || st.passed.length > 0;
// Progress stored in the Sheet comes back onto this phone (keeping this phone's id and the name she just typed).
function restoreState(text) {
  let obj;
  try { obj = JSON.parse(text); } catch (e) { return false; }
  if (!obj || typeof obj !== 'object' || !obj.cards) return false;
  st = merge({ ...obj, sid: st.sid, me: st.me, setup: 'done', recNoted: st.recNoted, tipDone: st.tipDone });
  save(); applySize();
  return true;
}
function snapshot() {
  const lv = LEVEL[st.level], cs = currentSet(st.level);
  return { first: st.me.first, family: st.me.family, cls: st.me.cls, level: lv.code, set: cs ? cs.title : '',
           setsDone: setsDone(lv.id), learned: learnedCount(), stars: st.stars.total, streak: streak(),
           levelsOpen: LEVELS.filter(l => levelOpen(l.id)).map(l => l.code).join(' '), snapTs: st.lastTs };
}
const Sync = {
  busy: false, status: '',                // '' | ok | wait | class
  canSend() { return !!CONFIG.apiUrl && !st.me.solo && !!st.me.cls; },
  queue(ev) { if (!this.canSend()) return; const box = readOutbox(); box.push(ev); writeOutbox(box); },
  // restore: this phone has no progress yet, so ask for the progress the Sheet keeps for her. True = it came back.
  async join(restore = false) {
    if (!this.canSend()) return false;
    let back = false;
    try {
      const r = await api({ action: 'join', sid: st.sid, first: st.me.first, family: st.me.family, cls: st.me.cls, restore: !!restore });
      if (r && r.ok) {
        st.me.joined = true; save(); if (this.status === 'class') this.status = '';
        if (restore && r.state) back = restoreState(r.state);
      } else if (r && r.error === 'bad_class') this.status = 'class';
    } catch (e) {}
    renderSync();
    return back;
  },
  async flush() {
    if (!this.canSend() || this.busy) return renderSync();
    if (!readOutbox().length) return renderSync();
    this.busy = true; renderSync();
    try {
      for (let round = 0; round < 30; round++) {
        const box = readOutbox();
        if (!box.length) break;
        const batch = box.slice(0, BATCH);
        const r = await api({ action: 'log', sid: st.sid, ...snapshot(), state: stateForSheet(), events: batch });
        if (!r || !r.ok) { this.status = r && r.error === 'bad_class' ? 'class' : 'wait'; break; }
        const gone = new Set([...(r.saved || []), ...(r.rejected || [])]);
        writeOutbox(readOutbox().filter(e => !gone.has(e.id)));   // removed only after the server confirms them
        this.status = 'ok';
        if (!batch.some(e => gone.has(e.id))) { this.status = 'wait'; break; }
      }
    } catch (e) { this.status = 'wait'; }
    this.busy = false;
    renderSync();
  }
};
function renderSync() {
  const el = $('#syncLine'); if (!el) return;
  const box = readOutbox(), n = box.length, answers = box.filter(e => e.t === 'r').length;
  el.className = 'sync';
  if (!CONFIG.apiUrl || st.me.solo || !st.me.cls) { el.textContent = 'Practicing on my own: nothing is sent.'; return; }
  if (Sync.busy) { el.textContent = 'Sending to your teacher'; return; }
  if (Sync.status === 'class') { el.textContent = 'Your class is not on your teacher\'s list. Check it in Settings.'; el.classList.add('warn'); return; }
  if (n) { el.textContent = answers ? `Waiting for internet (${plural(answers, 'answer')} to send)` : 'Waiting for internet'; el.classList.add('wait'); return; }
  el.textContent = `${st.me.cls} · Sent to your teacher ✓`; el.classList.add('ok');
}

/* ---------- share ---------- */
async function shareApp() {
  if (navigator.share) {
    try { await navigator.share({ title: SHARE_TITLE, text: SHARE_TEXT, url: CONFIG.appUrl }); return; }
    catch (e) { if (e && e.name === 'AbortError') return; }
  }
  try { await navigator.clipboard.writeText(CONFIG.appUrl); toast('Link copied'); return; } catch (e) {}
  try {
    const ta = document.createElement('textarea'); ta.value = CONFIG.appUrl; ta.setAttribute('readonly', '');
    ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.append(ta); ta.select();
    const ok = document.execCommand('copy'); ta.remove();
    toast(ok ? 'Link copied' : CONFIG.appUrl);
  } catch (e) { toast(CONFIG.appUrl); }
}

/* ---------- settings ---------- */
function seg(name, opts, cur) {
  return `<div class="seg" role="group">${opts.map(([v, t]) => `<button data-${name}="${v}" aria-pressed="${cur === v}">${t}</button>`).join('')}</div>`;
}
function voiceNote() {
  const d = deckVoice(), n = d && d.clips ? Object.keys(d.clips).length : 0;
  if (!n) return 'Device voice (recordings not added yet)';
  return d.placeholder ? `Placeholder recordings (${n} lines)` : `${esc(d.voice || 'Recorded')} voice (${n} lines; any others use the device voice)`;
}
function renderSettings() {
  const s = st.settings;
  const online = !!CONFIG.apiUrl;
  $('#settings').innerHTML = `<div class="wrap">
    <div class="head-row"><button class="icon-btn back-btn" data-act="close" aria-label="Home"><svg aria-hidden="true"><use href="#i-close"/></svg></button><h1 class="title">Settings</h1></div>
    <p class="p-sum">${learnedCount()} cards learned · ${dueIds().length} due today · ${plural(streak(), 'day')} in a row${DEV ? ` · dev date ${today()}` : ''}</p>
    <div class="p-group">
      <div class="p-row col"><label for="sFirst">First name</label><input id="sFirst" class="input" maxlength="30" value="${esc(st.me.first)}" autocomplete="given-name"></div>
      <div class="p-row col"><label for="sFamily">Family name</label><input id="sFamily" class="input" maxlength="30" value="${esc(st.me.family)}" autocomplete="family-name"></div>
      <div class="p-row col"><label for="sClass">Class</label>
        ${online ? '<select id="sClass" class="input"><option>Loading</option></select>' : '<p class="sub">Practicing on my own (no class list yet)</p>'}</div>
      <div class="p-row"><span class="sub">Your name, class and practice numbers go to your teacher. Your recordings stay on this phone and are never sent.</span>
        <button class="p-btn primary" data-act="details">Save details</button></div>
    </div>
    <div class="p-group">
      <div class="p-row"><span>Voice<span class="sub">${voiceNote()}</span></span></div>
      <div class="p-row"><span>Voice speed</span>${seg('speed', [['slow', 'Slow'], ['standard', 'Standard'], ['normal', 'Normal']], s.speed)}</div>
      <div class="p-row"><span></span><button class="p-btn" data-act="test">Test voice</button></div>
      <div class="p-row"><span>Sound effects</span><button class="switch" role="switch" aria-checked="${s.sfx}" data-act="sfx" aria-label="Sound effects"></button></div>
    </div>
    <div class="p-group">
      <div class="p-row"><span>Text size</span>${seg('size', [['S', 'S'], ['M', 'M'], ['L', 'L']], s.size)}</div>
      <div class="p-row"><span>New cards a day<span class="sub">At most 4, and none on a day with 30 or more cards due</span></span>
        <div class="step"><button class="p-btn" data-step="-1" aria-label="Fewer">−</button><output id="sNew">${s.newPerDay}</output><button class="p-btn" data-step="1" aria-label="More">+</button></div></div>
    </div>
    <div class="p-group">
      <div class="p-row"><span>My recordings<span class="sub">Your answers, kept on this phone only (the newest ${REC_KEEP})</span></span>
        <button class="p-btn" data-act="recs">Open</button></div>
    </div>
    <div class="p-group">
      <div class="p-row"><span>Your progress<span class="sub">Your progress saves itself after every card. Keep a copy in a file, or move it to a new phone.</span></span></div>
      <div class="p-row"><div class="btns">
        <button class="p-btn" data-act="backup">Save progress to a file</button>
        <button class="p-btn" data-act="restore">Restore from a file</button>
      </div></div>
    </div>
    <div class="p-group">
      <div class="p-row"><button class="p-btn danger" data-act="reset">Reset all my progress</button></div>
    </div>
    <input id="sFile" type="file" accept=".json,application/json" hidden>
  </div>`;
  show('settings');
  if (online) {
    const fill = () => { const sel = $('#sClass'); if (sel) fillClassSelect(sel, st.me.cls, true); };
    if (!classList) classList = cachedClasses().length ? cachedClasses() : null;
    fill();
    loadClasses().then(l => { if (l && screen === 'settings') fill(); });
  }
}
function onSettingsClick(e) {
  const b = e.target.closest('button'); if (!b) return;
  const s = st.settings;
  if (b.dataset.speed) { s.speed = b.dataset.speed; save(); b.parentElement.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b))); return; }
  if (b.dataset.size) { s.size = b.dataset.size; save(); applySize(); b.parentElement.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b))); return; }
  if (b.dataset.step) { s.newPerDay = Math.min(NEW_MAX, Math.max(1, s.newPerDay + Number(b.dataset.step))); save(); $('#sNew').textContent = s.newPerDay; return; }
  switch (b.dataset.act) {
    case 'close': renderHome(); break;
    case 'test': { prime(); const el = div(''); Speech.play(renderText(el, "Hi! What's your name?", true)); break; }
    case 'sfx': s.sfx = !s.sfx; save(); b.setAttribute('aria-checked', String(s.sfx)); if (s.sfx) { SFX.init(); SFX.good(); } break;
    case 'details': saveDetails(); break;
    case 'backup': backup(); break;
    case 'recs': renderRecs(); break;
    case 'restore': $('#sFile').click(); break;
    case 'reset':
      if (confirm('Reset all your progress? Your cards, stars and levels on this phone will be deleted.') && confirm('Are you sure? This cannot be undone.')) {
        [KEY.state, KEY.outbox, KEY.classes].forEach(lsDel);
        load(); applySize(); toast('Progress has been reset.'); renderHome();
      }
      break;
  }
}
function saveDetails() {
  const first = cleanName($('#sFirst').value), family = cleanName($('#sFamily').value);
  const sel = $('#sClass');
  const v = sel ? sel.value : '__solo';
  const solo = !sel || v === '__solo' || !v || v === 'Loading';
  if (first.length < 2) return toast('Please write your first name.');
  if (!solo && family.length < 2) return toast('Please write your family name.');
  const changed = first !== st.me.first || family !== st.me.family || (solo ? '' : v) !== st.me.cls || solo !== st.me.solo;
  st.me = { first, family, cls: solo ? '' : v, solo, joined: changed ? false : st.me.joined };
  save();
  if (!solo) {
    Sync.status = '';
    const fresh = !hasProgress();
    Sync.join(fresh).then(back => { if (back) { toast(`Welcome back, ${st.me.first}! Your progress is back.`); renderHome(); } else Sync.flush(); });
  }
  toast(solo ? 'Saved. Practicing on your own: nothing is sent.' : `Saved. Class: ${v}`);
}
function backup() {
  save();
  const data = JSON.stringify({ app: 'epp-talk-cards', v: 1, saved: new Date().toISOString(), state: st, outbox: readOutbox() });
  const name = `talk-cards-backup-${today()}.json`;
  let file = null;
  try { file = new File([data], name, { type: 'application/json' }); } catch (e) {}
  if (file && isIOS() && navigator.canShare && navigator.canShare({ files: [file] })) { navigator.share({ files: [file] }).catch(() => {}); return; }
  download(file || new Blob([data], { type: 'application/json' }), name);
  toast('Progress saved to a file.');
}
async function restore(file) {
  try {
    const obj = JSON.parse(await file.text());
    if (!obj || obj.app !== 'epp-talk-cards' || !obj.state || typeof obj.state.cards !== 'object') throw new Error('bad');
    if (!confirm('Replace the progress on this phone with this file?')) return;
    st = merge(obj.state); st.setup = 'done'; save(); applySize();
    if (Array.isArray(obj.outbox)) {
      const have = new Set(readOutbox().map(e => e.id));
      writeOutbox([...readOutbox(), ...obj.outbox.filter(e => e && e.id && !have.has(e.id))]);
    }
    toast('Progress restored.'); renderSettings(); Sync.flush();
  } catch (e) { toast('That file is not a Talk Cards progress file.'); }
}

/* ---------- My recordings: her own answers, newest first, kept on this phone ---------- */
let recPlayer = null, recUrl = null;
function stopRecPlay() {
  if (recPlayer) { try { recPlayer.pause(); } catch (e) {} recPlayer = null; }
  if (recUrl) { URL.revokeObjectURL(recUrl); recUrl = null; }
  document.querySelectorAll('#recs .rec-play.on').forEach(b => b.classList.remove('on'));
}
async function renderRecs() {
  Speech.stop(); stopRecPlay();
  const box = $('#recList');
  box.innerHTML = '<p class="empty">Loading</p>';
  show('recs');
  let all = [];
  try { all = await RecStore.all(); }
  catch (e) { box.innerHTML = '<p class="empty">This browser cannot keep recordings.</p>'; $('#recClear').hidden = true; return; }
  $('#recClear').hidden = !all.length;
  if (!all.length) { box.innerHTML = '<p class="empty">No recordings yet. Tap Record on a card, answer, then come back here to listen.</p>'; return; }
  box.textContent = '';
  let day = '';
  const nice = d => { const [y, m, dd] = d.split('-').map(Number); return new Date(y, m - 1, dd).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }); };
  all.forEach(r => {
    if (r.day !== day) { day = r.day; box.append(div('rec-day', r.day === today() ? 'Today' : nice(r.day))); }
    const row = div('rec-row'); row.dataset.id = r.id;
    const play = iconBtn('round rec-play', 'i-play', 'Play my recording'); play.dataset.play = r.id;
    const info = div('rec-info');
    const lv = LEVEL[r.level];
    info.append(div('rec-q', r.q || ''), div('rec-meta', `${lv ? lv.code : ''} · ${Math.max(1, Math.round(r.secs || 0))} s · ${new Date(r.ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`));
    const del = iconBtn('icon-btn rec-del', 'i-close', 'Delete this recording'); del.dataset.del = r.id;
    row.append(play, info, del); box.append(row);
  });
}
async function onRecsClick(e) {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.go) { stopRecPlay(); return renderHome(); }
  if (b.id === 'recClear') {
    if (confirm('Delete all your recordings on this phone?')) { stopRecPlay(); try { await RecStore.clear(); } catch (err) {} renderRecs(); }
    return;
  }
  if (b.dataset.del) { stopRecPlay(); try { await RecStore.del(b.dataset.del); } catch (err) {} return renderRecs(); }
  if (b.dataset.play) {
    const was = b.classList.contains('on');
    stopRecPlay();
    if (was) return;
    try {
      const all = await RecStore.all(), r = all.find(x => x.id === b.dataset.play); if (!r) return;
      recUrl = URL.createObjectURL(new Blob([r.data], { type: r.mime || 'audio/mp4' }));
      const a = new Audio(recUrl); recPlayer = a; b.classList.add('on');
      a.onended = a.onerror = () => { if (recPlayer === a) stopRecPlay(); };
      await a.play();
    } catch (err) { stopRecPlay(); toast('This recording cannot be played here.'); }
  }
}

/* ---------- developer mode (?dev=1) ---------- */
function renderDev() {
  const bar = $('#devbar');
  bar.hidden = false;
  document.body.classList.add('dev');
  bar.innerHTML = `<span>dev · ${today()} (+${devOffset}d)</span><button data-dev="plus">+1 day</button><button data-dev="zero">real date</button>`;
}
function onDevClick(e) {
  const b = e.target.closest('button'); if (!b) return;
  devOffset = b.dataset.dev === 'plus' ? devOffset + 1 : 0;
  lsSet(KEY.dev, String(devOffset));
  Speech.stop(); Rec.reset(); Clock.stop(); clearInterval(tickT); S = null;
  $('#celebrate').hidden = true; $('#certificate').hidden = true;
  renderDev();
  renderHome();
}
// Dev helper: mark every answer card of a set as learned without help (box 1, due tomorrow), then check it.
function devLearnSet(setId) {
  const set = SET[setId]; if (!set) return null;
  const t = today(), celeb = [];
  set.ans.forEach(id => { const c = cardRec(id); if (c.box === 0) { c.box = 1; c.due = addDays(t, 1); c.intro = c.intro || t; } c.clean = true; });
  checkPass(setId, celeb); save();
  return celeb;
}

/* ---------- wiring ---------- */
function wire() {
  $('#welcomeBtn').addEventListener('click', () => { st.setup = 'about'; save(); showSetup(); });
  $('#aboutForm').addEventListener('submit', e => { e.preventDefault(); aboutSubmit(false); });
  $('#soloBtn').addEventListener('click', () => aboutSubmit(true));
  $('#startlvl').addEventListener('click', e => { const b = e.target.closest('[data-start]'); if (b) chooseStart(b.dataset.start); });
  $('#startBtn').addEventListener('click', startNormal);
  $('#card').addEventListener('click', e => { if (!e.target.closest('button')) flip(); });
  $('#card').addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && !e.target.closest('button')) { e.preventDefault(); flip(); } });
  $('#flipBtn').addEventListener('click', flip);
  $('#againBtn').addEventListener('click', () => rate(false));
  $('#goodBtn').addEventListener('click', () => rate(true));
  $('#recBtn').addEventListener('click', () => { prime(); Rec.toggle(); });
  $('#playBtn').addEventListener('click', () => Rec.play());
  $('#quitBtn').addEventListener('click', () => endSession(true));
  $('#trickyBtn').addEventListener('click', () => startRound('tricky'));
  $('#moreBtn').addEventListener('click', () => startRound('practice'));
  $('#extraBtn').addEventListener('click', () => startRound('more'));
  $('#homeBtn').addEventListener('click', renderHome);
  $('#levelChip').addEventListener('click', renderLevels);
  $('#ladder').addEventListener('click', renderLevels);
  $('#gear').addEventListener('click', () => { Speech.stop(); renderSettings(); });
  $('#setList').addEventListener('click', e => { const b = e.target.closest('[data-set]'); if (b) startSetPractice(b.dataset.set); });
  $('#levels').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.go) renderHome();
    else if (b.dataset.choose) chooseLevel(b.dataset.choose);
    else if (b.dataset.cert) showCertificate(b.dataset.cert, null);
  });
  $('#settings').addEventListener('click', onSettingsClick);
  $('#recs').addEventListener('click', onRecsClick);
  $('#recsBtn').addEventListener('click', renderRecs);
  $('#tipClose').addEventListener('click', () => { st.tipDone = true; save(); $('#homeTip').hidden = true; });
  $('#settings').addEventListener('change', e => { if (e.target.id === 'sFile' && e.target.files[0]) { restore(e.target.files[0]); e.target.value = ''; } });
  $('#certSave').addEventListener('click', certSave);
  $('#certShare').addEventListener('click', certShare);
  $('#shareBtn').addEventListener('click', shareApp);
  $('#devbar').addEventListener('click', onDevClick);
  document.addEventListener('pointerdown', () => { if (SFX.ctx && SFX.ctx.state !== 'running') { try { SFX.ctx.resume(); } catch (e) {} } }, true);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { Speech.stop(); Clock.pause(); if (Rec.state === 'rec') Rec.stop(); }
    else { Clock.resume(); Sync.flush(); }
  });
  window.addEventListener('online', () => Sync.flush());
  window.addEventListener('pagehide', () => { Speech.stop(); save(); });
  let rt = null;
  window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { if (S) { fit($('#front')); fit($('#back')); } }, 120); });
  if (hasSpeech) { speechSynthesis.getVoices(); speechSynthesis.onvoiceschanged = () => {}; }
}

function reloadForUpdate() {
  if (!reloadForUpdate.pending) return;
  if (S || !$('#celebrate').hidden || !$('#certificate').hidden || screen === 'settings' || screen === 'about') return;
  location.reload();
}

async function boot() {
  wire();
  try {
    const index = await (await fetch('levels/index.json')).json();
    const files = {};
    await Promise.all(index.levels.map(async L => {
      try { const r = await fetch('levels/' + L.file); if (r.ok) files[L.id] = await r.json(); } catch (e) {}
    }));
    buildCatalog(index, files);
    if (!SETS.length) throw new Error('no sets');
  } catch (e) {
    document.body.innerHTML = '<p style="font:22px system-ui,sans-serif;padding:40px;text-align:center">The cards could not load. Please connect to the internet once and try again.</p>';
    return;
  }
  try { const r = await fetch('audio/voice.json'); if (r.ok) VOICE = await r.json(); } catch (e) { VOICE = null; }
  if (deckVoice()) fetch('audio/_unlock.m4a').then(r => r.blob()).then(b => { unlockUrl = URL.createObjectURL(b); }).catch(() => {});
  load(); applySize();
  if (cachedClasses().length) classList = cachedClasses();
  if (DEV) {
    renderDev();
    window.EPP = { RecStore, keepRecording, get st() { return st; }, get S() { return S; }, CARD, SET, SETS, LEVEL, LEVELS, today, buildQueue, newOrder, dueIds,
      eligible, trickyIds, extraIds, flip, rate, save, Speech, Rec, Sync, Clock, readOutbox, renderText, renderHome, sweepPasses,
      learnSet: devLearnSet, levelOpen, lockText, streak, get VOICE() { return VOICE; },
      showCard(id) {
        if (!CARD[id]) return false;
        if (!S) newSession('practice', [id]);
        else { S.queue = S.queue.filter(x => x !== id); Rec.reset(); S.cur = id; S.flipped = S.seenBack = S.flipping = S.busy = false; S.helpNow = false; S.recSecs = 0; renderCard(CARD[id]); S.shownAt = performance.now(); Clock.start(); }
        return true;
      } };
  }
  renderHome();
  updateRings();
  Sync.flush();
  if (Sync.canSend() && !st.me.joined) Sync.join();
  loadClasses().then(() => { if (screen === 'home') renderHome(); });
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || reloadForUpdate.pending) return;
      reloadForUpdate.pending = true;
      reloadForUpdate();
    });
    navigator.serviceWorker.register('sw.js').then(reg => {
      document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => {}); });
    }).catch(() => {});
  }
}
boot();
})();
