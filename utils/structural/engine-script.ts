/** The engine script's path in the built extension; `getURL`'s `PublicPath` type checks it. */
export const ENGINE_SCRIPT = "/structural-engine.js";

/** The part of a worker global this module uses. */
interface SchedulerGlobal {
  readonly scheduler: {
    postTask(task: () => void, options: { priority: "background" }): Promise<void>;
  };
}

/** Resolves after queued messages have had a turn: port messages in the background, a cancel in the engine's Worker. */
export function yieldToMessages(): Promise<void> {
  // Measured for port messages on the background's thread: Firefox runs one ahead of a 4 ms
  // timer, but not of postTask. A cancel in the Worker needs only the same macrotask yield.
  if (import.meta.env.BROWSER === "firefox") {
    return new Promise((resolve) => setTimeout(resolve, 4));
  }
  // Measured for port messages on the background's thread: Chrome runs one ahead of a
  // background-priority task, but behind setTimeout(0), MessageChannel, and scheduler.yield().
  // A cancel in the Worker needs only the same macrotask yield.
  return (globalThis as unknown as SchedulerGlobal).scheduler.postTask(() => {}, {
    priority: "background",
  });
}
