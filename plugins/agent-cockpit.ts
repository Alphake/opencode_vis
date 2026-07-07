/**
 * VibeTrace — OpenCode plugin
 *
 * On OpenCode startup → server({ serverUrl })
 *   → write .env.local (Vite proxy + preserve existing password)
 *   → start memory-worker (:8714)
 *   → start Vite (:5173)
 *   → open browser automatically
 *
 * Cross-platform: Windows / macOS / Linux (npm, python, browser open command)
 */

import { exec, spawn, type ChildProcess } from "node:child_process"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** Project root: plugins/ → parent; .opencode/plugins/ → grandparent */
function resolveProjectRoot(pluginDir: string): string {
  const parent = path.resolve(pluginDir, "..")
  if (existsSync(path.join(parent, "package.json"))) return parent
  const grandparent = path.resolve(pluginDir, "..", "..")
  if (existsSync(path.join(grandparent, "package.json"))) return grandparent
  return parent
}

const PROJECT_ROOT = resolveProjectRoot(__dirname)
const VITE_PORT = 5173
const MEMORY_WORKER_PORT = 8714
const isWin = process.platform === "win32"
const isMac = process.platform === "darwin"

let devStarted = false
let memoryWorkerProc: ChildProcess | null = null
let viteProc: ChildProcess | null = null

function resolveNpm(): string {
  return isWin ? "npm.cmd" : "npm"
}

/** Prefer python3 on macOS/Linux; python on Windows; override with PYTHON env var */
function resolvePython(): string {
  if (process.env.PYTHON?.trim()) return process.env.PYTHON.trim()
  return isWin ? "python" : "python3"
}

function openBrowser(url: string): void {
  if (process.env.VIBETRACE_NO_BROWSER === "1") {
    console.log(`[VibeTrace] skip browser (VIBETRACE_NO_BROWSER=1) → ${url}`)
    return
  }
  console.log(`[VibeTrace] opening → ${url}`)
  if (isWin) {
    exec(`start "" "${url}"`)
  } else if (isMac) {
    exec(`open "${url}"`)
  } else {
    exec(`xdg-open "${url}"`)
  }
}

function parseEnvFile(content: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of content.split("\n")) {
    const t = line.trim()
    if (!t || t.startsWith("#")) continue
    const i = t.indexOf("=")
    if (i <= 0) continue
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim()
  }
  return out
}

function formatEnvFile(mode: 'manual' | 'plugin', vars: Record<string, string>): string {
  const lines = [
    mode === 'plugin'
      ? '# Written automatically by OpenCode plugin (desktop opens project); for manual dev: cp .env.example .env.local'
      : '# Manual dev config (opencode serve default 4096); desktop plugin overwrites port/password when opened',
    "",
  ]
  for (const [k, v] of Object.entries(vars)) {
    lines.push(`${k}=${v}`)
  }
  lines.push("")
  return lines.join("\n")
}

/** Desktop may rotate password/port on each launch; process.env wins over stale .env.local */
function syncOpencodeAuthFromProcess(merged: Record<string, string>): void {
  const pwd = process.env.OPENCODE_SERVER_PASSWORD?.trim()
  if (pwd) {
    merged.VITE_OPENCODE_SERVER_PASSWORD = pwd
    merged.OPENCODE_SERVER_PASSWORD = pwd
  }
  const user = process.env.OPENCODE_SERVER_USERNAME?.trim()
  if (user) {
    merged.VITE_OPENCODE_SERVER_USERNAME = user
    merged.OPENCODE_SERVER_USERNAME = user
  }
}

function killListenerOnPort(port: number): Promise<void> {
  return new Promise((resolve) => {
    if (isWin) {
      exec(
        `powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }"`,
        () => resolve(),
      )
      return
    }
    exec(`lsof -ti:${port} 2>/dev/null | xargs kill -9 2>/dev/null`, () => resolve())
  })
}

/** Keys that require Vite restart when changed (Vite reads .env only at startup). */
const VITE_PROXY_ENV_KEYS = [
  "VITE_OPENCODE_BASE",
  "OPENCODE_PROXY_TARGET",
  "OPENCODE_BASE",
  "VITE_OPENCODE_SERVER_PASSWORD",
  "OPENCODE_SERVER_PASSWORD",
  "VITE_OPENCODE_SERVER_USERNAME",
  "OPENCODE_SERVER_USERNAME",
] as const

/** Keys that require memory-worker restart when changed. */
const WORKER_PROXY_ENV_KEYS = [
  "OPENCODE_BASE",
  "OPENCODE_SERVER_PASSWORD",
  "OPENCODE_SERVER_USERNAME",
] as const

function envSlice(vars: Record<string, string>, keys: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const k of keys) out[k] = vars[k] ?? ""
  return out
}

function envSliceEqual(a: Record<string, string>, b: Record<string, string>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const k of keys) {
    if ((a[k] ?? "") !== (b[k] ?? "")) return false
  }
  return true
}

function buildEnvVars(serverUrl: URL, existing: Record<string, string> = {}): Record<string, string> {
  const port = serverUrl.port || (serverUrl.protocol === "https:" ? "443" : "80")
  const proxyTarget = `${serverUrl.protocol}//${serverUrl.hostname}:${port}`

  const merged: Record<string, string> = {
    ...existing,
    VITE_OPENCODE_BASE: "",
    OPENCODE_PROXY_TARGET: proxyTarget,
    VITE_MEMORY_WORKER_BASE: existing.VITE_MEMORY_WORKER_BASE ?? "",
    MEMORY_WORKER_PROXY_TARGET:
      existing.MEMORY_WORKER_PROXY_TARGET ?? `http://127.0.0.1:${MEMORY_WORKER_PORT}`,
    OPENCODE_BASE: proxyTarget,
  }

  if (serverUrl.username) {
    const user = decodeURIComponent(serverUrl.username)
    merged.VITE_OPENCODE_SERVER_USERNAME = user
    merged.OPENCODE_SERVER_USERNAME = user
  }
  if (serverUrl.password) {
    const pwd = decodeURIComponent(serverUrl.password)
    merged.VITE_OPENCODE_SERVER_PASSWORD = pwd
    merged.OPENCODE_SERVER_PASSWORD = pwd
  }
  syncOpencodeAuthFromProcess(merged)
  merged.VIBETRACE_OPENCODE_MODE = "plugin"
  return merged
}

function writeEnvLocal(
  serverUrl: URL,
): { vars: Record<string, string>; changed: boolean; viteProxyChanged: boolean; workerProxyChanged: boolean } {
  const envPath = path.join(PROJECT_ROOT, ".env.local")

  let existing: Record<string, string> = {}
  if (existsSync(envPath)) {
    try {
      existing = parseEnvFile(readFileSync(envPath, "utf-8"))
    } catch { /* ignore */ }
  }

  const merged = buildEnvVars(serverUrl, existing)
  const viteProxyChanged = !envSliceEqual(
    envSlice(existing, VITE_PROXY_ENV_KEYS),
    envSlice(merged, VITE_PROXY_ENV_KEYS),
  )
  const workerProxyChanged = !envSliceEqual(
    envSlice(existing, WORKER_PROXY_ENV_KEYS),
    envSlice(merged, WORKER_PROXY_ENV_KEYS),
  )
  const changed = viteProxyChanged || workerProxyChanged

  if (!changed) {
    console.log(`[VibeTrace] .env.local unchanged → proxy ${merged.OPENCODE_PROXY_TARGET}`)
    return { vars: merged, changed: false, viteProxyChanged: false, workerProxyChanged: false }
  }

  try {
    writeFileSync(envPath, formatEnvFile("plugin", merged), "utf-8")
    console.log(`[VibeTrace] .env.local updated → proxy ${merged.OPENCODE_PROXY_TARGET}`)
  } catch (err) {
    console.error("[VibeTrace] cannot write .env.local:", err)
  }
  return { vars: merged, changed: true, viteProxyChanged, workerProxyChanged }
}

async function ensureMemoryWorker(
  spawnEnv: Record<string, string> = {},
  options: { restartIfRunning?: boolean } = {},
): Promise<void> {
  const healthUrl = `http://127.0.0.1:${MEMORY_WORKER_PORT}/health`
  const restartIfRunning = options.restartIfRunning ?? true
  try {
    const r = await fetch(healthUrl, { signal: AbortSignal.timeout(2000) })
    if (r.ok) {
      if (!restartIfRunning) {
        console.log(`[VibeTrace] memory-worker already running → :${MEMORY_WORKER_PORT}`)
        return
      }
      console.log(`[VibeTrace] restarting memory-worker to reload .env.local → :${MEMORY_WORKER_PORT}`)
      await killListenerOnPort(MEMORY_WORKER_PORT)
      await new Promise((resolve) => setTimeout(resolve, 800))
    }
  } catch { /* not running */ }

  const script = path.join(PROJECT_ROOT, "memory_worker", "server.py")
  if (!existsSync(script)) {
    console.warn("[VibeTrace] memory_worker/server.py not found, skip")
    return
  }

  const py = resolvePython()
  console.log(`[VibeTrace] starting memory-worker (${py}) → :${MEMORY_WORKER_PORT}`)
  memoryWorkerProc = spawn(py, [script], {
    cwd: PROJECT_ROOT,
    detached: true,
    stdio: "ignore",
    shell: isWin,
    env: { ...process.env, ...spawnEnv },
  })
  memoryWorkerProc.unref()

  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 500))
    try {
      const r = await fetch(healthUrl, { signal: AbortSignal.timeout(1500) })
      if (r.ok) {
        console.log(`[VibeTrace] memory-worker ready`)
        return
      }
    } catch { /* retry */ }
  }
  console.warn(`[VibeTrace] memory-worker not ready. Manual: npm run worker:py`)
}

async function waitForPort(port: number, ms = 40_000): Promise<boolean> {
  const end = Date.now() + ms
  while (Date.now() < end) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1000) })
      if (r.ok || r.status < 500) return true
    } catch { /* not ready */ }
    await new Promise(r => setTimeout(r, 600))
  }
  return false
}

async function startDevServer(serverUrl: URL): Promise<void> {
  if (devStarted) return
  devStarted = true

  if (!existsSync(path.join(PROJECT_ROOT, "node_modules"))) {
    console.error(`[VibeTrace] Install dependencies first: cd "${PROJECT_ROOT}" && npm install`)
    return
  }

  const { vars: envVars, viteProxyChanged, workerProxyChanged } = writeEnvLocal(serverUrl)
  await ensureMemoryWorker(envVars, { restartIfRunning: workerProxyChanged })

  const uiUrl = `http://127.0.0.1:${VITE_PORT}/`
  const viteEnv = { ...process.env, ...envVars }
  const proxyTarget = (envVars.OPENCODE_PROXY_TARGET ?? envVars.OPENCODE_BASE ?? "").trim()

  let viteRunning = false
  try {
    const r = await fetch(uiUrl, { signal: AbortSignal.timeout(800) })
    viteRunning = r.ok || r.status < 500
  } catch { /* not running */ }

  // Only restart when proxy/auth actually changed — avoid killing a healthy manual `npm run dev`.
  if (viteRunning && viteProxyChanged) {
    console.log(
      `[VibeTrace] restarting Vite to apply .env.local (OpenCode → ${proxyTarget || "—"}) → :${VITE_PORT}`,
    )
    await killListenerOnPort(VITE_PORT)
    await new Promise((r) => setTimeout(r, 1000))
    viteRunning = false
  } else if (viteRunning) {
    console.log(`[VibeTrace] Vite already running with current proxy → :${VITE_PORT}`)
    openBrowser(uiUrl)
    return
  }

  console.log(`[VibeTrace] starting Vite (${resolveNpm()} run dev) …`)
  viteProc = spawn(resolveNpm(), ["run", "dev"], {
    cwd: PROJECT_ROOT,
    detached: true,
    stdio: "ignore",
    shell: isWin,
    env: viteEnv,
  })
  viteProc.unref()

  const ready = await waitForPort(VITE_PORT, 40_000)
  if (ready) {
    console.log(`[VibeTrace] ready → ${uiUrl}`)
    openBrowser(uiUrl)
  } else {
    console.error(`[VibeTrace] Vite not ready. Manual: cd "${PROJECT_ROOT}" && npm run dev`)
  }
}

const server = async ({ serverUrl }: { serverUrl: URL }) => {
  console.log(`[VibeTrace] OpenCode API → ${serverUrl}`)
  console.log(`[VibeTrace] platform → ${process.platform}, project → ${PROJECT_ROOT}`)
  void startDevServer(serverUrl)
  return {}
}

export default { id: "vibetrace-ui", server }
