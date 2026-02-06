<script setup lang="ts">
defineProps<{
  connected: boolean;
  cost: number;
  turns: number;
  eventCount: number;
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
      <h1 class="text-base font-semibold text-foreground">Jarvis Log Viewer</h1>
    </div>
    <div class="flex gap-4 font-mono text-[13px] text-muted-foreground">
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
