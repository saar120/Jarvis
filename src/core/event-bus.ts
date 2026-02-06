import { EventEmitter } from "node:events";
import type { StreamEvent } from "./event-types.js";

class JarvisEventBus extends EventEmitter {
  emitEvent(event: StreamEvent): void {
    this.emit("event", event);
  }

  onEvent(listener: (event: StreamEvent) => void): void {
    this.on("event", listener);
  }

  offEvent(listener: (event: StreamEvent) => void): void {
    this.off("event", listener);
  }
}

export const eventBus = new JarvisEventBus();
