import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

const jarvisHome = process.env.JARVIS_HOME || process.cwd();
const filePath = join(jarvisHome, "data", "subagent-sessions.json");

type SessionMap = Record<string, string>; // agentName → sessionId

function load(): SessionMap {
  try {
    if (!existsSync(filePath)) return {};
    return JSON.parse(readFileSync(filePath, "utf-8")) as SessionMap;
  } catch {
    return {};
  }
}

function save(map: SessionMap): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(map, null, 2));
}

export function getSubagentSessionId(agentName: string): string | undefined {
  return load()[agentName];
}

export function setSubagentSessionId(agentName: string, sessionId: string): void {
  const map = load();
  map[agentName] = sessionId;
  save(map);
}
