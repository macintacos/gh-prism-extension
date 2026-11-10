// Background side: import the engine and runner only as types; a value import bundles them into background.js.
import { browser } from "wxt/browser";
import type { EngineRun } from "./request";

/** The engine script's path in the built extension; `getURL`'s `PublicPath` type checks it. */
export const ENGINE_SCRIPT = "/structural-engine.js";

/** The global the engine script assigns its `EngineRun` to. */
export const ENGINE_GLOBAL = "__ghPrismStructural";

/** The parts of Chrome's service worker global this module uses. */
interface WorkerGlobal {
  importScripts(url: string): void;
  addEventListener(type: "install", listener: () => void): void;
  readonly scheduler: {
    postTask(task: () => void, options: { priority: "background" }): Promise<void>;
  };
}

const worker = () => globalThis as unknown as WorkerGlobal;
const engineUrl = () => browser.runtime.getURL(ENGINE_SCRIPT);

/** Chrome only: lets later worker lives import the engine script on demand. Call during the worker's first evaluation. */
export function precacheEngineScript(): void {
  if (import.meta.env.BROWSER === "firefox") return;
  // Chrome refuses importScripts of a script the worker did not import while installing.
  worker().addEventListener("install", () => {
    try {
      worker().importScripts(engineUrl());
    } catch (error) {
      console.warn("gh-prism: couldn't precache the structural engine script", error);
    }
  });
}

/** Loads the engine script if this background has not yet, and returns its `EngineRun`. */
export async function loadEngineScript(): Promise<EngineRun> {
  const global = globalThis as Record<string, unknown>;
  // importScripts re-evaluates the script on every call.
  if (!global[ENGINE_GLOBAL]) {
    if (import.meta.env.BROWSER === "firefox") await appendScript(engineUrl());
    else worker().importScripts(engineUrl());
  }

  const run = global[ENGINE_GLOBAL];
  if (!run) throw new Error("gh-prism: the engine script set no entry");
  return run as EngineRun;
}

/** Resolves after queued port messages have had a turn. */
export function yieldToMessages(): Promise<void> {
  // Firefox runs a port message ahead of a 4 ms timer, but not of postTask.
  if (import.meta.env.BROWSER === "firefox") {
    return new Promise((resolve) => setTimeout(resolve, 4));
  }
  // Chrome runs a port message ahead of a background-priority task, but behind setTimeout(0),
  // MessageChannel, and scheduler.yield().
  return worker().scheduler.postTask(() => {}, { priority: "background" });
}

/** Appends a script element for `url` to the document's head and resolves once it loads. */
function appendScript(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = url;
    script.addEventListener("load", () => resolve());
    script.addEventListener("error", () => {
      script.remove();
      reject(new Error("gh-prism: the engine script failed to load"));
    });
    document.head.append(script);
  });
}
