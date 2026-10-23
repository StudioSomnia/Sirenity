/* Timbre — shared playback and waveform hydration. */
(() => {
  "use strict";

  const T = window.Timbre;
  const A = T.A;
  const registry = new Map();

  function wrapper(id) {
    return document.querySelector(`[data-player="${id}"]`);
  }

  function ensure(id) {
    let rec = registry.get(id);
    if (rec) return rec;
    const audio = new Audio();
    audio.preload = "metadata";
    rec = { id, audio, src: "", peaks: null, duration: 0, loading: false };
    audio.addEventListener("timeupdate", () => paint(id));
    audio.addEventListener("ended", () => {
      audio.currentTime = 0;
      setButton(id, false);
      paint(id);
    });
    audio.addEventListener("loadedmetadata", () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) rec.duration = audio.duration;
      paint(id);
    });
    registry.set(id, rec);
    return rec;
  }

  function setButton(id, playing) {
    const host = wrapper(id);
    if (!host) return;
    const button = host.querySelector(".play-btn");
    if (!button) return;
    button.classList.toggle("playing", playing);
    button.innerHTML = T.icon(playing ? "pause" : "play");
    button.setAttribute("aria-label", playing ? "Pause" : "Play");
  }

  function paint(id) {
    const rec = registry.get(id);
    const host = wrapper(id);
    if (!rec || !host) return;
    const duration = rec.duration || rec.audio.duration || Number(host.dataset.duration) || 0;
    const ratio = duration ? Math.min(1, Math.max(0, rec.audio.currentTime / duration)) : 0;
    const canvas = host.querySelector(".wave-canvas");
    if (canvas && rec.peaks) A.drawWave(canvas, rec.peaks, { progress: ratio });
    const time = host.querySelector(".player-time");
    if (time) {
      time.textContent = `${A.formatTime(rec.audio.currentTime)} / ${A.formatTime(duration)}`;
    }
  }

  function hydrate(root) {
    const scope = root || document;
    scope.querySelectorAll("[data-player]").forEach((host) => {
      const id = host.dataset.player;
      if (!id) return;
      const rec = ensure(id);
      const src = host.dataset.src || "";
      if (src && rec.src !== src) {
        rec.src = src;
        rec.audio.src = src;
      }
      const duration = Number(host.dataset.duration);
      if (duration > 0) rec.duration = duration;
      if (!rec.peaks && src && !rec.loading) {
        rec.loading = true;
        A.loadPeaks(src, 84).then((values) => {
          rec.peaks = values;
          rec.loading = false;
          paint(id);
        });
      }
      requestAnimationFrame(() => paint(id));
    });
  }

  function stopAll() {
    registry.forEach((rec, id) => {
      if (!rec.audio.paused) {
        rec.audio.pause();
        rec.audio.currentTime = 0;
      }
      setButton(id, false);
    });
  }

  function toggle(id) {
    const host = wrapper(id);
    if (!host) return;
    const rec = ensure(id);
    const src = host.dataset.src;
    if (src && rec.src !== src) {
      rec.src = src;
      rec.audio.src = src;
    }
    if (rec.audio.paused) {
      registry.forEach((other, key) => {
        if (key !== id && !other.audio.paused) {
          other.audio.pause();
          other.audio.currentTime = 0;
          setButton(key, false);
          paint(key);
        }
      });
      rec.audio
        .play()
        .then(() => setButton(id, true))
        .catch(() => T.toast("Could not play that audio.", "err"));
    } else {
      rec.audio.pause();
      setButton(id, false);
      paint(id);
    }
  }

  function seek(id, event) {
    const rec = ensure(id);
    const duration = rec.duration || rec.audio.duration || 0;
    if (!duration) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width) return;
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    rec.audio.currentTime = ratio * duration;
    paint(id);
  }

  T.hydratePlayers = hydrate;
  T.stopPlayers = stopAll;
  T.actions["player-toggle"] = (el) => toggle(el.dataset.id);
  T.actions["player-seek"] = (el, event) => seek(el.dataset.id, event);
})();
