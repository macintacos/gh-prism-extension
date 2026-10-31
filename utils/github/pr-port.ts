import { browser } from "wxt/browser";
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
  PrHeadAndFilesResult,
  PrHeadResult,
} from "./pr-source";

/** The `runtime.connect` port name the content script opens and the service worker serves. */
export const PR_DATA_PORT = "gh-prism:pr-data";

/** A message the content side sends over {@link PR_DATA_PORT}, one per read it needs. */
export type PrDataRequest =
  | { kind: "headAndFiles"; pr: PrRef }
  | { kind: "files"; pr: DiffHead }
  | { kind: "content"; pr: DiffHead; path: string };

type PrDataResultsByKind = {
  headAndFiles: PrHeadAndFilesResult;
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
  /**
   * The diff and the commit it ends on, which `fileContent` reads at. A PR whose page
   * names no head gets it from the same request as its diff, so the first `files` or `fileContent`
   * call fetches both.
   */
  files(): Promise<PrHeadAndFilesResult>;
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

export function isOwnerOrRepo(value: unknown): value is string {
  return typeof value === "string" && OWNER_OR_REPO.test(value) && value !== "." && value !== "..";
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asPrRef(value: unknown): PrRef | undefined {
  if (!isObject(value) || value.kind !== "pr") return undefined;
  const { owner, repo, number } = value;
  if (!isOwnerOrRepo(owner) || !isOwnerOrRepo(repo)) return undefined;
  if (typeof number !== "number" || !Number.isSafeInteger(number) || number < 1) return undefined;
  return { kind: "pr", owner, repo, number };
}

function asPrHead(value: unknown): PrHead | undefined {
  const pr = asPrRef(value);
  if (!pr || !isObject(value) || !isPrHeadSha(value.headSha)) return undefined;
  return { ...pr, headSha: value.headSha };
}

function asCommitHead(value: unknown): CommitHead | undefined {
  if (!isObject(value) || value.kind !== "commit") return undefined;
  const { owner, repo, headSha } = value;
  if (!isOwnerOrRepo(owner) || !isOwnerOrRepo(repo) || !isCommitSha(headSha)) return undefined;
  return { kind: "commit", owner, repo, headSha };
}

function asDiffHead(value: unknown): DiffHead | undefined {
  return asPrHead(value) ?? asCommitHead(value);
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
  if (value.kind === "headAndFiles") {
    const pr = asPrRef(value.pr);
    return pr && { kind: "headAndFiles", pr };
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
    case "headAndFiles":
      return source.headAndFiles(request.pr, signal);
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
 * page already names it, and otherwise the worker looks the head up alongside the diff. A commit is
 * its own head.
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

  async function filesAt(head: DiffHead): Promise<PrHeadAndFilesResult> {
    const listed = await send({ kind: "files", pr: head });
    return listed.ok ? { ...listed, headSha: head.headSha } : listed;
  }

  const files = memoUntilFailure((): Promise<PrHeadAndFilesResult> => {
    switch (pr.kind) {
      case "pr":
        return pageHeadSha
          ? filesAt({ ...pr, headSha: pageHeadSha })
          : send({ kind: "headAndFiles", pr });
      case "commit":
        return filesAt(pr);
      default:
        return pr satisfies never;
    }
  });

  const knownHead = pr.kind === "commit" ? pr.headSha : pageHeadSha;
  const resolveHead = memoUntilFailure(
    async (): Promise<PrHeadResult> => {
      const listed = await files();
      return listed.ok ? { ok: true, headSha: listed.headSha } : listed;
    },
    knownHead ? Promise.resolve({ ok: true, headSha: knownHead }) : undefined,
  );

  async function atHead(
    request: (head: DiffHead) => Promise<PrFileContentResult>,
  ): Promise<PrFileContentResult> {
    const resolved = await resolveHead();
    return resolved.ok ? request({ ...pr, headSha: resolved.headSha }) : resolved;
  }

  return {
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
    pr.kind === "pr" ? readPrPageHeadSha(document, pr) : undefined,
  );
}
