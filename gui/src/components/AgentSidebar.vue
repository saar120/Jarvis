<script setup lang="ts">
import type { AgentsConfig, AgentNavItem } from "@/types/agents";
import ScrollArea from "./ui/ScrollArea.vue";
import { Bot, Users, Wrench, Shield } from "lucide-vue-next";

defineProps<{
  config: AgentsConfig | null;
  selectedItem: AgentNavItem;
}>();

const emit = defineEmits<{
  select: [item: AgentNavItem];
}>();

function isSelected(item: AgentNavItem, current: AgentNavItem): boolean {
  if (item.kind !== current.kind) return false;
  if (item.kind === "subagent" && current.kind === "subagent") return item.slug === current.slug;
  if (item.kind === "skill" && current.kind === "skill") return item.slug === current.slug;
  return true;
}
</script>

<template>
  <aside class="flex w-[260px] shrink-0 flex-col border-r border-border bg-[hsl(228,20%,8%)]">
    <div
      class="border-b border-border px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground"
    >
      Configuration
    </div>
    <ScrollArea class="flex-1 p-2">
      <!-- Main Agent -->
      <div
        class="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-[13px] transition-colors"
        :class="
          isSelected({ kind: 'main' }, selectedItem)
            ? 'bg-card text-primary'
            : 'text-muted-foreground hover:bg-card'
        "
        @click="emit('select', { kind: 'main' })"
      >
        <Bot :size="14" class="shrink-0" />
        <span>Main Agent</span>
      </div>

      <!-- Sub-Agents -->
      <template v-if="config && config.subAgents.length > 0">
        <div
          class="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
        >
          Sub-Agents
        </div>
        <div
          v-for="agent in config.subAgents"
          :key="agent.slug"
          class="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-[13px] transition-colors"
          :class="
            isSelected({ kind: 'subagent', slug: agent.slug }, selectedItem)
              ? 'bg-card text-primary'
              : 'text-muted-foreground hover:bg-card'
          "
          @click="emit('select', { kind: 'subagent', slug: agent.slug })"
        >
          <Users :size="14" class="shrink-0" />
          <span class="truncate">{{ agent.name }}</span>
        </div>
      </template>

      <!-- Skills -->
      <template v-if="config && config.skills.length > 0">
        <div
          class="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
        >
          Skills
        </div>
        <div
          v-for="skill in config.skills"
          :key="skill.slug"
          class="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-[13px] transition-colors"
          :class="
            isSelected({ kind: 'skill', slug: skill.slug }, selectedItem)
              ? 'bg-card text-primary'
              : 'text-muted-foreground hover:bg-card'
          "
          @click="emit('select', { kind: 'skill', slug: skill.slug })"
        >
          <Wrench :size="14" class="shrink-0" />
          <span class="truncate">{{ skill.name }}</span>
        </div>
      </template>

      <!-- Settings -->
      <template v-if="config && config.settings">
        <div
          class="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
        >
          Project
        </div>
        <div
          class="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-[13px] transition-colors"
          :class="
            isSelected({ kind: 'settings' }, selectedItem)
              ? 'bg-card text-primary'
              : 'text-muted-foreground hover:bg-card'
          "
          @click="emit('select', { kind: 'settings' })"
        >
          <Shield :size="14" class="shrink-0" />
          <span>Permissions</span>
        </div>
      </template>
    </ScrollArea>
  </aside>
</template>
