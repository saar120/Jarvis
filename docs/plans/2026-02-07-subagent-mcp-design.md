# Subagent MCP Server Design

## Problem

Jarvis currently uses Claude Code's native Task tool for subagents. This has two limitations:

1. **Permissions can only narrow, never expand.** A subagent cannot have access to tools (MCP servers, CLI commands) that the main agent doesn't have. For example, we want a web-search agent with `curl` access, but the main agent deliberately blocks `curl`.
2. **No path to containerization.** The native Task tool runs subagents in the same process context. We may want to run subagents in isolated containers in the future.

## Solution

A custom MCP server that exposes a single `run_subagent` tool. When the main agent calls it, the server spawns a **separate** `claude -p` process with that subagent's own permissions, MCP servers, and system prompt.

## Architecture

```
User -> Telegram/CLI -> cli-runner.ts -> claude -p (main agent)
                                              |
                                        calls run_subagent tool
                                              |
                                       MCP Server (stdio)
                                              |
                                       spawns claude -p
                                       (separate process,
                                        own settings/MCP servers)
                                              |
                                       returns result to main agent
```

- **Transport:** stdio (launched by Claude Code as a child process)
- **Dependency:** `@modelcontextprotocol/sdk`
- **Source:** `src/mcp/subagent-server.ts`

## Tool Definition

```typescript
run_subagent({
  agent_name: string,   // must match a folder in agents/
  prompt: string,       // the task/question for the subagent
  context?: string,     // optional extra context from main agent
})
// Returns: { result: string, agent: string, duration_ms: number }
```

## Agent Configuration

Each subagent gets its own directory under `agents/`. The config file is `agent.md` — YAML frontmatter for settings, body for the system prompt.

### File Structure

```
agents/
  main/
    system-prompt.md        # existing, unchanged
    memory.md               # existing, unchanged
  web-search/
    agent.md                # config + system prompt
    memory.md               # optional, only if session: true
  github/
    agent.md
    memory.md
```

The MCP server discovers agents by scanning `agents/*/agent.md` (skipping `agents/main/`).

### agent.md Format

```markdown
---
name: web-search
description: "Searches the web and returns summarized results"
session: false              # false = stateless, true = persistent sessions
allowed_callers: [main]     # access control (enforced server-side)
timeout_ms: 30000           # per-agent timeout override
permissions:
  allow: ["Bash(curl:*)", "Bash(wget:*)"]
  deny: []
mcp_servers:
  - name: brave-search
    command: npx
    args: ["-y", "@anthropic/mcp-server-brave-search"]
    env:
      BRAVE_API_KEY: "${BRAVE_API_KEY}"
---

You are a web search agent. Given a query, search the web
and return a concise summary of the findings.
```

## MCP Server Behavior

On each `run_subagent` call:

1. Look up `agents/{agent_name}/agent.md` — reject if not found
2. Check `allowed_callers` — reject if caller is unauthorized
3. Parse frontmatter for permissions, MCP servers, timeout
4. Build `claude -p` args with that agent's specific settings
5. If `session: true`, look up existing session ID and use `--resume`
6. Spawn the process, wait for result
7. Return the response to the main agent

## Access Control

- Each agent declares `allowed_callers` in its frontmatter
- The MCP server enforces this on every call — unauthorized requests get a tool error
- The main agent's system prompt lists available subagents so it knows what it can call
- Subagents cannot call other subagents (main agent only, no nesting)

## Sessions

Configurable per agent via the `session` field:

- `session: false` (default) — Each call is a fresh `claude -p` invocation. No state between calls. Suitable for stateless tasks like web search.
- `session: true` — The MCP server tracks a session ID for this agent and uses `--resume` on subsequent calls. Session IDs stored in `data/sessions.json` (or a similar store). Suitable for multi-turn workflows like a GitHub agent working on a PR.

## Output Validation (Future Enhancement)

The architecture supports adding output validation later without structural changes. The MCP server is the middleware — all subagent responses pass through it before reaching the main agent.

Planned approach:

- Add `output_format` and `output_schema` fields to agent frontmatter
- Compile schemas with Zod (via `zod-to-json-schema` or similar) at startup
- Validate subagent responses before returning to main agent
- On validation failure: retry the subagent with feedback, or return a structured error

```yaml
# Future frontmatter fields:
# output_format: json
# output_schema:
#   type: object
#   properties:
#     results: { type: array }
#   required: [results]
```

## Container Support (Future Enhancement)

The architecture supports containerization by changing how the MCP server spawns subagents:

- Current: `spawn("claude", [...args])` — local process
- Future: `docker exec` or equivalent — isolated container with claude CLI installed
- The change is localized to the spawn logic in the MCP server; no other components need to change

## Main Agent Integration

### System Prompt Update

Add a subagents section to `agents/main/system-prompt.md`:

```markdown
## Subagents

You have access to the `run_subagent` tool. Use it to delegate tasks
to specialized agents. Available agents:

- **web-search** — Search the web for information. Use when the user
  asks about current events, docs, or anything requiring live data.
- **github** — Interact with GitHub repos, PRs, issues.

Do not attempt to do these tasks yourself — delegate to the
appropriate agent.
```

This section is manually maintained when agents are added or removed.

### Settings Update

Register the MCP server in `.claude/settings.json`:

```json
{
  "mcpServers": {
    "jarvis-subagents": {
      "command": "node",
      "args": ["dist/mcp/subagent-server.js"]
    }
  }
}
```

## Changes Summary

| File | Action |
|------|--------|
| `src/mcp/subagent-server.ts` | NEW — MCP server implementation |
| `agents/web-search/agent.md` | NEW — first subagent (example) |
| `agents/main/system-prompt.md` | UPDATED — add subagents section |
| `.claude/settings.json` | UPDATED — register MCP server |
| `package.json` | UPDATED — add `@modelcontextprotocol/sdk` dependency |
| `CLAUDE.md` | UPDATED — document subagent architecture |

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Invocation | Custom MCP tool | Native Task tool can't expand permissions; intercepting it is brittle |
| Tool shape | Single generic `run_subagent` | Scales without schema changes; access control enforced server-side |
| Config format | Markdown + YAML frontmatter | Familiar pattern, easy to edit, matches existing agent files |
| File structure | One folder per agent | Room to grow (memory, schemas, fixtures) |
| Nesting | Main agent only | Simpler, avoids runaway chains, easier cost control |
| Sessions | Configurable per agent | Some agents need state (GitHub), others don't (web search) |
| Output validation | Designed for, built later | Zod + JSON Schema, enforced in MCP middleware layer |
| Transport | stdio | Simplest for local dev; can switch to HTTP for containers later |
