/* Timbre — generation history. */
(() => {
  "use strict";

  const T = window.Timbre;
  const { esc, icon, fmtDur, fmtDateTime, dayLabel } = T;
  const media = T.media;

  function stats(generations) {
    const seconds = generations.reduce((total, item) => total + Number(item.duration || 0), 0);
    const voices = new Set(generations.map((item) => item.voice_id)).size;
    const today = generations.filter((item) => dayLabel(item.created_at) === "Today").length;
    return `
      <div class="stat-row">
        <div class="stat"><span class="stat-num">${generations.length}</span><span class="stat-label">take${generations.length === 1 ? "" : "s"}</span></div>
        <div class="stat"><span class="stat-num">${fmtDur(seconds)}</span><span class="stat-label">of speech</span></div>
        <div class="stat"><span class="stat-num">${voices}</span><span class="stat-label">voice${voices === 1 ? "" : "s"}</span></div>
        <div class="stat"><span class="stat-num">${today}</span><span class="stat-label">made today</span></div>
      </div>`;
  }

  function generationRow(generation) {
    const voice = generation.voice_name === "Deleted voice"
      ? `<span>${esc(generation.voice_name)}</span>`
      : `<a class="accent" href="#/voices/${generation.voice_id}">${esc(generation.voice_name || "Voice")}</a>`;
    return `
      <div class="gen-row" data-player="${generation.id}" data-src="${media(generation.url)}" data-duration="${Number(generation.duration) || 0}">
        <div class="gen-text">
          <p title="${esc(generation.text)}">${esc(generation.text)}</p>
          <div class="gen-sub">
            ${voice}
            <span>·</span>
            <span class="dot ${generation.emotion}" title="${esc(generation.emotion)}"></span>
            <span>${esc(generation.emotion)}</span>
            <span>·</span>
            <span>${Math.round(Number(generation.intensity) * 100)}% intensity</span>
            <span>·</span>
            <span>${Number(generation.speed || 1).toFixed(2)}×</span>
            <span>·</span>
            <span>${esc(generation.engine || "")}</span>
            <span>·</span>
            <span>${fmtDateTime(generation.created_at)}</span>
          </div>
        </div>
        ${T.playerHtml(generation.id, media(generation.url), generation.duration, { compact: true })}
        <div class="clip-actions" style="opacity:1">
          <a class="icon-btn" href="${media(generation.url)}" download aria-label="Download take" title="Download WAV">${icon("download")}</a>
          <button class="icon-btn danger" type="button" data-action="delete-generation" data-id="${generation.id}" aria-label="Delete take" title="Delete take">${icon("trash")}</button>
        </div>
      </div>`;
  }

  function grouped(generations) {
    const groups = new Map();
    for (const generation of generations) {
      const label = dayLabel(generation.created_at);
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label).push(generation);
    }
    return Array.from(groups.entries())
      .map(
        ([label, items]) => `
          <div style="display:flex;align-items:center;justify-content:space-between;margin:22px 0 9px">
            <span class="eyebrow" style="margin:0">${esc(label)}</span>
            <span class="hint">${items.length} take${items.length === 1 ? "" : "s"}</span>
          </div>
          <div class="gen-list">${items.map(generationRow).join("")}</div>`
      )
      .join("");
  }

  function emptyHistory() {
    return `
      <div class="empty">
        <div class="empty-rings"><span class="empty-orb">${icon("clock")}</span></div>
        <h2>No takes yet</h2>
        <p>Every line you render in the Studio lands here, with its voice, mood and settings. Nothing leaves this machine.</p>
        <div class="head-actions">
          <a class="btn primary lg" href="#/studio">${icon("sparkles")} Open the Studio</a>
        </div>
      </div>`;
  }

  async function renderHistory(view) {
    if (T.stopPlayers) T.stopPlayers();
    const generations = await T.api("/api/generations?limit=300");
    T.state.generations = generations;

    view.innerHTML = `
      <header class="page-head">
        <div>
          <p class="eyebrow">History</p>
          <h1>Your takes</h1>
          <p class="lede">Everything the engine has rendered, newest first. Play a take, download the WAV, or clear it out.</p>
        </div>
        <div class="head-actions">
          <button class="btn ghost" type="button" data-action="refresh">${icon("refresh")} Refresh</button>
          <a class="btn primary" href="#/studio">${icon("sparkles")} New take</a>
        </div>
      </header>
      ${generations.length ? stats(generations) : ""}
      ${generations.length ? grouped(generations) : emptyHistory()}`;

    if (T.hydratePlayers) T.hydratePlayers(view);
  }

  T.renderHistory = renderHistory;

  T.actions["delete-generation"] = async (el) => {
    const ok = await T.confirmDialog({
      eyebrow: "Delete take",
      title: "Delete this generation?",
      message: "The WAV is removed from disk. This cannot be undone, but the text stays yours to generate again.",
      confirmLabel: "Delete take",
    });
    if (!ok) return;
    try {
      await T.api(`/api/generations/${el.dataset.id}`, { method: "DELETE" });
      T.toast("Take deleted.", "ok");
      const view = document.getElementById("view");
      if (view) await renderHistory(view);
    } catch (error) {
      T.toast(error.message, "err");
    }
  };
})();
