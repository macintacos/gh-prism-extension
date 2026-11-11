import { browser } from "wxt/browser";
import { PR_DATA_PORT } from "@/utils/github/pr-port";
import { yieldToMessages } from "@/utils/structural/engine-script";
import { loadEngineThread } from "@/utils/structural/engine-thread";
import { structuralHost } from "@/utils/structural/host";
import type { StructuralRequest } from "@/utils/structural/request";

/** The port `bench/structural-host.ts` drives through `relay()`. */
export const BENCH_PORT = "gh-prism:bench";

export type BenchMessage =
  | { id: number; op: "state" }
  | { id: number; op: "pings" }
  | { id: number; op: "run"; request: StructuralRequest }
  | { id: number; op: "dropped"; request: StructuralRequest };

/** A host run, timed in the background's `performance.now()` clock. */
export interface RunResult {
  readonly ok: boolean;
  readonly reason?: string;
  readonly start: number;
  readonly end: number;
}

/** A reply to a bench message; `error` replaces `result` when answering it threw. */
export type BenchReply = { id: number; result: unknown } | { id: number; error: string };

/**
 * Bench-only background additions: answers `gh-prism:bench` ports with the engine's load state,
 * host runs timed in the background's clock, and the times it handled PR data port messages.
 */
export function serveBench(): void {
  const host = structuralHost({ loadEngine: loadEngineThread, pause: yieldToMessages });
  const engineExists = engineContextProbe();
  let pingTimes: number[] = [];

  const answer = async (message: BenchMessage) => {
    switch (message.op) {
      case "state":
        return { loaded: await engineExists() };
      case "pings": {
        const handled = pingTimes;
        pingTimes = [];
        return { handled };
      }
      case "run": {
        const start = performance.now();
        const result = await host(message.request, new AbortController().signal);
        return {
          ok: result.ok,
          reason: result.ok ? undefined : result.reason,
          start,
          end: performance.now(),
        } satisfies RunResult;
      }
      case "dropped": {
        const second = new AbortController();
        const first = host(message.request, new AbortController().signal);
        const dropped = host(message.request, second.signal);
        second.abort();
        const [kept, rejected] = await Promise.allSettled([first, dropped]);
        return {
          firstOk: kept.status === "fulfilled" && kept.value.ok,
          secondRejected: rejected.status === "rejected",
        };
      }
    }
  };

  browser.runtime.onConnect.addListener((port) => {
    if (port.name === PR_DATA_PORT)
      port.onMessage.addListener(() => pingTimes.push(performance.now()));
    if (port.name !== BENCH_PORT) return;
    port.onMessage.addListener(async (message: BenchMessage) => {
      const reply: BenchReply = await answer(message).then(
        (result) => ({ id: message.id, result }),
        (error: unknown) => ({ id: message.id, error: String(error) }),
      );
      port.postMessage(reply);
    });
  });
}

/** Reports whether the engine's context exists: Chrome's offscreen document, or Firefox's Worker. */
function engineContextProbe(): () => Promise<boolean> {
  if (import.meta.env.BROWSER !== "firefox")
    return async () =>
      (await browser.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] })).length > 0;

  let constructed = 0;
  globalThis.Worker = class extends Worker {
    constructor(...args: ConstructorParameters<typeof Worker>) {
      super(...args);
      constructed++;
    }
  };
  return async () => constructed > 0;
}
