# Jarvis

Personal AI assistant on Telegram & CLI, powered by [Claude Code](https://docs.anthropic.com/en/docs/claude-code)'s CLI.

No API key needed — runs on your Claude Pro/Max subscription via `claude -p`.

## Features

- **Telegram bot** with auth, session continuity, typing indicators, and message chunking
- **CLI chat** for local testing without Telegram
- **Subagents** via Claude Code's native `.claude/agents/` + built-in Task tool
- **Persistent memory** injected into every conversation via `--append-system-prompt`
- **Live dashboard** (Vue 3 + Tailwind) for viewing session logs and agent configs in real-time via WebSocket
- **Streaming JSON** output with per-event processing and JSONL log persistence

## Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated with a Pro/Max subscription

## Quick Start

```bash
git clone <repo-url> && cd jarvis
npm install
npm run build
```

### CLI (no Telegram needed)

```bash
npm run chat
```

### Telegram Bot

1. Create a bot via [@BotFather](https://t.me/BotFather) and grab the token
2. Create `.env`:

```bash
TELEGRAM_BOT_TOKEN=your-token-here
TELEGRAM_ALLOWED_USERS=123456789   # your Telegram user ID (comma-separated for multiple)
```

3. Start:

```bash
npm start
```

### Dashboard

The dashboard starts automatically with the Telegram bot, or standalone:

```bash
npm run dashboard
```

Open `http://localhost:7777` to view session timelines, agent configs, and live event streams.

## How It Works

```
User (Telegram/CLI)
  → src/entrypoints/{telegram,chat}.ts
    → src/core/cli-runner.ts (spawn)
      → claude -p --setting-sources project --system-prompt <...> --append-system-prompt <memory>
        → Claude processes with access to Task tool, Read, Write, Bash
        → Subagent delegation via .claude/agents/*.md
      → stream-json events parsed, logged, forwarded via event bus
    → Response chunked (4096 char limit) and sent back
```

## Architecture & Agentic Pipeline

### Overview

Jarvis wraps the Claude Code CLI (`claude -p`) as a stateless subprocess. Each user message spawns a **single short-lived `claude` process**, and conversation continuity is achieved by resuming Claude sessions via `--resume <sessionId>`.

```
┌──────────────────────────────────────────────────────────────────┐
│  User (Telegram / CLI)                                           │
└──────────┬───────────────────────────────────────────────────────┘
           │ text message
           ▼
┌──────────────────────────────────────────────────────────────────┐
│  Entrypoint (telegram.ts / chat.ts)                              │
│  ┌─ Lookup sessionId from data/sessions.json (chatId → UUID)    │
│  └─ Call runMainAgent(message, sessionId?)                       │
└──────────┬───────────────────────────────────────────────────────┘
           │ spawn
           ▼
┌──────────────────────────────────────────────────────────────────┐
│  claude -p  (one process per message)                            │
│                                                                  │
│  Flags:                                                          │
│    --system-prompt <agents/main/system-prompt.md>                │
│    --append-system-prompt <agents/main/memory.md>                │
│    --resume <sessionId>          (omitted on first message)      │
│    --output-format stream-json                                   │
│    --setting-sources project                                     │
│                                                                  │
│  Claude processes the message, may use tools (Read, Write,       │
│  Bash, Task, MCP tools), then emits a result event and exits.    │
└──────────┬───────────────────────────────────────────────────────┘
           │ stream-json events
           ▼
┌──────────────────────────────────────────────────────────────────┐
│  cli-runner.ts                                                   │
│  ┌─ Parse stream-json events, emit to event bus                  │
│  ├─ Extract result text + session_id from result event           │
│  └─ Return RunResult { result, sessionId, durationMs, costUsd }  │
└──────────┬───────────────────────────────────────────────────────┘
           │
           ▼
┌──────────────────────────────────────────────────────────────────┐
│  Entrypoint                                                      │
│  ┌─ Store sessionId → data/sessions.json (for next --resume)     │
│  └─ Chunk response (4096 char limit) and send to user            │
└──────────────────────────────────────────────────────────────────┘
```

### Sessions & Conversation Memory

There are **two layers** of memory:

| Layer | What it holds | Where it lives | Survives `/reset`? |
|-------|---------------|----------------|---------------------|
| **Session history** | Full conversation turns (user messages, Claude responses, tool calls) | Anthropic's servers, accessed via `--resume <sessionId>` | No |
| **Persistent memory** | Facts, preferences, learned knowledge | `agents/main/memory.md` (local file) | Yes |

**Session lifecycle:**

1. **First message** — no session ID exists, so `claude -p` runs without `--resume`. Claude creates a new session and returns a `session_id` in the result event. Jarvis stores the mapping `chatId → sessionId` in `data/sessions.json`.
2. **Subsequent messages** — Jarvis looks up the stored `sessionId` and passes `--resume <sessionId>`. Claude loads the full conversation history from that session.
3. **`/reset`** — Jarvis deletes the `chatId` entry from `data/sessions.json`. The next message starts a new session. The old session still exists on Anthropic's side but becomes unreachable.

Both `system-prompt.md` and `memory.md` are **re-read from disk on every call**, so memory updates take effect immediately without restarting.

### MCP Subagent Pipeline

When the main agent needs to delegate work, it calls the `run_subagent` MCP tool. This spawns an **additional `claude -p` process** with the subagent's own system prompt, permissions, and optional memory.

```
┌─────────────────────────────────────────────┐
│  Main claude -p process                      │
│  (handling user message)                     │
│                                              │
│  Decides to call: run_subagent(              │
│    agent_name: "echo",                       │
│    prompt: "...",                             │
│    context?: "..."                            │
│  )                                           │
└──────────┬──────────────────────────────────┘
           │ MCP tool call (stdio)
           ▼
┌─────────────────────────────────────────────┐
│  subagent-server.ts (MCP server)             │
│  ┌─ Validate agent name & caller permission  │
│  ├─ Load config from agents/{name}/agent.md  │
│  ├─ Resolve session (if agent.session: true) │
│  └─ Call runSubagent(config, prompt, ...)     │
└──────────┬──────────────────────────────────┘
           │ spawn
           ▼
┌─────────────────────────────────────────────┐
│  Subagent claude -p process                  │
│                                              │
│  Flags:                                      │
│    --system-prompt <agent.md body>           │
│    --append-system-prompt <memory.md>        │
│    --tools <agent permissions>               │
│    --resume <sessionId>  (if session: true)  │
│                                              │
│  Runs to completion → result returned        │
└──────────┬──────────────────────────────────┘
           │ result
           ▼
┌─────────────────────────────────────────────┐
│  subagent-server.ts                          │
│  ┌─ Store session if persistent              │
│  └─ Return result to main claude process     │
└─────────────────────────────────────────────┘
```

**Key differences from the main agent:**

| Aspect | Main Agent | MCP Subagent |
|--------|------------|--------------|
| Invocations per user message | Exactly 1 | 0 to N (on demand) |
| Session key | `chatId` (per Telegram user) | `agentName` (global, shared across users) |
| Session file | `data/sessions.json` | `data/subagent-sessions.json` |
| Session mode | Always persistent | Configurable (`session: true/false` in agent.md) |
| Permissions | Project settings (`.claude/settings.json`) | Per-agent (`permissions.allow` in agent.md) |
| System prompt | `agents/main/system-prompt.md` | Markdown body of `agents/{name}/agent.md` |

### Process Lifecycle Summary

For a single user message that triggers one subagent call:

```
User sends "do X"
  → 1x claude -p spawned (main agent)
       → main agent thinks, decides to delegate
       → 1x claude -p spawned (subagent via MCP)
       → subagent completes, result returned to main
       → main agent incorporates result, produces final answer
  → response sent to user
  → both processes have exited
```

No long-running processes. Every `claude -p` invocation is ephemeral — session continuity comes entirely from `--resume`.

## Project Structure

```
jarvis/
├── src/
│   ├── index.ts                 # Entry point (re-exports telegram entrypoint)
│   ├── core/
│   │   ├── cli-runner.ts        # claude -p wrapper (spawn, no shell injection)
│   │   ├── event-bus.ts         # Pub/sub for stream events
│   │   └── event-types.ts       # TypeScript types for stream-json events
│   ├── logging/
│   │   ├── log-writer.ts        # Persists events to JSONL files
│   │   └── log-server.ts        # HTTP + WebSocket server for dashboard
│   ├── store/
│   │   └── session-store.ts     # chatId → sessionId map (data/sessions.json)
│   └── entrypoints/
│       ├── telegram.ts          # Telegram relay (auth, chunking, typing)
│       ├── chat.ts              # CLI REPL for local testing
│       └── dashboard.ts         # Standalone dashboard entry point
├── agents/main/
│   ├── system-prompt.md         # Jarvis personality & instructions
│   └── memory.md                # Persistent memory (grows over time)
├── gui/                         # Vue 3 + Tailwind dashboard SPA
├── .claude/
│   ├── settings.json            # Project-level permissions
│   ├── agents/                  # Subagent definitions
│   └── skills/                  # Skill definitions
└── data/
    ├── sessions.json            # Session persistence (gitignored)
    └── logs/                    # JSONL event logs (gitignored)
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run build` | Compile TypeScript + build dashboard GUI |
| `npm run build:server` | Compile TypeScript only |
| `npm run build:gui` | Build Vue dashboard only |
| `npm start` | Run Telegram bot (+ dashboard) |
| `npm run chat` | CLI REPL for local testing |
| `npm run dashboard` | Standalone dashboard server |
| `npm run dev` | TypeScript watch mode |
| `npm run dev:gui` | Vite dev server for dashboard |

## Telegram Commands

| Command | Description |
|---------|-------------|
| `/start` | Greet |
| `/reset` | Clear session and start fresh |
| `/id` | Show your Telegram user ID |

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | Yes (for Telegram) | Token from @BotFather |
| `TELEGRAM_ALLOWED_USERS` | No | Comma-separated Telegram user IDs. Empty = allow all |
| `JARVIS_HOME` | No | Project root (defaults to cwd) |
| `JARVIS_TIMEOUT_MS` | No | Claude CLI timeout in ms (default: 120000) |
| `JARVIS_LOG_PORT` | No | Dashboard HTTP/WS port (default: 7777) |
| `JARVIS_LOG_ENABLED` | No | Set to `false` to disable dashboard on Telegram bot startup |

## License

MIT
