import type { RefObject } from 'react'
import type { OcMessage } from '../types/opencode'
import type { AssistantSubtask } from '../utils/subtaskGrouping'
import SubtaskCard from './SubtaskCard'

interface SubtaskDebugPanelProps {
  messages: OcMessage[]
  assistantSubtasks: AssistantSubtask[]
  linkedSubtaskIndex: number | null
  onSelectSubtask: (index: number) => void
  listScrollRef?: RefObject<HTMLDivElement | null>
}

export default function SubtaskDebugPanel({
  messages,
  assistantSubtasks,
  linkedSubtaskIndex,
  onSelectSubtask,
  listScrollRef,
}: SubtaskDebugPanelProps) {
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        minHeight: 0,
      }}
    >
      <div
        ref={listScrollRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          fontSize: 11,
          color: '#333',
          lineHeight: 1.45,
        }}
      >
        {assistantSubtasks.length === 0 ? (
          <span style={{ color: '#AAA', fontSize: 11 }}>暂无 assistant 消息</span>
        ) : (
          assistantSubtasks.map((st, si) => (
            <SubtaskCard
              key={st.subtask_id}
              subtask={st}
              messages={messages}
              displayIndex={si}
              isLinked={linkedSubtaskIndex === si}
              onSelectSubtask={() => onSelectSubtask(si)}
            />
          ))
        )}
      </div>
    </div>
  )
}
