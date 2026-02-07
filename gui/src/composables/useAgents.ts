import { ref } from "vue";
import type { AgentsConfig, AgentNavItem } from "@/types/agents";

export function useAgents() {
  const config = ref<AgentsConfig | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const selectedItem = ref<AgentNavItem>({ kind: "main" });

  async function fetchAgents() {
    loading.value = true;
    error.value = null;
    try {
      const res = await fetch("/api/agents");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      config.value = await res.json();
    } catch (err) {
      error.value = (err as Error).message;
    } finally {
      loading.value = false;
    }
  }

  function selectItem(item: AgentNavItem) {
    selectedItem.value = item;
  }

  return { config, loading, error, selectedItem, fetchAgents, selectItem };
}
