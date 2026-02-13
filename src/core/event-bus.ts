import { EventEmitter } from "node:events";
import type { JarvisEvent } from "./agent.js";

class JarvisEventBus extends EventEmitter {
  emitEvent(event: JarvisEvent): void {
    this.emit("event", event);
  }

  onEvent(listener: (event: JarvisEvent) => void): void {
    this.on("event", listener);
  }

  offEvent(listener: (event: JarvisEvent) => void): void {
    this.off("event", listener);
  }
}

export const eventBus = new JarvisEventBus();
