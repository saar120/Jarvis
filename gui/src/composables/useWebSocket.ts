import { ref, onUnmounted } from "vue";
import type { JarvisEvent } from "@/types/events";

export function useWebSocket(onEvent: (event: JarvisEvent) => void) {
  const connected = ref(false);
  let ws: WebSocket | null = null;
  let reconnectDelay = 1000;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  function connect() {
    if (stopped) return;

    ws = new WebSocket(`ws://${location.host}`);

    ws.onopen = () => {
      connected.value = true;
      reconnectDelay = 1000;
    };

    ws.onclose = () => {
      connected.value = false;
      if (!stopped) {
        reconnectTimer = setTimeout(connect, reconnectDelay);
        reconnectDelay = Math.min(reconnectDelay * 2, 10000);
      }
    };

    ws.onerror = () => {
      ws?.close();
    };

    ws.onmessage = (e) => {
      let event: JarvisEvent;
      try {
        event = JSON.parse(e.data);
      } catch {
        return;
      }
      if ((event as unknown as { type: string }).type === "connected") return;
      onEvent(event);
    };
  }

  function stop() {
    stopped = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    ws?.close();
  }

  connect();

  onUnmounted(stop);

  return { connected, stop };
}
