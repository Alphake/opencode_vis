# VibeTrace: See how your agents think

**Version 1.5** · Visualizing Agent Runtime Behavior for Human Intervention in Vibe Coding

A web dashboard for **[OpenCode](https://opencode.ai/)** that connects to a local OpenCode HTTP server (REST + Server-Sent Events). VibeTrace gives developers a live, layered view of agent execution and supports **action-level process intervention** — fork, inspect, and steer runs without losing trajectory context.

---

## UI preview

<p align="center">
<img src="./fig/timeline-view.png" alt="VibeTrace action-flow view" width="100%" />
</p>

---

## Two core capabilities

### 1. Layered real-time execution visualization

VibeTrace turns raw OpenCode message streams into a structured, reviewable execution surface:

- **Task-aware session view** — Detects when the user switches tasks inside a session and surfaces each completed task as its own tab, so trajectories from different goals are not mixed together.
- **Subtask panels from todos** — Within a task, planner todos are materialized into subtask panels. Each panel shows the action-flow trace for that slice of work, making it easy to locate and audit specific steps.
- **Rich action-flow rendering** — Orthogonal layout of mapped tool/agent steps, branching forks, contextual tooltips, and click-to-focus linking between the flow, todos, and transcripts. **`Actions duration`** toggles between fixed step spacing and horizontally scaled blocks keyed to measured duration. **`Actions color`** switches the palette between **tokens** and **tool type** lenses. Toolbar **`timeline` / `summary`** changes how subtasks are arranged in the rail; fullscreen is available for the flow view.
- **Per-panel analysis** — Each subtask panel can show a trace summary and automated error diagnosis to help you understand what happened and where things went wrong.
- **Cross-linking** — Optional connectors from todo rows into a linked card **or into the focused action** when one is selected.

### 2. Action-level process intervention

Beyond observation, VibeTrace supports interactive steering grounded in the live trajectory:

- **Fork from any action** — Branch the session at a specific tool/agent step, capture a pre-fork panel snapshot, and continue in a new OpenCode session while preserving comparison context.
- **Trajectory-based branching** — Fork connectors and ghost trails show how a branched run diverges from the parent path, so you can experiment without losing sight of the original execution.


---

## Installation & Running

VibeTrace runs as three local processes: the **OpenCode HTTP server**, the **memory-worker** (Python), and the **Vite UI**. You start each one from the command line.

**Prerequisites:** [OpenCode CLI](https://opencode.ai/download), **Node.js**, and **Python 3** (`python` on Windows, `python3` on macOS/Linux).

### 1. Install OpenCode

Follow the [upstream installation guide](https://opencode.ai/download), then verify:

```bash
opencode --version
```

### 2. Clone and install dependencies

```bash
git clone -b V1.5 https://github.com/idvxlab/VibeTrace.git
cd VibeTrace
npm install
```

### 3. Configure environment

Copy the template and keep **manual dev** defaults (OpenCode on port **4096**, no HTTP password):

```bash
cp .env.example .env.local
```

On Windows you can also reset to manual mode anytime:

```powershell
npm run env:manual
```

Key settings in `.env.local` (see [`.env.example`](./.env.example) for the full list):

| Variable | Manual dev value | Purpose |
| --- | --- | --- |
| `VIBETRACE_OPENCODE_MODE` | `manual` | You start `opencode serve` yourself |
| `OPENCODE_PROXY_TARGET` | `http://127.0.0.1:4096` | Vite dev proxy → OpenCode |
| `OPENCODE_BASE` | `http://127.0.0.1:4096` | memory-worker → OpenCode |
| `VITE_OPENCODE_BASE` | *(empty)* | Use Vite same-origin proxy (recommended) |
| `VITE_MEMORY_WORKER_BASE` | *(empty)* | Worker API also proxied through Vite |

If `opencode serve` prints a port other than `4096`, update `OPENCODE_PROXY_TARGET` and `OPENCODE_BASE` to match. You can pin the port:

```bash
opencode serve --port 4096
```

Do **not** set `VITE_OPENCODE_SERVER_PASSWORD` / `OPENCODE_SERVER_PASSWORD` for a normal unsecured `opencode serve`.

### 4. Start services (three terminals)

Keep all three running while you use VibeTrace.

**Terminal 1 — OpenCode (backend API)**

```bash
opencode serve
```

You should see something like:

```text
opencode server listening on http://127.0.0.1:4096
```

**Terminal 2 — memory-worker (trace ingest & panel analysis)**

```bash
npm run worker:py
```

Listens on **`http://127.0.0.1:8714`** by default. See [`docs/memory-worker.md`](./docs/memory-worker.md).

**Terminal 3 — Vite UI**

```bash
npm run dev
```

Open **`http://127.0.0.1:5173`** in your browser.

### Daily use

1. Start **Terminal 1** (`opencode serve`), then **Terminal 2** (`npm run worker:py`), then **Terminal 3** (`npm run dev`).
2. Use VibeTrace in the browser. Trace ingest and per-panel analysis run in the background via the worker.

### Optional environment variables

| Variable | When to set |
| --- | --- |
| `SKILL_WRITE_ROOT` | Where analyzed skills are written |
| `VITE_OPENCODE_DEFAULT_MODEL` | Default model when sending from VibeTrace (`provider/model`) |
| `VITE_TRACE_SESSION_TURN_LIMIT` | More history turns per ingest (default `5`) |
| `PYTHON` | Non-default Python executable name |

<details>
<summary><strong>Appendix: OpenCode desktop plugin (optional, not required)</strong></summary>

The repo includes `plugins/agent-cockpit.ts` for **internal / desktop convenience**: when registered in OpenCode, it can rewrite `.env.local`, start the memory-worker and Vite dev server, and open the browser automatically. **This is not the documented install path** — use the three-terminal flow above unless you maintain the plugin yourself.

**One-time registration** — add the plugin file’s **absolute path** to your global OpenCode config:

| OS | Global config path |
| --- | --- |
| **Windows** | `%APPDATA%\opencode\opencode.json` |
| **macOS / Linux** | `~/.config/opencode/opencode.json` |

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "/absolute/path/to/VibeTrace/plugins/agent-cockpit.ts"
  ]
}
```

Point at **`plugins/agent-cockpit.ts`**, not the repo root. **Fully quit and restart OpenCode** after changing config.

With the plugin enabled, starting the **OpenCode desktop app** may:

- update `.env.local` with the desktop API port and auth
- start memory-worker on **`http://127.0.0.1:8714`**
- start Vite on **`http://127.0.0.1:5173`**
- open the browser (unless `VIBETRACE_NO_BROWSER=1`)

Plugin-related env vars: `VIBETRACE_NO_BROWSER`, `VIBETRACE_OPENCODE_MODE=plugin`. To return to manual dev, run `npm run env:manual` (Windows) or restore manual values from [`.env.example`](./.env.example).

</details>

---

## Tech stack

React 19 · TypeScript · Vite · Tailwind CSS 4 · d3 · react-tooltip

---

## License

[MIT](./LICENSE)
