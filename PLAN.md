# Jarvis MVP — High-Level Plan

## What We're Building

A Telegram bot that talks to a main Claude agent, which can delegate tasks to restricted sub-agents. First sub-agent is a trivial ping-pong test to prove the plumbing works.

**Key insight**: Claude Code has a native subagent system (`.claude/agents/` + built-in `Task` tool). No custom MCP server needed for agent spawning. This eliminates ~50% of the original codebase.

---

## Architecture Decisions

### 1. Claude Code CLI (`claude -p`) — Not the Agent SDK

Claude Pro/Max subscription covers CLI usage natively. The Agent SDK requires a pay-per-token `ANTHROPIC_API_KEY` — Anthropic blocks OAuth tokens from Claude Pro/Max for external API calls. Process spawning overhead (~1-2s) is acceptable for a personal bot.

### 2. Native Subagents — Not a Custom MCP Server

Claude Code's built-in `Task` tool delegates to agents defined in `.claude/agents/*.md`. Each agent file specifies its name, description, tools, and system prompt. The main agent sees these as available delegation targets automatically. One level of nesting only (subagents can't spawn subagents).

### 3. Project Isolation — Not Polluting Personal Config

All Claude Code config lives in `jarvis/.claude/`. The CLI runner passes `--setting-sources project` to block `~/.claude/` settings, and `--system-prompt-file` to replace default prompts. Your personal Claude Code setup stays untouched.

### 4. Memory via `--append-system-prompt-file` — Not MCP

Memory is a markdown file injected into the system prompt on every call. Read is free (part of the prompt). Write goes through a skill that uses Bash to append to the file.

---

## Components

### 1. Telegram Relay (`src/index.ts`)

Thin bridge. Receives messages from Telegram, passes them to the main agent, sends the response back.

Responsibilities:
- Auth: allowlist of Telegram user IDs from env
- `/reset` command: starts fresh session
- Typing indicator while waiting for Claude
- Response chunking: split at 4096 chars on paragraph boundaries
- Error handling: surface failures as user-readable messages

No logic, no routing — just plumbing.

### 2. CLI Runner (`src/cli-runner.ts`)

Wraps `claude -p` process spawning. Single entry point: `runMainAgent(message, sessionId)`.

Spawns:
```bash
claude -p \
  --setting-sources project \
  --system-prompt-file agents/main/system-prompt.md \
  --append-system-prompt-file agents/main/memory.md \
  --resume <session-id> \
  --output-format json \
  "user message"
```

Key flags:
- `--setting-sources project` — isolates from personal `~/.claude/`
- `--system-prompt-file` — replaces default system prompt entirely
- `--append-system-prompt-file` — injects memory as additional context
- `--resume` — conversation continuity across messages
- `--output-format json` — structured output with `session_id` for first-call capture
- `--tools ""` — **REMOVED** (main agent needs built-in Task tool for subagent delegation)

The main agent gets Claude Code's built-in tools (Read, Write, Bash, Task) plus whatever we allow in `.claude/settings.json`. The `Task` tool is how it delegates to subagents.

### 3. Session Store (`src/session-store.ts`)

JSON file mapping Telegram chat ID → Claude session UUID.

- `getSessionId(chatId)` — returns existing or creates new
- `resetSession(chatId)` — generates fresh UUID
- Persists to `data/sessions.json`

### 4. Main Agent Prompt (`agents/main/system-prompt.md`)

Defines Jarvis's personality and behavior. Updated to reference native Task tool instead of MCP:
- Be concise for Telegram
- Delegate to sub-agents via Task tool
- Reference memory naturally
- Use update-memory skill for writes

### 5. Memory File (`agents/main/memory.md`)

Persistent facts injected via `--append-system-prompt-file`. Sections: User, Preferences, Active Context, People, Notes. Starts nearly empty, grows over time.

### 6. Ping-Pong Agent (`.claude/agents/ping-pong.md`)

Native Claude Code agent definition:

```markdown
---
name: ping-pong
description: "Test agent. Responds ping to pong and pong to ping."
tools: []
---

You are a simple test agent.
If the input contains "ping", respond with exactly "pong".
If the input contains "pong", respond with exactly "ping".
Nothing else.
```

No tools, no session, no MCP. The main agent invokes it via the built-in Task tool automatically.

### 7. Update Memory Skill (`.claude/skills/update-memory/SKILL.md`)

Skill that teaches the main agent how to write to memory:

```markdown
---
name: update-memory
description: "Update long-term memory with new facts or preferences"
allowed-tools: Bash
---

To save something to memory, append to the memory file using:
echo "- <fact>" >> agents/main/memory.md

Insert under the appropriate section header (## User, ## Preferences, etc).
```

### 8. Project Settings (`.claude/settings.json`)

Claude Code project-level settings:
- Allowed tools scoped to what Jarvis needs
- Model preference (if needed)
- Any permission grants for Bash/file operations

### 9. launchd Daemon (`daemon/com.jarvis.plist` + `daemon/install.sh`)

macOS LaunchAgent:
- Runs `node dist/index.js`
- `KeepAlive: true` — auto-restart on crash
- `RunAtLoad: true` — starts on login
- Working directory: project root
- Logs to `data/logs/`

Install script copies plist to `~/Library/LaunchAgents/` and loads it.

---

## Data Flow

```
User sends "ask the ping pong agent: ping"
  → Telegram API
    → Relay (auth check, get session ID)
      → claude -p --resume <session> \
          --setting-sources project \
          --system-prompt-file agents/main/system-prompt.md \
          --append-system-prompt-file agents/main/memory.md
        → Main agent sees Task tool (built-in)
        → Main agent calls Task(agent_type="ping-pong", prompt="ping")
        → Claude Code spawns .claude/agents/ping-pong.md in isolated context
        → Returns "pong"
        → Main agent responds: "The ping pong agent says: pong"
      → CLI runner captures stdout
    → Relay chunks if >4096 chars
    → Relay sends to Telegram
User sees: "The ping pong agent says: pong"
```

Memory write flow:
```
User says "remember that I prefer dark mode"
  → Main agent recognizes this as a memory-worthy fact
  → Main agent uses Bash tool (allowed via skill):
      echo "- Prefers dark mode" >> agents/main/memory.md
  → Responds: "Got it, I'll remember you prefer dark mode"
  → Next message: memory.md is re-injected via --append-system-prompt-file
```

---

## File Structure

```
jarvis/
├── .claude/
│   ├── settings.json         # Project-level CC settings (permissions, model)
│   ├── agents/
│   │   └── ping-pong.md      # Native sub-agent definition
│   └── skills/
│       └── update-memory/
│           └── SKILL.md       # Memory write skill
├── src/
│   ├── index.ts               # Telegram relay + entry point
│   ├── cli-runner.ts          # claude -p wrapper (simplified)
│   └── session-store.ts       # Chat ID → session ID mapping
├── agents/
│   └── main/
│       ├── system-prompt.md   # Main agent personality + instructions
│       └── memory.md          # Persistent memory (injected as context)
├── daemon/
│   ├── com.jarvis.plist       # launchd config
│   └── install.sh             # Install/uninstall script
├── data/
│   ├── logs/                  # stdout/stderr from daemon
│   └── sessions.json          # Session store
├── package.json               # telegraf, dotenv
├── tsconfig.json
├── .env                       # TELEGRAM_BOT_TOKEN, TELEGRAM_ALLOWED_USERS
└── .env.example
```

### What's Gone (vs. Original Plan)

- ~~`src/mcp-server.ts`~~ — Native Task tool replaces custom spawn_agent
- ~~`config/mcp.json`~~ — No MCP server to configure
- ~~`config/agents.json`~~ — Replaced by `.claude/agents/*.md`
- ~~`agents/ping-pong/system-prompt.md`~~ — Replaced by `.claude/agents/ping-pong.md`
- ~~`@modelcontextprotocol/sdk`~~ — Removed from dependencies

---

## Implementation Order

### Step 1: Project Scaffold
- Clean up existing files (remove MCP artifacts)
- Create `.claude/` directory structure
- Create `.claude/settings.json`
- Update `package.json` (remove MCP SDK dep)
- Verify TypeScript compiles

### Step 2: Native Subagent Setup
- Create `.claude/agents/ping-pong.md`
- Test manually: `cd jarvis && claude -p "delegate to ping-pong: ping"`
- Verify Task tool delegation works

### Step 3: Memory Skill
- Create `.claude/skills/update-memory/SKILL.md`
- Test manually: `claude -p "remember that I like TypeScript"`
- Verify `agents/main/memory.md` gets updated

### Step 4: CLI Runner (Simplified)
- Rewrite `src/cli-runner.ts` — single `runMainAgent()` function
- Use `--setting-sources project` for isolation
- Use `--system-prompt-file` + `--append-system-prompt-file`
- Use `--output-format json` for session ID capture
- Handle timeouts and errors

### Step 5: Session Store
- Already done (`src/session-store.ts`)
- Minor tweaks if needed

### Step 6: Telegram Relay
- Complete `src/index.ts`
- Auth middleware (user ID allowlist)
- Message handler → `runMainAgent()` → reply
- `/reset` command
- Typing indicator
- Response chunking (4096 char limit)
- Error handling

### Step 7: End-to-End Test
- `npm run build && node dist/index.js`
- Telegram → "ask ping pong: ping" → "pong"
- Telegram → "remember I like cats" → memory updated
- Telegram → "what do you know about me?" → references memory
- `/reset` → new session

### Step 8: launchd Daemon
- `daemon/com.jarvis.plist`
- `daemon/install.sh` (load/unload)
- Verify auto-restart on crash
- Verify log rotation

### Step 9: Polish
- Error messages that make sense to the user
- Timeout handling (configurable, default 2min)
- Graceful shutdown (SIGTERM handling)
- Update system prompt for production use

---

## Dependencies

```json
{
  "dependencies": {
    "telegraf": "^4.16.0",
    "dotenv": "^16.4.0"
  },
  "devDependencies": {
    "typescript": "^5.4.0",
    "@types/node": "^22.0.0"
  }
}
```

That's it. Two runtime deps. Claude Code CLI is the only external binary.

---

## Environment Variables

```bash
TELEGRAM_BOT_TOKEN=       # From @BotFather
TELEGRAM_ALLOWED_USERS=   # Comma-separated Telegram user IDs
JARVIS_HOME=              # Project root (defaults to cwd)
```

---

## Open Questions (All Resolved ✅)

1. ✅ **`--resume` + `-p` + `--append-system-prompt-file`** — All flags compose freely (confirmed in docs)
2. ✅ **`--tools ""`** — Empty string disables all built-in tools (confirmed in CLI reference)
3. ✅ **Native subagents** — Built-in Task tool + `.claude/agents/` eliminates custom MCP server
4. ✅ **Config isolation** — `--setting-sources project` + `--system-prompt-file` keeps personal CC untouched
5. ✅ **Telegram chunking** — Split at 4096 chars on paragraph/line boundaries

---

## Future Additions (Post-MVP)

- More sub-agents: web search, code review, calendar, etc.
- Cron-triggered agents (scheduled tasks via launchd)
- Richer Telegram UI: inline keyboards, callbacks
- MCP servers for external integrations (if needed later)
- Image/file handling via Telegram
