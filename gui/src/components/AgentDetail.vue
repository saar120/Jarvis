<script setup lang="ts">
import { computed } from "vue";
import type { AgentsConfig, AgentNavItem } from "@/types/agents";
import Badge from "./ui/Badge.vue";
import { Bot, Users, Wrench, Shield, Cpu } from "lucide-vue-next";

const props = defineProps<{
  config: AgentsConfig | null;
  selectedItem: AgentNavItem;
  loading: boolean;
}>();

const detail = computed(() => {
  const cfg = props.config;
  if (!cfg) return null;
  const item = props.selectedItem;

  if (item.kind === "main" && cfg.mainAgent) {
    return {
      kind: "main" as const,
      title: "Main Agent",
      icon: Bot,
      data: cfg.mainAgent,
    };
  }
  if (item.kind === "subagent") {
    const agent = cfg.subAgents.find((a) => a.slug === item.slug);
    if (agent) return { kind: "subagent" as const, title: agent.name, icon: Users, data: agent };
  }
  if (item.kind === "mcpagent") {
    const agent = cfg.mcpAgents?.find((a) => a.slug === item.slug);
    if (agent) return { kind: "mcpagent" as const, title: agent.name, icon: Cpu, data: agent };
  }
  if (item.kind === "skill") {
    const skill = cfg.skills.find((s) => s.slug === item.slug);
    if (skill) return { kind: "skill" as const, title: skill.name, icon: Wrench, data: skill };
  }
  if (item.kind === "settings" && cfg.settings) {
    return { kind: "settings" as const, title: "Project Permissions", icon: Shield, data: cfg.settings };
  }
  return null;
});
</script>

<template>
  <div class="flex-1 overflow-y-auto p-6">
    <!-- Loading -->
    <div v-if="loading" class="flex h-full items-center justify-center text-muted-foreground">
      Loading configuration...
    </div>

    <!-- No data -->
    <div
      v-else-if="!detail"
      class="flex h-full items-center justify-center text-muted-foreground"
    >
      No configuration data available
    </div>

    <!-- Main Agent -->
    <template v-else-if="detail.kind === 'main'">
      <div class="mb-6 flex items-center gap-2">
        <component :is="detail.icon" :size="20" class="text-primary" />
        <h2 class="text-lg font-semibold text-foreground">{{ detail.title }}</h2>
      </div>

      <div class="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        System Prompt
      </div>
      <pre
        class="mb-6 max-h-[500px] overflow-auto whitespace-pre-wrap break-words rounded border border-border bg-background p-3 font-mono text-xs text-muted-foreground"
      >{{ detail.data.systemPrompt }}</pre>

      <div class="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Memory
      </div>
      <pre
        class="max-h-[500px] overflow-auto whitespace-pre-wrap break-words rounded border border-border bg-background p-3 font-mono text-xs text-muted-foreground"
      >{{ detail.data.memory }}</pre>
    </template>

    <!-- Sub-Agent -->
    <template v-else-if="detail.kind === 'subagent'">
      <div class="mb-6 flex items-center gap-2">
        <component :is="detail.icon" :size="20" class="text-primary" />
        <h2 class="text-lg font-semibold text-foreground">{{ detail.title }}</h2>
      </div>

      <!-- Metadata card -->
      <div class="mb-6 rounded-lg border border-border bg-card p-4">
        <div v-if="detail.data.description" class="mb-3">
          <div class="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Description
          </div>
          <p class="text-[13px] text-foreground">{{ detail.data.description }}</p>
        </div>
        <div>
          <div class="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Tools
          </div>
          <div v-if="detail.data.tools && detail.data.tools.length > 0" class="flex flex-wrap gap-1.5">
            <Badge v-for="tool in detail.data.tools" :key="tool">{{ tool }}</Badge>
          </div>
          <span v-else-if="detail.data.tools && detail.data.tools.length === 0" class="text-[13px] text-muted-foreground">
            No tools
          </span>
          <span v-else class="text-[13px] text-muted-foreground">All tools (default)</span>
        </div>
        <div class="mt-3">
          <div class="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            File
          </div>
          <span class="font-mono text-xs text-muted-foreground">.claude/agents/{{ detail.data.fileName }}</span>
        </div>
      </div>

      <div class="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Prompt
      </div>
      <pre
        class="max-h-[500px] overflow-auto whitespace-pre-wrap break-words rounded border border-border bg-background p-3 font-mono text-xs text-muted-foreground"
      >{{ detail.data.prompt }}</pre>
    </template>

    <!-- MCP Agent -->
    <template v-else-if="detail.kind === 'mcpagent'">
      <div class="mb-6 flex items-center gap-2">
        <component :is="detail.icon" :size="20" class="text-primary" />
        <h2 class="text-lg font-semibold text-foreground">{{ detail.title }}</h2>
      </div>

      <!-- Metadata card -->
      <div class="mb-6 rounded-lg border border-border bg-card p-4">
        <div class="mb-3">
          <div class="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Description
          </div>
          <p class="text-[13px] text-foreground">{{ detail.data.description }}</p>
        </div>
        <div class="mb-3 grid grid-cols-3 gap-4">
          <div>
            <div class="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Session
            </div>
            <span class="text-[13px] text-foreground">{{ detail.data.session ? 'Persistent' : 'Stateless' }}</span>
          </div>
          <div>
            <div class="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Timeout
            </div>
            <span class="text-[13px] text-foreground">{{ (detail.data.timeout_ms / 1000).toFixed(0) }}s</span>
          </div>
          <div>
            <div class="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Callers
            </div>
            <div class="flex flex-wrap gap-1.5">
              <Badge v-for="caller in detail.data.allowed_callers" :key="caller">{{ caller }}</Badge>
            </div>
          </div>
        </div>
        <div v-if="detail.data.permissions.allow.length > 0 || detail.data.permissions.deny.length > 0" class="mb-3">
          <div class="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Permissions
          </div>
          <div class="flex flex-wrap gap-1.5">
            <Badge v-for="perm in detail.data.permissions.allow" :key="perm" variant="success">{{ perm }}</Badge>
            <Badge v-for="perm in detail.data.permissions.deny" :key="perm" variant="danger">{{ perm }}</Badge>
          </div>
        </div>
        <div v-if="detail.data.mcp_servers.length > 0">
          <div class="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            MCP Servers
          </div>
          <div class="flex flex-wrap gap-1.5">
            <Badge v-for="srv in detail.data.mcp_servers" :key="srv.name">{{ srv.name }}</Badge>
          </div>
        </div>
        <div class="mt-3">
          <div class="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Path
          </div>
          <span class="font-mono text-xs text-muted-foreground">agents/{{ detail.data.slug }}/agent.md</span>
        </div>
      </div>

      <div class="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        System Prompt
      </div>
      <pre
        class="max-h-[500px] overflow-auto whitespace-pre-wrap break-words rounded border border-border bg-background p-3 font-mono text-xs text-muted-foreground"
      >{{ detail.data.prompt }}</pre>
    </template>

    <!-- Skill -->
    <template v-else-if="detail.kind === 'skill'">
      <div class="mb-6 flex items-center gap-2">
        <component :is="detail.icon" :size="20" class="text-primary" />
        <h2 class="text-lg font-semibold text-foreground">{{ detail.title }}</h2>
      </div>

      <!-- Metadata card -->
      <div class="mb-6 rounded-lg border border-border bg-card p-4">
        <div v-if="detail.data.description" class="mb-3">
          <div class="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Description
          </div>
          <p class="text-[13px] text-foreground">{{ detail.data.description }}</p>
        </div>
        <div v-if="detail.data.allowedTools">
          <div class="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Allowed Tools
          </div>
          <div class="flex flex-wrap gap-1.5">
            <Badge>{{ detail.data.allowedTools }}</Badge>
          </div>
        </div>
        <div class="mt-3">
          <div class="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Path
          </div>
          <span class="font-mono text-xs text-muted-foreground">.claude/skills/{{ detail.data.dirName }}/SKILL.md</span>
        </div>
      </div>

      <div class="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Instructions
      </div>
      <pre
        class="max-h-[500px] overflow-auto whitespace-pre-wrap break-words rounded border border-border bg-background p-3 font-mono text-xs text-muted-foreground"
      >{{ detail.data.prompt }}</pre>
    </template>

    <!-- Settings -->
    <template v-else-if="detail.kind === 'settings'">
      <div class="mb-6 flex items-center gap-2">
        <component :is="detail.icon" :size="20" class="text-primary" />
        <h2 class="text-lg font-semibold text-foreground">{{ detail.title }}</h2>
      </div>

      <div class="mb-6 rounded-lg border border-border bg-card p-4">
        <div class="mb-4">
          <div class="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Allowed
          </div>
          <div class="flex flex-wrap gap-1.5">
            <Badge
              v-for="perm in detail.data.permissions.allow"
              :key="perm"
              variant="success"
            >{{ perm }}</Badge>
          </div>
        </div>
        <div>
          <div class="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Denied
          </div>
          <div class="flex flex-wrap gap-1.5">
            <Badge
              v-for="perm in detail.data.permissions.deny"
              :key="perm"
              variant="danger"
            >{{ perm }}</Badge>
          </div>
        </div>
      </div>

      <div class="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Raw JSON
      </div>
      <pre
        class="max-h-[500px] overflow-auto whitespace-pre-wrap break-words rounded border border-border bg-background p-3 font-mono text-xs text-muted-foreground"
      >{{ JSON.stringify(detail.data, null, 2) }}</pre>
    </template>
  </div>
</template>
