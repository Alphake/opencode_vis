from flask import Blueprint, jsonify, request, current_app

api_bp = Blueprint("api", __name__)


def _store():
    return current_app.config["STORE"]


# ── Health ────────────────────────────────────────────────────────────────────


@api_bp.get("/health")
def health():
    store = _store()
    return jsonify({
        "ok": True,
        "sessions": len(store.all_sessions()),
    })


# ── Sessions ──────────────────────────────────────────────────────────────────


@api_bp.get("/sessions")
def list_sessions():
    return jsonify(_store().all_sessions())


@api_bp.get("/sessions/<session_id>")
def get_session(session_id: str):
    s = _store().get_session(session_id)
    if not s:
        return jsonify({"error": "not found"}), 404
    return jsonify(s.to_dict())


@api_bp.get("/sessions/<session_id>/messages")
def get_session_messages(session_id: str):
    return jsonify(_store().get_messages(session_id))


# ── Agents / Hierarchy ────────────────────────────────────────────────────────


@api_bp.get("/agents/hierarchy")
def get_hierarchy():
    return jsonify(_store().get_hierarchy())


@api_bp.get("/agents/status")
def get_agents_status():
    sessions = _store().all_sessions()
    return jsonify(
        [
            {
                "id": s["id"],
                "agent": s["agent"],
                "status": s["status"],
                "parentId": s["parentId"],
            }
            for s in sessions
        ]
    )


# ── Tools ─────────────────────────────────────────────────────────────────────


@api_bp.get("/tools/stats")
def get_tool_stats():
    return jsonify(_store().get_tool_stats())


@api_bp.get("/tools/calls")
def get_tool_calls():
    session_id = request.args.get("sessionId")
    return jsonify(_store().get_tool_calls(session_id))


# ── Todos ─────────────────────────────────────────────────────────────────────


@api_bp.get("/todos")
def get_todos():
    return jsonify(_store().get_todos())


@api_bp.get("/todos/<session_id>")
def get_session_todos(session_id: str):
    return jsonify(_store().get_todos(session_id))


# ── Skills ────────────────────────────────────────────────────────────────────


@api_bp.get("/skills")
def get_skills():
    session_id = request.args.get("sessionId")
    return jsonify(_store().get_skills(session_id))


# ── Metrics ───────────────────────────────────────────────────────────────────


@api_bp.get("/metrics")
def get_metrics():
    return jsonify(_store().get_metrics())
