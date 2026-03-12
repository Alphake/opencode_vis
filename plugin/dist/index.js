// src/index.ts
var BACKEND_URL = process.env.COCKPIT_BACKEND_URL ?? "http://localhost:5000";
var RELEVANT_TYPES = new Set([
  "session.created",
  "session.updated",
  "session.deleted",
  "session.status",
  "session.idle",
  "session.error",
  "session.compacted",
  "message.updated",
  "message.part.updated",
  "message.removed",
  "todo.updated",
  "permission.updated",
  "permission.replied"
]);
var buffer = [];
var flushTimer = null;
function scheduleFlush() {
  if (flushTimer)
    return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    const batch = buffer.splice(0);
    if (batch.length === 0)
      return;
    fetch(`${BACKEND_URL}/api/events/batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ events: batch })
    }).catch((err) => {
      console.error("[AgentCockpit] Failed to forward events:", err.message);
    });
  }, 50);
}
function enqueue(type, properties) {
  buffer.push({ type, properties, timestamp: Date.now() });
  scheduleFlush();
}
var AgentCockpitPlugin = async (_ctx) => {
  console.log(`[AgentCockpit] Plugin initialized → ${BACKEND_URL}`);
  return {
    event: async ({ event }) => {
      if (RELEVANT_TYPES.has(event.type)) {
        enqueue(event.type, event.properties ?? {});
      }
    },
    "tool.execute.before": async (input, output) => {
      enqueue("tool.execute.before", {
        tool: input.tool,
        sessionID: input.sessionID,
        callID: input.callID,
        args: output.args ?? {}
      });
    },
    "tool.execute.after": async (input, output) => {
      enqueue("tool.execute.after", {
        tool: input.tool,
        sessionID: input.sessionID,
        callID: input.callID,
        args: input.args ?? {},
        title: output.title ?? "",
        outputSnippet: String(output.output ?? "").slice(0, 500),
        metadata: output.metadata ?? null
      });
    },
    "chat.message": async (input, output) => {
      const msg = output.message ?? {};
      const parts = output.parts ?? [];
      let systemPrompt = msg.system ?? null;
      if (!systemPrompt && msg.role === "system") {
        const textPart = parts.find((p) => p.type === "text");
        systemPrompt = textPart?.text ?? null;
      }
      enqueue("chat.message", {
        sessionID: input.sessionID,
        agent: input.agent,
        model: input.model,
        messageID: input.messageID,
        variant: input.variant ?? null,
        systemPrompt,
        role: msg.role ?? "user"
      });
    }
  };
};
var src_default = AgentCockpitPlugin;
export {
  src_default as default,
  AgentCockpitPlugin
};
