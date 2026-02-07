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
