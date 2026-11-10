// Background side: import the engine and runner only as types; a value import bundles them into background.js.
import type { EngineResult } from "./engine";
import type { EngineRun, StructuralRequest } from "./request";

/** The offscreen document's path in Chrome's build; pass it through `getURL`, whose `PublicPath` type checks it. */
export const OFFSCREEN_PAGE = "/structural-offscreen.html";

const TO_OFFSCREEN = "gh-prism:structural";
export type ToOffscreen =
  | { to: typeof TO_OFFSCREEN; id: string; request: StructuralRequest }
  | { to: typeof TO_OFFSCREEN; id: string; cancel: true };

const FAILED: EngineResult = { ok: false, reason: "failed" };

/** What the service worker side needs from Chrome. */
export interface OffscreenApi {
  exists(): Promise<boolean>;
  create(): Promise<void>;
  /** Resolves with the document's response, or `undefined` when it closed before answering. */
  send(message: ToOffscreen): Promise<EngineResult | undefined>;
  newId(): string;
}

/**
 * An `EngineRun` that relays each request to the offscreen document, creating the document when
 * none exists. Call it through `structuralHost`: two overlapping calls would both create it.
 */
export function offscreenEngine(api: OffscreenApi): EngineRun {
  return (request, signal) => {
    if (signal.aborted) return Promise.reject(signal.reason);
    const id = api.newId();

    const relayed = (async (): Promise<EngineResult> => {
      try {
        if (!(await api.exists())) await api.create();
        const result = await api.send({ to: TO_OFFSCREEN, id, request });
        if (result) return result;
        console.warn("gh-prism: the structural offscreen document closed before answering");
      } catch (error) {
        console.warn("gh-prism: couldn't relay to the structural offscreen document", error);
      }
      return FAILED;
    })();

    let onAbort = () => {};
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => {
        reject(signal.reason);
        // The document answers no cancel, so Chrome rejects this send every time.
        api.send({ to: TO_OFFSCREEN, id, cancel: true }).catch(() => {});
      };
      signal.addEventListener("abort", onAbort, { once: true });
    });

    return Promise.race([relayed, aborted]).finally(() =>
      signal.removeEventListener("abort", onAbort),
    );
  };
}

/** What the offscreen document needs from its page. */
export interface OffscreenDeps {
  readonly run: EngineRun;
  /** Registers the message handler; it returns true when it will call `respond`. */
  listen(
    handler: (
      message: unknown,
      fromTab: boolean,
      respond: (result: EngineResult) => void,
    ) => boolean,
  ): void;
  /** Calls `close` after the idle period; the returned function cancels it. */
  closeWhenIdle(close: () => void): () => void;
  close(): void;
}

function isToOffscreen(message: unknown): message is ToOffscreen {
  return (
    typeof message === "object" &&
    message !== null &&
    "to" in message &&
    message.to === TO_OFFSCREEN
  );
}

/** Answers relayed requests with `run`, and closes the document once it has been idle. */
export function serveOffscreen(deps: OffscreenDeps): void {
  const pending = new Map<string, AbortController>();
  let cancelClose: (() => void) | undefined;

  deps.listen((message, fromTab, respond) => {
    if (fromTab || !isToOffscreen(message)) return false;
    if ("cancel" in message) {
      pending.get(message.id)?.abort();
      return false;
    }

    cancelClose?.();
    cancelClose = undefined;
    const controller = new AbortController();
    pending.set(message.id, controller);

    deps
      .run(message.request, controller.signal)
      .catch((): EngineResult => FAILED)
      .then((result) => {
        pending.delete(message.id);
        respond(result);
        if (pending.size === 0) cancelClose = deps.closeWhenIdle(() => deps.close());
      });
    return true;
  });
}
