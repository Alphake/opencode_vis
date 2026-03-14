import { useEffect, useMemo, useRef, useState } from "react"
import { select } from "d3-selection"
import { scaleLinear } from "d3-scale"
import { api } from "../../services/api"
import type { PartProjectionNode, PartProjectionResponse } from "../../types"
import { computeCoordinates, type LayoutAlgorithm } from "./projection/coordinateProjector"

const TYPE_COLOR: Record<string, string> = {
  text: "#60A5FA",
  reasoning: "#C084FC",
  tool: "#F59E0B",
  "step-start": "#34D399",
  "step-finish": "#06B6D4",
  compaction: "#F87171",
}

const STATUS_STROKE: Record<string, string> = {
  pending: "#9CA3AF",
  running: "#F59E0B",
  completed: "#10B981",
  error: "#EF4444",
  active: "#111827",
  final: "#D1D5DB",
}

interface Props {
  sessionId: string
}

/**
 * PartProjectionPanel renders part-level projection for the selected agent session.
 *
 * Data flow:
 * 1) Fetch part nodes + embedding from backend endpoint.
 * 2) Compute x/y using swappable coordinate projector (MDS by default).
 * 3) Render circles with d3 using only projected x/y and metadata.
 */
export function PartProjectionPanel({ sessionId }: Props) {
  const svgRef = useRef<SVGSVGElement | null>(null)
  const [raw, setRaw] = useState<PartProjectionResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [warning, setWarning] = useState<string | null>(null)
  const [algorithm, setAlgorithm] = useState<LayoutAlgorithm>("mds")
  const [selected, setSelected] = useState<PartProjectionNode | null>(null)

  useEffect(() => {
    if (!sessionId) return
    setLoading(true)
    setError(null)
    setWarning(null)

    api.sessions
      .partsProjection(
        sessionId,
        {
          withEmbedding: true,
          withPosition: true,
          embeddingMode: "dashscope",
          keywordMode: "off",
          embeddingModel: "text-embedding-v4",
        },
        15000,
      )
      .then((resp) => {
        setRaw(resp)
        console.info("[PartProjection] fetched", {
          mode: "embedding",
          sessionId: resp.sessionId,
          partCount: resp.nodes.length,
          debug: resp.debug,
          error: resp.error,
        })
      })
      .catch(async (e) => {
        // 如果 embedding 请求超时或失败，自动降级到“无 embedding + 有位置”模式。
        // 这样用户至少能先看到点，不会一直卡在 loading。
        const primaryMsg = e?.response?.data?.error ?? e?.message ?? "Projection fetch failed"
        console.warn("[PartProjection] embedding request failed, fallback to no-embedding", primaryMsg)
        try {
          const fallback = await api.sessions.partsProjection(
            sessionId,
            {
              withEmbedding: false,
              withPosition: true,
              embeddingMode: "mock",
              keywordMode: "off",
              embeddingModel: "text-embedding-v4",
            },
            100000,
          )
          setRaw(fallback)
          setWarning(`Embedding 暂不可用，已降级显示基础坐标：${primaryMsg}`)
        } catch (fallbackErr: any) {
          const msg =
            fallbackErr?.response?.data?.error ??
            fallbackErr?.message ??
            "Projection fallback failed"
          setError(msg)
        }
      })
      .finally(() => setLoading(false))
  }, [sessionId])

  const nodes = useMemo(() => {
    const src = raw?.nodes ?? []
    const out = computeCoordinates(src, { algorithm })
    console.info("[PartProjection] coordinates", {
      algorithm,
      nodeCount: out.length,
      xRange: range(out.map((n) => n.x ?? 0)),
      yRange: range(out.map((n) => n.y ?? 0)),
    })
    return out
  }, [raw, algorithm])

  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const width = 760
    const height = 300
    const pad = 18
    const root = select(svg)
    root.selectAll("*").remove()
    root.attr("viewBox", `0 0 ${width} ${height}`)

    const x = scaleLinear().domain([0, 1]).range([pad, width - pad])
    const y = scaleLinear().domain([0, 1]).range([height - pad, pad])

    root
      .append("rect")
      .attr("x", 0)
      .attr("y", 0)
      .attr("width", width)
      .attr("height", height)
      .attr("fill", "#ffffff")

    const g = root.append("g")
    g.selectAll("circle")
      .data(nodes)
      .enter()
      .append("circle")
      .attr("cx", (d) => x(d.x ?? 0))
      .attr("cy", (d) => y(d.y ?? 0))
      .attr("r", 4)
      .attr("fill", (d) => TYPE_COLOR[d.type] ?? "#9CA3AF")
      .attr("stroke", (d) => STATUS_STROKE[d.status] ?? "#D1D5DB")
      .attr("stroke-width", 1.2)
      .attr("opacity", 0.9)
      .style("cursor", "pointer")
      .append("title")
      .text((d) => `${d.type} | ${d.status} | ${String(d.embeddingInput).slice(0, 80)}...`)

    // Click handling uses a transparent overlay so React state can control side panel.
    g.selectAll("circle.hit")
      .data(nodes)
      .enter()
      .append("circle")
      .attr("class", "hit")
      .attr("cx", (d) => x(d.x ?? 0))
      .attr("cy", (d) => y(d.y ?? 0))
      .attr("r", 9)
      .attr("fill", "transparent")
      .style("cursor", "pointer")
      .on("click", (_, d) => setSelected(d))
  }, [nodes])

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <label className="text-[10px] text-gray-400 uppercase tracking-widest">layout</label>
        <select
          value={algorithm}
          onChange={(e) => setAlgorithm(e.target.value as LayoutAlgorithm)}
          className="text-xs border border-gray-200 rounded px-2 py-1 bg-white"
        >
          <option value="mds">MDS</option>
          <option value="tsne">t-SNE (adapter)</option>
        </select>
        <span className="text-[10px] text-gray-400 font-mono ml-auto">
          {nodes.length} parts
        </span>
      </div>

      {loading && <p className="text-xs text-gray-400">Loading projection data...</p>}
      {warning && <p className="text-xs text-yellow-600">{warning}</p>}
      {error && (
        <p className="text-xs text-red-500">
          {error}（请在后端环境变量中设置 `DASHSCOPE_API_KEY`）
        </p>
      )}

      {!loading && !error && (
        <>
          <div className="border border-gray-100 rounded overflow-hidden">
            <svg ref={svgRef} className="w-full h-[300px]" />
          </div>

          <div className="grid grid-cols-2 gap-2 text-[10px] font-mono text-gray-500">
            <div className="border border-gray-100 rounded p-2">
              <p className="text-gray-400 mb-1">Debug</p>
              <pre className="whitespace-pre-wrap break-words">
                {JSON.stringify(raw?.debug ?? {}, null, 2)}
              </pre>
            </div>
            <div className="border border-gray-100 rounded p-2">
              <p className="text-gray-400 mb-1">Selected Node</p>
              <pre className="whitespace-pre-wrap break-words">
                {selected ? JSON.stringify(selected, null, 2) : "Click a point to inspect payload."}
              </pre>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function range(values: number[]): [number, number] {
  if (!values.length) return [0, 0]
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  for (const v of values) {
    min = Math.min(min, v)
    max = Math.max(max, v)
  }
  return [min, max]
}

