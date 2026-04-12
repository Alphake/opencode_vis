import type { RefObject } from 'react'
import type { MappedAction, OcMessage } from '../types/opencode'
import type { AssistantSubtask } from '../utils/subtaskGrouping'
import SubtaskCard from './SubtaskCard'

interface SubtaskDebugPanelProps {
  messages: OcMessage[]
  visibleSubtasks: Array<{ subtask: AssistantSubtask; sourceIndex: number }>
  linkedSubtaskIndex: number | null
  onSelectSubtask: (index: number) => void
  onForkFromAction?: (action: MappedAction & { row: number }) => void
  onAnalyzeFromAction?: (action: MappedAction & { row: number }) => void
  listScrollRef?: RefObject<HTMLDivElement | null>
  sessionDirectory?: string
}

export default function SubtaskDebugPanel({
  messages,
  visibleSubtasks,
  linkedSubtaskIndex,
  onSelectSubtask,
  onForkFromAction,
  onAnalyzeFromAction,
  listScrollRef,
  sessionDirectory,
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
        {visibleSubtasks.length === 0 ? (
          <span style={{ color: '#AAA', fontSize: 11 }}>暂无子任务</span>
        ) : (
          visibleSubtasks.map(({ subtask: st, sourceIndex }, si) => (
            <SubtaskCard
              key={st.subtask_id}
              subtask={st}
              messages={messages}
              displayIndex={si}
              cardIndex={sourceIndex}
              isLinked={linkedSubtaskIndex === sourceIndex}
              onSelectSubtask={() => onSelectSubtask(sourceIndex)}
              onForkFromAction={onForkFromAction}
              onAnalyzeFromAction={onAnalyzeFromAction}
              sessionDirectory={sessionDirectory}
            />
          ))
        )}
      </div>
    </div>
  )
}
