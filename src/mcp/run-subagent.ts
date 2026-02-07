import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, appendFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { request } from "node:http";
import type { AgentConfig } from "./parse-agent-config.js";

import type { ChildProcess } from "node:child_process";

const jarvisHome = process.env.JARVIS_HOME || process.cwd();
const logPort = Number(process.env.JARVIS_LOG_PORT) || 7777;
const logsRoot = join(jarvisHome, "data", "logs");

export const activeChildren = new Set<ChildProcess>();

export interface SubagentResult {
  ok: true;
  result: string;
  sessionId: string;
  durationMs: number;
  costUsd: number;
}

export interface SubagentError {
  ok: false;
  type: "timeout" | "cli_error" | "parse_error";
  message: string;
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

export function runSubagent(
  config: AgentConfig,
  prompt: string,
  context?: string,
  sessionId?: string,
): Promise<SubagentResult | SubagentError> {
  return new Promise((resolve) => {
    const start = Date.now();
    const runId = randomUUID();

    // Read agent-specific memory if it exists
    const memoryPath = join(jarvisHome, "agents", config.name, "memory.md");
    let memory = "";
    try {
      if (existsSync(memoryPath)) {
        memory = readFileSync(memoryPath, "utf-8");
      }
    } catch { /* no memory file */ }

    const args = [
      "-p",
      "--verbose",
      "--output-format", "stream-json",
      "--setting-sources", "project",
      "--system-prompt", config.systemPrompt,
    ];

    if (memory) {
      args.push("--append-system-prompt", memory);
    }

    // Agent-specific permissions — agent config is source of truth.
    // Empty allow = no tools (agents are isolated by default).
    // --tools is an explicit whitelist: unlisted tools are implicitly denied.
    if (config.permissions.allow.length > 0) {
      args.push("--tools", config.permissions.allow.join(","));
    } else {
      args.push("--tools", "");
    }

    // MCP servers for this agent
    const mcpConfigPath = buildMcpConfigPath(config);
    if (mcpConfigPath) {
      args.push("--mcp-config", mcpConfigPath);
    }

    // Session resume
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

    const child = spawn("claude", args, { cwd: jarvisHome });
    activeChildren.add(child);

    // CRITICAL: close stdin so claude -p doesn't hang
    child.stdin?.end();

    // Manual timeout
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, config.timeout_ms);

    const events: Array<Record<string, unknown>> = [];
    let stderrChunks = "";
    let stdoutBuffer = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBuffer += chunk.toString();
      const lines = stdoutBuffer.split("\n");
      stdoutBuffer = lines.pop()!;

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const raw = JSON.parse(line) as Record<string, unknown>;
          const enriched = {
            ...raw,
            _timestamp: Date.now(),
            _runId: runId,
            _agentName: config.name,
          };
          events.push(enriched);
          postEvent(enriched);
        } catch { /* non-JSON line */ }
      }
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderrChunks += chunk.toString();
    });

    child.on("close", (code) => {
      activeChildren.delete(child);
      clearTimeout(timer);

      // Process remaining buffer
      if (stdoutBuffer.trim()) {
        try {
          const raw = JSON.parse(stdoutBuffer) as Record<string, unknown>;
          const enriched = {
            ...raw,
            _timestamp: Date.now(),
            _runId: runId,
            _agentName: config.name,
          };
          events.push(enriched);
          postEvent(enriched);
        } catch { /* ignore */ }
      }

      const durationMs = Date.now() - start;

      if (timedOut) {
        resolve({ ok: false, type: "timeout", message: `Subagent "${config.name}" timed out after ${config.timeout_ms}ms.` });
        return;
      }

      // Find result event
      const resultEvent = events.find((e) => e.type === "result");

      if (resultEvent) {
        if (resultEvent.is_error) {
          resolve({
            ok: false,
            type: "cli_error",
            message: (resultEvent.result as string) || "Subagent returned an error.",
          });
        } else {
          resolve({
            ok: true,
            result: (resultEvent.result as string) ?? "",
            sessionId: (resultEvent.session_id as string) ?? "",
            durationMs,
            costUsd: (resultEvent.total_cost_usd as number) ?? 0,
          });
        }
        return;
      }

      // No result event — fall back to exit code
      if (code !== 0) {
        resolve({
          ok: false,
          type: "cli_error",
          message: stderrChunks.trim() || `Subagent exited with code ${code}`,
        });
        return;
      }

      // Extract text from assistant events as fallback
      const textParts: string[] = [];
      let lastSessionId = "";
      for (const e of events) {
        if (e.type === "assistant") {
          const msg = e.message as { content?: Array<{ type: string; text?: string }> } | undefined;
          if (msg?.content) {
            for (const block of msg.content) {
              if (block.type === "text" && block.text) {
                textParts.push(block.text);
              }
            }
          }
        }
        if (e.session_id && typeof e.session_id === "string") {
          lastSessionId = e.session_id;
        }
      }

      if (textParts.length > 0) {
        resolve({
          ok: true,
          result: textParts.join(""),
          sessionId: lastSessionId,
          durationMs,
          costUsd: 0,
        });
      } else {
        resolve({
          ok: false,
          type: "parse_error",
          message: "No result event or text content in subagent output.",
        });
      }
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        ok: false,
        type: "cli_error",
        message: err.message,
      });
    });
  });
}
