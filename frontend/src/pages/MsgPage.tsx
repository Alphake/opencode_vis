import { useState } from "react"
import { SessionSelector } from "../components/messages/SessionSelector"
import { ChatWindow } from "../components/messages/ChatWindow"
import { useCockpitStore } from "../store/cockpitStore"

export function MsgPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const sessions = useCockpitStore((s) => s.sessions)
  const selected = selectedId ? sessions[selectedId] : null

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left: session selector */}
      <div className="w-52 shrink-0 border-r border-border p-3 overflow-y-auto">
        <p className="text-[10px] text-gray-400 uppercase tracking-widest mb-2 px-2">Sessions</p>
        <SessionSelector selectedId={selectedId} onSelect={setSelectedId} />
      </div>

      {/* Right: chat */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {/* Chat header */}
        <div className="h-10 shrink-0 border-b border-border px-4 flex items-center gap-2">
          {selected ? (
            <>
              <span className="text-xs font-semibold text-gray-700">{selected.agent}</span>
              <span className="text-xs text-gray-400 font-mono">{selectedId}</span>
            </>
          ) : (
            <span className="text-xs text-gray-500">All Sessions — merged timeline</span>
          )}
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto bg-surface">
          <ChatWindow sessionId={selectedId} />
        </div>
      </div>
    </div>
  )
}
