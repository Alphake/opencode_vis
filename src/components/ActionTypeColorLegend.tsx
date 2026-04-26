import type { ActionTypePaletteId } from '../styles/actionTypePalettes'
import {
  ACTION_TYPE_ORDER,
  ACTION_TYPE_PALETTE_LABELS,
  getActionTypeTriad,
} from '../styles/actionTypePalettes'
import { actionFlowPalette } from '../styles/actionFlowPalette'

const fontSans =
  "'PingFang SC', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Microsoft YaHei', sans-serif"

type Props = {
  paletteId: ActionTypePaletteId
  onPaletteIdChange?: (id: ActionTypePaletteId) => void
  includeStatusColors?: boolean
}

/**
 * 两行图例：第一行 action_type，第二行颜色方块。
 */
export default function ActionTypeColorLegend({
  paletteId,
  onPaletteIdChange,
  includeStatusColors = false,
}: Props) {
  const typeItems = ACTION_TYPE_ORDER.map((type) => {
    const c = getActionTypeTriad(paletteId, type)
    return { key: type, label: type, fill: c.fill, stroke: c.stroke }
  })
  const statusItems = includeStatusColors
    ? [
        {
          key: 'status-error',
          label: 'error',
          fill: actionFlowPalette.red.fill,
          stroke: actionFlowPalette.red.stroke,
        },
        {
          key: 'status-pending',
          label: 'pending',
          fill: actionFlowPalette.pending.fill,
          stroke: actionFlowPalette.pending.stroke,
        },
      ]
    : []
  const items = [...typeItems, ...statusItems]

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        padding: '6px 0 8px',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
        }}
      >
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            color: '#6A6A6A',
            fontFamily: fontSans,
            whiteSpace: 'nowrap',
          }}
        >
          图例（action_type）
        </span>
        {onPaletteIdChange ? (
          <label
            style={{
              display: 'flex',
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              margin: 0,
              cursor: 'pointer',
            }}
          >
            <span style={{ fontSize: 10, color: '#666', fontFamily: fontSans }}>Palette</span>
            <select
              value={paletteId}
              onChange={(e) => onPaletteIdChange(e.target.value as ActionTypePaletteId)}
              style={{
                fontSize: 10,
                lineHeight: '14px',
                fontFamily: fontSans,
                border: '1px solid #CFCFCF',
                borderRadius: 4,
                padding: '1px 6px',
                color: '#2B2B2B',
                background: '#fff',
                maxWidth: 260,
              }}
              aria-label="Select action type palette"
            >
              {(Object.keys(ACTION_TYPE_PALETTE_LABELS) as ActionTypePaletteId[]).map((id) => (
                <option key={id} value={id}>
                  {ACTION_TYPE_PALETTE_LABELS[id]}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))`,
          columnGap: 4,
          rowGap: 2,
          alignItems: 'center',
          width: '100%',
        }}
      >
        {items.map((item) => (
          <div
            key={`${item.key}-label`}
            title={item.label}
            style={{
              fontSize: 9,
              fontWeight: 600,
              color: '#2B2B2B',
              textAlign: 'center',
              fontFamily: fontSans,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              lineHeight: '12px',
            }}
          >
            {item.label}
          </div>
        ))}
        {items.map((item) => (
          <div
            key={`${item.key}-color`}
            style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}
          >
            <span
              title={`${item.label} · ${item.fill}`}
              style={{
                width: 20,
                height: 12,
                borderRadius: 3,
                boxSizing: 'border-box',
                background: item.fill,
                border: `1.5px solid ${item.stroke}`,
                flexShrink: 0,
              }}
            />
          </div>
        ))}
      </div>
    </div>
  )
}
