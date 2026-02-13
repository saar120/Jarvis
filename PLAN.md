# Jarvis Architecture

## Overview

Personal AI assistant on Telegram & CLI. Uses the Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`)
to interact with Claude programmatically instead of manually spawning CLI processes.

## Data Flow

### Main Conversation

```
User message (Telegram / CLI)
    ↓
entrypoints/telegram.ts or chat.ts
    ↓
runMainAgent(message, sessionId)            [src/core/agent.ts]
    ↓
SDK query({ prompt, options })              [inline, typed async generator]
    ↓
SDKMessage stream → enrichMessage()
    ├→ eventBus.emitEvent()
    │   ├→ log-writer.ts (JSONL persistence)
    │   └→ log-server.ts (WebSocket broadcast)
    └→ capture result, sessionId, cost
    ↓
RunResult { ok, result, sessionId, durationMs, costUsd }
    ↓
Store sessionId → sessions.json
    ↓
Reply to user
```

### Subagent Delegation

```
Main agent calls mcp__jarvis-subagents__run_subagent
    ↓
Inline MCP tool handler (in-process, same event loop)
    ↓
Discover agent config from agents/{name}/agent.md
    ↓
Get persistent sessionId (if agent.session = true)
    ↓
SDK query({ prompt, options })  [separate process, agent-specific config]
    ↓
SDKMessage stream → enrichMessage() → eventBus
    ↓
Capture result → return to main agent as MCP tool result
```

## Refactor from CLI Runner (completed)

Replaced `spawn('claude', ['-p', ...])` + manual JSON stdout parsing with
`@anthropic-ai/claude-agent-sdk` `query()`. This eliminated:

- `src/core/cli-runner.ts` — manual child process management
- `src/shared/cli-process.ts` — JSON line buffer + result resolver
- `src/core/event-types.ts` — custom stream event types (SDK provides typed messages)
- `src/mcp/subagent-server.ts` — separate stdio MCP server process
- `src/mcp/run-subagent.ts` — manual subagent process spawning
- `.mcp.json` — MCP server registration file

The subagent MCP server now runs in-process via `createSdkMcpServer()`, and both
main agent and subagent invocations use the same `query()` function.
