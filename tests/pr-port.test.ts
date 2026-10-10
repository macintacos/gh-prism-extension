import { describe, expect, it, vi } from "vitest";
import { openPrData, type PrDataPort, servePrDataPort } from "../utils/pr-port";
import type { PrRef } from "../utils/pr-ref";
import { createPrDataSource } from "../utils/pr-source";

const sha = "a".repeat(40);
const pr: PrRef = { owner: "o", repo: "r", number: 7 };
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

type Side = PrDataPort & { listeners: ((m: unknown) => void)[]; gone: (() => void)[] };

function side(): Side {
  const listeners: ((m: unknown) => void)[] = [];
  const gone: (() => void)[] = [];
  return {
    listeners,
    gone,
    postMessage() {},
    disconnect() {},
    onMessage: { addListener: (l) => listeners.push(l) },
    onDisconnect: { addListener: (l) => gone.push(l) },
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
        for (const l of to.listeners) l(copy);
      });
    };
    from.disconnect = () => {
      for (const l of to.gone) l();
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

  it("reports a failed head lookup and retries it on the next call", async () => {
    const fetchFn = routedFetch({
      [`${base}/pull/7`]: async () => new Response("", { status: 404 }),
    });
    const client = openPrData(harness(fetchFn).connect, pr, undefined);
    expect(await client.files()).toEqual({ ok: false, problem: "no-access" });
    await client.files();
    expect(urls(fetchFn)).toEqual([`${base}/pull/7`, `${base}/pull/7`]);
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
    const client = openPrData(connect, pr, undefined);
    const pending = client.files();
    await vi.waitFor(() => expect(urls(fetchFn)).toContain(`${base}/pull/7.diff`));
    servers[0]?.disconnect();
    expect(await pending).toEqual({ ok: false, problem: "failed" });
    expect((await client.fileContent("src/engine.rs")).ok).toBe(true);
    expect(connect).toHaveBeenCalledTimes(2);
    expect(urls(fetchFn).filter((u) => u === `${base}/pull/7`)).toHaveLength(1);
  });

  it("reports too-large when the result cannot be posted", async () => {
    const { connect } = harness(routedFetch(okRoutes()), (server) => {
      const post = server.postMessage;
      let first = true;
      server.postMessage = (m) => {
        if (first) {
          first = false;
          throw new Error("Message length exceeded maximum allowed length.");
        }
        post(m);
      };
      return server;
    });
    expect(await openPrData(connect, pr, sha).files()).toEqual({ ok: false, problem: "too-large" });
  });
});

describe("servePrDataPort", () => {
  const head = { ...pr, headSha: sha };
  it.each([
    ["a non-object", "hi"],
    ["a missing id", { request: { kind: "files", pr: head } }],
    ["an unknown kind", { id: 1, request: { kind: "nope", pr: head } }],
    ["a slash in owner", { id: 1, request: { kind: "files", pr: { ...head, owner: "a/b" } } }],
    ["a zero number", { id: 1, request: { kind: "files", pr: { ...head, number: 0 } } }],
    ["a short SHA", { id: 1, request: { kind: "files", pr: { ...head, headSha: "abc" } } }],
    ["a .. path segment", { id: 1, request: { kind: "content", pr: head, path: "../x" } }],
    ["an empty path segment", { id: 1, request: { kind: "content", pr: head, path: "a//b" } }],
  ])("ignores %s without fetching", async (_, message) => {
    const fetchFn = routedFetch(okRoutes());
    const [client, server] = portPair();
    servePrDataPort(server, createPrDataSource(fetchFn));
    client.postMessage(message);
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
