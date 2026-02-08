# Jarvis — Claude Code Project Guide

Personal AI assistant on Telegram & CLI, powered by Claude Code's CLI.

## Quick Start

```bash
npm run build          # tsc → dist/
npm run chat           # CLI REPL (no Telegram needed)
npm start              # Telegram bot (needs .env)
npm run dev            # tsc --watch
```

## Architecture

```
Telegram / CLI → src/core/cli-runner.ts (spawn) → claude -p → response
```

- **No API key needed** — uses Claude Code CLI (`claude -p`) with Pro/Max subscription
- **MCP subagent server** — custom MCP server spawns subagents as separate `claude -p` processes with their own permissions
- **Project isolation** — `--setting-sources project` blocks `~/.claude/` settings
- **Memory** — `agents/main/memory.md` injected via `--append-system-prompt` on every call

## Project Structure

```
jarvis/
├── src/
│   ├── index.ts              # Thin entry point → re-exports entrypoints/telegram
│   ├── core/
│   │   ├── cli-runner.ts     # claude -p wrapper (spawn, no shell injection)
│   │   ├── event-bus.ts      # Central pub/sub for stream events
│   │   └── event-types.ts    # TypeScript types for stream-json events
│   ├── logging/
│   │   ├── log-writer.ts     # Persists events to JSONL files
│   │   └── log-server.ts     # HTTP + WebSocket log viewer
│   ├── mcp/
│   │   ├── subagent-server.ts    # MCP server entry point (stdio transport)
│   │   ├── run-subagent.ts       # Spawns claude -p per subagent
│   │   ├── parse-agent-config.ts # Parses agents/{name}/agent.md frontmatter
│   │   ├── agent-registry.ts     # Discovers available subagents
│   │   └── subagent-sessions.ts  # agentName → sessionId persistence
│   ├── store/
│   │   └── session-store.ts  # chatId → sessionId map (data/sessions.json)
│   └── entrypoints/
│       ├── telegram.ts       # Telegram relay (Telegraf, auth, chunking, typing)
│       ├── chat.ts           # CLI REPL for local testing
│       └── log-viewer.ts     # Standalone log viewer entry point
├── agents/
│   ├── main/
│   │   ├── system-prompt.md      # Jarvis personality & instructions
│   │   └── memory.md             # Persistent memory (grows over time)
│   └── echo/
│       └── agent.md              # Test subagent (YAML frontmatter + system prompt)
├── .claude/
│   ├── settings.json         # Project permissions (committed)
│   ├── settings.local.json   # Local overrides (not committed)
│   ├── agents/
│   │   └── ping-pong.md      # Test subagent
│   └── skills/
│       └── update-memory/
│           └── SKILL.md      # Memory write skill (echo >> memory.md)
├── .mcp.json                 # MCP server registration (jarvis-subagents)
├── data/
│   ├── sessions.json         # Session persistence (gitignored)
│   ├── subagent-sessions.json # Subagent session persistence (gitignored)
│   └── logs/                 # JSONL event logs by date
├── PLAN.md                   # Full architecture doc
└── CLAUDE.md                 # This file
```

## Build & Runtime

- **ESM** — `"type": "module"` in package.json, all imports use `.js` extensions
- **TypeScript** — ES2022 target, NodeNext module resolution, strict mode
- **Dependencies** — `telegraf`, `dotenv`, `ws`, `@modelcontextprotocol/sdk`, `zod`, `yaml`
- **Output** — `npx tsc` compiles `src/` → `dist/`

## Key Design Decisions

### CLI Runner (`src/core/cli-runner.ts`)

Single function: `runMainAgent(message, sessionId?) → Promise<CliResult | CliError>`

- Uses `spawn` (not `exec`) — args as array, prevents shell injection from Telegram messages
- Reads `system-prompt.md` and `memory.md` on every call (memory changes between invocations)
- Passes content via `--system-prompt` and `--append-system-prompt` (inline strings, not file flags)
- Returns discriminated union with `isCliError()` type guard
- Timeout: 120s default, configurable via `JARVIS_TIMEOUT_MS`

### Session Store (`src/store/session-store.ts`)

- Maps Telegram chatId (or `"cli"`) → Claude session UUID
- Sync file I/O to `data/sessions.json` (fine for single-user bot)
- No UUID generation — captures `session_id` from CLI JSON output

### Telegram Relay (`src/entrypoints/telegram.ts`)

- Auth via `TELEGRAM_ALLOWED_USERS` (comma-separated IDs, silent ignore if unauthorized)
- Typing indicator refreshed every 4s
- Response chunking at 4096 chars (paragraph → line → space → hard-cut boundaries)
- Commands: `/start`, `/reset`, `/id`
- Graceful shutdown on SIGINT/SIGTERM

## Environment Variables

```bash
TELEGRAM_BOT_TOKEN=       # From @BotFather
TELEGRAM_ALLOWED_USERS=   # Comma-separated Telegram user IDs (empty = allow all)
JARVIS_HOME=              # Project root (defaults to cwd)
JARVIS_TIMEOUT_MS=        # Claude CLI timeout in ms (default: 120000)
```

## Critical Gotchas

- **`child.stdin.end()` is required** — `execFile` + `claude -p` hangs forever without it. Claude CLI waits on stdin even with `-p` flag.
- **No `--system-prompt-file` flag** — Claude CLI 2.1.34 only has `--system-prompt` (inline string). The runner reads files with `readFileSync` and passes content directly.
- **CLI JSON uses `total_cost_usd`** (not `cost_usd`) and `session_id`.
- **All imports need `.js` extensions** — ESM with NodeNext requires it even for `.ts` source files.

## MCP Subagent Server

The main agent delegates tasks via the `run_subagent` MCP tool. Each subagent runs as a **separate `claude -p` process** with its own permissions, MCP servers, and system prompt.

### How it works

1. Claude Code spawns `src/mcp/subagent-server.ts` via stdio (registered in `.mcp.json`)
2. Main agent calls `run_subagent(agent_name, prompt, context?)`
3. MCP server looks up `agents/{name}/agent.md`, spawns `claude -p` with agent-specific config
4. Subagent events are POSTed to the log server (`POST /api/events`) for real-time dashboard streaming
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
---
System prompt goes here...
```

### Available Subagents

| Agent | Description |
|-------|-------------|
| `echo` | Test agent. Echoes back input with "Echo: " prefix. |

### Native Subagents (`.claude/agents/`)

Invoked via the built-in `Task` tool (narrower permissions only).

| Agent | Description |
|-------|-------------|
| `ping-pong` | Test agent. Responds "pong" to "ping". No tools. |

### Skills (`.claude/skills/`)

| Skill | Description |
|-------|-------------|
| `update-memory` | Appends facts to `agents/main/memory.md` via Bash echo |

## Permissions (`.claude/settings.json`)

**Allowed**: `Bash(cat:*)`, `Bash(echo:*)`, `Bash(ls:*)`, `Read`, `Write`, `Edit`, `mcp__jarvis-subagents__run_subagent`
**Denied**: `Bash(rm:*)`, `Bash(sudo:*)`, `Bash(curl:*)`, `Bash(wget:*)`

## Current State

- All source files written and compiling cleanly
- CLI chat (`npm run chat`) tested and working
- Telegram bot ready (needs `.env` configuration)
- Git initialized, no commits yet
- Memory file is empty (template skeleton only)
