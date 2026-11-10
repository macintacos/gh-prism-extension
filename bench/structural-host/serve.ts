import { browser } from "wxt/browser";
import { PR_DATA_PORT } from "@/utils/github/pr-port";
import { ENGINE_GLOBAL, loadEngineScript, yieldToMessages } from "@/utils/structural/engine-script";
import { structuralHost } from "@/utils/structural/host";
import type { StructuralRequest } from "@/utils/structural/request";

/** The port `bench/structural-host.ts` drives through `relay()`. */
export const BENCH_PORT = "gh-prism:bench";

type BenchMessage =
  | { id: number; op: "state" }
  | { id: number; op: "pings" }
  | { id: number; op: "run"; request: StructuralRequest }
  | { id: number; op: "dropped"; request: StructuralRequest };

/**
 * Bench-only background additions: answers `gh-prism:bench` ports with the engine's load state,
 * host runs timed in the background's clock, and the times it handled PR data port messages.
 */
export function serveBench(): void {
  const host = structuralHost({ loadEngine: loadEngineScript, pause: yieldToMessages });
  let pings: number[] = [];

  const answer = async (message: BenchMessage) => {
    if (message.op === "state") return { loaded: Boolean(Reflect.get(globalThis, ENGINE_GLOBAL)) };
    if (message.op === "pings") {
      const handled = pings;
      pings = [];
      return { handled };
    }
    if (message.op === "run") {
      const start = performance.now();
      const result = await host(message.request, new AbortController().signal);
      return {
        ok: result.ok,
        reason: result.ok ? undefined : result.reason,
        start,
        end: performance.now(),
      };
    }
    const second = new AbortController();
    const first = host(message.request, new AbortController().signal);
    const dropped = host(message.request, second.signal);
    second.abort();
    const [kept, rejected] = await Promise.allSettled([first, dropped]);
    return {
      firstOk: kept.status === "fulfilled" && kept.value.ok,
      secondRejected: rejected.status === "rejected",
    };
  };

  browser.runtime.onConnect.addListener((port) => {
    if (port.name === PR_DATA_PORT) port.onMessage.addListener(() => pings.push(performance.now()));
    if (port.name !== BENCH_PORT) return;
    port.onMessage.addListener(async (message: BenchMessage) => {
      port.postMessage({ id: message.id, result: await answer(message) });
    });
  });
}
