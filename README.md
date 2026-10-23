# Timbre

A local, ElevenLabs-style voice studio: record or upload speech, train a voice, and generate new lines in the moods you taught it. Everything runs on your machine — takes, models and generated audio never leave it.

The app is a dependency-free browser client plus a small FastAPI server. Real cloning uses **Coqui XTTS v2** in zero-shot mode; a **mock engine** lets you exercise the whole interface without installing PyTorch.

---

## What it does

- **Voice library** — one profile per speaker, with consent confirmation and per-voice status.
- **Guided recording** — a script per emotion, live level meter, preview and re-record.
- **File upload** — WAV, MP3, M4A, OGG, FLAC; converted to 24 kHz mono in the browser.
- **Emotion training** — neutral is required; happy, sad, angry (plus excited, calm, fearful, whisper) are optional.
- **Cached conditioning** — one latent per emotion, so switching mood at generation time is fast.
- **Intensity blend** — slide between neutral and the full emotion without retraining.
- **Speed and language controls** — 17 XTTS languages.
- **History** — every take with its voice, mood, settings, waveform and WAV download.
- **Quality advice** — duration, clipping, noise and silence checks on every take.
- **Mock mode** — full UI and API without the 2 GB engine download.

---

## Requirements

- Windows 10/11, macOS or Linux.
- Python **3.10–3.12** (3.12 recommended).
- ~2.5 GB disk for PyTorch + coqui-tts, plus ~1.8 GB for the XTTS model on first training.
- A microphone for recording (the app also accepts uploads).
- Optional NVIDIA GPU. The engine works on CPU; a GPU makes training and generation much faster. XTTS likes ~4 GB VRAM or more.

No Node, no build step, no database server, no ffmpeg.

---

## Quick start

### Windows

Double-click **`start.bat`**, or from PowerShell:

```powershell
.\run.ps1
```

The launcher creates `.venv`, installs the server dependencies, then asks whether to install the voice engine. Answer **Y** for real cloning. Later runs skip straight to starting the server and open <http://127.0.0.1:8000>.

Options:

```powershell
.\run.ps1 -Mock          # skip PyTorch; placeholder tones
.\run.ps1 -Cuda          # install CUDA torch during first setup
.\run.ps1 -SkipEngine    # base server only (mock engine)
.\run.ps1 -Port 8010     # different port
.\run.ps1 -Reinstall     # rebuild .venv
```

### macOS / Linux

```bash
chmod +x run.sh
./run.sh
```

Options: `--mock`, `--cuda`, `--skip-engine`, `--port 8010`, `--no-browser`.

### Manual start

```powershell
# Windows
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
pip install -r requirements-engine.txt   # optional: real cloning
$env:TIMBRE_ENGINE = "mock"              # optional: skip torch
uvicorn server.main:app --host 127.0.0.1 --port 8000
```

```bash
# macOS / Linux
source .venv/bin/activate
pip install -r requirements.txt
pip install -r requirements-engine.txt
TIMBRE_ENGINE=mock uvicorn server.main:app --host 127.0.0.1 --port 8000
```

Open <http://127.0.0.1:8000>. Use `127.0.0.1`, not a `file://` path, if you want to record from the microphone.

---

## The workflow

1. **New voice** — name it, choose a language, confirm you have permission.
2. **Add neutral speech** — at least 6 seconds; 20–40 seconds is ideal.
3. **Add moods (optional)** — at least 4 seconds each; ~15 seconds is ideal. Core moods: happy, sad, angry. Extra: excited, calm, fearful, whisper.
4. **Train** — the server computes and caches one conditioning latent per emotion. The progress panel updates itself.
5. **Studio** — pick a trained voice, a mood, intensity and speed, then write up to 2000 characters.
6. **History** — replay or download any take.

Changing samples after training marks the model **stale**. It still works; retrain to fold in the new takes.

### What good samples sound like

- One speaker, one room, one microphone per voice.
- No music, reverb, fans or background conversation.
- Close to the mic, steady level, no clipping.
- Perform the emotion — a flat read labelled "happy" teaches nothing.
- Short and clean beats long and noisy. The trainer uses at most 40 seconds of reference per mood.

---

## How the emotion system works

XTTS v2 clones from reference audio. For each emotion, Timbre runs the model's conditioning encoder over that emotion's takes and saves the resulting `gpt_cond_latent` and `speaker_embedding` to disk (`data/voices/<id>/model/<emotion>.pt`).

At generation time:

- the selected emotion's cached latent is used directly;
- **intensity** linearly blends that latent with the cached neutral latent (`neutral + (emotion - neutral) × intensity`);
- **speed** is passed to the model's sampler;
- the text and language are passed through unchanged.

This is zero-shot conditioning, not fine-tuning: training is fast, needs little data, and never modifies the base model.

---

## Project layout

```
Siren/
  server/
    main.py        FastAPI routes, validation, training job, synthesis
    engine.py      XTTS v2 engine + mock engine
    store.py       SQLite persistence (voices, clips, jobs, generations)
    audio.py       WAV normalisation, metrics and quality warnings
    __init__.py
  web/
    index.html     application shell
    styles.css     full design system
    js/
      app.js       core state, API client, router, shared helpers
      audio.js     WAV encode/decode, resampling, recorder, peaks, waveform
      players.js   shared playback and waveform hydration
      views.js     voice library
      voice.js     voice detail, samples, training, job polling
      studio.js    script → speech
      history.js   generation history
      modals.js    voice forms, recorder, confirmations, help
  data/            created at runtime (gitignored)
    timbre.db
    voices/<voice-id>/{clips,model}/
    outputs/
  requirements.txt
  requirements-engine.txt
  run.ps1 / run.sh / start.bat
```

The browser converts every upload to 24 kHz mono 16-bit WAV, so the server never needs ffmpeg.

---

## API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Engine state, device, limits, data folder |
| `POST` | `/api/engine/load` | Warm the model (download on first use) |
| `GET` / `POST` | `/api/voices` | List / create voices |
| `GET` / `PATCH` / `DELETE` | `/api/voices/{id}` | Read / edit / delete a voice |
| `GET` / `POST` | `/api/voices/{id}/clips` | List samples / upload a take (multipart: `file`, `emotion`, `transcript`) |
| `GET` | `/api/clips/{id}/audio` | Sample audio |
| `DELETE` | `/api/clips/{id}` | Delete a sample |
| `POST` | `/api/voices/{id}/train` | Start training (202 + job) |
| `GET` | `/api/jobs/{id}` | Training progress, log and voice status |
| `POST` | `/api/voices/{id}/speak` | Generate speech (`text`, `emotion`, `intensity`, `speed`, `language`) |
| `GET` | `/api/generations` | History (`?limit=`) |
| `GET` / `DELETE` | `/api/generations/{id}` | Take audio / delete a take |

Interactive API docs: <http://127.0.0.1:8000/docs>.

---

## Data, privacy and consent

- SQLite database: `data/timbre.db`.
- Samples: `data/voices/<voice-id>/clips/`.
- Cached latents: `data/voices/<voice-id>/model/`.
- Generated WAVs: `data/outputs/`.
- The server binds to `127.0.0.1` only. No telemetry, no cloud calls except the one-time model download from Hugging Face.
- Delete a voice from its header to remove its samples, model and takes.
- Override the data folder with `TIMBRE_DATA`, the engine with `TIMBRE_ENGINE=xtts|mock`, and the device with `TIMBRE_DEVICE=cpu|cuda`.

Only clone voices you own or have explicit permission to reproduce. The consent checkbox is required before a voice can be created, and the UI repeats this reminder. Impersonation, fraud and harassment are not acceptable uses.

---

## Troubleshooting

**“Engine offline”** — the server isn't running or is on another port. Start `.\run.ps1` and check the terminal.

**Microphone unavailable** — open `http://127.0.0.1:8000` (not `file://`) and allow microphone permission.

**“Engine not installed”** — run the launcher without `-Mock`, or activate `.venv` and run `pip install -r requirements-engine.txt`. Install Python 3.10–3.12; 3.13+ may not have compatible torch wheels.

**First training seems stuck** — XTTS downloads ~1.8 GB the first time. Watch the job log in the training panel; CPU conditioning can take a minute or more.

**GPU not used** — check `nvidia-smi`, and install CUDA torch (`.\run.ps1 -Cuda`). Set `TIMBRE_DEVICE=cuda` to force it. XTTS on 4 GB VRAM can be tight — close other GPU apps and keep scripts short.

**Port already in use** — `.\run.ps1 -Port 8010`.

**Training interrupted** — jobs don't survive a restart; the voice returns to draft. Train it again.

**“Could not decode…” on upload** — try WAV, MP3, M4A, OGG or FLAC. Some DRM-protected or unusual codecs are not supported by the browser.

---

## Known limitations

- XTTS v2 is multilingual zero-shot cloning. It is expressive but not a studio-grade replica; very short or noisy references produce unstable results.
- Word-level timing and pronunciation are driven by the text; use punctuation and spell out tricky names.
- Generation is serialised through one model instance, so parallel requests wait.
- The mock engine is only for exercising the app; it does not clone anything.
- Emotion intensity is a latent-space blend, not a separate emotion classifier. Extreme values can sound unstable.

---

## Credits

Built as a local-first interface around [Coqui TTS](https://github.com/idiap/coqui-ai-TTS) and XTTS v2. The client, API and design system are dependency-free. Please respect the XTTS model licence and the rights of the people whose voices you record.
