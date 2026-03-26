import { useEffect, useMemo, useRef, useState } from "react"
import { useCockpitStore } from "../../store/cockpitStore"
import { api } from "../../services/api"
import { contourDensity } from "d3-contour"
import type { OverviewAgentNode, OverviewMessageNode, OverviewAgentEdge } from "../../types"

/** Message 类型调色盘（固定，不随 agent 变化） */
const MESSAGE_TYPE_COLOR: Record<string, string> = {
  text: "#3B82F6",
  reasoning: "#8B5CF6",
  compaction: "#F59E0B",
  tool: "#10B981",
  "step-start": "#6366F1",
  "step-finish": "#14B8A6",
  user: "#0EA5E9",
  assistant: "#EC4899",
  unknown: "#9CA3AF",
}

/** Agent 颜色：与 MESSAGE_TYPE_COLOR 完全不重合，避免和图例混淆 */
const AGENT_COLOR: Record<string, string> = {
  build: "#0D9488",
  plan: "#B45309",
  general: "#1D4ED8",
  explore: "#6D28D9",
  unknown: "#64748B",
}

const STATUS_HALO: Record<string, string> = {
  idle: "#64748B",
  busy: "#F59E0B",
  retrying: "#F59E0B",
  pending: "#6366F1",
  error: "#EF4444",
}

/** 图例：不展示 text、tool，只保留 reasoning / user / assistant / compaction */
const MESSAGE_LEGEND_ORDER = ["reasoning", "user", "assistant", "compaction"] as const

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))

function hexToRgb(hex: string): [number, number, number] {
  const h = (hex || "").replace("#", "").trim()
  if (h.length !== 6) return [156, 163, 175]
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return [156, 163, 175]
  return [r, g, b]
}

function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, "0")
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

function blendColorToWhite(baseHex: string, toWhiteRatio: number): string {
  const ratio = clamp(toWhiteRatio, 0, 1)
  const [r, g, b] = hexToRgb(baseHex)
  const nr = r + (255 - r) * ratio
  const ng = g + (255 - g) * ratio
  const nb = b + (255 - b) * ratio
  return rgbToHex(nr, ng, nb)
}

interface Props {
  onSelectSession: (id: string) => void
  selectedId?: string
  /** 与左侧 workspace 联动：由 App 传入当前选中的 directory，Overview 只展示该目录 */
  directory?: string
}

/** 一个 agent 节点：在当前 directory 下该 agent 对应至少一个 session */
interface AgentNode extends OverviewAgentNode {}
interface MessageNode extends OverviewMessageNode {}
/** 缓存版本：带 keyword/keywordWeight 的协议为 v2，旧缓存不命中以强制重拉 */
const OVERVIEW_CACHE_VERSION = 2
const OVERVIEW_INIT_CACHE = new Map<
  string,
  { agentNodes: AgentNode[]; messageNodes: MessageNode[]; agentEdges: OverviewAgentEdge[]; _version?: number }
>()

/**
 * OverviewPanel：按 directory 展示「该 directory 下出现过的 agent」。
 *
 * - 数据来源：store.sessions（SSE snapshot）。session 必有 agent、directory 字段。
 * - 从 sessions 得到全部 directory，选一个 directory 后调用后端 init 投影接口。
 * - 节点是 agent（一个 agent 一个节点），x/y 由后端 embedding + 降维算法返回。
 * - 点击节点后用后端返回的 sessionId 跳转 Agent tab。
 */
export function OverviewPanel({ onSelectSession, selectedId, directory: directoryFromParent }: Props) {
  const connected = useCockpitStore((s) => s.connected)
  const sessions = useCockpitStore((s) => s.sessions)
  const overviewIncrementalEvent = useCockpitStore((s) => s.overviewIncrementalEvent)
  const [agentNodes, setAgentNodes] = useState<AgentNode[]>([])
  const [messageNodes, setMessageNodes] = useState<MessageNode[]>([])
  const [agentEdges, setAgentEdges] = useState<OverviewAgentEdge[]>([])
  const [loadingProjection, setLoadingProjection] = useState(false)
  const [projectionError, setProjectionError] = useState<string | null>(null)
  const [selectedPoint, setSelectedPoint] = useState<
    { kind: "agent"; node: AgentNode } | { kind: "message"; node: MessageNode } | null
  >(null)
  const [embeddingDetailExpanded, setEmbeddingDetailExpanded] = useState(false)
  useEffect(() => { setEmbeddingDetailExpanded(false) }, [selectedPoint])
  const [nowMs, setNowMs] = useState(() => Date.now())
  const initializedRef = useRef(false)
  const messageNodeMapRef = useRef<Map<string, MessageNode>>(new Map())

  const sessionList = useMemo(() => Object.values(sessions), [sessions])

  const directories = useMemo(() => {
    const dirs = [...new Set(sessionList.map((s) => s.directory).filter(Boolean))] as string[]
    return dirs.sort()
  }, [sessionList])

  const [selectedDirectory, setSelectedDirectory] = useState<string>("")

  const effectiveDirectory = directoryFromParent ?? (selectedDirectory || (directories.length > 0 ? directories[0] : ""))
  const [lastIncrementalAdded, setLastIncrementalAdded] = useState(0)
  const [refreshTrigger, setRefreshTrigger] = useState(0)
  const prevSessionCountRef = useRef<number>(0)

  const sessionCountInDirectory = useMemo(
    () => (effectiveDirectory ? sessionList.filter((s) => (s.directory || "").replace(/\\/g, "/") === effectiveDirectory.replace(/\\/g, "/")).length : 0),
    [sessionList, effectiveDirectory],
  )

  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 15000)
    return () => clearInterval(t)
  }, [])

  // 当前 directory 下 session 数变多（新 session 出现）时清前端缓存并重拉 init，避免一直用旧图
  useEffect(() => {
    if (!effectiveDirectory || sessionCountInDirectory === 0) return
    const prev = prevSessionCountRef.current
    prevSessionCountRef.current = sessionCountInDirectory
    if (prev > 0 && sessionCountInDirectory > prev) {
      OVERVIEW_INIT_CACHE.delete(effectiveDirectory)
      setRefreshTrigger((t) => t + 1)
    }
  }, [effectiveDirectory, sessionCountInDirectory])

  // 初始化：仍使用现有全量布局算法，但仅在切 directory 时执行
  useEffect(() => {
    if (!effectiveDirectory) {
      setAgentNodes([])
      setMessageNodes([])
      setAgentEdges([])
      setLastIncrementalAdded(0)
      initializedRef.current = false
      messageNodeMapRef.current = new Map()
      return
    }
    const skipCache = refreshTrigger > 0
    if (skipCache) OVERVIEW_INIT_CACHE.delete(effectiveDirectory)
    const cached = skipCache ? undefined : OVERVIEW_INIT_CACHE.get(effectiveDirectory)
    if (cached && (cached._version ?? 0) >= OVERVIEW_CACHE_VERSION) {
      setAgentNodes(cached.agentNodes)
      setMessageNodes(cached.messageNodes)
      setAgentEdges(cached.agentEdges)
      setLastIncrementalAdded(0)
      messageNodeMapRef.current = new Map(cached.messageNodes.map((m) => [m.nodeId, m]))
      initializedRef.current = true
      setProjectionError(null)
      setLoadingProjection(false)
      return
    }
    let cancelled = false
    setLoadingProjection(true)
    setProjectionError(null)
    const run = (mode: "dashscope" | "mock" = "dashscope") => {
      api.overview
        .projectionInit(
          effectiveDirectory,
          {
            withEmbedding: true,
            withPosition: true,
            embeddingMode: mode,
            embeddingModel: mode === "dashscope" ? "text-embedding-v3" : undefined,
            reductionAlgo: "mds",
            messageRadius: 0.35,
            clearCache: skipCache,
          },
          mode === "dashscope" ? 120000 : 150000,
        )
        .then((resp) => {
          const msgs = (resp.messageNodes ?? resp.nodes ?? []) as MessageNode[]
          console.info("[overview.init] response", {
            directory: effectiveDirectory,
            messageNodeCount: msgs.length,
            firstMessageHasKeyword: msgs[0] ? { keyword: msgs[0].keyword, keywordWeight: msgs[0].keywordWeight } : null,
            debug: resp.debug,
          })
          if (!cancelled) {
            const ag = (resp.agentNodes ?? []) as AgentNode[]
            setAgentNodes(ag)
            setMessageNodes(msgs)
            setAgentEdges(resp.agentEdges ?? [])
            setLastIncrementalAdded(0)
            OVERVIEW_INIT_CACHE.set(effectiveDirectory, {
              agentNodes: ag,
              messageNodes: msgs,
              agentEdges: resp.agentEdges ?? [],
              _version: OVERVIEW_CACHE_VERSION,
            })
            messageNodeMapRef.current = new Map(msgs.map((m) => [m.nodeId, m]))
            initializedRef.current = true
            if (skipCache) setRefreshTrigger(0)
          }
        })
        .catch((e) => {
          if (cancelled) return
          setProjectionError(e?.message ?? "projection init failed")
          // 当前使用 DashScope；需要兜底 mock 时可恢复 fallback 逻辑
          return Promise.resolve()
        })
        .finally(() => {
          if (!cancelled) setLoadingProjection(false)
        })
    }
    run("dashscope")
    return () => {
      cancelled = true
    }
  }, [effectiveDirectory, refreshTrigger])

  // 增量：后端在 message.updated 后通过 SSE 主动推送新点，这里只消费推送并追加到本地。
  useEffect(() => {
    if (!effectiveDirectory || !initializedRef.current || !overviewIncrementalEvent) return
    if (overviewIncrementalEvent.directory !== effectiveDirectory) return
    const latestMessages = (overviewIncrementalEvent.nodes ?? []) as MessageNode[]
    const known = messageNodeMapRef.current
    const appended: MessageNode[] = []
    for (const m of latestMessages) {
      if (known.has(m.nodeId)) continue
      known.set(m.nodeId, m)
      appended.push(m)
    }
    setLastIncrementalAdded(appended.length)
    if (appended.length > 0) {
      console.info("[overview.incremental] appended to panel", {
        directory: effectiveDirectory,
        appendedCount: appended.length,
        nodes: appended.map((n) => ({
          nodeId: n.nodeId,
          messageId: n.messageId,
          sessionId: n.sessionId,
          agent: n.agent,
          type: n.type,
          x: n.x,
          y: n.y,
        })),
      })
      setMessageNodes((prev) => [...prev, ...appended])
      const cached = OVERVIEW_INIT_CACHE.get(effectiveDirectory)
      if (cached) {
        OVERVIEW_INIT_CACHE.set(effectiveDirectory, {
          ...cached,
          messageNodes: [...cached.messageNodes, ...appended],
        })
      }
    }
  }, [overviewIncrementalEvent, effectiveDirectory])

  const selectedSessionIdForHighlight = useMemo(() => {
    for (const n of agentNodes) {
      if (n.sessionId === selectedId) return n.sessionId
    }
    for (const n of messageNodes) {
      if (n.sessionId === selectedId) return n.sessionId
    }
    return undefined
  }, [agentNodes, messageNodes, selectedId])

  const liveStatusByAgent = useMemo(() => {
    const byAgent = new Map<string, Array<string>>()
    for (const s of sessionList) {
      if ((s.directory || "") !== effectiveDirectory) continue
      const list = byAgent.get(s.agent) ?? []
      list.push(s.status || "idle")
      byAgent.set(s.agent, list)
    }
    const out = new Map<string, "idle" | "busy" | "error">()
    for (const [agent, statuses] of byAgent.entries()) {
      if (statuses.includes("busy")) out.set(agent, "busy")
      else if (statuses.includes("error")) out.set(agent, "error")
      else out.set(agent, "idle")
    }
    return out
  }, [sessionList, effectiveDirectory])

  const width = 800
  const height = 320

  const { projectedMessages, projectedAgents } = useMemo(() => {
    const safePadding = 36 // 覆盖大圆半径 + 交互余量，确保不会贴边或越界
    const plotWidth = Math.max(1, width - safePadding * 2)
    const plotHeight = Math.max(1, height - safePadding * 2)

    const rawPoints = [...agentNodes, ...messageNodes].map((n) => ({
      x: Number.isFinite(n.x) ? (n.x as number) : 0,
      y: Number.isFinite(n.y) ? (n.y as number) : 0,
    }))

    const xs = rawPoints.map((p) => p.x)
    const ys = rawPoints.map((p) => p.y)
    let minX = xs.length ? Math.min(...xs) : -1
    let maxX = xs.length ? Math.max(...xs) : 1
    let minY = ys.length ? Math.min(...ys) : -1
    let maxY = ys.length ? Math.max(...ys) : 1

    if (maxX - minX < 1e-6) {
      minX -= 1
      maxX += 1
    }
    if (maxY - minY < 1e-6) {
      minY -= 1
      maxY += 1
    }

    // 给原始布局域加轻微边距，减少点拥挤在边缘时的裁切
    const domainPadRatio = 0.08
    const spanX = maxX - minX
    const spanY = maxY - minY
    minX -= spanX * domainPadRatio
    maxX += spanX * domainPadRatio
    minY -= spanY * domainPadRatio
    maxY += spanY * domainPadRatio

    const project = (xRaw?: number, yRaw?: number) => {
      const x = Number.isFinite(xRaw) ? (xRaw as number) : 0
      const y = Number.isFinite(yRaw) ? (yRaw as number) : 0
      const nx = (x - minX) / ((maxX - minX) || 1)
      const ny = (y - minY) / ((maxY - minY) || 1)
      return {
        px: clamp(safePadding + nx * plotWidth, safePadding, width - safePadding),
        py: clamp(safePadding + ny * plotHeight, safePadding, height - safePadding),
      }
    }

    const projectedMessages = messageNodes
      .map((n) => ({
        ...n,
        ...project(n.x, n.y),
      }))
      .sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0))

    const projectedAgents = agentNodes.map((n) => ({
      ...n,
      ...project(n.x, n.y),
    }))

    return { projectedMessages, projectedAgents }
  }, [agentNodes, messageNodes, width, height])

  const centerByAgent = useMemo(() => {
    const m = new Map<string, { x: number; y: number }>()
    for (const a of projectedAgents) m.set(a.agent, { x: a.px, y: a.py })
    return m
  }, [projectedAgents])

  // 前端用 d3-contour 的 contourDensity 做高斯核密度估计（KDE），按 agent 分组画等高线
  const densityContours = useMemo(() => {
    if (projectedMessages.length < 3) return [] as Array<{ agent: string; path: string; color: string }>
    const groups = new Map<string, Array<{ x: number; y: number }>>()
    for (const n of projectedMessages) {
      const g = groups.get(n.agent) ?? []
      g.push({ x: n.px, y: n.py })
      groups.set(n.agent, g)
    }
    const out: Array<{ agent: string; path: string; color: string }> = []
    for (const [agent, pts] of groups.entries()) {
      if (pts.length < 3) continue
      // 等高线层数按该 agent 的点数动态：点越多层数越多，便于区分密度
      const numLevels = Math.max(3, Math.min(12, Math.floor(Math.sqrt(pts.length)) + 2))
      const density = contourDensity<{ x: number; y: number }>()
        .x((d) => d.x)
        .y((d) => d.y)
        .size([width, height])
        .bandwidth(28)
        .thresholds(numLevels)
      const cs = density(pts)
      for (const c of cs) {
        const path = (c.coordinates || [])
          .map((poly) =>
            poly
              .map((ring) =>
                ring
                  .map((p, i) => `${i === 0 ? "M" : "L"}${p[0]},${p[1]}`)
                  .join(" ") + " Z",
              )
              .join(" "),
          )
          .join(" ")
        if (path) out.push({ agent, path, color: AGENT_COLOR[agent] ?? AGENT_COLOR.unknown })
      }
    }
    return out
  }, [projectedMessages])

  if (!connected) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-gray-400">
        正在连接后端…
      </div>
    )
  }

  if (directories.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-gray-400">
        暂无 session，无法解析 directory。在 OpenCode 里产生会话后此处会按 directory 展示 agent。
      </div>
    )
  }

  return (
    <div className="h-full w-full flex flex-col gap-2">
      <div className="flex-1 border border-gray-100 rounded-lg bg-white overflow-hidden flex items-center justify-center">
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-full">
          {loadingProjection ? (
            <text x={width / 2} y={height / 2} textAnchor="middle" fontSize={12} fill="#9CA3AF">
              正在计算初始化投影…
            </text>
          ) : agentNodes.length === 0 && messageNodes.length === 0 ? (
            <text x={width / 2} y={height / 2} textAnchor="middle" fontSize={12} fill="#9CA3AF">
              该 directory 下暂无 session
            </text>
          ) : (
            <>
              {/* 箭头标记：父 agent → subagent 连线末端 */}
              <defs>
                <marker
                  id="overview-edge-arrow"
                  markerWidth={8}
                  markerHeight={6}
                  refX={7}
                  refY={3}
                  orient="auto"
                >
                  <path d="M0,0 L8,3 L0,6 Z" fill="#60A5FA" opacity={0.8} />
                </marker>
              </defs>
              {/* KDE 等高线层 */}
              {densityContours.map((c, idx) => (
                <path
                  key={`${c.agent}-${idx}`}
                  d={c.path}
                  fill={c.color}
                  fillOpacity={0.06}
                  stroke={c.color}
                  strokeOpacity={0.12}
                  strokeWidth={0.8}
                />
              ))}

              {/* agent 父子连线层：父 agent → subagent，末端带箭头 */}
              {agentEdges.map((e, idx) => {
                const s = centerByAgent.get(e.sourceAgent)
                const t = centerByAgent.get(e.targetAgent)
                if (!s || !t) return null
                return (
                  <g key={`${e.sourceAgent}-${e.targetAgent}-${idx}`}>
                    <line
                      x1={s.x}
                      y1={s.y}
                      x2={t.x}
                      y2={t.y}
                      stroke="#60A5FA"
                      strokeWidth={1.5}
                      opacity={0.6}
                      markerEnd="url(#overview-edge-arrow)"
                    />
                    <text x={(s.x + t.x) / 2} y={(s.y + t.y) / 2 - 4} fontSize={9} fill="#93C5FD" textAnchor="middle">
                      {e.count}
                    </text>
                  </g>
                )
              })}

              {/* message 小点层：按类型用 MESSAGE_TYPE_COLOR；关键词按权值阈值展示，字号与权值成比例 */}
              {projectedMessages.map((n, idx) => {
                const messageType = (n.type || n.role || "unknown").toString().toLowerCase()
                const baseColor = MESSAGE_TYPE_COLOR[messageType] ?? MESSAGE_TYPE_COLOR.unknown
                const selected = n.sessionId === selectedSessionIdForHighlight
                const r = selected ? 4 : 2.6
                const ageMin = n.timestamp ? Math.max(0, (nowMs - n.timestamp) / 60000) : 120
                const ageRatio = clamp(ageMin / 90, 0, 1)
                const toWhiteRatio = Math.min(0.4, 0.08 + ageRatio * 0.32)
                const fill = blendColorToWhite(baseColor, toWhiteRatio)
                const opacity = clamp(0.92 - ageRatio * 0.15, 0.72, 0.95)
                const weight = Number(n.keywordWeight) || 0
                const keywordThreshold = 0.35
                const hasKeyword = n.keyword != null && String(n.keyword).trim() !== ""
                const showKeyword = hasKeyword && weight >= keywordThreshold
                const keywordFontSize = Math.max(8, 8 + weight * 8)
                const uniqueKey = `${n.nodeId}-${n.sessionId}-${n.messageId}-${idx}`
                return (
                  <g
                    key={uniqueKey}
                    transform={`translate(${n.px},${n.py})`}
                    onClick={() => {
                      onSelectSession(n.sessionId)
                      setSelectedPoint({ kind: "message", node: n })
                    }}
                    style={{ cursor: "pointer" }}
                  >
                    <circle
                      r={r}
                      fill={fill}
                      opacity={opacity}
                      stroke={selected ? "#111827" : "none"}
                      strokeWidth={1}
                      style={{ transition: "all 700ms ease" }}
                    />
                    {showKeyword && (
                      <text
                        textAnchor="middle"
                        y={-r - 4}
                        fontSize={keywordFontSize}
                        fill="#374151"
                        fontWeight={500}
                        style={{ pointerEvents: "none" }}
                      >
                        {n.keyword}
                      </text>
                    )}
                    <title>
                      {n.agent} · message · {messageType}
                      {"\n"}
                      session: {n.sessionId}
                      {"\n"}
                      message: {n.messageId}
                      {"\n"}
                      age(min): {ageMin.toFixed(1)}
                      {n.keyword ? `\nkeyword: ${n.keyword} (weight: ${weight.toFixed(2)})` : ""}
                    </title>
                  </g>
                )
              })}

              {/* agent 大点层：外圈光环更大，名字在节点下方 */}
              {projectedAgents.map((n) => {
                const fill = AGENT_COLOR[n.agent] ?? AGENT_COLOR.unknown
                const liveStatus = liveStatusByAgent.get(n.agent) ?? n.status
                const halo = STATUS_HALO[liveStatus] ?? "#9CA3AF"
                const selected = n.sessionId === selectedSessionIdForHighlight
                const haloR = 44
                const innerR = 26
                const labelDy = innerR + 14
                return (
                  <g
                    key={n.nodeId}
                    transform={`translate(${n.px},${n.py})`}
                    onClick={() => {
                      onSelectSession(n.sessionId)
                      setSelectedPoint({ kind: "agent", node: n })
                    }}
                    style={{ cursor: "pointer" }}
                  >
                    <circle r={haloR} fill="none" stroke={halo} strokeWidth={2} opacity={0.35} style={{ transition: "all 280ms ease" }} />
                    <circle r={innerR} fill={fill} stroke={selected ? "#111827" : "#E5E7EB"} strokeWidth={selected ? 2.5 : 1.5} style={{ transition: "all 280ms ease" }} />
                    <text
                      textAnchor="middle"
                      y={labelDy}
                      fontSize={10}
                      fontWeight={600}
                      fill={fill}
                      style={{ pointerEvents: "none" }}
                    >
                      {n.agent}
                    </text>
                    <title>
                      {n.agent} · status: {liveStatus}
                      {"\n"}
                      initSource: {n.initSource}
                      {"\n"}
                      sessionCount: {n.sessionCount}
                    </title>
                  </g>
                )
              })}
            </>
          )}
        </svg>
      </div>
      {selectedPoint && (
        <div className="border border-blue-200 bg-blue-50 rounded-lg p-3 text-xs text-gray-700">
          <div className="text-[10px] text-blue-400 uppercase tracking-widest mb-1">
            {selectedPoint.kind === "agent" ? "Agent Init" : "消息原文"}
          </div>
          <div className="font-mono text-[11px] text-gray-500 mb-1">
            {selectedPoint.kind === "agent"
              ? `${selectedPoint.node.agent} · ${(liveStatusByAgent.get(selectedPoint.node.agent) ?? selectedPoint.node.status)} · ${selectedPoint.node.sessionId}`
              : `${selectedPoint.node.agent} · ${selectedPoint.node.sessionId} · ${(selectedPoint.node as MessageNode).messageId}`}
          </div>
          <pre className={`whitespace-pre-wrap break-words overflow-y-auto bg-white border border-blue-100 rounded p-2 text-[11px] ${!embeddingDetailExpanded ? "max-h-40" : ""}`}>
            {selectedPoint.node.embeddingInput}
          </pre>
          {(selectedPoint.node.embeddingInput?.length ?? 0) > 200 && (
            <button
              type="button"
              onClick={() => setEmbeddingDetailExpanded((e) => !e)}
              className="mt-1 text-[10px] text-blue-500 hover:underline"
            >
              {embeddingDetailExpanded ? "收起" : "展开全部"}
            </button>
          )}
        </div>
      )}
      {projectionError && <div className="text-[10px] text-amber-600">投影初始化失败: {projectionError}</div>}

      {/* Legend: message 类型调色盘 */}
      <div className="flex items-center gap-3 text-[10px] text-gray-400 flex-wrap px-1 py-1">
        {MESSAGE_LEGEND_ORDER.map((type) => (
          <span key={type} className="inline-flex items-center gap-1">
            <span
              className="inline-block w-2 h-2 rounded-full"
              style={{ backgroundColor: MESSAGE_TYPE_COLOR[type] }}
            />
            <span>{type}</span>
          </span>
        ))}
        <button
          type="button"
          onClick={() => setRefreshTrigger((t) => t + 1)}
          disabled={loadingProjection || !effectiveDirectory}
          className="ml-auto text-gray-400 hover:text-blue-500 disabled:opacity-50 font-mono"
          title="清缓存并重新计算投影"
        >
          刷新
        </button>
        <span className="font-mono text-gray-300">{messageNodes.length} pts · {agentNodes.length} agents</span>
      </div>
    </div>
  )
}
