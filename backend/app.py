import os
import json
import queue
import threading
import datetime
import logging
import signal
import sys
import traceback
import atexit
import faulthandler
from pathlib import Path
from flask import Flask, request, jsonify, Response
from flask_cors import CORS
from dotenv import load_dotenv

from store.persistent_store import PersistentStore
from handlers.event_router import dispatch
from api.routes import api_bp, compute_overview_incremental

# Load local backend environment variables from backend/.env.
# This keeps secrets out of source code and makes deployment configurable.
load_dotenv(Path(__file__).parent / ".env")

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
_docs_dir = Path(__file__).parent.parent / "docs"
_runtime_log = _log_dir / "runtime.log"
_crash_log = _log_dir / "fatal_crash.log"
_crash_log_fp = None


def _setup_runtime_logging() -> None:
    """
    运行期日志：
    - 控制台 + logs/runtime.log 双写
    - 捕获未处理异常、线程异常、退出信号，帮助定位“进程自己停了”
    """
    root = logging.getLogger()
    if root.handlers:
        # 避免重复初始化导致日志重复
        return
    root.setLevel(logging.INFO)
    fmt = logging.Formatter("%(asctime)s [%(levelname)s] %(name)s: %(message)s")

    file_handler = logging.FileHandler(_runtime_log, encoding="utf-8")
    file_handler.setFormatter(fmt)
    root.addHandler(file_handler)

    stream_handler = logging.StreamHandler(sys.stdout)
    stream_handler.setFormatter(fmt)
    root.addHandler(stream_handler)

    # 合并 werkzeug 请求日志，便于与应用日志对齐排障
    wz = logging.getLogger("werkzeug")
    wz.setLevel(logging.INFO)
    wz.propagate = True


def _setup_fault_logging() -> None:
    """
    捕获 Python 层之外的致命错误（如 native 崩溃），写入 fatal_crash.log。
    """
    global _crash_log_fp
    try:
        _crash_log_fp = open(_crash_log, "a", encoding="utf-8")
        faulthandler.enable(file=_crash_log_fp, all_threads=True)
        faulthandler.register(getattr(signal, "SIGABRT", signal.SIGTERM), file=_crash_log_fp, all_threads=True)
    except Exception as exc:
        logging.getLogger("runtime").warning("Failed to enable faulthandler: %s", exc)


def _log_fatal_exception(source: str, exc_type, exc_value, exc_tb) -> None:
    logger = logging.getLogger("runtime")
    logger.error(
        "Uncaught exception (%s): %s",
        source,
        "".join(traceback.format_exception(exc_type, exc_value, exc_tb)).rstrip(),
    )


def _install_runtime_hooks() -> None:
    logger = logging.getLogger("runtime")

    def _main_excepthook(exc_type, exc_value, exc_tb):
        _log_fatal_exception("main", exc_type, exc_value, exc_tb)
        sys.__excepthook__(exc_type, exc_value, exc_tb)

    sys.excepthook = _main_excepthook

    def _thread_excepthook(args):
        _log_fatal_exception("thread", args.exc_type, args.exc_value, args.exc_traceback)
        if threading.__excepthook__:
            threading.__excepthook__(args)

    threading.excepthook = _thread_excepthook

    def _signal_handler(signum, _frame):
        sig_name = signal.Signals(signum).name if signum in [s.value for s in signal.Signals] else str(signum)
        logger.warning("Received signal %s, backend will exit", sig_name)
        # 复用默认行为退出，避免吞掉退出信号
        raise SystemExit(128 + signum)

    for sig_name in ("SIGINT", "SIGTERM", "SIGBREAK"):
        sig = getattr(signal, sig_name, None)
        if sig is not None:
            signal.signal(sig, _signal_handler)

    @atexit.register
    def _on_exit():
        logger.info("Backend process exiting")


_setup_runtime_logging()
_setup_fault_logging()
_install_runtime_hooks()
_runtime_logger = logging.getLogger("runtime")
_runtime_logger.info("Runtime logging initialized: %s", _runtime_log.resolve())
_runtime_logger.info("Fatal crash log path: %s", _crash_log.resolve())


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
            print("event: ", event)
            print("result: ", result)
            # Overview 实时增量：当 message 或 message part 更新时，由后端计算新点坐标并 SSE 推送。
            if result.get("action") in ("message.updated", "message.part.updated"):
                sid = result.get("sessionId")
                sess = store.get_session(sid) if sid else None
                directory = (getattr(sess, "directory", "") or "").strip()
                if directory:
                    inc_payload, inc_status = compute_overview_incremental(directory=directory)
                    added = inc_payload.get("addedMessageNodes") or []
                    if inc_status == 200 and added:
                        _runtime_logger.info(
                            "[overview.incremental.push] directory=%s addedCount=%s",
                            directory, len(added),
                        )
                        for n in added:
                            _runtime_logger.info(
                                "[overview.incremental.push] nodeId=%s messageId=%s sessionId=%s agent=%s type=%s x=%.4f y=%.4f",
                                n.get("nodeId"), n.get("messageId"), n.get("sessionId"),
                                n.get("agent"), n.get("type"), float(n.get("x", 0)), float(n.get("y", 0)),
                            )
                        _broadcast({
                            "type": "overview.incremental",
                            "data": inc_payload,
                            "timestamp": event.get("timestamp"),
                        })

    return jsonify({"ok": True, "processed": len(events), "results": results})


@app.errorhandler(Exception)
def handle_unexpected_error(exc: Exception):
    """
    全局兜底异常处理，防止“静默失败”。
    错误会同时出现在控制台和 logs/runtime.log。
    """
    _runtime_logger.exception("Unhandled Flask error on %s %s", request.method, request.path)
    return jsonify({"error": "internal server error", "detail": str(exc)}), 500


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


@app.get("/api/docs/openapi.yaml")
def openapi_yaml():
    """Serve OpenAPI spec for local Swagger/Redoc."""
    spec = _docs_dir / "openapi.yaml"
    if not spec.exists():
        return jsonify({"error": "openapi.yaml not found"}), 404
    return Response(spec.read_text(encoding="utf-8"), mimetype="application/yaml")


@app.get("/api/docs")
def api_docs():
    """Serve a simple Swagger UI page at /api/docs."""
    html = """
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Agent Cockpit API Docs</title>
    <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
    <script>
      window.ui = SwaggerUIBundle({
        url: "/api/docs/openapi.yaml",
        dom_id: "#swagger-ui",
        presets: [SwaggerUIBundle.presets.apis],
      });
    </script>
  </body>
</html>
""".strip()
    return Response(html, mimetype="text/html")


def _preload_hf_embedding_model():
    """
    启动时预加载默认 HF 模型（BAAI/bge-m3），避免首次 embeddingMode=hf 请求卡在加载。
    失败仅打日志，不影响服务启动。
    """
    preload = os.environ.get("COCKPIT_PRELOAD_HF", "true").strip().lower() in ("1", "true", "yes")
    if not preload:
        return
    try:
        from services.projection_service import HuggingFaceEmbedder
        embedder = HuggingFaceEmbedder(model="BAAI/bge-m3")
        err = embedder.ensure_ready()
        if err:
            print(f"[AgentCockpit] HF preload skip: {err}")
            return
        embedder._get_model()
        print("[AgentCockpit] HF embedding model preloaded (BAAI/bge-m3)")
    except Exception as e:
        print(f"[AgentCockpit] HF preload failed (ignored): {e}")


if __name__ == "__main__":
    # 临时停用 HF 预加载，当前投影统一走 DashScope。
    # _preload_hf_embedding_model()
    port = int(os.environ.get("COCKPIT_PORT", 5000))
    print(f"[AgentCockpit] Backend running on http://127.0.0.1:{port}")
    print(f"[AgentCockpit] Logs → {_log_dir.resolve()}")
    _runtime_logger.info("Starting backend server at http://127.0.0.1:%s", port)
    try:
        app.run(host="0.0.0.0", port=port, debug=False, threaded=True)
    except Exception:
        _runtime_logger.exception("Backend server crashed during app.run")
        raise
    finally:
        _runtime_logger.info("Backend app.run returned")
