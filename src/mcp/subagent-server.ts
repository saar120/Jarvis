import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { discoverAgents } from "./agent-registry.js";
import { runSubagent } from "./run-subagent.js";
import {
  getSubagentSessionId,
  setSubagentSessionId,
} from "./subagent-sessions.js";

const CALLER = "main";

// Discover available agents at startup
const agents = discoverAgents();
const agentNames = [...agents.keys()];

const server = new McpServer({
  name: "jarvis-subagents",
  version: "0.1.0",
});

server.tool(
  "run_subagent",
  `Delegate a task to a specialized subagent. Available agents: ${agentNames.join(", ") || "none"}`,
  {
    agent_name: z.string().describe(
      `Name of the subagent. Available: ${agentNames.join(", ") || "none"}`,
    ),
    prompt: z.string().describe("The task or question for the subagent"),
    context: z.string().optional().describe("Optional brief context relevant to the task. Only include specific facts the subagent needs. Do NOT pass system prompts, skill instructions, or tool documentation. Omit if the prompt is self-contained."),
  },
  async ({ agent_name, prompt, context }) => {
    const config = agents.get(agent_name);
    if (!config) {
      return {
        isError: true as const,
        content: [
          {
            type: "text" as const,
            text: `Unknown agent: "${agent_name}". Available: ${agentNames.join(", ") || "none"}`,
          },
        ],
      };
    }

    if (!config.allowed_callers.includes(CALLER)) {
      return {
        isError: true as const,
        content: [
          {
            type: "text" as const,
            text: `Agent "${agent_name}" does not allow caller "${CALLER}".`,
          },
        ],
      };
    }

    const sessionId = config.session
      ? getSubagentSessionId(agent_name)
      : undefined;

    const result = await runSubagent(config, prompt, context, sessionId);

    if (result.ok && config.session && result.sessionId) {
      setSubagentSessionId(agent_name, result.sessionId);
    }

    if (!result.ok) {
      return {
        isError: true as const,
        content: [
          {
            type: "text" as const,
            text: `Subagent "${agent_name}" failed (${result.type}): ${result.message}`,
          },
        ],
      };
    }

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            agent: agent_name,
            result: result.result,
            duration_ms: result.durationMs,
            cost_usd: result.costUsd,
          }),
        },
      ],
    };
  },
);

// Handle graceful shutdown — kill any running subagent processes
import { activeChildren } from "./run-subagent.js";
function shutdown(): void {
  for (const child of activeChildren) child.kill("SIGTERM");
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

const transport = new StdioServerTransport();
await server.connect(transport);
