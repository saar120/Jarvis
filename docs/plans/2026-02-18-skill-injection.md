# Skill Injection for Agents

## Problem

`claude -p` (print/non-interactive mode) does not expose the `Skill` tool. Skills in `.claude/skills/` are only available in interactive Claude Code sessions. Jarvis agents run exclusively in `-p` mode, so they have no access to skills.

The subagent runner (`run-subagent.ts:88-101`) has a basic workaround: it reads `agents/{name}/skills/*.md` and concatenates them into the system prompt. But:

1. **The main agent has no skill injection at all** — `cli-runner.ts` only reads `system-prompt.md` and `memory.md`
2. **No global skills** — skills that should be available to all agents (e.g., `update-memory`) must be manually duplicated per agent
3. **No frontmatter parsing** — the subagent loader reads raw markdown without parsing YAML frontmatter for metadata (name, description, requirements)
4. **No filtering** — all `.md` files in the skills dir get included regardless of relevance or requirements
5. **No prompt budget** — unbounded skill content could bloat the system prompt

## Design (Inspired by OpenClaw)

### Skill Format

Keep the existing `SKILL.md` format — YAML frontmatter + markdown body. This matches Claude Code's native format and OpenClaw's format:

```markdown
---
name: update-memory
description: "Update long-term memory with new facts or preferences"
requires:
  bins: []           # optional: required binaries (checked at load time)
  env: []            # optional: required env vars
---

Instructions for the agent...
```

### Skill Sources (precedence order, later overrides earlier by name)

```
1. skills/                     # global project-level skills (NEW directory)
2. agents/{name}/skills/       # agent-specific skills (existing)
```

Global skills apply to every agent (main + subagents) unless the agent opts out. Agent-specific skills only apply to that agent and override globals with the same name.

### Directory Layout

```
jarvis/
├── skills/                          # NEW — global skills
│   ├── update-memory/
│   │   └── SKILL.md
│   ├── web-search/
│   │   └── SKILL.md
│   └── ...
├── agents/
│   ├── main/
│   │   ├── system-prompt.md
│   │   ├── memory.md
│   │   └── skills/                  # agent-specific skills (optional)
│   │       └── jarvis-personality/
│   │           └── SKILL.md
│   └── gmail-reader/
│       ├── agent.md
│       └── skills/                  # already exists
│           └── gmail-script-reference.md  # existing (flat file, not SKILL.md)
```

### Agent Config: Opting Out of Global Skills

Add an optional `skills` field to `agent.md` frontmatter:

```yaml
---
name: gmail-reader
description: "Read-only Gmail agent"
skills:
  include_global: false    # default: true — set false to skip global skills
  exclude: []              # optional: list of global skill names to exclude
---
```

When `include_global: false`, the agent only gets its own `agents/{name}/skills/` skills. This is useful for tightly scoped agents like `gmail-reader` that shouldn't have access to memory-write or web-search skills.

## Implementation

### Step 1: Create shared skill loader module

**New file: `src/shared/skill-loader.ts`**

Single module used by both `cli-runner.ts` and `run-subagent.ts`.

```typescript
interface SkillEntry {
  name: string;
  description: string;
  source: "global" | "agent";
  content: string;           // full markdown body (after frontmatter)
  requires?: {
    bins?: string[];
    env?: string[];
  };
}

interface LoadSkillsOptions {
  agentName: string;
  includeGlobal?: boolean;   // default: true
  excludeGlobal?: string[];  // skill names to skip
}

// Returns formatted prompt block ready for --append-system-prompt
function loadSkills(options: LoadSkillsOptions): string;
```

Logic:
1. Scan `skills/*/SKILL.md` for global skills (if `includeGlobal !== false`)
2. Scan `agents/{name}/skills/` for agent skills — support both `SKILL.md` in subdirs and flat `.md` files (backward compat with gmail-reader)
3. Parse YAML frontmatter from each file (extract name, description, requires)
4. Merge: agent skills override global skills with the same name
5. Filter: skip skills whose `requires.bins` aren't available or `requires.env` aren't set
6. Format into a prompt block with clear delimiters
7. Enforce budget: max 30,000 chars total (truncate with warning if exceeded)

Output format injected into the prompt:

```
## Available Skills

### update-memory
Update long-term memory with new facts or preferences

To save something to memory, append to the memory file using:
...

### gmail-script-reference
...
```

### Step 2: Integrate into main agent (`cli-runner.ts`)

Modify `readPromptFiles()` to also load skills:

```typescript
interface PromptFiles {
  systemPrompt: string;
  memory: string;
  skills: string;    // NEW
}
```

Modify `buildCliArgs()` — inject skills as a second `--append-system-prompt`:

```typescript
const args = [
  "-p", "--verbose",
  "--output-format", "stream-json",
  "--setting-sources", "project",
  "--system-prompt", systemPrompt,
  "--append-system-prompt", memory,
  "--append-system-prompt", skills,   // NEW
];
```

Note: need to verify `--append-system-prompt` can be passed multiple times. If not, concatenate `memory + "\n\n" + skills` into a single `--append-system-prompt`.

### Step 3: Integrate into subagent runner (`run-subagent.ts`)

Replace the existing manual skills loader (lines 88-101) with a call to the shared module:

```typescript
import { loadSkills } from "../shared/skill-loader.js";

// In buildSubagentArgs():
const skillsPrompt = loadSkills({
  agentName: config.name,
  includeGlobal: config.skills?.include_global ?? true,
  excludeGlobal: config.skills?.exclude ?? [],
});
```

### Step 4: Update `AgentConfig` type

Add optional `skills` field to `parse-agent-config.ts`:

```typescript
export interface AgentConfig {
  // ... existing fields ...
  skills?: {
    include_global?: boolean;
    exclude?: string[];
  };
}
```

### Step 5: Move `update-memory` skill to global

```bash
mkdir -p skills/update-memory/
mv .claude/skills/update-memory/SKILL.md skills/update-memory/SKILL.md
```

Keep `.claude/skills/update-memory/` as-is for interactive Claude Code sessions (it won't conflict — different discovery path).

### Step 6: Backward compatibility for flat skill files

The gmail-reader agent currently has `agents/gmail-reader/skills/gmail-script-reference.md` — a flat `.md` file, not `SKILL.md` inside a subdirectory.

The skill loader should handle both patterns:
- `skills/{name}/SKILL.md` (standard format)
- `skills/{name}.md` (flat file — name derived from filename, no frontmatter required)

For flat files without frontmatter, use the filename (minus `.md`) as the skill name and the entire file content as the body.

## Files Changed

| File | Action |
|------|--------|
| `src/shared/skill-loader.ts` | **NEW** — shared skill discovery, parsing, filtering, formatting |
| `src/core/cli-runner.ts` | **MODIFIED** — call `loadSkills()`, inject into prompt |
| `src/mcp/run-subagent.ts` | **MODIFIED** — replace manual loader with `loadSkills()` |
| `src/mcp/parse-agent-config.ts` | **MODIFIED** — add `skills` field to `AgentConfig` |
| `skills/` | **NEW directory** — global skills |
| `skills/update-memory/SKILL.md` | **NEW** — moved from `.claude/skills/` |
| `CLAUDE.md` | **UPDATED** — document skill system |

## Verification

1. `npm run build` — compiles cleanly
2. `npm run chat` — main agent can use `update-memory` skill (loaded from global `skills/`)
3. Subagent: gmail-reader gets its own skills but NOT global skills (if `include_global: false`)
4. Subagent: echo agent gets global skills by default
5. Adding a new skill to `skills/foo/SKILL.md` makes it available to all agents on next message

## Future Enhancements

- **Skill registry** — fetch skills from a remote registry (like OpenClaw's ClawHub)
- **Skill dependencies** — skill A requires skill B
- **Dynamic skill loading** — agent requests a skill mid-conversation (would need MCP tool)
- **Skill versioning** — track which version of a skill was used in each session
