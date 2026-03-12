import { useMemo, useCallback, useEffect } from "react"
import ReactFlow, {
  Node, Edge, Background, Controls, MiniMap,
  useNodesState, useEdgesState,
} from "reactflow"
import "reactflow/dist/style.css"
import { useCockpitStore } from "../../store/cockpitStore"
import type { Session } from "../../types"

const STATUS_COLORS: Record<string, string> = {
  idle: "#10B981",
  busy: "#F59E0B",
  error: "#EF4444",
}

const AGENT_BG: Record<string, string> = {
  build:   "#EFF6FF",
  general: "#F5F3FF",
  explore: "#F9FAFB",
  plan:    "#ECFEFF",
  unknown: "#F9FAFB",
}

const AGENT_BORDER: Record<string, string> = {
  build:   "#93C5FD",
  general: "#C4B5FD",
  explore: "#D1D5DB",
  plan:    "#67E8F9",
  unknown: "#D1D5DB",
}

/** Strip " (@xxx subagent)" suffix from OpenCode-generated titles */
function shortTitle(s: Session): string {
  const title = s.title?.replace(/\s*\(@\w+\s+subagent\)\s*$/, "").trim()
  if (title && title !== `New session` && !title.startsWith("New session -")) {
    return title.length > 28 ? title.slice(0, 26) + "…" : title
  }
  return s.agent !== "unknown" ? s.agent : s.id.slice(0, 12)
}

function buildGraph(sessions: Record<string, Session>) {
  const nodes: Node[] = []
  const edges: Edge[] = []
  const sessionList = Object.values(sessions)

  // BFS to assign depth
  const depth: Record<string, number> = {}
  const roots = sessionList.filter((s) => !s.parentId)
  const queue = [...roots.map((s) => ({ id: s.id, d: 0 }))]
  while (queue.length) {
    const { id, d } = queue.shift()!
    depth[id] = d
    const s = sessions[id]
    if (s) for (const c of s.children) queue.push({ id: c, d: d + 1 })
  }
  // Any session not reached (parentId points to missing session) gets depth 0
  sessionList.forEach((s) => { if (depth[s.id] === undefined) depth[s.id] = 0 })

  const colIdx: Record<number, number> = {}
  sessionList.forEach((s) => {
    const d = depth[s.id] ?? 0
    const idx = colIdx[d] ?? 0
    colIdx[d] = idx + 1
    const x = d * 240
    const y = idx * 120

    const agentKey = s.agent in AGENT_BG ? s.agent : "unknown"
    const isBusy = s.status === "busy"

    nodes.push({
      id: s.id,
      type: "default",
      position: { x, y },
      data: {
        label: (
          <div style={{ lineHeight: 1.4 }}>
            <div style={{ fontWeight: 600, fontSize: 11, color: "#1F2937" }}>
              {shortTitle(s)}
            </div>
            <div style={{ fontSize: 10, color: "#6B7280", marginTop: 2 }}>
              {s.agent} · {s.status}
            </div>
          </div>
        ),
      },
      style: {
        background: AGENT_BG[agentKey],
        border: `2px solid ${isBusy ? STATUS_COLORS.busy : AGENT_BORDER[agentKey]}`,
        borderRadius: 8,
        fontFamily: "Inter, system-ui, sans-serif",
        width: 180,
        padding: "8px 12px",
        boxShadow: isBusy ? `0 0 0 3px ${STATUS_COLORS.busy}33` : "none",
      },
    })

    if (s.parentId) {
      edges.push({
        id: `${s.parentId}→${s.id}`,
        source: s.parentId,
        target: s.id,
        animated: isBusy,
        style: { stroke: "#9CA3AF", strokeWidth: 1.5 },
        markerEnd: { type: "arrowclosed" as const, color: "#9CA3AF" },
      })
    }
  })

  return { nodes, edges }
}

interface Props {
  onSelectSession: (id: string) => void
  selectedId?: string
}

export function AgentGraph({ onSelectSession, selectedId }: Props) {
  const sessions = useCockpitStore((s) => s.sessions)
  const { nodes: freshNodes, edges: freshEdges } = useMemo(
    () => buildGraph(sessions),
    [sessions]
  )

  const [nodes, setNodes, onNodesChange] = useNodesState(freshNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(freshEdges)

  // Sync whenever sessions change — ReactFlow state doesn't auto-update from useMemo
  useEffect(() => {
    setNodes(freshNodes)
    setEdges(freshEdges)
  }, [freshNodes, freshEdges, setNodes, setEdges])

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    onSelectSession(node.id)
  }, [onSelectSession])

  if (Object.keys(sessions).length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-gray-400">
        No agents yet. Start an OpenCode session to see activity here.
      </div>
    )
  }

  return (
    <div className="h-full w-full">
      <ReactFlow
        nodes={nodes.map((n) => ({
          ...n,
          selected: n.id === selectedId,
        }))}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        nodesDraggable={true}
      >
        <Background color="#F3F4F6" gap={20} />
        <Controls showInteractive={false} />
        <MiniMap
          nodeColor={(n) => {
            const s = sessions[n.id]
            return STATUS_COLORS[s?.status ?? "idle"] ?? "#9CA3AF"
          }}
          style={{ background: "#F9FAFB", border: "1px solid #E5E7EB" }}
        />
      </ReactFlow>
    </div>
  )
}
