"""Synthesis engines.

`XttsEngine` is the real voice-cloning path: it uses Coqui XTTS v2 in zero-shot
mode, but caches one conditioning latent per emotion so each take can be
re-synthesised with a different emotional reference in a fraction of a second.

`MockEngine` writes placeholder tones. It exists so the whole app (upload →
train → synthesise → history) can be exercised without torch or a GPU:

    $env:TIMBRE_ENGINE = "mock"
"""

from __future__ import annotations

import importlib.util
import json
import math
import os
import re
import threading
from pathlib import Path

import numpy as np
import soundfile as sf

XTTS_MODEL = os.environ.get("TIMBRE_XTTS_MODEL", "tts_models/multilingual/multi-dataset/xtts_v2")
OUTPUT_SR = 24000


class EngineError(RuntimeError):
    pass


class EngineUnavailable(EngineError):
    pass


def _read_latent(path: Path):
    import torch

    payload = torch.load(str(path), map_location="cpu")
    return payload["gpt_cond_latent"], payload["speaker_embedding"]


def _as_float_array(value) -> np.ndarray:
    if hasattr(value, "detach"):
        value = value.detach().cpu().float().numpy()
    return np.asarray(value, dtype=np.float32).reshape(-1)


class BaseEngine:
    key = "base"
    label = "Base"
    output_sr = OUTPUT_SR

    def status(self) -> dict:
        return {
            "key": self.key,
            "label": self.label,
            "installed": True,
            "state": "ready",
            "device": "cpu",
            "error": "",
        }

    def load(self):
        return self

    def train_emotion(self, wav_paths: list[Path], out_path: Path) -> dict:
        raise NotImplementedError

    def synthesize(
        self,
        *,
        text: str,
        language: str,
        speed: float,
        out_path: Path,
        emotion: str,
        intensity: float,
        latents: dict[str, Path],
        ref_paths: list[Path],
    ) -> dict:
        raise NotImplementedError


class XttsEngine(BaseEngine):
    key = "xtts"
    label = "XTTS v2"

    def __init__(self) -> None:
        self._tts = None
        self._device = "cpu"
        self._state = "idle"
        self._error = ""
        self._lock = threading.Lock()
        self._installed = importlib.util.find_spec("TTS") is not None

    # ------------------------------------------------------------------ status

    def status(self) -> dict:
        return {
            "key": self.key,
            "label": self.label,
            "installed": self._installed,
            "state": "error" if self._error and self._state != "loading" else self._state,
            "device": self._device,
            "error": self._error,
            "model": XTTS_MODEL,
        }

    # -------------------------------------------------------------------- load

    def load(self):
        if self._tts is not None:
            return self._tts
        with self._lock:
            if self._tts is not None:
                return self._tts
            if not self._installed:
                raise EngineUnavailable(
                    "The XTTS engine is not installed. Run `run.ps1` (or "
                    "`pip install -r requirements-engine.txt`) to install torch and "
                    "coqui-tts. Set TIMBRE_ENGINE=mock to test the app without them."
                )
            self._state = "loading"
            try:
                import torch
                from TTS.api import TTS

                requested = os.environ.get("TIMBRE_DEVICE", "auto").strip().lower()
                if requested in {"cpu", "cuda"}:
                    device = requested
                else:
                    device = "cuda" if torch.cuda.is_available() else "cpu"

                tts = TTS(XTTS_MODEL).to(device)
                self._tts = tts
                self._device = device
                self._state = "ready"
                self._error = ""
            except Exception as exc:  # noqa: BLE001
                self._state = "error"
                self._error = f"{type(exc).__name__}: {exc}"
                raise EngineError(
                    "Could not load XTTS. The first run downloads ~1.8 GB. "
                    f"Underlying error: {self._error}"
                ) from exc
        return self._tts

    @property
    def sample_rate(self) -> int:
        if self._tts is not None:
            try:
                return int(self._tts.synthesizer.output_sample_rate)
            except Exception:  # noqa: BLE001
                pass
        return OUTPUT_SR

    # ---------------------------------------------------------------- training

    def train_emotion(self, wav_paths: list[Path], out_path: Path) -> dict:
        import torch

        tts = self.load()
        model = tts.synthesizer.tts_model
        paths = [str(p) for p in wav_paths]

        try:
            gpt_cond, speaker = model.get_conditioning_latents(audio_path=paths)
        except TypeError:
            # Older/newer builds expose slightly different signatures.
            gpt_cond, speaker = model.get_conditioning_latents(
                audio_path=paths,
                gpt_cond_len=30,
                gpt_cond_chunk_len=6,
                max_ref_len=30,
                sound_norm_refs=False,
            )

        out_path.parent.mkdir(parents=True, exist_ok=True)
        torch.save(
            {
                "gpt_cond_latent": gpt_cond.detach().cpu(),
                "speaker_embedding": speaker.detach().cpu(),
            },
            str(out_path),
        )
        return {
            "latent": os.path.relpath(out_path, out_path.parent.parent),
            "tensor_shape": list(gpt_cond.shape),
        }

    # --------------------------------------------------------------- synthesis

    def _blend(self, emotion: str, intensity: float, latents: dict[str, Path]):
        emotion_path = latents.get(emotion) or latents.get("neutral")
        if emotion_path is None:
            return None
        gpt_e, spk_e = _read_latent(emotion_path)
        neutral_path = latents.get("neutral")
        if (
            emotion != "neutral"
            and neutral_path is not None
            and 0.0 <= intensity < 0.999
        ):
            gpt_n, spk_n = _read_latent(neutral_path)
            if tuple(gpt_n.shape) == tuple(gpt_e.shape):
                gpt_e = gpt_n + (gpt_e - gpt_n) * float(intensity)
            if tuple(spk_n.shape) == tuple(spk_e.shape):
                spk_e = spk_n + (spk_e - spk_n) * float(intensity)
        return gpt_e, spk_e

    def synthesize(
        self,
        *,
        text: str,
        language: str,
        speed: float,
        out_path: Path,
        emotion: str,
        intensity: float,
        latents: dict[str, Path],
        ref_paths: list[Path],
    ) -> dict:
        tts = self.load()
        model = tts.synthesizer.tts_model
        sr = self.sample_rate

        wav = None
        conditioners = self._blend(emotion, intensity, latents) if latents else None
        if conditioners is None and ref_paths:
            try:
                conditioners = tuple(
                    t if hasattr(t, "cpu") else t
                    for t in model.get_conditioning_latents(
                        audio_path=[str(p) for p in ref_paths]
                    )
                )
            except Exception:  # noqa: BLE001
                conditioners = None

        if conditioners is not None:
            gpt_cond, speaker = conditioners
            try:
                gpt_cond = gpt_cond.to(self._device)
                speaker = speaker.to(self._device)
            except AttributeError:
                pass
            params = {
                "text": text,
                "language": language,
                "gpt_cond_latent": gpt_cond,
                "speaker_embedding": speaker,
                "speed": float(speed),
                "enable_text_splitting": True,
            }
            try:
                result = model.inference(**params)
            except TypeError:
                params.pop("enable_text_splitting", None)
                result = model.inference(**params)
            wav = result["wav"] if isinstance(result, dict) else result
            sr = int(result.get("sample_rate", sr)) if isinstance(result, dict) else sr

        if wav is None:
            # Last-resort path: the high-level API. Slower (recomputes the
            # conditioning every call) but very stable across TTS versions.
            if not ref_paths:
                raise EngineError("No reference audio is available for this voice.")
            result = tts.tts(
                text=text,
                speaker_wav=[str(p) for p in ref_paths],
                language=language,
                speed=float(speed),
            )
            wav = np.asarray(result, dtype=np.float32)

        samples = _as_float_array(wav)
        if samples.size == 0:
            raise EngineError("The engine returned empty audio.")
        peak = float(np.max(np.abs(samples)))
        if peak > 1.0:
            samples = samples / peak
        out_path.parent.mkdir(parents=True, exist_ok=True)
        sf.write(str(out_path), samples, sr, subtype="PCM_16")
        return {"sample_rate": sr, "duration": round(len(samples) / sr, 3)}


class MockEngine(BaseEngine):
    """Placeholder tones, shaped by emotion. Never presented as a real clone."""

    key = "mock"
    label = "Mock (placeholder)"
    output_sr = OUTPUT_SR

    def __init__(self) -> None:
        self._state = "ready"

    def status(self) -> dict:
        return {
            "key": self.key,
            "label": self.label,
            "installed": True,
            "state": "ready",
            "device": "cpu",
            "error": "",
            "model": "sine placeholder — set TIMBRE_ENGINE=auto for real cloning",
        }

    def train_emotion(self, wav_paths: list[Path], out_path: Path) -> dict:
        out_path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "mock": True,
            "refs": [str(p) for p in wav_paths],
            "seconds": round(
                sum(sf.info(str(p)).frames / sf.info(str(p)).samplerate for p in wav_paths), 2
            ),
        }
        out_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        return {"latent": out_path.name, "mock": True}

    def synthesize(
        self,
        *,
        text: str,
        language: str,
        speed: float,
        out_path: Path,
        emotion: str,
        intensity: float,
        latents: dict[str, Path],
        ref_paths: list[Path],
    ) -> dict:
        sr = OUTPUT_SR
        rate = {
            "neutral": 1.0,
            "happy": 1.22,
            "sad": 0.84,
            "angry": 1.08,
            "excited": 1.3,
            "calm": 0.9,
            "fearful": 1.14,
            "whisper": 0.96,
        }.get(emotion, 1.0)
        rate = 1.0 + (rate - 1.0) * max(0.0, min(1.0, intensity))
        rng = np.random.default_rng(abs(hash(text)) % (2**32))
        words = re.findall(r"[A-Za-z0-9']+", text)[:80] or ["placeholder"]
        base_f0 = 118.0 * rate
        chunks: list[np.ndarray] = []
        for word in words:
            dur = max(0.12, (0.1 + 0.055 * len(word)) / max(0.5, speed))
            n = int(dur * sr)
            if n < 32:
                continue
            t = np.arange(n) / sr
            f0 = base_f0 * (1 + 0.05 * np.sin(2 * math.pi * 2.4 * t + rng.random()))
            phase = 2 * math.pi * np.cumsum(f0) / sr
            tone = np.zeros(n, dtype=np.float32)
            for harmonic in range(1, 7):
                tone += (np.sin(phase * harmonic) / harmonic).astype(np.float32)
            envelope = np.minimum(1.0, t / 0.02) * np.minimum(1.0, (dur - t) / 0.06)
            tone *= envelope * (0.16 if emotion != "whisper" else 0.05)
            if emotion == "whisper":
                tone += rng.normal(0, 0.02, n).astype(np.float32) * envelope
            chunks.append(tone)
            chunks.append(np.zeros(int(0.05 * sr), dtype=np.float32))
        wav = np.concatenate(chunks) if chunks else np.zeros(sr // 2, dtype=np.float32)
        peak = float(np.max(np.abs(wav))) or 1.0
        wav = (wav / peak) * 0.6
        out_path.parent.mkdir(parents=True, exist_ok=True)
        sf.write(str(out_path), wav, sr, subtype="PCM_16")
        return {"sample_rate": sr, "duration": round(len(wav) / sr, 3), "mock": True}


def build_engine() -> BaseEngine:
    choice = os.environ.get("TIMBRE_ENGINE", "auto").strip().lower()
    if choice == "mock":
        return MockEngine()
    return XttsEngine()
