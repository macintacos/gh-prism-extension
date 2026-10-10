import { type PrHead, type PrRef, readPrPageHeadSha } from "./pr-ref";
import type { PrDataSource, PrFileContentResult, PrFilesResult, PrHeadResult } from "./pr-source";

export const PR_DATA_PORT = "gh-prism:pr-data";

export type PrDataRequest =
  | { kind: "head"; pr: PrRef }
  | { kind: "files"; pr: PrHead }
  | { kind: "content"; pr: PrHead; path: string };

type PrDataResult = PrHeadResult | PrFilesResult | PrFileContentResult;

/** The slice of `browser.runtime.Port` both ends use. */
export interface PrDataPort {
  postMessage(message: unknown): void;
  disconnect(): void;
  onMessage: { addListener(listener: (message: unknown) => void): void };
  onDisconnect: { addListener(listener: () => void): void };
}

/**
 * One PR view's access to its diff and file contents.
 *
 * @remarks
 * Open one client per PR view and keep it across soft navigation within the PR. `close()`
 * it on leaving the PR: that cancels in-flight fetches, and calls pending at `close()`
 * never settle. The client reconnects by itself after the service worker stops. It pins
 * the head SHA it resolved, so a push to the PR is picked up only by a new client.
 */
export interface PrDataClient {
  files(): Promise<PrFilesResult>;
  /** Only for a `kind: "text"` entry whose status isn't `deleted`; any other path reads as `no-access`. */
  fileContent(path: string): Promise<PrFileContentResult>;
  close(): void;
}

const NAME = /^[A-Za-z0-9_.-]+$/;
const SHA = /^[0-9a-f]{40}$/;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asPrRef(value: unknown): PrRef | undefined {
  if (!isObject(value)) return undefined;
  const { owner, repo, number } = value;
  if (typeof owner !== "string" || !NAME.test(owner)) return undefined;
  if (typeof repo !== "string" || !NAME.test(repo)) return undefined;
  if (typeof number !== "number" || !Number.isSafeInteger(number) || number < 1) return undefined;
  return { owner, repo, number };
}

function asPrHead(value: unknown): PrHead | undefined {
  const pr = asPrRef(value);
  if (!pr || !isObject(value) || typeof value.headSha !== "string" || !SHA.test(value.headSha))
    return undefined;
  return { ...pr, headSha: value.headSha };
}

function isSafePath(path: unknown): path is string {
  return (
    typeof path === "string" &&
    path.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..")
  );
}

function asRequest(value: unknown): PrDataRequest | undefined {
  if (!isObject(value)) return undefined;
  if (value.kind === "head") {
    const pr = asPrRef(value.pr);
    return pr && { kind: "head", pr };
  }
  const pr = asPrHead(value.pr);
  if (!pr) return undefined;
  if (value.kind === "files") return { kind: "files", pr };
  if (value.kind === "content" && isSafePath(value.path))
    return { kind: "content", pr, path: value.path };
  return undefined;
}

function answer(
  source: PrDataSource,
  request: PrDataRequest,
  signal: AbortSignal,
): Promise<PrDataResult> {
  switch (request.kind) {
    case "head":
      return source.head(request.pr, signal);
    case "files":
      return source.files(request.pr, signal);
    case "content":
      return source.content(request.pr, request.path, signal);
  }
}

/** Answers one content-side port's requests from `source`, aborting its fetches when the port disconnects. */
export function servePrDataPort(port: PrDataPort, source: PrDataSource): void {
  const controller = new AbortController();
  port.onDisconnect.addListener(() => controller.abort());
  port.onMessage.addListener(async (message) => {
    if (!isObject(message) || !Number.isSafeInteger(message.id)) return;
    const request = asRequest(message.request);
    if (!request) return;
    let result: PrDataResult;
    try {
      result = await answer(source, request, controller.signal);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      throw error;
    }
    if (controller.signal.aborted) return;
    try {
      port.postMessage({ id: message.id, result });
    } catch {
      // ponytail: Chrome caps an extension message at 64 MiB; past it, report too-large — send files in chunks if such PRs matter.
      port.postMessage({ id: message.id, result: { ok: false, problem: "too-large" } });
    }
  });
}

/** A {@link PrDataClient} over ports from `connect`; `pageHeadSha` skips the head lookup when the page already names it. */
export function openPrData(
  connect: () => PrDataPort,
  pr: PrRef,
  pageHeadSha: string | undefined,
): PrDataClient {
  let port: PrDataPort | undefined;
  let closed = false;
  let nextId = 0;
  const pending = new Map<number, (result: PrDataResult) => void>();
  let head: Promise<PrHeadResult> | undefined = pageHeadSha
    ? Promise.resolve({ ok: true, headSha: pageHeadSha })
    : undefined;

  function open(): PrDataPort {
    const opened = connect();
    opened.onMessage.addListener((message) => {
      if (!isObject(message) || typeof message.id !== "number") return;
      const settle = pending.get(message.id);
      pending.delete(message.id);
      // Only this extension's background can answer a runtime port.
      settle?.(message.result as PrDataResult);
    });
    opened.onDisconnect.addListener(() => {
      if (port === opened) port = undefined;
      for (const settle of pending.values()) settle({ ok: false, problem: "failed" });
      pending.clear();
    });
    return opened;
  }

  function send<R extends PrDataResult>(request: PrDataRequest): Promise<R> {
    if (closed) return new Promise(() => {});
    port ??= open();
    const id = nextId++;
    const sent = port;
    return new Promise<R>((resolve) => {
      // The background answers each request kind with that kind's result type.
      pending.set(id, resolve as (result: PrDataResult) => void);
      sent.postMessage({ id, request });
    });
  }

  function resolveHead(): Promise<PrHeadResult> {
    if (!head) {
      const lookup = send<PrHeadResult>({ kind: "head", pr });
      head = lookup;
      void lookup.then((result) => {
        if (!result.ok && head === lookup) head = undefined;
      });
    }
    return head;
  }

  async function atHead<R extends PrFilesResult | PrFileContentResult>(
    request: (head: PrHead) => PrDataRequest,
  ): Promise<R | (PrHeadResult & { ok: false })> {
    const resolved = await resolveHead();
    return resolved.ok ? send<R>(request({ ...pr, headSha: resolved.headSha })) : resolved;
  }

  return {
    files: () => atHead<PrFilesResult>((head) => ({ kind: "files", pr: head })),
    fileContent: (path) =>
      atHead<PrFileContentResult>((head) => ({ kind: "content", pr: head, path })),
    close() {
      closed = true;
      pending.clear();
      port?.disconnect();
      port = undefined;
    },
  };
}

/** The content side's {@link PrDataClient} for `pr`; see its remarks for the client's lifetime. */
export function connectPrData(pr: PrRef): PrDataClient {
  return openPrData(
    () => browser.runtime.connect({ name: PR_DATA_PORT }),
    pr,
    readPrPageHeadSha(document, pr),
  );
}
