<script setup lang="ts">
import Select from "./ui/Select.vue";
import Input from "./ui/Input.vue";

defineProps<{
  filterType: string;
  filterAgent: string;
  searchQuery: string;
  agents: string[];
}>();

defineEmits<{
  "update:filterType": [value: string];
  "update:filterAgent": [value: string];
  "update:searchQuery": [value: string];
}>();
</script>

<template>
  <div class="flex shrink-0 items-center gap-3 border-b border-border px-4 py-2.5">
    <Select
      :model-value="filterType"
      @update:model-value="$emit('update:filterType', $event)"
    >
      <option value="all">All types</option>
      <option value="system">System</option>
      <option value="assistant">Assistant</option>
      <option value="user">User</option>
      <option value="result">Result</option>
    </Select>

    <Select
      :model-value="filterAgent"
      @update:model-value="$emit('update:filterAgent', $event)"
    >
      <option value="all">All agents</option>
      <option v-for="agent in agents" :key="agent" :value="agent">
        {{ agent }}
      </option>
    </Select>

    <Input
      :model-value="searchQuery"
      placeholder="Search events..."
      class="min-w-0 flex-1"
      @update:model-value="$emit('update:searchQuery', $event)"
    />
  </div>
</template>
