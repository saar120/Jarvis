<script setup lang="ts">
import { ref, computed } from "vue";
import type { JarvisEvent, MessageContent } from "@/types/events";
import { contentText } from "@/lib/utils";
import Badge from "./ui/Badge.vue";

const props = defineProps<{
  event: JarvisEvent;
}>();

const expanded = ref(false);

const time = computed(() => {
  if (!props.event._timestamp) return "--:--:--";
  return new Date(props.event._timestamp).toLocaleTimeString();
});

const agent = computed(() => props.event._agentName || "main");

const badgeVariant = computed(() =>
  agent.value === "main" ? "agent-main" as const : "agent-sub" as const
);

const typeColorClass = computed(() => {
  const t = props.event.type;
  if (t === "system") return "text-slate-400";
  if (t === "assistant") return "text-sky-400";
  if (t === "user") return "text-lime-400";
  if (t === "result" && props.event.is_error) return "text-red-400";
  if (t === "result") return "text-green-400";
  return "text-muted-foreground";
});

const bgClass = computed(() => {
  const t = props.event.type;
  if (t === "system") return "hover:border-border bg-slate-400/[0.04]";
  if (t === "assistant") return "hover:border-border bg-sky-400/[0.04]";
  if (t === "user") return "hover:border-border bg-lime-400/[0.04]";
  if (t === "result" && props.event.is_error)
    return "hover:border-border bg-red-400/[0.06]";
  if (t === "result") return "hover:border-border bg-green-400/[0.06]";
  return "hover:border-border";
});

const typeLabel = computed(() => {
  const ev = props.event;
  if (ev.type === "system") return `system/${ev.subtype || "?"}`;
  if (ev.type === "assistant") {
    const content = ev.message?.content;
    if (content) {
      for (const block of content) {
        if (block.type === "tool_use") return "tool_use";
      }
    }
    return "text";
  }
  if (ev.type === "user") return "tool_result";
  if (ev.type === "result") return ev.is_error ? "result (error)" : "result";
  return ev.type;
});

const isToolUse = computed(() => {
  if (props.event.type !== "assistant") return false;
  return props.event.message?.content?.some((c) => c.type === "tool_use") ?? false;
});

const summary = computed(() => {
  const ev = props.event;
  if (ev.type === "system" && ev.subtype === "init") {
    return `model: ${ev.model || "?"}, tools: ${ev.tools?.length ?? 0}`;
  }
  if (ev.type === "system") {
    return ev.hook_name || ev.subtype || "";
  }
  if (ev.type === "assistant") {
    const content = ev.message?.content;
    if (!content) return "";
    for (const block of content) {
      if (block.type === "tool_use") {
        const input = block.input || {};
        let preview = "";
        if (block.name === "Bash" && input.command)
          preview = String(input.command);
        else if (block.name === "Task" && input.subagent_type)
          preview = `agent: ${input.subagent_type}`;
        else if (block.name === "Read" && input.file_path)
          preview = String(input.file_path);
        else if (block.name === "Write" && input.file_path)
          preview = String(input.file_path);
        else if (block.name === "Edit" && input.file_path)
          preview = String(input.file_path);
        else if (block.name === "Grep" && input.pattern)
          preview = `/${input.pattern}/`;
        else if (block.name === "Glob" && input.pattern)
          preview = String(input.pattern);
        else preview = JSON.stringify(input).slice(0, 80);
        return `${block.name}: ${preview}`;
      }
      if (block.type === "text") {
        return (block.text || "").slice(0, 120);
      }
    }
    return "";
  }
  if (ev.type === "user") {
    const msg = ev.message?.content;
    if (msg && msg.length > 0) {
      const first = msg[0] as MessageContent;
      const text = contentText(first.content || first.text || "");
      if (first.is_error) return `(error) ${text.slice(0, 100)}`;
      return text.slice(0, 100);
    }
    return "";
  }
  if (ev.type === "result") {
    return `${ev.num_turns || 0} turns, ${((ev.duration_ms || 0) / 1000).toFixed(1)}s, $${(ev.total_cost_usd || 0).toFixed(4)}`;
  }
  return "";
});
</script>

<template>
  <div
    class="mb-1 overflow-hidden rounded-md border border-transparent transition-colors"
    :class="bgClass"
  >
    <!-- Header (clickable) -->
    <div
      class="flex cursor-pointer select-none items-center gap-2 px-3 py-[7px] text-[13px]"
      @click="expanded = !expanded"
    >
      <span class="w-[70px] shrink-0 font-mono text-[11px] text-muted-foreground">
        {{ time }}
      </span>
      <Badge :variant="badgeVariant">{{ agent }}</Badge>
      <span class="shrink-0 font-mono text-xs" :class="typeColorClass">
        <template v-if="isToolUse">
          <span class="font-semibold text-sky-400">tool_use</span>
        </template>
        <template v-else>{{ typeLabel }}</template>
      </span>
      <span
        class="min-w-0 flex-1 truncate text-[13px] text-muted-foreground"
      >
        {{ summary }}
      </span>
      <span
        class="shrink-0 text-[10px] text-muted-foreground transition-transform duration-150"
        :class="{ 'rotate-90': expanded }"
      >
        &#9654;
      </span>
    </div>

    <!-- Detail (expandable) -->
    <div v-if="expanded" class="pb-2.5 pl-[90px] pr-3 text-[13px] leading-relaxed">
      <slot name="detail">
        <EventDetail :event="event" />
      </slot>
    </div>
  </div>
</template>

<script lang="ts">
import EventDetail from "./EventDetail.vue";
</script>
