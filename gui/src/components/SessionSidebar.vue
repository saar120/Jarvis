<script setup lang="ts">
import type { SessionInfo } from "@/types/events";
import ScrollArea from "./ui/ScrollArea.vue";

defineProps<{
  groupedSessions: [string, SessionInfo[]][];
  activeSessionId: string | null;
  isLive: boolean;
}>();

const emit = defineEmits<{
  selectLive: [];
  selectSession: [date: string, sessionId: string];
}>();
</script>

<template>
  <aside class="flex w-[260px] shrink-0 flex-col border-r border-border bg-[hsl(228,20%,8%)]">
    <div
      class="border-b border-border px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground"
    >
      Sessions
    </div>
    <ScrollArea class="flex-1 p-2">
      <!-- Live session item -->
      <div
        class="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-[13px] transition-colors"
        :class="
          isLive
            ? 'bg-card text-primary'
            : 'text-muted-foreground hover:bg-card'
        "
        @click="emit('selectLive')"
      >
        <span class="h-1.5 w-1.5 shrink-0 rounded-full bg-green-400" />
        <span>Live</span>
      </div>

      <!-- Historical sessions grouped by date -->
      <template v-for="[date, dateSessions] in groupedSessions" :key="date">
        <div
          class="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
        >
          {{ date }}
        </div>
        <div
          v-for="session in dateSessions"
          :key="session.sessionId"
          class="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-[13px] transition-colors"
          :class="
            activeSessionId === session.sessionId
              ? 'bg-card text-primary'
              : 'text-muted-foreground hover:bg-card'
          "
          @click="emit('selectSession', session.date, session.sessionId)"
        >
          <span class="truncate font-mono text-xs">
            {{ session.sessionId.slice(0, 12) }}...
          </span>
        </div>
      </template>
    </ScrollArea>
  </aside>
</template>
