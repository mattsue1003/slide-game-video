/* 簡報遊戲影片工坊 — 畫面渲染引擎（預覽、全螢幕播放、影片匯出共用同一套） */
(function () {
'use strict';
const W = 1920, H = 1080;
const FONTS = {
  hei: '"Noto Sans TC","PingFang TC","Heiti TC","Microsoft JhengHei",sans-serif',
  kai: '"LXGW WenKai TC","Kaiti TC","BiauKai","DFKai-SB",serif',
};
let FAM = FONTS.hei;
const F = (w, s) => `${w} ${Math.round(s)}px ${FAM}`;
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const lerp = (a, b, k) => a + (b - a) * k;
const easeOut = k => 1 - Math.pow(1 - clamp(k), 3);
const easeInOut = k => { k = clamp(k); return k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2; };
const easeBack = k => { k = clamp(k); const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2); };
function rng(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

const THEMES = {
  warm:   { name: '活力橘',   bg: ['#FFF6EA', '#FFE1C0'], primary: '#F2711C', accent: '#FFB703', text: '#3B2A1A', sub: '#8A6A4F', card: '#FFFFFF', yes: '#1FA055', no: '#E5484D', deco: 'bubbles' },
  mint:   { name: '清新綠',   bg: ['#EEFAF3', '#C9EBD6'], primary: '#1E8E5A', accent: '#7FCFA0', text: '#173B2B', sub: '#4F7A65', card: '#FFFFFF', yes: '#1E9E57', no: '#E5484D', deco: 'bubbles' },
  ocean:  { name: '海洋藍',   bg: ['#EAF4FF', '#C4DEFF'], primary: '#1E6FD9', accent: '#4DBDF5', text: '#14304F', sub: '#4C6C8F', card: '#FFFFFF', yes: '#1E9E57', no: '#E5484D', deco: 'waves' },
  pastel: { name: '粉彩夢幻', bg: ['#FFF0F6', '#E6E1FF'], primary: '#C2479A', accent: '#8E7CF0', text: '#3E2348', sub: '#86648F', card: '#FFFFFF', yes: '#1E9E57', no: '#E5484D', deco: 'confetti' },
  beige:  { name: '米色溫暖', bg: ['#F7F0E5', '#E7D6BC'], primary: '#8B5E3C', accent: '#C9A27E', text: '#3E2A1C', sub: '#8A7059', card: '#FFFDF9', yes: '#4E8F4A', no: '#C2463E', deco: 'bubbles' },
  chalk:  { name: '教室黑板', bg: ['#2C5446', '#1F3D33'], primary: '#F6D86B', accent: '#9AD1C0', text: '#F7F3E8', sub: '#C7D8CF', card: '#30594A', imgCard: '#F7F3E8', yes: '#7EE08A', no: '#FF8A80', deco: 'chalk', font: 'kai', dark: true, onPrimary: '#2C2A1E' },
  night:  { name: '星空夜晚', bg: ['#1A2550', '#0B1230'], primary: '#FFB547', accent: '#7AA2FF', text: '#F4F6FF', sub: '#AEB8E0', card: '#232F63', imgCard: '#F4F6FF', yes: '#5BE38A', no: '#FF7A7A', deco: 'stars', dark: true, onPrimary: '#2A1B05' },
};

const DEFAULT_LABELS = {
  ready: '準備好了嗎？',
  matchAsk: '圖片上的是…',
  matchYes: '符合！',
  matchNo: '不符合！',
  doIt: '請做',
  oppCmd: '指令',
  oppThink: '想一想：相反動作是什麼？',
  oppAnswer: '相反動作',
  oppDo: '一起做！保持住～',
  done: '完成！',
  count: '一共完成 {n} 題',
};

const PAIRS = [['順時鐘', '逆時鐘'], ['站起來', '坐下'], ['舉高', '放下'], ['抬高', '放低'], ['張開', '閉上'], ['打開', '關上'], ['吸氣', '吐氣'],
  ['伸直', '彎曲'], ['往內', '往外'], ['握拳', '張開'], ['左', '右'], ['上', '下'], ['前', '後'], ['高', '低'], ['大', '小'], ['快', '慢'], ['進', '出']];
const SWAP = new Map();
PAIRS.forEach(([a, b]) => { SWAP.set(a, b); if (!SWAP.has(b)) SWAP.set(b, a); });
const SWAP_KEYS = [...SWAP.keys()].sort((a, b) => b.length - a.length);
function autoOpposite(s) {
  s = String(s || ''); let out = '', i = 0;
  while (i < s.length) {
    const k = SWAP_KEYS.find(k => s.startsWith(k, i));
    if (k) { out += SWAP.get(k); i += k.length; } else { out += s[i]; i++; }
  }
  return out;
}

const OPP_PRESETS = [
  { prompt: '右手舉高', answer: '左手放下，往地板延伸' },
  { prompt: '頭抬高', answer: '頭放低' },
  { prompt: '軀幹右側彎', answer: '軀幹左側彎' },
  { prompt: '眨右眼', answer: '眨左眼' },
  { prompt: '身體向右轉', answer: '身體向左轉' },
  { prompt: '雙手往前推', answer: '雙手往後拉' },
  { prompt: '張開嘴巴', answer: '閉上嘴巴' },
  { prompt: '雙手握拳', answer: '雙手張開' },
  { prompt: '頭向右轉', answer: '頭向左轉' },
  { prompt: '聳肩', answer: '肩膀往下放鬆' },
  { prompt: '吸氣', answer: '吐氣' },
  { prompt: '右腳往前踏', answer: '左腳往後踏' },
];

function theme(p) {
  const base = THEMES[p.theme] || THEMES.warm;
  return p.customColor ? { ...base, primary: p.customColor } : base;
}
function fontKey(p, T) { return p.font && p.font !== 'auto' ? p.font : (T.font || 'hei'); }
function labels(p) { return { ...DEFAULT_LABELS, ...(p.labels || {}) }; }

/* ---------- 時間軸 ---------- */
function itemsOf(p) {
  let items;
  if (p.type === 'match') items = p.match.items.map((it, k) => ({ ...it, _src: k })).filter(i => i.text && i.text.trim());
  else items = p.opposite.items.map((it, k) => ({ ...it, _src: k })).filter(i => i.prompt && i.prompt.trim())
    .map(i => ({ ...i, answer: (i.answer && i.answer.trim()) || autoOpposite(i.prompt) }));
  if (p.order === 'random') {
    const r = rng(p.seed || 1); items = items.slice();
    for (let i = items.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [items[i], items[j]] = [items[j], items[i]]; }
  }
  return items;
}
function buildTimeline(p) {
  const segs = []; let t = 0;
  const add = (type, dur, data) => { segs.push({ type, start: t, dur, end: t + dur, ...data }); t += dur; };
  const items = itemsOf(p), tm = p.timing;
  add('intro', +tm.intro);
  items.forEach((item, index) => {
    add('q', +tm.think, { item, index, total: items.length });
    add('a', +tm.answer, { item, index, total: items.length });
  });
  add('outro', +tm.outro);
  return { segs, duration: t, items };
}

/* ---------- 繪圖小工具 ---------- */
const NO_START = '，。、！？；：」』）》〉～…,.!?;:)]';
function tokenize(s) {
  const out = []; let buf = '';
  for (const ch of s) {
    if (/[A-Za-z0-9'\-]/.test(ch)) buf += ch;
    else { if (buf) { out.push(buf); buf = ''; } out.push(ch); }
  }
  if (buf) out.push(buf);
  return out;
}
function wrap(ctx, text, maxW) {
  const lines = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const tk of tokenize(para)) {
      const test = line + tk;
      if (ctx.measureText(test).width > maxW && line && !NO_START.includes(tk)) { lines.push(line.trimEnd()); line = tk === ' ' ? '' : tk; }
      else line = test;
    }
    lines.push(line);
  }
  return lines;
}
const fitCache = new Map();
function fit(ctx, text, w, h, maxS, minS = 28, weight = 900, lh = 1.22) {
  const key = FAM + '|' + text + '|' + w + '|' + h + '|' + maxS + '|' + minS + '|' + weight;
  const c = fitCache.get(key); if (c) return c;
  let res = null;
  for (let s = maxS; s >= minS; s -= 4) {
    ctx.font = F(weight, s);
    const L = wrap(ctx, text, w);
    if (L.length * s * lh <= h && L.every(l => ctx.measureText(l).width <= w)) { res = { s, L, weight, lh }; break; }
  }
  if (!res) { ctx.font = F(weight, minS); res = { s: minS, L: wrap(ctx, text, w), weight, lh }; }
  if (fitCache.size > 600) fitCache.clear();
  fitCache.set(key, res);
  return res;
}
function drawFit(ctx, f, x, cy, color, align = 'center') {
  ctx.font = F(f.weight, f.s); ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'middle';
  const lh = f.s * f.lh, y0 = cy - (f.L.length - 1) * lh / 2;
  f.L.forEach((l, i) => ctx.fillText(l, x, y0 + i * lh));
}
function text(ctx, s, x, y, font, color, align = 'center') {
  ctx.font = font; ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'middle'; ctx.fillText(s, x, y);
}
function shadowOn(ctx, T, blur = 40, off = 14) {
  ctx.shadowColor = T.dark ? 'rgba(0,0,0,.35)' : 'rgba(90,55,20,.14)'; ctx.shadowBlur = blur; ctx.shadowOffsetY = off;
}
function card(ctx, x, y, w, h, T, o = {}) {
  const r = o.r ?? 40;
  ctx.save();
  if (o.shadow !== false) shadowOn(ctx, T);
  ctx.fillStyle = o.fill || T.card; ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.fill();
  ctx.restore();
  if (o.stroke) {
    const lw = o.lw || 8;
    ctx.save(); ctx.strokeStyle = o.stroke; ctx.lineWidth = lw; ctx.beginPath(); ctx.roundRect(x + lw / 2, y + lw / 2, w - lw, h - lw, Math.max(0, r - lw / 2)); ctx.stroke(); ctx.restore();
  }
}
function pill(ctx, x, y, s, bg, fg, size, align = 'left') {
  ctx.font = F(900, size);
  const w = ctx.measureText(s).width + size * 1.4, h = size * 1.7;
  if (align === 'right') x -= w; else if (align === 'center') x -= w / 2;
  ctx.fillStyle = bg; ctx.beginPath(); ctx.roundRect(x, y - h / 2, w, h, h / 2); ctx.fill();
  text(ctx, s, x + w / 2, y + size * 0.04, F(900, size), fg);
  return w;
}
function ent(local, delay = 0, dur = 0.45) { return easeOut((local - delay) / dur); }
function withAnim(ctx, a, cx, cy, fn) {
  if (a <= 0) return;
  ctx.save(); ctx.globalAlpha *= a; ctx.translate(cx, cy); const s = 0.92 + 0.08 * a; ctx.scale(s, s); ctx.translate(-cx, -cy); fn(); ctx.restore();
}
function markO(ctx, cx, cy, r, p, color, lw) {
  if (p <= 0) return;
  ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * clamp(p)); ctx.stroke(); ctx.restore();
}
function markX(ctx, cx, cy, r, p, color, lw) {
  const d = r * 0.72, p1 = clamp(p * 2), p2 = clamp(p * 2 - 1);
  ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.lineCap = 'round';
  if (p1 > 0) { ctx.beginPath(); ctx.moveTo(cx - d, cy - d); ctx.lineTo(lerp(cx - d, cx + d, p1), lerp(cy - d, cy + d, p1)); ctx.stroke(); }
  if (p2 > 0) { ctx.beginPath(); ctx.moveTo(cx + d, cy - d); ctx.lineTo(lerp(cx + d, cx - d, p2), lerp(cy - d, cy + d, p2)); ctx.stroke(); }
  ctx.restore();
}
function ring(ctx, cx, cy, r, remain, total, T) {
  remain = Math.max(0, remain);
  const n = Math.ceil(remain - 1e-6), urgent = n <= 3 && remain > 0, frac = remain - Math.floor(remain);
  const s = urgent ? 1 + 0.12 * Math.pow(frac, 4) : 1;
  ctx.save(); ctx.translate(cx, cy); ctx.scale(s, s);
  shadowOn(ctx, T, 30, 10); ctx.fillStyle = T.card; ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill(); ctx.shadowColor = 'transparent';
  ctx.lineWidth = r * 0.16; ctx.strokeStyle = T.dark ? 'rgba(255,255,255,.12)' : 'rgba(0,0,0,.07)';
  ctx.beginPath(); ctx.arc(0, 0, r * 0.8, 0, Math.PI * 2); ctx.stroke();
  const col = urgent ? T.no : T.primary;
  if (remain > 0) { ctx.strokeStyle = col; ctx.lineCap = 'round'; ctx.beginPath(); ctx.arc(0, 0, r * 0.8, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (remain / total)); ctx.stroke(); }
  text(ctx, String(n), 0, r * 0.05, F(900, r * 0.9), urgent ? T.no : T.text);
  ctx.restore();
}
function holdBar(ctx, x, y, w, h, p, track, fill) {
  ctx.fillStyle = track; ctx.beginPath(); ctx.roundRect(x, y, w, h, h / 2); ctx.fill();
  const fw = w * clamp(1 - p); if (fw > h) { ctx.fillStyle = fill; ctx.beginPath(); ctx.roundRect(x, y, fw, h, h / 2); ctx.fill(); }
}
function drawContain(ctx, img, x, y, w, h, r) {
  const s = Math.min(w / img.naturalWidth, h / img.naturalHeight), dw = img.naturalWidth * s, dh = img.naturalHeight * s;
  ctx.save(); ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.clip();
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh); ctx.restore();
}
function arrow(ctx, x, y, col) {
  ctx.save(); ctx.fillStyle = col; ctx.beginPath();
  ctx.moveTo(x - 55, y - 18); ctx.lineTo(x + 5, y - 18); ctx.lineTo(x + 5, y - 46); ctx.lineTo(x + 60, y);
  ctx.lineTo(x + 5, y + 46); ctx.lineTo(x + 5, y + 18); ctx.lineTo(x - 55, y + 18); ctx.closePath(); ctx.fill(); ctx.restore();
}

/* ---------- 背景 ---------- */
function drawBg(ctx, T, t) {
  const g = ctx.createLinearGradient(0, 0, W, H); g.addColorStop(0, T.bg[0]); g.addColorStop(1, T.bg[1]);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  const r = rng(7);
  ctx.save();
  if (T.deco === 'bubbles') {
    for (let i = 0; i < 14; i++) {
      const x = r() * W, y = r() * H, rad = 40 + r() * 170, ph = r() * 6.28;
      ctx.globalAlpha = 0.09 + r() * 0.08; ctx.fillStyle = i % 2 ? T.primary : T.accent;
      ctx.beginPath(); ctx.arc(x + Math.sin(t * 0.25 + ph) * 26, y + Math.cos(t * 0.2 + ph) * 26, rad, 0, 7); ctx.fill();
    }
  } else if (T.deco === 'confetti') {
    for (let i = 0; i < 46; i++) {
      const x = r() * W, y = r() * H, s = 14 + r() * 22, ph = r() * 6.28, c = [T.primary, T.accent, '#FFC857'][i % 3];
      ctx.globalAlpha = 0.22; ctx.fillStyle = c; ctx.save();
      ctx.translate(x, y + Math.sin(t * 0.5 + ph) * 14); ctx.rotate(ph + t * 0.3 * (i % 2 ? 1 : -1));
      ctx.beginPath(); ctx.roundRect(-s / 2, -s / 4, s, s / 2, s / 4); ctx.fill(); ctx.restore();
    }
  } else if (T.deco === 'waves') {
    for (let k = 0; k < 3; k++) {
      ctx.globalAlpha = 0.10 + k * 0.03; ctx.fillStyle = k % 2 ? T.accent : T.primary; ctx.beginPath(); ctx.moveTo(0, H);
      for (let x = 0; x <= W; x += 40) ctx.lineTo(x, H - 150 + k * 45 + Math.sin(x / 260 + t * (0.5 + k * 0.2) + k) * 26);
      ctx.lineTo(W, H); ctx.closePath(); ctx.fill();
    }
    for (let i = 0; i < 8; i++) { const x = r() * W, y = r() * H * 0.7, rad = 30 + r() * 90; ctx.globalAlpha = 0.07; ctx.fillStyle = T.primary; ctx.beginPath(); ctx.arc(x, y, rad, 0, 7); ctx.fill(); }
  } else if (T.deco === 'stars') {
    for (let i = 0; i < 110; i++) {
      const x = r() * W, y = r() * H, s = 1 + r() * 2.6, ph = r() * 6.28;
      ctx.globalAlpha = 0.35 + 0.45 * (0.5 + 0.5 * Math.sin(t * 1.5 + ph)); ctx.fillStyle = '#FFFFFF';
      ctx.beginPath(); ctx.arc(x, y, s, 0, 7); ctx.fill();
    }
    ctx.globalAlpha = 0.08; ctx.fillStyle = T.accent; ctx.beginPath(); ctx.arc(W * 0.85, H * 0.2, 260, 0, 7); ctx.fill();
  } else if (T.deco === 'chalk') {
    for (let i = 0; i < 220; i++) { ctx.globalAlpha = 0.05 + r() * 0.06; ctx.fillStyle = '#FFFFFF'; ctx.fillRect(r() * W, r() * H, 2 + r() * 3, 1 + r() * 2); }
    ctx.globalAlpha = 0.05; ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = 60;
    for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.arc(r() * W, r() * H, 200 + r() * 200, r() * 6, r() * 6 + 1.4); ctx.stroke(); }
    ctx.globalAlpha = 1; ctx.strokeStyle = '#7A5232'; ctx.lineWidth = 28; ctx.strokeRect(14, 14, W - 28, H - 28);
    ctx.strokeStyle = '#5E3E25'; ctx.lineWidth = 4; ctx.strokeRect(30, 30, W - 60, H - 60);
  }
  ctx.restore();
}
function progressBar(ctx, T, k) {
  const y = T.deco === 'chalk' ? H - 46 : H - 12, x = T.deco === 'chalk' ? 32 : 0, w = W - x * 2;
  ctx.fillStyle = T.dark ? 'rgba(255,255,255,.12)' : 'rgba(0,0,0,.06)'; ctx.fillRect(x, y, w, 12);
  ctx.fillStyle = T.primary; ctx.fillRect(x, y, w * clamp(k), 12);
}
function header(ctx, p, T, seg, game) {
  const on = T.onPrimary || '#FFFFFF';
  pill(ctx, 80, 74, `第 ${seg.index + 1} / ${seg.total} 題`, T.primary, on, 42);
  pill(ctx, W - 80, 74, game, T.card, T.sub, 34, 'right');
}
function credit(ctx, p, T, y, align = 'left', alpha = 1) {
  const parts = [p.credits?.designer && `設計：${p.credits.designer}`, p.credits?.org].filter(Boolean);
  if (!parts.length) return;
  ctx.save(); ctx.globalAlpha *= alpha;
  const x = align === 'left' ? (T.deco === 'chalk' ? 70 : 60) : align === 'right' ? W - 60 : W / 2;
  text(ctx, parts.join('　｜　'), x, y, F(700, 34), T.sub, align);
  ctx.restore();
}
function watermark(ctx, p, T) {
  if (!p.credits?.watermark) return;
  const s = [p.credits.designer, p.credits.org].filter(Boolean).join('｜'); if (!s) return;
  ctx.save(); ctx.globalAlpha = 0.6;
  text(ctx, s, W - (T.deco === 'chalk' ? 70 : 60), T.deco === 'chalk' ? H - 80 : H - 46, F(700, 28), T.sub, 'right');
  ctx.restore();
}

/* ---------- 場景 ---------- */
function drawIntro(ctx, p, T, seg, local, tl, L) {
  const a1 = ent(local), a2 = ent(local, .25), a3 = ent(local, .5);
  withAnim(ctx, a1, W / 2, 270, () => {
    const f = fit(ctx, p.title || '簡報遊戲', 1600, 250, 140, 60, 900);
    drawFit(ctx, f, W / 2, 260, T.text);
    ctx.fillStyle = T.accent; ctx.beginPath(); ctx.roundRect(W / 2 - 110, 385 + (f.L.length - 1) * 30, 220, 14, 7); ctx.fill();
  });
  if (p.subtitle) withAnim(ctx, a2, W / 2, 470, () => drawFit(ctx, fit(ctx, p.subtitle, 1500, 70, 52, 30, 700), W / 2, 470, T.sub));
  withAnim(ctx, a3, W / 2, 700, () => {
    if (p.type === 'match') {
      const rows = [[true, '圖文符合', p.match.yesAction, T.yes], [false, '圖文不符合', p.match.noAction, T.no]];
      rows.forEach(([ok, lab, act, col], i) => {
        const x = 250 + i * 740, y = 560, w = 680, h = 290;
        card(ctx, x, y, w, h, T);
        (ok ? markO : markX)(ctx, x + 150, y + h / 2, 82, 1, col, 26);
        text(ctx, lab, x + 280, y + 95, F(700, 48), T.sub, 'left');
        drawFit(ctx, fit(ctx, act || '', w - 320, 130, 84, 32, 900), x + 280, y + 190, col, 'left');
      });
    } else {
      const x = 310, y = 560, w = 1300, h = 290;
      card(ctx, x, y, w, h, T);
      drawFit(ctx, fit(ctx, p.opposite.rule || '', 1200, 90, 68, 36, 900), W / 2, y + 100, T.text);
      const first = tl.items[0];
      if (first) drawFit(ctx, fit(ctx, `例如：${first.prompt} → ${first.answer}`, 1200, 120, 52, 28, 700), W / 2, y + 205, T.primary);
    }
  });
  const remain = seg.dur - local;
  if (remain <= 3 && seg.dur > 3.5) ring(ctx, W / 2, 955, 66, remain, 3, T);
  else withAnim(ctx, ent(local, .8), W / 2, 955, () => text(ctx, L.ready, W / 2, 955, F(900, 52), T.primary));
  credit(ctx, p, T, T.deco === 'chalk' ? 1000 : 1030, 'left', a2);
}

function matchHint(ctx, p, T, y, hl) {
  const groups = [{ o: true, s: `符合 → ${p.match.yesAction}`, c: T.yes }, { o: false, s: `不符合 → ${p.match.noAction}`, c: T.no }];
  ctx.font = F(700, 40);
  const ws = groups.map(g => 44 + 18 + ctx.measureText(g.s).width), gap = 90;
  let x = W / 2 - (ws[0] + ws[1] + gap) / 2;
  groups.forEach((g, i) => {
    ctx.save();
    if (hl !== undefined && hl !== i) ctx.globalAlpha = 0.3;
    if (hl === i) { ctx.fillStyle = g.c; ctx.globalAlpha = 0.16; ctx.beginPath(); ctx.roundRect(x - 26, y - 38, ws[i] + 52, 76, 38); ctx.fill(); ctx.globalAlpha = 1; }
    (g.o ? markO : markX)(ctx, x + 22, y, 19, 1, g.c, 8);
    text(ctx, g.s, x + 62, y + 2, F(700, 40), T.text, 'left');
    ctx.restore();
    x += ws[i] + gap;
  });
}

function drawMatch(ctx, p, T, seg, local, imgs, isA, L) {
  const it = seg.item, a = isA ? 1 : ent(local);
  header(ctx, p, T, seg, '圖文配對');
  const IX = 130, IY = 170, IW = 940, IH = 740;
  withAnim(ctx, a, IX + IW / 2, IY + IH / 2, () => {
    card(ctx, IX, IY, IW, IH, T, { fill: T.imgCard || '#FFFFFF' });
    const img = it.img && imgs(it.img);
    if (img && img.complete && img.naturalWidth) drawContain(ctx, img, IX + 36, IY + 36, IW - 72, IH - 72, 24);
    else text(ctx, '（尚未上傳圖片）', IX + IW / 2, IY + IH / 2, F(700, 48), '#B9AFA5');
  });
  const TX = 1150, TY = 190, TW = 640, TH = 470;
  withAnim(ctx, isA ? 1 : ent(local, .15), TX + TW / 2, TY + TH / 2, () => {
    card(ctx, TX, TY, TW, TH, T);
    if (!isA) {
      text(ctx, L.matchAsk, TX + TW / 2, TY + 78, F(700, 40), T.sub);
      drawFit(ctx, fit(ctx, it.text, TW - 90, TH - 170, 180, 40, 900), TX + TW / 2, TY + TH / 2 + 45, T.text);
    } else {
      const ok = !!it.isMatch, col = ok ? T.yes : T.no;
      drawFit(ctx, fit(ctx, it.text, TW - 90, 130, 96, 32, 900), TX + TW / 2, TY + 110, T.text);
      ctx.fillStyle = T.dark ? 'rgba(255,255,255,.12)' : 'rgba(0,0,0,.07)'; ctx.fillRect(TX + 60, TY + 200, TW - 120, 4);
      const k = easeBack((local - 0.15) / 0.45);
      if (k > 0) { ctx.save(); ctx.translate(TX + TW / 2, TY + 330); ctx.scale(k, k); drawFit(ctx, fit(ctx, ok ? L.matchYes : L.matchNo, TW - 80, 160, 130, 40, 900), 0, 0, col); ctx.restore(); }
    }
  });
  if (!isA) { ring(ctx, TX + TW / 2, 800, 95, seg.dur - local, seg.dur, T); matchHint(ctx, p, T, 985); return; }
  const ok = !!it.isMatch, col = ok ? T.yes : T.no;
  ctx.save(); ctx.globalAlpha = 0.55 * clamp(local / 0.3); ctx.fillStyle = T.imgCard || '#FFFFFF'; ctx.beginPath(); ctx.roundRect(IX, IY, IW, IH, 40); ctx.fill(); ctx.restore();
  (ok ? markO : markX)(ctx, IX + IW / 2, IY + IH / 2, 260, easeOut((local - 0.05) / 0.55), col, 54);
  const AX = 1150, AY = 690, AW = 640, AH = 220;
  withAnim(ctx, clamp((local - 0.35) / 0.3), AX + AW / 2, AY + AH / 2, () => {
    card(ctx, AX, AY, AW, AH, T, { fill: col });
    text(ctx, L.doIt, AX + AW / 2, AY + 46, F(700, 34), 'rgba(255,255,255,.92)');
    drawFit(ctx, fit(ctx, (ok ? p.match.yesAction : p.match.noAction) || '', AW - 70, AH - 110, 96, 32, 900), AX + AW / 2, AY + 122, '#FFFFFF');
    holdBar(ctx, AX + 60, AY + AH - 32, AW - 120, 12, local / seg.dur, 'rgba(255,255,255,.35)', '#FFFFFF');
  });
  ctx.save(); ctx.strokeStyle = col; ctx.globalAlpha = 0.45 + 0.3 * Math.sin(local * 6); ctx.lineWidth = 16; ctx.strokeRect(8, 8, W - 16, H - 16); ctx.restore();
  matchHint(ctx, p, T, 985, ok ? 0 : 1);
}

function drawOpp(ctx, p, T, seg, local, isA, L) {
  const it = seg.item;
  header(ctx, p, T, seg, '相反動作');
  const QX = 260, QY = 190, QW = 1400, QH = 560, QC = QY + QH / 2;
  const on = T.onPrimary || '#FFFFFF';
  const qCard = () => {
    card(ctx, QX, QY, QW, QH, T);
    pill(ctx, W / 2, QY + 78, L.oppCmd, T.accent, T.dark ? '#14202A' : '#FFFFFF', 40, 'center');
    drawFit(ctx, fit(ctx, it.prompt, QW - 180, QH - 260, 190, 48, 900), W / 2, QC + 25, T.text);
    if (!isA) text(ctx, L.oppThink, W / 2, QY + QH - 62, F(700, 40), T.sub);
  };
  if (!isA) { withAnim(ctx, ent(local), W / 2, QC, qCard); ring(ctx, W / 2, 880, 95, seg.dur - local, seg.dur, T); return; }
  const k = easeInOut(local / 0.6), sc = lerp(1, 0.5, k);
  ctx.save(); ctx.translate(lerp(W / 2, 490, k), lerp(QC, 470, k)); ctx.scale(sc, sc); ctx.translate(-W / 2, -QC); qCard(); ctx.restore();
  const ak = clamp((local - 0.45) / 0.3);
  if (ak > 0) { ctx.save(); ctx.globalAlpha = ak; arrow(ctx, 945 + Math.sin(local * 5) * 10, 470, T.primary); ctx.restore(); }
  const RX = 1060, RY = 190, RW = 760, RH = 560, rk = clamp((local - 0.5) / 0.45);
  if (rk > 0) {
    ctx.save(); ctx.globalAlpha = rk; ctx.translate(lerp(120, 0, easeOut(rk)), 0);
    card(ctx, RX, RY, RW, RH, T, { stroke: T.primary, lw: 10 });
    pill(ctx, RX + RW / 2, RY + 78, L.oppAnswer, T.primary, on, 40, 'center');
    drawFit(ctx, fit(ctx, it.answer, RW - 120, RH - 210, 160, 40, 900), RX + RW / 2, RY + RH / 2 + 35, T.text);
    ctx.restore();
  }
  const bk = clamp((local - 0.8) / 0.4);
  if (bk > 0) {
    ctx.save(); ctx.globalAlpha = bk;
    text(ctx, L.oppDo, W / 2, 845, F(900, 58), T.text);
    holdBar(ctx, 560, 905, 800, 26, local / seg.dur, T.dark ? 'rgba(255,255,255,.14)' : 'rgba(0,0,0,.08)', T.primary);
    ctx.restore();
  }
}

function drawOutro(ctx, p, T, seg, local, tl, L) {
  const r = rng(3), cols = [T.primary, T.accent, T.yes, T.no, '#FFC857'];
  ctx.save();
  for (let i = 0; i < 90; i++) {
    const vx = (r() - .5) * 1700, vy = -r() * 950 - 300, rot = r() * 6, s = 12 + r() * 18, lt = local;
    const x = W / 2 + vx * lt, y = 400 + vy * lt + 700 * lt * lt;
    ctx.globalAlpha = clamp(1 - (local - 2.2) / 1.2); ctx.fillStyle = cols[i % cols.length];
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot + lt * 6); ctx.fillRect(-s / 2, -s / 4, s, s / 2); ctx.restore();
  }
  ctx.restore();
  const k = easeBack(local / 0.6);
  if (k > 0) { ctx.save(); ctx.translate(W / 2, 380); ctx.scale(k, k); drawFit(ctx, fit(ctx, L.done, 1500, 260, 210, 80, 900), 0, 0, T.primary); ctx.restore(); }
  withAnim(ctx, ent(local, .4), W / 2, 600, () => drawFit(ctx, fit(ctx, p.ending || '', 1500, 160, 76, 32, 700), W / 2, 600, T.text));
  withAnim(ctx, ent(local, .7), W / 2, 730, () => text(ctx, L.count.replace('{n}', tl.items.length), W / 2, 730, F(700, 46), T.sub));
  const parts = [p.credits?.designer && `設計：${p.credits.designer}`, p.credits?.org].filter(Boolean);
  if (parts.length) withAnim(ctx, ent(local, 1), W / 2, 870, () => {
    ctx.font = F(700, 40); const s = parts.join('　｜　'); const w = ctx.measureText(s).width + 90;
    card(ctx, W / 2 - w / 2, 830, w, 80, T, { r: 40 }); text(ctx, s, W / 2, 871, F(700, 40), T.text);
  });
}

/* ---------- 主繪製 ---------- */
function renderFrame(ctx, p, tl, t, imgs) {
  const T = theme(p); FAM = FONTS[fontKey(p, T)];
  const L = labels(p);
  ctx.setTransform(ctx.canvas.width / W, 0, 0, ctx.canvas.height / H, 0, 0);
  ctx.globalAlpha = 1; ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
  t = clamp(t, 0, Math.max(0, tl.duration - 1e-4));
  let seg = tl.segs[0];
  for (const s of tl.segs) { if (t >= s.start) seg = s; else break; }
  const local = t - seg.start;
  drawBg(ctx, T, t);
  if (seg.type === 'intro') drawIntro(ctx, p, T, seg, local, tl, L);
  else if (seg.type === 'outro') drawOutro(ctx, p, T, seg, local, tl, L);
  else {
    if (p.type === 'match') drawMatch(ctx, p, T, seg, local, imgs, seg.type === 'a', L);
    else drawOpp(ctx, p, T, seg, local, seg.type === 'a', L);
    watermark(ctx, p, T);
  }
  progressBar(ctx, T, tl.duration ? t / tl.duration : 0);
}

/* ---------- 字型與圖片預載 ---------- */
const STATIC = '第題圖文配對相反動作尚未上傳圖片上的是…符合不符合！請做想一想：相反動作是什麼？指令一起做保持住～完成共準備好了嗎例如→「」，。0123456789/ 簡報遊戲看到做出設計｜' + Object.values(DEFAULT_LABELS).join('');
function collectText(p, tl) {
  const L = labels(p);
  return [p.title, p.subtitle, p.ending, p.opposite.rule, p.match.yesAction, p.match.noAction, p.credits?.designer, p.credits?.org,
    ...Object.values(L), ...tl.items.map(i => (i.text || '') + (i.prompt || '') + (i.answer || ''))].join('');
}
async function ensureFonts(p) {
  const T = theme(p); FAM = FONTS[fontKey(p, T)];
  const tl = buildTimeline(p);
  const s = STATIC + collectText(p, tl);
  await Promise.all([500, 700, 900].map(w => document.fonts.load(F(w, 40), s).catch(() => {})));
  fitCache.clear();
}
const imgCache = new Map();
let onAsset = null;
function getImg(src) {
  let im = imgCache.get(src);
  if (!im) { im = new Image(); im.onload = () => onAsset && onAsset(); im.src = src; imgCache.set(src, im); }
  return im;
}
function loadImg(src) {
  const im = getImg(src);
  if (im.complete && im.naturalWidth) return Promise.resolve(im);
  return new Promise(res => { im.addEventListener('load', () => res(im), { once: true }); im.addEventListener('error', () => res(im), { once: true }); });
}
async function ready(p) {
  await ensureFonts(p);
  if (p.type === 'match') await Promise.all(p.match.items.filter(i => i.img).map(i => loadImg(i.img)));
}

window.SG = {
  W, H, THEMES, FONTS, DEFAULT_LABELS, OPP_PRESETS,
  buildTimeline, renderFrame, itemsOf, autoOpposite, ready, ensureFonts, getImg, imgCache,
  set onAsset(fn) { onAsset = fn; },
};
})();
