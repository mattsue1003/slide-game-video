/* 簡報遊戲影片工坊 — 匯出 MP4（WebCodecs 逐格編碼，比即時播放快很多） */
(function () {
'use strict';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function pickVideoCodec(w, h, fps) {
  for (const codec of ['avc1.640028', 'avc1.4d0028', 'avc1.42e028', 'avc1.42001f']) {
    try {
      const s = await VideoEncoder.isConfigSupported({ codec, width: w, height: h, bitrate: 6e6, framerate: fps });
      if (s.supported) return codec;
    } catch (e) { /* try next */ }
  }
  return null;
}
async function pickAudioCodec() {
  if (!('AudioEncoder' in window)) return null;
  for (const [codec, mux] of [['mp4a.40.2', 'aac'], ['opus', 'opus']]) {
    try {
      const s = await AudioEncoder.isConfigSupported({ codec, sampleRate: 48000, numberOfChannels: 2, bitrate: 160000 });
      if (s.supported) return { codec, mux };
    } catch (e) { /* try next */ }
  }
  return null;
}

async function exportVideo(p, opts, onProgress, signal) {
  const height = opts.height || 1080, fps = opts.fps || 30, w = height === 720 ? 1280 : 1920, h = height === 720 ? 720 : 1080;
  onProgress(0, '準備字型與圖片…');
  await SG.ready(p);
  const tl = SG.buildTimeline(p);
  if (!('VideoEncoder' in window) || !window.Mp4Muxer) return exportRealtime(p, tl, { w, h, fps, customBuf: opts.customBuf }, onProgress, signal);
  const vcodec = await pickVideoCodec(w, h, fps);
  if (!vcodec) return exportRealtime(p, tl, { w, h, fps, customBuf: opts.customBuf }, onProgress, signal);

  onProgress(0, '合成背景音樂與音效…');
  const mix = await SGAudio.renderMix(p, tl, 48000, opts.customBuf);
  const ac = await pickAudioCodec();

  const muxer = new Mp4Muxer.Muxer({
    target: new Mp4Muxer.ArrayBufferTarget(),
    video: { codec: 'avc', width: w, height: h, frameRate: fps },
    audio: ac ? { codec: ac.mux, numberOfChannels: 2, sampleRate: 48000 } : undefined,
    fastStart: 'in-memory',
    firstTimestampBehavior: 'offset',
  });
  let err = null;

  if (ac) {
    const ae = new AudioEncoder({ output: (c, m) => muxer.addAudioChunk(c, m), error: e => { err = e; } });
    ae.configure({ codec: ac.codec, sampleRate: 48000, numberOfChannels: 2, bitrate: 160000 });
    const Lc = mix.getChannelData(0), Rc = mix.numberOfChannels > 1 ? mix.getChannelData(1) : Lc, N = mix.length, CH = 4800;
    for (let i = 0; i < N; i += CH) {
      const n = Math.min(CH, N - i), data = new Float32Array(n * 2);
      data.set(Lc.subarray(i, i + n), 0); data.set(Rc.subarray(i, i + n), n);
      const ad = new AudioData({ format: 'f32-planar', sampleRate: 48000, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round(i / 48000 * 1e6), data });
      ae.encode(ad); ad.close();
    }
    await ae.flush(); ae.close();
  }

  const ve = new VideoEncoder({ output: (c, m) => muxer.addVideoChunk(c, m), error: e => { err = e; } });
  ve.configure({ codec: vcodec, width: w, height: h, bitrate: h === 1080 ? 8e6 : 4e6, framerate: fps });
  const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  const total = Math.ceil(tl.duration * fps), t0 = performance.now();
  for (let i = 0; i < total; i++) {
    if (signal.aborted) { try { ve.close(); } catch (e) {} throw new DOMException('已取消', 'AbortError'); }
    if (err) throw err;
    SG.renderFrame(ctx, p, tl, i / fps, SG.getImg);
    const frame = new VideoFrame(canvas, { timestamp: Math.round(i * 1e6 / fps), duration: Math.round(1e6 / fps) });
    ve.encode(frame, { keyFrame: i % (fps * 2) === 0 });
    frame.close();
    while (ve.encodeQueueSize > 8) await new Promise(r => { ve.addEventListener('dequeue', r, { once: true }); setTimeout(r, 30); });
    if (i % 15 === 0) {
      const el = (performance.now() - t0) / 1000, eta = i ? el / i * (total - i) : 0;
      onProgress(i / total, `編碼畫面 ${i} / ${total}，約剩 ${Math.ceil(eta)} 秒`);
      await sleep(0);
    }
  }
  onProgress(.99, '封裝 MP4…');
  await ve.flush(); ve.close();
  if (err) throw err;
  muxer.finalize();
  return new Blob([muxer.target.buffer], { type: 'video/mp4' });
}

/* 備援：不支援 WebCodecs 的瀏覽器，用即時錄影（需要等影片長度的時間） */
async function exportRealtime(p, tl, { w, h, fps, customBuf }, onProgress, signal) {
  onProgress(0, '此瀏覽器不支援快速編碼，改用即時錄影（請保持此分頁開啟）…');
  const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  const mix = await SGAudio.renderMix(p, tl, 48000, customBuf);
  const actx = new AudioContext({ sampleRate: 48000 });
  const dest = actx.createMediaStreamDestination();
  const stream = new MediaStream([...canvas.captureStream(fps).getVideoTracks(), ...dest.stream.getAudioTracks()]);
  const types = ['video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm'];
  const mime = types.find(t => MediaRecorder.isTypeSupported(t)) || '';
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8e6 });
  const chunks = []; rec.ondataavailable = e => e.data.size && chunks.push(e.data);
  const done = new Promise(r => { rec.onstop = r; });
  SG.renderFrame(ctx, p, tl, 0, SG.getImg);
  rec.start(500);
  const src = actx.createBufferSource(); src.buffer = mix; src.connect(dest); src.start();
  const start = actx.currentTime;
  await new Promise((resolve, reject) => {
    const tick = () => {
      if (signal.aborted) { reject(new DOMException('已取消', 'AbortError')); return; }
      const t = actx.currentTime - start;
      SG.renderFrame(ctx, p, tl, t, SG.getImg);
      onProgress(t / tl.duration, `即時錄影中 ${Math.floor(t)} / ${Math.ceil(tl.duration)} 秒`);
      if (t >= tl.duration) resolve(); else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }).finally(() => { try { src.stop(); } catch (e) {} if (rec.state !== 'inactive') rec.stop(); });
  await done; actx.close();
  return new Blob(chunks, { type: (mime || 'video/webm').split(';')[0] });
}

window.SGExport = { exportVideo };
})();
