import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { eventBus } from "./event-bus.js";
import { createLineProcessor, resolveFromEvents } from "../shared/cli-process.js";
import type { RunResult, RunError } from "../shared/cli-process.js";
import type { StreamEvent, AssistantEvent } from "./event-types.js";

const jarvisHome = process.env.JARVIS_HOME || process.cwd();
const timeoutMs = Number(process.env.JARVIS_TIMEOUT_MS) || 120_000;

const systemPromptPath = join(jarvisHome, "agents", "main", "system-prompt.md");
const memoryPath = join(jarvisHome, "agents", "main", "memory.md");

export function isRunError(r: RunResult | RunError): r is RunError {
  return !r.ok;
}

// --- Module-private helpers ---

interface PromptFiles {
  systemPrompt: string;
  memory: string;
}

function readPromptFiles(): PromptFiles | RunError {
  let systemPrompt: string;
  try {
    systemPrompt = readFileSync(systemPromptPath, "utf-8");
  } catch (err) {
    return {
      ok: false,
      type: "cli_error",
      message: `Failed to read system prompt: ${err}`,
    };
  }

  let memory: string;
  try {
    memory = readFileSync(memoryPath, "utf-8");
  } catch {
    memory = "";
  }

  return { systemPrompt, memory };
}

function buildCliArgs(
  systemPrompt: string,
  memory: string,
  message: string,
  sessionId?: string,
): string[] {
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
  return args;
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

// --- Main export ---

export function runMainAgent(
  message: string,
  sessionId?: string,
): Promise<RunResult | RunError> {
  // Phase 1: Prepare (sync, before spawn)
  const files = readPromptFiles();
  if ("ok" in files) return Promise.resolve(files); // RunError

  const { systemPrompt, memory } = files;
  const args = buildCliArgs(systemPrompt, memory, message, sessionId);
  const start = Date.now();
  const runId = randomUUID();

  // Phase 2: Spawn & wire up process
  return new Promise((resolve) => {
    const child = spawn("claude", args, {
      cwd: jarvisHome,
      env: { ...process.env, JARVIS_PARENT_SESSION_ID: sessionId || "" },
    });

    // CRITICAL: close stdin so claude -p doesn't hang
    child.stdin?.end();

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);

    const agentContext = new Map<string, string>();
    const events: StreamEvent[] = [];
    let stderrChunks = "";

    const processor = createLineProcessor((raw) => {
      const event = enrichEvent(raw, runId, agentContext);
      events.push(event);
      eventBus.emitEvent(event);
    });

    child.stdout.on("data", (chunk: Buffer) => {
      processor.feed(chunk.toString());
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderrChunks += chunk.toString();
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      processor.flush();

      if (timedOut) {
        resolve({ ok: false, type: "timeout", message: "Claude timed out." });
        return;
      }

      resolve(resolveFromEvents({
        events,
        exitCode: code,
        durationMs: Date.now() - start,
        stderrChunks,
        agentNameFilter: "main",
      }));
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ ok: false, type: "cli_error", message: err.message });
    });
  });
}
