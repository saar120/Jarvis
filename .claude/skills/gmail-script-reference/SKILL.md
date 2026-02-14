---
name: gmail-script-reference
description: "Gmail CLI reference — command syntax, query operators, and error handling for gog-gmail-read.sh"
allowed-tools: Bash
---

You interact with Gmail exclusively through `scripts/gog-gmail-read.sh`. All output is plain text.

## Commands

### fetch (primary command)
```bash
scripts/gog-gmail-read.sh fetch '<query>' --max N
```
Searches and fetches all thread bodies in one shot. This is the command you should use by default — it returns metadata + full message content for every matching thread.

If there are more results, a `NEXT_PAGE: <token>` line appears at the end. Use `--page <token>` to fetch the next page.

### search (lightweight)
```bash
scripts/gog-gmail-read.sh search '<query>' --max N
```
Returns a TSV listing only (no message bodies): `ID  DATE  FROM  SUBJECT  LABELS  MSGS`. Use when you only need a quick overview without content.

### thread-get
```bash
scripts/gog-gmail-read.sh thread-get <threadId>
```
Fetches a single thread. Use only when you already have a thread ID from a previous search.

### message-get
```bash
scripts/gog-gmail-read.sh message-get <messageId>
```
Fetches a single message by ID.

### labels-list
```bash
scripts/gog-gmail-read.sh labels-list
```
Returns all Gmail labels.

## Search query syntax

| Operator | Example | Notes |
|----------|---------|-------|
| `in:inbox` | `in:inbox` | Default scope — always use unless asked otherwise |
| `in:anywhere` | `in:anywhere` | Includes trash, spam, sent, all labels |
| `in:sent` | `in:sent` | Sent mail only |
| `is:unread` | `is:unread` | Unread messages |
| `is:starred` | `is:starred` | Starred messages |
| `from:` | `from:john@example.com` | Filter by sender |
| `to:` | `to:me@example.com` | Filter by recipient |
| `subject:` | `subject:invoice` | Filter by subject |
| `after:` | `after:2026/02/10` | Messages after date (YYYY/MM/DD) |
| `before:` | `before:2026/02/13` | Messages before date |
| `label:` | `label:work` | Filter by label |
| `has:attachment` | `has:attachment` | Messages with attachments |
| `filename:` | `filename:pdf` | Attachment type |

Combine operators: `in:inbox is:unread after:2026/02/10`

### Important
- **`newer_than:` does NOT work** with this CLI. Use `after:YYYY/MM/DD` for date filtering.
- Always scope to `in:inbox` by default. Only use `in:anywhere` or other scopes when explicitly asked.
- A bare search without `in:` may return null — always include a scope.

## Error handling

- If fetch/search returns no results, the query matched nothing. Adjust the query — don't retry the same one.
- Never retry a failed command more than once. Report the error to the caller.

## Reminder

Your final output MUST be a raw JSON array as specified in the Output Format section. No markdown, no commentary, no code fences — just the JSON array.
