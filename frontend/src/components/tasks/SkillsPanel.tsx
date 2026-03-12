import { useCockpitStore } from "../../store/cockpitStore"

interface Props {
  sessionId?: string
}

export function SkillsPanel({ sessionId }: Props) {
  const allSkills = useCockpitStore((s) => s.skills)
  const skills = sessionId ? allSkills.filter((s) => s.sessionId === sessionId) : allSkills

  if (skills.length === 0) {
    return (
      <p className="text-xs text-gray-400 py-4 text-center">
        {sessionId ? "No skills loaded for this agent." : "No skills loaded yet."}<br />
        Skills are loaded via the <code className="font-mono bg-gray-100 px-1 rounded">skill</code> tool.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-2 overflow-y-auto">
      {skills.map((s, i) => (
        <div key={i} className="border border-border rounded-lg p-3 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-gray-800">{s.name}</span>
            <span className="text-[10px] font-mono text-gray-300">
              {s.loadedAt ? new Date(s.loadedAt).toTimeString().slice(0, 8) : ""}
            </span>
          </div>
          {s.description && (
            <p className="text-xs text-gray-500 line-clamp-2">{s.description}</p>
          )}
          <div className="flex gap-3 text-[10px] text-gray-400">
            {s.source && <span>Source: <span className="font-mono">{s.source}</span></span>}
            {s.sessionId && <span>Session: <span className="font-mono">{s.sessionId.slice(0, 10)}</span></span>}
          </div>
        </div>
      ))}
    </div>
  )
}
