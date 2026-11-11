// Reached from background.js and the offscreen page: import the engine and runner only as types, or they are bundled into both.
import type { EngineResult } from "./engine";
import type { EngineRun, StructuralRequest } from "./request";

/** The offscreen document's path in Chrome's build; pass it through `getURL`, whose `PublicPath` type checks it. */
export const OFFSCREEN_PAGE = "/structural-offscreen.html";

/** How long the offscreen document stays open after its last answer. */
export const OFFSCREEN_IDLE_MS = 30_000;

const TO_OFFSCREEN = "gh-prism:structural";
/** What the service worker sends the offscreen document; the tag tells it apart from other runtime messages. */
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
  /** Unique across service worker lives: the document outlives the worker, so a counter would repeat ids still pending there. */
  newId(): string;
}

/**
 * An `EngineRun` that relays each request to the offscreen document, creating the document when
 * none exists, and retrying once when the document closed between the check and the send.
 */
export function offscreenEngine(api: OffscreenApi): EngineRun {
  let ensuring: Promise<void> | undefined;
  /** One existence check and creation at a time, shared by overlapping requests. */
  const ensureDocument = () =>
    (ensuring ??= (async () => {
      if (!(await api.exists())) await api.create();
    })().finally(() => {
      ensuring = undefined;
    }));

  return (request, signal) => {
    if (signal.aborted) return Promise.reject(signal.reason);
    const id = api.newId();
    let sent = false;

    const relayed = (async (): Promise<EngineResult> => {
      try {
        for (const isLastAttempt of [false, true]) {
          await ensureDocument();
          if (signal.aborted) return FAILED;
          sent = true;
          const result = await api.send({ to: TO_OFFSCREEN, id, request }).catch((error) => {
            if (isLastAttempt) throw error;
          });
          if (result) return result;
          if (signal.aborted) return FAILED;
        }
        console.warn("gh-prism: the structural offscreen document closed before answering");
      } catch (error) {
        console.warn("gh-prism: couldn't relay to the structural offscreen document", error);
      }
      return FAILED;
    })();

    const aborted = Promise.withResolvers<never>();
    const onAbort = () => {
      aborted.reject(signal.reason);
      // Best effort: the document answers no cancel, and may already be gone.
      if (sent) api.send({ to: TO_OFFSCREEN, id, cancel: true }).catch(() => {});
    };
    signal.addEventListener("abort", onAbort, { once: true });

    return Promise.race([relayed, aborted.promise]).finally(() =>
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
  const running = new Map<string, AbortController>();
  let cancelClose: (() => void) | undefined = deps.closeWhenIdle(() => deps.close());

  deps.listen((message, fromTab, respond) => {
    // A content script can call runtime.sendMessage, and it shares a renderer with the page.
    if (fromTab || !isToOffscreen(message)) return false;
    if ("cancel" in message) {
      running.get(message.id)?.abort();
      return false;
    }

    cancelClose?.();
    cancelClose = undefined;
    const controller = new AbortController();
    running.set(message.id, controller);

    deps
      .run(message.request, controller.signal)
      .catch((error): EngineResult => {
        if (!controller.signal.aborted) {
          console.warn("gh-prism: the structural engine failed in the offscreen document", error);
        }
        return FAILED;
      })
      .then((result) => {
        running.delete(message.id);
        respond(result);
        if (running.size === 0) cancelClose = deps.closeWhenIdle(() => deps.close());
      });
    return true;
  });
}
