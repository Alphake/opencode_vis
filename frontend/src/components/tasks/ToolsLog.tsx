import { useMemo } from "react"
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts"
import { useCockpitStore } from "../../store/cockpitStore"
import type { ToolStats, ToolCallRecord } from "../../types"

const STATUS_COLOR = { completed: "#10B981", running: "#F59E0B", error: "#EF4444" }

function DurationMs({ ms }: { ms: number }) {
  if (ms < 1000) return <>{ms}ms</>
  return <>{(ms / 1000).toFixed(1)}s</>
}

/** Derive aggregated ToolStats from a flat list of ToolCallRecords */
function deriveStats(calls: ToolCallRecord[]): ToolStats[] {
  const map = new Map<string, ToolStats>()
  for (const c of calls) {
    if (!map.has(c.tool)) {
      map.set(c.tool, {
        toolName: c.tool,
        totalCalls: 0,
        successCount: 0,
        errorCount: 0,
        avgDurationMs: 0,
        successRate: 1,
        recentCalls: [],
      })
    }
    const s = map.get(c.tool)!
    s.totalCalls++
    if (c.status === "completed") s.successCount++
    if (c.status === "error") s.errorCount++
    s.recentCalls.push(c)
  }
  for (const s of map.values()) {
    const withDur = s.recentCalls.filter((c) => c.durationMs != null)
    s.avgDurationMs =
      withDur.length > 0
        ? withDur.reduce((sum, c) => sum + (c.durationMs ?? 0), 0) / withDur.length
        : 0
    s.successRate = s.totalCalls > 0 ? s.successCount / s.totalCalls : 1
  }
  return [...map.values()].sort((a, b) => b.totalCalls - a.totalCalls)
}

interface Props {
  sessionId?: string
}

export function ToolsLog({ sessionId }: Props) {
  const globalStats = useCockpitStore((s) => s.toolStats)
  const allToolCalls = useCockpitStore((s) => s.toolCalls)

  const toolStats = useMemo(() => {
    if (!sessionId) return globalStats
    const filtered = allToolCalls.filter((c) => c.sessionId === sessionId)
    return deriveStats(filtered)
  }, [sessionId, globalStats, allToolCalls])

  // Recent calls: for a specific session use toolCalls directly; otherwise flatten from stats
  const recentCalls = useMemo(() => {
    if (sessionId) {
      return allToolCalls
        .filter((c) => c.sessionId === sessionId)
        .sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))
        .slice(0, 30)
    }
    return toolStats
      .flatMap((s) => s.recentCalls)
      .sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))
      .slice(0, 30)
  }, [sessionId, allToolCalls, toolStats])

  if (toolStats.length === 0) {
    return (
      <p className="text-xs text-gray-400 py-4 text-center">
        {sessionId ? "No tool calls for this agent yet." : "No tool calls recorded yet."}
      </p>
    )
  }

  const top = [...toolStats].slice(0, 12)

  return (
    <div className="flex flex-col gap-4">
      {/* Bar chart */}
      <div className="h-36">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={top} layout="vertical" margin={{ left: 4, right: 20, top: 0, bottom: 0 }}>
            <XAxis type="number" tick={{ fontSize: 10, fill: "#9CA3AF" }} tickLine={false} axisLine={false} />
            <YAxis
              dataKey="toolName"
              type="category"
              width={90}
              tick={{ fontSize: 10, fill: "#6B7280", fontFamily: "monospace" }}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip
              contentStyle={{ fontSize: 11, border: "1px solid #E5E7EB", borderRadius: 6 }}
              formatter={(v: number) => [v, "calls"]}
            />
            <Bar dataKey="totalCalls" radius={[0, 3, 3, 0]}>
              {top.map((entry, i) => (
                <Cell
                  key={i}
                  fill={entry.errorCount > 0 ? "#FEF3C7" : "#DBEAFE"}
                  stroke={entry.errorCount > 0 ? "#F59E0B" : "#93C5FD"}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-gray-400 border-b border-border">
              <th className="text-left pb-1.5 font-medium">Tool</th>
              <th className="text-right pb-1.5 font-medium">Calls</th>
              <th className="text-right pb-1.5 font-medium">Success</th>
              <th className="text-right pb-1.5 font-medium">Avg time</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {toolStats.map((s) => (
              <tr key={s.toolName} className="hover:bg-surface transition-colors">
                <td className="py-1.5 font-mono text-gray-700">{s.toolName}</td>
                <td className="py-1.5 text-right text-gray-600">{s.totalCalls}</td>
                <td className="py-1.5 text-right">
                  <span className={s.successRate < 0.8 ? "text-red-500" : "text-green-600"}>
                    {Math.round(s.successRate * 100)}%
                  </span>
                </td>
                <td className="py-1.5 text-right font-mono text-gray-500">
                  {s.avgDurationMs > 0 ? <DurationMs ms={s.avgDurationMs} /> : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Recent calls log */}
      <div>
        <p className="text-[10px] text-gray-400 uppercase tracking-widest mb-1.5">Recent Calls</p>
        <div className="flex flex-col gap-0.5 max-h-48 overflow-y-auto font-mono text-xs">
          {recentCalls.map((c) => (
            <div key={c.callId} className="flex items-center gap-2 py-0.5 hover:bg-surface px-1 rounded">
              <span
                className="w-1.5 h-1.5 rounded-full shrink-0"
                style={{ backgroundColor: STATUS_COLOR[c.status as keyof typeof STATUS_COLOR] ?? "#9CA3AF" }}
              />
              <span className="text-gray-400 w-16 shrink-0">
                {c.startedAt ? new Date(c.startedAt).toTimeString().slice(0, 8) : "—"}
              </span>
              <span className="text-orange-600 w-24 shrink-0">{c.tool}</span>
              <span className="text-gray-500 truncate flex-1">{c.title || c.outputSnippet}</span>
              {c.durationMs != null && (
                <span className="text-gray-300 shrink-0"><DurationMs ms={c.durationMs} /></span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
