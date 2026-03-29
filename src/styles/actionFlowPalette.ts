/**
 * Action 流方块调色板（与 Figma 对齐）
 */
export const actionFlowPalette = {
  /** 完成 / 运行中（绿系） */
  green: {
    fill: '#F5FFEA',
    stroke: '#DCEACC',
    icon: '#91A37B',
  },
  /** 错误（红系） */
  red: {
    fill: '#FFDBDB',
    stroke: '#FFB9B9',
    icon: '#E98080',
  },
  /** 待处理（未单独指定时，与黄系区分于「终点圆」） */
  pending: {
    fill: '#FFF8E6',
    stroke: '#FFE082',
    icon: '#D8A40A',
  },
  /** 终点圆（最终产出） */
  end: {
    fill: '#FFE082',
    stroke: '#D8A40A',
  },
  /** 折线与箭头 */
  arrow: '#91A37B',
} as const
