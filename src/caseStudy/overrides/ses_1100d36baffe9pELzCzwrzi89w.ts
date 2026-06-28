import type { SessionDemoOverride } from '../types'

/** Case-study demo overlay — local branch only; do not merge to evolve. */
export const SES_1100D36B_CASE_STUDY: SessionDemoOverride = {
  sessionId: 'ses_1100d36baffe9pELzCzwrzi89w',
  todoOrderByIdPrefix: [
    '6086640f',
    'bffe7fa0',
    '1df22a13',
    '129e3205',
    'd549baaa',
    'ea2fc839',
    '38e251c5',
    'dca5fe1f',
  ],
  messageTextReplacements: [
    {
      match: 'PRD 已完成',
      replacement: `The PRD has been published to your Feishu Wiki. Open it here:

https://my.feishu.cn/wiki/F5Nlwkm8gioKpwkR75icWJgTneb

The document covers product background and goals, Webflow reference analysis (including official editor screenshots in a left / canvas / right layout), functional requirements for AI generation, the visual editor, AI assistance, and the component system, non-functional requirements, UI style references, technical recommendations (JSON intermediate representation, engine comparison, model selection), an M1–M4 milestone plan, and competitor links.

**Recommendation:** Use the Puck or OpenPage open-source engine path with JSON Schema as the shared interface between AI generation and the visual editor so generated pages remain fully editable end-to-end.`,
    },
  ],
}
