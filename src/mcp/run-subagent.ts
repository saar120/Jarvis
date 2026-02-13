import { spawn } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync, mkdirSync, appendFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { request } from "node:http";
import { createLineProcessor, resolveFromEvents } from "../shared/cli-process.js";
import type { RunResult, RunError } from "../shared/cli-process.js";
import type { StreamEvent } from "../core/event-types.js";
import type { AgentConfig } from "./parse-agent-config.js";
import type { ChildProcess } from "node:child_process";

const jarvisHome = process.env.JARVIS_HOME || process.cwd();
const logPort = Number(process.env.JARVIS_LOG_PORT) || 7777;
const logsRoot = join(jarvisHome, "data", "logs");
// Inherited from cli-runner.ts → claude CLI → MCP server spawn chain.
// When set, subagent events are logged under the parent conversation's file.
const parentSessionId = process.env.JARVIS_PARENT_SESSION_ID || "";

export const activeChildren = new Set<ChildProcess>();


/** Remap session_id to the parent conversation when available. */
function toLogEvent(event: Record<string, unknown>): Record<string, unknown> {
  if (!parentSessionId) return event;
  return { ...event, session_id: parentSessionId, _subagentSessionId: event.session_id };
}

function postEvent(event: Record<string, unknown>): void {
  const body = JSON.stringify(event);
  const req = request(
    {
      hostname: "127.0.0.1",
      port: logPort,
      path: "/api/events",
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
    },
    () => { /* fire-and-forget */ },
  );
  req.on("error", () => {
    // Fallback: write directly to JSONL
    try {
      const sessionId = (event.session_id as string) || "unknown";
      const date = new Date().toISOString().slice(0, 10);
      const dir = join(logsRoot, date);
      mkdirSync(dir, { recursive: true });
      appendFileSync(join(dir, `${sessionId}.jsonl`), JSON.stringify(event) + "\n");
    } catch { /* best-effort */ }
  });
  req.end(body);
}

function buildMcpConfigPath(config: AgentConfig): string | null {
  if (config.mcp_servers.length === 0) return null;

  const mcpConfig: Record<string, unknown> = {};
  for (const s of config.mcp_servers) {
    mcpConfig[s.name] = {
      command: s.command,
      args: s.args ?? [],
      env: s.env ?? {},
    };
  }

  const tmpDir = join(jarvisHome, "data", "tmp");
  mkdirSync(tmpDir, { recursive: true });
  const tmpPath = join(tmpDir, `mcp-${config.name}.json`);
  writeFileSync(tmpPath, JSON.stringify({ mcpServers: mcpConfig }, null, 2));
  return tmpPath;
}

function buildSubagentArgs(
  config: AgentConfig,
  prompt: string,
  context?: string,
  sessionId?: string,
): string[] {
  // Read agent-specific memory if it exists
  const agentDir = join(jarvisHome, "agents", config.name);
  let memory = "";
  try {
    const memoryPath = join(agentDir, "memory.md");
    if (existsSync(memoryPath)) {
      memory = readFileSync(memoryPath, "utf-8");
    }
  } catch { /* no memory file */ }

  let skills = "";
  try {
    const skillsDir = join(agentDir, "skills");
    if (existsSync(skillsDir)) {
      const files = readdirSync(skillsDir).filter((f) => f.endsWith(".md")).sort();
      for (const file of files) {
        skills += readFileSync(join(skillsDir, file), "utf-8") + "\n";
      }
    }
  } catch { /* no skills directory */ }

  const systemPrompt = skills
    ? config.systemPrompt + "\n\n" + skills.trim()
    : config.systemPrompt;

  const args = [
    "-p",
    "--verbose",
    "--output-format", "stream-json",
    "--setting-sources", "project",
    "--add-dir", agentDir,
    "--system-prompt", systemPrompt,
  ];

  if (config.model) {
    args.push("--model", config.model);
  }

  if (memory) {
    args.push("--append-system-prompt", memory);
  }

  // Agent-specific permissions — agent config is source of truth.
  // --tools controls which built-in tools are available (e.g. "Bash", "Edit", "Read").
  // --allowed-tools controls permission patterns (e.g. "Bash(scripts/gog-gmail-read.sh:*)").
  // We extract base tool names for --tools and pass the full patterns to --allowed-tools.
  if (config.permissions.allow.length > 0) {
    // Extract unique base tool names: "Bash(foo:*)" → "Bash", "Read" → "Read"
    const baseTools = [...new Set(
      config.permissions.allow.map((t) => t.replace(/\(.*$/, "")),
    )];
    args.push("--tools", baseTools.join(","));
    args.push("--allowed-tools", ...config.permissions.allow);
  } else {
    args.push("--tools", "");
  }

  // MCP servers for this agent.
  // --strict-mcp-config ignores ALL other MCP configs (project .mcp.json, user, etc.)
  // Without this, subagents inherit the jarvis-subagents MCP server
  // and can recursively call run_subagent, spawning infinite processes.
  args.push("--strict-mcp-config");
  const mcpConfigPath = buildMcpConfigPath(config);
  if (mcpConfigPath) {
    args.push("--mcp-config", mcpConfigPath);
  }

  if (sessionId) {
    args.push("--resume", sessionId);
  }

  // Build the full prompt
  const fullPrompt = context
    ? `Context:\n${context}\n\nTask:\n${prompt}`
    : prompt;
  // "--" stops flag parsing so variadic flags (--tools, --allowedTools)
  // don't consume the prompt as additional tool names.
  args.push("--", fullPrompt);

  return args;
}

// --- Main export ---

export function runSubagent(
  config: AgentConfig,
  prompt: string,
  context?: string,
  sessionId?: string,
): Promise<RunResult | RunError> {
  const args = buildSubagentArgs(config, prompt, context, sessionId);
  const start = Date.now();
  const runId = randomUUID();

  return new Promise((resolve) => {
    const child = spawn("claude", args, { cwd: jarvisHome });
    activeChildren.add(child);

    // CRITICAL: close stdin so claude -p doesn't hang
    child.stdin?.end();

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, config.timeout_ms);

    const events: StreamEvent[] = [];
    let stderrChunks = "";

    const processor = createLineProcessor((raw) => {
      const enriched = {
        ...raw,
        _timestamp: Date.now(),
        _runId: runId,
        _agentName: config.name,
      } as StreamEvent;
      events.push(enriched);
      postEvent(toLogEvent(enriched as unknown as Record<string, unknown>));
    });

    child.stdout.on("data", (chunk: Buffer) => {
      processor.feed(chunk.toString());
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderrChunks += chunk.toString();
    });

    child.on("close", (code) => {
      activeChildren.delete(child);
      clearTimeout(timer);
      processor.flush();

      if (timedOut) {
        resolve({
          ok: false,
          type: "timeout",
          message: `Subagent "${config.name}" timed out after ${config.timeout_ms}ms.`,
        });
        return;
      }

      resolve(resolveFromEvents({
        events,
        exitCode: code,
        durationMs: Date.now() - start,
        stderrChunks,
      }));
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ ok: false, type: "cli_error", message: err.message });
    });
  });
}
