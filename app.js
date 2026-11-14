/* 簡報遊戲影片工坊 — 編輯器 */
(function () {
'use strict';
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const KEY = 'sgv-project-v1';
const clone = o => JSON.parse(JSON.stringify(o));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = s => { s = Math.max(0, Math.round(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const DEF_TITLE = { match: '圖文配對大挑戰', opposite: '相反動作大挑戰' };
const DEF_SUB = { match: '看圖、讀字，用身體回答！', opposite: '動動腦、動動身體！' };

function emojiImg(e) {
  const c = document.createElement('canvas'); c.width = c.height = 640;
  const x = c.getContext('2d'); x.font = '470px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
  x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(e, 320, 350);
  return c.toDataURL('image/png');
}
function defaults() {
  return {
    version: 1, type: 'match',
    title: DEF_TITLE.match, subtitle: DEF_SUB.match,
    theme: 'warm', font: 'auto', customColor: '',
    timing: { intro: 7, think: 5, answer: 4, outro: 6 },
    order: 'seq', seed: 1, ending: '大家都做得很棒！',
    credits: { designer: '', org: '', watermark: false },
    labels: {},
    audio: { music: 'happy', musicVol: .45, duck: true, sfxPack: 'classic', sfxVol: .8, customName: '',
      ev: { intro: true, pop: true, tick: true, final: true, reveal: true, outro: true } },
    match: { yesAction: '雙手比圈', noAction: '雙手比叉', items: [] },
    opposite: { rule: '看到指令，做出「相反動作」！', items: SG.OPP_PRESETS.slice(0, 4).map(clone) },
  };
}
function sampleMatch() {
  return [['🍎', '蘋果', true], ['🍌', '西瓜', false], ['🐶', '小狗', true], ['🚗', '飛機', false], ['☂️', '雨傘', true]]
    .map(([e, text, isMatch]) => ({ img: emojiImg(e), text, isMatch }));
}
function merge(base, o) {
  for (const k in o) {
    if (o[k] && typeof o[k] === 'object' && !Array.isArray(o[k]) && base[k] && typeof base[k] === 'object') merge(base[k], o[k]);
    else if (o[k] !== undefined) base[k] = o[k];
  }
  return base;
}
let P;
try { const s = localStorage.getItem(KEY); P = s ? merge(defaults(), JSON.parse(s)) : null; } catch (e) { P = null; }
if (!P) { P = defaults(); P.match.items = sampleMatch(); }

/* ---------- 自訂音樂（存在 IndexedDB，避免塞爆 localStorage） ---------- */
let customBuf = null, customRaw = null;
const idb = () => new Promise((res, rej) => { const r = indexedDB.open('sgv', 1); r.onupgradeneeded = () => r.result.createObjectStore('files'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
async function idbSet(k, v) { const db = await idb(); return new Promise(r => { const tx = db.transaction('files', 'readwrite'); tx.objectStore('files').put(v, k); tx.oncomplete = r; tx.onerror = r; }); }
async function idbGet(k) { const db = await idb(); return new Promise(r => { const q = db.transaction('files').objectStore('files').get(k); q.onsuccess = () => r(q.result); q.onerror = () => r(null); }); }
async function setCustomMusic(name, type, data, persist = true) {
  customBuf = await SGAudio.decodeFile(data);
  customRaw = { name, type, data };
  P.audio.customName = name;
  if (persist) try { await idbSet('music', customRaw); } catch (e) { /* ignore */ }
}

/* ---------- 狀態更新 ---------- */
let tl = SG.buildTimeline(P);
let saveTimer, fontTimer, mixTimer, thumbTimer;
function changed(opts = {}) {
  tl = SG.buildTimeline(P);
  pv.t = Math.min(pv.t, Math.max(0, tl.duration - .01));
  buildStrip(); updateSummary();
  clearTimeout(saveTimer); saveTimer = setTimeout(save, 500);
  clearTimeout(fontTimer); fontTimer = setTimeout(() => SG.ensureFonts(P).then(() => { dirty = true; }), 250);
  invalidateMix();
  if (opts.thumbs !== false) { clearTimeout(thumbTimer); thumbTimer = setTimeout(drawThumbs, 400); }
  dirty = true;
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(P)); }
  catch (e) { toast('圖片太多，自動儲存空間不足，請按「儲存教案」存成檔案'); }
}
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 3200); }

/* ---------- 預覽播放器 ---------- */
const cv = $('#cv'), cx = cv.getContext('2d');
const pv = { t: 0, playing: false, last: 0 };
let dirty = true;
SG.onAsset = () => { dirty = true; };
function frame(ts) {
  if (pv.playing) {
    pv.t += (ts - pv.last) / 1000;
    if (audio.src && audio.ctx) pv.t = audio.offset + (audio.ctx.currentTime - audio.startAt);
    if (pv.t >= tl.duration) { pv.t = tl.duration - .001; pause(); }
    dirty = true;
  }
  pv.last = ts;
  if (dirty || pv.playing || (ts | 0) % 2 === 0) { SG.renderFrame(cx, P, tl, pv.t, SG.getImg); dirty = false; updateHead(); }
  requestAnimationFrame(frame);
}

/* 混音：與匯出完全相同的聲音 */
const audio = { ctx: null, src: null, buf: null, pending: null, startAt: 0, offset: 0 };
function invalidateMix() {
  audio.buf = null; audio.pending = null;
  clearTimeout(mixTimer);
  mixTimer = setTimeout(() => { if (pv.playing) { const t = pv.t; stopSource(); getMix().then(() => { if (pv.playing) startSource(t); }); } }, 600);
}
function getMix() {
  if (audio.buf) return Promise.resolve(audio.buf);
  if (!audio.pending) {
    const snap = clone(P), tl2 = SG.buildTimeline(snap);
    audio.pending = SGAudio.renderMix(snap, tl2, 48000, customBuf).then(b => { if (audio.pending === p) audio.buf = b; return b; });
    var p = audio.pending;
  }
  return audio.pending;
}
function ensureCtx() { if (!audio.ctx) audio.ctx = new AudioContext(); if (audio.ctx.state === 'suspended') audio.ctx.resume(); return audio.ctx; }
function stopSource() { if (audio.src) { try { audio.src.stop(); } catch (e) {} audio.src.disconnect(); audio.src = null; } }
function startSource(t) {
  stopSource();
  if (!$('#previewSound').checked || !audio.buf) return;
  const ac = ensureCtx(), s = ac.createBufferSource(); s.buffer = audio.buf; s.connect(ac.destination);
  audio.startAt = ac.currentTime + .03; audio.offset = t; s.start(audio.startAt, Math.max(0, t));
  audio.src = s;
}
async function play() {
  if (pv.t >= tl.duration - .05) pv.t = 0;
  stopPreviewSound();
  pv.playing = true; setPlayIcon();
  if ($('#previewSound').checked) {
    ensureCtx();
    const t0 = pv.t, wasPlaying = performance.now();
    await getMix();
    if (!pv.playing) return;
    pv.t = t0 + (performance.now() - wasPlaying) / 1000;
    startSource(pv.t);
  }
}
function pause() { pv.playing = false; stopSource(); setPlayIcon(); }
function seek(t) { pv.t = Math.max(0, Math.min(tl.duration - .001, t)); dirty = true; if (pv.playing) startSource(pv.t); }
function setPlayIcon() {
  $('#btnPlay').innerHTML = pv.playing ? '<svg viewBox="0 0 16 16"><rect x="3.5" y="2.5" width="3" height="11" rx="1"/><rect x="9.5" y="2.5" width="3" height="11" rx="1"/></svg>' : '<svg viewBox="0 0 16 16"><path d="M4 2.5v11l9.5-5.5z"/></svg>';
  $('#btnPlay').setAttribute('aria-label', pv.playing ? '暫停' : '播放');
}
function segAt(t) { let i = 0; tl.segs.forEach((s, k) => { if (t >= s.start - 1e-6) i = k; }); return i; }
function jump(d) { const i = Math.max(0, Math.min(tl.segs.length - 1, segAt(pv.t + .01) + d)); seek(tl.segs[i].start + .001); }

function buildStrip() {
  $('#segs').innerHTML = tl.segs.map(s => `<div class="s-${s.type}" style="flex:${s.dur}" title="${s.type === 'q' ? '第 ' + (s.index + 1) + ' 題' : s.type === 'a' ? '第 ' + (s.index + 1) + ' 題揭曉' : s.type === 'intro' ? '開場' : '結尾'}"></div>`).join('');
}
let lastCur = -1;
function updateHead() {
  $('#playhead').style.left = (tl.duration ? pv.t / tl.duration * 100 : 0) + '%';
  $('#time').textContent = fmt(pv.t) + ' / ' + fmt(tl.duration);
  const s = tl.segs[segAt(pv.t)], cur = s && s.item ? s.item._src : -1;
  if (cur !== lastCur) { lastCur = cur; $$('.item').forEach(el => el.classList.toggle('cur', +el.dataset.i === cur)); }
}
function updateSummary() {
  $('#summary').textContent = `${tl.items.length} 題・影片長度 ${fmt(tl.duration)}`;
  $('#matchCount').textContent = P.match.items.length ? `(${P.match.items.length})` : '';
  $('#oppCount').textContent = P.opposite.items.length ? `(${P.opposite.items.length})` : '';
}
const strip = $('#strip');
function stripSeek(e) { const r = strip.getBoundingClientRect(); seek((e.clientX - r.left) / r.width * tl.duration); }
strip.addEventListener('pointerdown', e => { strip.setPointerCapture(e.pointerId); stripSeek(e); strip.onpointermove = stripSeek; });
strip.addEventListener('pointerup', () => { strip.onpointermove = null; });
strip.addEventListener('keydown', e => { if (e.key === 'ArrowRight') { seek(pv.t + 1); e.preventDefault(); } if (e.key === 'ArrowLeft') { seek(pv.t - 1); e.preventDefault(); } });
$('#btnPlay').onclick = () => pv.playing ? pause() : play();
$('#btnPrev').onclick = () => jump(-1);
$('#btnNext').onclick = () => jump(1);
$('#previewSound').onchange = () => { if (pv.playing) { if ($('#previewSound').checked) getMix().then(() => pv.playing && startSource(pv.t)); else stopSource(); } };

/* ---------- 全螢幕帶操作 ---------- */
const screen = $('#screen');
$('#btnPresent').onclick = async () => {
  try { await screen.requestFullscreen(); } catch (e) { toast('瀏覽器不允許全螢幕'); return; }
  seek(0); play();
};
let curTimer;
screen.addEventListener('pointermove', () => { screen.classList.add('showcursor'); clearTimeout(curTimer); curTimer = setTimeout(() => screen.classList.remove('showcursor'), 1800); });
screen.addEventListener('click', () => { if (document.fullscreenElement) pv.playing ? pause() : play(); });
document.addEventListener('keydown', e => {
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName) && document.activeElement.type !== 'range' && document.activeElement.type !== 'checkbox';
  if (typing || $('#dlgExport').open) return;
  if (e.code === 'Space') { e.preventDefault(); pv.playing ? pause() : play(); }
  else if (document.fullscreenElement && e.key === 'ArrowRight') jump(1);
  else if (document.fullscreenElement && e.key === 'ArrowLeft') jump(-1);
});

/* ---------- 遊戲類型與分頁 ---------- */
function applyType() {
  document.body.classList.toggle('t-match', P.type === 'match');
  document.body.classList.toggle('t-opposite', P.type === 'opposite');
  $$('.type-card').forEach(b => { b.classList.toggle('on', b.dataset.type === P.type); b.setAttribute('aria-checked', b.dataset.type === P.type); });
}
$$('.type-card').forEach(b => b.onclick = () => {
  if (P.type === b.dataset.type) return;
  const old = P.type; P.type = b.dataset.type;
  if (!P.title || P.title === DEF_TITLE[old]) { P.title = DEF_TITLE[P.type]; $('#fTitle').value = P.title; }
  if (!P.subtitle || P.subtitle === DEF_SUB[old]) { P.subtitle = DEF_SUB[P.type]; $('#fSubtitle').value = P.subtitle; }
  applyType(); seek(1.5); changed();
});
$$('.tabs button').forEach(b => b.onclick = () => {
  $$('.tabs button').forEach(x => x.classList.toggle('on', x === b));
  $$('.tab').forEach(s => s.hidden = s.id !== 'tab-' + b.dataset.tab);
  if (b.dataset.tab === 'look') drawThumbs();
});

/* ---------- 文字欄位綁定 ---------- */
function bindText(sel, get, set, opts) {
  const el = $(sel); el.value = get() ?? '';
  el.addEventListener('input', () => { set(el.value); changed(opts); });
}
bindText('#fTitle', () => P.title, v => P.title = v);
bindText('#fSubtitle', () => P.subtitle, v => P.subtitle = v);
bindText('#fYes', () => P.match.yesAction, v => P.match.yesAction = v);
bindText('#fNo', () => P.match.noAction, v => P.match.noAction = v);
bindText('#fRule', () => P.opposite.rule, v => P.opposite.rule = v);
bindText('#fEnding', () => P.ending, v => P.ending = v);
bindText('#fDesigner', () => P.credits.designer, v => P.credits.designer = v);
bindText('#fOrg', () => P.credits.org, v => P.credits.org = v);
$('#fWatermark').checked = !!P.credits.watermark;
$('#fWatermark').onchange = e => { P.credits.watermark = e.target.checked; changed(); };

function bindSlider(sel, get, set, show = v => v + ' 秒', opts) {
  const el = $(sel), out = el.parentElement.querySelector('output');
  const upd = () => { out.textContent = show(+el.value); };
  el.value = get(); upd();
  el.addEventListener('input', () => { set(+el.value); upd(); changed(opts); });
}
bindSlider('#tIntro', () => P.timing.intro, v => P.timing.intro = v);
bindSlider('#tThink', () => P.timing.think, v => P.timing.think = v);
bindSlider('#tAnswer', () => P.timing.answer, v => P.timing.answer = v);
bindSlider('#tOutro', () => P.timing.outro, v => P.timing.outro = v);
bindSlider('#musicVol', () => Math.round(P.audio.musicVol * 100), v => P.audio.musicVol = v / 100, v => v + '%', { thumbs: false });
bindSlider('#sfxVol', () => Math.round(P.audio.sfxVol * 100), v => P.audio.sfxVol = v / 100, v => v + '%', { thumbs: false });
$('#duck').checked = P.audio.duck;
$('#duck').onchange = e => { P.audio.duck = e.target.checked; changed({ thumbs: false }); };

function segCtl(sel, get, set) {
  const box = $(sel);
  const upd = () => box.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === String(get())));
  box.querySelectorAll('button').forEach(b => b.onclick = () => { set(b.dataset.v); upd(); });
  upd();
}
segCtl('#orderCtl', () => P.order, v => { P.order = v; $('#btnShuffle').hidden = v !== 'random'; changed(); });
$('#btnShuffle').hidden = P.order !== 'random';
$('#btnShuffle').onclick = () => { P.seed = (P.seed || 1) + 1; changed(); toast('已重新洗牌'); };

/* ---------- 圖文配對題目 ---------- */
function resizeImage(file) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file), im = new Image();
    im.onload = () => {
      const s = Math.min(1, 1280 / Math.max(im.naturalWidth, im.naturalHeight));
      const c = document.createElement('canvas'); c.width = Math.round(im.naturalWidth * s); c.height = Math.round(im.naturalHeight * s);
      c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
      let d = c.toDataURL('image/webp', .88); if (!d.startsWith('data:image/webp')) d = c.toDataURL('image/jpeg', .88);
      res(d);
    };
    im.onerror = () => { URL.revokeObjectURL(url); rej(new Error('無法讀取圖片')); };
    im.src = url;
  });
}
const nameOf = f => f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
function renderMatch() {
  const L = P.match.items;
  $('#matchList').innerHTML = L.length ? L.map((it, i) => `
    <div class="item" data-i="${i}">
      <div class="num">${i + 1}</div>
      <label class="thumb" title="點擊更換圖片">${it.img ? `<img src="${it.img}" alt="">` : '點擊<br>上傳圖片'}<input type="file" accept="image/*" hidden data-act="img"></label>
      <div class="fields">
        <input type="text" value="${esc(it.text)}" placeholder="文字，例如：蘋果" data-act="text" maxlength="30" aria-label="第 ${i + 1} 題文字">
        <div class="yn"><button class="y ${it.isMatch ? 'on' : ''}" data-act="yes">⭕ 符合</button><button class="n ${!it.isMatch ? 'on' : ''}" data-act="no">❌ 不符合</button></div>
      </div>
      <div class="ops"><button data-act="up" aria-label="上移">▲</button><button data-act="down" aria-label="下移">▼</button><button class="del" data-act="del" aria-label="刪除">✕</button></div>
    </div>`).join('') : '<div class="empty">還沒有題目。按「＋ 新增題目」，或把圖片拖到這裡。</div>';
  lastCur = -1;
}
function focusItem(i) { const s = tl.segs.find(s => s.type === 'q' && s.item._src === i); if (s && !pv.playing) seek(s.start + Math.min(1.2, s.dur * .4)); }
$('#matchList').addEventListener('input', e => {
  const el = e.target, i = +el.closest('.item')?.dataset.i;
  if (el.dataset.act === 'text') { P.match.items[i].text = el.value; changed(); }
});
$('#matchList').addEventListener('change', async e => {
  const el = e.target, i = +el.closest('.item')?.dataset.i;
  if (el.dataset.act === 'img' && el.files[0]) {
    try { P.match.items[i].img = await resizeImage(el.files[0]); if (!P.match.items[i].text) P.match.items[i].text = nameOf(el.files[0]); renderMatch(); changed(); focusItem(i); }
    catch (err) { toast(err.message); }
  }
});
$('#matchList').addEventListener('click', e => {
  const b = e.target.closest('button'), row = e.target.closest('.item'); if (!row) return;
  const i = +row.dataset.i, L = P.match.items;
  if (!b) { if (e.target.tagName === 'INPUT' && e.target.type === 'text') focusItem(i); return; }
  const a = b.dataset.act;
  if (a === 'yes' || a === 'no') { L[i].isMatch = a === 'yes'; renderMatch(); changed(); focusItem(i); seek(pv.t); }
  else if (a === 'up' && i > 0) { [L[i - 1], L[i]] = [L[i], L[i - 1]]; renderMatch(); changed(); }
  else if (a === 'down' && i < L.length - 1) { [L[i + 1], L[i]] = [L[i], L[i + 1]]; renderMatch(); changed(); }
  else if (a === 'del') { L.splice(i, 1); renderMatch(); changed(); }
});
$('#matchList').addEventListener('focusin', e => { const row = e.target.closest('.item'); if (row && e.target.type === 'text') focusItem(+row.dataset.i); });
$('#btnAddMatch').onclick = () => { P.match.items.push({ img: '', text: '', isMatch: true }); renderMatch(); changed(); const ins = $$('#matchList input[type=text]'); ins[ins.length - 1]?.focus(); };
$('#btnBatchImg').onclick = () => $('#fileImgs').click();
async function addImages(files) {
  files = [...files].filter(f => f.type.startsWith('image/'));
  if (!files.length) return;
  for (const f of files) { try { P.match.items.push({ img: await resizeImage(f), text: nameOf(f), isMatch: true }); } catch (e) { /* skip */ } }
  renderMatch(); changed(); toast(`已加入 ${files.length} 張圖片，記得檢查文字和「符合／不符合」`);
}
$('#fileImgs').onchange = e => { addImages(e.target.files); e.target.value = ''; };
const ml = $('#matchList');
ml.addEventListener('dragover', e => { e.preventDefault(); ml.classList.add('drag'); });
ml.addEventListener('dragleave', () => ml.classList.remove('drag'));
ml.addEventListener('drop', e => { e.preventDefault(); ml.classList.remove('drag'); addImages(e.dataTransfer.files); });

/* ---------- 相反動作題目 ---------- */
function renderOpp() {
  const L = P.opposite.items;
  $('#oppList').innerHTML = L.length ? L.map((it, i) => `
    <div class="item opp" data-i="${i}">
      <div class="num">${i + 1}</div>
      <div class="fields"><div class="pair">
        <label><em>指令</em><input type="text" value="${esc(it.prompt)}" placeholder="例如：右手舉高" data-act="prompt" maxlength="30" aria-label="第 ${i + 1} 題指令"></label>
        <label><em>相反</em><input type="text" value="${esc(it.answer)}" placeholder="${esc(SG.autoOpposite(it.prompt) || '相反動作')}" data-act="answer" maxlength="30" aria-label="第 ${i + 1} 題相反動作"></label>
      </div></div>
      <div class="ops"><button data-act="up" aria-label="上移">▲</button><button data-act="down" aria-label="下移">▼</button><button class="del" data-act="del" aria-label="刪除">✕</button></div>
    </div>`).join('') : '<div class="empty">還沒有題目。按「＋ 新增題目」或從範例加入。</div>';
  lastCur = -1;
}
$('#oppList').addEventListener('input', e => {
  const el = e.target, row = el.closest('.item'), i = +row.dataset.i, it = P.opposite.items[i];
  if (el.dataset.act === 'prompt') { it.prompt = el.value; row.querySelector('[data-act=answer]').placeholder = SG.autoOpposite(el.value) || '相反動作'; }
  if (el.dataset.act === 'answer') it.answer = el.value;
  changed();
});
$('#oppList').addEventListener('focusin', e => { const row = e.target.closest('.item'); if (row) { const i = +row.dataset.i, s = tl.segs.find(s => s.type === (e.target.dataset.act === 'answer' ? 'a' : 'q') && s.item._src === i); if (s && !pv.playing) seek(s.start + Math.min(1.5, s.dur * .5)); } });
$('#oppList').addEventListener('click', e => {
  const b = e.target.closest('button'), row = e.target.closest('.item'); if (!b || !row) return;
  const i = +row.dataset.i, L = P.opposite.items, a = b.dataset.act;
  if (a === 'up' && i > 0) [L[i - 1], L[i]] = [L[i], L[i - 1]];
  else if (a === 'down' && i < L.length - 1) [L[i + 1], L[i]] = [L[i], L[i + 1]];
  else if (a === 'del') L.splice(i, 1);
  else return;
  renderOpp(); changed();
});
$('#oppPreset').innerHTML = '<option value="">從範例加入…</option><option value="all">全部範例（12 題）</option>' + SG.OPP_PRESETS.map((x, i) => `<option value="${i}">${esc(x.prompt)} → ${esc(x.answer)}</option>`).join('');
$('#oppPreset').onchange = e => {
  const v = e.target.value; if (!v) return;
  const add = v === 'all' ? SG.OPP_PRESETS : [SG.OPP_PRESETS[+v]];
  add.forEach(x => { if (!P.opposite.items.some(y => y.prompt === x.prompt)) P.opposite.items.push(clone(x)); });
  e.target.value = ''; renderOpp(); changed();
};
$('#btnAddOpp').onclick = () => { P.opposite.items.push({ prompt: '', answer: '' }); renderOpp(); changed(); const ins = $$('#oppList [data-act=prompt]'); ins[ins.length - 1]?.focus(); };

/* ---------- 音樂與音效 ---------- */
let listen = { src: null, btn: null };
function stopPreviewSound() { if (listen.src) { try { listen.src.stop(); } catch (e) {} listen.src = null; } if (listen.btn) { listen.btn.classList.remove('playing'); listen.btn.textContent = '▶ 試聽'; listen.btn = null; } }
async function playBuf(buf, btn, loop = false, maxSec = 0) {
  const wasMine = listen.btn === btn; stopPreviewSound(); if (wasMine || !buf) return;
  if (pv.playing) pause();
  const ac = ensureCtx(), s = ac.createBufferSource(); s.buffer = buf; s.loop = loop;
  const g = ac.createGain(); g.gain.value = 1; s.connect(g).connect(ac.destination); s.start();
  if (maxSec) { g.gain.setValueAtTime(1, ac.currentTime + maxSec - 1); g.gain.linearRampToValueAtTime(0, ac.currentTime + maxSec); s.stop(ac.currentTime + maxSec); }
  listen = { src: s, btn };
  if (btn) { btn.classList.add('playing'); btn.textContent = '■ 停止'; }
  s.onended = () => { if (listen.src === s) stopPreviewSound(); };
}
function renderMusic() {
  const S = SGAudio.STYLES, A = P.audio;
  const rows = [['none', '不要背景音樂', '只保留音效'], ...Object.entries(S).map(([k, v]) => [k, v.name, v.desc]),
    ['custom', '上傳自己的音樂', A.customName ? `目前：${A.customName}` : 'MP3、WAV、M4A，請確認有使用權']];
  $('#musicList').innerHTML = rows.map(([k, n, d]) => `
    <label class="choice ${A.music === k ? 'on' : ''}"><input type="radio" name="music" value="${k}" ${A.music === k ? 'checked' : ''}>
      <span><b>${esc(n)}</b><small>${esc(d)}</small></span>
      ${k === 'none' ? '<span></span>' : k === 'custom' ? '<button class="listen sm" data-up="1" type="button">選擇檔案</button>' : `<button class="listen sm" data-k="${k}" type="button">▶ 試聽</button>`}
    </label>`).join('');
}
$('#musicList').addEventListener('change', async e => {
  if (e.target.name !== 'music') return;
  if (e.target.value === 'custom' && !customBuf) { $('#fileMusic').click(); renderMusic(); return; }
  P.audio.music = e.target.value; renderMusic(); changed({ thumbs: false });
});
$('#musicList').addEventListener('click', async e => {
  const b = e.target.closest('button'); if (!b) return;
  e.preventDefault();
  if (b.dataset.up) { $('#fileMusic').click(); return; }
  playBuf(await SGAudio.getLoop(b.dataset.k, 48000), b, true, 12);
});
$('#fileMusic').onchange = async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try { await setCustomMusic(f.name, f.type, await f.arrayBuffer()); P.audio.music = 'custom'; renderMusic(); changed({ thumbs: false }); toast('已載入音樂：' + f.name); }
  catch (err) { toast('這個音樂檔無法讀取，請換 MP3 或 WAV'); }
};
function renderPacks() {
  const A = P.audio;
  $('#packList').innerHTML = Object.entries(SGAudio.PACKS).map(([k, v]) => `
    <label class="choice ${A.sfxPack === k ? 'on' : ''}"><input type="radio" name="pack" value="${k}" ${A.sfxPack === k ? 'checked' : ''}>
      <span><b>${esc(v.name)}</b><small>${esc(v.desc)}</small></span>
      <button class="listen sm" data-k="${k}" type="button">▶ 試聽</button></label>`).join('');
  $('#evList').innerHTML = Object.entries(SGAudio.EVENTS).map(([k, v]) => `
    <div class="ev"><label><input type="checkbox" data-ev="${k}" ${A.ev[k] ? 'checked' : ''}> ${esc(v)}</label><button data-k="${k}" type="button" aria-label="試聽${esc(v)}">▶</button></div>`).join('');
}
$('#packList').addEventListener('change', e => { if (e.target.name === 'pack') { P.audio.sfxPack = e.target.value; renderPacks(); changed({ thumbs: false }); } });
async function packDemo(pack) {
  const sr = 48000, ac = new OfflineAudioContext(2, sr * 5, sr);
  // 用小型時間軸模擬：題目出現、倒數、揭曉
  const fake = { ...clone(P), audio: { ...P.audio, sfxPack: pack, music: 'none', ev: { intro: false, pop: true, tick: true, final: true, reveal: true, outro: false } }, timing: { intro: 0.01, think: 4, answer: 1, outro: 0.01 } };
  fake.type = 'match'; fake.match = { ...P.match, items: [{ text: '試聽', isMatch: true }] };
  return SGAudio.renderMix(fake, SG.buildTimeline(fake), sr);
}
$('#packList').addEventListener('click', async e => { const b = e.target.closest('button'); if (!b) return; e.preventDefault(); playBuf(await packDemo(b.dataset.k), b); });
$('#evList').addEventListener('change', e => { const k = e.target.dataset.ev; if (k) { P.audio.ev[k] = e.target.checked; changed({ thumbs: false }); } });
$('#evList').addEventListener('click', async e => {
  const b = e.target.closest('button'); if (!b) return;
  let k = b.dataset.k; if (k === 'reveal') k = 'yes'; if (k === 'final' && P.audio.sfxPack === 'show') k = 'roll';
  playBuf(await SGAudio.previewSfx(P.audio.sfxPack, k, P.audio.sfxVol || .8), null);
});

/* ---------- 主題與文字 ---------- */
function drawThumbs() {
  if ($('#tab-look').hidden) return;
  const grid = $('#themeGrid');
  if (!grid.children.length) {
    grid.innerHTML = Object.entries(SG.THEMES).map(([k, v]) => `<button class="theme" data-k="${k}" type="button"><canvas width="480" height="270"></canvas><span>${esc(v.name)}</span></button>`).join('');
    grid.onclick = e => { const b = e.target.closest('.theme'); if (!b) return; P.theme = b.dataset.k; P.customColor = ''; syncColor(); changed(); };
  }
  const q = tl.segs.find(s => s.type === 'q'), t = q ? q.start + 1.6 : 2;
  [...grid.children].forEach(b => {
    b.classList.toggle('on', b.dataset.k === P.theme);
    const c = b.querySelector('canvas'), ctx = c.getContext('2d');
    SG.renderFrame(ctx, { ...P, theme: b.dataset.k, customColor: b.dataset.k === P.theme ? P.customColor : '' }, tl, t, SG.getImg);
  });
}
function syncColor() { $('#fColor').value = P.customColor || SG.THEMES[P.theme].primary; }
$('#fColor').addEventListener('input', e => { P.customColor = e.target.value; changed(); });
$('#btnColorReset').onclick = () => { P.customColor = ''; syncColor(); changed(); };
$('#fFont').value = P.font || 'auto';
$('#fFont').onchange = e => { P.font = e.target.value; changed(); };
const LABEL_NAMES = {
  ready: '開場：準備提示', matchAsk: '配對：題目上方提示', matchYes: '配對：符合', matchNo: '配對：不符合', doIt: '配對：動作卡標題',
  oppCmd: '相反：指令標籤', oppThink: '相反：思考提示', oppAnswer: '相反：答案標籤', oppDo: '相反：做動作提示', done: '結尾：大標', count: '結尾：題數（{n} 會換成題數）',
};
function renderLabels() {
  $('#labelFields').innerHTML = Object.entries(LABEL_NAMES).map(([k, n]) => `
    <div class="field"><label for="lb-${k}">${esc(n)}</label><input type="text" id="lb-${k}" data-lb="${k}" maxlength="30" value="${esc(P.labels[k] ?? SG.DEFAULT_LABELS[k])}"></div>`).join('');
}
$('#labelFields').addEventListener('input', e => {
  const k = e.target.dataset.lb; if (!k) return;
  const v = e.target.value;
  if (v === SG.DEFAULT_LABELS[k] || v === '') delete P.labels[k]; else P.labels[k] = v;
  changed();
});
$('#btnLabelReset').onclick = () => { P.labels = {}; renderLabels(); changed(); };

/* ---------- 教案檔案 ---------- */
function download(blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}
const safeName = s => (s || '簡報遊戲').replace(/[\\/:*?"<>|]+/g, '').trim() || '簡報遊戲';
function abToB64(ab) { let s = ''; const u = new Uint8Array(ab); for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); }
function b64ToAb(b) { const s = atob(b), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u.buffer; }
$('#btnSave').onclick = () => {
  const out = clone(P);
  if (P.audio.music === 'custom' && customRaw) out.customMusic = { name: customRaw.name, type: customRaw.type, b64: abToB64(customRaw.data) };
  download(new Blob([JSON.stringify(out)], { type: 'application/json' }), safeName(P.title) + '.教案.json');
  toast('已存成教案檔，下次按「開啟教案」就能繼續編輯');
};
$('#btnOpen').onclick = () => $('#fileOpen').click();
$('#fileOpen').onchange = async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try {
    const o = JSON.parse(await f.text());
    if (!o || !o.match || !o.opposite) throw new Error();
    const cm = o.customMusic; delete o.customMusic;
    P = merge(defaults(), o);
    if (cm) await setCustomMusic(cm.name, cm.type, b64ToAb(cm.b64));
    loadUI(); seek(0); toast('已開啟：' + (P.title || f.name));
  } catch (err) { toast('這不是教案檔，無法開啟'); }
};
$('#btnNew').onclick = () => {
  if (!confirm('要開始新的教案嗎？目前的內容會被清空（建議先「儲存教案」）。')) return;
  const type = P.type; P = defaults(); P.type = type; P.title = DEF_TITLE[type]; P.subtitle = DEF_SUB[type];
  if (type === 'opposite') P.match.items = []; else P.opposite.items = [];
  loadUI(); seek(0);
};

/* ---------- 匯出影片 ---------- */
const dlg = $('#dlgExport');
let res = 1080, ctrl = null, lastUrl = null;
segCtl('#resCtl', () => res, v => { res = +v; });
$('#btnExport').onclick = () => {
  if (!tl.items.length) { toast('請先新增至少一題'); return; }
  pause();
  $('#expMeta').textContent = `「${P.title || '簡報遊戲'}」・${tl.items.length} 題・長度 ${fmt(tl.duration)}`;
  $('#expBar').style.width = '0';
  $('#expStatus').className = 'status';
  $('#expStatus').textContent = 'MP4 格式，可直接上傳 YouTube。匯出時請不要關閉這個分頁。';
  $('#expGo').hidden = false; $('#expGo').disabled = false; $('#expDl').hidden = true;
  $('#expClose').textContent = '關閉';
  dlg.showModal();
};
$('#expGo').onclick = async () => {
  ctrl = new AbortController();
  $('#expGo').disabled = true; $('#expClose').textContent = '取消匯出';
  $$('#resCtl button').forEach(b => b.disabled = true);
  try {
    const blob = await SGExport.exportVideo(clone(P), { height: res, fps: 30, customBuf: P.audio.music === 'custom' ? customBuf : null },
      (k, msg) => { $('#expBar').style.width = (k * 100).toFixed(1) + '%'; $('#expStatus').textContent = msg; }, ctrl.signal);
    if (lastUrl) URL.revokeObjectURL(lastUrl);
    lastUrl = URL.createObjectURL(blob);
    const ext = blob.type.includes('mp4') ? 'mp4' : 'webm';
    const a = $('#expDl'); a.href = lastUrl; a.download = `${safeName(P.title)}.${ext}`; a.hidden = false;
    a.textContent = `下載影片（${(blob.size / 1048576).toFixed(1)} MB）`;
    $('#expBar').style.width = '100%';
    $('#expStatus').textContent = ext === 'mp4' ? '完成！下載後就能直接上傳到 YouTube。' : '完成！（此瀏覽器只能輸出 WebM，YouTube 也接受；想要 MP4 請用 Chrome 或 Edge）';
    $('#expGo').hidden = true;
  } catch (err) {
    $('#expStatus').className = 'status err';
    $('#expStatus').textContent = err.name === 'AbortError' ? '已取消匯出。' : '匯出失敗：' + (err.message || err) + '（建議使用最新版 Chrome 或 Edge）';
    $('#expGo').disabled = false;
    window.REPORT_CONTEXT = { exportError: String(err && (err.stack || err.message || err)), ua: navigator.userAgent };
  } finally {
    ctrl = null; $('#expClose').textContent = '關閉';
    $$('#resCtl button').forEach(b => b.disabled = false);
  }
};
$('#expClose').onclick = () => { if (ctrl) ctrl.abort(); else dlg.close(); };
dlg.addEventListener('cancel', e => { if (ctrl) { e.preventDefault(); ctrl.abort(); } });

/* ---------- 啟動 ---------- */
function loadUI() {
  ['#fTitle', '#fSubtitle', '#fYes', '#fNo', '#fRule', '#fEnding', '#fDesigner', '#fOrg'].forEach(s => {
    const map = { '#fTitle': P.title, '#fSubtitle': P.subtitle, '#fYes': P.match.yesAction, '#fNo': P.match.noAction, '#fRule': P.opposite.rule, '#fEnding': P.ending, '#fDesigner': P.credits.designer, '#fOrg': P.credits.org };
    $(s).value = map[s] ?? '';
  });
  const sl = { '#tIntro': P.timing.intro, '#tThink': P.timing.think, '#tAnswer': P.timing.answer, '#tOutro': P.timing.outro, '#musicVol': Math.round(P.audio.musicVol * 100), '#sfxVol': Math.round(P.audio.sfxVol * 100) };
  for (const s in sl) { $(s).value = sl[s]; $(s).dispatchEvent(new Event('input')); }
  $('#fWatermark').checked = !!P.credits.watermark; $('#duck').checked = P.audio.duck; $('#fFont').value = P.font || 'auto';
  $('#btnShuffle').hidden = P.order !== 'random';
  $$('#orderCtl button').forEach(b => b.classList.toggle('on', b.dataset.v === P.order));
  if (P.audio.music === 'custom' && !customBuf) P.audio.music = 'happy';
  applyType(); renderMatch(); renderOpp(); renderMusic(); renderPacks(); renderLabels(); syncColor();
  changed();
}
(async () => {
  try { const m = await idbGet('music'); if (m && m.data) await setCustomMusic(m.name, m.type, m.data, false); } catch (e) { /* ignore */ }
  loadUI(); setPlayIcon(); pv.t = 1.5;
  await SG.ready(P); dirty = true;
  requestAnimationFrame(t => { pv.last = t; frame(t); });
  window.__sgv = { get P() { return P; }, get tl() { return tl; }, seek, play, pause };
})();
})();
