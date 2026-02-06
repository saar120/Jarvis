<script setup lang="ts">
import { ref, watch, nextTick } from "vue";
import type { JarvisEvent } from "@/types/events";
import EventCard from "./EventCard.vue";

const props = defineProps<{
  events: JarvisEvent[];
  isLive: boolean;
}>();

const timelineEl = ref<HTMLElement | null>(null);
let autoScroll = true;

function onScroll() {
  if (!timelineEl.value) return;
  const el = timelineEl.value;
  autoScroll = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
}

// Auto-scroll when new events arrive in live mode
watch(
  () => props.events.length,
  async () => {
    if (autoScroll && props.isLive) {
      await nextTick();
      if (timelineEl.value) {
        timelineEl.value.scrollTop = timelineEl.value.scrollHeight;
      }
    }
  }
);
</script>

<template>
  <div
    ref="timelineEl"
    class="flex-1 overflow-y-auto scroll-smooth p-3 px-4"
    @scroll="onScroll"
  >
    <!-- Empty state -->
    <div
      v-if="events.length === 0"
      class="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground"
    >
      <div class="text-3xl opacity-50">&#9678;</div>
      <div class="text-[15px] font-medium">
        {{ isLive ? "Waiting for events" : "No events" }}
      </div>
      <div v-if="isLive" class="text-[13px]">
        Send a message to Jarvis to see live events here
      </div>
    </div>

    <!-- Event cards -->
    <EventCard v-for="(event, i) in events" :key="i" :event="event" />
  </div>
</template>
