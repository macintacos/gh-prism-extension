import {
  type CommitHead,
  type DiffHead,
  type DiffRef,
  isCommitSha,
  isPrHeadSha,
  type PrHead,
  type PrRef,
  readPrPageHeadSha,
} from "./pr-ref";
import type {
  PrDataSource,
  PrFailure,
  PrFileContentResult,
  PrFilesResult,
  PrHeadResult,
} from "./pr-source";

export const PR_DATA_PORT = "gh-prism:pr-data";

export type PrDataRequest =
  | { kind: "head"; pr: PrRef }
  | { kind: "files"; pr: DiffHead }
  | { kind: "content"; pr: DiffHead; path: string };

type PrDataResultsByKind = {
  head: PrHeadResult;
  files: PrFilesResult;
  content: PrFileContentResult;
};
type PrDataResult = PrDataResultsByKind[PrDataRequest["kind"]];

/** The slice of `browser.runtime.Port` both ends use. */
export interface PrDataPort {
  postMessage(message: unknown): void;
  disconnect(): void;
  onMessage: { addListener(listener: (message: unknown) => void): void };
  onDisconnect: { addListener(listener: () => void): void };
}

/**
 * One PR or commit view's access to its diff and file contents.
 *
 * @remarks
 * Open one client per view and `close()` it when the view goes away: that cancels in-flight
 * fetches, and calls pending at or made after `close()` never settle. The worker keeps one head's
 * diff and file contents per PR, so reconnecting for the same head is cheap. When the service
 * worker stops, calls in flight settle `failed`; the next call reconnects. The client pins its
 * head SHA, and the page's embedded SHA is the last full page load's, so a push is reliably
 * picked up only after a reload.
 */
export interface PrDataClient {
  /** The commit the diff ends on, which `files` and `fileContent` read at. */
  head(): Promise<PrHeadResult>;
  files(): Promise<PrFilesResult>;
  /**
   * Only for a `kind: "text"` entry whose status isn't `deleted`; any other path reads as
   * `no-access`.
   */
  fileContent(path: string): Promise<PrFileContentResult>;
  close(): void;
}

// A content script shares a renderer with the page, so its messages are untrusted.
const OWNER_OR_REPO = /^[A-Za-z0-9_.-]+$/;
const FAILED: PrFailure = { ok: false, problem: "failed" };

function isOwnerOrRepo(value: unknown): value is string {
  return typeof value === "string" && OWNER_OR_REPO.test(value) && value !== "." && value !== "..";
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asPrRef(value: unknown): PrRef | undefined {
  if (!isObject(value)) return undefined;
  const { owner, repo, number } = value;
  if (!isOwnerOrRepo(owner) || !isOwnerOrRepo(repo)) return undefined;
  if (typeof number !== "number" || !Number.isSafeInteger(number) || number < 1) return undefined;
  return { owner, repo, number };
}

function asPrHead(value: unknown): PrHead | undefined {
  const pr = asPrRef(value);
  if (!pr || !isObject(value) || !isPrHeadSha(value.headSha)) return undefined;
  return { ...pr, headSha: value.headSha };
}

function asCommitHead(value: unknown): CommitHead | undefined {
  if (!isObject(value)) return undefined;
  const { owner, repo, headSha } = value;
  if (!isOwnerOrRepo(owner) || !isOwnerOrRepo(repo) || !isCommitSha(headSha)) return undefined;
  return { owner, repo, headSha };
}

function asDiffHead(value: unknown): DiffHead | undefined {
  return isObject(value) && "number" in value ? asPrHead(value) : asCommitHead(value);
}

// `.` and `..` segments would normalize the URL out of /raw/<sha>/ onto other github.com
// paths, sent with the user's cookies.
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
  const pr = asDiffHead(value.pr);
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

/**
 * Answers one content-side port's requests from `source`, aborting its fetches when the port
 * disconnects. A malformed message is answered `failed` when it carries a valid `id` and
 * ignored otherwise; neither is fetched.
 */
export function servePrDataPort(port: PrDataPort, source: PrDataSource): void {
  const controller = new AbortController();
  port.onDisconnect.addListener(() => controller.abort());
  port.onMessage.addListener(async (message) => {
    if (!isObject(message) || !Number.isSafeInteger(message.id)) return;
    const request = asRequest(message.request);
    if (!request) {
      port.postMessage({ id: message.id, result: FAILED });
      return;
    }
    let result: PrDataResult;
    try {
      result = await answer(source, request, controller.signal);
    } catch (error) {
      if (controller.signal.aborted) return;
      port.postMessage({ id: message.id, result: FAILED });
      throw error; // a PrDataSource bug: surface it in the worker console
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

function memoUntilFailure<T extends { ok: boolean }>(
  load: () => Promise<T>,
  initial?: Promise<T>,
): () => Promise<T> {
  let memo = initial;
  return () => {
    if (!memo) {
      const loading = load();
      memo = loading;
      void loading.then((result) => {
        if (!result.ok && memo === loading) memo = undefined;
      });
    }
    return memo;
  };
}

/**
 * A {@link PrDataClient} over ports from `connect`; `pageHeadSha` skips a PR's head lookup when the
 * page already names it. A commit is its own head.
 */
export function openPrData(
  connect: () => PrDataPort,
  pr: DiffRef,
  pageHeadSha: string | undefined,
): PrDataClient {
  let port: PrDataPort | undefined;
  let closed = false;
  let nextId = 0;
  const pending = new Map<number, (result: unknown) => void>();

  function open(): PrDataPort {
    const opened = connect();
    opened.onMessage.addListener((message) => {
      if (!isObject(message) || typeof message.id !== "number") return;
      const settle = pending.get(message.id);
      pending.delete(message.id);
      settle?.(message.result);
    });
    opened.onDisconnect.addListener(() => {
      if (port === opened) port = undefined;
      for (const settle of pending.values()) settle(FAILED);
      pending.clear();
    });
    return opened;
  }

  function send<Q extends PrDataRequest>(request: Q): Promise<PrDataResultsByKind[Q["kind"]]> {
    if (closed) return new Promise(() => {});
    const id = nextId++;
    return new Promise((resolve) => {
      // Only this extension's background can answer a runtime port, with `request.kind`'s result.
      pending.set(id, resolve as (result: unknown) => void);
      let sent: PrDataPort | undefined;
      try {
        sent = port ??= open();
        sent.postMessage({ id, request });
      } catch {
        // A port whose post throws is dead before its onDisconnect arrives.
        if (sent && port === sent) port = undefined;
        pending.delete(id);
        resolve(FAILED);
      }
    });
  }

  const resolveHead = memoUntilFailure(
    (): Promise<PrHeadResult> =>
      "number" in pr
        ? send({ kind: "head", pr })
        : Promise.resolve({ ok: true, headSha: pr.headSha }),
    pageHeadSha ? Promise.resolve({ ok: true, headSha: pageHeadSha }) : undefined,
  );

  async function atHead<R extends PrFilesResult | PrFileContentResult>(
    request: (head: DiffHead) => Promise<R>,
  ): Promise<R | PrFailure> {
    const resolved = await resolveHead();
    return resolved.ok ? request({ ...pr, headSha: resolved.headSha }) : resolved;
  }

  const files = memoUntilFailure(() => atHead((head) => send({ kind: "files", pr: head })));

  return {
    head: resolveHead,
    files,
    fileContent: (path) => atHead((head) => send({ kind: "content", pr: head, path })),
    close() {
      closed = true;
      pending.clear();
      port?.disconnect();
      port = undefined;
    },
  };
}

/** The content side's {@link PrDataClient} for `pr`; see its remarks for the client's lifetime. */
export function connectPrData(pr: DiffRef): PrDataClient {
  return openPrData(
    () => browser.runtime.connect({ name: PR_DATA_PORT }),
    pr,
    "number" in pr ? readPrPageHeadSha(document, pr) : undefined,
  );
}
