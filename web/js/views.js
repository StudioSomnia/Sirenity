/* Timbre — the voice library. */
(() => {
  "use strict";

  const T = window.Timbre;
  const { esc, icon, fmtDur, avatarHtml, statusPill, EMOTIONS } = T;

  const media = (path) => (path ? T.API_BASE + path : "");
  T.media = media;

  function langLabel(code) {
    const hit = T.LANGS.find(([value]) => value === code);
    return hit ? hit[1] : String(code || "en").toUpperCase();
  }
  T.langLabel = langLabel;

  function emotionDots(voice) {
    return EMOTIONS.map((emotion) => {
      const ready = (voice.emotions_ready || []).includes(emotion);
      const sampled = (voice.samples || {})[emotion];
      const title = ready
        ? `${emotion} — trained`
        : sampled
          ? `${emotion} — ${sampled.seconds}s recorded, not trained`
          : `${emotion} — no samples`;
      const style = sampled && !ready ? ' style="opacity:.42"' : "";
      return `<span class="dot ${ready || sampled ? emotion : "off"}" title="${esc(title)}"${style}></span>`;
    }).join("");
  }

  function statRow(voices) {
    const ready = voices.filter((voice) => voice.status === "ready").length;
    const samples = voices.reduce((total, voice) => total + voice.clip_count, 0);
    const seconds = voices.reduce((total, voice) => total + voice.total_seconds, 0);
    return `
      <div class="stat-row">
        <div class="stat"><span class="stat-num">${voices.length}</span><span class="stat-label">voice${voices.length === 1 ? "" : "s"}</span></div>
        <div class="stat"><span class="stat-num">${ready}</span><span class="stat-label">trained</span></div>
        <div class="stat"><span class="stat-num">${samples}</span><span class="stat-label">sample${samples === 1 ? "" : "s"}</span></div>
        <div class="stat"><span class="stat-num">${fmtDur(seconds)}</span><span class="stat-label">of reference audio</span></div>
      </div>`;
  }

  function voiceCard(voice) {
    const moodCount = (voice.emotions_ready || []).length;
    const stale = voice.model && voice.model.stale
      ? `<span class="pill stale"><i></i>Changed</span>`
      : "";
    const mock = voice.model && voice.model.engine === "mock"
      ? `<span class="pill mock"><i></i>Mock</span>`
      : "";
    return `
      <a class="voice-card" href="#/voices/${encodeURIComponent(voice.id)}">
        <div class="voice-card-top">
          ${avatarHtml(voice.name)}
          <div style="display:flex;gap:5px;flex-wrap:wrap;justify-content:flex-end">
            ${statusPill(voice)}${stale}${mock}
          </div>
        </div>
        <div>
          <h3>${esc(voice.name)}</h3>
          <p class="voice-desc">${esc(voice.description || "No description yet.")}</p>
        </div>
        <div class="emotion-dots">
          ${emotionDots(voice)}
          <span class="hint" style="margin-left:4px">${moodCount}/${EMOTIONS.length} moods</span>
        </div>
        <footer class="voice-card-foot">
          <span>${voice.clip_count} sample${voice.clip_count === 1 ? "" : "s"} · ${fmtDur(voice.total_seconds)}</span>
          <span class="card-open">Open →</span>
        </footer>
      </a>`;
  }

  function emptyLibrary() {
    return `
      <div class="empty">
        <div class="empty-rings"><span class="empty-orb">${icon("wave")}</span></div>
        <h2>Clone your first voice</h2>
        <p>Record a few clean takes, train them into a voice, then type anything you want it to say — in the moods you taught it.</p>
        <div class="head-actions">
          <button class="btn primary lg" type="button" data-action="new-voice">${icon("plus")} New voice</button>
          <button class="btn ghost lg" type="button" data-action="help">Setup &amp; help</button>
        </div>
        <div class="steps">
          <div class="step"><b>1</b><div><strong>Create a voice</strong>Name it and confirm you have permission to clone it.</div></div>
          <div class="step"><b>2</b><div><strong>Add neutral speech</strong>Record or upload ~30 seconds of even, natural speech.</div></div>
          <div class="step"><b>3</b><div><strong>Add moods</strong>Optional happy, sad and angry takes teach extra emotional range.</div></div>
          <div class="step"><b>4</b><div><strong>Train &amp; speak</strong>Train once, then write scripts in the Studio.</div></div>
        </div>
      </div>`;
  }

  async function renderVoices(view) {
    if (T.stopPlayers) T.stopPlayers();
    const voices = await T.api("/api/voices");
    T.state.voices = voices;
    T.updateNavCount();

    view.innerHTML = `
      <header class="page-head">
        <div>
          <p class="eyebrow">Voice library</p>
          <h1>Your voices</h1>
          <p class="lede">Clone a voice from a few clean takes, then give it a mood. Everything is processed by the engine on this machine.</p>
        </div>
        <div class="head-actions">
          <button class="btn ghost" type="button" data-action="refresh">${icon("refresh")} Refresh</button>
          <button class="btn primary" type="button" data-action="new-voice">${icon("plus")} New voice</button>
        </div>
      </header>
      ${voices.length ? statRow(voices) : ""}
      ${voices.length ? `<div class="voice-grid">${voices.map(voiceCard).join("")}</div>` : emptyLibrary()}`;
  }

  T.renderVoices = renderVoices;
})();
