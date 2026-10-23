#!/usr/bin/env bash
# Timbre launcher (macOS / Linux).
set -euo pipefail
cd "$(dirname "$0")"

PORT="${PORT:-8000}"
MOCK=0
CUDA=0
SKIP_ENGINE=0
NO_BROWSER=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --mock) MOCK=1 ;;
    --cuda) CUDA=1 ;;
    --skip-engine) SKIP_ENGINE=1 ;;
    --no-browser) NO_BROWSER=1 ;;
    --port) PORT="${2:?--port needs a number}"; shift ;;
    -h|--help)
      echo "Usage: ./run.sh [--mock] [--cuda] [--skip-engine] [--no-browser] [--port N]"
      exit 0
      ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
  shift
done

if [[ ! -d .venv ]]; then
  if command -v python3.12 >/dev/null 2>&1; then
    BASE=python3.12
  elif command -v python3 >/dev/null 2>&1; then
    BASE=python3
  else
    echo "Python 3.10-3.12 was not found. Install it, then run this script again." >&2
    exit 1
  fi
  echo "Creating a virtual environment with $BASE"
  "$BASE" -m venv .venv
fi

# shellcheck disable=SC1091
source .venv/bin/activate

echo "Installing base dependencies..."
python -m pip install --upgrade pip --disable-pip-version-check --quiet
python -m pip install -r requirements.txt --disable-pip-version-check

if [[ "$MOCK" -eq 0 && "${TIMBRE_ENGINE:-}" != "mock" ]]; then
  if ! python -c "import importlib.util,sys; sys.exit(0 if importlib.util.find_spec('TTS') else 1)"; then
    if [[ "$SKIP_ENGINE" -eq 1 ]]; then
      MOCK=1
    else
      echo ""
      echo "The XTTS v2 voice engine is not installed yet (~2.5 GB)."
      read -r -p "Install the voice engine now? [Y/n] " ANSWER || ANSWER=n
      if [[ "$ANSWER" =~ ^[Nn] ]]; then
        MOCK=1
      else
        if [[ "$CUDA" -eq 1 ]]; then
          echo "Installing CUDA PyTorch..."
          python -m pip install --upgrade torch torchaudio --index-url https://download.pytorch.org/whl/cu124
        fi
        python -m pip install -r requirements-engine.txt
      fi
    fi
  fi
fi

if [[ "$MOCK" -eq 1 ]]; then
  export TIMBRE_ENGINE=mock
  echo "Mock engine enabled: the studio works, but speech is placeholder tones."
fi

URL="http://127.0.0.1:${PORT}"
if [[ "$NO_BROWSER" -eq 0 ]]; then
  ( sleep 2; xdg-open "$URL" >/dev/null 2>&1 || open "$URL" >/dev/null 2>&1 || true ) &
fi

echo ""
echo "Timbre is starting at $URL"
echo "Press Ctrl+C to stop the server."
echo ""

exec python -m uvicorn server.main:app --host 127.0.0.1 --port "$PORT"
