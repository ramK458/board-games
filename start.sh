#!/bin/bash
# Start both backend and frontend for Board Games
# Usage: ./start.sh

set -e

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT_DIR"

echo "=== Board Games — Starting ==="

# ── Backend ────────────────────────────────────

echo "[1/2] Starting backend (FastAPI on :8000)..."
source .venv/bin/activate
PYTHONPATH="$ROOT_DIR/.." uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload &
BACKEND_PID=$!

# Wait for backend to be ready
echo "  Waiting for backend..."
for i in $(seq 1 30); do
  if curl -s http://localhost:8000/api/health > /dev/null 2>&1; then
    echo "  Backend ready."
    break
  fi
  sleep 0.5
done

# ── Frontend ───────────────────────────────────

echo "[2/2] Starting frontend (Vite on :5173)..."
cd frontend
npm run dev &
FRONTEND_PID=$!
cd "$ROOT_DIR"

echo ""
echo "=== Both services started ==="
echo "  Backend:  http://localhost:8000  (API docs: http://localhost:8000/docs)"
echo "  Frontend: http://localhost:5173"
echo ""
echo "Press Ctrl+C to stop both."

# ── Cleanup on exit ────────────────────────────

cleanup() {
  echo ""
  echo "Shutting down..."
  kill "$BACKEND_PID" 2>/dev/null || true
  kill "$FRONTEND_PID" 2>/dev/null || true
  wait "$BACKEND_PID" 2>/dev/null || true
  wait "$FRONTEND_PID" 2>/dev/null || true
  echo "Done."
}
trap cleanup EXIT INT TERM

# Wait for either process to exit
wait
