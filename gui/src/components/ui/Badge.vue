<script setup lang="ts">
import { computed } from "vue";
import { cn } from "@/lib/utils";

const props = withDefaults(
  defineProps<{
    variant?: "default" | "agent-main" | "agent-sub";
  }>(),
  { variant: "default" }
);

const classes = computed(() =>
  cn(
    "inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
    {
      "bg-primary/15 text-primary": props.variant === "default",
      "bg-blue-400/15 text-blue-400": props.variant === "agent-main",
      "bg-orange-400/15 text-orange-400": props.variant === "agent-sub",
    }
  )
);
</script>

<template>
  <span :class="classes"><slot /></span>
</template>
