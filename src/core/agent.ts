import { query } from "@anthropic-ai/claude-agent-sdk";
import type { AgentDefinition, SDKMessage, SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { eventBus } from "./event-bus.js";
import { discoverAgents } from "../mcp/agent-registry.js";

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

// --- Build SDK agent definitions from agents/{name}/agent.md ---

function buildAgentDefinitions(): Record<string, AgentDefinition> {
  const configs = discoverAgents();
  const agents: Record<string, AgentDefinition> = {};

  for (const [name, config] of configs) {
    const agentDir = join(jarvisHome, "agents", name);

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

    const prompt = [
      config.systemPrompt,
      skills.trim(),
      memory,
    ].filter(Boolean).join("\n\n");

    // Extract base tool names: "Bash(foo:*)" → "Bash"
    const tools = config.permissions.allow.length > 0
      ? [...new Set(config.permissions.allow.map(t => t.replace(/\(.*$/, "")))]
      : [];

    // Build MCP server specs for this agent
    const mcpServers = config.mcp_servers.map(s => ({
      [s.name]: {
        command: s.command,
        args: s.args ?? [],
        env: s.env ?? {},
      },
    }));

    agents[name] = {
      description: config.description,
      prompt,
      tools: tools.length > 0 ? tools : [],
      disallowedTools: config.permissions.deny,
      model: (config.model as AgentDefinition["model"]) ?? undefined,
      mcpServers: mcpServers.length > 0 ? mcpServers : undefined,
    };
  }

  return agents;
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
    const agents = buildAgentDefinitions();

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
        agents,
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
