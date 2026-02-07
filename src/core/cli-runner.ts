import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { eventBus } from "./event-bus.js";
import type { StreamEvent, AssistantEvent } from "./event-types.js";

const jarvisHome = process.env.JARVIS_HOME || process.cwd();
const timeoutMs = Number(process.env.JARVIS_TIMEOUT_MS) || 120_000;

const systemPromptPath = join(jarvisHome, "agents", "main", "system-prompt.md");
const memoryPath = join(jarvisHome, "agents", "main", "memory.md");

export interface CliResult {
  ok: true;
  result: string;
  sessionId: string;
  durationMs: number;
  costUsd: number;
}

export interface CliError {
  ok: false;
  type: "timeout" | "cli_error" | "parse_error";
  message: string;
}

export function isCliError(r: CliResult | CliError): r is CliError {
  return !r.ok;
}

function enrichEvent(
  raw: Record<string, unknown>,
  runId: string,
  agentContext: Map<string, string>,
): StreamEvent {
  // Track sub-agent mappings from Task tool_use calls
  if (
    raw.type === "assistant" &&
    raw.message &&
    typeof raw.message === "object"
  ) {
    const msg = raw.message as AssistantEvent["message"];
    if (Array.isArray(msg?.content)) {
      for (const block of msg.content) {
        if (
          block.type === "tool_use" &&
          block.name === "Task" &&
          block.input?.subagent_type
        ) {
          agentContext.set(block.id, block.input.subagent_type as string);
        }
      }
    }
  }

  // Determine agent name from parent_tool_use_id
  const parentId = raw.parent_tool_use_id as string | null | undefined;
  let agentName = "main";
  if (parentId && agentContext.has(parentId)) {
    agentName = agentContext.get(parentId)!;
  }

  return {
    ...raw,
    _timestamp: Date.now(),
    _runId: runId,
    _agentName: agentName,
  } as StreamEvent;
}

export function runMainAgent(
  message: string,
  sessionId?: string,
): Promise<CliResult | CliError> {
  return new Promise((resolve) => {
    const start = Date.now();
    const runId = randomUUID();

    // Re-read files on every call — memory may have changed
    let systemPrompt: string;
    let memory: string;
    try {
      systemPrompt = readFileSync(systemPromptPath, "utf-8");
    } catch (err) {
      resolve({
        ok: false,
        type: "cli_error",
        message: `Failed to read system prompt: ${err}`,
      });
      return;
    }
    try {
      memory = readFileSync(memoryPath, "utf-8");
    } catch {
      memory = "";
    }

    const args = [
      "-p",
      "--verbose",
      "--output-format", "stream-json",
      "--setting-sources", "project",
      "--system-prompt", systemPrompt,
      "--append-system-prompt", memory,
    ];

    if (sessionId) {
      args.push("--resume", sessionId);
    }

    args.push(message);

    const child = spawn("claude", args, {
      cwd: jarvisHome,
      env: { ...process.env, JARVIS_PARENT_SESSION_ID: sessionId || "" },
    });

    // Close stdin so claude -p doesn't wait for input
    child.stdin?.end();

    // Manual timeout (spawn has no built-in timeout)
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);

    const agentContext = new Map<string, string>();
    const events: StreamEvent[] = [];
    let stderrChunks = "";
    let stdoutBuffer = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBuffer += chunk.toString();
      const lines = stdoutBuffer.split("\n");
      stdoutBuffer = lines.pop()!; // keep incomplete last line

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const raw = JSON.parse(line);
          const event = enrichEvent(raw, runId, agentContext);
          events.push(event);
          eventBus.emitEvent(event);
        } catch {
          // Non-JSON line — ignore
        }
      }
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderrChunks += chunk.toString();
    });

    child.on("close", (code) => {
      clearTimeout(timer);

      // Process any remaining buffer
      if (stdoutBuffer.trim()) {
        try {
          const raw = JSON.parse(stdoutBuffer);
          const event = enrichEvent(raw, runId, agentContext);
          events.push(event);
          eventBus.emitEvent(event);
        } catch {
          // ignore
        }
      }

      const durationMs = Date.now() - start;

      if (timedOut) {
        resolve({ ok: false, type: "timeout", message: "Claude timed out." });
        return;
      }

      // Find the result event
      const resultEvent = events.find((e) => e.type === "result");

      if (resultEvent && resultEvent.type === "result") {
        if (resultEvent.is_error) {
          resolve({
            ok: false,
            type: "cli_error",
            message: resultEvent.result || "Claude returned an error.",
          });
        } else {
          resolve({
            ok: true,
            result: resultEvent.result ?? "",
            sessionId: resultEvent.session_id ?? "",
            durationMs,
            costUsd: resultEvent.total_cost_usd ?? 0,
          });
        }
        return;
      }

      // No result event found — fall back to exit code
      if (code !== 0) {
        resolve({
          ok: false,
          type: "cli_error",
          message: stderrChunks.trim() || `Claude exited with code ${code}`,
        });
        return;
      }

      // Try to extract text from assistant events as fallback
      const textParts: string[] = [];
      let lastSessionId = "";
      for (const e of events) {
        if (e.type === "assistant" && e._agentName === "main") {
          for (const block of e.message.content) {
            if (block.type === "text") {
              textParts.push(block.text);
            }
          }
        }
        if ("session_id" in e && e.session_id) {
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
          message: "No result event or text content in Claude output.",
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
