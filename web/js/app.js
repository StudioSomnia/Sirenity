/* Timbre — application core: data, routing, health, shared UI helpers. */
(() => {
  "use strict";

  const A = window.TimbreAudio;
  const T = (window.Timbre = window.Timbre || {});
  T.actions = {};

  // ------------------------------------------------------------------ data

  const EMOTIONS = ["neutral", "happy", "sad", "angry", "excited", "calm", "fearful", "whisper"];
  const CORE = ["neutral", "happy", "sad", "angry"];
  const EMOTION_COLORS = {
    neutral: "#94a3b8",
    happy: "#fbbf24",
    sad: "#60a5fa",
    angry: "#f87171",
    excited: "#fb923c",
    calm: "#34d399",
    fearful: "#c084fc",
    whisper: "#cbd5e1",
  };

  const SCRIPTS = {
    neutral: [
      "The train leaves at seven, so we should be at the station by six-thirty. I'll bring the tickets and the umbrella, just in case.",
      "I've been reading about the lighthouse on the north shore. Apparently it's been standing for over a hundred years.",
      "Take the second left after the bakery, then walk until you reach the green door. You can't miss it.",
      "The meeting is on Thursday at ten. I'll send the notes around beforehand so everyone has time to read them.",
    ],
    happy: [
      "I can't believe it actually worked! We spent all night on that thing, and it worked on the very first try.",
      "Oh, you have to see this — the whole garden is blooming. I've been waiting months for this.",
      "That's wonderful news. Really. I'm so happy for you, and I mean that.",
      "Wait, wait — say that again? You got the job? That's incredible!",
    ],
    sad: [
      "I keep picking up my phone to call her, and then I remember. It's strange how quickly that becomes a habit.",
      "The house feels so much emptier now. I didn't expect the quiet to be the hardest part.",
      "I thought I'd have more time. That's what everyone says, isn't it? I thought I'd have more time.",
      "I found his coat in the hall today. I stood there for a while, and then I hung it back up.",
    ],
    angry: [
      "You had one job. One. And you knew exactly how much this mattered to everyone here.",
      "Don't tell me to calm down. I've been calm for three weeks, and nothing has changed.",
      "I'm not asking again. Fix it, or I'll find someone who will.",
      "Do you have any idea what you've done? Any idea at all?",
    ],
    excited: [
      "Okay, okay — listen to this. They're sending us to the festival, all expenses paid, and we leave on Friday.",
      "Did you see that? Did you see it? I've never seen anything move that fast in my life.",
      "We did it! We actually did it! Somebody get the camera before I wake up.",
    ],
    calm: [
      "Breathe in slowly. Hold it for a moment, and then let it go. There's no hurry.",
      "The water is warm today, and the wind has finally dropped. We can stay out as long as you like.",
      "Everything is where it should be. The doors are locked, the lights are off. You can rest now.",
    ],
    fearful: [
      "Did you hear that? It came from the hallway. I thought everyone had gone home.",
      "I don't want to go down there. Something about the air feels wrong, and I can't explain why.",
      "There's someone at the window. Don't look. Don't let them see you looking.",
    ],
    whisper: [
      "Keep your voice down. The door at the end of the hall is open, and I don't think we're alone.",
      "I found something in the attic. I don't know what it is, but I think it's been waiting for us.",
      "Come closer. I need to tell you this before the others get back.",
    ],
  };

  const TIPS = {
    neutral: "Speak evenly, like you're explaining something ordinary. No performance needed.",
    happy: "Smile while you speak — it changes the sound. Let your pitch rise at the ends of phrases.",
    sad: "Slow down and let the energy drop. A little breathiness helps; don't push volume.",
    angry: "Project from the chest rather than shouting into the mic. Keep consonants sharp.",
    excited: "Brighter, faster, bigger pitch swings. Sounding a little breathless is fine.",
    calm: "Low, steady and unhurried. Leave real pauses between sentences.",
    fearful: "Tighter, quieter, slightly shaky. Let the breath catch now and then.",
    whisper: "Whisper close to the mic with no vocal fry. Keep it controlled and audible.",
  };

  const SAMPLE_TEXTS = [
    {
      label: "Narration",
      text: "The lighthouse had been dark for twenty years, but on the night the storm arrived, its lamp began to turn again. Below it, the town held its breath.",
    },
    {
      label: "Conversation",
      text: "Honestly? I wasn't sure I'd make it. The traffic was a nightmare, then it started raining, and of course I'd left the umbrella at home.",
    },
    {
      label: "Character",
      text: "You've come a long way to find me. I hope you brought more than questions, because I've been answering those for a very long time.",
    },
    {
      label: "Audiobook",
      text: "Chapter One. The house on Alder Street had stood empty for as long as anyone could remember, and that was exactly how the town preferred it.",
    },
  ];

  const LANGS = [
    ["en", "English"], ["es", "Spanish"], ["fr", "French"], ["de", "German"],
    ["it", "Italian"], ["pt", "Portuguese"], ["pl", "Polish"], ["tr", "Turkish"],
    ["ru", "Russian"], ["nl", "Dutch"], ["cs", "Czech"], ["ar", "Arabic"],
    ["zh-cn", "Chinese (Mandarin)"], ["ja", "Japanese"], ["hu", "Hungarian"],
    ["ko", "Korean"], ["hi", "Hindi"],
  ];

  // ----------------------------------------------------------------- icons

  const ICONS = {
    play: '<path d="M8 5.5v13l11-6.5z" fill="currentColor" stroke="none"/>',
    pause: '<path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor" stroke="none"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    upload: '<path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5"/><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
    download: '<path d="M12 4v12m0 0 4.5-4.5M12 16l-4.5-4.5"/><path d="M4 17v1a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1"/>',
    trash: '<path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13"/><path d="M10 11v5M14 11v5"/>',
    mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7"/>',
    alert: '<path d="M12 3 2.5 20h19z"/><path d="M12 9v5M12 17.5v.5"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    arrowLeft: '<path d="M19 12H5m0 0 6-6m-6 6 6 6"/>',
    arrowRight: '<path d="M5 12h14m0 0-6-6m6 6-6 6"/>',
    sparkles: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
    refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
    wave: '<path d="M3 10v4M7 7v10M11 4v16M15 8v8M19 11v2"/>',
    shield: '<path d="M12 3 5 6v6c0 4.4 3 8.2 7 9 4-.8 7-4.6 7-9V6z"/><path d="m9 12 2 2 4-4"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    headphones: '<path d="M4 14v-2a8 8 0 0 1 16 0v2"/><path d="M4 14h2v6H5a1 1 0 0 1-1-1zM20 14h-2v6h1a1 1 0 0 0 1-1z"/>',
    file: '<path d="M6 3h7l5 5v13H6z"/><path d="M13 3v5h5"/>',
    external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none"/>',
    chevron: '<path d="m9 6 6 6-6 6"/>',
  };

  function icon(name, extra = "") {
    const body = ICONS[name] || "";
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="${extra}">${body}</svg>`;
  }

  // ----------------------------------------------------------------- utils

  const HTML_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  const esc = (value) => String(value == null ? "" : value).replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);

  function fmtDur(seconds) {
    const value = Number(seconds) || 0;
    if (value < 60) return `${value < 10 ? value.toFixed(1) : Math.round(value)}s`;
    const mins = Math.floor(value / 60);
    const secs = Math.round(value % 60);
    return `${mins}m ${secs}s`;
  }

  function fmtDate(ts) {
    if (!ts) return "—";
    const date = new Date(ts * 1000);
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  }

  function fmtDateTime(ts) {
    if (!ts) return "—";
    return new Date(ts * 1000).toLocaleString(undefined, {
      month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
    });
  }

  function dayLabel(ts) {
    const date = new Date(ts * 1000);
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);
    if (date.toDateString() === today.toDateString()) return "Today";
    if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
    return date.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
  }

  function initials(name) {
    const parts = String(name || "?").trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "?";
    const letters = parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[parts.length - 1][0];
    return letters.toUpperCase();
  }

  function hueFor(name) {
    let hash = 0;
    const text = String(name || "");
    for (let i = 0; i < text.length; i += 1) hash = (hash * 31 + text.charCodeAt(i)) % 360;
    return 220 + (hash % 140);
  }

  function avatarHtml(name, extra = "") {
    return `<span class="avatar ${extra}" style="--h:${hueFor(name)}">${esc(initials(name))}</span>`;
  }

  function statusPill(voice) {
    if (!voice) return "";
    if (voice.status === "training") return `<span class="pill training"><i></i>Training</span>`;
    if (voice.status === "error") return `<span class="pill error"><i></i>Error</span>`;
    if (voice.status === "ready") {
      return `<span class="pill ready"><i></i>Ready</span>`;
    }
    return `<span class="pill"><i></i>Draft</span>`;
  }

  function playerHtml(id, url, duration, { compact = false, download = true } = {}) {
    return `
      <div class="player" data-player="${esc(id)}" data-src="${esc(url)}" data-duration="${Number(duration) || 0}">
        <button class="play-btn" type="button" data-action="player-toggle" data-id="${esc(id)}" aria-label="Play">${icon("play")}</button>
        <div class="player-wave" data-action="player-seek" data-id="${esc(id)}">
          <div class="wave-wrap"><canvas class="wave-canvas"></canvas></div>
        </div>
        <span class="player-time">0:00 / ${A.formatTime(duration)}</span>
        ${compact ? "" : `<div class="player-actions"><a class="icon-btn" href="${esc(url)}" download aria-label="Download WAV" title="Download WAV">${icon("download")}</a></div>`}
      </div>`;
  }

  function toast(message, kind = "ok") {
    const host = document.getElementById("toasts");
    if (!host) return;
    const symbols = { ok: "check", err: "alert", warn: "alert" };
    const node = document.createElement("div");
    node.className = `toast ${kind}`;
    node.innerHTML = `<span class="t-icon">${icon(symbols[kind] || "check")}</span><span>${esc(message)}</span>`;
    host.appendChild(node);
    setTimeout(() => {
      node.classList.add("leaving");
      setTimeout(() => node.remove(), 220);
    }, kind === "err" ? 6500 : 3800);
  }

  function persist(key, value) {
    try { localStorage.setItem(`timbre.${key}`, JSON.stringify(value)); } catch (_) {}
  }

  function restore(key, fallback) {
    try {
      const raw = localStorage.getItem(`timbre.${key}`);
      return raw ? JSON.parse(raw) : fallback;
    } catch (_) {
      return fallback;
    }
  }

  // ------------------------------------------------------------------- api

  const onHttp = location.protocol === "http:" || location.protocol === "https:";
  const API_BASE = onHttp ? "" : "http://127.0.0.1:8000";

  class ApiError extends Error {
    constructor(message, status) {
      super(message);
      this.name = "ApiError";
      this.status = status;
    }
  }

  async function request(path, { method = "GET", body = null, form = null, timeout = 180000 } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const options = { method, signal: controller.signal, headers: {} };
      if (form) options.body = form;
      else if (body !== null) {
        options.headers["Content-Type"] = "application/json";
        options.body = JSON.stringify(body);
      }
      const response = await fetch(API_BASE + path, options);
      const type = response.headers.get("content-type") || "";
      const payload = type.includes("application/json")
        ? await response.json().catch(() => null)
        : await response.text();
      if (!response.ok) {
        let detail = payload && payload.detail ? payload.detail : payload;
        if (Array.isArray(detail)) detail = detail.map((item) => item.msg || JSON.stringify(item)).join("; ");
        if (!detail || typeof detail !== "string") detail = `Request failed (${response.status}).`;
        throw new ApiError(detail, response.status);
      }
      return payload;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (error && error.name === "AbortError") {
        throw new ApiError("The engine took too long to respond.", 0);
      }
      throw new ApiError("Cannot reach the local engine. Is the server running?", 0);
    } finally {
      clearTimeout(timer);
    }
  }

  // ----------------------------------------------------------------- state

  const studioDefaults = {
    voiceId: null,
    emotion: "neutral",
    intensity: 1,
    speed: 1,
    language: "en",
    text: SAMPLE_TEXTS[0].text,
  };

  const state = {
    online: false,
    health: null,
    voices: [],
    route: { name: "voices" },
    voice: null,
    clips: [],
    detailTab: "neutral",
    job: null,
    studio: Object.assign({}, studioDefaults, restore("studio", {})),
    lastGeneration: null,
    generating: false,
    modalCleanup: null,
    pollingJob: null,
    pollTimer: null,
    lastHash: null,
  };

  // --------------------------------------------------------------- helpers

  function currentVoice() {
    if (state.voice && state.voice.id === state.studio.voiceId) return state.voice;
    return state.voices.find((voice) => voice.id === state.studio.voiceId) || null;
  }

  function readyVoices() {
    return state.voices.filter((voice) => voice.status === "ready" && voice.emotions_ready.length);
  }

  function updateNavCount() {
    const el = document.getElementById("navVoiceCount");
    if (!el) return;
    if (!state.voices.length) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    el.textContent = String(state.voices.length);
  }

  function setActiveNav() {
    const active = state.route.name === "voice" ? "voices" : state.route.name;
    document.querySelectorAll("[data-nav]").forEach((link) => {
      link.classList.toggle("active", link.dataset.nav === active);
    });
  }

  function setOnline(online) {
    state.online = online;
    const bar = document.getElementById("offlineBar");
    if (bar) bar.hidden = online;
    renderEngineCard();
  }

  function renderEngineCard() {
    const pulse = document.getElementById("enginePulse");
    if (!pulse) return;
    const label = document.getElementById("engineLabel");
    const detail = document.getElementById("engineDetail");

    if (!state.online) {
      pulse.className = "pulse err";
      label.textContent = "Engine offline";
      detail.textContent = "Start the local server, then retry.";
      return;
    }

    const engine = (state.health && state.health.engine) || {};
    const device = (state.health && state.health.device) || "cpu";
    if (!engine.installed) {
      pulse.className = "pulse warn";
      label.textContent = "Engine not installed";
      detail.textContent = "Run setup once to install XTTS.";
      return;
    }
    if (engine.state === "loading") {
      pulse.className = "pulse loading";
      label.textContent = "Loading model…";
      detail.textContent = "The first run can take a few minutes.";
      return;
    }
    if (engine.state === "error") {
      pulse.className = "pulse err";
      label.textContent = "Engine error";
      detail.textContent = (engine.error || "See setup notes.").slice(0, 70);
      return;
    }
    if (engine.key === "mock") {
      pulse.className = "pulse warn";
      label.textContent = "Mock engine";
      detail.textContent = "Placeholder tones. Install XTTS for real voices.";
      return;
    }
    pulse.className = "pulse ok";
    label.textContent = engine.label || "XTTS v2";
    detail.textContent = `${String(device).toUpperCase()} · local · ready`;
  }

  async function checkHealth({ announce = false } = {}) {
    try {
      const health = await request("/api/health", { timeout: 6000 });
      const wasOffline = !state.online;
      state.health = health;
      setOnline(true);
      if (wasOffline && announce) toast("Connected to the local engine.", "ok");
      if (wasOffline) await route();
      return true;
    } catch (_) {
      const wasOnline = state.online;
      state.health = null;
      setOnline(false);
      if (wasOnline) {
        toast("Lost connection to the local engine.", "err");
        await route();
      }
      return false;
    }
  }

  // ----------------------------------------------------------------- views

  function parseHash() {
    const raw = (location.hash || "").replace(/^#\/?/, "");
    const [pathPart, queryPart] = raw.split("?");
    const parts = pathPart.split("/").filter(Boolean);
    const params = new URLSearchParams(queryPart || "");
    if (parts[0] === "studio") return { name: "studio", params };
    if (parts[0] === "history") return { name: "history" };
    if (parts[0] === "voices" && parts[1]) return { name: "voice", id: decodeURIComponent(parts[1]) };
    return { name: "voices" };
  }

  async function route() {
    const next = parseHash();
    const view = document.getElementById("view");
    if (!view) return;
    const changed = state.lastHash !== location.hash;
    state.route = next;
    state.lastHash = location.hash;
    setActiveNav();
    if (changed) view.scrollTop = 0;

    if (!state.online) {
      view.innerHTML = offlineView();
      return;
    }

    view.innerHTML = skeletonView(next);
    try {
      if (next.name === "voices") await T.renderVoices(view);
      else if (next.name === "voice") await T.renderVoice(view, next.id);
      else if (next.name === "studio") await T.renderStudio(view, next.params);
      else if (next.name === "history") await T.renderHistory(view);
    } catch (error) {
      view.innerHTML = errorView(error.message || "Something went wrong.");
    }
  }

  function go(hash) {
    if (location.hash === hash) route();
    else location.hash = hash;
  }

  // ---------------------------------------------------------- fallback views

  function skeletonView(routeInfo) {
    return `
      <div class="loading-block">
        <div class="skel" style="height:34px;width:280px"></div>
        <div class="skel" style="height:14px;width:420px;max-width:80%"></div>
        <div class="skel" style="height:96px;margin-top:18px"></div>
        <div class="skel" style="height:180px"></div>
      </div>`;
  }

  function offlineView() {
    return `
      <div class="empty" style="margin-top:6vh">
        <div class="empty-rings"><span class="empty-orb">${icon("wave")}</span></div>
        <h2>Start the local engine</h2>
        <p>The studio UI is here, but the voice engine runs locally. Start it once and this page will connect automatically.</p>
        <div style="max-width:460px;margin:0 auto;text-align:left;display:flex;flex-direction:column;gap:10px">
          <div class="help-step"><b>1</b><div>Open a terminal in the project folder.</div></div>
          <div class="help-step"><b>2</b><div>Run the launcher. It installs everything on first use.</div></div>
          <div class="code-block">.\\run.ps1<button class="copy-btn" type="button" data-action="copy" data-copy=".\\run.ps1" aria-label="Copy">${icon("copy")}</button></div>
          <div class="help-step"><b>3</b><div>Open <span class="mono">http://127.0.0.1:8000</span> if the browser does not open by itself.</div></div>
        </div>
        <div class="head-actions" style="margin-top:22px">
          <button class="btn primary" type="button" data-action="retry">${icon("refresh")} Retry connection</button>
          <button class="btn ghost" type="button" data-action="help">Setup notes</button>
        </div>
      </div>`;
  }

  function errorView(message) {
    return `
      <div class="empty" style="margin-top:6vh">
        <div class="empty-rings"><span class="empty-orb" style="background:radial-gradient(circle at 35% 30%,#fecaca,#ef4444 60%,#7f1d1d)">${icon("alert")}</span></div>
        <h2>Something went wrong</h2>
        <p>${esc(message)}</p>
        <div class="head-actions">
          <button class="btn primary" type="button" data-action="refresh">${icon("refresh")} Try again</button>
          <button class="btn ghost" type="button" data-action="help">Setup notes</button>
        </div>
      </div>`;
  }

  // ------------------------------------------------------------- actions

  T.actions["retry"] = async () => {
    const ok = await checkHealth({ announce: true });
    if (ok) await route();
    else toast("Still offline. Is the server running on port 8000?", "err");
  };

  T.actions["refresh"] = async () => {
    await checkHealth();
    await route();
  };

  T.actions["copy"] = async (el) => {
    const text = el.dataset.copy || "";
    try {
      await navigator.clipboard.writeText(text);
      toast("Copied to clipboard.", "ok");
    } catch (_) {
      toast("Could not copy automatically — select the text instead.", "warn");
    }
  };

  T.actions["warm-engine"] = async () => {
    try {
      await request("/api/engine/load", { method: "POST", timeout: 15000 });
      toast("Model warm-up started. The first run may download ~1.8 GB.", "ok");
      setTimeout(checkHealth, 1500);
    } catch (error) {
      toast(error.message, "err");
    }
  };

  // --------------------------------------------------------------- global

  function bindGlobal() {
    document.addEventListener("click", (event) => {
      const overlay = event.target.closest(".modal-overlay");
      if (overlay && !event.target.closest(".modal-card")) {
        if (T.closeModal) T.closeModal();
        return;
      }
      if (event.target.closest("[data-close]")) {
        if (T.closeModal) T.closeModal();
        return;
      }
      const el = event.target.closest("[data-action]");
      if (!el || el.disabled) return;
      const handler = T.actions[el.dataset.action];
      if (handler) handler(el, event);
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && T.closeModal) T.closeModal();
    });

    window.addEventListener("hashchange", () => { route(); });
  }

  async function boot() {
    bindGlobal();
    await checkHealth();
    await route();
    setInterval(() => {
      if (document.hidden) return;
      checkHealth();
    }, 20000);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  // ---------------------------------------------------------------- export

  Object.assign(T, {
    A,
    EMOTIONS,
    CORE,
    EMOTION_COLORS,
    SCRIPTS,
    TIPS,
    SAMPLE_TEXTS,
    LANGS,
    state,
    esc,
    icon,
    fmtDur,
    fmtDate,
    fmtDateTime,
    dayLabel,
    initials,
    hueFor,
    avatarHtml,
    statusPill,
    playerHtml,
    toast,
    persist,
    restore,
    request,
    api: request,
    ApiError,
    API_BASE,
    route,
    go,
    setActiveNav,
    updateNavCount,
    renderEngineCard,
    checkHealth,
    currentVoice,
    readyVoices,
    skeletonView,
    offlineView,
    errorView,
  });
})();
