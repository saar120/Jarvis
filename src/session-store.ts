import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

const jarvisHome = process.env.JARVIS_HOME || process.cwd();
const sessionsPath = join(jarvisHome, "data", "sessions.json");

type SessionMap = Record<string, string>;

function load(): SessionMap {
  try {
    return JSON.parse(readFileSync(sessionsPath, "utf-8")) as SessionMap;
  } catch {
    return {};
  }
}

function save(map: SessionMap): void {
  mkdirSync(dirname(sessionsPath), { recursive: true });
  writeFileSync(sessionsPath, JSON.stringify(map, null, 2) + "\n");
}

export function getSessionId(chatId: string): string | undefined {
  return load()[chatId];
}

export function setSessionId(chatId: string, sessionId: string): void {
  const map = load();
  map[chatId] = sessionId;
  save(map);
}

export function resetSession(chatId: string): void {
  const map = load();
  delete map[chatId];
  save(map);
}
