import { describe, expect, it, vi } from "vitest";
import type { CommitHead, PrHead, PrRef } from "../utils/pr-ref";
import { createPrDataSource } from "../utils/pr-source";
import { heldResponses, routedFetch } from "./fixtures/fetch";

const shaA = "a".repeat(40);
const shaB = "b".repeat(40);
const sandbox: PrHead = {
  kind: "pr",
  owner: "macintacos",
  repo: "gh-prism-sandbox",
  number: 1,
  headSha: shaA,
};
const pr7: PrRef = { kind: "pr", owner: "o", repo: "r", number: 7 };
const commit: CommitHead = { kind: "commit", owner: "o", repo: "r", headSha: "dd95cdc" };

const diff = `diff --git a/src/a.rs b/src/a.rs
index 1111111..2222222 100644
--- a/src/a.rs
+++ b/src/a.rs
@@ -1 +1 @@
-old
+new
`;

const signal = () => new AbortController().signal;
const okFetch = (body = diff) => vi.fn(async () => new Response(body));

const pageFor = (number: number, headSha = shaA) =>
  `<html><script type="application/json" data-target="react-app.embeddedData">${JSON.stringify({
    payload: {
      pullRequestsLayoutRoute: {
        pullRequest: { number, headSha },
        repository: { ownerLogin: "o", name: "r" },
      },
    },
  })}</script></html>`;

const pageUrl = "https://github.com/o/r/pull/7";
const diffUrl = "https://github.com/o/r/pull/7.diff";

const prRoutes = (page = pageFor(7)) =>
  routedFetch({
    [pageUrl]: async () => new Response(page),
    [diffUrl]: async () => new Response(diff),
  });

const diffCalls = (fetchFn: ReturnType<typeof routedFetch>) =>
  fetchFn.mock.calls.filter(([u]) => String(u) === diffUrl).length;

describe("files", () => {
  it("fetches the PR's .diff with cookies and parses it", async () => {
    const fetchFn = okFetch();
    const s = signal();
    const result = await createPrDataSource(fetchFn).files(sandbox, s);
    expect(fetchFn).toHaveBeenCalledWith(
      "https://github.com/macintacos/gh-prism-sandbox/pull/1.diff",
      { credentials: "include", signal: s },
    );
    expect(result).toEqual({
      ok: true,
      files: [
        { kind: "text", path: "src/a.rs", status: "modified", patch: "@@ -1 +1 @@\n-old\n+new" },
      ],
    });
  });

  it("fetches a commit's .diff", async () => {
    const fetchFn = okFetch();
    const s = signal();
    const result = await createPrDataSource(fetchFn).files(commit, s);
    expect(fetchFn).toHaveBeenCalledWith("https://github.com/o/r/commit/dd95cdc.diff", {
      credentials: "include",
      signal: s,
    });
    expect(result.ok).toBe(true);
  });

  it("caches a commit apart from a pull request at the same head", async () => {
    const fetchFn = okFetch();
    const source = createPrDataSource(fetchFn);
    const atA: CommitHead = { kind: "commit", owner: "o", repo: "r", headSha: shaA };
    await source.files(atA, signal());
    await source.files({ ...pr7, headSha: shaA }, signal());
    await source.files(atA, signal());
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("keeps one commit per repository, so another commit replaces it", async () => {
    const fetchFn = okFetch();
    const source = createPrDataSource(fetchFn);
    const atA: CommitHead = { kind: "commit", owner: "o", repo: "r", headSha: shaA };
    await source.files(atA, signal());
    await source.files(atA, signal());
    await source.files({ ...atA, headSha: shaB }, signal());
    await source.files(atA, signal());
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it("serves a repeat request for the same head from cache", async () => {
    const fetchFn = okFetch();
    const source = createPrDataSource(fetchFn);
    await source.files(sandbox, signal());
    await source.files(sandbox, signal());
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("replaces the cached entry when the head changes", async () => {
    const fetchFn = okFetch();
    const source = createPrDataSource(fetchFn);
    await source.files(sandbox, signal());
    await source.files({ ...sandbox, headSha: shaB }, signal());
    expect(fetchFn).toHaveBeenCalledTimes(2);
    await source.files(sandbox, signal());
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it("retries after a problem", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 500 }))
      .mockResolvedValueOnce(new Response(diff));
    const source = createPrDataSource(fetchFn);
    expect(await source.files(sandbox, signal())).toEqual({ ok: false, problem: "failed" });
    expect((await source.files(sandbox, signal())).ok).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("keeps the newer head's cache when an older head's request finishes late", async () => {
    let finishA: (r: Response) => void = () => {};
    const fetchFn = vi
      .fn()
      .mockReturnValueOnce(new Promise<Response>((r) => (finishA = r)))
      .mockResolvedValue(new Response(diff));
    const source = createPrDataSource(fetchFn);
    const headB = { ...sandbox, headSha: shaB };
    const lateA = source.files(sandbox, signal());
    await source.files(headB, signal());
    finishA(new Response(diff));
    await lateA;
    await source.files(headB, signal());
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("reports an empty diff as no files", async () => {
    expect(await createPrDataSource(okFetch("")).files(sandbox, signal())).toEqual({
      ok: true,
      files: [],
    });
  });

  it.each([
    ["404", () => new Response("Not Found", { status: 404 }), "no-access"],
    ["401", () => new Response("", { status: 401 }), "no-access"],
    ["403", () => new Response("", { status: 403 }), "no-access"],
    [
      "403 with retry-after",
      () => new Response("", { status: 403, headers: { "retry-after": "60" } }),
      "rate-limited",
    ],
    [
      "403 with no rate limit remaining",
      () => new Response("", { status: 403, headers: { "x-ratelimit-remaining": "0" } }),
      "rate-limited",
    ],
    ["429", () => new Response("", { status: 429 }), "rate-limited"],
    ["500", () => new Response("", { status: 500 }), "failed"],
    ["an HTML 200", () => new Response("<!DOCTYPE html><html></html>"), "failed"],
    [
      "a network error",
      () => {
        throw new TypeError("Failed to fetch");
      },
      "failed",
    ],
  ])("maps %s to %s", async (_, respond, problem) => {
    const fetchFn = vi.fn(async () => respond());
    expect(await createPrDataSource(fetchFn).files(sandbox, signal())).toEqual({
      ok: false,
      problem,
    });
  });

  it("rejects with AbortError when aborted", async () => {
    const fetchFn = vi.fn(
      (_: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );
    const controller = new AbortController();
    const pending = createPrDataSource(fetchFn).files(sandbox, controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("content", () => {
  const head: PrHead = { ...pr7, headSha: shaA };

  it("fetches the raw file at the head SHA, encoding each segment", async () => {
    const fetchFn = okFetch("fn main() {}");
    const s = signal();
    const result = await createPrDataSource(fetchFn).content(head, "src/my file.rs", s);
    expect(fetchFn).toHaveBeenCalledWith(`https://github.com/o/r/raw/${shaA}/src/my%20file.rs`, {
      credentials: "include",
      signal: s,
    });
    expect(result).toEqual({ ok: true, text: "fn main() {}" });
  });

  it("fetches a commit's raw file at its SHA", async () => {
    const fetchFn = okFetch("x");
    await createPrDataSource(fetchFn).content(commit, "src/a.rs", signal());
    expect(fetchFn).toHaveBeenCalledWith("https://github.com/o/r/raw/dd95cdc/src/a.rs", {
      credentials: "include",
      signal: expect.any(AbortSignal),
    });
  });

  it("caches per path within a head and drops the cache when the head changes", async () => {
    const fetchFn = vi.fn(async () => new Response("x"));
    const source = createPrDataSource(fetchFn);
    await source.content(head, "a", signal());
    await source.content(head, "a", signal());
    await source.content(head, "b", signal());
    expect(fetchFn).toHaveBeenCalledTimes(2);
    await source.content({ ...head, headSha: shaB }, "a", signal());
    await source.content(head, "a", signal());
    expect(fetchFn).toHaveBeenCalledTimes(4);
  });

  it("retries after a problem", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 500 }))
      .mockResolvedValueOnce(new Response("x"));
    const source = createPrDataSource(fetchFn);
    expect(await source.content(head, "a", signal())).toEqual({ ok: false, problem: "failed" });
    expect(await source.content(head, "a", signal())).toEqual({ ok: true, text: "x" });
  });
});

describe("headAndFiles", () => {
  it("looks up the head on the PR page while fetching the diff", async () => {
    const { release, held } = heldResponses();
    const fetchFn = routedFetch({ [pageUrl]: held(pageFor(7)), [diffUrl]: held(diff) });
    const s = signal();
    const pending = createPrDataSource(fetchFn).headAndFiles(pr7, s);
    await vi.waitFor(() => expect(release).toHaveLength(2));
    expect(fetchFn).toHaveBeenCalledWith(pageUrl, { credentials: "include", signal: s });
    expect(fetchFn).toHaveBeenCalledWith(diffUrl, { credentials: "include", signal: s });
    for (const go of release) go();
    expect(await pending).toEqual({
      ok: true,
      headSha: shaA,
      files: [
        { kind: "text", path: "src/a.rs", status: "modified", patch: "@@ -1 +1 @@\n-old\n+new" },
      ],
    });
  });

  it.each([
    ["names another PR", pageFor(8)],
    ["has no embedded data", "<html></html>"],
  ])("fails when the page %s", async (_, page) => {
    expect(await createPrDataSource(prRoutes(page)).headAndFiles(pr7, signal())).toEqual({
      ok: false,
      problem: "failed",
    });
  });

  it("caches nothing when the head lookup fails", async () => {
    const fetchFn = prRoutes("<html></html>");
    const source = createPrDataSource(fetchFn);
    await source.headAndFiles(pr7, signal());
    await source.files({ ...pr7, headSha: shaA }, signal());
    expect(diffCalls(fetchFn)).toBe(2);
  });

  it("reports the diff's problem when the head resolves", async () => {
    const fetchFn = routedFetch({
      [pageUrl]: async () => new Response(pageFor(7)),
      [diffUrl]: async () => new Response("", { status: 404 }),
    });
    expect(await createPrDataSource(fetchFn).headAndFiles(pr7, signal())).toEqual({
      ok: false,
      problem: "no-access",
    });
  });

  it("files the diff under the head it looked up", async () => {
    const fetchFn = prRoutes();
    const source = createPrDataSource(fetchFn);
    await source.headAndFiles(pr7, signal());
    await source.files({ ...pr7, headSha: shaA }, signal());
    expect(diffCalls(fetchFn)).toBe(1);
    await source.files({ ...pr7, headSha: shaB }, signal());
    expect(diffCalls(fetchFn)).toBe(2);
  });

  it("reuses a cached diff once the page confirms its head", async () => {
    const fetchFn = prRoutes();
    const source = createPrDataSource(fetchFn);
    const cached = await source.files({ ...pr7, headSha: shaA }, signal());
    fetchFn.mockClear();
    const result = await source.headAndFiles(pr7, signal());
    expect(fetchFn.mock.calls.map(([u]) => String(u))).toEqual([pageUrl]);
    expect(result).toEqual({ ...cached, headSha: shaA });
  });

  it("replaces another head's diff when the page names a new head", async () => {
    const fetchFn = prRoutes(pageFor(7, shaB));
    const source = createPrDataSource(fetchFn);
    await source.files({ ...pr7, headSha: shaA }, signal());
    const result = await source.headAndFiles(pr7, signal());
    expect(result).toMatchObject({ ok: true, headSha: shaB });
    expect(diffCalls(fetchFn)).toBe(2);
    await source.files({ ...pr7, headSha: shaA }, signal());
    expect(diffCalls(fetchFn)).toBe(3);
  });

  it("fetches the page on every request", async () => {
    const fetchFn = prRoutes();
    const source = createPrDataSource(fetchFn);
    await source.headAndFiles(pr7, signal());
    await source.headAndFiles(pr7, signal());
    expect(fetchFn.mock.calls.filter(([u]) => String(u) === pageUrl)).toHaveLength(2);
    expect(diffCalls(fetchFn)).toBe(1);
  });
});
