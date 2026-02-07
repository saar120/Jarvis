<script setup lang="ts">
import { ref, computed } from "vue";
import { useWebSocket } from "@/composables/useWebSocket";
import { useEventStore } from "@/composables/useEventStore";
import { useSessions } from "@/composables/useSessions";
import { useAgents } from "@/composables/useAgents";
import type { JarvisEvent } from "@/types/events";

import AppHeader from "@/components/AppHeader.vue";
import SessionSidebar from "@/components/SessionSidebar.vue";
import TimelineToolbar from "@/components/TimelineToolbar.vue";
import EventTimeline from "@/components/EventTimeline.vue";
import AgentSidebar from "@/components/AgentSidebar.vue";
import AgentDetail from "@/components/AgentDetail.vue";

const store = useEventStore();
const sessions = useSessions();
const agents = useAgents();

const { connected } = useWebSocket((event: JarvisEvent) => {
  store.addLiveEvent(event);
});

type AppView = "logs" | "agents";
const activeView = ref<AppView>("logs");

const activeSessionId = ref<string | null>(null);
const loading = ref(false);

function onSwitchView(view: AppView) {
  activeView.value = view;
  if (view === "agents" && !agents.config.value) {
    agents.fetchAgents();
  }
}

function onSelectLive() {
  activeSessionId.value = null;
  store.switchToLive();
}

async function onSelectSession(date: string, sessionId: string) {
  activeSessionId.value = sessionId;
  store.switchToHistory();
  loading.value = true;
  try {
    const events = await sessions.fetchSessionEvents(date, sessionId);
    store.loadEvents(events);
  } catch (err) {
    store.loadEvents([]);
  } finally {
    loading.value = false;
  }
}

const grouped = computed(() => sessions.groupedSessions());
</script>

<template>
  <AppHeader
    :connected="connected"
    :cost="store.totalCost.value"
    :turns="store.totalTurns.value"
    :event-count="store.events.value.length"
    :active-view="activeView"
    @update:active-view="onSwitchView"
  />
  <div class="flex flex-1 overflow-hidden">
    <!-- Logs view -->
    <template v-if="activeView === 'logs'">
      <SessionSidebar
        :grouped-sessions="grouped"
        :active-session-id="activeSessionId"
        :is-live="store.isLive.value"
        @select-live="onSelectLive"
        @select-session="onSelectSession"
      />
      <div class="flex flex-1 flex-col overflow-hidden">
        <TimelineToolbar
          v-model:filter-type="store.filterType.value"
          v-model:filter-agent="store.filterAgent.value"
          v-model:search-query="store.searchQuery.value"
          :agents="store.agentList.value"
        />
        <EventTimeline
          :events="store.filteredEvents.value"
          :is-live="store.isLive.value"
        />
      </div>
    </template>

    <!-- Agents view -->
    <template v-else>
      <AgentSidebar
        :config="agents.config.value"
        :selected-item="agents.selectedItem.value"
        @select="agents.selectItem"
      />
      <AgentDetail
        :config="agents.config.value"
        :selected-item="agents.selectedItem.value"
        :loading="agents.loading.value"
      />
    </template>
  </div>
</template>
