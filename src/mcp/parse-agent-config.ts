import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";

export interface McpServerConfig {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface AgentConfig {
  name: string;
  description: string;
  session: boolean;
  allowed_callers: string[];
  timeout_ms: number;
  permissions: { allow: string[]; deny: string[] };
  mcp_servers: McpServerConfig[];
  systemPrompt: string;
}

function expandEnvVars(value: string): string {
  return value.replace(/\$\{(\w+)\}/g, (_, key) => process.env[key] ?? "");
}

export function parseAgentConfig(filePath: string): AgentConfig {
  const raw = readFileSync(filePath, "utf-8");

  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    throw new Error(`Invalid agent.md format (missing frontmatter): ${filePath}`);
  }

  const frontmatter = parseYaml(match[1]) as Record<string, unknown>;
  const systemPrompt = match[2].trim();

  if (!frontmatter.name || typeof frontmatter.name !== "string") {
    throw new Error(`Missing required field "name" in ${filePath}`);
  }
  if (!frontmatter.description || typeof frontmatter.description !== "string") {
    throw new Error(`Missing required field "description" in ${filePath}`);
  }

  const perms = frontmatter.permissions as
    | { allow?: string[]; deny?: string[] }
    | undefined;

  const rawMcpServers = (frontmatter.mcp_servers as McpServerConfig[] | undefined) ?? [];
  const mcpServers = rawMcpServers.map((s, i) => {
    if (!s.name || !s.command) {
      throw new Error(`MCP server entry ${i} missing "name" or "command" in ${filePath}`);
    }
    return {
      ...s,
      env: s.env
        ? Object.fromEntries(
            Object.entries(s.env).map(([k, v]) => [k, expandEnvVars(v)]),
          )
        : undefined,
    };
  });

  return {
    name: frontmatter.name,
    description: frontmatter.description,
    session: (frontmatter.session as boolean) ?? false,
    allowed_callers:
      (frontmatter.allowed_callers as string[]) ?? ["main"],
    timeout_ms: (frontmatter.timeout_ms as number) ?? 120_000,
    permissions: {
      allow: perms?.allow ?? [],
      deny: perms?.deny ?? [],
    },
    mcp_servers: mcpServers,
    systemPrompt,
  };
}
