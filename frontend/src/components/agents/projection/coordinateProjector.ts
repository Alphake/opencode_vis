import type { PartProjectionNode } from "../../../types"

export type LayoutAlgorithm = "mds" | "tsne"

export interface ProjectorOptions {
  algorithm: LayoutAlgorithm
  iterations?: number
  learningRate?: number
}

/**
 * 从 part 节点计算 2D 坐标。
 *
 * 设计目标：
 * - 接口稳定，便于后续替换布局算法。
 * - 渲染层只依赖 x/y，不感知算法细节。
 * - 保留原始节点字段，并追加坐标。
 */
export function computeCoordinates(
  nodes: PartProjectionNode[],
  options: ProjectorOptions,
): PartProjectionNode[] {
  const vectors = nodes.map((n) => n.embedding ?? [])
  const hasEmbedding = vectors.every((v) => v.length > 0)

  if (!hasEmbedding || nodes.length <= 1) {
    return fallbackBandLayout(nodes)
  }

  if (options.algorithm === "tsne") {
    // 目前是 t-SNE 适配占位实现：复用 stress 优化并提高非线性系数。
    // 这样先保证可切换接口，后续可替换成真正 t-SNE 实现。
    return stressProject(nodes, {
      iterations: options.iterations ?? 300,
      learningRate: options.learningRate ?? 0.01,
      exaggeration: 2.5,
    })
  }

  return stressProject(nodes, {
    iterations: options.iterations ?? 220,
    learningRate: options.learningRate ?? 0.012,
    exaggeration: 1.0,
  })
}

/**
 * 用 stress 最小化近似实现 MDS。
 *
 * 说明：
 * - 经典 MDS 常用矩阵分解；这里采用迭代梯度法最小化点对距离误差。
 * - 复杂度约 O(n^2 * iterations)，适合当前 PoC 阶段。
 */
function stressProject(
  nodes: PartProjectionNode[],
  cfg: { iterations: number; learningRate: number; exaggeration: number },
): PartProjectionNode[] {
  const n = nodes.length
  const dist = buildCosineDistanceMatrix(nodes.map((n) => n.embedding ?? []), cfg.exaggeration)
  const points = initPoints(nodes)

  for (let step = 0; step < cfg.iterations; step++) {
    const grads = new Array(n).fill(null).map(() => ({ x: 0, y: 0 }))
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = points[i].x - points[j].x
        const dy = points[i].y - points[j].y
        const current = Math.sqrt(dx * dx + dy * dy) + 1e-6
        const target = dist[i][j] + 1e-6
        const stress = (current - target) / current

        const gx = stress * dx
        const gy = stress * dy
        grads[i].x += gx
        grads[i].y += gy
        grads[j].x -= gx
        grads[j].y -= gy
      }
    }
    for (let i = 0; i < n; i++) {
      points[i].x -= cfg.learningRate * grads[i].x
      points[i].y -= cfg.learningRate * grads[i].y
    }
  }

  const normalized = normalizePoints(points)
  return nodes.map((node, i) => ({ ...node, x: normalized[i].x, y: normalized[i].y }))
}

/**
 * 根据 embedding 构建余弦距离矩阵。
 *
 * 距离映射到 [0, 1]：
 * - 0 表示语义方向接近
 * - 1 表示语义差异较大
 */
function buildCosineDistanceMatrix(vectors: number[][], exaggeration: number): number[][] {
  const n = vectors.length
  const matrix: number[][] = Array.from({ length: n }, () => new Array(n).fill(0))
  const norms = vectors.map((v) => Math.sqrt(v.reduce((s, x) => s + x * x, 0)) + 1e-12)

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      let dot = 0
      const len = Math.min(vectors[i].length, vectors[j].length)
      for (let k = 0; k < len; k++) dot += vectors[i][k] * vectors[j][k]
      const sim = dot / (norms[i] * norms[j])
      const clamped = Math.max(-1, Math.min(1, sim))
      const d = ((1 - clamped) / 2) * exaggeration
      matrix[i][j] = d
      matrix[j][i] = d
    }
  }
  return matrix
}

/**
 * 确定性初始化，降低刷新时布局抖动。
 *
 * 做法：先按 part.type 分带，再叠加时间偏移，最后归一化。
 */
function initPoints(nodes: PartProjectionNode[]): Array<{ x: number; y: number }> {
  const bands: Record<string, number> = {
    text: 0.2,
    reasoning: 0.4,
    tool: 0.6,
    "step-start": 0.75,
    "step-finish": 0.85,
    compaction: 0.95,
  }
  const points = nodes.map((n, i) => {
    const baseY = bands[n.type] ?? 0.5
    const jitter = ((n.timestamp || i) % 97) / 97
    return { x: i / Math.max(1, nodes.length - 1), y: Math.min(1, baseY + (jitter - 0.5) * 0.08) }
  })
  return normalizePoints(points)
}

/**
 * 当 embedding 不可用时的兜底布局。
 *
 * 作用：即使 embedding 接口失败，面板仍可展示并可调试。
 */
function fallbackBandLayout(nodes: PartProjectionNode[]): PartProjectionNode[] {
  const points = initPoints(nodes)
  return nodes.map((node, i) => ({ ...node, x: points[i].x, y: points[i].y }))
}

function normalizePoints(points: Array<{ x: number; y: number }>): Array<{ x: number; y: number }> {
  if (points.length === 0) return points
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const p of points) {
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x)
    maxY = Math.max(maxY, p.y)
  }
  const dx = maxX - minX || 1
  const dy = maxY - minY || 1
  return points.map((p) => ({
    x: (p.x - minX) / dx,
    y: (p.y - minY) / dy,
  }))
}

