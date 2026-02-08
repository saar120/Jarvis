import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parseAgentConfig, type AgentConfig } from "./parse-agent-config.js";

const jarvisHome = process.env.JARVIS_HOME || process.cwd();
const agentsDir = join(jarvisHome, "agents");

export function discoverAgents(): Map<string, AgentConfig> {
  const agents = new Map<string, AgentConfig>();

  if (!existsSync(agentsDir)) return agents;

  for (const entry of readdirSync(agentsDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === "main") continue;

    const configPath = join(agentsDir, entry.name, "agent.md");
    if (!existsSync(configPath)) continue;

    try {
      const config = parseAgentConfig(configPath);
      agents.set(config.name, config);
    } catch (err) {
      console.error(`Failed to parse agent config ${configPath}:`, err);
    }
  }

  return agents;
}
