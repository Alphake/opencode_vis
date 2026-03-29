import type { OcMessage } from '../types/opencode'
import type { AssistantSubtask } from '../utils/subtaskGrouping'
import SubtaskCard from './SubtaskCard'

interface SubtaskDebugPanelProps {
  messages: OcMessage[]
  assistantSubtasks: AssistantSubtask[]
}

export default function SubtaskDebugPanel({ messages, assistantSubtasks }: SubtaskDebugPanelProps) {
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
        style={{
          fontSize: 10,
          color: '#8F8F8F',
          lineHeight: 1.45,
          marginBottom: 8,
          flexShrink: 0,
        }}
      >
        子任务卡片字段说明见{' '}
        <code style={{ fontSize: 9 }}>docs/subtask-card-fields.md</code>。切段规则见{' '}
        <code style={{ fontSize: 9 }}>docs/subtask-grouping.md</code>。
      </div>
      <div
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
            />
          ))
        )}
      </div>
    </div>
  )
}
