import { describe, expect, it, vi } from "vitest";
import { structuralFiles } from "../../../entrypoints/content/diffs/structural-files";
import type { PrFileDiff } from "../../../utils/github/pr-diff";
import type { PrHeadAndFilesResult } from "../../../utils/github/pr-source";
import type { FileChangesResult } from "../../../utils/structural/file-changes";

/** A promise and the function that settles it. */
function held<T>() {
  let settle!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    settle = resolve;
  });
  return { promise, settle };
}

function fakeClient() {
  const listing = held<PrHeadAndFilesResult>();
  const answers = new Map<string, ReturnType<typeof held<FileChangesResult>>>();
  const client = {
    files: vi.fn(() => listing.promise),
    structural: vi.fn((path: string) => {
      const answer = held<FileChangesResult>();
      answers.set(path, answer);
      return answer.promise;
    }),
    close: vi.fn(),
  };
  return { client, listing, answers, connect: vi.fn(() => client) };
}

function textFile(path: string, patch: string): PrFileDiff {
  return { kind: "text", path, status: "modified", patch };
}

const PATCH = "@@ -1,1 +1,1 @@\n-old\n+new";
const NO_CHANGES: FileChangesResult = { ok: true, changes: { old: [], new: [] } };

/** Settles `path`'s structural answer with `result` and the listing with `files`, then lets both land. */
async function settle(
  fake: ReturnType<typeof fakeClient>,
  path: string,
  result: FileChangesResult,
  files: PrHeadAndFilesResult = { ok: true, headSha: "abc", files: [textFile(path, PATCH)] },
) {
  fake.listing.settle(files);
  fake.answers.get(path)?.settle(result);
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("structuralFiles", () => {
  it("connects only on the first request", () => {
    const fake = fakeClient();
    const files = structuralFiles(fake.connect, new AbortController().signal);

    expect(fake.connect).not.toHaveBeenCalled();
    files.request(["a.ts"]);

    expect(fake.connect).toHaveBeenCalledTimes(1);
  });

  it("asks each new path once and lists the files once", () => {
    const fake = fakeClient();
    const files = structuralFiles(fake.connect, new AbortController().signal);

    files.request(["a.ts", "b.ts"]);
    files.request(["a.ts"]);

    expect(fake.client.structural.mock.calls).toEqual([["a.ts"], ["b.ts"]]);
    expect(fake.client.files).toHaveBeenCalledTimes(1);
    expect(fake.connect).toHaveBeenCalledTimes(1);
  });

  it("asks a settled path nothing more", async () => {
    const fake = fakeClient();
    const files = structuralFiles(fake.connect, new AbortController().signal);
    files.request(["a.ts"]);
    await settle(fake, "a.ts", NO_CHANGES);

    files.request(["a.ts"]);

    expect(fake.client.structural).toHaveBeenCalledTimes(1);
  });

  it("answers a file with the same object on every call", async () => {
    const fake = fakeClient();
    const files = structuralFiles(fake.connect, new AbortController().signal);
    files.request(["a.ts"]);
    await settle(fake, "a.ts", NO_CHANGES);

    const answer = files.answerOf("a.ts");

    expect(answer).toMatchObject({ ok: true, file: { text: { old: { 1: "old" } } } });
    expect(files.answerOf("a.ts")).toBe(answer);
  });

  it("answers the port's problem", async () => {
    const fake = fakeClient();
    const files = structuralFiles(fake.connect, new AbortController().signal);
    files.request(["a.ts"]);
    await settle(fake, "a.ts", { ok: false, problem: "unsupported" });

    expect(files.answerOf("a.ts")).toEqual({ ok: false, problem: "unsupported" });
  });

  it("answers the listing's problem", async () => {
    const fake = fakeClient();
    const files = structuralFiles(fake.connect, new AbortController().signal);
    files.request(["a.ts"]);
    await settle(fake, "a.ts", NO_CHANGES, { ok: false, problem: "rate-limited" });

    expect(files.answerOf("a.ts")).toEqual({ ok: false, problem: "rate-limited" });
  });

  it("answers failed for a path the listing has no text for", async () => {
    const fake = fakeClient();
    const files = structuralFiles(fake.connect, new AbortController().signal);
    files.request(["a.ts"]);
    await settle(fake, "a.ts", NO_CHANGES, { ok: true, headSha: "abc", files: [] });

    expect(files.answerOf("a.ts")).toEqual({ ok: false, problem: "failed" });
  });

  it("answers failed for an unreadable patch", async () => {
    const fake = fakeClient();
    const files = structuralFiles(fake.connect, new AbortController().signal);
    files.request(["a.ts"]);
    await settle(fake, "a.ts", NO_CHANGES, {
      ok: true,
      headSha: "abc",
      files: [textFile("a.ts", "@@ -1,1 +1,1 @@\n?x")],
    });

    expect(files.answerOf("a.ts")).toEqual({ ok: false, problem: "failed" });
  });

  it("tells a listener of each answer until its signal aborts", async () => {
    const fake = fakeClient();
    const files = structuralFiles(fake.connect, new AbortController().signal);
    const listening = new AbortController();
    const listener = vi.fn();
    files.onAnswer(listener, listening.signal);
    files.request(["a.ts", "b.ts"]);

    await settle(fake, "a.ts", NO_CHANGES);
    listening.abort();
    await settle(fake, "b.ts", NO_CHANGES);

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("closes the client once when the visit ends", () => {
    const fake = fakeClient();
    const visit = new AbortController();
    const files = structuralFiles(fake.connect, visit.signal);
    files.request(["a.ts"]);

    visit.abort();
    files.request(["b.ts"]);

    expect(fake.client.close).toHaveBeenCalledTimes(1);
    expect(fake.connect).toHaveBeenCalledTimes(1);
    expect(fake.client.structural).toHaveBeenCalledTimes(1);
  });

  it("opens nothing once the visit has ended", () => {
    const fake = fakeClient();
    const visit = new AbortController();
    visit.abort();

    structuralFiles(fake.connect, visit.signal).request(["a.ts"]);

    expect(fake.connect).not.toHaveBeenCalled();
  });

  it("keeps nothing that settles after the visit ended", async () => {
    const fake = fakeClient();
    const visit = new AbortController();
    const files = structuralFiles(fake.connect, visit.signal);
    const listener = vi.fn();
    files.onAnswer(listener, new AbortController().signal);
    files.request(["a.ts"]);

    visit.abort();
    await settle(fake, "a.ts", NO_CHANGES);

    expect(files.answerOf("a.ts")).toBeUndefined();
    expect(listener).not.toHaveBeenCalled();
  });

  it("gives back the outcome reported for a file", () => {
    const files = structuralFiles(fakeClient().connect, new AbortController().signal);

    files.report("a.ts", "mismatch");

    expect(files.outcomeOf("a.ts")).toBe("mismatch");
  });
});
