import { describe, expect, it, vi } from "vitest";
import { openPrData, type PrDataPort, servePrDataPort } from "../utils/pr-port";
import type { PrRef } from "../utils/pr-ref";
import { createPrDataSource } from "../utils/pr-source";

const sha = "a".repeat(40);
const pr: PrRef = { kind: "pr", owner: "o", repo: "r", number: 7 };
const page = `<script data-target="react-app.embeddedData">${JSON.stringify({
  payload: {
    pullRequestsLayoutRoute: {
      pullRequest: { number: 7, headSha: sha },
      repository: { ownerLogin: "o", name: "r" },
    },
  },
})}</script>`;
const diff =
  "diff --git a/src/engine.rs b/src/engine.rs\n--- a/src/engine.rs\n+++ b/src/engine.rs\n@@ -1 +1 @@\n-a\n+b\n";
const base = "https://github.com/o/r";

type Side = PrDataPort & {
  messageListeners: ((m: unknown) => void)[];
  disconnectListeners: (() => void)[];
};

function side(): Side {
  const messageListeners: ((m: unknown) => void)[] = [];
  const disconnectListeners: (() => void)[] = [];
  return {
    messageListeners,
    disconnectListeners,
    postMessage() {},
    disconnect() {},
    onMessage: { addListener: (listener) => messageListeners.push(listener) },
    onDisconnect: { addListener: (listener) => disconnectListeners.push(listener) },
  };
}

/** Two linked ports: messages are JSON-cloned on a microtask; disconnect fires only the far side. */
function portPair(): [Side, Side] {
  const a = side();
  const b = side();
  for (const [from, to] of [
    [a, b],
    [b, a],
  ] as const) {
    from.postMessage = (message) => {
      const copy = JSON.parse(JSON.stringify(message));
      queueMicrotask(() => {
        for (const listener of to.messageListeners) listener(copy);
      });
    };
    from.disconnect = () => {
      for (const listener of to.disconnectListeners) listener();
    };
  }
  return [a, b];
}

function routedFetch(routes: Record<string, () => Promise<Response>>) {
  return vi.fn((input: RequestInfo | URL, _init?: RequestInit) => {
    const route = routes[String(input)];
    return route ? route() : Promise.resolve(new Response("", { status: 500 }));
  });
}

const okRoutes = () => ({
  [`${base}/pull/7`]: async () => new Response(page),
  [`${base}/pull/7.diff`]: async () => new Response(diff),
  [`${base}/raw/${sha}/src/engine.rs`]: async () => new Response("fn main() {}"),
});

function harness(fetchFn: typeof fetch, wrapServer: (s: Side) => Side = (s) => s) {
  const source = createPrDataSource(fetchFn);
  const servers: Side[] = [];
  const connect = vi.fn(() => {
    const [client, server] = portPair();
    servers.push(server);
    servePrDataPort(wrapServer(server), source);
    return client;
  });
  return { connect, servers };
}

const urls = (fetchFn: ReturnType<typeof routedFetch>) =>
  fetchFn.mock.calls.map(([u]) => String(u));

describe("openPrData", () => {
  it("uses the page's head SHA without fetching the PR page", async () => {
    const fetchFn = routedFetch(okRoutes());
    const { connect } = harness(fetchFn);
    const client = openPrData(connect, pr, sha);
    expect((await client.files()).ok).toBe(true);
    expect(await client.fileContent("src/engine.rs")).toEqual({ ok: true, text: "fn main() {}" });
    expect(urls(fetchFn)).toEqual([`${base}/pull/7.diff`, `${base}/raw/${sha}/src/engine.rs`]);
  });

  it("reads a commit at its own SHA without looking up a head", async () => {
    const fetchFn = routedFetch({
      [`${base}/commit/${sha}.diff`]: async () => new Response(diff),
      [`${base}/raw/${sha}/src/engine.rs`]: async () => new Response("fn main() {}"),
    });
    const client = openPrData(
      harness(fetchFn).connect,
      { kind: "commit", owner: "o", repo: "r", headSha: sha },
      undefined,
    );
    expect((await client.files()).ok).toBe(true);
    expect(await client.fileContent("src/engine.rs")).toEqual({ ok: true, text: "fn main() {}" });
    expect(urls(fetchFn)).toEqual([
      `${base}/commit/${sha}.diff`,
      `${base}/raw/${sha}/src/engine.rs`,
    ]);
  });

  it("reads a commit by an abbreviated SHA", async () => {
    const fetchFn = routedFetch({
      [`${base}/commit/abcdef1.diff`]: async () => new Response(diff),
    });
    const client = openPrData(
      harness(fetchFn).connect,
      { kind: "commit", owner: "o", repo: "r", headSha: "abcdef1" },
      undefined,
    );
    expect((await client.files()).ok).toBe(true);
  });

  it("resolves the head once for concurrent calls when the page has none", async () => {
    const fetchFn = routedFetch(okRoutes());
    const client = openPrData(harness(fetchFn).connect, pr, undefined);
    const [files, content] = await Promise.all([
      client.files(),
      client.fileContent("src/engine.rs"),
    ]);
    expect(files.ok && content.ok).toBe(true);
    expect(urls(fetchFn).filter((u) => u === `${base}/pull/7`)).toHaveLength(1);
    expect(urls(fetchFn)).toContain(`${base}/raw/${sha}/src/engine.rs`);
  });

  it("names the head it reads at, looking it up once when the page has none", async () => {
    const fetchFn = routedFetch(okRoutes());
    const client = openPrData(harness(fetchFn).connect, pr, undefined);
    expect(await client.head()).toEqual({ ok: true, headSha: sha });
    await client.files();
    expect(urls(fetchFn).filter((u) => u === `${base}/pull/7`)).toHaveLength(1);
  });

  it("reports a failed head lookup and retries it on the next call", async () => {
    const fetchFn = routedFetch({
      [`${base}/pull/7`]: async () => new Response("", { status: 404 }),
    });
    const client = openPrData(harness(fetchFn).connect, pr, undefined);
    expect(await client.files()).toEqual({ ok: false, problem: "no-access" });
    await client.files();
    expect(urls(fetchFn).filter((u) => u === `${base}/pull/7`)).toHaveLength(2);
  });

  it("connects lazily on the first call", async () => {
    const { connect } = harness(routedFetch(okRoutes()));
    const client = openPrData(connect, pr, sha);
    expect(connect).not.toHaveBeenCalled();
    await client.files();
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it("aborts in-flight fetches on close and posts nothing after", async () => {
    let seen: AbortSignal | undefined;
    const fetchFn = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      seen = init?.signal ?? undefined;
      return new Promise<Response>((_, reject) => {
        seen?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
    });
    const { connect, servers } = harness(fetchFn);
    const client = openPrData(connect, pr, sha);
    void client.files();
    await vi.waitFor(() => expect(seen).toBeDefined());
    const post = vi.spyOn(servers[0] as Side, "postMessage");
    client.close();
    await new Promise((r) => setTimeout(r, 0));
    expect(seen?.aborted).toBe(true);
    expect(post).not.toHaveBeenCalled();
  });

  it("fails pending calls on a background disconnect and reconnects with the resolved head", async () => {
    const routes: Record<string, () => Promise<Response>> = {
      ...okRoutes(),
      [`${base}/pull/7.diff`]: () => new Promise(() => {}),
    };
    const fetchFn = routedFetch(routes);
    const { connect, servers } = harness(fetchFn);
    const client = openPrData(connect, pr, sha);
    const pending = client.files();
    await vi.waitFor(() => expect(urls(fetchFn)).toContain(`${base}/pull/7.diff`));
    servers[0]?.disconnect();
    expect(await pending).toEqual({ ok: false, problem: "failed" });
    expect((await client.fileContent("src/engine.rs")).ok).toBe(true);
    expect(connect).toHaveBeenCalledTimes(2);
    expect(urls(fetchFn)).not.toContain(`${base}/pull/7`);
  });

  it("reports a throwing connect as failed", async () => {
    const client = openPrData(
      () => {
        throw new Error("Extension context invalidated.");
      },
      pr,
      sha,
    );
    expect(await client.files()).toEqual({ ok: false, problem: "failed" });
  });

  it("reports a throwing post as failed and reconnects on the next call", async () => {
    const fetchFn = routedFetch(okRoutes());
    const { connect: connectServed } = harness(fetchFn);
    let failFirstPort = true;
    const connect = vi.fn(() => {
      const port = connectServed();
      if (failFirstPort) {
        failFirstPort = false;
        port.postMessage = () => {
          throw new Error("Attempting to use a disconnected port object");
        };
      }
      return port;
    });
    const client = openPrData(connect, pr, sha);
    expect(await client.fileContent("src/engine.rs")).toEqual({ ok: false, problem: "failed" });
    expect((await client.fileContent("src/engine.rs")).ok).toBe(true);
    expect(connect).toHaveBeenCalledTimes(2);
  });

  it("fetches the diff once for concurrent and repeated files calls", async () => {
    const fetchFn = routedFetch(okRoutes());
    const client = openPrData(harness(fetchFn).connect, pr, sha);
    await Promise.all([client.files(), client.files()]);
    await client.files();
    expect(urls(fetchFn)).toEqual([`${base}/pull/7.diff`]);
  });

  it("retries files after a problem", async () => {
    const fetchFn = routedFetch({});
    const client = openPrData(harness(fetchFn).connect, pr, sha);
    expect(await client.files()).toEqual({ ok: false, problem: "failed" });
    await client.files();
    expect(urls(fetchFn)).toEqual([`${base}/pull/7.diff`, `${base}/pull/7.diff`]);
  });

  it("reports a source error as failed", async () => {
    const source = {
      headAndFiles: vi.fn(),
      files: vi.fn(async () => {
        throw new Error("bug");
      }),
      content: vi.fn(),
    };
    const connect = () => {
      const [client, server] = portPair();
      servePrDataPort(server, source);
      return client;
    };
    const onUnhandled = vi.fn();
    process.on("unhandledRejection", onUnhandled);
    try {
      expect(await openPrData(connect, pr, sha).files()).toEqual({ ok: false, problem: "failed" });
      await new Promise((r) => setTimeout(r, 0));
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("never settles or connects for a call made after close", async () => {
    const { connect } = harness(routedFetch(okRoutes()));
    const client = openPrData(connect, pr, sha);
    client.close();
    const settled = vi.fn();
    void client.files().then(settled);
    await new Promise((r) => setTimeout(r, 0));
    expect(settled).not.toHaveBeenCalled();
    expect(connect).not.toHaveBeenCalled();
  });

  it("reports too-large when the result cannot be posted", async () => {
    const { connect } = harness(routedFetch(okRoutes()), (server) => {
      const post = server.postMessage;
      let failNextPost = true;
      server.postMessage = (m) => {
        if (failNextPost) {
          failNextPost = false;
          throw new Error("Message length exceeded maximum allowed length.");
        }
        post(m);
      };
      return server;
    });
    expect(await openPrData(connect, pr, sha).files()).toEqual({ ok: false, problem: "too-large" });
  });

  it("requests the diff while the head lookup is still in flight when the page has none", async () => {
    const release: (() => void)[] = [];
    const held = (body: string) => () =>
      new Promise<Response>((resolve) => release.push(() => resolve(new Response(body))));
    const fetchFn = routedFetch({
      [`${base}/pull/7`]: held(page),
      [`${base}/pull/7.diff`]: held(diff),
    });
    const client = openPrData(harness(fetchFn).connect, pr, undefined);
    const listed = client.files();
    await vi.waitFor(() =>
      expect(urls(fetchFn)).toEqual(
        expect.arrayContaining([`${base}/pull/7`, `${base}/pull/7.diff`]),
      ),
    );
    for (const go of release) go();
    expect((await listed).ok).toBe(true);
    expect(await client.head()).toEqual({ ok: true, headSha: sha });
    expect(urls(fetchFn)).toHaveLength(2);
  });
});

describe("servePrDataPort", () => {
  const head = { ...pr, headSha: sha };
  const repliesTo = async (message: unknown) => {
    const fetchFn = routedFetch(okRoutes());
    const [client, server] = portPair();
    const replies: unknown[] = [];
    client.messageListeners.push((m) => replies.push(m));
    servePrDataPort(server, createPrDataSource(fetchFn));
    client.postMessage(message);
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchFn).not.toHaveBeenCalled();
    return replies;
  };

  it.each([
    ["a non-object", "hi"],
    ["a missing id", { request: { kind: "files", pr: head } }],
  ])("ignores %s without fetching", async (_, message) => {
    expect(await repliesTo(message)).toEqual([]);
  });

  it.each([
    ["an unknown kind", { id: 1, request: { kind: "nope", pr: head } }],
    ["a slash in owner", { id: 1, request: { kind: "files", pr: { ...head, owner: "a/b" } } }],
    ["a .. owner", { id: 1, request: { kind: "files", pr: { ...head, owner: ".." } } }],
    ["a . repo", { id: 1, request: { kind: "files", pr: { ...head, repo: "." } } }],
    ["a zero number", { id: 1, request: { kind: "files", pr: { ...head, number: 0 } } }],
    [
      "a diff of no kind",
      { id: 1, request: { kind: "files", pr: { owner: "o", repo: "r", headSha: sha } } },
    ],
    ["a short SHA", { id: 1, request: { kind: "files", pr: { ...head, headSha: "abc" } } }],
    [
      "a commit with a too-short SHA",
      {
        id: 1,
        request: {
          kind: "files",
          pr: { kind: "commit", owner: "o", repo: "r", headSha: "abcdef" },
        },
      },
    ],
    [
      "a commit with a non-hex SHA",
      {
        id: 1,
        request: { kind: "files", pr: { kind: "commit", owner: "o", repo: "r", headSha: "main" } },
      },
    ],
    [
      "a commit with a .. owner",
      {
        id: 1,
        request: { kind: "files", pr: { kind: "commit", owner: "..", repo: "r", headSha: sha } },
      },
    ],
    ["a .. path segment", { id: 1, request: { kind: "content", pr: head, path: "../x" } }],
    ["an empty path segment", { id: 1, request: { kind: "content", pr: head, path: "a//b" } }],
    [
      "a headAndFiles of a commit",
      {
        id: 1,
        request: {
          kind: "headAndFiles",
          pr: { kind: "commit", owner: "o", repo: "r", headSha: sha },
        },
      },
    ],
    [
      "a headAndFiles with a .. owner",
      { id: 1, request: { kind: "headAndFiles", pr: { ...pr, owner: ".." } } },
    ],
  ])("answers %s failed without fetching", async (_, message) => {
    expect(await repliesTo(message)).toEqual([{ id: 1, result: { ok: false, problem: "failed" } }]);
  });
});
