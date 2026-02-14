import { query, createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import type { SDKMessage, SDKResultMessage, McpSdkServerConfigWithInstance } from "@anthropic-ai/claude-agent-sdk";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { eventBus } from "./event-bus.js";
import { discoverAgents } from "../mcp/agent-registry.js";
import type { AgentConfig } from "../mcp/parse-agent-config.js";
import {
  getSubagentSessionId,
  setSubagentSessionId,
} from "../mcp/subagent-sessions.js";

// --- Config ---

const jarvisHome = process.env.JARVIS_HOME || process.cwd();
const timeoutMs = Number(process.env.JARVIS_TIMEOUT_MS) || 120_000;

const systemPromptPath = join(jarvisHome, "agents", "main", "system-prompt.md");
const memoryPath = join(jarvisHome, "agents", "main", "memory.md");

// --- Result types ---

export interface RunResult {
  ok: true;
  result: string;
  sessionId: string;
  durationMs: number;
  costUsd: number;
}

export interface RunError {
  ok: false;
  type: "timeout" | "cli_error" | "parse_error";
  message: string;
}

export function isRunError(r: RunResult | RunError): r is RunError {
  return !r.ok;
}

// --- Enrichment ---

export interface JarvisEvent {
  type: string;
  session_id?: string;
  _timestamp: number;
  _runId: string;
  _agentName: string;
  [key: string]: unknown;
}

function enrichMessage(msg: SDKMessage, runId: string, agentName: string): JarvisEvent {
  return {
    ...(msg as unknown as Record<string, unknown>),
    _timestamp: Date.now(),
    _runId: runId,
    _agentName: agentName,
  } as JarvisEvent;
}

// --- Run a subagent as a separate query() with its own permissions ---

async function runSubagent(
  config: AgentConfig,
  prompt: string,
  context?: string,
  sessionId?: string,
): Promise<RunResult | RunError> {
  const agentDir = join(jarvisHome, "agents", config.name);
  const runId = randomUUID();
  const start = Date.now();

  // Read agent-specific memory
  let memory = "";
  try {
    const mp = join(agentDir, "memory.md");
    if (existsSync(mp)) memory = readFileSync(mp, "utf-8");
  } catch { /* no memory file */ }

  // Read agent-specific skills
  let skills = "";
  try {
    const skillsDir = join(agentDir, "skills");
    if (existsSync(skillsDir)) {
      for (const file of readdirSync(skillsDir).filter(f => f.endsWith(".md")).sort()) {
        skills += readFileSync(join(skillsDir, file), "utf-8") + "\n";
      }
    }
  } catch { /* no skills directory */ }

  const fullSystemPrompt = [
    config.systemPrompt,
    skills.trim(),
    memory,
  ].filter(Boolean).join("\n\n");

  const fullPrompt = context
    ? `Context:\n${context}\n\nTask:\n${prompt}`
    : prompt;

  // Build agent-specific MCP servers
  const mcpServers: Record<string, { command: string; args?: string[]; env?: Record<string, string> }> = {};
  for (const s of config.mcp_servers) {
    mcpServers[s.name] = {
      command: s.command,
      args: s.args ?? [],
      env: s.env ?? {},
    };
  }

  // Extract base tool names for the tools option: "Bash(foo:*)" → "Bash"
  const baseTools = config.permissions.allow.length > 0
    ? [...new Set(config.permissions.allow.map(t => t.replace(/\(.*$/, "")))]
    : [];

  const abortController = new AbortController();
  const timer = setTimeout(() => abortController.abort(), config.timeout_ms);

  try {
    let result = "";
    let resultSessionId = "";
    let costUsd = 0;
    let isError = false;
    let errorMessage = "";

    // Each subagent runs as its own query() — fully independent permissions
    const conversation = query({
      prompt: fullPrompt,
      options: {
        systemPrompt: fullSystemPrompt,
        settingSources: [],
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        tools: baseTools.length > 0 ? baseTools : [],
        allowedTools: config.permissions.allow,
        disallowedTools: config.permissions.deny,
        cwd: jarvisHome,
        additionalDirectories: [agentDir],
        mcpServers: Object.keys(mcpServers).length > 0 ? mcpServers : undefined,
        strictMcpConfig: true,
        model: config.model,
        resume: sessionId,
        abortController,
      },
    });

    for await (const msg of conversation) {
      eventBus.emitEvent(enrichMessage(msg, runId, config.name));

      if (msg.type === "result") {
        const r = msg as SDKResultMessage;
        resultSessionId = r.session_id;
        costUsd = r.total_cost_usd;
        isError = r.is_error;
        if (r.subtype === "success") {
          result = r.result;
        } else {
          errorMessage = ("errors" in r ? r.errors.join("; ") : "") || "Subagent returned an error.";
        }
      }
    }

    clearTimeout(timer);

    if (isError) {
      return { ok: false, type: "cli_error", message: errorMessage || result || "Subagent error." };
    }

    return {
      ok: true,
      result,
      sessionId: resultSessionId,
      durationMs: Date.now() - start,
      costUsd,
    };
  } catch (err) {
    clearTimeout(timer);
    if (abortController.signal.aborted) {
      return {
        ok: false,
        type: "timeout",
        message: `Subagent "${config.name}" timed out after ${config.timeout_ms}ms.`,
      };
    }
    return { ok: false, type: "cli_error", message: String(err) };
  }
}

// --- Inline MCP server for subagent delegation ---
// Runs in-process. Each subagent invocation spawns a separate query() with
// its own permission set — subagents can have tools the main agent lacks.

function buildSubagentMcpServer(): McpSdkServerConfigWithInstance {
  const agents = discoverAgents();
  const agentNames = [...agents.keys()];

  return createSdkMcpServer({
    name: "jarvis-subagents",
    tools: [
      tool(
        "run_subagent",
        `Delegate a task to a specialized subagent. Available agents: ${agentNames.join(", ") || "none"}`,
        {
          agent_name: z.string().describe(
            `Name of the subagent. Available: ${agentNames.join(", ") || "none"}`,
          ),
          prompt: z.string().describe("The task or question for the subagent"),
          context: z.string().optional().describe(
            "Optional brief context relevant to the task",
          ),
        },
        async ({ agent_name, prompt, context }) => {
          const config = agents.get(agent_name);
          if (!config) {
            return {
              isError: true,
              content: [{ type: "text" as const, text: `Unknown agent: "${agent_name}". Available: ${agentNames.join(", ") || "none"}` }],
            };
          }

          if (!config.allowed_callers.includes("main")) {
            return {
              isError: true,
              content: [{ type: "text" as const, text: `Agent "${agent_name}" does not allow caller "main".` }],
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
              isError: true,
              content: [{ type: "text" as const, text: `Subagent "${agent_name}" failed (${result.type}): ${result.message}` }],
            };
          }

          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({
                agent: agent_name,
                result: result.result,
                duration_ms: result.durationMs,
                cost_usd: result.costUsd,
              }),
            }],
          };
        },
      ),
    ],
  });
}

// --- Main agent ---

export async function runMainAgent(
  message: string,
  sessionId?: string,
): Promise<RunResult | RunError> {
  // Read prompt files
  let systemPrompt: string;
  try {
    systemPrompt = readFileSync(systemPromptPath, "utf-8");
  } catch (err) {
    return { ok: false, type: "cli_error", message: `Failed to read system prompt: ${err}` };
  }

  let memory = "";
  try {
    memory = readFileSync(memoryPath, "utf-8");
  } catch { /* no memory file */ }

  const fullSystemPrompt = memory
    ? systemPrompt + "\n\n" + memory
    : systemPrompt;

  const start = Date.now();
  const runId = randomUUID();
  const abortController = new AbortController();
  const timer = setTimeout(() => abortController.abort(), timeoutMs);

  try {
    const subagentMcp = buildSubagentMcpServer();

    let result = "";
    let resultSessionId = "";
    let costUsd = 0;
    let isError = false;
    let errorMessage = "";

    const conversation = query({
      prompt: message,
      options: {
        systemPrompt: fullSystemPrompt,
        settingSources: ["project"],
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        disallowedTools: ["Bash(rm:*)", "Bash(sudo:*)", "Bash(curl:*)", "Bash(wget:*)"],
        cwd: jarvisHome,
        resume: sessionId,
        abortController,
        mcpServers: {
          "jarvis-subagents": subagentMcp,
        },
      },
    });

    for await (const msg of conversation) {
      eventBus.emitEvent(enrichMessage(msg, runId, "main"));

      if (msg.type === "result") {
        const r = msg as SDKResultMessage;
        resultSessionId = r.session_id;
        costUsd = r.total_cost_usd;
        isError = r.is_error;
        if (r.subtype === "success") {
          result = r.result;
        } else {
          errorMessage = ("errors" in r ? r.errors.join("; ") : "") || "Claude returned an error.";
        }
      }
    }

    clearTimeout(timer);

    if (isError) {
      return { ok: false, type: "cli_error", message: errorMessage || result || "Claude returned an error." };
    }

    return {
      ok: true,
      result,
      sessionId: resultSessionId,
      durationMs: Date.now() - start,
      costUsd,
    };
  } catch (err) {
    clearTimeout(timer);
    if (abortController.signal.aborted) {
      return { ok: false, type: "timeout", message: "Claude timed out." };
    }
    return { ok: false, type: "cli_error", message: String(err) };
  }
}
