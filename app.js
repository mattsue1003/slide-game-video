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

function defaults() {
  return {
    version: 2, type: 'match',
    title: DEF_TITLE.match, subtitle: DEF_SUB.match,
    theme: 'warm', font: 'auto', customColor: '',
    timing: { intro: 7, think: 5, answer: 3, outro: 6 },
    order: 'random', seed: 1, ending: '大家都做得很棒！',
    credits: { designer: '鍾孟修 職能治療師', org: '愛迪樂健康促進團隊', watermark: false },
    labels: {},
    audio: { music: 'happy', musicVol: .45, duck: true, sfxPack: 'classic', sfxVol: .8, customName: '',
      ev: { intro: true, pop: true, tick: true, final: true, reveal: true, outro: true } },
    match: { yesAction: '雙手比圈', noAction: '雙手比叉', items: [] },
    opposite: { rule: '看到指令，做出「相反動作」！', items: SG.OPP_PRESETS.slice(0, 16).map(clone) },
    stickers: [],
  };
}
// 原題庫：Gemini 生成的插畫（bank/ 資料夾），每張圖一題
function sampleMatch() {
  return [['apple', '蘋果', true], ['banana', '小黃瓜', false], ['puppy', '小狗', true], ['car', '公車', false],
    ['umbrella', '雨傘', true], ['cat', '老虎', false], ['sunflower', '向日葵', true], ['bicycle', '摩托車', false],
    ['watermelon', '西瓜', true], ['goldfish', '烏龜', false], ['soccer', '足球', true], ['airplane', '直升機', false],
    ['bread', '麵包', true], ['moon', '太陽', false], ['strawberry', '草莓', true], ['cake', '生日蛋糕', true]]
    .map(([k, text, isMatch]) => ({ img: 'bank/' + k + '.webp', text, isMatch }));
}
const OLD_SAMPLE = '蘋果,西瓜,小狗,飛機,雨傘';
function merge(base, o) {
  for (const k in o) {
    if (o[k] && typeof o[k] === 'object' && !Array.isArray(o[k]) && base[k] && typeof base[k] === 'object') merge(base[k], o[k]);
    else if (o[k] !== undefined) base[k] = o[k];
  }
  return base;
}
let P;
try {
  const s = localStorage.getItem(KEY), o = s ? JSON.parse(s) : null;
  // 舊版存檔：作者欄是空的就填入新的預設作者
  if (o && (o.version || 1) < 2) {
    if (o.credits && !o.credits.designer && !o.credits.org) delete o.credits;
    if (o.timing && o.timing.answer === 4) o.timing.answer = o.type === 'opposite' ? 2 : 3;
    if (o.order === 'seq') o.order = 'random';
    // 舊版的符號範例圖換成新的插畫題庫
    if (o.match && o.match.items && o.match.items.map(i => i.text).join(',') === OLD_SAMPLE) o.match.items = sampleMatch();
    if (o.opposite && o.opposite.items && o.opposite.items.length === 4 && o.opposite.items[0].prompt === '右手舉高') o.opposite.items = SG.OPP_PRESETS.slice(0, 16).map(clone);
  }
  // 只用了 4 張圖的暫時題庫，換成 16 張完整題庫
  if (o && o.match && o.match.items && o.match.items.length && o.match.items.every(i => /^bank\//.test(i.img || '')) && new Set(o.match.items.map(i => i.img)).size <= 4) o.match.items = sampleMatch();
  P = o ? merge(defaults(), o) : null; if (P) P.version = 2;
} catch (e) { P = null; }
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
  catch (e) { toast('圖片太多，自動儲存空間不足，請按「下載教案」存成檔案'); }
}
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 3200); }

/* ---------- 預覽播放器 ---------- */
const cv = $('#cv'), cx = cv.getContext('2d');
const pv = { t: 0, playing: false, last: 0 };
let dirty = true, selSticker = null;
SG.onAsset = () => { dirty = true; };
function frame(ts) {
  if (pv.playing) {
    pv.t += (ts - pv.last) / 1000;
    if (audio.src && audio.ctx) pv.t = audio.offset + (audio.ctx.currentTime - audio.startAt);
    if (pv.t >= tl.duration) { pv.t = tl.duration - .001; pause(); }
    dirty = true;
  }
  pv.last = ts;
  if (dirty || pv.playing || (ts | 0) % 2 === 0) { SG.renderFrame(cx, selSticker != null && !pv.playing && !document.fullscreenElement ? { ...P, _sel: selSticker } : P, tl, pv.t, SG.getImg); dirty = false; updateHead(); }
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
  // 相反動作預設揭曉 2 秒、圖文配對 3 秒（使用者沒改過才自動換）
  const AD = { match: 3, opposite: 2 };
  if (P.timing.answer === AD[old]) { P.timing.answer = AD[P.type]; $('#tAnswer').value = P.timing.answer; $('#tAnswer').dispatchEvent(new Event('input')); }
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
  if (el.step === '0.5') show = v => (Number.isInteger(v) ? v : v.toFixed(1)) + ' 秒';
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
$('#oppPreset').innerHTML = '<option value="">從範例加入…</option><option value="all">全部範例（' + SG.OPP_PRESETS.length + ' 題）</option>' + SG.OPP_PRESETS.map((x, i) => `<option value="${i}">${esc(x.prompt)} → ${esc(x.answer)}</option>`).join('');
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
    grid.onclick = e => { const b = e.target.closest('.theme'); if (!b) return; P.theme = b.dataset.k; P.customColor = ''; syncColor(); renderFonts(); changed(); };
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
function renderFonts() {
  const T = SG.THEMES[P.theme] || SG.THEMES.warm, auto = SG.FONT_NAMES[T.font || 'hei'];
  const opts = [['auto', '跟著主題', SG.FONTS[T.font || 'hei'], auto], ...Object.entries(SG.FONT_NAMES).map(([k, n]) => [k, n, SG.FONTS[k], ''])];
  $('#fontGrid').innerHTML = opts.map(([k, n, fam, note]) => `<button type="button" class="font-opt${(P.font || 'auto') === k ? ' on' : ''}" data-k="${k}" role="radio" aria-checked="${(P.font || 'auto') === k}">
    <span class="fs" style='font-family:${fam.replace(/'/g, '')}'>大家一起動</span><small>${esc(n)}${note ? '（' + esc(note) + '）' : ''}</small></button>`).join('');
}
$('#fontGrid').addEventListener('click', e => { const b = e.target.closest('.font-opt'); if (!b) return; P.font = b.dataset.k; renderFonts(); changed(); });
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
  toast('已存成教案檔，下次按「上傳教案」就能繼續編輯');
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
function loadBank(type) {
  const n = 16;
  if (!confirm(`要帶入原題庫（${n} 題）嗎？目前清單裡的題目會被換掉。`)) return;
  if (type === 'match') { P.match.items = sampleMatch(); renderMatch(); }
  else { P.opposite.items = SG.OPP_PRESETS.slice(0, 16).map(clone); renderOpp(); }
  changed(); SG.ready(P).then(() => { dirty = true; });
  toast(`已帶入 ${n} 題原題庫`);
}
$('#btnBankMatch').onclick = () => loadBank('match');
$('#btnBankOpp').onclick = () => loadBank('opposite');
$('#btnNew').onclick = () => {
  if (!confirm('要開始新的教案嗎？目前的內容會被清空（建議先「下載教案」）。')) return;
  const type = P.type; P = defaults(); P.type = type; P.title = DEF_TITLE[type]; P.subtitle = DEF_SUB[type];
  if (type === 'opposite') { P.match.items = []; P.timing.answer = 2; } else P.opposite.items = [];
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
  SGExport.unlock();   // 手機：在點擊當下先解鎖聲音，之後的即時錄影才會有音樂音效
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

/* ---------- Logo／圖片圖層 ---------- */
const WHERE = { all: '整支影片', intro: '只在開場和結尾', game: '只在題目中' };
const POS = [['左上', .1, .12], ['中上', .5, .1], ['右上', .9, .12], ['左下', .1, .86], ['右下', .9, .86], ['正中', .5, .5]];
function renderStickers() {
  const L = P.stickers || (P.stickers = []);
  $('#stickerList').innerHTML = L.length ? L.map((st, i) => `
    <div class="item sticker${selSticker === i ? ' sel' : ''}" data-i="${i}">
      <div class="st-thumb"><img src="${st.img}" alt=""></div>
      <div class="st-body">
        <div class="st-row">
          <select data-f="where" class="sm" aria-label="出現時機">${Object.entries(WHERE).map(([k, v]) => `<option value="${k}"${st.where === k ? ' selected' : ''}>${v}</option>`).join('')}</select>
          <select data-f="pos" class="sm" aria-label="快速位置"><option value="">移到…</option>${POS.map(([n], k) => `<option value="${k}">${n}</option>`).join('')}</select>
        </div>
        <label class="st-size">大小 <input type="range" data-f="h" min="4" max="80" step="1" value="${Math.round((st.h || .14) * 100)}"></label>
        <label class="st-size">透明度 <input type="range" data-f="opacity" min="10" max="100" step="5" value="${Math.round((st.opacity ?? 1) * 100)}"></label>
        <div class="st-row">
          <button class="sm ghost" data-act="edit">重新裁剪／去背</button>
          <button class="sm ghost" data-act="up" ${i ? '' : 'disabled'}>上移</button>
          <button class="sm ghost danger" data-act="del">刪除</button>
        </div>
      </div>
    </div>`).join('') : '<p class="hint empty">還沒有圖片。可以放單位 Logo、吉祥物或裝飾貼圖。</p>';
}
$('#btnAddSticker').onclick = () => { cropTarget = null; $('#fileSticker').value = ''; $('#fileSticker').click(); };
$('#fileSticker').onchange = async e => { const f = e.target.files[0]; if (f) openCrop(await fileToImage(f), null); };
$('#stickerList').addEventListener('input', e => {
  const row = e.target.closest('.sticker'); if (!row) return;
  const st = P.stickers[+row.dataset.i], f = e.target.dataset.f;
  if (f === 'h') st.h = +e.target.value / 100;
  else if (f === 'opacity') st.opacity = +e.target.value / 100;
  else return;
  selSticker = +row.dataset.i; changed({ thumbs: false });
});
$('#stickerList').addEventListener('change', e => {
  const row = e.target.closest('.sticker'); if (!row) return;
  const i = +row.dataset.i, st = P.stickers[i], f = e.target.dataset.f;
  if (f === 'where') { st.where = e.target.value; if (st.where === 'game' && tl.segs[1]) seek(tl.segs[1].start + 1); else if (st.where === 'intro') seek(1.5); }
  else if (f === 'pos' && e.target.value !== '') { const [, x, y] = POS[+e.target.value]; st.x = x; st.y = y; e.target.value = ''; }
  selSticker = i; changed({ thumbs: false });
});
$('#stickerList').addEventListener('click', e => {
  const row = e.target.closest('.sticker'); if (!row) return;
  const i = +row.dataset.i, b = e.target.closest('button');
  selSticker = i; dirty = true;
  if (!b) { $$('#stickerList .sticker').forEach(x => x.classList.toggle('sel', x === row)); return; }
  if (b.dataset.act === 'del') { P.stickers.splice(i, 1); selSticker = null; }
  else if (b.dataset.act === 'up') { [P.stickers[i - 1], P.stickers[i]] = [P.stickers[i], P.stickers[i - 1]]; selSticker = i - 1; }
  else if (b.dataset.act === 'edit') { const st = P.stickers[i]; cropTarget = i; loadImage(st.src || st.img).then(im => openCrop(im, st.crop)); return; }
  renderStickers(); changed({ thumbs: false });
});

/* 在預覽畫面上拖曳圖片、拖右下角縮放 */
function cvPoint(e) { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width * SG.W, y: (e.clientY - r.top) / r.height * SG.H }; }
function hitSticker(pt) {
  const L = P.stickers || [];
  for (let i = L.length - 1; i >= 0; i--) {
    const img = SG.getImg(L[i].img); if (!img.naturalWidth) continue;
    const r = SG.stickerRect(L[i], img);
    if (pt.x >= r.x - 10 && pt.x <= r.x + r.w + 26 && pt.y >= r.y - 10 && pt.y <= r.y + r.h + 26) return { i, r, corner: pt.x > r.x + r.w - 30 && pt.y > r.y + r.h - 30 };
  }
  return null;
}
cv.addEventListener('pointerdown', e => {
  if (document.fullscreenElement) return;
  const pt = cvPoint(e), hit = hitSticker(pt);
  if (!hit) { if (selSticker != null) { selSticker = null; dirty = true; renderStickers(); } return; }
  e.preventDefault(); cv.setPointerCapture(e.pointerId);
  if (pv.playing) pause();
  selSticker = hit.i; renderStickers(); dirty = true;
  const st = P.stickers[hit.i], x0 = st.x, y0 = st.y, h0 = st.h || .14;
  cv.onpointermove = ev => {
    const q = cvPoint(ev);
    if (hit.corner) { const top = hit.r.y; st.h = Math.max(.03, Math.min(.95, (q.y - top) / SG.H)); st.y = (top + st.h * SG.H / 2) / SG.H; st.x = x0 + (st.h - h0) * SG.H * (hit.r.w / hit.r.h) / 2 / SG.W; }
    else { st.x = Math.max(0, Math.min(1, x0 + (q.x - pt.x) / SG.W)); st.y = Math.max(0, Math.min(1, y0 + (q.y - pt.y) / SG.H)); }
    dirty = true;
  };
  cv.onpointerup = () => { cv.onpointermove = null; cv.onpointerup = null; renderStickers(); changed({ thumbs: false }); };
});
cv.addEventListener('pointermove', e => {
  if (cv.onpointermove || document.fullscreenElement) return;
  const hit = hitSticker(cvPoint(e)); cv.style.cursor = hit ? (hit.corner ? 'nwse-resize' : 'move') : '';
});

/* ---------- 裁剪與去背 ---------- */
let cropTarget = null;
const CR = { img: null, src: null, cut: null, rect: null, shape: 'free', bg: 'none', key: null, picking: false, aiCanvas: null };
const ccv = $('#cropCv'), cctx = ccv.getContext('2d');
function loadImage(src) { return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = src; }); }
function fileToImage(f) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => loadImage(r.result).then(res, rej); r.onerror = rej; r.readAsDataURL(f); }); }
function openCrop(im, crop) {
  const M = 1600, s = Math.min(1, M / Math.max(im.naturalWidth, im.naturalHeight));
  const c = document.createElement('canvas'); c.width = Math.round(im.naturalWidth * s); c.height = Math.round(im.naturalHeight * s);
  c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
  CR.src = c; CR.aiCanvas = null;
  CR.shape = crop?.shape || 'free'; CR.bg = crop?.bg === 'ai' ? 'none' : (crop?.bg || 'none'); CR.key = crop?.key || cornerColor(c); CR.picking = false;
  $('#tol').value = crop?.tol ?? 40; $('#tolAll').checked = !!crop?.all;
  CR.rect = crop?.rect ? { ...crop.rect } : { x: 0, y: 0, w: c.width, h: c.height };
  syncCropUI(); processCut(); $('#dlgCrop').showModal();
  $('#cropStatus').textContent = '拖曳框線調整範圍；拖曳框內可移動。';
}
function cornerColor(c) {
  const x = c.getContext('2d'), w = c.width, h = c.height, pts = [[1, 1], [w - 2, 1], [1, h - 2], [w - 2, h - 2]];
  const acc = [0, 0, 0]; pts.forEach(([a, b]) => { const d = x.getImageData(a, b, 1, 1).data; acc[0] += d[0]; acc[1] += d[1]; acc[2] += d[2]; });
  return acc.map(v => Math.round(v / 4));
}
function syncCropUI() {
  $$('#cropShape button').forEach(b => b.classList.toggle('on', b.dataset.v === CR.shape));
  $$('#cropBg button').forEach(b => b.classList.toggle('on', b.dataset.v === CR.bg));
  $('#colorOpts').hidden = CR.bg !== 'color';
  $('#keySwatch').style.background = `rgb(${CR.key.join(',')})`;
  $('#btnPick').classList.toggle('on', CR.picking);
}
/* 去除背景色：從邊緣往內連通填色（或整張同色），邊緣做柔化 */
function removeColor(src, key, tol, all) {
  const w = src.width, h = src.height, c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d'); x.drawImage(src, 0, 0);
  const id = x.getImageData(0, 0, w, h), d = id.data, n = w * h;
  const dist = new Float32Array(n);
  for (let i = 0; i < n; i++) { const r = d[i * 4] - key[0], g = d[i * 4 + 1] - key[1], b = d[i * 4 + 2] - key[2]; dist[i] = Math.sqrt(r * r * .3 + g * g * .59 + b * b * .11) * 1.6; }
  const soft = tol * 0.5, lim = tol + soft;
  let mark;
  if (all) mark = null;
  else {
    mark = new Uint8Array(n); const st = [];
    for (let i = 0; i < w; i++) { st.push(i, (h - 1) * w + i); }
    for (let j = 0; j < h; j++) { st.push(j * w, j * w + w - 1); }
    while (st.length) {
      const i = st.pop(); if (mark[i] || dist[i] > lim) continue; mark[i] = 1;
      const px = i % w;
      if (px > 0) st.push(i - 1); if (px < w - 1) st.push(i + 1); if (i >= w) st.push(i - w); if (i < n - w) st.push(i + w);
    }
  }
  for (let i = 0; i < n; i++) {
    if (mark && !mark[i]) continue;
    const dd = dist[i]; if (dd > lim) continue;
    const a = dd <= tol ? 0 : (dd - tol) / soft;
    d[i * 4 + 3] = Math.round(d[i * 4 + 3] * a);
  }
  x.putImageData(id, 0, 0); return c;
}
async function aiRemove() {
  if (CR.aiCanvas) return CR.aiCanvas;
  $('#cropStatus').textContent = 'AI 去背中…第一次使用要下載模型（約 40MB），請稍候。';
  const mod = await import('https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.7.0/+esm');
  const blob = await new Promise(r => CR.src.toBlob(r, 'image/png'));
  const out = await mod.removeBackground(blob, { progress: (k, cur, tot) => { if (tot) $('#cropStatus').textContent = `AI 去背：下載模型 ${Math.round(cur / tot * 100)}%`; } });
  const im = await loadImage(URL.createObjectURL(out));
  const c = document.createElement('canvas'); c.width = CR.src.width; c.height = CR.src.height; c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
  CR.aiCanvas = c; return c;
}
let cutTimer;
function processCut() {
  clearTimeout(cutTimer);
  cutTimer = setTimeout(async () => {
    try {
      if (CR.bg === 'color') CR.cut = removeColor(CR.src, CR.key, +$('#tol').value, $('#tolAll').checked);
      else if (CR.bg === 'ai') { $('#cropOk').disabled = true; CR.cut = await aiRemove(); $('#cropStatus').textContent = 'AI 去背完成。邊緣不理想可以改用「去除背景色」。'; }
      else CR.cut = CR.src;
    } catch (err) {
      console.error(err); CR.bg = 'none'; CR.cut = CR.src; syncCropUI();
      $('#cropStatus').textContent = 'AI 去背失敗（可能是網路或瀏覽器不支援），請改用「去除背景色」。';
    }
    $('#cropOk').disabled = false; drawCrop();
  }, CR.bg === 'color' ? 60 : 0);
}
let CV = { s: 1, ox: 0, oy: 0 };
function drawCrop() {
  const c = CR.cut || CR.src; if (!c) return;
  const W2 = ccv.width, H2 = ccv.height;
  cctx.clearRect(0, 0, W2, H2);
  for (let y = 0; y < H2; y += 20) for (let x = 0; x < W2; x += 20) { cctx.fillStyle = ((x + y) / 20) % 2 ? '#E6E1DA' : '#FFFFFF'; cctx.fillRect(x, y, 20, 20); }
  const s = Math.min((W2 - 40) / c.width, (H2 - 40) / c.height), ox = (W2 - c.width * s) / 2, oy = (H2 - c.height * s) / 2;
  CV = { s, ox, oy };
  cctx.drawImage(c, ox, oy, c.width * s, c.height * s);
  const r = CR.rect, rx = ox + r.x * s, ry = oy + r.y * s, rw = r.w * s, rh = r.h * s;
  cctx.save(); cctx.fillStyle = 'rgba(30,20,10,.5)'; cctx.beginPath(); cctx.rect(0, 0, W2, H2);
  if (CR.shape === 'circle') cctx.ellipse(rx + rw / 2, ry + rh / 2, rw / 2, rh / 2, 0, 0, Math.PI * 2, true); else cctx.rect(rx + rw, ry, -rw, rh);
  cctx.fill('evenodd'); cctx.restore();
  cctx.strokeStyle = '#FFFFFF'; cctx.lineWidth = 2; cctx.setLineDash([8, 6]); cctx.strokeRect(rx, ry, rw, rh); cctx.setLineDash([]);
  cctx.fillStyle = '#E8632B'; [[rx, ry], [rx + rw, ry], [rx, ry + rh], [rx + rw, ry + rh]].forEach(([x, y]) => { cctx.fillRect(x - 9, y - 9, 18, 18); });
}
function cPoint(e) { const b = ccv.getBoundingClientRect(); const px = (e.clientX - b.left) / b.width * ccv.width, py = (e.clientY - b.top) / b.height * ccv.height; return { px, py, x: (px - CV.ox) / CV.s, y: (py - CV.oy) / CV.s }; }
function clampRect(r) {
  const W0 = CR.src.width, H0 = CR.src.height;
  r.w = Math.max(10, Math.min(W0, r.w)); r.h = Math.max(10, Math.min(H0, r.h));
  r.x = Math.max(0, Math.min(W0 - r.w, r.x)); r.y = Math.max(0, Math.min(H0 - r.h, r.y)); return r;
}
function squareRect() { const r = CR.rect, m = Math.min(r.w, r.h); CR.rect = clampRect({ x: r.x + (r.w - m) / 2, y: r.y + (r.h - m) / 2, w: m, h: m }); }
ccv.addEventListener('pointerdown', e => {
  const p0 = cPoint(e);
  if (CR.picking) {
    const x = Math.floor(p0.x), y = Math.floor(p0.y);
    if (x >= 0 && y >= 0 && x < CR.src.width && y < CR.src.height) { const d = CR.src.getContext('2d').getImageData(x, y, 1, 1).data; CR.key = [d[0], d[1], d[2]]; }
    CR.picking = false; syncCropUI(); processCut(); return;
  }
  ccv.setPointerCapture(e.pointerId);
  const r0 = { ...CR.rect }, tolPx = 16 / CV.s;
  const near = (a, b) => Math.abs(a - b) < tolPx;
  const L = near(p0.x, r0.x), R = near(p0.x, r0.x + r0.w), T = near(p0.y, r0.y), B = near(p0.y, r0.y + r0.h);
  const inside = p0.x > r0.x && p0.x < r0.x + r0.w && p0.y > r0.y && p0.y < r0.y + r0.h;
  const mode = (L || R || T || B) ? 'resize' : inside ? 'move' : 'new';
  const lock = CR.shape !== 'free';
  ccv.onpointermove = ev => {
    const p = cPoint(ev), dx = p.x - p0.x, dy = p.y - p0.y; let r = { ...r0 };
    if (mode === 'move') { r.x += dx; r.y += dy; }
    else if (mode === 'new') { r = { x: Math.min(p0.x, p.x), y: Math.min(p0.y, p.y), w: Math.abs(dx), h: Math.abs(dy) }; if (lock) { const m = Math.max(r.w, r.h); r.w = r.h = m; if (p.x < p0.x) r.x = p0.x - m; if (p.y < p0.y) r.y = p0.y - m; } }
    else {
      if (L) { r.x += dx; r.w -= dx; } if (R) r.w += dx; if (T) { r.y += dy; r.h -= dy; } if (B) r.h += dy;
      if (lock) { const m = Math.max(r.w, r.h); if (L) r.x = r0.x + r0.w - m; if (T) r.y = r0.y + r0.h - m; r.w = r.h = m; }
    }
    if (r.w < 0) { r.x += r.w; r.w = -r.w; } if (r.h < 0) { r.y += r.h; r.h = -r.h; }
    CR.rect = clampRect(r); if (lock && CR.rect.w !== CR.rect.h) squareRect(); drawCrop();
  };
  ccv.onpointerup = () => { ccv.onpointermove = null; };
});
$('#cropShape').onclick = e => { const b = e.target.closest('button'); if (!b) return; CR.shape = b.dataset.v; if (CR.shape !== 'free') squareRect(); syncCropUI(); drawCrop(); };
$('#cropBg').onclick = e => { const b = e.target.closest('button'); if (!b) return; CR.bg = b.dataset.v; syncCropUI(); processCut(); };
$('#cropAll').onclick = () => { CR.rect = { x: 0, y: 0, w: CR.src.width, h: CR.src.height }; if (CR.shape !== 'free') squareRect(); drawCrop(); };
$('#btnPick').onclick = () => { CR.picking = !CR.picking; syncCropUI(); $('#cropStatus').textContent = CR.picking ? '在圖片上點一下要去除的顏色。' : ''; };
$('#tol').oninput = processCut; $('#tolAll').onchange = processCut;
$('#cropCancel').onclick = () => $('#dlgCrop').close();
$('#cropOk').onclick = () => {
  const c = CR.cut || CR.src, r = CR.rect, M = 900, s = Math.min(1, M / Math.max(r.w, r.h));
  const o = document.createElement('canvas'); o.width = Math.max(1, Math.round(r.w * s)); o.height = Math.max(1, Math.round(r.h * s));
  const x = o.getContext('2d');
  if (CR.shape === 'circle') { x.beginPath(); x.ellipse(o.width / 2, o.height / 2, o.width / 2, o.height / 2, 0, 0, Math.PI * 2); x.clip(); }
  x.drawImage(c, r.x, r.y, r.w, r.h, 0, 0, o.width, o.height);
  let url = o.toDataURL('image/webp', .9); if (!url.startsWith('data:image/webp')) url = o.toDataURL('image/png');
  // 原圖（縮小版）一起存，之後可以重新裁剪
  let src = CR.src.toDataURL('image/webp', .85); if (!src.startsWith('data:image/webp')) src = CR.src.toDataURL('image/jpeg', .85);
  const crop = { rect: { ...r }, shape: CR.shape, bg: CR.bg, key: CR.key, tol: +$('#tol').value, all: $('#tolAll').checked };
  if (cropTarget != null && P.stickers[cropTarget]) Object.assign(P.stickers[cropTarget], { img: url, src, crop });
  else { P.stickers.push({ img: url, src, crop, x: .9, y: .12, h: .16, where: 'all', opacity: 1 }); cropTarget = P.stickers.length - 1; }
  selSticker = cropTarget;
  SG.getImg(url);
  $('#dlgCrop').close(); renderStickers(); changed({ thumbs: false });
  toast('已加入。可以直接在預覽畫面上拖曳位置，拖右下角方塊縮放。');
};

/* ---------- 啟動 ---------- */
function loadUI() {
  ['#fTitle', '#fSubtitle', '#fYes', '#fNo', '#fRule', '#fEnding', '#fDesigner', '#fOrg'].forEach(s => {
    const map = { '#fTitle': P.title, '#fSubtitle': P.subtitle, '#fYes': P.match.yesAction, '#fNo': P.match.noAction, '#fRule': P.opposite.rule, '#fEnding': P.ending, '#fDesigner': P.credits.designer, '#fOrg': P.credits.org };
    $(s).value = map[s] ?? '';
  });
  const sl = { '#tIntro': P.timing.intro, '#tThink': P.timing.think, '#tAnswer': P.timing.answer, '#tOutro': P.timing.outro, '#musicVol': Math.round(P.audio.musicVol * 100), '#sfxVol': Math.round(P.audio.sfxVol * 100) };
  for (const s in sl) { $(s).value = sl[s]; $(s).dispatchEvent(new Event('input')); }
  $('#fWatermark').checked = !!P.credits.watermark; $('#duck').checked = P.audio.duck; renderFonts(); renderStickers(); selSticker = null;
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
  setTimeout(() => SG.preloadFonts(P).then(() => { dirty = true; drawThumbs(); renderFonts(); }), 1200);
  requestAnimationFrame(t => { pv.last = t; frame(t); });
  window.__sgv = { get P() { return P; }, get tl() { return tl; }, seek, play, pause };
})();
})();
