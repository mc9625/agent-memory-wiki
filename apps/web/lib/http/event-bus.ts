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

/**
 * One bus per process, rather than one per module instance.
 *
 * Next compiles server components and route handlers into separate module
 * graphs, so a plain module-level singleton is constructed twice: a page view
 * published into the bus the RSC bundle owns, while the SSE route was
 * subscribed to the one its own bundle owns. Nothing crossed. The visible
 * symptom was a visitor's avatar arriving in the hub — that first event came
 * from the archive replay — and then never walking to READ, because the
 * `article_opened` that followed reached a bus nobody was listening to.
 *
 * Hanging it off `globalThis` under a registered symbol is what makes the two
 * halves the same object. It survives dev's hot reload for the same reason.
 * Cross-instance delivery in production is a separate problem, and the ntfy
 * fan-out in `broadcaster.ts` is what answers that one.
 */
const BUS_KEY = Symbol.for("agent-memory-wiki.live-event-bus");

type BusHolder = { [BUS_KEY]?: LiveEventBus };

const holder = globalThis as BusHolder;

export const liveEventBus: LiveEventBus = holder[BUS_KEY] ?? (holder[BUS_KEY] = new LiveEventBus());
