#!/usr/bin/env bash
# Sirenity launcher (macOS / Linux).
set -euo pipefail
cd "$(dirname "$0")"

PORT="${PORT:-8000}"
MOCK=0
CUDA=0
SKIP_ENGINE=0
NO_BROWSER=0
ACCEPT_LICENSE=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --mock) MOCK=1 ;;
    --cuda) CUDA=1 ;;
    --skip-engine) SKIP_ENGINE=1 ;;
    --no-browser) NO_BROWSER=1 ;;
    --accept-license) ACCEPT_LICENSE=1 ;;
    --port) PORT="${2:?--port needs a number}"; shift ;;
    -h|--help)
      echo "Usage: ./run.sh [--mock] [--cuda] [--skip-engine] [--no-browser] [--accept-license] [--port N]"
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

if [[ "$MOCK" -eq 0 && "${SIRENITY_ENGINE:-}" != "mock" ]]; then
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

LICENSE_MARKER="data/.cpml-agreed"

if [[ "$MOCK" -eq 0 ]]; then
  if [[ "${COQUI_TOS_AGREED:-}" == "1" || -f "$LICENSE_MARKER" ]]; then
    # Already accepted on an earlier run; keep Coqui's prompt quiet.
    export COQUI_TOS_AGREED=1
  else
    ACCEPT="n"
    if [[ "$ACCEPT_LICENSE" -eq 1 ]]; then
      ACCEPT="y"
    else
      echo ""
      echo "XTTS v2 model licence (CPML)"
      echo "The XTTS v2 model is licensed for non-commercial use only under Coqui's"
      echo "Public Model License: https://coqui.ai/cpml"
      echo "Generated audio needs a separate licence for commercial use."
      read -r -p "Do you accept the CPML for non-commercial use? [y/N] " ACCEPT || ACCEPT=n
    fi
    if [[ "$ACCEPT" =~ ^[Yy] ]]; then
      export COQUI_TOS_AGREED=1
      mkdir -p "$(dirname "$LICENSE_MARKER")"
      echo "Accepted Coqui CPML on $(date +%Y-%m-%d)" > "$LICENSE_MARKER"
      echo "CPML accepted."
    else
      MOCK=1
      echo "CPML not accepted. Starting with the mock engine instead."
    fi
  fi
fi

if [[ "$MOCK" -eq 1 ]]; then
  export SIRENITY_ENGINE=mock
  echo "Mock engine enabled: the studio works, but speech is placeholder tones."
fi

URL="http://127.0.0.1:${PORT}"
if [[ "$NO_BROWSER" -eq 0 ]]; then
  ( sleep 2; xdg-open "$URL" >/dev/null 2>&1 || open "$URL" >/dev/null 2>&1 || true ) &
fi

echo ""
echo "Sirenity is starting at $URL"
echo "Press Ctrl+C to stop the server."
echo ""

exec python -m uvicorn server.main:app --host 127.0.0.1 --port "$PORT"
