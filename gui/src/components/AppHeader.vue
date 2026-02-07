<script setup lang="ts">
defineProps<{
  connected: boolean;
  cost: number;
  turns: number;
  eventCount: number;
  activeView: "logs" | "agents";
}>();

defineEmits<{
  "update:activeView": [value: "logs" | "agents"];
}>();
</script>

<template>
  <header
    class="flex items-center justify-between border-b border-border bg-[hsl(228,20%,8%)] px-5 py-3 shrink-0"
  >
    <div class="flex items-center gap-3">
      <span
        class="h-2 w-2 rounded-full transition-colors duration-300"
        :class="connected ? 'bg-green-400' : 'bg-red-400'"
      />
      <h1 class="text-base font-semibold text-foreground">Jarvis</h1>
      <nav class="ml-3 flex gap-1">
        <button
          v-for="tab in ([
            { id: 'logs' as const, label: 'Logs' },
            { id: 'agents' as const, label: 'Agents' },
          ])"
          :key="tab.id"
          class="rounded-md px-3 py-1 text-[13px] font-medium transition-colors"
          :class="
            activeView === tab.id
              ? 'bg-card text-foreground'
              : 'text-muted-foreground hover:text-foreground'
          "
          @click="$emit('update:activeView', tab.id)"
        >
          {{ tab.label }}
        </button>
      </nav>
    </div>
    <div v-if="activeView === 'logs'" class="flex gap-4 font-mono text-[13px] text-muted-foreground">
      <span class="flex items-center gap-1">
        <span class="text-muted-foreground/60">Cost:</span>
        ${{ cost.toFixed(4) }}
      </span>
      <span class="flex items-center gap-1">
        <span class="text-muted-foreground/60">Turns:</span>
        {{ turns }}
      </span>
      <span class="flex items-center gap-1">
        <span class="text-muted-foreground/60">Events:</span>
        {{ eventCount }}
      </span>
    </div>
  </header>
</template>
