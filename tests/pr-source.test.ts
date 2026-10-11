import { describe, expect, it, vi } from "vitest";
import type { CommitHead, PrHead, PrRef } from "../utils/pr-ref";
import { createPrDataSource } from "../utils/pr-source";

const shaA = "a".repeat(40);
const shaB = "b".repeat(40);
const sandbox: PrHead = { owner: "macintacos", repo: "gh-prism-sandbox", number: 1, headSha: shaA };
const pr7: PrRef = { owner: "o", repo: "r", number: 7 };
const commit: CommitHead = { owner: "o", repo: "r", headSha: "dd95cdc" };

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

const pageFor = (number: number) =>
  `<html><script type="application/json" data-target="react-app.embeddedData">${JSON.stringify({
    payload: {
      pullRequestsLayoutRoute: {
        pullRequest: { number, headSha: shaA },
        repository: { ownerLogin: "o", name: "r" },
      },
    },
  })}</script></html>`;

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
    const atA: CommitHead = { owner: "o", repo: "r", headSha: shaA };
    await source.files(atA, signal());
    await source.files({ ...pr7, headSha: shaA }, signal());
    await source.files(atA, signal());
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("keeps one commit per repository, so another commit replaces it", async () => {
    const fetchFn = okFetch();
    const source = createPrDataSource(fetchFn);
    const atA: CommitHead = { owner: "o", repo: "r", headSha: shaA };
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

describe("head", () => {
  it("reads the head SHA from the PR page", async () => {
    const fetchFn = vi.fn(async () => new Response(pageFor(7)));
    const s = signal();
    expect(await createPrDataSource(fetchFn).head(pr7, s)).toEqual({ ok: true, headSha: shaA });
    expect(fetchFn).toHaveBeenCalledWith("https://github.com/o/r/pull/7", {
      credentials: "include",
      signal: s,
    });
  });

  it.each([
    ["names another PR", pageFor(8)],
    ["has no embedded data", "<html></html>"],
  ])("fails when the page %s", async (_, page) => {
    const fetchFn = vi.fn(async () => new Response(page));
    expect(await createPrDataSource(fetchFn).head(pr7, signal())).toEqual({
      ok: false,
      problem: "failed",
    });
  });

  it("fetches the page on every request", async () => {
    const fetchFn = vi.fn(async () => new Response(pageFor(7)));
    const source = createPrDataSource(fetchFn);
    await source.head(pr7, signal());
    await source.head(pr7, signal());
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});
