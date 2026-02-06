---
name: update-memory
description: "Update long-term memory with new facts or preferences"
allowed-tools: Bash
---

To save something to memory, append to the memory file using:

```bash
echo "- <fact>" >> agents/main/memory.md
```

Insert under the appropriate section header (## User, ## Preferences, ## Active Context, ## People, ## Notes).

If the appropriate section doesn't exist yet, create it by appending the header first, then the fact.

Only store facts that seem worth remembering long-term. Be concise.
