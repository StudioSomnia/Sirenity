"""Timbre — local voice-cloning studio API.

Run with:  uvicorn server.main:app --host 127.0.0.1 --port 8000
Open:      http://127.0.0.1:8000
"""

from __future__ import annotations

import asyncio
import os
import re
import threading
import time
from pathlib import Path
from typing import Annotated, Optional

import soundfile as sf
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, field_validator

from .audio import AudioError, clip_warnings, prepare_wav, wav_duration
from .engine import EngineError, EngineUnavailable, build_engine
from .store import EMOTIONS, Store, new_id

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.environ.get("TIMBRE_DATA", str(BASE_DIR / "data"))).resolve()
WEB_DIR = BASE_DIR / "web"

MIN_NEUTRAL_SECONDS = 6.0
MIN_EMOTION_SECONDS = 4.0
TARGET_NEUTRAL_SECONDS = 30.0
TARGET_EMOTION_SECONDS = 15.0
MAX_REF_SECONDS = 40.0
MAX_UPLOAD_BYTES = 64 * 1024 * 1024

store = Store(DATA_DIR)
engine = build_engine()
TMP_DIR = DATA_DIR / "tmp"
TMP_DIR.mkdir(parents=True, exist_ok=True)

# XTTS is a single model instance; serialise training and inference so two
# requests never mutate the same conditioning state at once.
ENGINE_LOCK = threading.Lock()
BACKGROUND_TASKS: set[asyncio.Task] = set()

app = FastAPI(title="Timbre", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --------------------------------------------------------------------- schemas


class VoiceCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    description: str = Field(default="", max_length=400)
    language: str = Field(default="en", max_length=12)
    consent: bool = False

    @field_validator("name")
    @classmethod
    def _clean_name(cls, value: str) -> str:
        value = " ".join(value.split())
        if not value:
            raise ValueError("Give the voice a name.")
        return value


class VoiceUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=80)
    description: Optional[str] = Field(default=None, max_length=400)
    language: Optional[str] = Field(default=None, max_length=12)


class SpeakIn(BaseModel):
    text: str = Field(min_length=1, max_length=2000)
    emotion: str = "neutral"
    intensity: float = Field(default=1.0, ge=0.0, le=1.0)
    speed: float = Field(default=1.0, ge=0.5, le=1.5)
    language: Optional[str] = None

    @field_validator("text")
    @classmethod
    def _clean_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Enter some text to speak.")
        return value

    @field_validator("emotion")
    @classmethod
    def _known_emotion(cls, value: str) -> str:
        if value not in EMOTIONS:
            raise ValueError(f"Unknown emotion '{value}'.")
        return value


# --------------------------------------------------------------------- helpers


def _voice_or_404(voice_id: str) -> dict:
    voice = store.get_voice(voice_id)
    if not voice:
        raise HTTPException(status_code=404, detail="Voice not found.")
    return voice


def _clip_path(clip: dict) -> Path:
    return store.root / clip["path"]


def _warnings_for(clip: dict) -> list[dict]:
    return clip_warnings(clip.get("metrics", {}), emotion=clip["emotion"])


def _pick_refs(clips: list[dict], limit: float = MAX_REF_SECONDS) -> tuple[list[dict], float]:
    """Prefer the longest takes first, but never exceed the conditioning budget."""
    ordered = sorted(clips, key=lambda c: c["duration"], reverse=True)
    picked: list[dict] = []
    seconds = 0.0
    for clip in ordered:
        if picked and seconds + clip["duration"] > limit:
            continue
        picked.append(clip)
        seconds += clip["duration"]
        if seconds >= limit:
            break
    return picked, round(seconds, 2)


def _latest_training_job(voice_id: str) -> Optional[dict]:
    return store.latest_job(voice_id, "train")


def _voice_payload(voice: dict) -> dict:
    voice = dict(voice)
    voice["targets"] = {
        "neutral": TARGET_NEUTRAL_SECONDS,
        "other": TARGET_EMOTION_SECONDS,
        "min_neutral": MIN_NEUTRAL_SECONDS,
        "min_emotion": MIN_EMOTION_SECONDS,
    }
    job = _latest_training_job(voice["id"])
    voice["job"] = job
    return voice


def _safe_detail(exc: Exception) -> str:
    message = str(exc).strip() or exc.__class__.__name__
    return message[:1200]


# ----------------------------------------------------------------------- meta


@app.get("/api/health")
async def health() -> dict:
    status = engine.status()
    model_cached = False
    if status.get("key") == "xtts":
        try:
            from TTS.utils.manage import ModelManager  # noqa: F401

            model_cached = any(
                p.exists()
                for p in [
                    Path.home() / "AppData/Local/tts",
                    Path.home() / ".local/share/tts",
                ]
            )
        except Exception:  # noqa: BLE001
            model_cached = False
    return {
        "ok": True,
        "engine": status,
        "device": status.get("device", "cpu"),
        "model_cached": model_cached,
        "emotions": EMOTIONS,
        "limits": {
            "min_neutral": MIN_NEUTRAL_SECONDS,
            "min_emotion": MIN_EMOTION_SECONDS,
            "target_neutral": TARGET_NEUTRAL_SECONDS,
            "target_emotion": TARGET_EMOTION_SECONDS,
            "max_ref": MAX_REF_SECONDS,
            "max_upload_mb": MAX_UPLOAD_BYTES // (1024 * 1024),
        },
        "data_dir": str(DATA_DIR),
        "engine_override": os.environ.get("TIMBRE_ENGINE", "auto"),
        "version": app.version,
    }


@app.post("/api/engine/load")
async def load_engine() -> dict:
    """Warm the model up (download on first use) without training a voice."""

    def warm() -> None:
        try:
            engine.load()
        except Exception:  # noqa: BLE001
            pass

    asyncio.get_running_loop().run_in_executor(None, warm)
    return {"started": True, "status": engine.status()}


# --------------------------------------------------------------------- voices


@app.get("/api/voices")
async def list_voices() -> list[dict]:
    return [_voice_payload(v) for v in store.list_voices()]


@app.post("/api/voices", status_code=201)
async def create_voice(payload: VoiceCreate) -> dict:
    if not payload.consent:
        raise HTTPException(
            status_code=400,
            detail="Confirm that you have permission to clone this voice.",
        )
    voice = store.create_voice(
        name=payload.name,
        description=payload.description.strip(),
        language=payload.language,
        consent=payload.consent,
    )
    return _voice_payload(voice)


@app.get("/api/voices/{voice_id}")
async def get_voice(voice_id: str) -> dict:
    return _voice_payload(_voice_or_404(voice_id))


@app.patch("/api/voices/{voice_id}")
async def update_voice(voice_id: str, payload: VoiceUpdate) -> dict:
    _voice_or_404(voice_id)
    fields = payload.model_dump(exclude_none=True)
    if "name" in fields:
        fields["name"] = " ".join(fields["name"].split())
        if not fields["name"]:
            raise HTTPException(status_code=400, detail="Name cannot be blank.")
    return _voice_payload(store.update_voice(voice_id, **fields) or {})


@app.delete("/api/voices/{voice_id}", status_code=204)
async def delete_voice(voice_id: str) -> None:
    voice = _voice_or_404(voice_id)
    if voice["status"] == "training":
        raise HTTPException(
            status_code=409, detail="Wait for training to finish before deleting this voice."
        )
    store.delete_voice(voice_id)


# ---------------------------------------------------------------------- clips


@app.get("/api/voices/{voice_id}/clips")
async def list_clips(voice_id: str) -> list[dict]:
    _voice_or_404(voice_id)
    clips = store.list_clips(voice_id)
    for clip in clips:
        clip["warnings"] = _warnings_for(clip)
    return clips


@app.post("/api/voices/{voice_id}/clips", status_code=201)
async def upload_clip(
    voice_id: str,
    file: Annotated[UploadFile, File()],
    emotion: Annotated[str, Form()] = "neutral",
    transcript: Annotated[str, Form()] = "",
) -> dict:
    voice = _voice_or_404(voice_id)
    if emotion not in EMOTIONS:
        raise HTTPException(status_code=400, detail=f"Unknown emotion '{emotion}'.")

    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="The upload was empty.")
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="That file is too large (64 MB max).")

    tmp_path = TMP_DIR / f"{new_id('up')}.wav"
    tmp_path.write_bytes(raw)
    clip_id = new_id("c")
    final_path = store.clips_dir(voice_id) / f"{emotion}-{clip_id}.wav"
    try:
        metrics = prepare_wav(tmp_path, final_path)
    except AudioError as exc:
        final_path.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        final_path.unlink(missing_ok=True)
        raise HTTPException(
            status_code=400,
            detail=f"Could not process that audio ({_safe_detail(exc)}).",
        ) from exc
    finally:
        tmp_path.unlink(missing_ok=True)

    clip = store.add_clip(
        voice_id=voice_id,
        emotion=emotion,
        path=final_path,
        duration=metrics["duration"],
        transcript=transcript.strip()[:2000],
        metrics=metrics,
    )
    clip["warnings"] = clip_warnings(metrics, emotion=emotion)
    # A previous error state should not block a voice that now has audio again.
    if voice["status"] == "error":
        store.update_voice(voice_id, status="draft", error="")
    return clip


@app.get("/api/clips/{clip_id}/audio")
async def clip_audio(clip_id: str):
    clip = store.get_clip(clip_id)
    if not clip:
        raise HTTPException(status_code=404, detail="Sample not found.")
    path = _clip_path(clip)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Audio file is missing on disk.")
    return FileResponse(str(path), media_type="audio/wav", filename=f"{clip['emotion']}.wav")


@app.delete("/api/clips/{clip_id}", status_code=204)
async def delete_clip(clip_id: str) -> None:
    if not store.delete_clip(clip_id):
        raise HTTPException(status_code=404, detail="Sample not found.")


# ------------------------------------------------------------------- training


@app.post("/api/voices/{voice_id}/train", status_code=202)
async def train_voice(voice_id: str) -> dict:
    voice = _voice_or_404(voice_id)
    if voice["status"] == "training":
        raise HTTPException(status_code=409, detail="This voice is already training.")
    if not voice["consent"]:
        raise HTTPException(
            status_code=400, detail="Consent is required before training a voice."
        )

    clips = store.list_clips(voice_id)
    neutral_seconds = sum(c["duration"] for c in clips if c["emotion"] == "neutral")
    if neutral_seconds < MIN_NEUTRAL_SECONDS:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Add at least {MIN_NEUTRAL_SECONDS:.0f} seconds of neutral speech before "
                f"training (you have {neutral_seconds:.1f}s)."
            ),
        )

    store.update_voice(voice_id, status="training", error="")
    job = store.create_job(voice_id, "train")
    task = asyncio.get_running_loop().create_task(run_training(job["id"], voice_id))
    BACKGROUND_TASKS.add(task)
    task.add_done_callback(BACKGROUND_TASKS.discard)
    return job


@app.get("/api/jobs/{job_id}")
async def get_job(job_id: str) -> dict:
    job = store.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")
    job["voice"] = store.get_voice(job["voice_id"])
    return job


def _training_worker(job_id: str, voice_id: str) -> None:
    try:
        voice = store.get_voice(voice_id)
        if not voice:
            raise RuntimeError("Voice disappeared before training could start.")
        clips = store.list_clips(voice_id)

        by_emotion: dict[str, list[dict]] = {}
        for clip in clips:
            by_emotion.setdefault(clip["emotion"], []).append(clip)

        neutral = by_emotion.get("neutral", [])
        neutral_seconds = sum(c["duration"] for c in neutral)
        if neutral_seconds < MIN_NEUTRAL_SECONDS:
            raise RuntimeError(
                f"Neutral samples total {neutral_seconds:.1f}s; at least "
                f"{MIN_NEUTRAL_SECONDS:.0f}s is required."
            )

        store.update_job(
            job_id,
            status="running",
            progress=4,
            message="Checking samples",
            log_line=f"Found {len(clips)} samples across {len(by_emotion)} emotions.",
        )

        usable: list[tuple[str, list[dict], float]] = []
        for emotion in EMOTIONS:
            group = by_emotion.get(emotion, [])
            if not group:
                continue
            if emotion != "neutral" and sum(c["duration"] for c in group) < MIN_EMOTION_SECONDS:
                seconds = sum(c["duration"] for c in group)
                store.update_job(
                    job_id,
                    log_line=(
                        f"Skipping {emotion}: only {seconds:.1f}s "
                        f"(needs {MIN_EMOTION_SECONDS:.0f}s)."
                    ),
                )
                continue
            picked, seconds = _pick_refs(group)
            usable.append((emotion, picked, seconds))
            store.update_job(
                job_id,
                log_line=f"{emotion}: {len(picked)} take(s), {seconds:.1f}s of reference.",
            )

        if not any(e == "neutral" for e, _, _ in usable):
            raise RuntimeError("No usable neutral reference audio.")

        store.update_job(
            job_id,
            progress=10,
            message="Loading the voice engine",
            log_line=(
                "Loading XTTS v2 — the first run downloads about 1.8 GB."
                if engine.key == "xtts"
                else f"Using the {engine.label} engine."
            ),
        )
        engine.load()

        meta: dict = {
            "trained_at": time.time(),
            "engine": engine.key,
            "engine_label": engine.label,
            "stale": False,
            "emotions": {},
            "skipped": {
                e: round(sum(c["duration"] for c in g), 2)
                for e, g in by_emotion.items()
                if e not in {u[0] for u in usable}
            },
        }

        total = len(usable)
        for index, (emotion, picked, seconds) in enumerate(usable):
            start = 10 + (index / total) * 80
            store.update_job(
                job_id,
                progress=start,
                message=f"Learning {emotion} timbre",
                log_line=f"Conditioning {emotion} from {seconds:.1f}s…",
            )
            latent_path = store.model_dir(voice_id) / f"{emotion}.pt"
            try:
                with ENGINE_LOCK:
                    engine.train_emotion([_clip_path(c) for c in picked], latent_path)
            except Exception as exc:  # noqa: BLE001
                if emotion == "neutral":
                    raise
                store.update_job(
                    job_id,
                    log_line=f"Could not condition {emotion}: {_safe_detail(exc)}",
                )
                continue
            meta["emotions"][emotion] = {
                "seconds": seconds,
                "clips": len(picked),
                "latent": f"{voice_id}/model/{emotion}.pt",
                "trained_at": time.time(),
                "mock": engine.key == "mock",
            }
            store.update_job(
                job_id,
                progress=10 + ((index + 1) / total) * 80,
                log_line=f"{emotion} ready.",
            )

        if "neutral" not in meta["emotions"]:
            raise RuntimeError("Neutral conditioning failed; no model was saved.")

        store.set_model_meta(voice_id, meta, status="ready", engine=engine.label)
        store.update_job(
            job_id,
            status="done",
            progress=100,
            message="Voice ready",
            log_line=(
                "Training complete. Ready emotions: "
                + ", ".join(meta["emotions"].keys())
                + "."
            ),
            finished=True,
        )
    except Exception as exc:  # noqa: BLE001
        message = _safe_detail(exc)
        store.update_voice(voice_id, status="error", error=message)
        store.update_job(
            job_id,
            status="error",
            progress=100,
            message="Training failed",
            error=message,
            log_line=f"Error: {message}",
            finished=True,
        )


async def run_training(job_id: str, voice_id: str) -> None:
    await asyncio.to_thread(_training_worker, job_id, voice_id)


# ------------------------------------------------------------------ synthesis


def _speak_sync(voice: dict, clips: list[dict], payload: SpeakIn, out_path: Path) -> dict:
    meta = voice.get("model") or {}
    trained: dict[str, dict] = meta.get("emotions", {})

    emotion = payload.emotion
    if emotion not in trained:
        raise HTTPException(
            status_code=400,
            detail=(
                f"'{emotion}' is not trained for this voice. Train it with a few "
                f"emotional samples, or pick one of: {', '.join(trained) or 'none'}."
            ),
        )

    latents: dict[str, Path] = {}
    for name, info in trained.items():
        latent_path = store.root / info.get("latent", "")
        if info.get("latent") and latent_path.exists():
            latents[name] = latent_path

    refs_by_emotion: dict[str, list[dict]] = {}
    for clip in clips:
        refs_by_emotion.setdefault(clip["emotion"], []).append(clip)
    refs, _ = _pick_refs(refs_by_emotion.get(emotion) or refs_by_emotion.get("neutral") or [])

    language = payload.language or voice["language"] or "en"
    try:
        with ENGINE_LOCK:
            result = engine.synthesize(
                text=payload.text,
                language=language,
                speed=payload.speed,
                out_path=out_path,
                emotion=emotion,
                intensity=payload.intensity,
                latents=latents,
                ref_paths=[_clip_path(c) for c in refs],
            )
    except EngineUnavailable as exc:
        raise HTTPException(status_code=503, detail=_safe_detail(exc)) from exc
    except EngineError as exc:
        raise HTTPException(status_code=500, detail=_safe_detail(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=500,
            detail=f"Synthesis failed: {_safe_detail(exc)}",
        ) from exc
    return result


@app.post("/api/voices/{voice_id}/speak", status_code=201)
async def speak(voice_id: str, payload: SpeakIn) -> dict:
    voice = _voice_or_404(voice_id)
    clips = store.list_clips(voice_id)
    if not clips:
        raise HTTPException(status_code=400, detail="Add samples before synthesising.")
    if voice["status"] != "ready" or not voice["model"].get("emotions"):
        raise HTTPException(
            status_code=409,
            detail="Train this voice before generating speech.",
        )

    generation_id = new_id("g")
    out_path = store.output_path(generation_id)
    try:
        result = await asyncio.to_thread(_speak_sync, voice, clips, payload, out_path)
    except HTTPException:
        out_path.unlink(missing_ok=True)
        raise
    except Exception as exc:  # noqa: BLE001
        out_path.unlink(missing_ok=True)
        raise HTTPException(
            status_code=500, detail=f"Synthesis failed: {_safe_detail(exc)}"
        ) from exc

    duration = result.get("duration") or wav_duration(out_path)
    generation = store.add_generation(
        generation_id=generation_id,
        voice_id=voice_id,
        text=payload.text,
        emotion=payload.emotion,
        intensity=payload.intensity,
        speed=payload.speed,
        language=payload.language or voice["language"],
        engine=engine.label,
        path=out_path,
        duration=duration,
    )
    generation["voice_name"] = voice["name"]
    return generation


@app.get("/api/generations")
async def list_generations(limit: int = 100) -> list[dict]:
    limit = max(1, min(500, limit))
    voices = {v["id"]: v["name"] for v in store.list_voices()}
    rows = store.list_generations(limit)
    for row in rows:
        row["voice_name"] = voices.get(row["voice_id"], "Deleted voice")
    return rows


@app.get("/api/generations/{generation_id}/audio")
async def generation_audio(generation_id: str):
    generation = store.get_generation(generation_id)
    if not generation:
        raise HTTPException(status_code=404, detail="Generation not found.")
    path = store.root / generation["path"]
    if not path.exists():
        raise HTTPException(status_code=404, detail="Audio file is missing on disk.")
    stem = re.sub(r"[^A-Za-z0-9_-]+", "-", generation["text"][:40]).strip("-") or "speech"
    return FileResponse(
        str(path), media_type="audio/wav", filename=f"timbre-{stem}.wav"
    )


@app.delete("/api/generations/{generation_id}", status_code=204)
async def delete_generation(generation_id: str) -> None:
    if not store.delete_generation(generation_id):
        raise HTTPException(status_code=404, detail="Generation not found.")


# ------------------------------------------------------------------- meta root


@app.get("/api")
async def api_root() -> dict:
    return {"name": "Timbre", "version": app.version, "docs": "/docs"}


# ---------------------------------------------------------------------- static
# Mounted last so the API routes above always win over the static handler.

if WEB_DIR.exists():
    app.mount("/", StaticFiles(directory=str(WEB_DIR), html=True), name="web")
