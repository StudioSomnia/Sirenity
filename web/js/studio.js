/* Timbre — the script-to-speech studio. */
(() => {
  "use strict";

  const T = window.Timbre;
  const { esc, icon, fmtDur, EMOTIONS, EMOTION_COLORS, SAMPLE_TEXTS, LANGS } = T;
  const media = T.media;

  function saveStudio() {
    const studio = T.state.studio;
    T.persist("studio", {
      voiceId: studio.voiceId,
      emotion: studio.emotion,
      intensity: studio.intensity,
      speed: studio.speed,
      language: studio.language,
      text: studio.text,
    });
  }

  function selectedVoice() {
    const studio = T.state.studio;
    return (
      T.state.voices.find((voice) => voice.id === studio.voiceId) ||
      T.state.voices[0] ||
      null
    );
  }

  function isTrained(voice) {
    return Boolean(voice && voice.status === "ready" && (voice.emotions_ready || []).length);
  }

  function canGenerate(voice) {
    const studio = T.state.studio;
    return Boolean(
      !T.state.generating &&
        isTrained(voice) &&
        (voice.emotions_ready || []).includes(studio.emotion) &&
        String(studio.text || "").trim()
    );
  }

  function updateGenerateButton() {
    const button = document.getElementById("generateBtn");
    if (!button) return;
    const voice = selectedVoice();
    button.disabled = !canGenerate(voice);
    button.innerHTML = T.state.generating
      ? `${icon("refresh", "spin")} Rendering…`
      : `${icon("sparkles")} Generate speech`;
  }

  function resultHtml() {
    const studio = T.state.studio;
    const voice = selectedVoice();
    if (T.state.generating) {
      return `
        <div class="generating">
          <div class="eq">${"<span></span>".repeat(8)}</div>
          <div>
            <strong>Rendering ${esc(studio.emotion)}…</strong>
            <div class="hint">${voice ? esc(voice.name) : "Voice"} · ${Math.round(studio.intensity * 100)}% intensity. Long scripts take longer.</div>
          </div>
        </div>`;
    }

    const error = T.state.studioError
      ? `<div class="banner err" style="margin-bottom:12px">${esc(T.state.studioError)}</div>`
      : "";

    const generation = T.state.lastGeneration;
    if (!generation) {
      return `${error}
        <div class="result-empty">
          ${icon("headphones")}
          <div><strong>Nothing rendered yet</strong><span>Write a line and press Generate. Every take is saved to History.</span></div>
        </div>`;
    }

    return `${error}
      <div class="result-head">
        <div class="result-title">
          <span class="dot ${generation.emotion}"></span>
          <div>
            <h3>Latest take</h3>
            <div class="result-meta">${esc(generation.voice_name || (voice && voice.name) || "Voice")} · ${esc(generation.emotion)} · ${fmtDur(generation.duration)} · ${esc(generation.engine || "")}</div>
          </div>
        </div>
        <div class="head-actions">
          <a class="btn ghost sm" href="#/history">Open history</a>
        </div>
      </div>
      ${T.playerHtml(generation.id, media(generation.url), generation.duration)}`;
  }

  function paintResult() {
    const panel = document.getElementById("resultPanel");
    if (!panel) return;
    panel.innerHTML = resultHtml();
    if (T.hydratePlayers) T.hydratePlayers(panel);
    updateGenerateButton();
  }

  function notReadyBanner(voice) {
    if (!voice) return "";
    if (voice.status === "training") {
      return `<div class="banner">This voice is still training. You can generate as soon as it finishes. <a class="accent" href="#/voices/${voice.id}">Watch progress</a></div>`;
    }
    if (voice.status === "error") {
      return `<div class="banner err">Training failed: ${esc(voice.error || "unknown error")}. <a class="accent" href="#/voices/${voice.id}">Open the voice</a> to try again.</div>`;
    }
    return `<div class="banner">This voice isn't trained yet. Add samples and train it first. <a class="accent" href="#/voices/${voice.id}">Open the voice</a></div>`;
  }

  function emptyStudio() {
    return `
      <div class="empty" style="margin-top:4vh">
        <div class="empty-rings"><span class="empty-orb">${icon("sparkles")}</span></div>
        <h2>No voices to speak with</h2>
        <p>Create a voice, add some clean takes, and train it. Then come back here and write anything.</p>
        <div class="head-actions">
          <button class="btn primary lg" type="button" data-action="new-voice">${icon("plus")} New voice</button>
          <button class="btn ghost lg" type="button" data-action="help">Setup &amp; help</button>
        </div>
      </div>`;
  }

  function controlsHtml(voice) {
    const studio = T.state.studio;
    const readyEmotions = voice.emotions_ready || [];
    const voices = T.state.voices;
    const options = voices
      .map((item) => {
        const suffix = item.status === "ready" ? "" : ` — ${item.status}`;
        return `<option value="${item.id}" ${item.id === voice.id ? "selected" : ""}>${esc(item.name + suffix)}</option>`;
      })
      .join("");

    const chips = EMOTIONS.map((emotion) => {
      const locked = !readyEmotions.includes(emotion);
      return `<button class="emo-chip ${emotion === studio.emotion ? "active" : ""}" type="button"
        style="--emo-color:${EMOTION_COLORS[emotion]}" data-action="studio-emotion" data-emotion="${emotion}"
        ${locked ? "disabled" : ""} title="${locked ? `Train ${emotion} samples to unlock this mood` : `${emotion} mood`}">
        <span class="dot ${emotion}"></span>${emotion}${locked ? '<span class="lock">locked</span>' : ""}
      </button>`;
    }).join("");

    const intensity = Math.round(studio.intensity * 100);
    const speed = Math.round(studio.speed * 100);
    const languageOptions = LANGS.map(
      ([value, label]) => `<option value="${value}" ${value === studio.language ? "selected" : ""}>${label}</option>`
    ).join("");

    return `
      <div class="field">
        <label class="field-label" for="voiceSelect">Voice</label>
        <select class="select" id="voiceSelect">${options}</select>
      </div>
      <div class="field">
        <label class="field-label" for="languageSelect">Language</label>
        <select class="select" id="languageSelect">${languageOptions}</select>
      </div>
      <div class="field">
        <span class="field-label">Emotion</span>
        <div class="emotion-grid">${chips}</div>
        <span class="hint">${readyEmotions.length ? `${readyEmotions.length} of ${EMOTIONS.length} moods trained in this voice.` : "No moods trained yet."}</span>
      </div>
      <div class="field">
        <div class="field-row"><label class="field-label" for="intensityRange">Intensity</label><output id="intensityOut">${intensity}%</output></div>
        <input type="range" id="intensityRange" min="0" max="100" step="1" value="${intensity}" style="--fill:${intensity}%" />
        <div class="range-scale"><span>Subtle</span><span>Full</span></div>
      </div>
      <div class="field">
        <div class="field-row"><label class="field-label" for="speedRange">Speed</label><output id="speedOut">${(speed / 100).toFixed(2)}×</output></div>
        <input type="range" id="speedRange" min="50" max="150" step="1" value="${speed}" style="--fill:${Math.round(((speed - 50) / 100) * 100)}%" />
        <div class="range-scale"><span>Slower</span><span>Faster</span></div>
      </div>`;
  }

  function paintStudio(view) {
    const voices = T.state.voices || [];
    if (!voices.length) {
      view.innerHTML = emptyStudio();
      return;
    }

    const studio = T.state.studio;
    const voice = selectedVoice();
    if (!voice) return;
    studio.voiceId = voice.id;
    T.state.voice = voice;

    const readyEmotions = voice.emotions_ready || [];
    if (!readyEmotions.includes(studio.emotion)) {
      studio.emotion = readyEmotions[0] || "neutral";
    }
    if (!LANGS.some(([value]) => value === studio.language)) {
      studio.language = voice.language || "en";
    }
    if (!LANGS.some(([value]) => value === studio.language)) studio.language = "en";
    saveStudio();

    const trained = isTrained(voice);
    const engine = (T.state.health && T.state.health.engine) || null;
    const mock = engine && engine.key === "mock";
    const tip = T.TIPS[studio.emotion] || "";
    const chars = String(studio.text || "").length;
    const presets = SAMPLE_TEXTS.map(
      (sample, index) =>
        `<button class="preset" type="button" data-action="studio-preset" data-index="${index}">${esc(sample.label)}</button>`
    ).join("");

    view.innerHTML = `
      <header class="page-head">
        <div>
          <p class="eyebrow">Studio</p>
          <h1>Make it speak</h1>
          <p class="lede">Pick a trained voice and a mood, then write the line. The engine renders a WAV on this machine.</p>
        </div>
        <div class="head-actions">
          <a class="btn ghost" href="#/history">${icon("clock")} History</a>
          <a class="btn ghost" href="#/voices">${icon("wave")} Voices</a>
        </div>
      </header>
      <div class="studio">
        <aside class="studio-controls">
          <section class="card">
            ${controlsHtml(voice)}
          </section>
          <section class="card">
            <h2 style="font-size:13px;margin-bottom:8px">Delivery note</h2>
            <p class="tip-note">${esc(tip)}</p>
            <div class="rail-sep"></div>
            <div class="readiness-row"><span>Engine</span><span class="val">${esc((engine && engine.label) || "Local engine")}</span></div>
            <div class="readiness-row"><span>Device</span><span class="val">${esc(((T.state.health && T.state.health.device) || "cpu").toUpperCase())}</span></div>
            <div class="readiness-row"><span>Reference used</span><span class="val">${fmtDur(voice.total_seconds)}</span></div>
          </section>
        </aside>
        <div class="studio-main">
          ${mock ? `<div class="banner">The mock engine is active, so you'll hear placeholder tones instead of the cloned voice. Run the setup to install XTTS for the real thing.</div>` : ""}
          ${trained ? "" : notReadyBanner(voice)}
          <section class="card compose">
            <div class="card-head" style="margin-bottom:0">
              <div>
                <h2>Script</h2>
                <p id="charCount">${chars} / 2000 characters</p>
              </div>
              <span class="hint">${esc(voice.name)} · ${esc(studio.emotion)}</span>
            </div>
            <textarea id="scriptInput" maxlength="2000" placeholder="Type what this voice should say…">${esc(studio.text)}</textarea>
            <div class="preset-row"><span class="preset-label">Try</span>${presets}</div>
            <div class="compose-actions">
              <span class="hint">${esc(T.langLabel(studio.language))} · ${Math.round(studio.intensity * 100)}% intensity · ${studio.speed.toFixed(2)}× speed</span>
              <button class="btn primary lg" type="button" id="generateBtn" data-action="generate">
                ${icon("sparkles")} Generate speech
              </button>
            </div>
          </section>
          <section class="card result">
            <div id="resultPanel">${resultHtml()}</div>
          </section>
        </div>
      </div>`;

    bindControls(view);
    updateGenerateButton();
  }

  function bindControls(view) {
    const studio = T.state.studio;
    const area = view.querySelector("#scriptInput");
    const count = view.querySelector("#charCount");
    const voiceSelect = view.querySelector("#voiceSelect");
    const languageSelect = view.querySelector("#languageSelect");
    const intensity = view.querySelector("#intensityRange");
    const intensityOut = view.querySelector("#intensityOut");
    const speed = view.querySelector("#speedRange");
    const speedOut = view.querySelector("#speedOut");

    if (area) {
      area.addEventListener("input", () => {
        studio.text = area.value;
        if (count) count.textContent = `${area.value.length} / 2000 characters`;
        saveStudio();
        updateGenerateButton();
      });
      area.addEventListener("keydown", (event) => {
        if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
          event.preventDefault();
          const button = document.getElementById("generateBtn");
          if (button && !button.disabled) T.actions["generate"](button);
        }
      });
    }

    if (voiceSelect) {
      voiceSelect.addEventListener("change", () => {
        studio.voiceId = voiceSelect.value;
        const next = T.state.voices.find((voice) => voice.id === studio.voiceId);
        if (next && !(next.emotions_ready || []).includes(studio.emotion)) {
          studio.emotion = (next.emotions_ready || [])[0] || "neutral";
        }
        if (next && next.language) studio.language = next.language;
        saveStudio();
        paintStudio(view);
      });
    }

    if (languageSelect) {
      languageSelect.addEventListener("change", () => {
        studio.language = languageSelect.value;
        saveStudio();
      });
    }

    if (intensity) {
      intensity.addEventListener("input", () => {
        studio.intensity = Number(intensity.value) / 100;
        if (intensityOut) intensityOut.textContent = `${intensity.value}%`;
        intensity.style.setProperty("--fill", `${intensity.value}%`);
        saveStudio();
      });
    }

    if (speed) {
      speed.addEventListener("input", () => {
        studio.speed = Number(speed.value) / 100;
        if (speedOut) speedOut.textContent = `${studio.speed.toFixed(2)}×`;
        speed.style.setProperty("--fill", `${Math.round(((Number(speed.value) - 50) / 100) * 100)}%`);
        saveStudio();
      });
    }
  }

  async function renderStudio(view, params) {
    if (T.stopPlayers) T.stopPlayers();
    const voices = await T.api("/api/voices");
    T.state.voices = voices;
    T.updateNavCount();

    if (!voices.length) {
      T.state.generating = false;
      view.innerHTML = emptyStudio();
      return;
    }

    const studio = T.state.studio;
    const requested = params && params.get("voice");
    if (requested && voices.some((voice) => voice.id === requested)) {
      studio.voiceId = requested;
    }

    let voice =
      voices.find((item) => item.id === studio.voiceId) ||
      voices.find((item) => item.status === "ready") ||
      voices[0];
    studio.voiceId = voice.id;

    const requestedEmotion = params && params.get("emotion");
    if (requestedEmotion && EMOTIONS.includes(requestedEmotion)) {
      studio.emotion = requestedEmotion;
    }
    if (!(voice.emotions_ready || []).includes(studio.emotion)) {
      studio.emotion = (voice.emotions_ready || [])[0] || "neutral";
    }
    if (!LANGS.some(([value]) => value === studio.language)) {
      studio.language = voice.language || "en";
    }

    paintStudio(view);
  }

  T.renderStudio = renderStudio;

  T.actions["studio-emotion"] = (el) => {
    T.state.studio.emotion = el.dataset.emotion;
    saveStudio();
    const view = document.getElementById("view");
    if (view) paintStudio(view);
  };

  T.actions["studio-preset"] = (el) => {
    const index = Number(el.dataset.index);
    const sample = SAMPLE_TEXTS[index];
    if (!sample) return;
    T.state.studio.text = sample.text;
    saveStudio();
    const area = document.getElementById("scriptInput");
    if (area) {
      area.value = sample.text;
      area.focus();
      const count = document.getElementById("charCount");
      if (count) count.textContent = `${sample.text.length} / 2000 characters`;
    }
    updateGenerateButton();
  };

  T.actions["generate"] = async (el) => {
    const studio = T.state.studio;
    const voice = selectedVoice();
    if (!voice || T.state.generating) return;
    const area = document.getElementById("scriptInput");
    const text = String((area && area.value) || studio.text || "").trim();
    if (!text) {
      T.toast("Write something for the voice to say.", "warn");
      return;
    }
    if (!isTrained(voice)) {
      T.toast("Train this voice before generating speech.", "warn");
      return;
    }
    if (!(voice.emotions_ready || []).includes(studio.emotion)) {
      T.toast(`The ${studio.emotion} mood isn't trained for this voice.`, "warn");
      return;
    }

    studio.text = text;
    saveStudio();
    T.state.generating = true;
    T.state.studioError = "";
    paintResult();
    if (el) el.disabled = true;

    try {
      const generation = await T.api(`/api/voices/${voice.id}/speak`, {
        method: "POST",
        timeout: 600000,
        body: {
          text,
          emotion: studio.emotion,
          intensity: studio.intensity,
          speed: studio.speed,
          language: studio.language,
        },
      });
      T.state.lastGeneration = generation;
      T.state.generating = false;
      paintResult();
      T.toast("Take ready.", "ok");
    } catch (error) {
      T.state.generating = false;
      T.state.studioError = error.message;
      paintResult();
      T.toast(error.message, "err");
    }
  };
})();
