/* Sirenity — client-side audio helpers (no dependencies). */
window.SirenityAudio = (() => {
  "use strict";

  const TARGET_SR = 24000;
  const MAX_SECONDS = 300;
  const waveCache = new Map();

  function writeString(view, offset, text) {
    for (let i = 0; i < text.length; i += 1) {
      view.setUint8(offset + i, text.charCodeAt(i));
    }
  }

  function encodeWav(samples, sampleRate = TARGET_SR) {
    const bytesPerSample = 2;
    const blockAlign = bytesPerSample;
    const buffer = new ArrayBuffer(44 + samples.length * bytesPerSample);
    const view = new DataView(buffer);
    writeString(view, 0, "RIFF");
    view.setUint32(4, 36 + samples.length * bytesPerSample, true);
    writeString(view, 8, "WAVE");
    writeString(view, 12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, 16, true);
    writeString(view, 36, "data");
    view.setUint32(40, samples.length * bytesPerSample, true);
    let offset = 44;
    for (let i = 0; i < samples.length; i += 1) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      offset += 2;
    }
    return new Blob([view], { type: "audio/wav" });
  }

  function toMono(audioBuffer) {
    const channels = audioBuffer.numberOfChannels;
    if (channels === 1) return audioBuffer.getChannelData(0).slice();
    const length = audioBuffer.length;
    const out = new Float32Array(length);
    for (let c = 0; c < channels; c += 1) {
      const data = audioBuffer.getChannelData(c);
      for (let i = 0; i < length; i += 1) out[i] += data[i] / channels;
    }
    return out;
  }

  function getAudioContextClass() {
    return window.AudioContext || window.webkitAudioContext;
  }

  async function resampleMono(samples, sourceRate, targetRate = TARGET_SR) {
    if (sourceRate === targetRate) return samples;
    const Ctx = getAudioContextClass();
    if (!Ctx || !window.OfflineAudioContext) {
      throw new Error("This browser cannot resample audio.");
    }
    const length = Math.max(1, Math.round((samples.length * targetRate) / sourceRate));
    const ctx = new OfflineAudioContext(1, length, targetRate);
    const buffer = ctx.createBuffer(1, samples.length, sourceRate);
    buffer.copyToChannel(samples, 0);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start(0);
    const rendered = await ctx.startRendering();
    return rendered.getChannelData(0).slice();
  }

  async function decodeArrayBuffer(arrayBuffer) {
    const Ctx = getAudioContextClass();
    if (!Ctx) throw new Error("Web Audio is not available in this browser.");
    const ctx = new Ctx();
    try {
      return await ctx.decodeAudioData(arrayBuffer.slice(0));
    } finally {
      ctx.close().catch(() => {});
    }
  }

  function peaks(samples, buckets = 72) {
    const count = Math.max(8, Math.min(240, buckets | 0));
    const block = Math.max(1, Math.floor(samples.length / count));
    const out = new Array(count).fill(0);
    for (let i = 0; i < count; i += 1) {
      let max = 0;
      const start = i * block;
      const end = Math.min(samples.length, start + block);
      for (let j = start; j < end; j += 1) {
        const value = Math.abs(samples[j]);
        if (value > max) max = value;
      }
      out[i] = max;
    }
    let top = 0;
    for (const value of out) if (value > top) top = value;
    if (top <= 0.00001) return out.map(() => 0.02);
    return out.map((value) => Math.max(0.03, Math.min(1, value / top)));
  }

  function roundedRect(ctx, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, Math.abs(height) / 2 || radius);
    if (height <= 0.6) {
      ctx.fillRect(x, y, width, Math.max(0.6, height));
      return;
    }
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
    ctx.fill();
  }

  function drawWave(canvas, values, options = {}) {
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.max(40, canvas.clientWidth || canvas.parentElement?.clientWidth || 260);
    const height = Math.max(16, canvas.clientHeight || 38);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const data = values && values.length ? values : new Array(40).fill(0.06);
    const gap = data.length > 100 ? 1 : 2;
    const barWidth = Math.max(1.2, (width - gap * (data.length - 1)) / data.length);
    const mid = height / 2;
    const progress = typeof options.progress === "number" ? options.progress : 1;
    const idle = options.idleColor || "rgba(173, 181, 199, 0.26)";
    const active = options.activeColor || "rgba(196, 181, 253, 0.95)";

    data.forEach((value, index) => {
      const played = (index + 0.5) / data.length <= progress;
      const amplitude = Math.max(1.2, (value * (height - 4)) / 2);
      const x = index * (barWidth + gap);
      ctx.fillStyle = played ? active : idle;
      roundedRect(ctx, x, mid - amplitude, barWidth, amplitude * 2, barWidth / 2);
    });
  }

  function loadPeaks(url, buckets = 84) {
    if (!url) return Promise.resolve([]);
    const key = `${buckets}:${url}`;
    if (waveCache.has(key)) return Promise.resolve(waveCache.get(key));
    return fetch(url)
      .then((response) => {
        if (!response.ok) throw new Error(`Waveform request failed (${response.status})`);
        return response.arrayBuffer();
      })
      .then((buffer) => decodeArrayBuffer(buffer))
      .then((audioBuffer) => {
        const values = peaks(toMono(audioBuffer), buckets);
        waveCache.set(key, values);
        return values;
      })
      .catch(() => []);
  }

  async function fileToWav(file) {
    if (!file) throw new Error("No file selected.");
    const name = (file.name || "").toLowerCase();
    const looksAudio =
      (file.type && file.type.startsWith("audio")) ||
      /\.(wav|mp3|m4a|aac|ogg|oga|opus|webm|flac|aiff|aif)$/.test(name);
    if (!looksAudio) throw new Error(`"${file.name || "That file"}" is not an audio file.`);

    let buffer;
    try {
      buffer = await decodeArrayBuffer(await file.arrayBuffer());
    } catch (error) {
      throw new Error(
        `Could not decode "${file.name}". Try a WAV, MP3, M4A, OGG or FLAC file.`
      );
    }
    if (buffer.duration > MAX_SECONDS) {
      throw new Error(
        `"${file.name}" is ${Math.round(buffer.duration / 60)} min long. Keep samples under 5 minutes.`
      );
    }
    const mono = toMono(buffer);
    const resampled = await resampleMono(mono, buffer.sampleRate, TARGET_SR);
    return {
      blob: encodeWav(resampled, TARGET_SR),
      duration: resampled.length / TARGET_SR,
      peaks: peaks(resampled, 90),
      fileName: file.name || "sample.wav",
    };
  }

  function createRecorder({ onLevel } = {}) {
    let stream = null;
    let ctx = null;
    let source = null;
    let processor = null;
    let mute = null;
    let chunks = [];
    let running = false;
    let startedAt = 0;

    function cleanupGraph() {
      try { processor && processor.disconnect(); } catch (_) {}
      try { source && source.disconnect(); } catch (_) {}
      try { mute && mute.disconnect(); } catch (_) {}
      if (stream) stream.getTracks().forEach((track) => track.stop());
      if (ctx && ctx.state !== "closed") ctx.close().catch(() => {});
      stream = null;
      ctx = null;
      source = null;
      processor = null;
      mute = null;
    }

    async function start() {
      if (running) return;
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error(
          "Microphone access is unavailable. Open the app at http://127.0.0.1:8000 instead of a file:// path."
        );
      }
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      const Ctx = getAudioContextClass();
      ctx = new Ctx();
      if (ctx.state === "suspended") await ctx.resume();
      source = ctx.createMediaStreamSource(stream);
      processor = ctx.createScriptProcessor(4096, 1, 1);
      mute = ctx.createGain();
      mute.gain.value = 0;
      chunks = [];
      processor.onaudioprocess = (event) => {
        if (!running) return;
        const input = event.inputBuffer.getChannelData(0);
        chunks.push(new Float32Array(input));
        if (onLevel) {
          let sum = 0;
          for (let i = 0; i < input.length; i += 1) sum += input[i] * input[i];
          const rms = Math.sqrt(sum / input.length);
          onLevel(Math.min(1, rms * 5.5));
        }
      };
      source.connect(processor);
      processor.connect(mute);
      mute.connect(ctx.destination);
      running = true;
      startedAt = performance.now();
    }

    async function stop() {
      if (!running) return null;
      running = false;
      const sampleRate = ctx ? ctx.sampleRate : TARGET_SR;
      if (processor) processor.onaudioprocess = null;
      cleanupGraph();
      if (onLevel) onLevel(0);

      const captured = chunks;
      chunks = [];
      const total = captured.reduce((sum, chunk) => sum + chunk.length, 0);
      if (!total) return null;
      const merged = new Float32Array(total);
      let offset = 0;
      for (const chunk of captured) { merged.set(chunk, offset); offset += chunk.length; }

      const resampled = await resampleMono(merged, sampleRate, TARGET_SR);
      return {
        blob: encodeWav(resampled, TARGET_SR),
        duration: resampled.length / TARGET_SR,
        peaks: peaks(resampled, 90),
      };
    }

    function cancel() {
      running = false;
      if (processor) processor.onaudioprocess = null;
      cleanupGraph();
      chunks = [];
    }

    return {
      start,
      stop,
      cancel,
      isRecording: () => running,
    };
  }

  function formatTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
    const whole = Math.floor(seconds);
    const mins = Math.floor(whole / 60);
    const secs = whole % 60;
    return `${mins}:${String(secs).padStart(2, "0")}`;
  }

  return {
    TARGET_SR,
    encodeWav,
    decodeArrayBuffer,
    resampleMono,
    peaks,
    drawWave,
    loadPeaks,
    fileToWav,
    createRecorder,
    formatTime,
  };
})();
