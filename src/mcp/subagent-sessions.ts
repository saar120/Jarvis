import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

const jarvisHome = process.env.JARVIS_HOME || process.cwd();
const sessionsPath = join(jarvisHome, "data", "subagent-sessions.json");

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

export function getSubagentSessionId(agentName: string): string | undefined {
  return load()[agentName];
}

export function setSubagentSessionId(agentName: string, sessionId: string): void {
  const map = load();
  map[agentName] = sessionId;
  save(map);
}

export function resetSubagentSession(agentName: string): void {
  const map = load();
  delete map[agentName];
  save(map);
}
