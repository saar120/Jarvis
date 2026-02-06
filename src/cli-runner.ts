import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const jarvisHome = process.env.JARVIS_HOME || process.cwd();
const timeoutMs = Number(process.env.JARVIS_TIMEOUT_MS) || 120_000;
const maxBuffer = 10 * 1024 * 1024; // 10 MB

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

export function runMainAgent(
  message: string,
  sessionId?: string,
): Promise<CliResult | CliError> {
  return new Promise((resolve) => {
    const start = Date.now();

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
      "--output-format", "json",
      "--setting-sources", "project",
      "--system-prompt", systemPrompt,
      "--append-system-prompt", memory,
    ];

    if (sessionId) {
      args.push("--resume", sessionId);
    }

    args.push(message);

    const child = execFile("claude", args, { timeout: timeoutMs, maxBuffer, cwd: jarvisHome }, (err, stdout, stderr) => {
      const durationMs = Date.now() - start;

      if (err) {
        if ("killed" in err || err.message.includes("TIMEOUT") || err.message.includes("ETIMEDOUT")) {
          resolve({ ok: false, type: "timeout", message: "Claude timed out." });
        } else {
          resolve({
            ok: false,
            type: "cli_error",
            message: stderr?.trim() || err.message,
          });
        }
        return;
      }

      try {
        const json = JSON.parse(stdout);
        resolve({
          ok: true,
          result: json.result ?? json.content ?? stdout.trim(),
          sessionId: json.session_id ?? "",
          durationMs,
          costUsd: json.total_cost_usd ?? 0,
        });
      } catch {
        // If JSON parsing fails, try to use raw stdout
        if (stdout.trim()) {
          resolve({
            ok: true,
            result: stdout.trim(),
            sessionId: "",
            durationMs,
            costUsd: 0,
          });
        } else {
          resolve({
            ok: false,
            type: "parse_error",
            message: "Failed to parse Claude output.",
          });
        }
      }
    });

    // Close stdin so claude -p doesn't wait for input
    child.stdin?.end();
  });
}
