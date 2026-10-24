/* Sirenity — voice detail: samples, moods and training. */
(() => {
  "use strict";

  const T = window.Sirenity;
  const { esc, icon, fmtDur, fmtDate, fmtDateTime, avatarHtml, statusPill, EMOTIONS } = T;
  const media = T.media;

  const MIN_NEUTRAL = 6;
  const MIN_EMOTION = 4;
  const TARGET_NEUTRAL = 30;
  const TARGET_EMOTION = 15;

  function secondsFor(voice, emotion) {
    const sample = (voice.samples || {})[emotion];
    return sample ? Number(sample.seconds) || 0 : 0;
  }

  function countFor(voice, emotion) {
    const sample = (voice.samples || {})[emotion];
    return sample ? Number(sample.count) || 0 : 0;
  }

  function clipsFor(emotion) {
    return (T.state.clips || []).filter((clip) => clip.emotion === emotion);
  }

  function targetFor(emotion) {
    return emotion === "neutral" ? TARGET_NEUTRAL : TARGET_EMOTION;
  }

  function statusBadges(voice) {
    const stale = voice.model && voice.model.stale
      ? `<span class="pill stale"><i></i>Samples changed</span>`
      : "";
    const mock = voice.model && voice.model.engine === "mock"
      ? `<span class="pill mock"><i></i>Mock engine</span>`
      : "";
    return `${statusPill(voice)}${stale}${mock}`;
  }

  function logHtml(log) {
    return String(log || "")
      .trim()
      .split("\n")
      .map((line) => {
        const safe = esc(line);
        if (/^error/i.test(line) || /could not/i.test(line)) return `<span class="err-line">${safe}</span>`;
        if (/ready\.$/i.test(line) || /complete/i.test(line)) return `<span class="ok-line">${safe}</span>`;
        return safe;
      })
      .join("\n");
  }

  function tabBar(voice) {
    const active = T.state.detailTab;
    return EMOTIONS.map((emotion) => {
      const count = countFor(voice, emotion);
      return `<button class="emo-tab ${emotion === active ? "active" : ""}" type="button"
        style="--emo-color:${T.EMOTION_COLORS[emotion]}" data-action="voice-tab" data-emotion="${emotion}">
        <span class="dot ${emotion}"></span>${emotion}<span class="count">${count}</span>
      </button>`;
    }).join("");
  }

  function clipRow(clip) {
    const warnings = clip.warnings || [];
    const warning = warnings.find((item) => item.level === "error") || warnings[0];
    const quality = warning
      ? `<span class="warn">${esc(warning.text)}</span>`
      : `<span class="ok">Clean</span>`;
    const transcript = clip.transcript
      ? `<p class="clip-transcript">“${esc(clip.transcript)}”</p>`
      : "";
    return `
      <div class="clip" data-player="${clip.id}" data-src="${media(clip.url)}" data-duration="${Number(clip.duration) || 0}">
        <button class="play-btn" type="button" data-action="player-toggle" data-id="${clip.id}" aria-label="Play sample">${icon("play")}</button>
        <div class="clip-body">
          <div class="player-wave" data-action="player-seek" data-id="${clip.id}">
            <div class="wave-wrap"><canvas class="wave-canvas"></canvas></div>
          </div>
          <div class="clip-meta">
            <span>${fmtDur(clip.duration)}</span>
            <span>·</span>
            <span>${fmtDate(clip.created_at)}</span>
            <span>·</span>
            ${quality}
          </div>
          ${transcript}
        </div>
        <div class="clip-actions">
          <a class="icon-btn" href="${media(clip.url)}" download aria-label="Download sample" title="Download WAV">${icon("download")}</a>
          <button class="icon-btn danger" type="button" data-action="delete-clip" data-id="${clip.id}" data-emotion="${clip.emotion}" aria-label="Delete sample" title="Delete sample">${icon("trash")}</button>
        </div>
      </div>`;
  }

  function emptyClipState(emotion) {
    const message = emotion === "neutral"
      ? "Neutral is the anchor. Record at least 6 seconds — 30 seconds is the sweet spot."
      : `Add about 15 seconds of ${emotion} speech to unlock this mood.`;
    return `
      <div class="result-empty" style="margin-bottom:4px">
        ${icon("wave")}
        <div><strong>No ${emotion} takes yet</strong><span>${message}</span></div>
      </div>`;
  }

  function samplesCard(voice) {
    const emotion = T.state.detailTab;
    const clips = clipsFor(emotion);
    const busy = voice.status === "training";
    return `
      <section class="card">
        <div class="card-head">
          <div>
            <h2>Samples</h2>
            <p>${voice.clip_count} take${voice.clip_count === 1 ? "" : "s"} · ${fmtDur(voice.total_seconds)} of reference audio. Clean, close-mic speech works best.</p>
          </div>
          <div class="head-actions">
            <button class="btn ghost sm" type="button" data-action="record-sample" data-id="${voice.id}" data-emotion="${emotion}" ${busy ? "disabled" : ""}>${icon("mic")} Record</button>
            <button class="btn ghost sm" type="button" data-action="upload-sample" data-id="${voice.id}" data-emotion="${emotion}" ${busy ? "disabled" : ""}>${icon("upload")} Upload</button>
          </div>
        </div>
        <div class="emotion-tabs">${tabBar(voice)}</div>
        <div class="clip-list">${clips.length ? clips.map(clipRow).join("") : emptyClipState(emotion)}</div>
        <div class="dropzone" id="dropzone" data-id="${voice.id}" data-emotion="${emotion}" role="button" tabindex="0" aria-label="Upload ${emotion} audio">
          <span class="dz-icon">${icon("upload")}</span>
          <strong>Drop ${emotion} audio here, or click to choose a file</strong>
          <p>WAV, MP3, M4A, OGG or FLAC · converted locally to 24 kHz mono</p>
        </div>
      </section>`;
  }

  function trainingPanel(voice) {
    const job = voice.job;
    const running = voice.status === "training" || Boolean(job && ["queued", "running"].includes(job.status));
    const neutral = secondsFor(voice, "neutral");
    const trained = (voice.emotions_ready || []).length > 0;
    const canTrain = neutral >= MIN_NEUTRAL && !running;
    const errorText = voice.status === "error"
      ? voice.error || (job && job.error) || "Training failed."
      : job && job.status === "error" && !trained
        ? job.error || "Training failed."
        : "";

    if (running) {
      const progress = Math.max(0, Math.min(100, Number(job && job.progress) || 0));
      return `
        <div class="train-state">
          <span class="pulse loading"></span>
          <span>${esc((job && job.message) || "Training…")}</span>
        </div>
        <div class="progress"><div class="progress-fill" style="width:${progress}%"></div></div>
        <div class="hint">${Math.round(progress)}% · this page updates itself</div>
        ${job && job.log ? `<div class="job-log">${logHtml(job.log)}</div>` : ""}`;
    }

    const rows = T.CORE.map((emotion) => {
      const seconds = secondsFor(voice, emotion);
      const min = emotion === "neutral" ? MIN_NEUTRAL : MIN_EMOTION;
      const ok = seconds >= min;
      const suffix = emotion === "neutral" ? "required" : "optional";
      return `
        <div class="readiness-row">
          <span><span class="dot ${ok ? emotion : "off"}"></span>${emotion} <span class="hint">${suffix}</span></span>
          <span class="val ${ok ? "ok" : ""}">${seconds.toFixed(seconds < 10 ? 1 : 0)}s / ${min}s</span>
        </div>`;
    }).join("");

    return `
      <div class="readiness">${rows}</div>
      ${errorText ? `<div class="banner err" style="margin:6px 0 10px">${esc(errorText)}</div>` : ""}
      ${voice.model && voice.model.stale ? `<div class="banner" style="margin:6px 0 10px">Samples changed since the last training run. Retrain to fold them in.</div>` : ""}
      ${trained
        ? `<p class="hint" style="margin:2px 0 10px">Model trained ${fmtDateTime(voice.model.trained_at)} with ${(voice.emotions_ready || []).length} mood${(voice.emotions_ready || []).length === 1 ? "" : "s"}.</p>`
        : `<p class="hint" style="margin:2px 0 10px">Neutral is required. The first XTTS run also downloads the model (about 1.8 GB).</p>`}
      <button class="btn primary full" type="button" data-action="train-voice" data-id="${voice.id}" ${canTrain ? "" : "disabled"}>
        ${icon("sparkles")} ${trained ? "Retrain voice" : "Train voice"}
      </button>
      ${neutral < MIN_NEUTRAL && !trained ? `<p class="hint" style="margin-top:8px">Record ${(MIN_NEUTRAL - neutral).toFixed(1)}s more neutral speech to unlock training.</p>` : ""}
      ${job && job.status === "error" && job.log ? `<div class="job-log">${logHtml(job.log)}</div>` : ""}`;
  }

  function coverageCard(voice) {
    const rows = EMOTIONS.map((emotion) => {
      const seconds = secondsFor(voice, emotion);
      const target = targetFor(emotion);
      const percent = Math.min(100, Math.round((seconds / target) * 100));
      const ready = (voice.emotions_ready || []).includes(emotion);
      return `
        <div class="coverage-row ${emotion === "neutral" ? "required" : ""}">
          <span class="coverage-name"><span class="dot ${emotion}"></span>${emotion}</span>
          <div class="coverage-bar"><div class="coverage-fill" style="width:${percent}%;--emo-color:${T.EMOTION_COLORS[emotion]}"></div></div>
          <span class="coverage-time">${seconds ? `${seconds.toFixed(seconds < 10 ? 1 : 0)}s` : "—"}</span>
          <span class="coverage-state ${ready ? "on" : "off"}">${ready ? "ready" : "off"}</span>
        </div>`;
    }).join("");
    return `
      <section class="card rail-card">
        <div class="card-head" style="margin-bottom:10px">
          <div><h2>Mood coverage</h2><span class="hint">Reference seconds per emotion. Neutral: ${TARGET_NEUTRAL}s target; moods: ${TARGET_EMOTION}s.</span></div>
        </div>
        <div class="coverage-list">${rows}</div>
      </section>`;
  }

  function modelCard(voice) {
    const model = voice.model || {};
    const emotions = Object.keys(model.emotions || {});
    if (!emotions.length) {
      return `
        <section class="card rail-card">
          <h2>Model</h2>
          <p class="hint">No model yet. Training caches one conditioning latent per emotion, so switching moods later is fast.</p>
        </section>`;
    }
    const seconds = emotions.reduce((total, key) => total + Number((model.emotions[key] || {}).seconds || 0), 0);
    return `
      <section class="card rail-card">
        <div class="card-head" style="margin-bottom:10px">
          <div><h2>Model</h2><span class="hint">Cached conditioning for each mood.</span></div>
          ${model.stale ? `<span class="pill stale"><i></i>Stale</span>` : ""}
        </div>
        <div class="readiness">
          <div class="readiness-row"><span>Engine</span><span class="val">${esc(voice.engine || model.engine_label || "—")}</span></div>
          <div class="readiness-row"><span>Trained</span><span class="val">${fmtDateTime(model.trained_at)}</span></div>
          <div class="readiness-row"><span>Moods</span><span class="val">${esc(emotions.join(", "))}</span></div>
          <div class="readiness-row"><span>Reference</span><span class="val">${fmtDur(seconds)}</span></div>
        </div>
        ${model.skipped && Object.keys(model.skipped).length
          ? `<p class="hint" style="margin-top:8px">Skipped for lack of audio: ${esc(Object.keys(model.skipped).join(", "))}.</p>`
          : ""}
        <div style="margin-top:12px">
          <button class="btn primary full" type="button" data-action="go-studio" data-id="${voice.id}">${icon("sparkles")} Open studio</button>
        </div>
      </section>`;
  }

  function paintVoice(view) {
    const voice = T.state.voice;
    if (!voice) return;
    const stale = voice.model && voice.model.stale;
    view.innerHTML = `
      <div class="crumb">
        <a href="#/voices">Voices</a><span>/</span><span>${esc(voice.name)}</span>
      </div>
      <header class="page-head voice-head">
        <div class="voice-head-id">
          ${avatarHtml(voice.name, "lg")}
          <div>
            <h1>${esc(voice.name)} <span id="voiceStatusPill">${statusBadges(voice)}</span></h1>
            <p class="lede">${esc(voice.description || "No description yet.")} <span class="muted">· ${esc(T.langLabel(voice.language))} · created ${fmtDate(voice.created_at)}</span></p>
          </div>
        </div>
        <div class="head-actions">
          <button class="btn ghost" type="button" data-action="edit-voice" data-id="${voice.id}">${icon("file")} Edit</button>
          <button class="icon-btn danger" type="button" data-action="delete-voice" data-id="${voice.id}" title="Delete voice" aria-label="Delete voice">${icon("trash")}</button>
          <button class="btn primary" type="button" data-action="go-studio" data-id="${voice.id}">${icon("sparkles")} Synthesize</button>
        </div>
      </header>
      ${voice.status === "error" && voice.error ? `<div class="banner err">${esc(voice.error)}</div>` : ""}
      ${stale ? `<div class="banner">Samples changed after training. The voice still works, but retrain to include the new takes.</div>` : ""}
      <div class="voice-layout">
        <div class="voice-main">${samplesCard(voice)}</div>
        <aside class="rail">
          <section class="card rail-card">
            <div class="card-head" style="margin-bottom:10px">
              <div><h2>Training</h2><span class="hint">Neutral is required; moods are optional.</span></div>
            </div>
            <div id="trainingPanel">${trainingPanel(voice)}</div>
          </section>
          ${coverageCard(voice)}
          ${modelCard(voice)}
        </aside>
      </div>`;

    bindDropzone(view);
    if (T.hydratePlayers) T.hydratePlayers(view);

    const job = voice.job;
    if (
      voice.status === "training" &&
      job &&
      ["queued", "running"].includes(job.status) &&
      T.state.pollingJob !== job.id
    ) {
      startPolling(job.id, voice.id);
    }
  }

  function bindDropzone(view) {
    const zone = view.querySelector("#dropzone");
    if (!zone) return;
    const voiceId = zone.dataset.id;
    const emotion = zone.dataset.emotion;
    const busy = () => T.state.voice && T.state.voice.status === "training";
    const pick = () => {
      if (busy()) return T.toast("Wait for training to finish before adding samples.", "warn");
      if (T.pickFiles) T.pickFiles({ voiceId, emotion });
    };
    zone.addEventListener("click", pick);
    zone.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        pick();
      }
    });
    zone.addEventListener("dragover", (event) => {
      event.preventDefault();
      zone.classList.add("drag");
    });
    zone.addEventListener("dragleave", () => zone.classList.remove("drag"));
    zone.addEventListener("drop", (event) => {
      event.preventDefault();
      zone.classList.remove("drag");
      if (busy()) return T.toast("Wait for training to finish before adding samples.", "warn");
      const files = Array.from(event.dataTransfer.files || []);
      if (files.length) T.uploadFiles(files, { voiceId, emotion });
    });
  }

  function stopPolling() {
    if (T.state.pollTimer) clearInterval(T.state.pollTimer);
    T.state.pollTimer = null;
    T.state.pollingJob = null;
  }

  function updateTraining() {
    const voice = T.state.voice;
    if (!voice) return;
    const panel = document.getElementById("trainingPanel");
    if (panel) panel.innerHTML = trainingPanel(voice);
    const pill = document.getElementById("voiceStatusPill");
    if (pill) pill.innerHTML = statusBadges(voice);
  }

  function startPolling(jobId, voiceId) {
    stopPolling();
    T.state.pollingJob = jobId;
    T.state.pollTimer = setInterval(async () => {
      if (T.state.pollingJob !== jobId) return;
      try {
        const job = await T.api(`/api/jobs/${jobId}`, { timeout: 10000 });
        const voice = T.state.voice;
        if (voice && voice.id === voiceId) {
          voice.job = job;
          if (job.voice) {
            voice.status = job.voice.status;
            voice.error = job.voice.error || "";
          }
          updateTraining();
        }
        if (job.status === "done" || job.status === "error") {
          stopPolling();
          if (job.status === "done") {
            T.toast("Voice trained. It's ready in the Studio.", "ok");
          } else {
            T.toast(job.error || "Training failed.", "err");
          }
          await reload(voiceId, T.state.detailTab);
        }
      } catch (error) {
        if (error && error.status === 404) {
          stopPolling();
          await reload(voiceId, T.state.detailTab);
        }
      }
    }, 1400);
  }

  async function reload(voiceId, tab) {
    const [voice, clips] = await Promise.all([
      T.api(`/api/voices/${voiceId}`),
      T.api(`/api/voices/${voiceId}/clips`),
    ]);
    if (T.state.route.name !== "voice" || T.state.route.id !== voiceId) return;
    stopPolling();
    T.state.voice = voice;
    T.state.clips = clips;
    if (tab && EMOTIONS.includes(tab)) T.state.detailTab = tab;
    const index = T.state.voices.findIndex((item) => item.id === voice.id);
    if (index >= 0) T.state.voices[index] = voice;
    else T.state.voices.push(voice);
    T.updateNavCount();
    const view = document.getElementById("view");
    if (view) paintVoice(view);
  }

  async function uploadFiles(files, context) {
    if (!context || !files || !files.length) return;
    if (T.state.voice && T.state.voice.status === "training") {
      T.toast("Wait for training to finish before adding samples.", "warn");
      return;
    }
    const { voiceId, emotion } = context;
    let added = 0;
    for (const file of files) {
      try {
        const take = await T.A.fileToWav(file);
        const form = new FormData();
        form.append("file", take.blob, "take.wav");
        form.append("emotion", emotion);
        form.append("transcript", "");
        await T.api(`/api/voices/${voiceId}/clips`, {
          method: "POST",
          form,
          timeout: 300000,
        });
        added += 1;
      } catch (error) {
        T.toast(`${file.name || "That file"}: ${error.message}`, "err");
      }
    }
    if (added) {
      T.toast(`Added ${added} ${emotion} take${added === 1 ? "" : "s"}.`, "ok");
      await reload(voiceId, emotion);
    }
  }

  async function renderVoice(view, id) {
    if (T.stopPlayers) T.stopPlayers();
    stopPolling();
    const [voice, clips] = await Promise.all([
      T.api(`/api/voices/${id}`),
      T.api(`/api/voices/${id}/clips`),
    ]);
    if (T.state.route.name !== "voice" || T.state.route.id !== id) return;
    T.state.voice = voice;
    T.state.clips = clips;
    if (!EMOTIONS.includes(T.state.detailTab)) T.state.detailTab = "neutral";
    const index = T.state.voices.findIndex((item) => item.id === voice.id);
    if (index >= 0) T.state.voices[index] = voice;
    else T.state.voices.push(voice);
    T.updateNavCount();
    paintVoice(view);
  }

  T.renderVoice = renderVoice;
  T.uploadFiles = uploadFiles;

  T.actions["voice-tab"] = (el) => {
    T.state.detailTab = el.dataset.emotion;
    const view = document.getElementById("view");
    if (view && T.state.voice) paintVoice(view);
  };

  T.actions["train-voice"] = async (el) => {
    const voice = T.state.voice;
    if (!voice) return;
    el.disabled = true;
    try {
      const job = await T.api(`/api/voices/${voice.id}/train`, {
        method: "POST",
        timeout: 30000,
      });
      voice.status = "training";
      voice.error = "";
      voice.job = job;
      const view = document.getElementById("view");
      if (view) paintVoice(view);
      startPolling(job.id, voice.id);
      T.toast("Training started. You can keep this tab open.", "ok");
    } catch (error) {
      T.toast(error.message, "err");
      el.disabled = false;
    }
  };

  T.actions["record-sample"] = (el) => {
    const voice = T.state.voice;
    if (!voice) return;
    if (voice.status === "training") return T.toast("Wait for training to finish.", "warn");
    const emotion = el.dataset.emotion || T.state.detailTab;
    if (!T.openRecorder) return;
    T.openRecorder({
      voiceId: voice.id,
      emotion,
      onDone: () => reload(voice.id, emotion),
    });
  };

  T.actions["upload-sample"] = (el) => {
    const voice = T.state.voice;
    if (!voice) return;
    if (voice.status === "training") return T.toast("Wait for training to finish.", "warn");
    const emotion = el.dataset.emotion || T.state.detailTab;
    if (T.pickFiles) T.pickFiles({ voiceId: voice.id, emotion });
  };

  T.actions["delete-clip"] = async (el) => {
    const voice = T.state.voice;
    if (!voice) return;
    const ok = await T.confirmDialog({
      eyebrow: "Delete sample",
      title: "Remove this take?",
      message: "The audio file is deleted from disk. If the voice was already trained, its model is marked stale until you retrain.",
      confirmLabel: "Delete take",
    });
    if (!ok) return;
    try {
      await T.api(`/api/clips/${el.dataset.id}`, { method: "DELETE" });
      T.toast("Sample deleted.", "ok");
      await reload(voice.id, T.state.detailTab);
    } catch (error) {
      T.toast(error.message, "err");
    }
  };

  T.actions["go-studio"] = (el) => {
    T.go(`#/studio?voice=${encodeURIComponent(el.dataset.id)}`);
  };
})();
