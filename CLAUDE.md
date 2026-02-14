# Jarvis — Claude Code Project Guide

Personal AI assistant on Telegram & CLI, powered by the Claude Agent SDK.

## Quick Start

```bash
npm run build          # tsc → dist/
npm run chat           # CLI REPL (no Telegram needed)
npm start              # Telegram bot (needs .env)
npm run dev            # tsc --watch
```

## Architecture

```
Telegram / CLI → src/core/agent.ts → SDK query() → Claude Agent SDK → response
```

- **Agent SDK** — uses `@anthropic-ai/claude-agent-sdk` `query()` function (wraps Claude Code CLI internally)
- **Inline MCP server** — subagent delegation runs in-process via `createSdkMcpServer()` (no separate stdio process)
- **Project isolation** — `settingSources: ["project"]` for all agents; permission isolation via `tools`/`allowedTools`/`disallowedTools`
- **Memory** — `agents/main/memory.md` concatenated to system prompt on every call

## Project Structure

```
jarvis/
├── src/
│   ├── index.ts              # Thin entry point → re-exports entrypoints/telegram
│   ├── core/
│   │   ├── agent.ts          # SDK query() wrapper — main agent + subagent runner + inline MCP server
│   │   └── event-bus.ts      # Central pub/sub for SDK messages
│   ├── logging/
│   │   ├── log-writer.ts     # Persists events to JSONL files
│   │   └── log-server.ts     # HTTP + WebSocket log viewer
│   ├── mcp/
│   │   ├── parse-agent-config.ts # Parses agents/{name}/agent.md frontmatter
│   │   ├── agent-registry.ts     # Discovers available subagents
│   │   └── subagent-sessions.ts  # agentName → sessionId persistence
│   ├── store/
│   │   └── session-store.ts  # chatId → sessionId map (data/sessions.json)
│   └── entrypoints/
│       ├── telegram.ts       # Telegram relay (Telegraf, auth, chunking, typing)
│       ├── chat.ts           # CLI REPL for local testing
│       └── dashboard.ts      # Standalone log viewer entry point
├── agents/
│   ├── main/
│   │   ├── system-prompt.md      # Jarvis personality & instructions
│   │   └── memory.md             # Persistent memory (grows over time)
│   └── gmail-reader/
│       ├── agent.md              # Read-only Gmail agent (gog CLI wrapper)
│       └── scripts/
│           └── gog-gmail-read.sh # Read-only gog CLI wrapper (agent-scoped)
├── .claude/
│   ├── settings.json         # Project permissions (kept for direct CLI use)
│   ├── settings.local.json   # Local overrides (not committed)
│   ├── agents/
│   │   └── ping-pong.md      # Test subagent
│   └── skills/
│       ├── update-memory/
│       │   └── SKILL.md      # Memory write skill (echo >> memory.md)
│       └── gmail-script-reference/
│           └── SKILL.md      # Gmail CLI reference (gog-gmail-read.sh syntax)
├── data/
│   ├── sessions.json         # Session persistence (gitignored)
│   ├── subagent-sessions.json # Subagent session persistence (gitignored)
│   └── logs/                 # JSONL event logs by date
├── PLAN.md                   # Architecture doc
└── CLAUDE.md                 # This file
```

## Build & Runtime

- **ESM** — `"type": "module"` in package.json, all imports use `.js` extensions
- **TypeScript** — ES2022 target, NodeNext module resolution, strict mode
- **Dependencies** — `@anthropic-ai/claude-agent-sdk`, `telegraf`, `dotenv`, `ws`, `zod`, `yaml`
- **Output** — `npx tsc` compiles `src/` → `dist/`

## Key Design Decisions

### Agent Runner (`src/core/agent.ts`)

Single function: `runMainAgent(message, sessionId?) → Promise<RunResult | RunError>`

- Uses `query()` from `@anthropic-ai/claude-agent-sdk` — typed async generator of `SDKMessage`
- Reads `system-prompt.md` and `memory.md` on every call, concatenates into `systemPrompt` option
- Returns discriminated union with `isRunError()` type guard
- Timeout via `AbortController` (120s default, configurable via `JARVIS_TIMEOUT_MS`)
- Permissions: `bypassPermissions` mode with `disallowedTools` for dangerous commands
- Sessions: captures `session_id` from SDK `result` message, stored via session-store

### Inline Subagent MCP Server

Built inside `agent.ts` via `createSdkMcpServer()`:
- Registers `run_subagent` tool with zod schema
- Runs in the same process as the main agent (no stdio MCP server)
- Each subagent call uses `query()` with agent-specific options
- Subagent events flow through the same event bus as main agent events

### Session Store (`src/store/session-store.ts`)

- Maps Telegram chatId (or `"cli"`) → Claude session UUID
- Sync file I/O to `data/sessions.json` (fine for single-user bot)
- Captures `session_id` from SDK result messages

### Telegram Relay (`src/entrypoints/telegram.ts`)

- Auth via `TELEGRAM_ALLOWED_USERS` (comma-separated IDs, **required** — rejects all messages if unset)
- Typing indicator refreshed every 4s
- Response chunking at 4096 chars (paragraph → line → space → hard-cut boundaries)
- Commands: `/start`, `/reset`, `/id`
- Graceful shutdown on SIGINT/SIGTERM

## Environment Variables

```bash
TELEGRAM_BOT_TOKEN=       # From @BotFather
TELEGRAM_ALLOWED_USERS=   # Comma-separated Telegram user IDs (REQUIRED — empty = deny all)
JARVIS_HOME=              # Project root (defaults to cwd)
JARVIS_TIMEOUT_MS=        # Claude CLI timeout in ms (default: 120000)
```

## Critical Gotchas

- **All imports need `.js` extensions** — ESM with NodeNext requires it even for `.ts` source files.
- **`bypassPermissions` requires `allowDangerouslySkipPermissions: true`** — SDK safety check.
- **Subagents use `settingSources: ["project"]`** — loads `.claude/skills/` for native Skill tool access. Permission isolation enforced by `tools` + `allowedTools` + `disallowedTools` + `bypassPermissions`.
- **Subagents use `strictMcpConfig: true`** — prevents recursive subagent spawning (matches old `--strict-mcp-config` behavior).

## Subagent Delegation

The main agent delegates tasks via the `run_subagent` MCP tool (registered as inline SDK MCP server). Each subagent runs as a separate `query()` call with its own permissions, tools, and system prompt.

### How it works

1. Main `query()` call registers inline MCP server with `run_subagent` tool
2. Main agent calls `run_subagent(agent_name, prompt, context?)`
3. Handler looks up `agents/{name}/agent.md`, calls `query()` with agent-specific config
4. Subagent events are emitted to the event bus (in-process, no HTTP posting)
5. Result is returned to the main agent

### Agent Config Format (`agents/{name}/agent.md`)

YAML frontmatter for settings, markdown body for system prompt:

```yaml
---
name: echo
description: "Test agent that echoes back input"
session: false              # false = stateless, true = persistent sessions
allowed_callers: [main]     # access control
timeout_ms: 15000           # per-agent timeout
permissions:
  allow: []                 # Claude Code tool permissions
  deny: []
mcp_servers: []             # MCP servers available to this agent
skills: []                  # .claude/skills/ to load via SDK Skill tool
---
System prompt goes here...
```

### Available Subagents

| Agent | Description |
|-------|-------------|
| `gmail-reader` | Read-only Gmail agent. Searches/summarizes emails via gog CLI wrapper. |

### Native Subagents (`.claude/agents/`)

Invoked via the built-in `Task` tool (narrower permissions only).

| Agent | Description |
|-------|-------------|
| `ping-pong` | Test agent. Responds "pong" to "ping". No tools. |

### Skills (`.claude/skills/`)

| Skill | Description |
|-------|-------------|
| `update-memory` | Appends facts to `agents/main/memory.md` via Bash echo |
| `gmail-script-reference` | Gmail CLI reference — command syntax, query operators for gog-gmail-read.sh |

## Permissions

Main agent permissions are set programmatically in `agent.ts`:
- **Mode**: `bypassPermissions` (auto-approve all tools)
- **Denied**: `Bash(rm:*)`, `Bash(sudo:*)`, `Bash(curl:*)`, `Bash(wget:*)`
- **Settings**: `.claude/settings.json` loaded via `settingSources: ["project"]` (for agents/skills discovery)

Subagent permissions are set per-agent in `agents/{name}/agent.md` frontmatter.
