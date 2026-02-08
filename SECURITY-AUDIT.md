# Security Audit: Jarvis Local Service

**Date:** 2026-02-08
**Scope:** Full source code review of all entry points, network listeners, process spawning, file I/O, authentication, and authorization.

## Summary

Running Jarvis locally is reasonably safe, but the dashboard/log server exposes sensitive data on the network without authentication. This is the primary risk.

---

## Findings

### FINDING 1 (HIGH) — Dashboard server binds to 0.0.0.0, no auth, CORS `*`

**File:** `src/logging/log-server.ts:291`

The HTTP server listens on all network interfaces. Combined with `Access-Control-Allow-Origin: *` on every API endpoint, this means:

- Anyone on the same WiFi can query `http://YOUR_IP:7777/api/sessions` and read full conversation logs
- Any website you visit can silently fetch your data via JavaScript (CORS allows it)
- The WebSocket endpoint streams live events to any connected client
- `/api/agents` exposes system prompts, memory, agent configs, and project settings

**Fix:** Bind to localhost:

```typescript
server.listen(PORT, "127.0.0.1", () => { ... });
```

Remove or restrict CORS headers to `http://localhost:7777`.

---

### FINDING 2 (MEDIUM) — Telegram auth defaults to allow-all

**File:** `src/entrypoints/telegram.ts:15-17`

When `TELEGRAM_ALLOWED_USERS` is not set, `allowedUsers` is `null`, and the auth middleware passes all requests through. Anyone who discovers the bot token gets file read/write access to the project directory.

**Fix:** Default to empty Set (deny-all) instead of null:

```typescript
const allowedUsers: Set<number> = process.env.TELEGRAM_ALLOWED_USERS
  ? new Set(process.env.TELEGRAM_ALLOWED_USERS.split(",").map((s) => Number(s.trim())))
  : new Set(); // empty = deny all
```

---

### FINDING 3 (MEDIUM) — `/api/events` POST accepts arbitrary JSON, no auth

**File:** `src/logging/log-server.ts:238-269`

Anyone who can reach port 7777 can inject fake events into the dashboard stream and log files. Has a 1MB body limit but no authentication or rate limiting.

**Fix:** Addressed by Finding 1 (bind to localhost). Optionally add a shared secret header.

---

### FINDING 4 (LOW) — Log files contain sensitive data

**File:** `src/logging/log-writer.ts:27`

JSONL logs include full prompts, responses, tool outputs (file contents, command results), and cost data. Written with default file permissions (typically 0644).

**Mitigation:** Single-user Mac mitigates this. For shared machines, set `data/` directory to 0700.

---

### FINDING 5 (LOW) — Temp MCP config files accumulate

**File:** `src/mcp/run-subagent.ts:65-68`

Each subagent run writes `data/tmp/mcp-{name}.json` but never deletes it. May contain expanded environment variables.

**Fix:** Delete temp file after process spawns, or use a cleanup-on-exit handler.

---

### FINDING 6 (INFO) — Env var expansion in agent configs

**File:** `src/mcp/parse-agent-config.ts:22-23`

`expandEnvVars()` replaces `${VAR}` in MCP server env configs. Could leak secrets if agent configs reference sensitive env vars. Currently theoretical (echo agent uses no env vars).

---

## What's secure

- **No shell injection:** `spawn()` with argument arrays everywhere; user input never touches a shell
- **Path traversal protection:** Resolved-path checks on static file serving and log file access
- **Process isolation:** Subagents run as separate processes with explicit tool whitelists
- **Permission deny-list:** `rm`, `sudo`, `curl`, `wget` blocked in `.claude/settings.json`
- **Timeout enforcement:** Configurable timeouts with SIGTERM on both main and subagents
- **stdin closed:** Prevents process hangs
- **No database, no SQL, no eval, no dynamic code execution**

---

## Risk Matrix (Local Mac)

| Scenario | Risk |
|----------|------|
| Remote attacker from internet | Very Low (firewall + NAT) |
| Someone on your WiFi | **Medium** (port 7777 open on all interfaces) |
| Malicious website you visit | **Medium** (CORS `*` enables browser-based exfiltration) |
| Telegram token leaked | Medium (full bot control) |
| Prompt injection via Telegram | Low (Claude CLI guardrails + deny-list) |
| Local privilege escalation | Very Low (no sudo, no rm) |

---

## Recommended Fixes (Priority Order)

1. Bind log server to `127.0.0.1`
2. Set `TELEGRAM_ALLOWED_USERS` in `.env`
3. Remove `Access-Control-Allow-Origin: *` or restrict to localhost
4. Default Telegram auth to deny-all when env var unset
