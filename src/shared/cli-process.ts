/**
 * Shared helpers for spawning `claude -p` processes.
 * Used by both cli-runner.ts (main agent) and run-subagent.ts (MCP subagents).
 */

import type { StreamEvent } from "../core/event-types.js";

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

// --- Stdout line processor ---

type ParsedLineHandler = (parsed: Record<string, unknown>) => void;

/**
 * Creates a buffered processor for newline-delimited JSON stdout from `claude -p`.
 * Handles incomplete lines across chunk boundaries.
 */
export function createLineProcessor(onParsedLine: ParsedLineHandler): {
  feed(chunk: string): void;
  flush(): void;
} {
  let buffer = "";

  return {
    feed(chunk: string) {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop()!; // keep incomplete last line

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          onParsedLine(JSON.parse(line));
        } catch {
          // Non-JSON line — ignore
        }
      }
    },

    flush() {
      if (!buffer.trim()) return;
      try {
        onParsedLine(JSON.parse(buffer));
      } catch {
        // ignore
      }
      buffer = "";
    },
  };
}

// --- Result resolution ---

export interface ResolveOptions {
  events: StreamEvent[];
  exitCode: number | null;
  durationMs: number;
  stderrChunks: string;
  agentNameFilter?: string; // "main" for cli-runner, undefined for subagents (accept all)
}

/**
 * Resolves the final result from collected stream events.
 * Tries result event → exit code fallback → text extraction fallback.
 */
export function resolveFromEvents(opts: ResolveOptions): RunResult | RunError {
  const { events, exitCode, durationMs, stderrChunks, agentNameFilter } = opts;

  // 1. Find the result event
  const resultEvent = events.find((e) => e.type === "result");

  if (resultEvent && resultEvent.type === "result") {
    if (resultEvent.is_error) {
      return {
        ok: false,
        type: "cli_error",
        message: resultEvent.result || "Claude returned an error.",
      };
    }
    return {
      ok: true,
      result: resultEvent.result ?? "",
      sessionId: resultEvent.session_id ?? "",
      durationMs,
      costUsd: resultEvent.total_cost_usd ?? 0,
    };
  }

  // 2. No result event — fall back to exit code
  if (exitCode !== 0) {
    return {
      ok: false,
      type: "cli_error",
      message: stderrChunks.trim() || `Claude exited with code ${exitCode}`,
    };
  }

  // 3. Extract text from assistant events as fallback
  const textParts: string[] = [];
  let lastSessionId = "";
  for (const e of events) {
    if (e.type === "assistant") {
      if (agentNameFilter && e._agentName !== agentNameFilter) continue;
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
    return {
      ok: true,
      result: textParts.join(""),
      sessionId: lastSessionId,
      durationMs,
      costUsd: 0,
    };
  }

  return {
    ok: false,
    type: "parse_error",
    message: "No result event or text content in Claude output.",
  };
}
