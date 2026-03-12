import os
import json
import queue
import threading
import datetime
from pathlib import Path
from flask import Flask, request, jsonify, Response
from flask_cors import CORS

from store.persistent_store import PersistentStore
from handlers.event_router import dispatch
from api.routes import api_bp

app = Flask(__name__)
CORS(app, origins="*")

store = PersistentStore()
app.config["STORE"] = store
app.register_blueprint(api_bp, url_prefix="/api")

# ── File logging ───────────────────────────────────────────────────────────────
_log_dir = Path(__file__).parent / "logs"
_log_dir.mkdir(exist_ok=True)
_log_raw = _log_dir / "events_raw.jsonl"        # every event exactly as received
_log_parsed = _log_dir / "events_parsed.jsonl"  # what dispatch() returned
_log_lock = threading.Lock()


def _log(path: Path, record: dict) -> None:
    record["_ts"] = datetime.datetime.now().isoformat()
    with _log_lock:
        with open(path, "a", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")


# ── SSE broadcast ─────────────────────────────────────────────────────────────
_clients: list[queue.Queue] = []
_clients_lock = threading.Lock()


def _broadcast(data: dict) -> None:
    with _clients_lock:
        dead = []
        for q in _clients:
            try:
                q.put_nowait(data)
            except queue.Full:
                dead.append(q)
        for q in dead:
            _clients.remove(q)


# ── Routes ────────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    """Liveness check — visit http://localhost:5000/health to verify backend."""
    return jsonify({
        "ok": True,
        "sessions": len(store.all_sessions()),
        "sse_clients": len(_clients),
        "log_dir": str(_log_dir.resolve()),
        "db": str(store._db_path.resolve()),
    })


@app.get("/api/events/stream")
def event_stream():
    """SSE endpoint — frontend subscribes here for real-time updates."""
    def generate():
        q: queue.Queue = queue.Queue(maxsize=200)
        with _clients_lock:
            _clients.append(q)
        snapshot = {
            "type": "__snapshot__",
            "data": {
                "sessions": store.all_sessions(),
                "toolStats": store.get_tool_stats(),
                "todos": store.get_todos(),
                "skills": store.get_skills(),
                "metrics": store.get_metrics(),
            },
        }
        yield f"data: {json.dumps(snapshot)}\n\n"
        try:
            while True:
                try:
                    item = q.get(timeout=25)
                    yield f"data: {json.dumps(item)}\n\n"
                except queue.Empty:
                    yield ": keepalive\n\n"
        finally:
            with _clients_lock:
                if q in _clients:
                    _clients.remove(q)

    return Response(
        generate(),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


@app.post("/api/events/batch")
def receive_events():
    """Plugin forwards batched events here."""
    data = request.get_json(silent=True) or {}
    events = data.get("events", [])
    results = []
    for event in events:
        # Log raw event exactly as received from plugin
        _log(_log_raw, {"event": event})

        result = dispatch(store, event)

        # Log what dispatch() parsed/returned (None means event was ignored)
        _log(_log_parsed, {
            "type": event.get("type"),
            "parsed": result,
            "ignored": result is None,
        })

        if result:
            results.append(result)
            _broadcast({
                "type": event.get("type"),
                "data": result,
                "timestamp": event.get("timestamp"),
            })

    return jsonify({"ok": True, "processed": len(events), "results": results})


@app.get("/api/logs/raw")
def get_log_raw():
    """Return last N lines of raw event log for debugging."""
    n = int(request.args.get("n", 50))
    if not _log_raw.exists():
        return jsonify([])
    lines = _log_raw.read_text(encoding="utf-8").strip().splitlines()
    return jsonify([json.loads(l) for l in lines[-n:]])


@app.get("/api/logs/parsed")
def get_log_parsed():
    """Return last N lines of parsed event log for debugging."""
    n = int(request.args.get("n", 50))
    if not _log_parsed.exists():
        return jsonify([])
    lines = _log_parsed.read_text(encoding="utf-8").strip().splitlines()
    return jsonify([json.loads(l) for l in lines[-n:]])


if __name__ == "__main__":
    port = int(os.environ.get("COCKPIT_PORT", 5000))
    print(f"[AgentCockpit] Backend running on http://127.0.0.1:{port}")
    print(f"[AgentCockpit] Logs → {_log_dir.resolve()}")
    app.run(host="0.0.0.0", port=port, debug=False, threaded=True)
