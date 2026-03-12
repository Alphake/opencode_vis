/**
 * Minimal type stubs for @opencode-ai/plugin.
 * Copied from opencode/packages/plugin/src/index.ts (only what we need).
 * OpenCode provides the actual runtime implementation when loading the plugin.
 */

export interface Hooks {
  event?: (input: { event: { type: string; properties?: unknown } }) => Promise<void>

  "tool.execute.before"?: (
    input: { tool: string; sessionID: string; callID: string },
    output: { args: unknown },
  ) => Promise<void>

  "tool.execute.after"?: (
    input: { tool: string; sessionID: string; callID: string; args: unknown },
    output: { title: string; output: string; metadata: unknown },
  ) => Promise<void>

  "chat.message"?: (
    input: {
      sessionID: string
      agent?: string
      model?: { providerID: string; modelID: string }
      messageID?: string
      variant?: string
    },
    output: {
      message: { system?: string; role: string; [key: string]: unknown }
      parts: unknown[]
    },
  ) => Promise<void>
}

export type PluginInput = {
  client: unknown
  project: unknown
  directory: string
  worktree: string
  serverUrl: URL
  $: unknown
}

export type Plugin = (input: PluginInput) => Promise<Hooks>
