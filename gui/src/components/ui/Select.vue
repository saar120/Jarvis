<script setup lang="ts">
import { cn } from "@/lib/utils";

defineProps<{
  modelValue?: string;
  class?: string;
}>();

defineEmits<{
  "update:modelValue": [value: string];
}>();
</script>

<template>
  <select
    :class="
      cn(
        'h-8 cursor-pointer rounded-md border border-border bg-card px-2.5 py-1 text-[13px] text-foreground focus:outline-none focus:ring-1 focus:ring-ring',
        $props.class
      )
    "
    :value="modelValue"
    @change="$emit('update:modelValue', ($event.target as HTMLSelectElement).value)"
  >
    <slot />
  </select>
</template>
