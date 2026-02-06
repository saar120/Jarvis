import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { eventBus } from "../core/event-bus.js";
import type { StreamEvent } from "../core/event-types.js";

const jarvisHome = process.env.JARVIS_HOME || process.cwd();
const logsRoot = join(jarvisHome, "data", "logs");

const openFiles = new Map<string, string>(); // session_id -> file path

function getLogPath(event: StreamEvent): string {
  const sessionId = event.session_id || "unknown";
  if (openFiles.has(sessionId)) return openFiles.get(sessionId)!;

  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const dir = join(logsRoot, date);
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, `${sessionId}.jsonl`);
  openFiles.set(sessionId, filePath);
  return filePath;
}

export function startLogWriter(): void {
  eventBus.onEvent((event: StreamEvent) => {
    try {
      const path = getLogPath(event);
      appendFileSync(path, JSON.stringify(event) + "\n");
    } catch (err) {
      console.error("Failed to write log event:", err);
    }
  });
}
