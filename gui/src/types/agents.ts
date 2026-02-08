/** Data for the main Jarvis agent */
export interface MainAgentConfig {
  systemPrompt: string;
  memory: string;
}

/** A sub-agent defined in .claude/agents/*.md */
export interface SubAgentConfig {
  slug: string;
  fileName: string;
  name: string;
  description: string | null;
  tools: string[] | null;
  prompt: string;
}

/** An MCP subagent defined in agents/{name}/agent.md */
export interface McpAgentConfig {
  slug: string;
  name: string;
  description: string;
  session: boolean;
  allowed_callers: string[];
  timeout_ms: number;
  permissions: { allow: string[]; deny: string[] };
  mcp_servers: Array<{ name: string; command: string; args?: string[] }>;
  prompt: string;
}

/** A skill defined in .claude/skills/{name}/SKILL.md */
export interface SkillConfig {
  slug: string;
  dirName: string;
  name: string;
  description: string | null;
  allowedTools: string | null;
  prompt: string;
}

/** Project permissions from .claude/settings.json */
export interface ProjectSettings {
  permissions: {
    allow: string[];
    deny: string[];
  };
}

/** Full response from GET /api/agents */
export interface AgentsConfig {
  mainAgent: MainAgentConfig | null;
  subAgents: SubAgentConfig[];
  mcpAgents: McpAgentConfig[];
  skills: SkillConfig[];
  settings: ProjectSettings | null;
}

/** Union of items that can be selected in the Agents sidebar */
export type AgentNavItem =
  | { kind: "main" }
  | { kind: "subagent"; slug: string }
  | { kind: "mcpagent"; slug: string }
  | { kind: "skill"; slug: string }
  | { kind: "settings" };
