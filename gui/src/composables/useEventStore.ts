import { ref, computed } from "vue";
import type { JarvisEvent } from "@/types/events";

export function useEventStore() {
  // Current view events
  const events = ref<JarvisEvent[]>([]);

  // Live events persist across view switches
  const liveEvents = ref<JarvisEvent[]>([]);
  const liveCost = ref(0);
  const liveTurns = ref(0);
  const liveAgents = ref(new Set<string>(["main"]));

  // Current view stats
  const totalCost = ref(0);
  const totalTurns = ref(0);
  const knownAgents = ref(new Set<string>(["main"]));

  // View mode
  const isLive = ref(true);

  // Filter state
  const filterType = ref("all");
  const filterAgent = ref("all");
  const searchQuery = ref("");

  const filteredEvents = computed(() => {
    return events.value.filter((event) => {
      if (filterType.value !== "all" && event.type !== filterType.value)
        return false;
      const agent = event._agentName || "main";
      if (filterAgent.value !== "all" && agent !== filterAgent.value)
        return false;
      if (searchQuery.value) {
        const text = JSON.stringify(event).toLowerCase();
        if (!text.includes(searchQuery.value.toLowerCase())) return false;
      }
      return true;
    });
  });

  const agentList = computed(() => Array.from(knownAgents.value).sort());

  function addLiveEvent(event: JarvisEvent) {
    liveEvents.value.push(event);
    if (event.type === "result") {
      liveCost.value += event.total_cost_usd || 0;
      liveTurns.value += event.num_turns || 0;
    }
    if (event._agentName) liveAgents.value.add(event._agentName);

    if (isLive.value) {
      addEventToView(event);
    }
  }

  function addEventToView(event: JarvisEvent) {
    events.value.push(event);
    if (event._agentName) knownAgents.value.add(event._agentName);
    if (event.type === "result") {
      totalCost.value += event.total_cost_usd || 0;
      totalTurns.value += event.num_turns || 0;
    }
  }

  function loadEvents(eventList: JarvisEvent[]) {
    events.value = [];
    totalCost.value = 0;
    totalTurns.value = 0;
    knownAgents.value = new Set(["main"]);

    for (const event of eventList) {
      addEventToView(event);
    }
  }

  function switchToLive() {
    isLive.value = true;
    if (liveEvents.value.length === 0) {
      events.value = [];
      totalCost.value = 0;
      totalTurns.value = 0;
      knownAgents.value = new Set(["main"]);
    } else {
      loadEvents(liveEvents.value);
      totalCost.value = liveCost.value;
      totalTurns.value = liveTurns.value;
      knownAgents.value = new Set(liveAgents.value);
    }
  }

  function switchToHistory() {
    isLive.value = false;
  }

  return {
    events,
    liveEvents,
    filteredEvents,
    isLive,
    totalCost,
    totalTurns,
    knownAgents,
    agentList,
    filterType,
    filterAgent,
    searchQuery,
    addLiveEvent,
    loadEvents,
    switchToLive,
    switchToHistory,
  };
}
