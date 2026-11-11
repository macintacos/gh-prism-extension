/** The engine script's path in the built extension; `getURL`'s `PublicPath` type checks it. */
export const ENGINE_SCRIPT = "/structural-engine.js";

/** The part of a worker global this module uses. */
interface WorkerGlobal {
  readonly scheduler: {
    postTask(task: () => void, options: { priority: "background" }): Promise<void>;
  };
}

/** Resolves after queued port messages have had a turn. */
export function yieldToMessages(): Promise<void> {
  // Firefox runs a port message ahead of a 4 ms timer, but not of postTask.
  if (import.meta.env.BROWSER === "firefox") {
    return new Promise((resolve) => setTimeout(resolve, 4));
  }
  // Chrome runs a port message ahead of a background-priority task, but behind setTimeout(0),
  // MessageChannel, and scheduler.yield().
  return (globalThis as unknown as WorkerGlobal).scheduler.postTask(() => {}, {
    priority: "background",
  });
}
