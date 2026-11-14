/* 簡報遊戲影片工坊 — 背景音樂（程式即時合成，無版權問題）與音效
   預覽與匯出都用同一份「離線混音」結果，所以聽到的就是影片裡的聲音。 */
(function () {
'use strict';
const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
function rng(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const Q = { M: [0, 4, 7], m: [0, 3, 7], M7: [0, 4, 7, 11], m7: [0, 3, 7, 10] };

/* ---------- 合成器零件 ---------- */
const noiseBufs = new WeakMap();
function noiseBuf(ac) {
  let b = noiseBufs.get(ac);
  if (!b) {
    b = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const d = b.getChannelData(0), r = rng(5); for (let i = 0; i < d.length; i++) d[i] = r() * 2 - 1;
    noiseBufs.set(ac, b);
  }
  return b;
}
function env(g, t, v, a, d, hold = 0) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(v, 0.0002), t + a);
  if (hold) g.gain.setValueAtTime(Math.max(v, 0.0002), t + a + hold);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + hold + d);
}
function tone(ac, dest, o) {
  const { type = 'sine', f, f2, t, d = .3, v = .3, a = .005, hold = 0, lp, lpQ = 1, detune = 0 } = o;
  if (v <= 0) return;
  const os = ac.createOscillator(), g = ac.createGain();
  os.type = type; os.frequency.setValueAtTime(f, t); if (detune) os.detune.value = detune;
  if (f2) os.frequency.exponentialRampToValueAtTime(f2, t + a + hold + d);
  env(g, t, v, a, d, hold);
  let n = os;
  if (lp) { const fl = ac.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = lp; fl.Q.value = lpQ; os.connect(fl); n = fl; }
  n.connect(g).connect(dest); os.start(t); os.stop(t + a + hold + d + .05);
}
function noise(ac, dest, o) {
  const { t, d = .1, v = .3, a = .002, hp, lp, bp, q = 1, sweep } = o;
  if (v <= 0) return;
  const src = ac.createBufferSource(); src.buffer = noiseBuf(ac); src.loop = true;
  const g = ac.createGain(); let n = src;
  const add = (type, fq) => { const fl = ac.createBiquadFilter(); fl.type = type; fl.frequency.value = fq; fl.Q.value = q; n.connect(fl); n = fl; return fl; };
  if (hp) add('highpass', hp);
  if (lp) add('lowpass', lp);
  if (bp) { const fl = add('bandpass', bp); if (sweep) { fl.frequency.setValueAtTime(bp, t); fl.frequency.exponentialRampToValueAtTime(sweep, t + a + d); } }
  env(g, t, v, a, d);
  n.connect(g).connect(dest); src.start(t, Math.random() * 0.5); src.stop(t + a + d + .05);
}
const kick = (ac, o, t, v) => tone(ac, o, { f: 150, f2: 42, t, d: .32, v, a: .002 });
const snare = (ac, o, t, v) => { noise(ac, o, { t, d: .16, v, hp: 1500 }); tone(ac, o, { type: 'triangle', f: 220, f2: 150, t, d: .08, v: v * .5 }); };
const clap = (ac, o, t, v) => { for (let i = 0; i < 3; i++) noise(ac, o, { t: t + i * .012, d: i === 2 ? .14 : .02, v, bp: 1400, q: 1.2 }); };
const hat = (ac, o, t, v, open) => noise(ac, o, { t, d: open ? .18 : .035, v, hp: 7500 });
const chord = (ac, o, notes, t, d, v, type = 'triangle', lp) => notes.forEach(n => tone(ac, o, { type, f: mtof(n), t, d, v, lp }));

/* ---------- 背景音樂風格 ---------- */
const STYLES = {
  happy: {
    name: '歡樂活潑', desc: '輕快拍手節奏，適合一般帶動', bpm: 118, key: 60, prog: [[0, 'M'], [7, 'M'], [9, 'm'], [5, 'M']],
    step(ac, o, { s, t, spb, root, tones }) {
      if (s % 8 === 0) kick(ac, o, t, .85);
      if (s === 4 || s === 12) clap(ac, o, t, .4);
      if (s % 2 === 0) hat(ac, o, t, s % 4 === 2 ? .14 : .07);
      if (s % 2 === 0) tone(ac, o, { type: 'sawtooth', f: mtof(root - (s % 4 ? 12 : 24)), t, d: spb * .4, v: .22, lp: 650, lpQ: 3 });
      if (s % 4 === 2) chord(ac, o, tones, t, .16, .05);
      if (s % 2 === 0) { const arp = [0, 1, 2, 1, 0, 2, 1, 2]; tone(ac, o, { type: 'square', f: mtof(tones[arp[s / 2]] + 12), t, d: spb * .35, v: .025, lp: 2600 }); }
    },
  },
  tense: {
    name: '緊張刺激', desc: '快節奏低音脈動，適合搶答倒數', bpm: 136, key: 57, prog: [[0, 'm'], [8, 'M'], [3, 'M'], [10, 'M']],
    step(ac, o, { s, t, spb, root, tones }) {
      if (s % 4 === 0) kick(ac, o, t, 1);
      if (s === 4 || s === 12) clap(ac, o, t, .38);
      hat(ac, o, t, s % 4 === 2 ? .1 : .045, s % 4 === 2);
      if (s % 2 === 0) tone(ac, o, { type: 'sawtooth', f: mtof(root - (s % 8 === 6 ? 12 : 24)), t, d: spb * .38, v: .26, lp: 520, lpQ: 4 });
      if (s === 0 || s === 3 || s === 6 || s === 10) chord(ac, o, tones.map(n => n + 12), t, .1, .035, 'sawtooth', 2200);
      if (s % 2 === 0) tone(ac, o, { type: 'square', f: mtof((s % 4 ? tones[2] + 12 : tones[0] + 24)), t, d: .08, v: .022, lp: 3000 });
    },
  },
  sport: {
    name: '動感運動', desc: '強烈四拍大鼓，適合體適能', bpm: 124, key: 62, prog: [[0, 'm'], [10, 'M'], [8, 'M'], [7, 'M']],
    step(ac, o, { b, s, t, spb, root, tones }) {
      if (s % 4 === 0) kick(ac, o, t, 1);
      if (s === 4 || s === 12 || (b % 4 === 3 && s === 14)) clap(ac, o, t, .5);
      if (s % 4 === 2) hat(ac, o, t, .16, true); else hat(ac, o, t, .04);
      if (s % 2 === 0) tone(ac, o, { type: 'sawtooth', f: mtof(root - 24), t, d: spb * .32, v: .3, lp: 600, lpQ: 2 });
      if (s === 0 || s === 3 || s === 6 || (b % 2 && s === 12)) chord(ac, o, tones.map(n => n + 12), t, .2, .045, 'sawtooth', 1800);
    },
  },
  game: {
    name: '電玩冒險', desc: '8-bit 方波旋律，像在闖關', bpm: 128, key: 60, prog: [[0, 'M'], [9, 'm'], [5, 'M'], [7, 'M']],
    step(ac, o, { s, t, spb, root, tones, r }) {
      if (s % 8 === 0) kick(ac, o, t, .6);
      if (s % 8 === 4) noise(ac, o, { t, d: .1, v: .2, hp: 1000 });
      if (s % 2 === 0) noise(ac, o, { t, d: .02, v: .05, hp: 9000 });
      if (s % 2 === 0) tone(ac, o, { type: 'triangle', f: mtof(s % 4 ? root - 5 : root - 12), t, d: spb * .4, v: .3 });
      if (s % 2 === 0 && r() < .8) tone(ac, o, { type: 'square', f: mtof(tones[Math.floor(r() * tones.length)] + 12 + (r() < .3 ? 12 : 0)), t, d: spb * .42, v: .045 });
      tone(ac, o, { type: 'square', f: mtof(tones[s % 3] + 24), t, d: .04, v: .012 });
    },
  },
  funny: {
    name: '俏皮逗趣', desc: '彈跳的嗡-啪節奏，輕鬆好笑', bpm: 104, key: 65, prog: [[0, 'M'], [5, 'M'], [7, 'M'], [0, 'M']],
    step(ac, o, { s, t, root, tones, r }) {
      if (s % 8 === 0) tone(ac, o, { type: 'triangle', f: mtof(root - 24), t, d: .22, v: .4 });
      if (s % 8 === 4) tone(ac, o, { type: 'triangle', f: mtof(root - 17), t, d: .22, v: .35 });
      if (s % 4 === 2) chord(ac, o, tones, t, .09, .06);
      if (s % 8 === 6) tone(ac, o, { f: s % 16 === 6 ? 1250 : 950, t, d: .05, v: .09 });
      if (s % 2 === 0 && r() < .55) tone(ac, o, { type: 'triangle', f: mtof(tones[Math.floor(r() * 3)] + 12), t, d: .13, v: .08 });
    },
  },
  chill: {
    name: '溫柔放鬆', desc: '慢速鋼琴感，適合伸展、長者', bpm: 84, key: 65, prog: [[0, 'M7'], [-1, 'm7'], [-3, 'm7'], [-5, 'M7']],
    step(ac, o, { s, t, spb, root, tones, r }) {
      if (s === 0) kick(ac, o, t, .45);
      if (s === 10) kick(ac, o, t, .3);
      if (s === 8) noise(ac, o, { t, d: .05, v: .1, bp: 2500 });
      if (s % 4 === 2) hat(ac, o, t, .035);
      if (s === 0) chord(ac, o, tones, t, spb * 3.2, .03, 'sawtooth', 900);
      if (s === 0 || s === 8) tone(ac, o, { f: mtof(root - 24 + (s ? 7 : 0)), t, d: spb * 1.8, v: .28 });
      if (s % 4 === 0 && r() < .6) {
        const n = tones[Math.floor(r() * tones.length)] + 12 + (r() < .4 ? 12 : 0);
        tone(ac, o, { f: mtof(n), t, d: .9, v: .07 }); tone(ac, o, { f: mtof(n) * 4, t, d: .25, v: .012 });
      }
    },
  },  latin: {
    name: '拉丁派對', desc: '響棒、康加鼓，熱情又有律動', bpm: 112, key: 62, prog: [[0, 'm'], [5, 'm'], [7, 'M'], [0, 'm']],
    step(ac, o, { s, t, spb, root, tones, r }) {
      if (s === 0 || s === 3 || s === 6 || s === 10 || s === 12) tone(ac, o, { f: 2400, t, d: .035, v: .09 });
      if (s % 4 === 0) kick(ac, o, t, .7);
      if (s % 4 === 3 || s === 14) tone(ac, o, { f: s === 14 ? 330 : 260, f2: 190, t, d: .14, v: .2 });
      if (s % 2 === 1) noise(ac, o, { t, d: .05, v: .07, bp: 6000, q: .8 });
      if (s === 0 || s === 6 || s === 8 || s === 14) tone(ac, o, { type: 'triangle', f: mtof(root - 24 + (s >= 8 ? 7 : 0)), t, d: spb * .45, v: .34 });
      if (s === 2 || s === 5 || s === 10 || s === 13) chord(ac, o, tones.map(n => n + 12), t, .12, .05, 'square', 2000);
      if (s % 4 === 2 && r() < .6) tone(ac, o, { type: 'triangle', f: mtof(tones[Math.floor(r() * 3)] + 24), t, d: .2, v: .05 });
    },
  },
  march: {
    name: '精神進行曲', desc: '小鼓軍樂、銅管和弦，振奮有力', bpm: 112, key: 58, prog: [[0, 'M'], [5, 'M'], [7, 'M'], [0, 'M']],
    step(ac, o, { b, s, t, spb, root, tones }) {
      if (s % 8 === 0) kick(ac, o, t, .9);
      if (s % 8 === 4) noise(ac, o, { t, d: .5, v: .06, hp: 6000 });
      if (s % 2 === 0 || (s % 8 === 7)) snare(ac, o, t, s % 4 === 0 ? .2 : .1);
      if (s % 4 === 0) tone(ac, o, { type: 'sawtooth', f: mtof(root - 24 + (s % 8 ? 7 : 0)), t, d: spb * .5, v: .26, lp: 700 });
      if (s === 0 || s === 8 || (b % 2 && s === 12)) chord(ac, o, tones.map(n => n + 12), t, spb * (s === 12 ? .5 : 1.4), .05, 'sawtooth', 1600);
      if (s % 4 === 2) tone(ac, o, { type: 'square', f: mtof(tones[(s / 2 + b) % 3] + 24), t, d: spb * .3, v: .022, lp: 2500 });
    },
  },
};

const loopCache = new Map();
function getLoop(id, sr) {
  const key = id + '@' + sr;
  if (!loopCache.has(key)) loopCache.set(key, renderLoop(id, sr));
  return loopCache.get(key);
}
function renderLoop(id, sr) {
  const S = STYLES[id], spb = 60 / S.bpm, bar = spb * 4, bars = 8;
  const ac = new OfflineAudioContext(2, Math.ceil(bar * bars * sr), sr);
  const out = ac.createGain(); out.gain.value = .55; out.connect(ac.destination);
  const r = rng(11);
  for (let b = 0; b < bars; b++) {
    const [deg, q] = S.prog[b % S.prog.length], root = S.key + deg, tones = Q[q].map(i => root + i);
    for (let s = 0; s < 16; s++) S.step(ac, out, { b, s, t: b * bar + s * spb / 4, spb, root, tones, r });
  }
  return ac.startRendering();
}

/* ---------- 音效包 ---------- */
const PACKS = {
  classic: { name: '經典提示', desc: '清脆的滴答與叮咚' },
  game: { name: '電玩闖關', desc: '8-bit 嗶嗶、過關音' },
  show: { name: '綜藝節目', desc: '鼓聲滾奏、鈸聲、掌聲' },
  soft: { name: '木琴柔和', desc: '溫和不刺耳，適合長者' },
  cartoon: { name: '卡通搞笑', desc: '彈簧聲、滑哨、喇叭叭叭' },
  space: { name: '太空科幻', desc: '雷射、掃頻、電子嗶嗶' },
};
const EVENTS = {
  intro: '開場音效', pop: '題目出現', tick: '每秒滴答', final: '最後 3 秒倒數', reveal: '揭曉答案', outro: '結尾慶祝',
};
function marimba(ac, o, n, t, v, d = .5) { tone(ac, o, { f: mtof(n), t, d, v }); tone(ac, o, { f: mtof(n) * 4, t, d: d * .25, v: v * .25 }); }
function sfx(ac, o, pack, k, t, V, d) {
  const v = x => x * V;
  if (pack === 'game') {
    switch (k) {
      case 'tick': tone(ac, o, { type: 'square', f: 880, t, d: .04, v: v(.08) }); break;
      case 'final': tone(ac, o, { type: 'square', f: 1320, t, d: .1, v: v(.12) }); break;
      case 'pop': tone(ac, o, { type: 'square', f: 440, f2: 1100, t, d: .12, v: v(.1) }); break;
      case 'yes': [72, 76, 79, 84].forEach((n, i) => tone(ac, o, { type: 'square', f: mtof(n + 12), t: t + i * .07, d: i === 3 ? .35 : .07, v: v(.11) })); break;
      case 'no': tone(ac, o, { type: 'square', f: 300, f2: 90, t, d: .45, v: v(.12) }); break;
      case 'intro': tone(ac, o, { type: 'square', f: mtof(83), t, d: .08, v: v(.1) }); tone(ac, o, { type: 'square', f: mtof(88), t: t + .08, d: .4, v: v(.1) }); break;
      case 'outro': [60, 64, 67, 72, 76, 79, 84].forEach((n, i) => tone(ac, o, { type: 'square', f: mtof(n + 12), t: t + i * .08, d: i === 6 ? .6 : .08, v: v(.1) })); break;
    }
  } else if (pack === 'cartoon') {
    const boing = (tt, f, vv) => { tone(ac, o, { f, f2: f * 2.2, t: tt, d: .28, v: vv }); const os = ac.createOscillator(), lfo = ac.createOscillator(), lg = ac.createGain(), g = ac.createGain();
      os.frequency.value = f * 1.5; lfo.frequency.value = 22; lg.gain.value = f * .25; lfo.connect(lg).connect(os.frequency); env(g, tt, vv * .8, .005, .4); os.connect(g).connect(o); os.start(tt); lfo.start(tt); os.stop(tt + .45); lfo.stop(tt + .45); };
    switch (k) {
      case 'tick': tone(ac, o, { type: 'triangle', f: 700, f2: 500, t, d: .05, v: v(.14) }); break;
      case 'final': tone(ac, o, { type: 'square', f: 520, t, d: .09, v: v(.08), lp: 1800 }); tone(ac, o, { type: 'square', f: 525, t, d: .09, v: v(.08), lp: 1800 }); break;
      case 'pop': tone(ac, o, { f: 300, f2: 1400, t, d: .06, v: v(.22) }); noise(ac, o, { t: t + .05, d: .03, v: v(.15), bp: 2500, q: 3 }); break;
      case 'yes': boing(t, 220, v(.22)); tone(ac, o, { f: 600, f2: 2400, t: t + .2, d: .45, v: v(.12), a: .2 }); break;
      case 'no': [0, .22, .44].forEach((dt, i) => tone(ac, o, { type: 'sawtooth', f: 233 - i * 12, t: t + dt, d: i === 2 ? .5 : .16, v: v(.14), lp: 1100, a: .01 })); break;
      case 'intro': tone(ac, o, { f: 400, f2: 1800, t, d: .5, v: v(.14), a: .3 }); boing(t + .55, 260, v(.2)); break;
      case 'outro': [0, .16, .32].forEach(dt => tone(ac, o, { type: 'square', f: 440, t: t + dt, d: .1, v: v(.08), lp: 1500 }));
        boing(t + .5, 300, v(.22)); tone(ac, o, { f: 900, f2: 3000, t: t + .9, d: .5, v: v(.12), a: .25 }); break;
    }
  } else if (pack === 'space') {
    switch (k) {
      case 'tick': tone(ac, o, { type: 'sine', f: 1900, f2: 1500, t, d: .04, v: v(.1) }); break;
      case 'final': tone(ac, o, { type: 'sawtooth', f: 1200, f2: 600, t, d: .12, v: v(.1), lp: 3000 }); break;
      case 'pop': tone(ac, o, { type: 'sawtooth', f: 2400, f2: 160, t, d: .22, v: v(.12), lp: 4000 }); break;
      case 'yes': [0, 4, 7, 12, 16].forEach((n, i) => tone(ac, o, { type: 'sawtooth', f: mtof(72 + n), t: t + i * .05, d: i === 4 ? .5 : .06, v: v(.08), lp: 3500 })); noise(ac, o, { t, d: .6, v: v(.08), bp: 800, sweep: 6000, q: 3 }); break;
      case 'no': tone(ac, o, { type: 'sawtooth', f: 180, f2: 60, t, d: .6, v: v(.18), lp: 900, lpQ: 8 }); tone(ac, o, { type: 'square', f: 90, t, d: .5, v: v(.06), lp: 400 }); break;
      case 'intro': noise(ac, o, { t, d: 1.2, v: v(.14), bp: 300, sweep: 5000, q: 4, a: .6 }); tone(ac, o, { type: 'sine', f: 110, f2: 880, t, d: 1.1, v: v(.12), a: .5 }); break;
      case 'outro': [0, 7, 12, 19, 24].forEach((n, i) => tone(ac, o, { type: 'sawtooth', f: mtof(60 + n), t: t + i * .12, d: i === 4 ? 1 : .14, v: v(.07), lp: 3000 })); noise(ac, o, { t: t + .5, d: 1.4, v: v(.08), bp: 6000, sweep: 400, q: 3 }); break;
    }
  } else if (pack === 'soft') {
    switch (k) {
      case 'tick': tone(ac, o, { f: 1800, t, d: .03, v: v(.06) }); break;
      case 'final': marimba(ac, o, 79, t, v(.2), .35); break;
      case 'pop': marimba(ac, o, 72, t, v(.18), .4); break;
      case 'yes': [72, 76, 79].forEach((n, i) => marimba(ac, o, n, t + i * .1, v(.2), .7)); break;
      case 'no': marimba(ac, o, 67, t, v(.2), .4); marimba(ac, o, 62, t + .16, v(.2), .7); break;
      case 'intro': [65, 69, 72, 77].forEach((n, i) => marimba(ac, o, n, t + i * .12, v(.18), .9)); break;
      case 'outro': [72, 76, 79, 84].forEach((n, i) => marimba(ac, o, n, t + i * .14, v(.2), 1.2)); break;
    }
  } else if (pack === 'show') {
    switch (k) {
      case 'tick': noise(ac, o, { t, d: .02, v: v(.12), bp: 3000, q: 4 }); break;
      case 'final': noise(ac, o, { t, d: .04, v: v(.3), bp: 1800, q: 6 }); tone(ac, o, { f: 1000, t, d: .04, v: v(.1) }); break;
      case 'roll': {
        // 一條噪音聲道＋快速音量脈衝＝小鼓滾奏（比建立上百個節點省很多）
        const D = d || 3, src = ac.createBufferSource(); src.buffer = noiseBuf(ac); src.loop = true;
        const fl = ac.createBiquadFilter(); fl.type = 'bandpass'; fl.frequency.value = 2200; fl.Q.value = .7;
        const g = ac.createGain(); g.gain.setValueAtTime(0, t);
        for (let x = 0; x < D - .03; x += .045) { const k2 = x / D, pk = v(.05 + .25 * k2); g.gain.setValueAtTime(pk, t + x); g.gain.exponentialRampToValueAtTime(pk * .15, t + x + .04); }
        g.gain.setValueAtTime(0, t + D);
        src.connect(fl).connect(g).connect(o); src.start(t); src.stop(t + D + .05);
        break;
      }
      case 'pop': noise(ac, o, { t, d: .35, v: v(.2), bp: 400, sweep: 4000, q: 2, a: .15 }); break;
      case 'yes': noise(ac, o, { t, d: 1.6, v: v(.22), hp: 5000 }); kick(ac, o, t, v(.6)); chord(ac, o, [60, 64, 67, 72], t, .9, v(.06), 'sawtooth', 2400); break;
      case 'no': [[58, .28], [57, .28], [56, .28], [55, .8]].reduce((tt, [n, dd]) => { tone(ac, o, { type: 'sawtooth', f: mtof(n - 12), t: tt, d: dd, v: v(.12), lp: 900, a: .03 }); return tt + .3; }, t); break;
      case 'intro': noise(ac, o, { t, d: 1.4, v: v(.2), hp: 5000 }); kick(ac, o, t, v(.7)); [60, 64, 67, 72].forEach((n, i) => chord(ac, o, [n, n + 12], t + .15 + i * .14, i === 3 ? .9 : .14, v(.05), 'sawtooth', 2600)); break;
      case 'outro': {
        [60, 64, 67, 72].forEach((n, i) => chord(ac, o, [n, n + 12], t + i * .14, i === 3 ? 1.2 : .14, v(.05), 'sawtooth', 2600));
        const r = rng(9); for (let i = 0; i < 160; i++) noise(ac, o, { t: t + .4 + r() * 3, d: .03, v: v(.12 * (1 - i / 200)), bp: 1200 + r() * 1800, q: 2 });
        break;
      }
    }
  } else {
    switch (k) {
      case 'tick': tone(ac, o, { f: 1100, t, d: .06, v: v(.14) }); break;
      case 'final': tone(ac, o, { type: 'triangle', f: 1500, t, d: .12, v: v(.28) }); break;
      case 'pop': tone(ac, o, { f: 420, f2: 950, t, d: .14, v: v(.2) }); break;
      case 'yes': tone(ac, o, { type: 'triangle', f: 880, t, d: .35, v: v(.28) }); tone(ac, o, { type: 'triangle', f: 1318.5, t: t + .12, d: .55, v: v(.28) }); break;
      case 'no': tone(ac, o, { type: 'triangle', f: 440, t, d: .3, v: v(.28) }); tone(ac, o, { type: 'triangle', f: 330, t: t + .15, d: .5, v: v(.28) }); break;
      case 'intro': [523.25, 659.25, 783.99].forEach((f, i) => tone(ac, o, { type: 'triangle', f, t: t + i * .12, d: .6, v: v(.2) })); break;
      case 'outro': [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(ac, o, { type: 'triangle', f, t: t + i * .13, d: i === 3 ? 1.2 : .4, v: v(.24) })); break;
    }
  }
}

function events(p, tl) {
  const A = p.audio, E = A.ev, ev = [];
  for (const s of tl.segs) {
    if (s.type === 'intro') {
      if (E.intro) ev.push({ t: s.start + .15, k: 'intro' });
      if (E.final && s.dur > 3.5) for (let n = 1; n <= 3; n++) ev.push({ t: s.end - n, k: 'final' });
    } else if (s.type === 'q') {
      if (E.pop) ev.push({ t: s.start, k: 'pop' });
      for (let n = 1; n < s.dur; n++) {
        if (n <= 3) { if (E.final && A.sfxPack !== 'show') ev.push({ t: s.end - n, k: 'final' }); }
        else if (E.tick) ev.push({ t: s.end - n, k: 'tick' });
      }
      if (E.final && A.sfxPack === 'show') { const d = Math.min(3, s.dur - .2); ev.push({ t: s.end - d, k: 'roll', d }); }
    } else if (s.type === 'a') {
      if (E.reveal) ev.push({ t: s.start, k: p.type === 'match' && !s.item.isMatch ? 'no' : 'yes' });
    } else if (s.type === 'outro') {
      if (E.outro) ev.push({ t: s.start + .05, k: 'outro' });
    }
  }
  return ev;
}

/* 完整混音：背景音樂（循環、淡入淡出、揭曉時自動壓低）＋音效 */
async function renderMix(p, tl, sr = 48000, customBuf = null) {
  const A = p.audio, dur = tl.duration, len = Math.max(1, Math.ceil(dur * sr));
  const ac = new OfflineAudioContext(2, len, sr);
  const master = ac.createDynamicsCompressor(); master.threshold.value = -10; master.ratio.value = 4; master.connect(ac.destination);
  let mbuf = null;
  if (A.music === 'custom') mbuf = customBuf;
  else if (STYLES[A.music]) mbuf = await getLoop(A.music, sr);
  if (mbuf && A.musicVol > 0) {
    const src = ac.createBufferSource(); src.buffer = mbuf; src.loop = true;
    const g = ac.createGain(), v = A.musicVol, fo = Math.max(1.5, dur - 2.5);
    g.gain.setValueAtTime(0, 0); g.gain.linearRampToValueAtTime(v, 1);
    if (A.duck) for (const s of tl.segs) if (s.type === 'a' && s.start > 1.1 && s.start + 1.5 < fo) {
      g.gain.setValueAtTime(v, s.start); g.gain.linearRampToValueAtTime(v * .45, s.start + .08);
      g.gain.setValueAtTime(v * .45, s.start + .9); g.gain.linearRampToValueAtTime(v, s.start + 1.4);
    }
    g.gain.setValueAtTime(v, fo); g.gain.linearRampToValueAtTime(0, dur);
    src.connect(g).connect(master); src.start(0);
  }
  if (A.sfxVol > 0) {
    const sg = ac.createGain(); sg.gain.value = 1; sg.connect(master);
    // 分段排程：只在快播到時才建立節點，避免上千個節點從頭跑到尾拖慢速度
    const evs = events(p, tl).filter(e => e.t >= 0 && e.t < dur), STEP = 3;
    const sched = (a, b) => evs.forEach(e => { if (e.t >= a && e.t < b) sfx(ac, sg, A.sfxPack, e.k, e.t, A.sfxVol, e.d); });
    sched(0, STEP);
    for (let w = STEP; w < dur; w += STEP) { const ww = w; ac.suspend(ww).then(() => { sched(ww, ww + STEP); ac.resume(); }); }
  }
  const buf = await ac.startRendering();
  // 音量標準化：讓整支影片的最大音量接近 -1 dB，上傳網路聽起來才夠大聲
  let peak = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > peak) peak = a; } }
  if (peak > 0.001) {
    const g = Math.min(3, 0.89 / peak);
    for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] *= g; }
  }
  return buf;
}

/* 單獨試聽 */
async function previewSfx(pack, k, vol = .8) {
  const sr = 48000, ac = new OfflineAudioContext(2, sr * (k === 'roll' || k === 'outro' ? 3.6 : 1.4), sr);
  sfx(ac, ac.destination, pack, k, .02, vol, 3);
  return ac.startRendering();
}
async function decodeFile(arrayBuffer, sr = 48000) {
  const ac = new OfflineAudioContext(2, 1, sr);
  return ac.decodeAudioData(arrayBuffer.slice(0));
}

window.SGAudio = { STYLES, PACKS, EVENTS, renderMix, getLoop, previewSfx, decodeFile };
})();
