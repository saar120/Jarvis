import { ref, onUnmounted } from "vue";
import type { SessionInfo } from "@/types/events";

export function useSessions() {
  const sessions = ref<SessionInfo[]>([]);
  let intervalId: ReturnType<typeof setInterval> | null = null;

  async function fetchSessions() {
    try {
      const res = await fetch("/api/sessions");
      if (res.ok) {
        sessions.value = await res.json();
      }
    } catch {
      // Silently ignore fetch errors
    }
  }

  async function fetchSessionEvents(date: string, sessionId: string) {
    const res = await fetch(`/api/session/${date}/${sessionId}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  // Group sessions by date
  function groupedSessions() {
    const byDate: Record<string, SessionInfo[]> = {};
    for (const s of sessions.value) {
      if (!byDate[s.date]) byDate[s.date] = [];
      byDate[s.date].push(s);
    }
    return Object.entries(byDate).sort(([a], [b]) => b.localeCompare(a));
  }

  // Load on init and refresh every 30s
  fetchSessions();
  intervalId = setInterval(fetchSessions, 30000);

  onUnmounted(() => {
    if (intervalId) clearInterval(intervalId);
  });

  return {
    sessions,
    fetchSessions,
    fetchSessionEvents,
    groupedSessions,
  };
}
