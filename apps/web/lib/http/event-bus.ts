import type { SkyEvent } from "../../components/sky-canvas";

type EventListener = (event: SkyEvent) => void;

class LiveEventBus {
  readonly #listeners = new Set<EventListener>();

  public subscribe(listener: EventListener): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  public publish(event: SkyEvent): void {
    for (const listener of this.#listeners) {
      try {
        listener(event);
      } catch (err) {
        console.error("[LiveEventBus] Subscriber error:", err);
      }
    }
  }

  public get subscriberCount(): number {
    return this.#listeners.size;
  }
}

export const liveEventBus = new LiveEventBus();
