<script setup lang="ts">
import { computed } from "vue";
import type { JarvisEvent } from "@/types/events";
import { contentText } from "@/lib/utils";

const props = defineProps<{
  event: JarvisEvent;
}>();

// Detail sections as array of { label, content, isError? } for rendering
const sections = computed(() => {
  const ev = props.event;
  const parts: { label: string; content: string; isError?: boolean }[] = [];

  if (ev.type === "system" && ev.subtype === "init") {
    parts.push({ label: "Session", content: ev.session_id || "" });
    parts.push({ label: "Model", content: ev.model || "" });
    parts.push({
      label: `Tools (${ev.tools?.length ?? 0})`,
      content: (ev.tools || []).join(", "),
    });
    return parts;
  }

  if (ev.type === "system") {
    if (ev.hook_name) parts.push({ label: "Hook", content: ev.hook_name });
    if (ev.output) parts.push({ label: "Output", content: ev.output });
    if (ev.exit_code !== undefined)
      parts.push({ label: "Exit Code", content: String(ev.exit_code) });
    if (parts.length === 0)
      parts.push({ label: "Raw", content: JSON.stringify(ev, null, 2) });
    return parts;
  }

  if (ev.type === "assistant") {
    const content = ev.message?.content;
    if (content) {
      for (const block of content) {
        if (block.type === "text") {
          parts.push({ label: "Text", content: block.text || "" });
        }
        if (block.type === "tool_use") {
          parts.push({
            label: `Tool: ${block.name}`,
            content: JSON.stringify(block.input, null, 2),
          });
        }
      }
    }
    const usage = ev.message?.usage;
    if (usage) {
      let tokenStr = `in: ${usage.input_tokens || 0}, out: ${usage.output_tokens || 0}`;
      if (usage.cache_read_input_tokens)
        tokenStr += `, cache_read: ${usage.cache_read_input_tokens}`;
      if (usage.cache_creation_input_tokens)
        tokenStr += `, cache_create: ${usage.cache_creation_input_tokens}`;
      parts.push({ label: "Tokens", content: tokenStr });
    }
    return parts;
  }

  if (ev.type === "user") {
    const msg = ev.message?.content;
    if (msg) {
      for (const block of msg) {
        const text = contentText(block.content || block.text || "");
        parts.push({
          label: block.is_error ? "Error Result" : "Result",
          content: text,
          isError: !!block.is_error,
        });
      }
    }
    if (ev.tool_use_result?.stdout) {
      parts.push({ label: "Stdout", content: ev.tool_use_result.stdout });
    }
    if (ev.tool_use_result?.stderr) {
      parts.push({
        label: "Stderr",
        content: ev.tool_use_result.stderr,
        isError: true,
      });
    }
    if (parts.length === 0)
      parts.push({ label: "Raw", content: JSON.stringify(ev, null, 2) });
    return parts;
  }

  if (ev.type === "result") {
    // Stats line handled separately in template
    if (ev.result) {
      parts.push({ label: "Result", content: ev.result.slice(0, 2000) });
    }
    if (ev.permission_denials && ev.permission_denials.length > 0) {
      parts.push({
        label: "Permission Denials",
        content: JSON.stringify(ev.permission_denials, null, 2),
        isError: true,
      });
    }
    return parts;
  }

  parts.push({ label: "Raw", content: JSON.stringify(ev, null, 2) });
  return parts;
});
</script>

<template>
  <!-- Result stats bar -->
  <div
    v-if="event.type === 'result'"
    class="flex gap-4 py-1 font-mono text-xs text-muted-foreground"
  >
    <span>Turns: {{ event.num_turns || 0 }}</span>
    <span>Duration: {{ ((event.duration_ms || 0) / 1000).toFixed(1) }}s</span>
    <span>API: {{ ((event.duration_api_ms || 0) / 1000).toFixed(1) }}s</span>
    <span>Cost: ${{ (event.total_cost_usd || 0).toFixed(4) }}</span>
  </div>

  <!-- Detail sections -->
  <div v-for="(section, i) in sections" :key="i">
    <div
      class="mt-2 text-[11px] font-semibold uppercase tracking-wider first:mt-0"
      :class="section.isError ? 'text-red-400' : 'text-muted-foreground'"
    >
      {{ section.label }}
    </div>
    <pre
      class="my-1 max-h-[300px] overflow-auto whitespace-pre-wrap break-all rounded border border-border bg-background p-2 font-mono text-xs"
      :class="section.isError ? 'text-red-400' : 'text-muted-foreground'"
    >{{ section.content }}</pre>
  </div>
</template>
