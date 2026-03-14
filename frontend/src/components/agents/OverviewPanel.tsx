import { useEffect, useMemo, useRef, useState } from "react"
import { useCockpitStore } from "../../store/cockpitStore"
import { api } from "../../services/api"
import { contourDensity } from "d3-contour"
import type { OverviewAgentNode, OverviewMessageNode, OverviewAgentEdge } from "../../types"

/** 已知 agent 的展示颜色，其余用 unknown；agent 类型完全从 session.agent 读取，不写死列表 */
const AGENT_COLOR: Record<string, string> = {
  build: "#3B82F6",
  plan: "#06B6D4",
  general: "#8B5CF6",
  explore: "#6B7280",
  unknown: "#9CA3AF",
}

const STATUS_HALO: Record<string, string> = {
  idle: "#10B981",
  busy: "#F59E0B",
  error: "#EF4444",
}

interface Props {
  onSelectSession: (id: string) => void
  selectedId?: string
}

/** 一个 agent 节点：在当前 directory 下该 agent 对应至少一个 session */
interface AgentNode extends OverviewAgentNode {}
interface MessageNode extends OverviewMessageNode {}

/**
 * OverviewPanel：按 directory 展示「该 directory 下出现过的 agent」。
 *
 * - 数据来源：store.sessions（SSE snapshot）。session 必有 agent、directory 字段。
 * - 从 sessions 得到全部 directory，选一个 directory 后调用后端 init 投影接口。
 * - 节点是 agent（一个 agent 一个节点），x/y 由后端 embedding + 降维算法返回。
 * - 点击节点后用后端返回的 sessionId 跳转 Agent tab。
 */
export function OverviewPanel({ onSelectSession, selectedId }: Props) {
  const connected = useCockpitStore((s) => s.connected)
  const sessions = useCockpitStore((s) => s.sessions)
  const overviewTick = useCockpitStore((s) => s.overviewTick)
  const [agentNodes, setAgentNodes] = useState<AgentNode[]>([])
  const [messageNodes, setMessageNodes] = useState<MessageNode[]>([])
  const [agentEdges, setAgentEdges] = useState<OverviewAgentEdge[]>([])
  const [loadingProjection, setLoadingProjection] = useState(false)
  const [projectionError, setProjectionError] = useState<string | null>(null)
  const [selectedPoint, setSelectedPoint] = useState<
    { kind: "agent"; node: AgentNode } | { kind: "message"; node: MessageNode } | null
  >(null)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const initializedRef = useRef(false)
  const messageNodeMapRef = useRef<Map<string, MessageNode>>(new Map())

  const sessionList = useMemo(() => Object.values(sessions), [sessions])

  const directories = useMemo(() => {
    const dirs = [...new Set(sessionList.map((s) => s.directory).filter(Boolean))] as string[]
    return dirs.sort()
  }, [sessionList])

  const [selectedDirectory, setSelectedDirectory] = useState<string>("")

  const effectiveDirectory = selectedDirectory || (directories.length > 0 ? directories[0] : "")

  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 15000)
    return () => clearInterval(t)
  }, [])

  // 初始化：仍使用现有全量布局算法，但仅在切 directory 时执行
  useEffect(() => {
    if (!effectiveDirectory) {
      setAgentNodes([])
      setMessageNodes([])
      setAgentEdges([])
      initializedRef.current = false
      messageNodeMapRef.current = new Map()
      return
    }
    let cancelled = false
    setLoadingProjection(true)
    setProjectionError(null)
    const run = (mode: "hf" | "mock" = "hf") => {
      api.overview
        .projectionInit(
          effectiveDirectory,
          {
            withEmbedding: true,
            withPosition: true,
            embeddingMode: mode,
            reductionAlgo: "mds",
            messageRadius: 0.28,
          },
          mode === "hf" ? 1200000 : 150000,
        )
        .then((resp) => {
          console.info("[overview.init] response", {
            directory: effectiveDirectory,
            nodeCount: resp.nodes?.length ?? 0,
            agentNodeCount: resp.agentNodes?.length ?? 0,
            messageNodeCount: resp.messageNodes?.length ?? 0,
            edgeCount: resp.agentEdges?.length ?? 0,
            debug: resp.debug,
          })
          if (!cancelled) {
            const ag = (resp.agentNodes ?? []) as AgentNode[]
            const msgs = (resp.messageNodes ?? resp.nodes ?? []) as MessageNode[]
            setAgentNodes(ag)
            setMessageNodes(msgs)
            setAgentEdges(resp.agentEdges ?? [])
            messageNodeMapRef.current = new Map(msgs.map((m) => [m.nodeId, m]))
            initializedRef.current = true
          }
        })
        .catch((e) => {
          if (cancelled) return
          setProjectionError(e?.message ?? "projection init failed")
          // 暂时取消 mock 兜底，只发 hf 以观察真实耗时；需要兜底时再恢复: if (mode === "hf") return run("mock")
          return Promise.resolve()
        })
        .finally(() => {
          if (!cancelled) setLoadingProjection(false)
        })
    }
    run("hf")
    return () => {
      cancelled = true
    }
  }, [effectiveDirectory])

  // 增量：只追加新 message，不改变旧点
  useEffect(() => {
    if (!effectiveDirectory || !initializedRef.current) return
    let cancelled = false
    const timer = setTimeout(() => {
      api.overview
        .projectionIncremental(
          effectiveDirectory,
          {
            embeddingMode: "hf",
            embeddingModel: "BAAI/bge-m3",
            messageRadius: 0.28,
          },
          12000,
        )
        .then((resp) => {
          if (cancelled) return
          const latestMessages = (resp.addedMessageNodes ?? []) as MessageNode[]
          const known = messageNodeMapRef.current
          const appended: MessageNode[] = []
          for (const m of latestMessages) {
            if (known.has(m.nodeId)) continue
            known.set(m.nodeId, m)
            appended.push(m)
            console.info("[overview.incremental] add-point", {
              directory: effectiveDirectory,
              nodeId: m.nodeId,
              sessionId: m.sessionId,
              messageId: m.messageId,
              agent: m.agent,
              x: m.x,
              y: m.y,
              timestamp: m.timestamp,
            })
          }
          if (appended.length > 0) {
            setMessageNodes((prev) => [...prev, ...appended])
          }
        })
        .catch((e) => {
          console.warn("[overview.incremental] failed", e?.message ?? e)
        })
    }, 450)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [overviewTick, effectiveDirectory])

  const selectedSessionIdForHighlight = useMemo(() => {
    for (const n of agentNodes) {
      if (n.sessionId === selectedId) return n.sessionId
    }
    for (const n of messageNodes) {
      if (n.sessionId === selectedId) return n.sessionId
    }
    return undefined
  }, [agentNodes, messageNodes, selectedId])

  const width = 800
  const height = 320

  const projectedMessages = useMemo(() => {
    return messageNodes
      .map((n) => ({
      ...n,
      px: ((n.x ?? 0) + 1) * 0.5 * (width - 120) + 60,
      py: ((n.y ?? 0) + 1) * 0.5 * (height - 80) + 40,
      }))
      .sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0))
  }, [messageNodes])

  const projectedAgents = useMemo(() => {
    return agentNodes.map((n) => ({
      ...n,
      px: ((n.x ?? 0) + 1) * 0.5 * (width - 120) + 60,
      py: ((n.y ?? 0) + 1) * 0.5 * (height - 80) + 40,
    }))
  }, [agentNodes])

  const centerByAgent = useMemo(() => {
    const m = new Map<string, { x: number; y: number }>()
    for (const a of projectedAgents) m.set(a.agent, { x: a.px, y: a.py })
    return m
  }, [projectedAgents])

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
      const density = contourDensity<{ x: number; y: number }>()
        .x((d) => d.x)
        .y((d) => d.y)
        .size([width, height])
        .bandwidth(22)
        .thresholds(6)
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
    <div className="h-full w-full flex flex-col gap-3">
      <div className="flex items-center gap-3 text-[10px] text-gray-500 flex-wrap">
        <span className="uppercase tracking-widest text-gray-400">Overview</span>
        <span className="text-gray-400">按 directory 展示该目录下出现过的 agent</span>
        <label className="flex items-center gap-2">
          <span>Directory:</span>
          <select
            value={effectiveDirectory}
            onChange={(e) => setSelectedDirectory(e.target.value)}
            className="text-xs border border-gray-200 rounded px-2 py-1 bg-white min-w-[200px]"
          >
            {directories.map((d) => (
              <option key={d} value={d}>
                {d.length > 48 ? d.slice(0, 45) + "…" : d}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex-1 border border-gray-100 rounded bg-white overflow-hidden flex items-center justify-center">
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

              {/* agent 父子连线层 */}
              {agentEdges.map((e, idx) => {
                const s = centerByAgent.get(e.sourceAgent)
                const t = centerByAgent.get(e.targetAgent)
                if (!s || !t) return null
                return (
                  <g key={`${e.sourceAgent}-${e.targetAgent}-${idx}`}>
                    <line x1={s.x} y1={s.y} x2={t.x} y2={t.y} stroke="#60A5FA" strokeWidth={1.5} opacity={0.6} />
                    <text x={(s.x + t.x) / 2} y={(s.y + t.y) / 2 - 4} fontSize={9} fill="#93C5FD" textAnchor="middle">
                      {e.count}
                    </text>
                  </g>
                )
              })}

              {/* message 小点层（先画） */}
              {projectedMessages.map((n) => {
                const fill = AGENT_COLOR[n.agent] ?? AGENT_COLOR.unknown
                const selected = n.sessionId === selectedSessionIdForHighlight
                const r = selected ? 4 : 2.6
                const ageMin = n.timestamp ? Math.max(0, (nowMs - n.timestamp) / 60000) : 120
                const opacity = Math.max(0.16, Math.min(0.88, 0.88 - ageMin * 0.025))
                return (
                  <g
                    key={n.nodeId}
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
                    <title>
                      {n.agent} · message point
                      {"\n"}
                      session: {n.sessionId}
                      {"\n"}
                      message: {n.messageId}
                      {"\n"}
                      age(min): {ageMin.toFixed(1)}
                    </title>
                  </g>
                )
              })}

              {/* agent 大点层（后画，明显） */}
              {projectedAgents.map((n) => {
                const fill = AGENT_COLOR[n.agent] ?? AGENT_COLOR.unknown
                const halo = STATUS_HALO[n.status] ?? "#9CA3AF"
                const selected = n.sessionId === selectedSessionIdForHighlight
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
                    <circle r={30} fill="none" stroke={halo} strokeWidth={2} opacity={0.3} style={{ transition: "all 280ms ease" }} />
                    <circle r={22} fill={fill} stroke={selected ? "#111827" : "#E5E7EB"} strokeWidth={selected ? 2.5 : 1.5} style={{ transition: "all 280ms ease" }} />
                    <text
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fontSize={11}
                      fontWeight={700}
                      fill="#fff"
                      style={{ pointerEvents: "none" }}
                    >
                      {n.agent}
                    </text>
                    <title>
                      {n.agent} · status: {n.status}
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
            {selectedPoint.kind === "agent" ? "Agent Init Vector Input" : "Message Vector Input"}
          </div>
          <div className="font-mono text-[11px] text-gray-500 mb-1">
            {selectedPoint.kind === "agent"
              ? `${selectedPoint.node.agent} · ${selectedPoint.node.status} · ${selectedPoint.node.sessionId}`
              : `${selectedPoint.node.agent} · ${selectedPoint.node.sessionId} · ${selectedPoint.node.messageId}`}
          </div>
          <pre className="whitespace-pre-wrap break-words max-h-40 overflow-y-auto bg-white border border-blue-100 rounded p-2 text-[11px]">
            {selectedPoint.node.embeddingInput}
          </pre>
        </div>
      )}
      {projectionError && <div className="text-[10px] text-amber-600">投影初始化失败: {projectionError}</div>}
    </div>
  )
}
