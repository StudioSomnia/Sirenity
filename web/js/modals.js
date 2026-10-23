/* Timbre — dialogs: voices, recording, confirmation and setup help. */
(() => {
  "use strict";

  const T = window.Timbre;
  const { esc, icon } = T;

  let currentModal = null;

  // ------------------------------------------------------------ modal shell

  function openModal({ eyebrow = "", title = "", body = "", foot = "", wide = false, onMount = null, onCleanup = null }) {
    closeModal();
    const root = document.getElementById("modalRoot");
    if (!root) return null;
    root.innerHTML = `
      <div class="modal-overlay">
        <div class="modal-card ${wide ? "wide" : ""}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
          <div class="modal-head">
            <div>${eyebrow ? `<p class="eyebrow">${esc(eyebrow)}</p>` : ""}<h2>${esc(title)}</h2></div>
            <button class="icon-btn" type="button" data-close aria-label="Close">${icon("x")}</button>
          </div>
          <div class="modal-body">${body}</div>
          ${foot ? `<div class="modal-foot">${foot}</div>` : ""}
        </div>
      </div>`;
    const card = root.querySelector(".modal-card");
    currentModal = { card, onCleanup };
    if (onMount) onMount(card);
    requestAnimationFrame(() => {
      if (!currentModal || currentModal.card !== card) return;
      const target =
        card.querySelector("[autofocus]") ||
        card.querySelector("input:not([type=hidden]):not([disabled]), textarea, select, button:not([disabled])");
      if (target) target.focus();
    });
    return card;
  }

  function closeModal() {
    const record = currentModal;
    currentModal = null;
    if (record && typeof record.onCleanup === "function") {
      try {
        record.onCleanup();
      } catch (error) {
        console.error(error);
      }
    }
    const root = document.getElementById("modalRoot");
    if (root) root.innerHTML = "";
  }

  function confirmDialog({ eyebrow = "Confirm", title, message, confirmLabel = "Delete", danger = true }) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      openModal({
        eyebrow,
        title,
        body: `<p class="lede" style="margin-top:0">${esc(message)}</p>`,
        foot: `
          <button class="btn ghost" type="button" data-close>Cancel</button>
          <button class="btn ${danger ? "danger" : "primary"}" type="button" data-role="confirm">${esc(confirmLabel)}</button>`,
        onMount(card) {
          card.querySelector('[data-role="confirm"]').addEventListener("click", () => {
            finish(true);
            closeModal();
          });
        },
        onCleanup() {
          finish(false);
        },
      });
    });
  }

  function languageOptions(selected) {
    return T.LANGS.map(
      ([value, label]) => `<option value="${value}" ${value === selected ? "selected" : ""}>${label}</option>`
    ).join("");
  }

  function showFormError(card, message) {
    const box = card.querySelector("#formError");
    if (!box) return;
    box.hidden = !message;
    box.textContent = message || "";
  }

  // ------------------------------------------------------------- voice forms

  function openVoiceModal(voice = null) {
    const editing = Boolean(voice);
    const language = (voice && voice.language) || "en";
    openModal({
      eyebrow: editing ? "Voice details" : "New voice",
      title: editing ? "Edit this voice" : "Whose voice is this?",
      body: `
        <div class="form-row">
          <div class="form-field">
            <label for="voiceName">Name</label>
            <input class="input" id="voiceName" maxlength="80" autofocus placeholder="e.g. Mara — narrator" value="${esc(voice ? voice.name : "")}" />
          </div>
          <div class="form-field">
            <label for="voiceLang">Language</label>
            <select class="select" id="voiceLang">${languageOptions(language)}</select>
          </div>
        </div>
        <div class="form-field">
          <label for="voiceDesc">Description <span class="hint">optional</span></label>
          <textarea class="textarea" id="voiceDesc" maxlength="400" placeholder="Warm, low, close-mic…">${esc(voice ? voice.description : "")}</textarea>
        </div>
        ${editing ? "" : `
          <label class="check">
            <input type="checkbox" id="voiceConsent" />
            <span><strong>I have permission to clone this voice.</strong> It is my own voice, or I have explicit consent from the speaker. I will not use it to impersonate, deceive or harass.</span>
          </label>
          <div class="consent-note">Cloning a voice without permission may be illegal where you live. The model and every take stay on this machine.</div>`}
        <div class="banner err" id="formError" hidden></div>`,
      foot: `
        <button class="btn ghost" type="button" data-close>Cancel</button>
        <button class="btn primary" type="button" data-role="save">${editing ? "Save changes" : "Create voice"}</button>`,
      onMount(card) {
        const save = async () => {
          const name = card.querySelector("#voiceName").value.trim();
          const description = card.querySelector("#voiceDesc").value.trim();
          const lang = card.querySelector("#voiceLang").value;
          const consent = card.querySelector("#voiceConsent");
          const button = card.querySelector('[data-role="save"]');

          if (!name) return showFormError(card, "Give the voice a name.");
          if (!editing && consent && !consent.checked) {
            return showFormError(card, "Confirm that you have permission to clone this voice.");
          }

          showFormError(card, "");
          button.disabled = true;
          const previous = button.textContent;
          button.textContent = editing ? "Saving…" : "Creating…";
          try {
            if (editing) {
              await T.api(`/api/voices/${voice.id}`, {
                method: "PATCH",
                body: { name, description, language: lang },
              });
              closeModal();
              T.toast("Voice updated.", "ok");
              await T.route();
            } else {
              const created = await T.api("/api/voices", {
                method: "POST",
                body: { name, description, language: lang, consent: true },
              });
              closeModal();
              T.toast("Voice created. Add a few samples next.", "ok");
              T.go(`#/voices/${created.id}`);
            }
          } catch (error) {
            showFormError(card, error.message);
            button.disabled = false;
            button.textContent = previous;
          }
        };

        card.querySelector('[data-role="save"]').addEventListener("click", save);
        card.addEventListener("keydown", (event) => {
          if (event.key === "Enter" && !event.shiftKey && event.target.tagName !== "TEXTAREA") {
            event.preventDefault();
            save();
          }
        });
      },
    });
  }

  // --------------------------------------------------------------- recorder

  function openRecorder({ voiceId, emotion, onDone = null }) {
    const scripts = T.SCRIPTS[emotion] || T.SCRIPTS.neutral;
    let script = scripts[Math.floor(Math.random() * scripts.length)];
    let recorder = null;
    let recording = false;
    let take = null;
    let timer = null;
    let startedAt = 0;
    let previewUrl = null;

    openModal({
      eyebrow: `${emotion} sample`,
      title: "Record a take",
      body: `
        <div class="rec-script">
          <span class="quote-mark">“</span>
          <p data-role="script">${esc(script)}</p>
          <div class="rec-script-foot">
            <span class="rec-tip">${esc(T.TIPS[emotion] || "")}</span>
            <button class="mini-btn" type="button" data-role="shuffle">New line</button>
          </div>
        </div>
        <div class="meter" id="recMeter">${"<span></span>".repeat(30)}</div>
        <div class="rec-controls">
          <span class="rec-time" data-role="time">0:00</span>
          <button class="record-btn" type="button" data-role="record">
            <span class="rec-dot"></span><span data-role="label">Start recording</span>
          </button>
        </div>
        <p class="hint" data-role="hint">Read the line above in a natural voice. Stop, listen back, and record again if you like.</p>
        <div class="take-preview" data-role="preview" hidden>
          <audio controls data-role="audio"></audio>
        </div>
        <input type="file" accept="audio/*,.wav,.mp3,.m4a,.ogg,.flac" data-role="file" hidden />`,
      foot: `
        <button class="btn ghost" type="button" data-close>Cancel</button>
        <span class="spacer"></span>
        <button class="btn ghost" type="button" data-role="upload">${icon("upload")} Upload instead</button>
        <button class="btn primary" type="button" data-role="use" disabled>${icon("check")} Use take</button>`,
      onMount(card) {
        const meter = card.querySelector("#recMeter");
        const bars = Array.from(meter.querySelectorAll("span"));
        const timeEl = card.querySelector('[data-role="time"]');
        const recordBtn = card.querySelector('[data-role="record"]');
        const label = card.querySelector('[data-role="label"]');
        const hint = card.querySelector('[data-role="hint"]');
        const preview = card.querySelector('[data-role="preview"]');
        const audio = card.querySelector('[data-role="audio"]');
        const useBtn = card.querySelector('[data-role="use"]');
        const uploadBtn = card.querySelector('[data-role="upload"]');
        const fileInput = card.querySelector('[data-role="file"]');
        const scriptEl = card.querySelector('[data-role="script"]');
        const shuffle = card.querySelector('[data-role="shuffle"]');
        const shape = [0.35, 0.7, 1, 0.55, 0.85, 0.45, 0.95, 0.6, 0.4, 0.75];

        function paintMeter(level) {
          meter.classList.toggle("live", recording);
          meter.classList.toggle("hot", recording && level > 0.9);
          bars.forEach((bar, index) => {
            const amount = recording ? Math.max(0.05, level * shape[index % shape.length]) : 0.04;
            bar.style.height = `${Math.round(8 + amount * 92)}%`;
          });
        }

        function resetTake() {
          take = null;
          useBtn.disabled = true;
          useBtn.innerHTML = `${icon("check")} Use take`;
          preview.hidden = true;
          try {
            audio.pause();
          } catch (_) {}
          audio.removeAttribute("src");
          if (previewUrl) {
            URL.revokeObjectURL(previewUrl);
            previewUrl = null;
          }
        }

        function showTake(next) {
          take = next;
          previewUrl = URL.createObjectURL(next.blob);
          audio.src = previewUrl;
          preview.hidden = false;
          useBtn.disabled = false;
          hint.textContent = `Take ready · ${next.duration.toFixed(1)}s. Listen back, then add it to the voice.`;
          timeEl.textContent = T.A.formatTime(next.duration);
          timeEl.classList.remove("live");
        }

        function resetButton() {
          recordBtn.classList.remove("recording");
          label.textContent = "Start recording";
          timeEl.classList.remove("live");
          timeEl.textContent = "0:00";
          paintMeter(0);
        }

        function tick() {
          const elapsed = (performance.now() - startedAt) / 1000;
          timeEl.textContent = T.A.formatTime(elapsed);
          if (elapsed >= 120) void stopRecording();
        }

        async function stopRecording() {
          if (!recording || !recorder) return;
          recording = false;
          if (timer) clearInterval(timer);
          timer = null;
          recordBtn.disabled = true;
          recordBtn.classList.remove("recording");
          label.textContent = "Finishing…";
          timeEl.classList.remove("live");
          paintMeter(0);
          try {
            const result = await recorder.stop();
            recorder = null;
            if (!result) {
              T.toast("No audio was captured. Check the microphone and try again.", "err");
              resetButton();
              return;
            }
            resetTake();
            showTake({ blob: result.blob, duration: result.duration, transcript: script });
            label.textContent = "Record again";
          } catch (error) {
            T.toast(error.message, "err");
            resetButton();
          } finally {
            recordBtn.disabled = false;
          }
        }

        async function startRecording() {
          resetTake();
          try {
            recorder = T.A.createRecorder({ onLevel: paintMeter });
            await recorder.start();
          } catch (error) {
            if (recorder) recorder.cancel();
            recorder = null;
            T.toast(error.message, "err");
            return;
          }
          recording = true;
          recordBtn.classList.add("recording");
          label.textContent = "Stop recording";
          timeEl.classList.add("live");
          startedAt = performance.now();
          tick();
          timer = setInterval(tick, 200);
        }

        recordBtn.addEventListener("click", () => {
          if (recording) void stopRecording();
          else void startRecording();
        });

        shuffle.addEventListener("click", () => {
          if (scripts.length < 2) return;
          if (recording) {
            recording = false;
            if (timer) clearInterval(timer);
            timer = null;
            if (recorder) recorder.cancel();
            recorder = null;
            resetButton();
          }
          let next = script;
          while (next === script) next = scripts[Math.floor(Math.random() * scripts.length)];
          script = next;
          scriptEl.textContent = script;
          resetTake();
          resetButton();
          hint.textContent = "Read the line above in a natural voice. Stop, listen back, and record again if you like.";
        });

        uploadBtn.addEventListener("click", () => fileInput.click());

        fileInput.addEventListener("change", async () => {
          const file = (fileInput.files || [])[0];
          fileInput.value = "";
          if (!file) return;
          try {
            const wav = await T.A.fileToWav(file);
            resetTake();
            showTake({ blob: wav.blob, duration: wav.duration, transcript: "" });
            label.textContent = "Record again";
          } catch (error) {
            T.toast(error.message, "err");
          }
        });

        useBtn.addEventListener("click", async () => {
          if (!take) return;
          useBtn.disabled = true;
          const previous = useBtn.innerHTML;
          useBtn.textContent = "Adding…";
          try {
            const form = new FormData();
            form.append("file", take.blob, "take.wav");
            form.append("emotion", emotion);
            form.append("transcript", take.transcript || "");
            await T.api(`/api/voices/${voiceId}/clips`, {
              method: "POST",
              form,
              timeout: 300000,
            });
            closeModal();
            T.toast(`Added a ${emotion} take.`, "ok");
            if (onDone) onDone();
          } catch (error) {
            T.toast(error.message, "err");
            useBtn.disabled = false;
            useBtn.innerHTML = previous;
          }
        });

        paintMeter(0);
      },
      onCleanup() {
        if (timer) clearInterval(timer);
        timer = null;
        if (recorder) {
          try {
            recorder.cancel();
          } catch (_) {}
          recorder = null;
        }
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        previewUrl = null;
      },
    });
  }

  // -------------------------------------------------------------- file picker

  let uploadContext = null;
  let picker = null;

  function ensurePicker() {
    if (picker) return picker;
    picker = document.createElement("input");
    picker.type = "file";
    picker.accept = "audio/*,.wav,.mp3,.m4a,.ogg,.oga,.opus,.webm,.flac,.aiff,.aif";
    picker.multiple = true;
    picker.hidden = true;
    picker.addEventListener("change", () => {
      const files = Array.from(picker.files || []);
      const context = uploadContext;
      uploadContext = null;
      picker.value = "";
      if (files.length && context && T.uploadFiles) T.uploadFiles(files, context);
    });
    document.body.appendChild(picker);
    return picker;
  }

  function pickFiles(context) {
    uploadContext = context;
    ensurePicker().click();
  }

  // ------------------------------------------------------------------- help

  function pill(kind, text) {
    return `<span class="pill ${kind}"><i></i>${esc(text)}</span>`;
  }

  function openHelp() {
    const health = T.state.health || {};
    const engine = health.engine || {};
    const engineKey = engine.key || "unknown";
    const installed = Boolean(engine.installed);
    const device = String(health.device || engine.device || "cpu").toUpperCase();
    const statusPill = engine.state === "error"
      ? pill("error", "Engine error")
      : engineKey === "mock"
        ? pill("mock", "Mock engine")
        : installed
          ? pill("ready", engine.state === "loading" ? "Loading model" : "Engine ready")
          : pill("error", "Not installed");

    openModal({
      eyebrow: "Setup & help",
      title: "How Timbre works",
      wide: true,
      body: `
        <div class="card" style="padding:14px">
          <div class="card-head" style="margin-bottom:8px">
            <div><h3 style="font-size:13px">Engine</h3><p>${esc(engine.label || "Local engine")} · ${esc(device)}</p></div>
            ${statusPill}
          </div>
          <div class="hint">${esc(engine.error || (engineKey === "mock" ? "Placeholder tones only — install XTTS for real cloning." : "Everything runs locally. No audio is uploaded anywhere."))}</div>
          ${engineKey === "xtts" && installed && engine.state !== "loading"
            ? `<div style="margin-top:10px"><button class="btn ghost sm" type="button" data-action="warm-engine">${icon("refresh")} Load the model now</button></div>`
            : ""}
        </div>

        <div>
          <h3 style="font-size:13px;margin-bottom:8px">Quick start</h3>
          <div style="display:flex;flex-direction:column;gap:8px">
            <div class="help-step"><b>1</b><div><strong>Start the engine.</strong> In the project folder run <span class="mono">.\\run.ps1</span> (Windows) or <span class="mono">./run.sh</span> (macOS/Linux). The launcher creates a virtual environment on first use.</div></div>
            <div class="help-step"><b>2</b><div><strong>Create a voice.</strong> Confirm you have permission to clone it.</div></div>
            <div class="help-step"><b>3</b><div><strong>Add neutral speech.</strong> 20–40 seconds of clean, natural speech is ideal. Then optionally add happy, sad and angry takes.</div></div>
            <div class="help-step"><b>4</b><div><strong>Train, then speak.</strong> Training caches one conditioning latent per mood; changing mood later is quick.</div></div>
          </div>
        </div>

        <div>
          <h3 style="font-size:13px;margin-bottom:8px">Commands</h3>
          <div style="display:flex;flex-direction:column;gap:8px">
            <div class="code-block">.\\run.ps1<button class="copy-btn" type="button" data-action="copy" data-copy=".\\run.ps1" aria-label="Copy">${icon("copy")}</button></div>
            <div class="code-block">.\\run.ps1 -Cuda<button class="copy-btn" type="button" data-action="copy" data-copy=".\\run.ps1 -Cuda" aria-label="Copy">${icon("copy")}</button></div>
            <div class="code-block">$env:TIMBRE_ENGINE = "mock"; .\\run.ps1 -Mock<button class="copy-btn" type="button" data-action="copy" data-copy='$env:TIMBRE_ENGINE = "mock"; .\\run.ps1 -Mock' aria-label="Copy">${icon("copy")}</button></div>
          </div>
          <p class="hint" style="margin-top:7px">Use <span class="mono">-Cuda</span> to install the CUDA build of torch. Use <span class="mono">-Mock</span> to try the whole app without the 2 GB engine download.</p>
        </div>

        <div>
          <h3 style="font-size:13px;margin-bottom:8px">What makes a good clone</h3>
          <ul class="hint" style="margin:0;padding-left:18px;line-height:1.7">
            <li>One speaker, one microphone, one room per voice. Avoid music, reverb and background chatter.</li>
            <li>Speak a little closer than feels normal, but do not clip. Keep levels steady between takes.</li>
            <li>For moods, actually perform the emotion. A flat read labelled “happy” teaches nothing.</li>
            <li>30 seconds of neutral and ~15 seconds per mood is the sweet spot; more is not always better if it is noisy.</li>
            <li>Short, clean takes beat long, rambling ones. The engine uses at most 40 seconds of reference per emotion.</li>
          </ul>
        </div>

        <div>
          <h3 style="font-size:13px;margin-bottom:8px">Limits</h3>
          <div class="readiness">
            <div class="readiness-row"><span>Neutral minimum / target</span><span class="val">6s / 30s</span></div>
            <div class="readiness-row"><span>Emotion minimum / target</span><span class="val">4s / 15s</span></div>
            <div class="readiness-row"><span>Reference used per mood</span><span class="val">40s max</span></div>
            <div class="readiness-row"><span>Per clip / per script</span><span class="val">5 min / 2000 chars</span></div>
            <div class="readiness-row"><span>Data folder</span><span class="val mono">${esc(health.data_dir || "data")}</span></div>
          </div>
        </div>

        <div>
          <h3 style="font-size:13px;margin-bottom:8px">Troubleshooting</h3>
          <div style="display:flex;flex-direction:column;gap:8px">
            <div class="help-step"><b>!</b><div><strong>Microphone unavailable.</strong> Open the app at <span class="mono">http://127.0.0.1:8000</span>, not as a file. Allow microphone access for the page.</div></div>
            <div class="help-step"><b>!</b><div><strong>Port already in use.</strong> Run <span class="mono">.\\run.ps1 -Port 8010</span> and open that port instead.</div></div>
            <div class="help-step"><b>!</b><div><strong>“Engine not installed”.</strong> Run the launcher without <span class="mono">-Mock</span>, or install <span class="mono">requirements-engine.txt</span> inside the virtual environment.</div></div>
            <div class="help-step"><b>!</b><div><strong>First run feels stuck.</strong> XTTS downloads about 1.8 GB the first time. Training on CPU is slow; a GPU helps a lot.</div></div>
            <div class="help-step"><b>!</b><div><strong>Training was interrupted.</strong> Restarting the server marks the voice as a draft. Add samples if needed and train again.</div></div>
          </div>
        </div>

        <div class="consent-note">Timbre never uploads audio. It exists for consented voice work: your own voice, hired performers, or voices you have written permission to reproduce. Do not use it to impersonate people or to mislead.</div>`,
      foot: `<button class="btn primary" type="button" data-close>Got it</button>`,
    });
  }

  // ------------------------------------------------------------------ wiring

  T.openModal = openModal;
  T.closeModal = closeModal;
  T.confirmDialog = confirmDialog;
  T.openVoiceModal = openVoiceModal;
  T.openRecorder = openRecorder;
  T.openHelp = openHelp;
  T.pickFiles = pickFiles;

  T.actions["new-voice"] = () => openVoiceModal(null);

  T.actions["edit-voice"] = (el) => {
    const id = el.dataset.id;
    const voice =
      (T.state.voice && T.state.voice.id === id ? T.state.voice : null) ||
      T.state.voices.find((item) => item.id === id);
    if (voice) openVoiceModal(voice);
  };

  T.actions["delete-voice"] = async (el) => {
    const id = el.dataset.id;
    const voice =
      (T.state.voice && T.state.voice.id === id ? T.state.voice : null) ||
      T.state.voices.find((item) => item.id === id);
    const name = voice ? voice.name : "this voice";
    const ok = await confirmDialog({
      eyebrow: "Delete voice",
      title: `Delete ${name}?`,
      message:
        "Every sample, cached model and generated take for this voice is removed from disk. This cannot be undone.",
      confirmLabel: "Delete voice",
    });
    if (!ok) return;
    try {
      await T.api(`/api/voices/${id}`, { method: "DELETE" });
      T.state.voices = T.state.voices.filter((item) => item.id !== id);
      if (T.state.voice && T.state.voice.id === id) {
        T.state.voice = null;
        T.state.clips = [];
      }
      if (T.state.lastGeneration && T.state.lastGeneration.voice_id === id) {
        T.state.lastGeneration = null;
      }
      if (T.state.studio.voiceId === id) T.state.studio.voiceId = null;
      T.updateNavCount();
      T.toast("Voice deleted.", "ok");
      T.go("#/voices");
    } catch (error) {
      T.toast(error.message, "err");
    }
  };

  T.actions["help"] = () => openHelp();
})();
