/**
 * Harness 侧「引导语」：在发往 OpenCode 之前拼进本条 user 消息。
 *
 * 说明：
 * - OpenCode 内置的 system prompt 由本地 OpenCode 配置，HTTP `POST /session/:id/message`
 *   通常只接受用户消息的 parts，本面板无法直接覆盖服务端 system。
 * - 因此这里通过「用户消息前缀」实现同等引导效果；OpenCode 存的是完整拼接文本，界面展示时用 stripHarnessGuidanceForDisplay 只显示用户输入。
 *
 * 修改方式：直接改下面常量，或把 HARNESS_GUIDANCE_ENABLED 设为 false 关闭注入。
 */

/** 设为 false 时原样发送输入框内容，不附加任何引导。 */
export const HARNESS_GUIDANCE_ENABLED = true

/**
 * 每条用户消息前附加的引导（可按需改写）。
 * 建议保留「先计划、再执行」的结构，便于与子任务 / Todo 可视化对齐。
 */
export const HARNESS_USER_GUIDANCE = `[计划优先]回答用户输入前，总是先列出计划，使用todowrite工具生成todo,然后再执行。还需要提前确定任务过程中可能的风险点，执行风险点时需要主动向用户确认。`

const SEP = '\n\n---\n【用户输入】\n'

export function buildUserMessageWithGuidance(rawUserText: string): string {
  const t = rawUserText.trimEnd()
  if (!HARNESS_GUIDANCE_ENABLED) return rawUserText
  return `${HARNESS_USER_GUIDANCE}${SEP}${t}`
}

/**
 * 从 OpenCode 拉回的 user 消息全文里去掉 harness 引导前缀，供界面展示 / 复制，避免用户看到计划类注入文案。
 * 若未匹配到当前前缀（旧会话或引导已改），原样返回。
 */
export function stripHarnessGuidanceForDisplay(storedText: string): string {
  if (!storedText) return storedText
  if (!HARNESS_GUIDANCE_ENABLED) return storedText
  const normalized = storedText.replace(/\r\n/g, '\n')
  const prefix = `${HARNESS_USER_GUIDANCE}${SEP}`.replace(/\r\n/g, '\n')
  if (normalized.startsWith(prefix)) {
    return normalized.slice(prefix.length)
  }
  return storedText
}
